use anyhow::Context as _;
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;

use meron_core::engine::Engine;
use meron_core::engine::*;
use meron_core::{imap, mail_model, parse, store};

use crate::{Writer, emit};

pub(crate) const IDLE_LIMIT: u32 = 50;

/// Longest a notification waits on the body fetch its snippets need. Past this
/// the event goes out with whatever bodies are cached: a late notification is
/// worse than one showing subjects alone, and the general prefetch fills the
/// rest in anyway.
pub(crate) const NOTIFY_PREVIEW_TIMEOUT: Duration = Duration::from_secs(8);

/// `mail.newMessages` detail for a batch of arrivals, with the arrivals' bodies
/// fetched first so the notification can show the mail itself.
pub(crate) async fn new_messages_detail(
    engine: &Arc<Engine>,
    account: &str,
    headers: &[imap::MessageHeader],
) -> Option<Value> {
    let uids: Vec<u32> = headers
        .iter()
        .take(mail_model::NEW_MESSAGES_DETAIL_MAX)
        .map(|header| header.uid)
        .collect();
    let fetch = fetch_bodies_for_uids(engine, account, "INBOX", &uids, parse::media_root());
    match tokio::time::timeout(NOTIFY_PREVIEW_TIMEOUT, fetch).await {
        Ok(Ok(_)) => {}
        Ok(Err(err)) => eprintln!("meron-core: notification bodies for {account}: {err:#}"),
        Err(_) => eprintln!("meron-core: notification bodies for {account}: timed out"),
    }
    let account_name = account_label(engine, account);
    let muted = engine.is_muted(account);
    let db = engine.db.lock().unwrap();
    mail_model::new_messages_detail(&db, account, &account_name, muted, headers)
}

/// Friendly display name or email address of an account for user-facing notifications.
pub(crate) fn account_label(engine: &Arc<Engine>, account: &str) -> String {
    let db = engine.db.lock().unwrap();
    store::account_label(&db, account)
}

pub(crate) fn watch_key(account: &str, folder: &str) -> String {
    format!("{account}\n{folder}")
}

pub(crate) fn start_idle_watch(
    engine: Arc<Engine>,
    out: Writer,
    account: String,
    folder: String,
) -> bool {
    let key = watch_key(&account, &folder);
    {
        let mut watched = engine.watched.lock().unwrap();
        if watched.contains(&key) {
            return false;
        }
        watched.insert(key);
    }
    tokio::spawn(idle_watch(engine, out, account, folder));
    true
}

/// Long-lived per-account/folder IDLE watcher. Reconnects with backoff on error
/// so a dropped connection or server timeout resumes pushing updates.
pub(crate) async fn idle_watch(engine: Arc<Engine>, out: Writer, account: String, folder: String) {
    let key = watch_key(&account, &folder);
    loop {
        // Stop cleanly once the account has been removed (account.remove).
        if !engine.accounts.lock().await.contains_key(&account) {
            engine.watched.lock().unwrap().remove(&key);
            break;
        }
        // Stop checking while paused; account.setPaused respawns us on resume.
        if engine.is_paused(&account) {
            engine.watched.lock().unwrap().remove(&key);
            break;
        }
        if !engine.watched.lock().unwrap().contains(&key) {
            break;
        }
        if let Err(e) = idle_once(&engine, &out, &account, &folder).await {
            emit(
                &out,
                "error",
                json!({ "message": format!("idle {account}/{folder}: {e:#}") }),
            )
            .await;
            // Back off before reconnecting on error, but wake immediately on a
            // pause toggle so a just-paused account stops promptly (next
            // iteration sees is_paused). A clean return (pause or OS resume)
            // skips the backoff: pause exits at the top, resume reconnects now.
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(15)) => {}
                _ = wait_for_watch_stop(&engine, &account, &key) => {}
            }
        }
    }
    emit(
        &out,
        "watch.stopped",
        json!({ "account": account, "folder": folder }),
    )
    .await;
}

async fn wait_for_watch_stop(engine: &Engine, account: &str, key: &str) {
    loop {
        let notified = engine.pause_signal.notified();
        tokio::pin!(notified);
        // Register before checking persistent state so notify_waiters cannot
        // fall between the check and the wait. Stops before registration are
        // caught by the state check instead.
        notified.as_mut().enable();
        if !engine.watched.lock().unwrap().contains(key) || engine.is_paused(account) {
            return;
        }
        notified.await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use meron_core::secrets;
    use rusqlite::Connection;

    struct TestHost;

    impl EngineHost for TestHost {
        fn open_db(&self) -> anyhow::Result<Connection> {
            store::open_at(":memory:")
        }

        fn apply_secret(&self, _: &Connection, _: &str, _: &mut imap::Creds) {}

        fn store_secret(
            &self,
            _: &Connection,
            _: &str,
            _: &secrets::Secrets,
        ) -> anyhow::Result<()> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn stop_before_wait_registration_is_not_lost() {
        let engine = Engine::new(Box::new(TestHost)).unwrap();
        let key = watch_key("bob", "Archive");
        engine.watched.lock().unwrap().insert(key.clone());
        let wait = wait_for_watch_stop(&engine, "bob", &key);
        // Simulate watch.stop during sync, before the cancellation future polls.
        engine.watched.lock().unwrap().remove(&key);
        engine.pause_signal.notify_waiters();
        tokio::time::timeout(Duration::from_secs(1), wait)
            .await
            .expect("a stop before registration must still cancel the watch");
    }

    #[tokio::test]
    async fn unrelated_stop_keeps_watching_until_own_stop() {
        let engine = Engine::new(Box::new(TestHost)).unwrap();
        let key = watch_key("bob", "Archive");
        engine.watched.lock().unwrap().insert(key.clone());
        let wait = wait_for_watch_stop(&engine, "bob", &key);
        tokio::pin!(wait);
        assert!(futures::poll!(&mut wait).is_pending());
        engine.pause_signal.notify_waiters();
        assert!(futures::poll!(&mut wait).is_pending());
        engine.watched.lock().unwrap().remove(&key);
        engine.pause_signal.notify_waiters();
        tokio::time::timeout(Duration::from_secs(1), wait)
            .await
            .expect("a registered watcher must wake when stopped");
    }
}

/// Sync `folder` and surface the result to the UI: a "new mail" toast when
/// INBOX's UIDNEXT advanced (genuine arrivals), otherwise a silent refresh.
/// Shared by the IDLE wake path and the post-connect catch-up so both behave
/// identically.
pub(crate) async fn sync_and_notify(
    engine: &Arc<Engine>,
    out: &Writer,
    account: &str,
    folder: &str,
) -> anyhow::Result<()> {
    // An IDLE wake can mean new mail *or* just a flag change (e.g. a message
    // read on another device). UIDNEXT only advances for new arrivals, so
    // compare it across the refresh to tell them apart.
    let is_inbox = folder.eq_ignore_ascii_case("INBOX");
    // Refresh on a separate connection (the IDLE one stays dedicated to IDLE).
    let synced = sync_messages(engine, account, folder, IDLE_LIMIT).await?;

    let new_inbox = (!synced.arrivals.is_empty()).then_some(synced.arrivals);

    if let Some(headers) = new_inbox {
        // Building the detail fetches the arrivals' own bodies (the notification
        // shows a snippet of each); warm the rest of the backlog behind it so the
        // first open of anything else is instant too.
        let detail = new_messages_detail(engine, account, &headers).await;
        spawn_body_prefetch(engine.clone(), account.to_string(), "INBOX".to_string());
        if let Some(detail) = detail {
            emit(out, "mail.newMessages", detail).await;
        }
    } else {
        if !is_inbox {
            spawn_body_prefetch(engine.clone(), account.to_string(), folder.to_string());
        }
        // Flag-only change: refresh the UI silently, no "new mail" toast.
        emit(
            out,
            "mail.synced",
            json!({ "account": account, "folder": folder, "synced": synced.count }),
        )
        .await;
    }
    Ok(())
}

/// One IDLE connection lifecycle: hold a dedicated session on one mailbox, and
/// on each server notification refresh that folder in the store.
pub(crate) async fn idle_once(
    engine: &Arc<Engine>,
    out: &Writer,
    account: &str,
    folder: &str,
) -> anyhow::Result<()> {
    let key = watch_key(account, folder);
    let mut session = tokio::select! {
        biased;
        _ = wait_for_watch_stop(engine, account, &key) => return Ok(()),
        result = async {
            let creds = engine.ensure_valid_creds(account).await?;
            let mut session = imap::connect(&creds).await?;
            session.select(folder).await.with_context(|| format!("SELECT {folder}"))?;
            Ok::<_, anyhow::Error>(session)
        } => result?,
    };

    // Catch up before parking in IDLE: the server only pushes notifications for
    // mail that arrives *after* IDLE begins, so anything delivered while we were
    // disconnected (startup, error reconnect, or resume from suspend) would
    // otherwise stay invisible until the next push. Cheap because idle_once is
    // only (re)entered on a fresh connection, not on each 15-min IDLE timeout.
    // Finish persistence and notification together even if stopped mid-sync:
    // dropping the future could lose arrivals after UIDNEXT is saved, or leave
    // an incomplete JSON line on stdout while emit is writing it.
    sync_and_notify(engine, out, account, folder).await?;

    loop {
        // Only cancel socket work. Checking persistent stop state here also
        // catches stops received during the preceding sync or event write.
        // Unrelated pause signals leave this connection in IDLE.
        let (next_session, response) = tokio::select! {
            biased;
            _ = wait_for_watch_stop(engine, account, &key) => return Ok(()),
            // Drop a socket held across suspend without waiting for DONE.
            _ = engine.resume_signal.notified() => return Ok(()),
            result = async {
                let mut handle = session.idle();
                handle.init().await.context("IDLE init")?;
                let response = {
                    let (idle_fut, _stop) = handle.wait_with_timeout(Duration::from_secs(15 * 60));
                    idle_fut.await.context("IDLE")?
                };
                let session = handle.done().await.context("IDLE done")?;
                Ok::<_, anyhow::Error>((session, response))
            } => result?,
        };
        session = next_session;
        if let async_imap::extensions::idle::IdleResponse::NewData(_) = response {
            sync_and_notify(engine, out, account, folder).await?;
        }
    }
}
