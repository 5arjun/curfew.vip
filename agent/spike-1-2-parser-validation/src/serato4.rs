//! Serato 4+ path: query `master.sqlite`'s `history_session`/`history_entry` tables
//! directly. No binary decoding needed — this is plain SQL against Serato's own
//! (undocumented-but-plain) relational schema. Opened strictly read-only; this spike
//! must never write to a DJ's real, in-use Serato database.

use rusqlite::{Connection, OpenFlags, Result as SqlResult};

#[derive(Debug, Clone, Default)]
pub struct Serato4Play {
    pub artist: Option<String>,
    pub name: Option<String>,
    pub genre: Option<String>,
    pub key: Option<String>,
    pub bpm: Option<f64>,
    pub start_time: i64,
    pub end_time: Option<i64>,
    pub deck: Option<String>,
    pub played: bool,
    pub device: Option<String>,
    pub app_name: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Serato4Session {
    pub id: i64,
    pub name: Option<String>,
    pub start_time: i64,
    pub end_time: Option<i64>,
}

pub fn open_read_only(path: &str) -> SqlResult<Connection> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
}

pub fn list_sessions(conn: &Connection, limit: i64) -> SqlResult<Vec<Serato4Session>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, start_time, end_time
         FROM history_session
         ORDER BY start_time DESC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map([limit], |row| {
        Ok(Serato4Session {
            id: row.get(0)?,
            name: row.get(1)?,
            start_time: row.get(2)?,
            end_time: row.get(3)?,
        })
    })?;
    rows.collect()
}

/// Fetches one session by its `history_session.id` directly — used to cross-validate
/// a specific legacy `.session` file against its known migrated counterpart (see
/// findings doc §4), rather than only ever looking at the most recent sessions.
pub fn get_session(conn: &Connection, id: i64) -> SqlResult<Option<Serato4Session>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, start_time, end_time
         FROM history_session
         WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map([id], |row| {
        Ok(Serato4Session {
            id: row.get(0)?,
            name: row.get(1)?,
            start_time: row.get(2)?,
            end_time: row.get(3)?,
        })
    })?;
    rows.next().transpose()
}

pub fn plays_for_session(conn: &Connection, session_id: i64) -> SqlResult<Vec<Serato4Play>> {
    let mut stmt = conn.prepare(
        "SELECT artist, name, genre, key, bpm, start_time, end_time, deck, played, device, app_name
         FROM history_entry
         WHERE session_id = ?1
         ORDER BY start_time ASC",
    )?;
    let rows = stmt.query_map([session_id], |row| {
        Ok(Serato4Play {
            artist: row.get(0)?,
            name: row.get(1)?,
            genre: row.get(2)?,
            key: row.get(3)?,
            bpm: row.get(4)?,
            start_time: row.get(5)?,
            end_time: row.get(6)?,
            deck: row.get(7)?,
            played: row.get::<_, i64>(8)? != 0,
            device: row.get(9)?,
            app_name: row.get(10)?,
        })
    })?;
    rows.collect()
}
