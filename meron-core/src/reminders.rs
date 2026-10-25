//! One reminder plan shared by desktop and native mobile notification schedulers.
//! Timed events alert ten minutes before starting; date-only items at 09:00
//! local time. A selected task time is an instant, including explicit midnight.
use anyhow::Result;
use chrono::{Datelike, TimeZone};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{calendar, store};
const DAY: i64 = 86_400;
const LEAD: i64 = 600;
const START_KEY: &str = "__reminders_started__";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Reminder {
    pub key: String,
    pub kind: String,
    pub item_id: String,
    pub title: String,
    pub body: String,
    pub at: i64,
    #[serde(skip)]
    eligible_after: i64,
    #[serde(skip)]
    expires_at: i64,
}

fn day_time(at: i64, utc_date: bool, hour: u32) -> Option<i64> {
    let tz = calendar::local_tz();
    let date = if utc_date {
        chrono::DateTime::from_timestamp(at, 0)?.date_naive()
    } else {
        tz.timestamp_opt(at, 0).single()?.date_naive()
    };
    tz.with_ymd_and_hms(date.year(), date.month(), date.day(), hour, 0, 0)
        .earliest()
        .map(|at| at.timestamp())
}

fn morning(at: i64, utc_date: bool) -> Option<i64> {
    day_time(at, utc_date, 9)
}

// A missing midnight at a DST boundary starts at the first valid local hour.
fn local_day_end(at: i64) -> Option<i64> {
    (0..24).find_map(|hour| day_time(at, true, hour))
}

fn started_at(conn: &Connection, now: i64) -> Result<i64> {
    conn.execute(
        "INSERT OR IGNORE INTO reminder_deliveries(key, delivered_at) VALUES(?1, ?2)",
        params![START_KEY, now],
    )?;
    Ok(conn.query_row(
        "SELECT delivered_at FROM reminder_deliveries WHERE key = ?1",
        params![START_KEY],
        |row| row.get(0),
    )?)
}

fn reset_start(conn: &Connection, now: i64) -> Result<()> {
    conn.execute(
        "INSERT INTO reminder_deliveries(key, delivered_at) VALUES(?1, ?2)
                  ON CONFLICT(key) DO UPDATE SET delivered_at = excluded.delivered_at",
        params![START_KEY, now],
    )?;
    Ok(())
}

fn plan(conn: &Connection, from: i64, to: i64, now: i64) -> Result<Vec<Reminder>> {
    let started = started_at(conn, now)?;
    Ok(list(conn, from, to)?
        .into_iter()
        .filter(|reminder| {
            reminder.at >= started
                && reminder.at >= reminder.eligible_after
                && (reminder.expires_at == 0 || reminder.expires_at > now)
        })
        .collect())
}

pub fn list(conn: &Connection, from: i64, to: i64) -> Result<Vec<Reminder>> {
    let mut reminders = Vec::new();
    let payload = calendar::events::events_payload(conn, from - DAY, to + DAY + LEAD, false)?;
    for event in payload["events"].as_array().into_iter().flatten() {
        if event["response"] == "declined" {
            continue;
        }
        let start = event["start"].as_i64().unwrap_or(0);
        let all_day = event["all_day"] == true;
        let created = event["created_at"].as_i64().unwrap_or(0);
        let changed = event["reminder_after"].as_i64().unwrap_or(created);
        let at = if all_day {
            morning(start, true)
        } else if created.max(changed) > start - LEAD && created.max(changed) < start {
            // An event created or rescheduled inside its lead time alerts at its start.
            Some(start)
        } else {
            Some(start - LEAD)
        };
        let Some(at) = at.filter(|at| *at >= from && *at < to) else {
            continue;
        };
        let id = event["id"].as_str().unwrap_or_default();
        reminders.push(Reminder {
            key: format!("event:{id}:{start}:{at}"),
            kind: "calendar".into(),
            item_id: id.into(),
            title: event["title"].as_str().unwrap_or_default().into(),
            body: event["location"].as_str().unwrap_or_default().into(),
            at,
            eligible_after: created.max(changed),
            expires_at: if all_day {
                local_day_end(event["end"].as_i64().unwrap_or(start + DAY)).unwrap_or(start + DAY)
            } else {
                event["end"].as_i64().unwrap_or(start).max(start + 1)
            },
        });
    }
    for task in store::tasks_due_between(conn, from - DAY, to + DAY)? {
        let at = if task.due_has_time {
            Some(task.due_at)
        } else {
            morning(task.due_at, false)
        };
        let Some(at) = at.filter(|at| *at >= from && *at < to) else {
            continue;
        };
        reminders.push(Reminder {
            key: format!("task:{}:{at}", task.id),
            kind: "tasks".into(),
            item_id: task.id,
            title: task.title,
            body: String::new(),
            at,
            eligible_after: task.created_at.max(task.reminder_after),
            expires_at: 0,
        });
    }
    let mut unseen = Vec::new();
    let mut check =
        conn.prepare("SELECT EXISTS(SELECT 1 FROM reminder_deliveries WHERE key = ?1)")?;
    let mut occurrence_check = conn.prepare(
        "SELECT EXISTS(SELECT 1 FROM reminder_deliveries WHERE key >= ?1 AND key < ?2
            AND instr(substr(key, length(?1) + 1), ':') = 0)",
    )?;
    let mut keys = std::collections::HashSet::new();
    for reminder in reminders {
        if !keys.insert(reminder.key.clone())
            || check.query_row(params![reminder.key], |r| r.get::<_, bool>(0))?
        {
            continue;
        }
        // A lead-time fallback or timezone change can change an occurrence's
        // trigger without making it a new occurrence. Match existing receipts
        // by the event id + occurrence start, retaining the persisted key format.
        if reminder.kind == "calendar" {
            if let Some((occurrence, _)) = reminder.key.rsplit_once(':') {
                if occurrence_check.query_row(
                    params![format!("{occurrence}:"), format!("{occurrence};")],
                    |r| r.get::<_, bool>(0),
                )? {
                    continue;
                }
            }
        }
        unseen.push(reminder);
    }
    unseen.sort_by(|a, b| a.at.cmp(&b.at).then(a.key.cmp(&b.key)));
    Ok(unseen)
}

/// Claim only a currently valid, due reminder. Changes and completions between
/// planning and delivery cannot produce stale alerts; INSERT OR IGNORE also
/// serializes competing Android receiver / foreground refresh runs.
pub fn claim(conn: &Connection, key: &str, now: i64) -> Result<Option<Reminder>> {
    let tx = conn.unchecked_transaction()?;
    let reminder = plan(&tx, now - DAY, now + 1, now)?
        .into_iter()
        .find(|r| r.key == key);
    if let Some(ref reminder) = reminder {
        if tx.execute(
            "INSERT OR IGNORE INTO reminder_deliveries(key, delivered_at) VALUES(?1, ?2)",
            params![reminder.key, now],
        )? == 0
        {
            return Ok(None);
        }
    }
    tx.execute(
        "DELETE FROM reminder_deliveries WHERE delivered_at < ?1 AND key <> ?2",
        params![now - 60 * DAY, START_KEY],
    )?;
    tx.commit()?;
    Ok(reminder)
}

pub fn dispatch(conn: &Connection, method: &str, p: &Value) -> Result<Value> {
    let now = store::now_unix();
    if method == "reminders.skipPast" {
        reset_start(conn, now)?;
        return Ok(json!({"ok": true}));
    }
    if method == "reminders.acknowledge" {
        let keys: Vec<String> =
            serde_json::from_value(p.get("keys").cloned().unwrap_or(json!([])))?;
        let tx = conn.unchecked_transaction()?;
        for key in keys {
            anyhow::ensure!(
                key.starts_with("task:") || key.starts_with("event:"),
                "invalid reminder key"
            );
            tx.execute(
                "INSERT OR IGNORE INTO reminder_deliveries(key, delivered_at) VALUES(?1, ?2)",
                params![key, now],
            )?;
        }
        tx.execute(
            "DELETE FROM reminder_deliveries WHERE delivered_at < ?1 AND key <> ?2",
            params![now - 60 * DAY, START_KEY],
        )?;
        tx.commit()?;
        return Ok(json!({"ok": true}));
    }
    if method == "reminders.claim" {
        return Ok(json!({"reminder": claim(conn, p["key"].as_str().unwrap_or_default(), now)?}));
    }
    let from = if p["upcoming"] == true {
        now + 1
    } else {
        now - DAY
    };
    let to = if p["due_only"] == true {
        now + 1
    } else {
        now + 30 * DAY
    };
    let mut reminders = plan(conn, from, to, now)?;
    // Catch-up must not crowd future alarms out of a mobile scheduler's plan.
    let (mut due, mut future) = (0, 0);
    reminders.retain(|reminder| {
        let count = if reminder.at <= now {
            &mut due
        } else {
            &mut future
        };
        *count += 1;
        *count <= 64
    });
    Ok(json!({"reminders": reminders}))
}

#[cfg(test)]
mod tests;
