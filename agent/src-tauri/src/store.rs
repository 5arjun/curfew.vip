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
-- seen, keyed by the opaque `fnv1a_hex` track identity
-- (`capture::track_id_from_title_artist`, title+artist as of Story 4.3
-- Decision E-2) -- never the raw path, which stays local by the same privacy
-- posture that keeps `EnrichedPlay.path` off the wire. A new table rather than an
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
  track_id               TEXT PRIMARY KEY,      -- fnv1a_hex of normalized title+artist (Story 4.3, Decision E-2; was the portable path, D-2)
  first_seen_locally_at  INTEGER NOT NULL,      -- unix epoch seconds, agent wall-clock
  added_at               INTEGER,               -- library tadd/uadd epoch seconds; NULL = unresolvable, never guessed
  is_baseline            INTEGER NOT NULL,      -- 1 = first-run snapshot, never synced as an add-event (D-1)
  synced_at              INTEGER,               -- NULL until the add-event batch syncs (AD-21); scoped to that sync ONLY, see roster_synced_at
  title                  TEXT,                  -- Story 4.11 Tier A: raw, un-normalized (AC-1)
  artist                 TEXT,                  -- Story 4.11 Tier A: raw, un-normalized (AC-1)
  absent_at              INTEGER,               -- Story 4.11 AC-5: set when a previously-known track is missing from a scan, cleared if it reappears. Never a hard delete.
  roster_synced_at       INTEGER                -- Story 4.11 AC-2/AD-22: independent watermark from `synced_at` above -- the roster sync (this table's title/artist/added_at/is_baseline/absent_at) and the add-event batch sync are two different cloud writes to two different tables (this one and `library_track_events`), on two different cadences (roster re-syncs on every tag edit; add-events are baseline-excluded and first-write-wins). Conflating them into one `synced_at` column would make a title fix silently fail to reach the cloud whenever `synced_at` was already non-NULL from the (unrelated) add-event sync.
);

-- Story 4.3 review follow-up: a tiny opaque flag store for one-time,
-- go-forward migrations that `CREATE TABLE IF NOT EXISTS` alone can't express
-- (a *behavior* cutover, not a schema change). First use:
-- `IDENTITY_V2_MIGRATED_KEY` — an agent with pre-4.3 `library_tracks` rows
-- (keyed by the retired path-hash `track_id`) would otherwise have every
-- currently-catalogued track miss `known_track_ids` on its first post-upgrade
-- scan (none of the new title+artist hashes match the old rows), silently
-- re-emitting every track added since the ORIGINAL baseline as a fresh
-- add-event. This key lets `capture::scan_library_adds` recognize "identity
-- scheme just changed under me" and re-baseline once instead.
CREATE TABLE IF NOT EXISTS agent_meta (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
"#;

/// The one-time identity-scheme-cutover flag (Story 4.3 review). Set once
/// [`mark_identity_migration_done`] runs; checked by
/// `capture::scan_library_adds` before it trusts `known_track_ids` against a
/// possibly-pre-4.3 `library_tracks` table.
const IDENTITY_V2_MIGRATED_KEY: &str = "identity_v2_migrated";

/// Whether the title+artist identity cutover (Decision E-2) has already been
/// reconciled against whatever `library_tracks` rows this agent had on file
/// beforehand. `false` on a brand-new store too — harmless, since
/// `scan_library_adds`'s own `library_track_count == 0` check takes priority
/// for a genuinely first-ever scan.
pub fn identity_migration_done(conn: &Connection) -> Result<bool, StoreError> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM agent_meta WHERE key = ?1",
            [IDENTITY_V2_MIGRATED_KEY],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

/// Records that the title+artist identity cutover has been reconciled, so it
/// is never re-triggered on a later, ordinary scan.
pub fn mark_identity_migration_done(conn: &Connection) -> Result<(), StoreError> {
    conn.execute(
        "INSERT INTO agent_meta (key, value) VALUES (?1, '1') ON CONFLICT(key) DO NOTHING",
        [IDENTITY_V2_MIGRATED_KEY],
    )?;
    Ok(())
}

/// The serato4 discovery watermark — the highest `history_session.id` this
/// install has already seen (Decision A go-forward fix, 2026-08-17).
const SERATO4_WATERMARK_KEY: &str = "serato4_watermark";

/// Reads the persisted serato4 watermark. `None` means this install has never
/// resolved one, which is the signal to baseline at the library's current
/// newest session rather than at 0.
///
/// Persisted rather than held in memory for two independent reasons, both
/// real bugs before this existed: the in-memory watermark started at 0 on
/// every launch, so (a) a first launch swept the DJ's entire play history
/// into the cloud, violating Decision A, and (b) every *subsequent* launch
/// re-listed every session again, re-running capture over sets that were
/// already captured. A malformed stored value degrades to `None` — a fresh
/// baseline is a far safer failure than a re-import.
pub fn serato4_watermark(conn: &Connection) -> Result<Option<i64>, StoreError> {
    let stored: Option<String> = conn
        .query_row(
            "SELECT value FROM agent_meta WHERE key = ?1",
            [SERATO4_WATERMARK_KEY],
            |row| row.get(0),
        )
        .optional()?;
    Ok(stored.and_then(|v| v.parse::<i64>().ok()))
}

/// Advances (or first sets) the persisted serato4 watermark.
///
/// Monotonic on purpose — `MAX(existing, incoming)` in SQL, not a plain
/// overwrite. A watermark that could move backwards would re-open the exact
/// hole this key was added to close: one pass reading a temporarily
/// unreachable or partially-written library could otherwise reset the mark
/// and re-import everything above it on the next tick.
pub fn set_serato4_watermark(conn: &Connection, id: i64) -> Result<(), StoreError> {
    conn.execute(
        "INSERT INTO agent_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value =
           CAST(MAX(CAST(agent_meta.value AS INTEGER), CAST(excluded.value AS INTEGER)) AS TEXT)",
        rusqlite::params![SERATO4_WATERMARK_KEY, id.to_string()],
    )?;
    Ok(())
}

/// Story 4.11 AC-6: the no-identity exclusion count from the MOST RECENT scan,
/// plus the catalogue row count it was measured against. Reuses `agent_meta`
/// (the same tiny key-value store `IDENTITY_V2_MIGRATED_KEY` already
/// established) rather than a dedicated table — these are single scalars, not
/// per-track facts.
///
/// **A gauge, not a counter (Story 4.11 code review).** These are *replaced* on
/// every scan, never accumulated. `scan_library_adds` recomputes both from the
/// whole catalogue each time, so the same unidentifiable rows are re-counted on
/// every tick — summing them would read k×272 after k scans in a 930-track
/// library, an unbounded number that answers no question anyone asks. The
/// disclosure this feeds ("N tracks in your library have no artist tag") is a
/// point-in-time statement about the library as it stands now.
const EXCLUDED_NO_IDENTITY_TOTAL_KEY: &str = "excluded_no_identity_total";
const CATALOGUE_ROWS_TOTAL_KEY: &str = "catalogue_rows_total";

/// Records the latest scan's exclusion count and the catalogue size it was
/// measured against, replacing any previous pair. Both are written together so
/// a reader can never pair a fresh numerator with a stale denominator.
pub fn set_scan_identity_coverage(
    conn: &Connection,
    excluded_no_identity: usize,
    catalogue_rows: usize,
) -> Result<(), StoreError> {
    for (key, value) in [
        (EXCLUDED_NO_IDENTITY_TOTAL_KEY, excluded_no_identity),
        (CATALOGUE_ROWS_TOTAL_KEY, catalogue_rows),
    ] {
        conn.execute(
            "INSERT INTO agent_meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key, value.to_string()],
        )?;
    }
    Ok(())
}

/// The latest scan's `(excluded_no_identity, catalogue_rows)` pair — `(0, 0)` on
/// a store that has never recorded one.
pub fn scan_identity_coverage(conn: &Connection) -> Result<(usize, usize), StoreError> {
    let read = |key: &str| -> Result<usize, StoreError> {
        let raw: Option<String> = conn
            .query_row(
                "SELECT value FROM agent_meta WHERE key = ?1",
                [key],
                |row| row.get(0),
            )
            .optional()?;
        Ok(raw.and_then(|v| v.parse().ok()).unwrap_or(0))
    };
    Ok((
        read(EXCLUDED_NO_IDENTITY_TOTAL_KEY)?,
        read(CATALOGUE_ROWS_TOTAL_KEY)?,
    ))
}

/// The widest set of library roots any scan has ever successfully read, stored
/// newline-joined and sorted.
///
/// **Story 4.11 code review — the soft-delete safety gate.** `mark_absent_tracks`
/// can only honestly conclude a track is gone if the scan actually looked
/// everywhere it has looked before. `DateAddedIndex::all_tracks` omits tracks on
/// unmounted volumes by design, so a boot-drive-only scan on a machine that
/// normally sees a USB drive would otherwise mark that entire drive's library
/// deleted — the exact failure `joiner::date_added`'s own doc comment forbids
/// ("a library that shrinks because a drive was unplugged must never look like
/// tracks were *removed*").
const WIDEST_CATALOGUE_ROOTS_KEY: &str = "widest_catalogue_roots";

/// Whether `current_roots` covers everything ever seen, and records any newly
/// seen roots into the high-water mark.
///
/// Returns `false` when the current scan reached fewer roots than some earlier
/// scan did — the caller must then skip absence-marking entirely. A first-ever
/// scan (no stored set) is complete by definition: there is no earlier, wider
/// view to be missing anything relative to.
pub fn observe_catalogue_reach(
    conn: &Connection,
    current_roots: &[String],
) -> Result<bool, StoreError> {
    let stored: Option<String> = conn
        .query_row(
            "SELECT value FROM agent_meta WHERE key = ?1",
            [WIDEST_CATALOGUE_ROOTS_KEY],
            |row| row.get(0),
        )
        .optional()?;
    let known: std::collections::HashSet<String> = stored
        .as_deref()
        .unwrap_or("")
        .lines()
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect();
    let current: std::collections::HashSet<String> = current_roots.iter().cloned().collect();

    let complete = known.is_subset(&current);
    // The high-water mark only ever grows. A root that stops appearing is
    // exactly the ambiguous case this gate exists for — it may be an unplugged
    // drive, so it is never forgotten on the strength of one absent scan.
    let mut union: Vec<String> = known.union(&current).cloned().collect();
    union.sort();
    conn.execute(
        "INSERT INTO agent_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![WIDEST_CATALOGUE_ROOTS_KEY, union.join("\n")],
    )?;
    Ok(complete)
}

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
    migrate_library_tracks_columns(&conn)?;
    Ok(conn)
}

/// Adds Story 4.11's four new `library_tracks` columns (`title`, `artist`,
/// `absent_at`, `roster_synced_at`) to a database created before this story,
/// where `CREATE TABLE IF NOT EXISTS` above is a no-op against the
/// already-existing table. This is the **first** column added to an
/// already-shipped local table in this codebase (every prior addition —
/// `parse_failures`, `agent_meta`, `library_tracks` itself — was a brand-new
/// table, deliberately, per `open_at`'s own doc comment: "no external
/// migration tooling ... since this is a single-owner local file"). Checks
/// `PRAGMA table_info` rather than blindly running `ALTER TABLE ADD COLUMN`
/// so re-running this against an already-migrated database (every normal
/// startup, forever) is a safe no-op rather than a "duplicate column name"
/// error.
fn migrate_library_tracks_columns(conn: &Connection) -> Result<(), StoreError> {
    let mut existing = std::collections::HashSet::new();
    {
        let mut stmt = conn.prepare("PRAGMA table_info(library_tracks)")?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let name: String = row.get(1)?;
            existing.insert(name);
        }
    }
    for (column, ddl_type) in [
        ("title", "TEXT"),
        ("artist", "TEXT"),
        ("absent_at", "INTEGER"),
        ("roster_synced_at", "INTEGER"),
    ] {
        if !existing.contains(column) {
            conn.execute_batch(&format!(
                "ALTER TABLE library_tracks ADD COLUMN {column} {ddl_type}"
            ))?;
        }
    }
    Ok(())
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
/// 3's read source): `status = 'captured' AND synced_at IS NULL`, minus any
/// serato4 row at or below the go-forward baseline.
///
/// # The baseline guard (Decision A, 2026-08-17)
///
/// The watermark in [`crate::watcher`] governs **discovery** — which sessions
/// get captured in the first place. That is one line of defence, and it only
/// covers the path where a session is newly found. It does not cover a session
/// already sitting in this store from before the go-forward rule was enforced,
/// and those exist in the field: 965 pre-signup rows on the first real
/// install, 491 of them `captured`.
///
/// Such a row is one cleared `synced_at` away from being pushed, and clearing
/// `synced_at` is a *designed* behaviour, not a bug —
/// `backfill::backfill_captured_serato4` re-derives every captured row on
/// startup and re-queues any whose derived output changed, which is exactly
/// how a shipped stat fix reaches old sessions. So any future build that
/// changes derived output re-queues the DJ's entire history for upload, and no
/// discovery-time watermark can stop it.
///
/// This is the second line of defence, placed at the single read source every
/// sync path already goes through: a serato4 session at or below the baseline
/// is never pushed, whatever put it in the queue. `<=` matches
/// [`crate::parser::list_sessions_after`]'s own exclusive bound, so discovery
/// and sync agree on which side of the line a session falls.
///
/// **An unresolved baseline does not filter.** If no baseline is stored yet,
/// or the read fails, every pending row is returned exactly as before. The
/// alternative — withholding rows until a baseline appears — would let a
/// metadata read failure silently strand a DJ's real captures forever, which
/// is a worse failure than the one this guards against. The baseline is
/// established at startup before the backfill sweep can clear a single
/// `synced_at` (see `watcher::ensure_serato4_baseline`), so the unresolved
/// window is the first moments of a first run, when there is nothing
/// historical to withhold anyway.
///
/// Legacy rows are never filtered: their identities are file-derived, carry no
/// Serato session id, and have no ordering to compare a baseline against.
pub fn rows_pending_sync(conn: &Connection) -> Result<Vec<CapturedSessionRow>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT * FROM captured_sessions WHERE status = 'captured' AND synced_at IS NULL",
    )?;
    let rows = stmt.query_map([], row_from)?;
    let rows = rows
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(StoreError::from)?;

    let Ok(Some(baseline)) = serato4_watermark(conn) else {
        return Ok(rows);
    };

    Ok(rows
        .into_iter()
        .filter(|row| match serato4_session_id_of(row) {
            Some(id) => id > baseline,
            None => true,
        })
        .collect())
}

/// This row's Serato session id, for rows that have one. Reads the identity
/// (`serato4:<id>`) rather than the `raw_ref` path: the identity is the dedup
/// key this store is built on and cannot drift, whereas a `raw_ref` carries a
/// `master.sqlite` location that a drive remount can change.
fn serato4_session_id_of(row: &CapturedSessionRow) -> Option<i64> {
    if row.source != SessionSource::Serato4 {
        return None;
    }
    row.session_identity
        .strip_prefix("serato4:")
        .and_then(|id| id.parse().ok())
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
    /// by identity. Hashed from normalized title+artist as of Story 4.3
    /// (Decision E-2; was the portable path under D-2) — neither the raw path
    /// nor the raw title/artist reach the store's wire DTO or the cloud.
    /// `None` when the play carries no resolvable title/artist to hash.
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

/// One detected dancefloor span (Story 5.2), mirroring
/// `stats::segments::SuggestedSegment` plus the `type` the cloud row needs.
///
/// **Positions, not ids.** The agent can never know a cloud `plays.id` —
/// `sync_set` mints them inside its own transaction — so the wire carries
/// 1-based positions into the same payload's `plays[]` and the RPC resolves them
/// after its own insert (D-20). `type` is always `"dancefloor"`: this algorithm
/// detects exactly that signal, and `dinner`/`performance`/`custom` are human
/// labels Story 5.3 owns (D-26).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CapturedSuggestedSegment {
    #[serde(rename = "type")]
    pub segment_type: String,
    pub first_position: usize,
    pub last_position: usize,
}

/// One labeled stretch of silence (Story 5.2, D-10/D-26), mirroring
/// `stats::segments::IdleGap`.
///
/// **Unix epoch seconds, not ISO.** The story's Task 3.1 called for ISO "matching
/// `energy_arc`'s precedent", but that premise does not hold: `sync.rs` ships
/// `derived_json` to the RPC verbatim, so `energy_arc[].started_at` already
/// crosses this seam as an epoch integer despite the contract's prose, exactly
/// like `plays[].started_at` (which `sync_set` reads with `to_timestamp`). Epoch
/// on the wire is this seam's real convention and the Consistency table's stated
/// rule ("RPC arguments stay epoch; ISO only on read-model render strings"), and
/// the agent has no date formatter to produce ISO with. Documented as a
/// deferred-work item rather than quietly diverging.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CapturedIdleGap {
    pub start: i64,
    pub end: i64,
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
    /// Opaque `fnv1a_hex` track identity (`capture::track_id_from_title_artist`,
    /// Story 4.3 Decision E-2; D-2 originally).
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

/// One never-before-seen library track from a scan pass: identity + add-date
/// (D-2) plus Story 4.11 Tier A's title/artist, as passed to
/// [`record_library_tracks`] for tracks not already in [`known_track_ids`].
pub type IdentifiedLibraryTrack = (String, Option<i64>, Option<String>, Option<String>);

/// Records library tracks **not previously known** to this agent (D-1/D-2).
///
/// `is_baseline` decides whether these are D-1 baseline rows (never synced as
/// an add-event) or genuine go-forward adds (queued for the add-event
/// drain). `ON CONFLICT(track_id) DO NOTHING` is still the whole re-emit
/// guard for genuinely-new identities — callers only ever pass track_ids
/// already filtered against [`known_track_ids`] (see
/// `capture::scan_library_adds`), so a conflict here would mean two rows in
/// the same scan pass normalized to the same identity, not a real re-sighting
/// (`capture::dedupe_by_identity` already collapses that case before this is
/// called). A track **already** known that needs its title/artist refreshed
/// (Story 4.11 AC-4, a re-tagged track) goes through
/// [`refresh_library_track_tags`] instead — this function's job stays
/// "insert new," not "insert-or-update," so `added_at`/`is_baseline` can
/// never be silently rewritten by a function whose name doesn't warn you it
/// might (the exact invariant AC-3 depends on).
///
/// Returns how many rows were genuinely new.
pub fn record_library_tracks(
    conn: &Connection,
    tracks: &[IdentifiedLibraryTrack],
    is_baseline: bool,
    first_seen_locally_at: i64,
) -> Result<usize, StoreError> {
    let mut inserted = 0;
    let mut stmt = conn.prepare(
        "INSERT INTO library_tracks (track_id, first_seen_locally_at, added_at, is_baseline, synced_at, title, artist, absent_at, roster_synced_at)
         VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, NULL, NULL)
         ON CONFLICT(track_id) DO NOTHING",
    )?;
    for (track_id, added_at, title, artist) in tracks {
        inserted += stmt.execute(rusqlite::params![
            track_id,
            first_seen_locally_at,
            added_at,
            i64::from(is_baseline),
            title,
            artist,
        ])?;
    }
    Ok(inserted)
}

/// Refreshes title/artist on library tracks **already known** to this agent —
/// Story 4.11 AC-4's "the roster is current-state and mutable" rule, applied
/// to the one Tier-A pair of fields this story carries (genre/key are Tier B,
/// out of scope). Never touches `added_at`, `is_baseline`, or
/// `first_seen_locally_at` (AC-3's invariant: a track's baseline/go-forward
/// classification is fixed at first sighting, a re-scan must never move it).
///
/// `roster_synced_at` is reset to `NULL` **only** when the incoming
/// title/artist actually differ from what's stored — an unconditional reset
/// on every scan would re-queue every known track for cloud sync on every
/// single scan pass, defeating AC-7's batching/degrade-gracefully
/// requirement for no real reason (nothing changed). `synced_at` (the
/// add-event watermark, a wholly separate cloud write) is never touched
/// here. A track present in this scan is implicitly "not absent" — clears
/// `absent_at` too, so a track that left and came back needs no second pass.
///
/// Returns how many rows had an actual title/artist change (i.e. genuinely
/// needed a re-sync), not the count of tracks considered.
pub fn refresh_library_track_tags(
    conn: &Connection,
    tracks: &[(String, Option<String>, Option<String>)],
) -> Result<usize, StoreError> {
    let mut changed = 0;
    // The WHERE clause already guarantees at least one of title/artist/absence
    // genuinely differs, so every row this statement touches has really changed
    // and must re-sync — an unconditional `roster_synced_at = NULL` is correct.
    // (It previously carried a CASE preserving the watermark on a no-change,
    // whose condition was the exact negation of this WHERE and so could never
    // fire — Story 4.11 code review.)
    let mut stmt = conn.prepare(
        "UPDATE library_tracks
         SET roster_synced_at = NULL,
             title = ?2,
             artist = ?3,
             absent_at = NULL
         WHERE track_id = ?1
           AND (title IS NOT ?2 OR artist IS NOT ?3 OR absent_at IS NOT NULL)",
    )?;
    for (track_id, title, artist) in tracks {
        changed += stmt.execute(rusqlite::params![track_id, title, artist])?;
    }
    Ok(changed)
}

/// Marks every previously-known track **missing** from `current_track_ids`
/// as absent (Story 4.11 AC-5) — a soft-delete, never a hard `DELETE`, so a
/// track that later reappears keeps its identity and history rather than
/// being re-baselined as new. Idempotent: a track already marked absent is
/// left alone (its original `absent_at` is preserved, not bumped forward on
/// every scan it stays missing). Resets `roster_synced_at` to `NULL` on a
/// newly-absent track so the roster drain (Task 6) picks up the change —
/// the same "only reset on an actual change" discipline
/// [`refresh_library_track_tags`] uses for title/artist.
///
/// Reappearance is handled by [`refresh_library_track_tags`] instead of
/// here — any track present in a scan (this function's `current_track_ids`)
/// is by definition not being marked absent by this call, and
/// `refresh_library_track_tags` already clears `absent_at` for every track
/// it touches.
///
/// Callers must never call this with a `current_track_ids` derived from a
/// re-baselining pass (first run, or the Story 4.3 identity-cutover
/// migration) — those compare an old identity scheme against the new one and
/// would otherwise mark every real, still-owned track absent purely because
/// its `track_id` changed shape, not because it left the library.
pub fn mark_absent_tracks(
    conn: &Connection,
    current_track_ids: &std::collections::HashSet<String>,
    now: i64,
) -> Result<usize, StoreError> {
    let known = known_track_ids(conn)?;
    let mut marked = 0;
    let mut stmt = conn.prepare(
        "UPDATE library_tracks SET absent_at = ?1, roster_synced_at = NULL
         WHERE track_id = ?2 AND absent_at IS NULL",
    )?;
    for id in known.difference(current_track_ids) {
        marked += stmt.execute(rusqlite::params![now, id])?;
    }
    Ok(marked)
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

/* ---- Library roster (Story 4.11, AD-22) ------------------------------------ */
//
// INVARIANT (AC-3, the hazard this story most plausibly introduces): nothing
// in this section may ever be read as a source for conversion-rate cohort
// math. `library_tracks.added_at`/`.is_baseline` describe when/how a track
// first entered the LOCAL roster; the cloud's cohort denominator is
// `library_track_events` (AD-21), populated by a wholly separate local
// queue (`library_add_events_pending_sync`, gated `is_baseline = 0`) and a
// wholly separate cloud table. A baseline track's real pre-install
// `added_at` reaching cohort math would retroactively populate old months
// against a still-go-forward numerator and silently change numbers the DJ
// has already seen. See `sync::roster_sync_and_add_event_sync_never_touch_each_others_watermark`
// for the regression test enforcing the sync-layer half of this invariant.

/// One library track pending a roster sync — mirrors [`PendingLibraryAddEvent`]'s
/// shape but carries every Tier-A field the roster batch needs, including
/// `is_baseline`/`absent_at`, since (unlike the add-event batch) baseline
/// tracks and absence both DO reach this queue.
#[derive(Debug, Clone, PartialEq)]
pub struct PendingLibraryRosterEntry {
    pub track_id: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub added_at: Option<i64>,
    pub is_baseline: bool,
    pub absent_at: Option<i64>,
}

/// Every roster entry eligible for a sync attempt: `roster_synced_at IS NULL`
/// — set on first insert, reset by [`refresh_library_track_tags`] or
/// [`mark_absent_tracks`] whenever title/artist/absence actually changed.
/// Unlike [`library_add_events_pending_sync`], baseline rows are NOT excluded
/// here — carrying them to the roster is this story's whole point (AC-3).
pub fn library_roster_pending_sync(
    conn: &Connection,
) -> Result<Vec<PendingLibraryRosterEntry>, StoreError> {
    // A row with neither title nor artist has no name to carry, which is the
    // roster's entire purpose (AD-22). These are pre-4.3 path-hash rows that
    // Story 4.3's identity cutover left behind: the migration branch in
    // `scan_library_adds` returns early without ever refreshing them, and this
    // story's ALTER TABLE gave them a NULL `roster_synced_at`, so without this
    // filter the first drain after upgrade would upload the whole retired
    // identity scheme as unnameable rows the RPC's `coalesce` could never
    // repair (Story 4.11 code review).
    let mut stmt = conn.prepare(
        "SELECT track_id, title, artist, added_at, is_baseline, absent_at FROM library_tracks
         WHERE roster_synced_at IS NULL
           AND (title IS NOT NULL OR artist IS NOT NULL)
         ORDER BY first_seen_locally_at ASC, track_id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(PendingLibraryRosterEntry {
            track_id: row.get(0)?,
            title: row.get(1)?,
            artist: row.get(2)?,
            added_at: row.get(3)?,
            is_baseline: row.get::<_, i64>(4)? != 0,
            absent_at: row.get(5)?,
        })
    })?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(StoreError::from)
}

/// Stamps `roster_synced_at` on a batch of roster entries after the cloud
/// accepted them. Deliberately independent of `synced_at` (the add-event
/// watermark) — see the `library_tracks` schema comment on `roster_synced_at`
/// for why the two must never be conflated.
///
/// **Compare-and-set on the synced values, not a bare stamp (Story 4.11 code
/// review).** `sync_loop` and `watch_loop` hold separate connections to the same
/// WAL file, so a scan can call [`refresh_library_track_tags`] or
/// [`mark_absent_tracks`] in the window between this drain reading its pending
/// rows and stamping them. A bare `SET roster_synced_at = ?` would overwrite
/// that fresh NULL and the edit would never reach the cloud — silently, and
/// permanently until some unrelated later change re-queued the row. Matching on
/// the exact title/artist/absent_at that were actually sent means a row that
/// changed underneath simply does not match and stays pending. The add-event
/// drain has the same shape but is immune: its rows are immutable once written.
pub fn mark_library_roster_synced(
    conn: &Connection,
    entries: &[PendingLibraryRosterEntry],
    synced_at: i64,
) -> Result<(), StoreError> {
    let mut stmt = conn.prepare(
        "UPDATE library_tracks SET roster_synced_at = ?1
         WHERE track_id = ?2
           AND title IS ?3
           AND artist IS ?4
           AND absent_at IS ?5",
    )?;
    for entry in entries {
        stmt.execute(rusqlite::params![
            synced_at,
            entry.track_id,
            entry.title,
            entry.artist,
            entry.absent_at
        ])?;
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
    /// From `stats::segments::detect` (Story 5.2). Zero, one, or several — never
    /// assume exactly one (D-15). `#[serde(default)]` for the same pre-5.2-row
    /// round-trip reason as `CapturedPlay::played_ms`: a stored `derived_json`
    /// written before this story never carried the key at all.
    #[serde(default)]
    pub suggested_segments: Vec<CapturedSuggestedSegment>,
    /// From `stats::segments::detect` (Story 5.2, D-10). Descriptive only —
    /// nothing gates on these, and they are deliberately NOT `segments` rows
    /// (there is no `idle` value in the type enum, D-26).
    #[serde(default)]
    pub idle_gaps: Vec<CapturedIdleGap>,
    /// The DJ's IANA time zone name at capture time (Story 7.7) — e.g.
    /// `"America/Los_Angeles"`. Read from the OS at the effectful edge and
    /// threaded into [`crate::capture::assemble`] as an argument, never read
    /// from inside it: `assemble` is pure, and the byte-identical re-derive
    /// invariant (D-23) depends on that.
    ///
    /// `#[serde(default)]` for the same pre-existing-row round-trip reason as
    /// `suggested_segments`/`idle_gaps` above: a stored `derived_json` written
    /// before this story never carried the key.
    ///
    /// `None` when `iana_time_zone::get_timezone()` fails — carried as null,
    /// never a fabricated `"UTC"` (AD-11). The cloud resolves the fallback.
    #[serde(default)]
    pub timezone: Option<String>,
}

/// One captured session's raw material for Story 5.2's calibration pool — the
/// narrow read [`calibration_pool_rows`] returns, deliberately not a whole
/// [`CapturedSessionRow`] (the pool never needs `raw_ref`, `derived_json`, or
/// any of the sync bookkeeping, and a 491-row sweep should not carry them).
#[derive(Debug, Clone, PartialEq)]
pub struct CalibrationPoolRow {
    /// The session's own start, Unix epoch seconds. `NULL` in the store is
    /// possible (an all-untimed capture), and the pool orders those first.
    pub started_at: Option<i64>,
    /// The dedup key, and the deterministic tiebreak for a `started_at` tie.
    pub session_identity: String,
    /// Serialized `Vec<CapturedPlay>`; the window stats are recomputed from it
    /// rather than persisted (D-16 — live rollup, no durable profile).
    pub plays_json: Option<String>,
}

/// Every `captured` session's `(started_at, session_identity, plays_json)`, in
/// pool order (Story 5.2, D-23).
///
/// Deliberately no `source` filter and no confidence filter. Both halves matter:
/// a legacy-source night is still this DJ's own playing and belongs in their
/// calibration history; and `confidence.rs`'s value is *symmetric
/// classifiability*, "not a live/practice probability", so filtering on it would
/// have excluded tight club sets (0.2) while admitting sparse bedroom previewing
/// (1.0) — the exact inverse of the intent. See
/// [`crate::stats::segments::CalibrationPool::new`] for the full ruling; the only
/// exclusion applied is "produced no windows", which that constructor makes.
///
/// `superseded`/`incomplete`/`watching` rows are excluded by the status filter:
/// a superseded row is the losing half of a same-night duplicate and would
/// double-count that night in the pool.
pub fn calibration_pool_rows(conn: &Connection) -> Result<Vec<CalibrationPoolRow>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT started_at, session_identity, plays_json FROM captured_sessions
         WHERE status = 'captured'
         ORDER BY started_at ASC, session_identity ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(CalibrationPoolRow {
            started_at: row.get(0)?,
            session_identity: row.get(1)?,
            plays_json: row.get(2)?,
        })
    })?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(StoreError::from)
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

    /// Story 4.11 AC-6: the coverage pair starts at zero, REPLACES rather than
    /// accumulates across scan ticks, and survives a reopen of the same store
    /// file.
    ///
    /// The replace half is the point (Story 4.11 code review). Every scan
    /// recounts the whole catalogue, so the same unidentifiable rows are seen
    /// again on every tick — an accumulating total would read k×272 after k
    /// scans in a 930-track library and could never be the "N tracks in your
    /// The go-forward watermark must survive a restart — that persistence IS
    /// the fix. An in-memory-only watermark restarted at 0, which both
    /// re-imported the DJ's whole history and re-listed every session on every
    /// later launch (Decision A, 2026-08-17).
    #[test]
    fn serato4_watermark_persists_and_only_ever_advances() {
        let file = TempStoreFile::new("serato4-watermark");
        let conn = open_at(&file.0).expect("store opens");

        // Absent means "never baselined" — the signal to start at the
        // library's newest session rather than at 0.
        assert_eq!(serato4_watermark(&conn).expect("read"), None);

        set_serato4_watermark(&conn, 492).expect("baseline");
        assert_eq!(serato4_watermark(&conn).expect("read"), Some(492));

        set_serato4_watermark(&conn, 495).expect("advance");
        assert_eq!(serato4_watermark(&conn).expect("read"), Some(495));

        // Monotonic: a lower value must NOT move it backwards. A pass that read
        // a temporarily unreachable or half-written library could otherwise
        // reset the mark and re-import everything above it on the next tick.
        set_serato4_watermark(&conn, 3).expect("stale write");
        assert_eq!(
            serato4_watermark(&conn).expect("read"),
            Some(495),
            "the watermark must never move backwards"
        );

        let reopened = open_at(&file.0).expect("reopen");
        assert_eq!(
            serato4_watermark(&reopened).expect("read"),
            Some(495),
            "a restart must resume from the stored watermark, not from 0"
        );
    }

    /// library have no artist tag" gauge the disclosure needs.
    #[test]
    fn scan_identity_coverage_replaces_rather_than_accumulates_and_persists() {
        let file = TempStoreFile::new("excluded-no-identity");
        let conn = open_at(&file.0).expect("store opens");
        assert_eq!(scan_identity_coverage(&conn).expect("read"), (0, 0));

        set_scan_identity_coverage(&conn, 272, 910).expect("first scan");
        assert_eq!(scan_identity_coverage(&conn).expect("read"), (272, 910));

        // A second scan of the same unchanged library must report the SAME
        // numbers, not double them.
        set_scan_identity_coverage(&conn, 272, 910).expect("second scan");
        assert_eq!(
            scan_identity_coverage(&conn).expect("read"),
            (272, 910),
            "a re-scan of an unchanged library must not accumulate"
        );

        // And a genuinely changed library replaces both halves together.
        set_scan_identity_coverage(&conn, 12, 940).expect("third scan");
        assert_eq!(scan_identity_coverage(&conn).expect("read"), (12, 940));

        drop(conn);
        let reopened = open_at(&file.0).expect("reopen");
        assert_eq!(
            scan_identity_coverage(&reopened).expect("read"),
            (12, 940),
            "the coverage pair must survive a store reopen"
        );
    }

    /// Story 4.11 code review: the soft-delete safety gate. A scan that reached
    /// fewer library roots than an earlier scan did is NOT a complete view and
    /// must not be allowed to conclude anything was removed.
    #[test]
    fn catalogue_reach_reports_incomplete_when_a_root_goes_missing() {
        let file = TempStoreFile::new("catalogue-reach");
        let conn = open_at(&file.0).expect("store opens");
        let boot = "/Users/dj/Music".to_string();
        let usb = "/Volumes/USB".to_string();

        // First ever scan: nothing wider has been seen, so it is complete.
        assert!(
            observe_catalogue_reach(&conn, std::slice::from_ref(&boot)).expect("first"),
            "a first scan has no wider earlier view to fall short of"
        );
        // USB appears — still complete, and the high-water mark grows.
        assert!(observe_catalogue_reach(&conn, &[boot.clone(), usb.clone()]).expect("both"));
        // USB unplugged: the scan is now narrower than what has been seen.
        assert!(
            !observe_catalogue_reach(&conn, std::slice::from_ref(&boot)).expect("unplugged"),
            "a scan missing a previously-seen root must report incomplete"
        );
        // Replugged: complete again — the mark was never forgotten.
        assert!(observe_catalogue_reach(&conn, &[boot, usb]).expect("replugged"));
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
            suggested_segments: vec![],
            idle_gaps: vec![],
            timezone: None,
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

    /// Decision A, second line of defence: a serato4 session at or below the
    /// stored go-forward baseline is never handed to the sync path, however it
    /// got back into the queue. The scenario is the real one — a pre-signup set
    /// that already synced once, then had its `synced_at` cleared by a
    /// `backfill_captured_serato4` sweep re-deriving it under a newer build.
    #[test]
    fn a_serato4_session_at_or_below_the_baseline_is_never_pushed() {
        let file = TempStoreFile::new("pending-sync-baseline");
        let conn = open_at(&file.0).expect("store opens");

        for id in [40, 41, 42] {
            upsert_captured(
                &conn,
                &format!("serato4:{id}"),
                SessionSource::Serato4,
                &format!("/path/master.sqlite#{id}"),
                Some(1_000 * id),
                Some(1_000 * id + 500),
                &sample_plays(),
                &sample_derived(),
            )
            .unwrap();
        }
        // A legacy row from the same era: never filtered, it carries no
        // Serato session id to compare against.
        upsert_captured(
            &conn,
            "legacy:2026-01-01-set",
            SessionSource::Legacy,
            "/path/History/Sessions/old.session",
            Some(1_000),
            Some(1_500),
            &sample_plays(),
            &sample_derived(),
        )
        .unwrap();

        // No baseline yet: nothing is withheld.
        assert_eq!(rows_pending_sync(&conn).unwrap().len(), 4);

        set_serato4_watermark(&conn, 41).unwrap();

        let pending = rows_pending_sync(&conn).unwrap();
        let identities: Vec<&str> = pending
            .iter()
            .map(|r| r.session_identity.as_str())
            .collect();
        assert_eq!(
            identities.len(),
            2,
            "sessions 40 and 41 sit at or below the baseline and must not be pushed"
        );
        assert!(
            identities.contains(&"serato4:42"),
            "a session above the baseline is the DJ's real go-forward work and must still sync"
        );
        assert!(
            identities.contains(&"legacy:2026-01-01-set"),
            "a legacy row has no session id to compare and is never filtered by this guard"
        );
    }

    /// The guard has to survive the exact sequence that motivates it: sync,
    /// then a re-derivation clears `synced_at`, then the drain loop looks
    /// again. Before the guard, that sequence re-uploaded the DJ's history.
    #[test]
    fn a_resynced_pre_baseline_row_stays_withheld() {
        let file = TempStoreFile::new("pending-sync-resync");
        let conn = open_at(&file.0).expect("store opens");

        upsert_captured(
            &conn,
            "serato4:50",
            SessionSource::Serato4,
            "/path/master.sqlite#50",
            Some(5_000),
            Some(5_500),
            &sample_plays(),
            &sample_derived(),
        )
        .unwrap();
        set_serato4_watermark(&conn, 100).unwrap();
        mark_synced(&conn, "serato4:50", 9_999).unwrap();

        // A newer build re-derives it and re-queues the correction.
        mark_for_resync(&conn, "serato4:50").unwrap();

        assert!(
            rows_pending_sync(&conn).unwrap().is_empty(),
            "a cleared synced_at must not be enough to push a pre-baseline session"
        );
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
