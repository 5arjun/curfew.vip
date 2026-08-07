//! Local SQLite store (Story 2.8, AR-3): durable parse + offline cache + raw
//! retention for captured sessions, authoritative for a set until it syncs
//! (Story 3.2 owns the sync-queue that eventually reads these rows).
//!
//! Owns a single SQLite database file distinct from any Serato-owned database
//! (`local.sqlite`, under Tauri's per-machine `app_local_data_dir`). This is the
//! first module in this crate to open a SQLite connection the agent itself
//! writes to — every other `rusqlite` use ([`crate::joiner::serato4`]) is
//! read-only against a Serato-owned file.
//!
//! **Dedup is the schema's job, not the caller's.** `session_identity` carries a
//! `UNIQUE` constraint; every write goes through SQLite's native
//! `INSERT ... ON CONFLICT DO UPDATE` (AC-3) rather than a check-then-insert
//! race — a re-detected/re-parsed session updates the existing row's content
//! columns in place, mirroring AD-4's "re-parse updates content, never
//! re-partitions" philosophy applied locally, ahead of Story 3.2 applying the
//! same philosophy to the cloud row.
//!
//! **DTOs, not the pipeline's own types.** [`CapturedPlay`]/[`CapturedDerived`]
//! are this store's own `Serialize`/`Deserialize` shapes, built *from*
//! [`crate::stats::EnrichedPlay`]/[`crate::confidence::SessionConfidence`] by
//! [`crate::capture`] — never added as derives to those pipeline types, which
//! belong to Stories 1.6-1.8 and are exercised by their own unit tests in their
//! own shapes. A local DTO layer keeps the persisted format free to diverge
//! from in-memory computation types as either evolves.

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{AppHandle, Manager};

const STORE_FILE_NAME: &str = "local.sqlite";

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS captured_sessions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  session_identity  TEXT NOT NULL UNIQUE,
  source            TEXT NOT NULL,        -- 'legacy' | 'serato4'
  status            TEXT NOT NULL,        -- 'watching' | 'captured' | 'incomplete' | 'superseded'
  raw_ref           TEXT NOT NULL,        -- legacy: absolute .session path; serato4: "<db_path>#<serato_session_id>"
  started_at        INTEGER,              -- unix epoch seconds, first known play start_time
  ended_at          INTEGER,              -- unix epoch seconds, last known play start_time
  captured_at       INTEGER,              -- agent wall-clock time this row reached 'captured'
  plays_json        TEXT,                 -- serialized Vec<CapturedPlay>, NULL until captured
  derived_json      TEXT,                 -- serialized CapturedDerived (stats + confidence), NULL until captured
  synced_at         INTEGER               -- NULL forever in this story; Story 3.2 owns setting it
);

-- Story 3.4, Task 2: local parse-failure ledger (AR-7 layers 2+3). An
-- additive new table, not an `ALTER TABLE` on `captured_sessions` -- no
-- precedent in this codebase for adding a column to an existing local
-- SQLite file across DJ machines already running an older schema;
-- `CREATE TABLE IF NOT EXISTS` sidesteps that entirely, same reasoning
-- Story 3.3b used for `SessionStatus::Superseded`. No "resolved" status
-- column: a resolved failure is deleted (see `clear_parse_failure`), not
-- flagged.
CREATE TABLE IF NOT EXISTS parse_failures (
  session_identity     TEXT PRIMARY KEY,
  source                TEXT NOT NULL,        -- 'legacy' | 'serato4'
  raw_ref               TEXT NOT NULL,
  failed_agent_version  TEXT NOT NULL,
  failed_at             INTEGER NOT NULL,      -- unix epoch seconds, agent wall-clock
  last_error            TEXT NOT NULL
);

-- Story 4.2, Task 1 (D-1/D-2/D-3): every library track this agent has ever
-- seen, keyed by the opaque `fnv1a_hex` track identity (`capture::track_id`)
-- -- never the raw path, which stays local by the same privacy posture that
-- keeps `EnrichedPlay.path` off the wire. A new table rather than an
-- `ALTER TABLE`, same `CREATE TABLE IF NOT EXISTS` reasoning as
-- `parse_failures` above.
--
-- `is_baseline = 1` marks the first-run silent snapshot (D-1): those rows
-- record what was ALREADY in the library when Curfew first looked, and are
-- never emitted as add-events -- otherwise a DJ's entire back-catalogue would
-- flood month one and break the same go-forward frame Decision B set for
-- plays. Only a track first seen on a LATER scan is a real add.
--
-- `synced_at` mirrors `captured_sessions`'s own pending-sync convention (AD-5:
-- the queue is a NULL column, not a second table), so Task 4's drain reuses
-- Story 3.3's loop rather than adding a parallel queue mechanism.
CREATE TABLE IF NOT EXISTS library_tracks (
  track_id               TEXT PRIMARY KEY,      -- fnv1a_hex of the portable path (D-2)
  first_seen_locally_at  INTEGER NOT NULL,      -- unix epoch seconds, agent wall-clock
  added_at               INTEGER,               -- library tadd/uadd epoch seconds; NULL = unresolvable, never guessed
  is_baseline            INTEGER NOT NULL,      -- 1 = first-run snapshot, never synced (D-1)
  synced_at              INTEGER                -- NULL until the add-event batch syncs (Task 4)
);
"#;

/// Everything that can go wrong opening or writing to the local store. Mirrors
/// the `Display`/`std::error::Error`, small-enum idiom used throughout this
/// crate (`SettingsError`, `ParseError`, `JoinError`, `ScopeError`, `OpenError`)
/// — no `anyhow`/`thiserror`.
#[derive(Debug)]
pub enum StoreError {
    Io(std::io::Error),
    Sqlite(rusqlite::Error),
    /// Could not resolve Tauri's per-machine app-local-data directory.
    NoAppDataDir,
    Json(serde_json::Error),
    /// A row held a `source`/`status` string this module never wrote — data
    /// corruption from outside this store, not a reachable outcome of any
    /// write path this module exposes.
    Corrupt(String),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::Io(e) => write!(f, "local store I/O error: {e}"),
            StoreError::Sqlite(e) => write!(f, "local store SQLite error: {e}"),
            StoreError::NoAppDataDir => write!(f, "could not resolve app local data directory"),
            StoreError::Json(e) => write!(f, "local store JSON error: {e}"),
            StoreError::Corrupt(s) => write!(f, "local store row is corrupt: {s}"),
        }
    }
}

impl std::error::Error for StoreError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            StoreError::Io(e) => Some(e),
            StoreError::Sqlite(e) => Some(e),
            StoreError::Json(e) => Some(e),
            StoreError::NoAppDataDir | StoreError::Corrupt(_) => None,
        }
    }
}

impl From<rusqlite::Error> for StoreError {
    fn from(e: rusqlite::Error) -> Self {
        StoreError::Sqlite(e)
    }
}

/// Which play-log format a captured session came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionSource {
    Legacy,
    Serato4,
}

impl SessionSource {
    fn as_str(self) -> &'static str {
        match self {
            SessionSource::Legacy => "legacy",
            SessionSource::Serato4 => "serato4",
        }
    }

    fn parse(s: &str) -> Option<Self> {
        match s {
            "legacy" => Some(SessionSource::Legacy),
            "serato4" => Some(SessionSource::Serato4),
            _ => None,
        }
    }
}

/// A captured session's lifecycle state (AC-4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionStatus {
    /// Detected but not yet complete — the pending state a session sits in
    /// while the completion signal (Serato4 `end_time`, legacy quiet period)
    /// has not yet resolved.
    Watching,
    /// The full pipeline ran and the row carries plays + derived stats.
    Captured,
    /// The source disconnected while still `Watching` — resumes to `Captured`
    /// if the completion signal resolves on reconnect, otherwise stays flagged
    /// here rather than left ambiguously `Watching` forever.
    Incomplete,
    /// Story 3.3b, AC-2: a real capture whose night was already captured by
    /// the higher-precedence Serato 4+ source (or, on the rarer reverse
    /// arrival order, a legacy row a later serato4 capture superseded).
    /// Excluded from [`rows_pending_sync`] automatically — that query's
    /// `status = 'captured'` filter already excludes anything not exactly
    /// `Captured`. Kept in the local store rather than deleted, so a
    /// superseded row stays visible for debugging (Story 3.3's review
    /// precedent for keeping a stuck set visible, `TrayState::Failed`, rather
    /// than reusing an existing "nothing to see" state).
    Superseded,
}

impl SessionStatus {
    fn as_str(self) -> &'static str {
        match self {
            SessionStatus::Watching => "watching",
            SessionStatus::Captured => "captured",
            SessionStatus::Incomplete => "incomplete",
            SessionStatus::Superseded => "superseded",
        }
    }

    fn parse(s: &str) -> Option<Self> {
        match s {
            "watching" => Some(SessionStatus::Watching),
            "captured" => Some(SessionStatus::Captured),
            "incomplete" => Some(SessionStatus::Incomplete),
            "superseded" => Some(SessionStatus::Superseded),
            _ => None,
        }
    }
}

/// One `captured_sessions` row, read back. `plays_json`/`derived_json` are kept
/// as their raw serialized text rather than deserialized here — no caller in
/// this story needs the parsed content back (that is Story 3.2's job), and
/// keeping this API narrow avoids committing to a read-side shape this story
/// does not need.
#[derive(Debug, Clone, PartialEq)]
pub struct CapturedSessionRow {
    pub id: i64,
    pub session_identity: String,
    pub source: SessionSource,
    pub status: SessionStatus,
    pub raw_ref: String,
    pub started_at: Option<i64>,
    pub ended_at: Option<i64>,
    pub captured_at: Option<i64>,
    pub plays_json: Option<String>,
    pub derived_json: Option<String>,
    pub synced_at: Option<i64>,
}

fn row_from(row: &rusqlite::Row) -> rusqlite::Result<CapturedSessionRow> {
    let source_raw: String = row.get("source")?;
    let status_raw: String = row.get("status")?;
    Ok(CapturedSessionRow {
        id: row.get("id")?,
        session_identity: row.get("session_identity")?,
        source: SessionSource::parse(&source_raw).ok_or_else(|| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                format!("unknown source {source_raw:?}").into(),
            )
        })?,
        status: SessionStatus::parse(&status_raw).ok_or_else(|| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                format!("unknown status {status_raw:?}").into(),
            )
        })?,
        raw_ref: row.get("raw_ref")?,
        started_at: row.get("started_at")?,
        ended_at: row.get("ended_at")?,
        captured_at: row.get("captured_at")?,
        plays_json: row.get("plays_json")?,
        derived_json: row.get("derived_json")?,
        synced_at: row.get("synced_at")?,
    })
}

/// Opens the local store at `path`, creating parent directories and the schema
/// (via `CREATE TABLE IF NOT EXISTS` — no external migration tooling, unlike
/// Supabase's migration-file convention, since this is a single-owner local
/// file) if either does not exist yet. Split from [`open`] so it is testable
/// against a temp file without a running Tauri app, mirroring `settings.rs`'s
/// `load_from`/`save_to` split.
pub fn open_at(path: &Path) -> Result<Connection, StoreError> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(parent).map_err(StoreError::Io)?;
    let conn = Connection::open(path)?;
    // Story 3.3: a second connection to this same file is now a live
    // possibility, not hypothetical -- the offline-sync-queue drain loop
    // opens its own `Connection`, alongside `watch_loop`'s long-lived one.
    // `busy_timeout` makes a brief write collision wait instead of failing
    // outright with `SQLITE_BUSY`; WAL lets a reader and a writer proceed
    // concurrently rather than blocking each other for the whole transaction.
    // Best-effort: if the filesystem doesn't support setting these (e.g. an
    // unusual mount), the store must still open and work under SQLite's
    // rollback-journal default rather than fail outright -- this pragma call
    // didn't exist before this story, so it must not become a new way for
    // `open_at` (and everything that depends on it, capture included) to
    // fail.
    if let Err(_e) = conn.execute_batch("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;") {
        #[cfg(debug_assertions)]
        eprintln!(
            "curfew-agent: could not set busy_timeout/WAL pragmas, continuing without them: {_e}"
        );
    }
    conn.execute_batch(SCHEMA_SQL)?;
    Ok(conn)
}

/// Opens the local store at its real, per-machine location
/// (`app_local_data_dir()/local.sqlite`, Tauri 2's non-roaming per-machine data
/// dir — mirrors `settings.rs`'s `NoAppConfigDir`-style error variant and
/// `create_dir_all` idiom).
pub fn open(app: &AppHandle) -> Result<Connection, StoreError> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| StoreError::NoAppDataDir)?;
    open_at(&dir.join(STORE_FILE_NAME))
}

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Registers a session as seen-but-not-yet-complete (Task 4/6). Called once, on
/// first detection — durable across an agent restart, since the pending
/// serato4-id/legacy-quiet-period trackers the watch loop keeps in memory are
/// reloadable from `status = 'watching'` rows via [`rows_with_status`].
///
/// Idempotent and non-regressive: re-registering an already-`captured` session
/// (should not happen in practice, since the watch loop only calls this before
/// capture) leaves its status untouched rather than downgrading a finished
/// capture back to pending.
pub fn upsert_watching(
    conn: &Connection,
    session_identity: &str,
    source: SessionSource,
    raw_ref: &str,
    started_at: Option<i64>,
) -> Result<(), StoreError> {
    conn.execute(
        r#"INSERT INTO captured_sessions (session_identity, source, status, raw_ref, started_at)
           VALUES (?1, ?2, 'watching', ?3, ?4)
           ON CONFLICT(session_identity) DO UPDATE SET
             status = 'watching',
             raw_ref = excluded.raw_ref,
             started_at = COALESCE(captured_sessions.started_at, excluded.started_at)
           WHERE captured_sessions.status != 'captured'"#,
        rusqlite::params![session_identity, source.as_str(), raw_ref, started_at],
    )?;
    Ok(())
}

/// Writes (or updates in place, AC-3) a session's full captured content: the
/// parsed + enriched plays and derived stats/confidence, plus the session's
/// time bounds. Marks the row `status = 'captured'` regardless of what it was
/// before — this is the terminal state for this story (a re-parse of an
/// already-captured session, or the promotion of a resumed `incomplete` one,
/// both land here the same way).
#[allow(clippy::too_many_arguments)]
pub fn upsert_captured(
    conn: &Connection,
    session_identity: &str,
    source: SessionSource,
    raw_ref: &str,
    started_at: Option<i64>,
    ended_at: Option<i64>,
    plays: &[CapturedPlay],
    derived: &CapturedDerived,
) -> Result<(), StoreError> {
    let plays_json = serde_json::to_string(plays).map_err(StoreError::Json)?;
    let derived_json = serde_json::to_string(derived).map_err(StoreError::Json)?;
    let captured_at = now_unix();

    conn.execute(
        r#"INSERT INTO captured_sessions
             (session_identity, source, status, raw_ref, started_at, ended_at, captured_at, plays_json, derived_json)
           VALUES (?1, ?2, 'captured', ?3, ?4, ?5, ?6, ?7, ?8)
           ON CONFLICT(session_identity) DO UPDATE SET
             source = excluded.source,
             status = 'captured',
             raw_ref = excluded.raw_ref,
             started_at = excluded.started_at,
             ended_at = excluded.ended_at,
             captured_at = excluded.captured_at,
             plays_json = excluded.plays_json,
             derived_json = excluded.derived_json"#,
        rusqlite::params![
            session_identity,
            source.as_str(),
            raw_ref,
            started_at,
            ended_at,
            captured_at,
            plays_json,
            derived_json,
        ],
    )?;
    Ok(())
}

/// Flags a `watching` session `incomplete` (AC-4): the source disconnected
/// before the completion signal resolved. A no-op (not an error) for a session
/// that is not currently `watching` — e.g. already `captured`, or already
/// `incomplete` — so callers can call this unconditionally on a disconnect
/// transition without first checking status themselves.
pub fn mark_incomplete(conn: &Connection, session_identity: &str) -> Result<(), StoreError> {
    conn.execute(
        "UPDATE captured_sessions SET status = 'incomplete' WHERE session_identity = ?1 AND status = 'watching'",
        [session_identity],
    )?;
    Ok(())
}

/// Marks a `captured` row `superseded` (Story 3.3b, AC-2): the capture-time
/// "Serato 4 wins" dedup guard's terminal outcome for the losing side of a
/// same-night duplicate. Scoped to `status = 'captured'` only, mirroring
/// [`mark_incomplete`]'s no-op-on-mismatch idiom — a no-op (not an error) if
/// the row is not currently `captured`.
pub fn mark_superseded(conn: &Connection, session_identity: &str) -> Result<(), StoreError> {
    conn.execute(
        "UPDATE captured_sessions SET status = 'superseded' WHERE session_identity = ?1 AND status = 'captured'",
        [session_identity],
    )?;
    Ok(())
}

/// Clears `synced_at` on a `captured` row so the sync-queue drain loop
/// ([`rows_pending_sync`] selects `status = 'captured' AND synced_at IS NULL`)
/// picks it up again and re-pushes it to the cloud. Used by the Story 3.6
/// captured-set backfill when a re-derivation actually *changed* a row's derived
/// data (e.g. the Camelot key recovery): the cloud copy must be corrected too, so
/// the dashboard reads the same on every device (Arjun 2026-08-02). Idempotent
/// via the set's `external_id` on the cloud side (Story 3.2), so a re-sync
/// updates the existing cloud row rather than duplicating it. A no-op (not an
/// error) if the row is not currently `captured`.
pub fn mark_for_resync(conn: &Connection, session_identity: &str) -> Result<(), StoreError> {
    conn.execute(
        "UPDATE captured_sessions SET synced_at = NULL WHERE session_identity = ?1 AND status = 'captured'",
        [session_identity],
    )?;
    Ok(())
}

/// Reads one row by its dedup key, if it exists.
pub fn get_by_identity(
    conn: &Connection,
    session_identity: &str,
) -> Result<Option<CapturedSessionRow>, StoreError> {
    conn.query_row(
        "SELECT * FROM captured_sessions WHERE session_identity = ?1",
        [session_identity],
        row_from,
    )
    .optional()
    .map_err(StoreError::from)
}

/// The status of one session, if a row exists for it — the narrow read Task
/// 4/6's pending-session bookkeeping needs without pulling a whole row.
pub fn status_of(
    conn: &Connection,
    session_identity: &str,
) -> Result<Option<SessionStatus>, StoreError> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT status FROM captured_sessions WHERE session_identity = ?1",
            [session_identity],
            |row| row.get(0),
        )
        .optional()?;
    raw.map(|s| SessionStatus::parse(&s).ok_or(StoreError::Corrupt(s)))
        .transpose()
}

/// Every row currently in `status` — the durable-across-restart reload Task 4
/// depends on: the watch loop's in-memory pending-serato4-id set and
/// last-seen-mtime map are both reloadable from `'watching'` rows on
/// [`open`]/[`open_at`], and its incomplete/resume logic re-attempts the
/// completion check for every `'incomplete'` row on a reconnect.
pub fn rows_with_status(
    conn: &Connection,
    status: SessionStatus,
) -> Result<Vec<CapturedSessionRow>, StoreError> {
    let mut stmt = conn.prepare("SELECT * FROM captured_sessions WHERE status = ?1")?;
    let rows = stmt.query_map([status.as_str()], row_from)?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(StoreError::from)
}

/// Every `captured_sessions` row eligible for a sync attempt (Story 3.2, Task
/// 3's read source): `status = 'captured' AND synced_at IS NULL`. A row that
/// already synced, or is still `watching`/`incomplete`, never appears here.
pub fn rows_pending_sync(conn: &Connection) -> Result<Vec<CapturedSessionRow>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT * FROM captured_sessions WHERE status = 'captured' AND synced_at IS NULL",
    )?;
    let rows = stmt.query_map([], row_from)?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(StoreError::from)
}

/// Candidate rows for the capture-time "Serato 4 wins" dedup guard (Story
/// 3.3b, AC-2): every `status = 'captured'` row of `source` whose time bounds
/// overlap `(started_at, ended_at)` per [`crate::capture::same_night`]'s
/// tolerance, checked in Rust rather than embedded as arithmetic in the SQL
/// `WHERE` clause. Only rows with **both** bounds set are ever candidates —
/// a `NULL` bound can never be proven to overlap, and the dedup guard's own
/// fail-open principle says an unprovable overlap must not suppress a
/// capture (see the caller in `watcher::mod`, `capture_and_store_legacy`/
/// `_serato4`).
pub fn overlapping_captured(
    conn: &Connection,
    source: SessionSource,
    started_at: i64,
    ended_at: i64,
) -> Result<Vec<CapturedSessionRow>, StoreError> {
    let mut stmt =
        conn.prepare("SELECT * FROM captured_sessions WHERE source = ?1 AND status = 'captured'")?;
    let rows = stmt.query_map([source.as_str()], row_from)?;
    let candidates = rows
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(StoreError::from)?;
    Ok(candidates
        .into_iter()
        .filter(|row| match (row.started_at, row.ended_at) {
            (Some(s), Some(e)) => crate::capture::same_night((started_at, ended_at), (s, e)),
            _ => false,
        })
        .collect())
}

/// Stamps a row's `synced_at` (Story 3.2 Task 3, the column `store.rs`'s own
/// schema doc comment reserved for this story to set) after a successful
/// `sync_set` RPC call. A no-op if `session_identity` does not match any row
/// — callers only ever pass an identity just read from [`rows_pending_sync`],
/// so this should not be reachable in practice.
pub fn mark_synced(
    conn: &Connection,
    session_identity: &str,
    synced_at: i64,
) -> Result<(), StoreError> {
    conn.execute(
        "UPDATE captured_sessions SET synced_at = ?1 WHERE session_identity = ?2",
        rusqlite::params![synced_at, session_identity],
    )?;
    Ok(())
}

// ---- Parse-failure ledger (Story 3.4, Task 2) ------------------------------

/// One `parse_failures` row, read back.
#[derive(Debug, Clone, PartialEq)]
pub struct ParseFailureRow {
    pub session_identity: String,
    pub source: SessionSource,
    pub raw_ref: String,
    pub failed_agent_version: String,
    pub failed_at: i64,
    pub last_error: String,
}

fn parse_failure_row_from(row: &rusqlite::Row) -> rusqlite::Result<ParseFailureRow> {
    let source_raw: String = row.get("source")?;
    Ok(ParseFailureRow {
        session_identity: row.get("session_identity")?,
        source: SessionSource::parse(&source_raw).ok_or_else(|| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                format!("unknown source {source_raw:?}").into(),
            )
        })?,
        raw_ref: row.get("raw_ref")?,
        failed_agent_version: row.get("failed_agent_version")?,
        failed_at: row.get("failed_at")?,
        last_error: row.get("last_error")?,
    })
}

/// Records (or updates in place) a terminal capture failure. A session can
/// fail more than once across restarts/backfill attempts — each failure
/// overwrites the row with the latest attempt's info; this ledger does not
/// accumulate a history of past failures.
pub fn record_parse_failure(
    conn: &Connection,
    session_identity: &str,
    source: SessionSource,
    raw_ref: &str,
    agent_version: &str,
    error_message: &str,
) -> Result<(), StoreError> {
    conn.execute(
        r#"INSERT INTO parse_failures
             (session_identity, source, raw_ref, failed_agent_version, failed_at, last_error)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)
           ON CONFLICT(session_identity) DO UPDATE SET
             source = excluded.source,
             raw_ref = excluded.raw_ref,
             failed_agent_version = excluded.failed_agent_version,
             failed_at = excluded.failed_at,
             last_error = excluded.last_error"#,
        rusqlite::params![
            session_identity,
            source.as_str(),
            raw_ref,
            agent_version,
            now_unix(),
            error_message,
        ],
    )?;
    Ok(())
}

/// Every row currently in the ledger, no filter — there is no "resolved"
/// status to filter on (see `parse_failures`' schema doc comment above).
/// A single row that fails to parse (e.g. an unrecognized `source` value)
/// is skipped rather than failing the whole read — one corrupt row must not
/// silently no-op the entire backfill sweep for every other session (Story
/// 3.4 review).
#[cfg_attr(not(debug_assertions), allow(clippy::manual_ok_err))]
pub fn unresolved_parse_failures(conn: &Connection) -> Result<Vec<ParseFailureRow>, StoreError> {
    let mut stmt = conn.prepare("SELECT * FROM parse_failures")?;
    let rows = stmt.query_map([], parse_failure_row_from)?;
    Ok(rows
        .filter_map(|r| match r {
            Ok(row) => Some(row),
            Err(_e) => {
                #[cfg(debug_assertions)]
                eprintln!("curfew-agent: skipping unreadable parse_failures row: {_e}");
                None
            }
        })
        .collect())
}

/// The tray-precedence signal `sync_queue.rs`'s `desired_tray_state` reads
/// (Task 4): whether any format-drift failure is currently unresolved.
pub fn has_unresolved_parse_failures(conn: &Connection) -> Result<bool, StoreError> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM parse_failures LIMIT 1)",
        [],
        |row| row.get::<_, bool>(0),
    )?)
}

/// Like [`has_unresolved_parse_failures`], but only counts rows whose
/// `source` is still present in the given `WatchPlan` — an orphaned row
/// (its source no longer configured/detected, e.g. a retired legacy
/// library) must not indefinitely pin the tray on `FormatDriftPaused`,
/// masking a real, unrelated backlog underneath it (Story 3.4 review,
/// decision 2). The row itself stays in the ledger either way — only this
/// tray-facing signal is scoped to what's currently reachable.
pub fn has_unresolved_parse_failures_for_plan(
    conn: &Connection,
    plan: &crate::watcher::detect::WatchPlan,
) -> Result<bool, StoreError> {
    let rows = unresolved_parse_failures(conn)?;
    Ok(rows.iter().any(|row| match row.source {
        SessionSource::Serato4 => plan.serato4.is_some(),
        SessionSource::Legacy => plan.legacy.is_some(),
    }))
}

/// Removes a row once a reprocess attempt (Task 3) succeeds. A no-op (not an
/// error) if `session_identity` does not match any row.
pub fn clear_parse_failure(conn: &Connection, session_identity: &str) -> Result<(), StoreError> {
    conn.execute(
        "DELETE FROM parse_failures WHERE session_identity = ?1",
        [session_identity],
    )?;
    Ok(())
}

/// Whether any session is currently mid-capture (`Watching` status) — the
/// updater loop's restart-safety check (Story 3.4 review, decision 1): a DJ
/// set the agent hasn't yet reached quiet-period on must not be interrupted
/// by an auto-update restart. Fails open to `false` on a store read error,
/// the same convention `has_unresolved_parse_failures`'s callers already
/// follow — a store hiccup must not block an update from ever installing.
pub fn has_active_capture(conn: &Connection) -> bool {
    rows_with_status(conn, SessionStatus::Watching)
        .map(|rows| !rows.is_empty())
        .unwrap_or(false)
}

// ---- Local capture DTOs (Task 3) -------------------------------------------
//
// Store-owned, `Serialize`/`Deserialize` shapes built *from* the pipeline's
// output types (`stats::EnrichedPlay`, `joiner::JoinedMetadata.in_library`,
// `confidence::SessionConfidence`) by `crate::capture` — never added as
// derives to those types themselves. Field groupings mirror
// `shared/src/index.ts`'s `SyncPlay`/`SyncSetDerived` closely (Story 3.2 will
// eventually read these local rows to build the real wire payload, so keeping
// the shapes close now saves that story a translation step later) without
// importing anything from `shared/` — this is a parallel, independently
// defined Rust DTO, not a shared type.

/// One captured play: the `EnrichedPlay` fields plus `in_library` (from the
/// paired `JoinedMetadata`, which `EnrichedPlay` itself does not carry — the
/// gap `deferred-work.md` flagged from Story 1.10).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CapturedPlay {
    /// 1-based ordinal position within the set — mirrors `SyncPlay.position`.
    pub position: usize,
    pub title: Option<String>,
    pub artist: Option<String>,
    /// Unix epoch seconds, from `EnrichedPlay.start_time`.
    pub started_at: Option<u32>,
    pub bpm: Option<f64>,
    pub genre: Option<CapturedGenre>,
    /// Camelot notation string (e.g. `"8A"`), rendered from
    /// `EnrichedPlay.camelot: Option<CamelotKey>` — a string on the wire/store
    /// boundary, not the two-field Rust struct.
    pub camelot_key: Option<String>,
    pub in_library: bool,
    /// Real on-air duration in milliseconds (Story 3.7, wire-promoted —
    /// mirrors `SyncPlay.played_ms`). `#[serde(default)]`: serde errors on a
    /// genuinely *missing* key for an `Option<T>` field (it only auto-`None`s
    /// a key present with an explicit `null`), so without it a pre-3.7 stored
    /// `plays_json` row — which never wrote this key at all — would fail to
    /// deserialize instead of round-tripping as `None`.
    #[serde(default)]
    pub played_ms: Option<u64>,
    /// Library date-added, Unix epoch seconds (Story 3.7, wire-promoted —
    /// mirrors `SyncPlay.library_added_at`; the epoch→ISO conversion is a
    /// payload-boundary concern, same as `started_at`). `#[serde(default)]`
    /// for the same pre-3.7-row round-trip reason as `played_ms` above.
    #[serde(default)]
    pub library_added_at: Option<i64>,
    /// Opaque `fnv1a_hex` track identity (Story 4.2, D-2 — mirrors
    /// `SyncPlay.track_id`), letting a play join back to its library add-event
    /// by identity instead of fragile title/artist matching. Hashed from the
    /// portable path; the raw path itself never reaches the store's wire DTO
    /// or the cloud. `None` when the play carries no portable path to hash.
    /// `#[serde(default)]` for the same pre-4.2-row round-trip reason as
    /// `played_ms`/`library_added_at` above.
    #[serde(default)]
    pub track_id: Option<String>,
}

/// Mirrors `EnrichedPlay.genre: Option<NormalizedGenre>` — raw + subgenre +
/// normalized parent + taxonomy version, carried verbatim (AD-12), never
/// collapsed to just `normalized`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CapturedGenre {
    pub raw: String,
    pub subgenre: String,
    pub normalized: String,
    pub taxonomy_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CapturedTrackCount {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub play_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CapturedArtistCount {
    pub artist: String,
    pub play_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CapturedGenreBucket {
    pub genre: String,
    pub play_count: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct CapturedGenreBreakdown {
    pub buckets: Vec<CapturedGenreBucket>,
    pub no_genre_count: usize,
}

/// Mirrors `stats::SubgenreBreakdown`'s per-bucket entry: subgenre + its parent
/// genre + play count.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CapturedSubgenreBucket {
    pub subgenre: String,
    pub genre: String,
    pub play_count: usize,
}

/// Mirrors `stats::SubgenreBreakdown`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct CapturedSubgenreBreakdown {
    pub buckets: Vec<CapturedSubgenreBucket>,
    pub no_genre_count: usize,
}

/// Mirrors `stats::BpmDistribution` — an empty distribution is `count: 0` with
/// all other fields `0.0`, never a missing/`NaN` value.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct CapturedBpmDistribution {
    pub count: usize,
    pub min: f64,
    pub max: f64,
    pub mean: f64,
    pub median: f64,
}

/// Mirrors `stats::camelot::CamelotMixingStats` — three raw counts, not a
/// pre-divided rate.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct CapturedCamelotMixingStats {
    pub compatible_transitions: usize,
    pub incompatible_transitions: usize,
    pub excluded_no_key: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CapturedEnergyPoint {
    pub started_at: u32,
    pub bpm: f64,
}

/// Mirrors `confidence::SessionConfidence`. Field names mirror it exactly,
/// except `confidence` -> `value` (same rename `shared/src/index.ts`'s
/// `SyncSetDerived.confidence` already applies, avoiding a `derived.confidence
/// .confidence` stutter).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CapturedConfidence {
    pub value: f64,
    pub track_count: usize,
    pub long_gap_count: usize,
}

/* ---- Library add-events (Story 4.2, Task 1/4) ----------------------------- */

/// One library track pending an add-event sync — the local-queue read Task 4's
/// drain pass consumes, mirroring [`rows_pending_sync`]'s shape for sets.
#[derive(Debug, Clone, PartialEq)]
pub struct PendingLibraryAddEvent {
    /// Opaque `fnv1a_hex` track identity (`capture::track_id`, D-2).
    pub track_id: String,
    /// Library date-added, unix epoch seconds. `None` when `tadd`/`uadd` was
    /// unreachable for this track — carried as absent, never guessed (AD-11).
    pub added_at: Option<i64>,
}

/// How many library tracks this agent has on file at all — the first-run test
/// (D-1). Zero means Curfew has never looked at this library, so the very next
/// scan is a silent baseline, not a month's worth of "newly added" tracks.
pub fn library_track_count(conn: &Connection) -> Result<i64, StoreError> {
    Ok(conn.query_row("SELECT COUNT(*) FROM library_tracks", [], |row| row.get(0))?)
}

/// Every track identity already on file, in whatever state — the diff's
/// left-hand side. A track here is never re-emitted as an add-event, however
/// it first arrived (baseline or a real add).
pub fn known_track_ids(conn: &Connection) -> Result<std::collections::HashSet<String>, StoreError> {
    let mut stmt = conn.prepare("SELECT track_id FROM library_tracks")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    rows.collect::<rusqlite::Result<std::collections::HashSet<_>>>()
        .map_err(StoreError::from)
}

/// When the first-run baseline (D-1) was taken, or `None` if it never was.
///
/// Used to keep D-1's promise honest against a *second* shape of the same trap:
/// a volume that was unmounted at baseline time and mounts later would
/// otherwise present its entire contents as brand-new adds. A track whose own
/// `tadd`/`uadd` predates this timestamp demonstrably existed before Curfew
/// first looked, so it seeds silently too (see `capture::scan_library_adds`).
pub fn library_baseline_at(conn: &Connection) -> Result<Option<i64>, StoreError> {
    Ok(conn.query_row(
        "SELECT MIN(first_seen_locally_at) FROM library_tracks WHERE is_baseline = 1",
        [],
        |row| row.get::<_, Option<i64>>(0),
    )?)
}

/// Records library tracks the agent has now seen.
///
/// `is_baseline` decides whether these are D-1 baseline rows (never synced) or
/// genuine go-forward adds (queued for Task 4's drain). `ON CONFLICT DO
/// NOTHING` on the `track_id` primary key is the whole re-emit guard: a track
/// already on file — in either state — is never recorded, never re-queued, and
/// never has its recorded `added_at` overwritten by a later scan that happened
/// to resolve it differently.
///
/// Returns how many rows were genuinely new.
pub fn record_library_tracks(
    conn: &Connection,
    tracks: &[(String, Option<i64>)],
    is_baseline: bool,
    first_seen_locally_at: i64,
) -> Result<usize, StoreError> {
    let mut inserted = 0;
    let mut stmt = conn.prepare(
        "INSERT INTO library_tracks (track_id, first_seen_locally_at, added_at, is_baseline, synced_at)
         VALUES (?1, ?2, ?3, ?4, NULL)
         ON CONFLICT(track_id) DO NOTHING",
    )?;
    for (track_id, added_at) in tracks {
        inserted += stmt.execute(rusqlite::params![
            track_id,
            first_seen_locally_at,
            added_at,
            i64::from(is_baseline),
        ])?;
    }
    Ok(inserted)
}

/// Every add-event eligible for a sync attempt: a genuine go-forward add
/// (`is_baseline = 0`) that has not synced yet. Baseline rows are structurally
/// unreachable from here — D-1's "zero add-events on first run" is enforced by
/// this `WHERE` clause, not by caller discipline.
pub fn library_add_events_pending_sync(
    conn: &Connection,
) -> Result<Vec<PendingLibraryAddEvent>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT track_id, added_at FROM library_tracks
         WHERE is_baseline = 0 AND synced_at IS NULL
         ORDER BY first_seen_locally_at ASC, track_id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(PendingLibraryAddEvent {
            track_id: row.get(0)?,
            added_at: row.get(1)?,
        })
    })?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(StoreError::from)
}

/// Stamps `synced_at` on a batch of add-events after the cloud accepted them.
/// Mirrors [`mark_synced`]'s role for sets; a `track_id` matching no row is a
/// no-op, same as there.
pub fn mark_library_add_events_synced(
    conn: &Connection,
    track_ids: &[String],
    synced_at: i64,
) -> Result<(), StoreError> {
    let mut stmt = conn.prepare("UPDATE library_tracks SET synced_at = ?1 WHERE track_id = ?2")?;
    for track_id in track_ids {
        stmt.execute(rusqlite::params![synced_at, track_id])?;
    }
    Ok(())
}

/// Mirrors `SyncSetDerived`'s shape — same field groupings (most-played
/// tracks/artists, genre breakdown, BPM distribution, Camelot mixing stats,
/// set length, track count, energy arc, confidence) sourced from
/// `stats::mod.rs`/`confidence.rs`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CapturedDerived {
    pub most_played_tracks: Vec<CapturedTrackCount>,
    pub most_played_artists: Vec<CapturedArtistCount>,
    pub genre_breakdown: CapturedGenreBreakdown,
    pub subgenre_breakdown: CapturedSubgenreBreakdown,
    pub bpm_distribution: CapturedBpmDistribution,
    pub camelot_mixing_stats: CapturedCamelotMixingStats,
    pub set_length_sec: Option<u32>,
    pub track_count: usize,
    pub energy_arc: Vec<CapturedEnergyPoint>,
    pub confidence: CapturedConfidence,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct TempStoreFile(std::path::PathBuf);

    impl TempStoreFile {
        fn new(tag: &str) -> Self {
            static COUNTER: AtomicUsize = AtomicUsize::new(0);
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "curfew_store_test_{tag}_{}_{n}.sqlite",
                std::process::id()
            ));
            Self(path)
        }
    }

    impl Drop for TempStoreFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    fn sample_derived() -> CapturedDerived {
        CapturedDerived {
            most_played_tracks: vec![CapturedTrackCount {
                title: Some("Track A".into()),
                artist: Some("Artist A".into()),
                play_count: 2,
            }],
            most_played_artists: vec![CapturedArtistCount {
                artist: "Artist A".into(),
                play_count: 2,
            }],
            genre_breakdown: CapturedGenreBreakdown {
                buckets: vec![CapturedGenreBucket {
                    genre: "House".into(),
                    play_count: 2,
                }],
                no_genre_count: 0,
            },
            subgenre_breakdown: CapturedSubgenreBreakdown {
                buckets: vec![CapturedSubgenreBucket {
                    subgenre: "Deep House".into(),
                    genre: "House".into(),
                    play_count: 2,
                }],
                no_genre_count: 0,
            },
            bpm_distribution: CapturedBpmDistribution {
                count: 2,
                min: 120.0,
                max: 128.0,
                mean: 124.0,
                median: 124.0,
            },
            camelot_mixing_stats: CapturedCamelotMixingStats {
                compatible_transitions: 1,
                incompatible_transitions: 0,
                excluded_no_key: 0,
            },
            set_length_sec: Some(600),
            track_count: 2,
            energy_arc: vec![CapturedEnergyPoint {
                started_at: 1_000,
                bpm: 120.0,
            }],
            confidence: CapturedConfidence {
                value: 1.0,
                track_count: 2,
                long_gap_count: 0,
            },
        }
    }

    fn sample_plays() -> Vec<CapturedPlay> {
        vec![CapturedPlay {
            position: 1,
            title: Some("Track A".into()),
            artist: Some("Artist A".into()),
            started_at: Some(1_000),
            bpm: Some(120.0),
            genre: Some(CapturedGenre {
                raw: "Deep House".into(),
                subgenre: "Deep House".into(),
                normalized: "House".into(),
                taxonomy_version: 1,
            }),
            camelot_key: Some("8A".into()),
            in_library: true,
            played_ms: Some(240_000),
            library_added_at: Some(1_644_628_114),
            track_id: Some("a1b2c3d4e5f60718".into()),
        }]
    }

    /// Story 3.7 code review: a pre-3.7 stored `plays_json` row never wrote
    /// the `played_ms`/`library_added_at` keys at all (not even as `null`) —
    /// this must still deserialize, with both fields absent, not error.
    #[test]
    fn captured_play_without_story_3_7_fields_round_trips_as_none() {
        let pre_3_7_json = r#"{
            "position": 1,
            "title": "Track A",
            "artist": "Artist A",
            "started_at": 1000,
            "bpm": 120.0,
            "genre": null,
            "camelot_key": "8A",
            "in_library": true
        }"#;

        let play: CapturedPlay =
            serde_json::from_str(pre_3_7_json).expect("pre-3.7 shape must still deserialize");

        assert_eq!(play.played_ms, None);
        assert_eq!(play.library_added_at, None);
    }

    /// Task 7: upsert-then-get round-trip — a captured row's content columns
    /// are readable back exactly as written.
    #[test]
    fn upsert_captured_then_get_round_trips() {
        let file = TempStoreFile::new("roundtrip");
        let conn = open_at(&file.0).expect("store opens");

        upsert_captured(
            &conn,
            "serato4:7",
            SessionSource::Serato4,
            "/path/to/master.sqlite#7",
            Some(1_000),
            Some(1_600),
            &sample_plays(),
            &sample_derived(),
        )
        .expect("upsert succeeds");

        let row = get_by_identity(&conn, "serato4:7")
            .expect("query succeeds")
            .expect("row exists");

        assert_eq!(row.session_identity, "serato4:7");
        assert_eq!(row.source, SessionSource::Serato4);
        assert_eq!(row.status, SessionStatus::Captured);
        assert_eq!(row.raw_ref, "/path/to/master.sqlite#7");
        assert_eq!(row.started_at, Some(1_000));
        assert_eq!(row.ended_at, Some(1_600));
        assert!(row.captured_at.is_some());
        assert!(
            row.synced_at.is_none(),
            "synced_at is never set by this story"
        );

        let plays: Vec<CapturedPlay> =
            serde_json::from_str(&row.plays_json.expect("plays_json present")).unwrap();
        assert_eq!(plays, sample_plays());
        let derived: CapturedDerived =
            serde_json::from_str(&row.derived_json.expect("derived_json present")).unwrap();
        assert_eq!(derived, sample_derived());
    }

    /// AC-3, directly: a repeated `session_identity` updates the existing row
    /// in place rather than duplicating it — the `UNIQUE`-constraint-driven
    /// upsert is the dedup mechanism.
    #[test]
    fn repeated_session_identity_updates_not_duplicates() {
        let file = TempStoreFile::new("dedup");
        let conn = open_at(&file.0).expect("store opens");

        upsert_captured(
            &conn,
            "legacy:abc",
            SessionSource::Legacy,
            "/sessions/one.session",
            Some(1_000),
            Some(1_500),
            &sample_plays(),
            &sample_derived(),
        )
        .expect("first upsert succeeds");

        let mut second_plays = sample_plays();
        second_plays.push(CapturedPlay {
            position: 2,
            title: Some("Track B".into()),
            artist: None,
            started_at: Some(1_500),
            bpm: Some(128.0),
            played_ms: None,
            library_added_at: None,
            genre: None,
            camelot_key: None,
            in_library: false,
            track_id: None,
        });
        upsert_captured(
            &conn,
            "legacy:abc",
            SessionSource::Legacy,
            "/sessions/one.session",
            Some(1_000),
            Some(2_000),
            &second_plays,
            &sample_derived(),
        )
        .expect("second upsert succeeds");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM captured_sessions WHERE session_identity = 'legacy:abc'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            count, 1,
            "re-detecting the same session must not duplicate it"
        );

        let row = get_by_identity(&conn, "legacy:abc").unwrap().unwrap();
        assert_eq!(row.ended_at, Some(2_000), "content updated in place");
        let plays: Vec<CapturedPlay> = serde_json::from_str(&row.plays_json.unwrap()).unwrap();
        assert_eq!(plays.len(), 2, "updated play list persisted");
    }

    /// AC-4: status transitions `watching` -> `captured`.
    #[test]
    fn watching_transitions_to_captured() {
        let file = TempStoreFile::new("watching-to-captured");
        let conn = open_at(&file.0).expect("store opens");

        upsert_watching(
            &conn,
            "serato4:9",
            SessionSource::Serato4,
            "/path/master.sqlite#9",
            Some(1_000),
        )
        .expect("upsert_watching succeeds");
        assert_eq!(
            status_of(&conn, "serato4:9").unwrap(),
            Some(SessionStatus::Watching)
        );

        upsert_captured(
            &conn,
            "serato4:9",
            SessionSource::Serato4,
            "/path/master.sqlite#9",
            Some(1_000),
            Some(1_500),
            &sample_plays(),
            &sample_derived(),
        )
        .expect("upsert_captured succeeds");

        assert_eq!(
            status_of(&conn, "serato4:9").unwrap(),
            Some(SessionStatus::Captured)
        );
    }

    /// AC-4: status transitions `watching` -> `incomplete` -> `captured`
    /// (the resume path).
    #[test]
    fn watching_to_incomplete_to_captured() {
        let file = TempStoreFile::new("incomplete-resume");
        let conn = open_at(&file.0).expect("store opens");

        upsert_watching(
            &conn,
            "legacy:xyz",
            SessionSource::Legacy,
            "/sessions/xyz.session",
            Some(1_000),
        )
        .unwrap();

        mark_incomplete(&conn, "legacy:xyz").unwrap();
        assert_eq!(
            status_of(&conn, "legacy:xyz").unwrap(),
            Some(SessionStatus::Incomplete)
        );

        // Resume: the completion signal resolves, promote straight to captured.
        upsert_captured(
            &conn,
            "legacy:xyz",
            SessionSource::Legacy,
            "/sessions/xyz.session",
            Some(1_000),
            Some(1_800),
            &sample_plays(),
            &sample_derived(),
        )
        .unwrap();

        assert_eq!(
            status_of(&conn, "legacy:xyz").unwrap(),
            Some(SessionStatus::Captured)
        );
    }

    /// AC-4: the real reconnect step — `upsert_watching` called against an
    /// `incomplete` row (mirroring `reregister_pending_as_watching`) must flip
    /// it back to `watching`, not leave it stuck. Regression test for a bug
    /// where the `ON CONFLICT` clause updated `raw_ref`/`started_at` but never
    /// `status`.
    #[test]
    fn upsert_watching_resumes_an_incomplete_row_to_watching() {
        let file = TempStoreFile::new("incomplete-resumes-to-watching");
        let conn = open_at(&file.0).expect("store opens");

        upsert_watching(
            &conn,
            "legacy:resume",
            SessionSource::Legacy,
            "/sessions/resume.session",
            Some(1_000),
        )
        .unwrap();
        mark_incomplete(&conn, "legacy:resume").unwrap();
        assert_eq!(
            status_of(&conn, "legacy:resume").unwrap(),
            Some(SessionStatus::Incomplete)
        );

        upsert_watching(
            &conn,
            "legacy:resume",
            SessionSource::Legacy,
            "/sessions/resume.session",
            Some(1_000),
        )
        .unwrap();

        assert_eq!(
            status_of(&conn, "legacy:resume").unwrap(),
            Some(SessionStatus::Watching),
            "reconnecting must resume an incomplete row back to watching"
        );
    }

    /// `mark_incomplete` only ever affects a `watching` row — calling it
    /// against an already-`captured` session is a no-op, never a regression.
    #[test]
    fn mark_incomplete_does_not_regress_a_captured_session() {
        let file = TempStoreFile::new("no-regress");
        let conn = open_at(&file.0).expect("store opens");

        upsert_captured(
            &conn,
            "serato4:1",
            SessionSource::Serato4,
            "/path/master.sqlite#1",
            Some(1_000),
            Some(1_500),
            &sample_plays(),
            &sample_derived(),
        )
        .unwrap();

        mark_incomplete(&conn, "serato4:1").unwrap();

        assert_eq!(
            status_of(&conn, "serato4:1").unwrap(),
            Some(SessionStatus::Captured),
            "a captured session must never be downgraded by a stray incomplete call"
        );
    }

    /// `upsert_watching` called again for an already-captured session must not
    /// downgrade it back to `watching`.
    #[test]
    fn upsert_watching_does_not_regress_a_captured_session() {
        let file = TempStoreFile::new("watching-no-regress");
        let conn = open_at(&file.0).expect("store opens");

        upsert_captured(
            &conn,
            "serato4:2",
            SessionSource::Serato4,
            "/path/master.sqlite#2",
            Some(1_000),
            Some(1_500),
            &sample_plays(),
            &sample_derived(),
        )
        .unwrap();

        upsert_watching(
            &conn,
            "serato4:2",
            SessionSource::Serato4,
            "/path/master.sqlite#2",
            Some(1_000),
        )
        .unwrap();

        assert_eq!(
            status_of(&conn, "serato4:2").unwrap(),
            Some(SessionStatus::Captured)
        );
    }

    #[test]
    fn status_of_unknown_identity_is_none() {
        let file = TempStoreFile::new("status-unknown");
        let conn = open_at(&file.0).expect("store opens");
        assert_eq!(status_of(&conn, "serato4:999").unwrap(), None);
    }

    #[test]
    fn get_by_identity_unknown_identity_is_none() {
        let file = TempStoreFile::new("get-unknown");
        let conn = open_at(&file.0).expect("store opens");
        assert_eq!(get_by_identity(&conn, "serato4:999").unwrap(), None);
    }

    /// `rows_with_status` is the durable-restart reload path (Task 4): every
    /// `watching` row is returned, and no `captured`/`incomplete` row leaks in.
    #[test]
    fn rows_with_status_filters_correctly() {
        let file = TempStoreFile::new("rows-with-status");
        let conn = open_at(&file.0).expect("store opens");

        upsert_watching(
            &conn,
            "serato4:10",
            SessionSource::Serato4,
            "/path/master.sqlite#10",
            Some(1_000),
        )
        .unwrap();
        upsert_watching(
            &conn,
            "legacy:aaa",
            SessionSource::Legacy,
            "/sessions/aaa.session",
            Some(2_000),
        )
        .unwrap();
        mark_incomplete(&conn, "legacy:aaa").unwrap();
        upsert_captured(
            &conn,
            "serato4:11",
            SessionSource::Serato4,
            "/path/master.sqlite#11",
            Some(3_000),
            Some(3_500),
            &sample_plays(),
            &sample_derived(),
        )
        .unwrap();

        let watching = rows_with_status(&conn, SessionStatus::Watching).unwrap();
        assert_eq!(watching.len(), 1);
        assert_eq!(watching[0].session_identity, "serato4:10");

        let incomplete = rows_with_status(&conn, SessionStatus::Incomplete).unwrap();
        assert_eq!(incomplete.len(), 1);
        assert_eq!(incomplete[0].session_identity, "legacy:aaa");

        let captured = rows_with_status(&conn, SessionStatus::Captured).unwrap();
        assert_eq!(captured.len(), 1);
        assert_eq!(captured[0].session_identity, "serato4:11");
    }

    /// Story 3.2 Task 3: `rows_pending_sync` returns only rows that are both
    /// `status = 'captured'` and still `synced_at IS NULL` — a `watching` row
    /// and an already-synced row both never leak in.
    #[test]
    fn rows_pending_sync_filters_to_captured_and_unsynced_only() {
        let file = TempStoreFile::new("pending-sync");
        let conn = open_at(&file.0).expect("store opens");

        upsert_watching(
            &conn,
            "serato4:30",
            SessionSource::Serato4,
            "/path/master.sqlite#30",
            Some(1_000),
        )
        .unwrap();
        upsert_captured(
            &conn,
            "serato4:31",
            SessionSource::Serato4,
            "/path/master.sqlite#31",
            Some(2_000),
            Some(2_500),
            &sample_plays(),
            &sample_derived(),
        )
        .unwrap();
        upsert_captured(
            &conn,
            "serato4:32",
            SessionSource::Serato4,
            "/path/master.sqlite#32",
            Some(3_000),
            Some(3_500),
            &sample_plays(),
            &sample_derived(),
        )
        .unwrap();
        mark_synced(&conn, "serato4:32", 9_999).unwrap();

        let pending = rows_pending_sync(&conn).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].session_identity, "serato4:31");
    }

    /// Story 3.3 AC-1: a session captured with zero connectivity is
    /// provably indistinguishable from any other row awaiting sync -- proves
    /// the offline queue *is* `captured_sessions.synced_at IS NULL` itself
    /// (AD-5), not a separate table this story never builds.
    /// `capture::build_serato4`/`build_legacy` (Story 2.8) call
    /// `upsert_captured` unconditionally; connectivity is never a parameter
    /// anywhere in that call chain, so "captured while offline" and
    /// "captured while online but not yet synced" are the same row shape.
    #[test]
    fn a_session_captured_while_offline_is_indistinguishable_from_any_pending_sync_row() {
        let file = TempStoreFile::new("offline-queue-ac1");
        let conn = open_at(&file.0).expect("store opens");

        upsert_captured(
            &conn,
            "legacy:offline-set",
            SessionSource::Legacy,
            "/sessions/offline.session",
            Some(1_000),
            Some(1_600),
            &sample_plays(),
            &sample_derived(),
        )
        .expect("upsert_captured has no connectivity parameter to gate on");

        let row = get_by_identity(&conn, "legacy:offline-set")
            .unwrap()
            .unwrap();
        assert_eq!(row.status, SessionStatus::Captured);
        assert!(
            row.synced_at.is_none(),
            "a captured-while-offline row has synced_at NULL -- it IS the queue (AD-5)"
        );

        let pending = rows_pending_sync(&conn).unwrap();
        assert_eq!(
            pending.len(),
            1,
            "the row is returned by the exact same rows_pending_sync query any other unsynced row uses"
        );
        assert_eq!(pending[0].session_identity, "legacy:offline-set");
    }

    /// `mark_synced` stamps the exact value passed and only that row.
    #[test]
    fn mark_synced_stamps_synced_at_on_the_matching_row_only() {
        let file = TempStoreFile::new("mark-synced");
        let conn = open_at(&file.0).expect("store opens");

        upsert_captured(
            &conn,
            "serato4:40",
            SessionSource::Serato4,
            "/path/master.sqlite#40",
            Some(1_000),
            Some(1_500),
            &sample_plays(),
            &sample_derived(),
        )
        .unwrap();
        upsert_captured(
            &conn,
            "serato4:41",
            SessionSource::Serato4,
            "/path/master.sqlite#41",
            Some(2_000),
            Some(2_500),
            &sample_plays(),
            &sample_derived(),
        )
        .unwrap();

        mark_synced(&conn, "serato4:40", 5_555).unwrap();

        assert_eq!(
            get_by_identity(&conn, "serato4:40")
                .unwrap()
                .unwrap()
                .synced_at,
            Some(5_555)
        );
        assert_eq!(
            get_by_identity(&conn, "serato4:41")
                .unwrap()
                .unwrap()
                .synced_at,
            None,
            "mark_synced must not touch an unrelated row"
        );
    }

    /// Opening the same file twice (mirrors a process restart) does not lose
    /// existing rows and does not error on the `CREATE TABLE IF NOT EXISTS`.
    #[test]
    fn reopening_the_same_store_file_preserves_rows() {
        let file = TempStoreFile::new("reopen");
        {
            let conn = open_at(&file.0).expect("first open succeeds");
            upsert_watching(
                &conn,
                "serato4:20",
                SessionSource::Serato4,
                "/path/master.sqlite#20",
                Some(1_000),
            )
            .unwrap();
        }
        let conn = open_at(&file.0).expect("second open succeeds");
        assert_eq!(
            status_of(&conn, "serato4:20").unwrap(),
            Some(SessionStatus::Watching)
        );
    }

    // ---- overlapping_captured / mark_superseded (Story 3.3b, AC-2) ---------

    /// The base case: a serato4 row overlapping the queried night is found.
    #[test]
    fn overlapping_captured_finds_an_overlapping_row_of_the_given_source() {
        let file = TempStoreFile::new("overlap-finds");
        let conn = open_at(&file.0).expect("store opens");

        upsert_captured(
            &conn,
            "serato4:50",
            SessionSource::Serato4,
            "/path/master.sqlite#50",
            Some(1_000),
            Some(5_000),
            &sample_plays(),
            &sample_derived(),
        )
        .unwrap();

        let found = overlapping_captured(&conn, SessionSource::Serato4, 4_000, 8_000).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].session_identity, "serato4:50");
    }

    #[test]
    fn overlapping_captured_excludes_a_clearly_disjoint_row() {
        let file = TempStoreFile::new("overlap-disjoint");
        let conn = open_at(&file.0).expect("store opens");

        upsert_captured(
            &conn,
            "serato4:51",
            SessionSource::Serato4,
            "/path/master.sqlite#51",
            Some(1_000),
            Some(2_000),
            &sample_plays(),
            &sample_derived(),
        )
        .unwrap();

        let found = overlapping_captured(&conn, SessionSource::Serato4, 50_000, 52_000).unwrap();
        assert!(found.is_empty());
    }

    /// Fail-open: a row with an unset bound can never be proven to overlap,
    /// so it must never be treated as a match.
    #[test]
    fn overlapping_captured_excludes_rows_with_unknown_bounds() {
        let file = TempStoreFile::new("overlap-unknown-bounds");
        let conn = open_at(&file.0).expect("store opens");

        upsert_captured(
            &conn,
            "serato4:52",
            SessionSource::Serato4,
            "/path/master.sqlite#52",
            None,
            None,
            &sample_plays(),
            &sample_derived(),
        )
        .unwrap();

        let found = overlapping_captured(&conn, SessionSource::Serato4, 1_000, 5_000).unwrap();
        assert!(found.is_empty());
    }

    #[test]
    fn overlapping_captured_excludes_a_different_source() {
        let file = TempStoreFile::new("overlap-different-source");
        let conn = open_at(&file.0).expect("store opens");

        upsert_captured(
            &conn,
            "legacy:53",
            SessionSource::Legacy,
            "/sessions/53.session",
            Some(1_000),
            Some(5_000),
            &sample_plays(),
            &sample_derived(),
        )
        .unwrap();

        let found = overlapping_captured(&conn, SessionSource::Serato4, 1_000, 5_000).unwrap();
        assert!(
            found.is_empty(),
            "a legacy row must never satisfy a serato4-source overlap query"
        );
    }

    #[test]
    fn overlapping_captured_excludes_non_captured_status_rows() {
        let file = TempStoreFile::new("overlap-non-captured");
        let conn = open_at(&file.0).expect("store opens");

        upsert_watching(
            &conn,
            "serato4:54",
            SessionSource::Serato4,
            "/path/master.sqlite#54",
            Some(1_000),
        )
        .unwrap();

        let found = overlapping_captured(&conn, SessionSource::Serato4, 1_000, 5_000).unwrap();
        assert!(
            found.is_empty(),
            "a watching row has no settled bounds to compare"
        );
    }

    #[test]
    fn mark_superseded_transitions_captured_to_superseded() {
        let file = TempStoreFile::new("mark-superseded");
        let conn = open_at(&file.0).expect("store opens");

        upsert_captured(
            &conn,
            "legacy:55",
            SessionSource::Legacy,
            "/sessions/55.session",
            Some(1_000),
            Some(1_500),
            &sample_plays(),
            &sample_derived(),
        )
        .unwrap();

        mark_superseded(&conn, "legacy:55").unwrap();

        assert_eq!(
            status_of(&conn, "legacy:55").unwrap(),
            Some(SessionStatus::Superseded)
        );
        // The row's content must survive the transition (DJ-visibility/
        // debugging, not a deletion).
        let row = get_by_identity(&conn, "legacy:55").unwrap().unwrap();
        assert!(row.plays_json.is_some());
    }

    #[test]
    fn mark_superseded_is_a_noop_for_a_non_captured_row() {
        let file = TempStoreFile::new("mark-superseded-noop");
        let conn = open_at(&file.0).expect("store opens");

        upsert_watching(
            &conn,
            "legacy:56",
            SessionSource::Legacy,
            "/sessions/56.session",
            Some(1_000),
        )
        .unwrap();

        mark_superseded(&conn, "legacy:56").unwrap();

        assert_eq!(
            status_of(&conn, "legacy:56").unwrap(),
            Some(SessionStatus::Watching),
            "mark_superseded must not touch a row that isn't captured"
        );
    }

    /// Task 3's own instruction: verify (rather than add a new filter) that
    /// `rows_pending_sync`'s existing `status = 'captured'` clause already
    /// excludes a superseded row automatically.
    #[test]
    fn rows_pending_sync_excludes_a_superseded_row_automatically() {
        let file = TempStoreFile::new("pending-sync-excludes-superseded");
        let conn = open_at(&file.0).expect("store opens");

        upsert_captured(
            &conn,
            "legacy:57",
            SessionSource::Legacy,
            "/sessions/57.session",
            Some(1_000),
            Some(1_500),
            &sample_plays(),
            &sample_derived(),
        )
        .unwrap();
        upsert_captured(
            &conn,
            "serato4:58",
            SessionSource::Serato4,
            "/path/master.sqlite#58",
            Some(2_000),
            Some(2_500),
            &sample_plays(),
            &sample_derived(),
        )
        .unwrap();
        mark_superseded(&conn, "legacy:57").unwrap();

        let pending = rows_pending_sync(&conn).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].session_identity, "serato4:58");
    }

    // ---- Parse-failure ledger (Story 3.4, Task 2/6) -------------------------

    #[test]
    fn record_parse_failure_then_unresolved_round_trips() {
        let file = TempStoreFile::new("parse-failure-roundtrip");
        let conn = open_at(&file.0).expect("store opens");

        record_parse_failure(
            &conn,
            "legacy:bad-file",
            SessionSource::Legacy,
            "/sessions/bad.session",
            "0.1.0",
            "unexpected EOF",
        )
        .unwrap();

        let rows = unresolved_parse_failures(&conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].session_identity, "legacy:bad-file");
        assert_eq!(rows[0].source, SessionSource::Legacy);
        assert_eq!(rows[0].raw_ref, "/sessions/bad.session");
        assert_eq!(rows[0].failed_agent_version, "0.1.0");
        assert_eq!(rows[0].last_error, "unexpected EOF");
    }

    #[test]
    fn a_second_record_parse_failure_for_the_same_identity_overwrites_not_duplicates() {
        let file = TempStoreFile::new("parse-failure-overwrite");
        let conn = open_at(&file.0).expect("store opens");

        record_parse_failure(
            &conn,
            "legacy:flaky",
            SessionSource::Legacy,
            "/sessions/flaky.session",
            "0.1.0",
            "first error",
        )
        .unwrap();
        record_parse_failure(
            &conn,
            "legacy:flaky",
            SessionSource::Legacy,
            "/sessions/flaky.session",
            "0.2.0",
            "second error",
        )
        .unwrap();

        let rows = unresolved_parse_failures(&conn).unwrap();
        assert_eq!(rows.len(), 1, "must overwrite, not accumulate history");
        assert_eq!(rows[0].failed_agent_version, "0.2.0");
        assert_eq!(rows[0].last_error, "second error");
    }

    #[test]
    fn has_unresolved_parse_failures_reflects_ledger_state() {
        let file = TempStoreFile::new("parse-failure-has-unresolved");
        let conn = open_at(&file.0).expect("store opens");

        assert!(!has_unresolved_parse_failures(&conn).unwrap());

        record_parse_failure(
            &conn,
            "serato4:99",
            SessionSource::Serato4,
            "/path/master.sqlite#99",
            "0.1.0",
            "corrupt row",
        )
        .unwrap();
        assert!(has_unresolved_parse_failures(&conn).unwrap());
    }

    #[test]
    fn clear_parse_failure_removes_the_row_and_flips_has_unresolved_back_to_false() {
        let file = TempStoreFile::new("parse-failure-clear");
        let conn = open_at(&file.0).expect("store opens");

        record_parse_failure(
            &conn,
            "legacy:cleared",
            SessionSource::Legacy,
            "/sessions/cleared.session",
            "0.1.0",
            "some error",
        )
        .unwrap();
        assert!(has_unresolved_parse_failures(&conn).unwrap());

        clear_parse_failure(&conn, "legacy:cleared").unwrap();

        assert!(!has_unresolved_parse_failures(&conn).unwrap());
        assert!(unresolved_parse_failures(&conn).unwrap().is_empty());
    }
}
