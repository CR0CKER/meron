//! Answers to calendar invitations — see [`crate::calendar`].

use anyhow::Result;
use rusqlite::{Connection, OptionalExtension, params};

use super::now_unix;

/// The user's recorded answer to one event (or one occurrence of it).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct InviteResponse {
    pub response: String,
    pub sequence: i64,
    pub responded_at: i64,
}

pub fn invite_response(
    conn: &Connection,
    account: &str,
    uid: &str,
    recurrence_id: i64,
) -> Result<Option<InviteResponse>> {
    Ok(conn
        .query_row(
            "SELECT response, sequence, responded_at FROM invite_responses
             WHERE account = ?1 AND uid = ?2 AND recurrence_id = ?3",
            params![account, uid, recurrence_id],
            |row| {
                Ok(InviteResponse {
                    response: row.get(0)?,
                    sequence: row.get(1)?,
                    responded_at: row.get(2)?,
                })
            },
        )
        .optional()?)
}

pub fn record_invite_response(
    conn: &Connection,
    account: &str,
    uid: &str,
    recurrence_id: i64,
    response: &str,
    sequence: i64,
) -> Result<()> {
    conn.execute(
        "INSERT INTO invite_responses (account, uid, recurrence_id, response, sequence, responded_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(account, uid, recurrence_id) DO UPDATE SET
           response = excluded.response,
           sequence = excluded.sequence,
           responded_at = excluded.responded_at",
        params![account, uid, recurrence_id, response, sequence, now_unix()],
    )?;
    Ok(())
}
