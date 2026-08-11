//! Sync-queue client (Story 3.2, AR-2/AD-4): the synchronous, online-only
//! half of the `watcher -> parser -> joiner -> stat-engine -> local store ->
//! sync-queue` pipeline (`lib.rs`'s module doc) — pushes rows already
//! `status = 'captured'` in the local store (Story 2.8) up to the cloud via
//! an idempotent PostgREST RPC call, and stamps `synced_at` on success.
//!
//! Does **not** build a retry queue, backoff, or offline-detection (Story
//! 3.3's explicit scope) — a failed attempt here simply leaves `synced_at`
//! `NULL` for a later sync pass (or Story 3.3's queue) to retry.
//!
//! **Story 3.3 extension:** [`SyncError::retry_class`] classifies a per-row
//! failure as [`RetryClass::Transient`] (worth retrying — looks like a
//! connectivity problem) or [`RetryClass::Permanent`] (a data/logic problem
//! that will never resolve by retrying — e.g. `SetIdMismatch`) so the
//! offline-sync-queue drain loop (`sync_queue.rs`) can skip a permanently-bad
//! row instead of letting it spin the backoff loop's state forever.
//! [`sync_pending_sessions`] takes a `skip` set of already-permanent-failed
//! session identities for exactly this reason — the *mechanism* (auth token
//! fetch, row iteration, `sync_one`) is unchanged from Story 3.2.

use std::collections::HashSet;
use std::sync::Mutex;

use serde::Serialize;
use uuid::Uuid;

use crate::auth::client::{get_valid_access_token, AuthClient, AuthError, TokenPair};
use crate::auth::store::TokenStore;
use crate::store::{self, CapturedSessionRow, StoreError};

// ---- Task 1: deterministic, namespaced set id (AC-1, AC-4, AC-6, AD-4) ----

/// The deterministic `set_id = hash(dj_id, session_identity)` (AC-1): never a
/// fresh UUID, never `session_identity` hashed alone (that would collide
/// across two DJs sharing a USB library — AC-4). `dj_id` is the UUID v5
/// *namespace*, `session_identity` the *name* — the standard construct for
/// "deterministic and namespaced by `dj_id`" (AD-4), not a hand-rolled hash.
///
/// Per Story 3.1's schema comments, this **same** value is what both
/// `sessions.id` and `sets.id` are set to — callers must compute it once and
/// reuse it for both, never derive two different values.
pub fn set_id(dj_id: Uuid, session_identity: &str) -> Uuid {
    Uuid::new_v5(&dj_id, session_identity.as_bytes())
}

// ---- Task 3: authenticated PostgREST RPC sync call -------------------------

/// The wire body for `POST {SUPABASE_URL}/rest/v1/rpc/sync_set` — mirrors the
/// migration's function parameter list (Task 2) exactly. `started_at`/
/// `ended_at` are unix epoch seconds (this codebase's existing timestamp
/// convention — `store.rs`, `auth/client.rs` — rather than introducing an
/// ISO-8601/`chrono` round trip this crate has no other use for); the
/// `sync_set` function casts them via `to_timestamp()` server-side.
///
/// Deliberately excludes `dj_id`/`set_id` — the function derives/computes
/// both server-side (Task 2) and never trusts a client-supplied copy.
#[derive(Debug, Serialize)]
struct SyncSetRequest {
    session_identity: String,
    started_at: i64,
    ended_at: i64,
    derived: serde_json::Value,
    plays: serde_json::Value,
}

/// Everything that can go wrong syncing one or more captured sessions.
/// Mirrors this crate's small-enum `Display`/`std::error::Error` idiom.
#[derive(Debug)]
pub enum SyncError {
    Auth(AuthError),
    Store(StoreError),
    Http(reqwest::Error),
    /// The `sync_set` RPC returned a non-success status.
    Rejected(reqwest::StatusCode),
    /// A `captured_sessions` row's `plays_json`/`derived_json` was not valid
    /// JSON — data corruption from outside this module (both columns are
    /// always written together by `store::upsert_captured` as valid
    /// serialized JSON), not a reachable outcome of a normal write path.
    Corrupt(serde_json::Error),
    /// The `sub` claim on the current access token could not be parsed as a
    /// UUID — would only happen against a malformed/non-Supabase JWT.
    MalformedDjId,
    /// The server-computed `set_id` (Task 2, derived from `auth.uid()`) did
    /// not match this agent's own locally-computed value (Task 1) for the
    /// same `(dj_id, session_identity)` pair. Should never happen given
    /// AD-4's deterministic formula being identical on both sides — surfaced
    /// as a hard error rather than silently trusting the server's id if it
    /// ever does.
    SetIdMismatch {
        expected: Uuid,
        actual: Uuid,
    },
    /// A `captured_sessions` row eligible for sync had no `started_at`/
    /// `ended_at` (`capture::session_bounds` returns `None` whenever the
    /// first/last play's own `start_time` is missing — a real parsing gap,
    /// not a hypothetical). Surfaced as a hard error rather than silently
    /// defaulting to the Unix epoch, which would sync a set showing a bogus
    /// 1970-01-01 date with no indication anything was wrong.
    MissingTimeBounds,
}

impl std::fmt::Display for SyncError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SyncError::Auth(e) => write!(f, "sync: {e}"),
            SyncError::Store(e) => write!(f, "sync: {e}"),
            SyncError::Http(e) => write!(f, "sync: network error: {e}"),
            SyncError::Rejected(status) => write!(f, "sync: sync_set rejected: {status}"),
            SyncError::Corrupt(e) => write!(f, "sync: stored row is corrupt: {e}"),
            SyncError::MalformedDjId => {
                write!(f, "sync: dj_id claim could not be parsed as a UUID")
            }
            SyncError::SetIdMismatch { expected, actual } => write!(
                f,
                "sync: server-computed set_id {actual} did not match locally-computed {expected}"
            ),
            SyncError::MissingTimeBounds => {
                write!(f, "sync: row has no started_at/ended_at, cannot sync")
            }
        }
    }
}

impl std::error::Error for SyncError {}

/// Whether a per-row [`SyncError`] is worth retrying on the offline-sync-
/// queue's backoff cadence, or should be skipped on subsequent passes
/// instead (Story 3.3 Task 1's circuit-breaker requirement).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryClass {
    /// Looks like a connectivity problem (network down, or the server
    /// briefly unable to serve the request) — the same request could
    /// plausibly succeed on a later attempt.
    Transient,
    /// A data or logic problem that retrying will never fix on its own
    /// (a deterministic id mismatch, corrupt stored JSON, a malformed
    /// claim, a row missing required fields) — retrying at the same
    /// cadence forever is indistinguishable from a spin loop.
    Permanent,
}

impl SyncError {
    /// Classifies a per-row failure from [`sync_one`]. `Http` (a `reqwest`
    /// transport-level failure — can't reach the host, timed out, connection
    /// reset), a `5xx` `Rejected` status, and `429 Too Many Requests` are
    /// treated as transient (rate-limiting is a "try again later" condition,
    /// not a data/logic problem); every other variant is permanent. There is
    /// no reachability/ping crate in this codebase and none should be added
    /// for this story (Dev Notes) — a failed sync attempt *is* the offline
    /// signal.
    pub fn retry_class(&self) -> RetryClass {
        match self {
            SyncError::Http(_) => RetryClass::Transient,
            SyncError::Rejected(status)
                if status.is_server_error()
                    || *status == reqwest::StatusCode::TOO_MANY_REQUESTS =>
            {
                RetryClass::Transient
            }
            // `Auth`/`Store` never actually reach a per-row classification in
            // practice — `sync_pending_sessions` fetches the token and opens
            // the connection once, up front, before iterating rows, so
            // either one aborts the whole pass rather than failing one row.
            // `sync_queue.rs`'s pass-level handling now also calls this same
            // method on the pass-level error, so this classification applies
            // there too — e.g. a broken/expired token (`Auth`,
            // `MalformedDjId`) is correctly treated as permanent rather than
            // silently retried forever like a network outage.
            SyncError::Rejected(_)
            | SyncError::Auth(_)
            | SyncError::Store(_)
            | SyncError::Corrupt(_)
            | SyncError::MalformedDjId
            | SyncError::SetIdMismatch { .. }
            | SyncError::MissingTimeBounds => RetryClass::Permanent,
        }
    }
}

/// Wraps the `sync_set` RPC call — mirrors `auth::client::AuthClient`'s
/// trait-injection pattern so tests never make a real network call.
pub trait SyncClient {
    fn sync_set(
        &self,
        access_token: &str,
        request_body: &serde_json::Value,
    ) -> Result<Uuid, SyncError>;
}

/// Generous but bounded, same rationale as `auth::client::HTTP_TIMEOUT`: an
/// unreachable/slow Supabase host must not hang a sync attempt indefinitely.
const HTTP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

/// The real implementation: `POST {SUPABASE_URL}/rest/v1/rpc/sync_set`,
/// mirroring `auth::client::SupabaseAuthClient`'s request-building shape —
/// this is the first PostgREST (not Auth-endpoint) caller in the codebase,
/// so there is no existing generic client to reuse.
pub struct SupabaseSyncClient {
    http: reqwest::blocking::Client,
}

impl SupabaseSyncClient {
    pub fn new() -> Self {
        Self {
            http: reqwest::blocking::Client::builder()
                .timeout(HTTP_TIMEOUT)
                .connect_timeout(HTTP_TIMEOUT)
                .build()
                .expect("reqwest client with fixed static config must build"),
        }
    }
}

impl Default for SupabaseSyncClient {
    fn default() -> Self {
        Self::new()
    }
}

/// The Supabase base URL `sync_set` posts to. Normally the compile-time
/// `config::SUPABASE_URL`, but in **debug builds only** a
/// `CURFEW_DEBUG_FORCE_OFFLINE=1` env var swaps in an unroutable base so the
/// blocking HTTP call fails fast with a genuine `reqwest` connect error —
/// classified `RetryClass::Transient` exactly like a real offline failure,
/// driving the real `TrayState::Queued` path without needing to physically
/// disconnect the network (loopback to a local Supabase survives Wi-Fi-off,
/// which otherwise masks the Queued state). Compiled out entirely in release:
/// release builds always return `config::SUPABASE_URL`.
///
/// Shared with [`crate::heartbeat`] (Story 3.9) so the agent has exactly one
/// notion of "where the cloud is", and so forcing offline exercises the
/// heartbeat's failure path alongside sync's rather than only half of it.
pub(crate) fn debug_sync_base_url() -> String {
    #[cfg(debug_assertions)]
    {
        if std::env::var("CURFEW_DEBUG_FORCE_OFFLINE").as_deref() == Ok("1") {
            // Loopback + a port nothing listens on: connect is refused
            // immediately (fast fail), rather than hanging to the 15s connect
            // timeout the way an unroutable public IP would.
            return "http://127.0.0.1:1".to_string();
        }
    }
    crate::config::SUPABASE_URL.to_string()
}

impl SyncClient for SupabaseSyncClient {
    fn sync_set(
        &self,
        access_token: &str,
        request_body: &serde_json::Value,
    ) -> Result<Uuid, SyncError> {
        let url = format!("{}/rest/v1/rpc/sync_set", debug_sync_base_url());
        let response = self
            .http
            .post(&url)
            .header("apikey", crate::config::SUPABASE_PUBLISHABLE_KEY)
            .header("Authorization", format!("Bearer {access_token}"))
            .json(request_body)
            .send()
            .map_err(SyncError::Http)?;

        if !response.status().is_success() {
            return Err(SyncError::Rejected(response.status()));
        }

        response.json::<Uuid>().map_err(SyncError::Http)
    }
}

/// Outcome of one [`sync_pending_sessions`] pass — how many rows were
/// eligible, and how many actually synced (the rest simply keep `synced_at`
/// `NULL`, per this story's "attempt once" scope — see module doc).
///
/// **Story 3.3 extension:** `failed_transient`/`failed_permanent` split the
/// remainder (`attempted - synced`) by [`SyncError::retry_class`], and
/// `permanent_failure_identities` names exactly which rows the caller should
/// add to its own skip-list for the next pass (the circuit-breaker Task 1
/// requires) — `attempted` already excludes anything in the `skip` set
/// passed in, so a repeatedly-skipped row is only counted here once, the
/// pass it first fails permanently.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SyncSummary {
    pub attempted: usize,
    pub synced: usize,
    pub failed_transient: usize,
    pub failed_permanent: usize,
    pub permanent_failure_identities: Vec<String>,
}

/// Builds one row's `sync_set` request body from its stored `plays_json`/
/// `derived_json` columns — both are already-serialized JSON text (Story
/// 2.8), so this just re-parses them as generic [`serde_json::Value`] rather
/// than round-tripping through this crate's own [`crate::store::CapturedPlay`]/
/// [`crate::store::CapturedDerived`] DTOs, which this module has no other use
/// for.
fn build_request(row: &CapturedSessionRow) -> Result<serde_json::Value, SyncError> {
    let derived: serde_json::Value =
        serde_json::from_str(row.derived_json.as_deref().unwrap_or("null"))
            .map_err(SyncError::Corrupt)?;
    let plays: serde_json::Value =
        serde_json::from_str(row.plays_json.as_deref().unwrap_or("null"))
            .map_err(SyncError::Corrupt)?;

    let request = SyncSetRequest {
        session_identity: row.session_identity.clone(),
        started_at: row.started_at.ok_or(SyncError::MissingTimeBounds)?,
        ended_at: row.ended_at.ok_or(SyncError::MissingTimeBounds)?,
        derived,
        plays,
    };
    serde_json::to_value(request).map_err(SyncError::Corrupt)
}

/// Attempts to sync every row in `status = 'captured' AND synced_at IS NULL`
/// (Task 3's read source) via one `sync_set` RPC call each. A currently-valid
/// access token is fetched once up front (transparently refreshed if needed,
/// `auth::client::get_valid_access_token`) and reused for every row in the
/// pass, rather than refreshed per row.
///
/// This is a straightforward "attempt once per eligible row" pass, not a
/// retry loop itself — a row whose sync fails transiently simply keeps
/// `synced_at` `NULL` and is picked up again by the next call to this
/// function; the retry cadence/backoff is Story 3.3's `sync_queue` module's
/// job, layered on top of this function, not inside it.
///
/// `skip` names session identities to exclude from this pass entirely (Story
/// 3.3's circuit breaker: a row already classified [`RetryClass::Permanent`]
/// on a prior pass) — excluded rows are not counted in `attempted` and never
/// reach [`sync_one`], so a deterministically-broken row costs one wasted
/// network call total, not one per pass forever.
pub fn sync_pending_sessions(
    conn: &rusqlite::Connection,
    tokens: &Mutex<Option<TokenPair>>,
    token_store: &dyn TokenStore,
    auth_client: &dyn AuthClient,
    sync_client: &dyn SyncClient,
    skip: &HashSet<String>,
) -> Result<SyncSummary, SyncError> {
    let access_token =
        get_valid_access_token(tokens, token_store, auth_client).map_err(SyncError::Auth)?;
    let dj_id_claim =
        crate::auth::client::current_dj_id(&access_token).ok_or(SyncError::MalformedDjId)?;
    let dj_id = Uuid::parse_str(&dj_id_claim).map_err(|_| SyncError::MalformedDjId)?;

    let rows: Vec<_> = store::rows_pending_sync(conn)
        .map_err(SyncError::Store)?
        .into_iter()
        .filter(|row| !skip.contains(&row.session_identity))
        .collect();
    let mut summary = SyncSummary {
        attempted: rows.len(),
        ..Default::default()
    };

    for row in &rows {
        match sync_one(conn, sync_client, &access_token, dj_id, row) {
            Ok(()) => summary.synced += 1,
            Err(e) => {
                match e.retry_class() {
                    RetryClass::Transient => summary.failed_transient += 1,
                    RetryClass::Permanent => {
                        summary.failed_permanent += 1;
                        summary
                            .permanent_failure_identities
                            .push(row.session_identity.clone());
                    }
                }
                #[cfg(debug_assertions)]
                eprintln!(
                    "curfew-agent: sync failed for session {}: {e}",
                    row.session_identity
                );
            }
        }
    }

    Ok(summary)
}

/// Syncs a single row: builds the request, calls `sync_set`, verifies the
/// server-computed id matches this agent's own local computation (Task 1),
/// then stamps `synced_at`. Split out from [`sync_pending_sessions`] so a
/// single row's failure never aborts the rest of the pass.
fn sync_one(
    conn: &rusqlite::Connection,
    sync_client: &dyn SyncClient,
    access_token: &str,
    dj_id: Uuid,
    row: &CapturedSessionRow,
) -> Result<(), SyncError> {
    let expected_set_id = set_id(dj_id, &row.session_identity);
    let request_body = build_request(row)?;
    let actual_set_id = sync_client.sync_set(access_token, &request_body)?;

    if actual_set_id != expected_set_id {
        return Err(SyncError::SetIdMismatch {
            expected: expected_set_id,
            actual: actual_set_id,
        });
    }

    let synced_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    store::mark_synced(conn, &row.session_identity, synced_at).map_err(SyncError::Store)?;
    Ok(())
}

// ---- Story 4.2: library add-event batch sync (AD-21) -----------------------

/// How many add-events go up in one RPC call. A DJ importing a crate can add
/// hundreds of tracks at once; batching keeps that to a handful of calls, and
/// capping the batch keeps any single request (and any single retry) bounded.
const ADD_EVENT_BATCH_SIZE: usize = 200;

/// The wire body for `POST {SUPABASE_URL}/rest/v1/rpc/sync_library_add_events`.
/// Mirrors `SyncLibraryAddEventBatch` in `@curfew/shared` and the migration's
/// parameter list; `dj_id` is deliberately absent — the function derives it
/// from `auth.uid()` and never trusts a client-supplied copy, exactly like
/// `sync_set`.
///
/// `added_at` is unix epoch seconds on the wire (this codebase's convention at
/// this boundary, same as `SyncSetRequest.started_at`), cast server-side via
/// `to_timestamp()`. `None` stays `null` — never a guessed date (AD-11).
#[derive(Debug, Serialize)]
struct SyncLibraryAddEventWire {
    track_id: String,
    added_at: Option<i64>,
}

/// Wraps the `sync_library_add_events` RPC — same trait-injection pattern as
/// [`SyncClient`] so tests never make a real network call.
pub trait LibraryAddEventClient {
    fn sync_library_add_events(
        &self,
        access_token: &str,
        request_body: &serde_json::Value,
    ) -> Result<(), SyncError>;
}

impl LibraryAddEventClient for SupabaseSyncClient {
    fn sync_library_add_events(
        &self,
        access_token: &str,
        request_body: &serde_json::Value,
    ) -> Result<(), SyncError> {
        let url = format!(
            "{}/rest/v1/rpc/sync_library_add_events",
            debug_sync_base_url()
        );
        let response = self
            .http
            .post(&url)
            .header("apikey", crate::config::SUPABASE_PUBLISHABLE_KEY)
            .header("Authorization", format!("Bearer {access_token}"))
            .json(request_body)
            .send()
            .map_err(SyncError::Http)?;

        if !response.status().is_success() {
            return Err(SyncError::Rejected(response.status()));
        }
        Ok(())
    }
}

/// Outcome of one [`sync_pending_library_add_events`] pass. Deliberately
/// simpler than [`SyncSummary`]: there is no per-row circuit breaker here
/// because there is no per-row permanent-failure class to break on — an
/// add-event is two scalar fields with no derived blob to be corrupt, no
/// time-bounds to be missing, and no server-computed id to mismatch.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AddEventSyncSummary {
    pub attempted: usize,
    pub synced: usize,
}

/// Drains the local add-event queue (`library_tracks` rows that are a genuine
/// go-forward add and not yet synced) in batches (Story 4.2, Task 4, AD-21).
///
/// Reuses this module's existing token fetch and the same at-least-once /
/// idempotent discipline as [`sync_pending_sessions`]: rows are only stamped
/// `synced_at` after the cloud accepted them, so a batch lost mid-flight is
/// simply re-sent, and the `(dj_id, track_id)` upsert makes the redelivery a
/// no-op server-side.
///
/// D-1's "zero add-events on first run" is not enforced here — it is enforced
/// structurally, by `store::library_add_events_pending_sync`'s own
/// `is_baseline = 0` clause, so no caller can bypass it.
pub fn sync_pending_library_add_events(
    conn: &rusqlite::Connection,
    tokens: &Mutex<Option<TokenPair>>,
    token_store: &dyn TokenStore,
    auth_client: &dyn AuthClient,
    client: &dyn LibraryAddEventClient,
) -> Result<AddEventSyncSummary, SyncError> {
    let pending = store::library_add_events_pending_sync(conn).map_err(SyncError::Store)?;
    // Cheapest possible early-out: an agent with nothing to send must not pay
    // for a token fetch (and must not surface an auth failure) every pass.
    if pending.is_empty() {
        return Ok(AddEventSyncSummary::default());
    }

    let access_token =
        get_valid_access_token(tokens, token_store, auth_client).map_err(SyncError::Auth)?;

    let mut summary = AddEventSyncSummary {
        attempted: pending.len(),
        ..Default::default()
    };

    for batch in pending.chunks(ADD_EVENT_BATCH_SIZE) {
        let events: Vec<SyncLibraryAddEventWire> = batch
            .iter()
            .map(|event| SyncLibraryAddEventWire {
                track_id: event.track_id.clone(),
                added_at: event.added_at,
            })
            .collect();
        let request_body = serde_json::json!({ "events": serde_json::to_value(&events).map_err(SyncError::Corrupt)? });

        // A failed batch stops the pass rather than pressing on: every
        // remaining batch would fail the same way (the failure is the
        // connection or the token, not this batch's contents), and the rows
        // keep `synced_at NULL` for the next drain — the same "leave it
        // pending" posture `sync_one` takes.
        if let Err(e) = client.sync_library_add_events(&access_token, &request_body) {
            #[cfg(debug_assertions)]
            eprintln!("curfew-agent: library add-event batch sync failed: {e}");
            return Err(e);
        }

        let synced_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let track_ids: Vec<String> = batch.iter().map(|e| e.track_id.clone()).collect();
        store::mark_library_add_events_synced(conn, &track_ids, synced_at)
            .map_err(SyncError::Store)?;
        summary.synced += batch.len();
    }

    Ok(summary)
}

// ---- Story 4.11: library roster batch sync (AD-22) -------------------------

/// How many roster entries go up in one RPC call. Reuses the exact same cap
/// as [`ADD_EVENT_BATCH_SIZE`] — a roster entry carries two more string
/// fields (title/artist) than an add-event, but neither is large enough
/// (real DJ metadata, not free text) to justify a second tuned constant.
const ROSTER_BATCH_SIZE: usize = ADD_EVENT_BATCH_SIZE;

/// The wire body for `POST {SUPABASE_URL}/rest/v1/rpc/sync_library_roster`.
/// Mirrors `SyncLibraryRosterEntry` in `@curfew/shared` and the migration's
/// parameter list; `dj_id` is deliberately absent, same reasoning as
/// [`SyncLibraryAddEventWire`].
///
/// `added_at`/`absent_at` are unix epoch seconds on the wire (this
/// boundary's existing convention), cast server-side via `to_timestamp()`.
#[derive(Debug, Serialize)]
struct SyncLibraryRosterEntryWire {
    track_id: String,
    title: Option<String>,
    artist: Option<String>,
    added_at: Option<i64>,
    is_baseline: bool,
    absent_at: Option<i64>,
}

/// Wraps the `sync_library_roster` RPC — same trait-injection pattern as
/// [`LibraryAddEventClient`] so tests never make a real network call.
pub trait LibraryRosterClient {
    fn sync_library_roster(
        &self,
        access_token: &str,
        request_body: &serde_json::Value,
    ) -> Result<(), SyncError>;
}

impl LibraryRosterClient for SupabaseSyncClient {
    fn sync_library_roster(
        &self,
        access_token: &str,
        request_body: &serde_json::Value,
    ) -> Result<(), SyncError> {
        let url = format!("{}/rest/v1/rpc/sync_library_roster", debug_sync_base_url());
        let response = self
            .http
            .post(&url)
            .header("apikey", crate::config::SUPABASE_PUBLISHABLE_KEY)
            .header("Authorization", format!("Bearer {access_token}"))
            .json(request_body)
            .send()
            .map_err(SyncError::Http)?;

        if !response.status().is_success() {
            return Err(SyncError::Rejected(response.status()));
        }
        Ok(())
    }
}

/// Outcome of one [`sync_pending_library_roster`] pass. Mirrors
/// [`AddEventSyncSummary`]'s shape and reasoning exactly.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RosterSyncSummary {
    pub attempted: usize,
    pub synced: usize,
}

/// Drains the local roster queue (`library_tracks` rows with
/// `roster_synced_at IS NULL`) in batches (Story 4.11, AD-22).
///
/// Reuses this module's existing token fetch and the same at-least-once
/// discipline as [`sync_pending_library_add_events`]: rows are only stamped
/// `roster_synced_at` after the cloud accepted them, so a batch lost
/// mid-flight is simply re-sent — and because the cloud RPC's write is a
/// current-state upsert (not first-write-wins), a redelivery is doubly safe:
/// identical values in, identical values out.
///
/// Unlike the add-event drain, baseline rows are NOT excluded from this
/// queue — carrying them to the roster is Story 4.11's whole point (AC-3).
/// What IS structurally guaranteed is that this function never touches
/// `library_track_events`: it reads/writes `library_tracks` and calls only
/// [`LibraryRosterClient::sync_library_roster`], a wholly separate RPC from
/// [`LibraryAddEventClient::sync_library_add_events`].
pub fn sync_pending_library_roster(
    conn: &rusqlite::Connection,
    tokens: &Mutex<Option<TokenPair>>,
    token_store: &dyn TokenStore,
    auth_client: &dyn AuthClient,
    client: &dyn LibraryRosterClient,
) -> Result<RosterSyncSummary, SyncError> {
    let pending = store::library_roster_pending_sync(conn).map_err(SyncError::Store)?;
    // Cheapest possible early-out: an agent with nothing to send must not pay
    // for a token fetch (and must not surface an auth failure) every pass.
    if pending.is_empty() {
        return Ok(RosterSyncSummary::default());
    }

    let access_token =
        get_valid_access_token(tokens, token_store, auth_client).map_err(SyncError::Auth)?;

    let mut summary = RosterSyncSummary {
        attempted: pending.len(),
        ..Default::default()
    };

    for batch in pending.chunks(ROSTER_BATCH_SIZE) {
        let entries: Vec<SyncLibraryRosterEntryWire> = batch
            .iter()
            .map(|entry| SyncLibraryRosterEntryWire {
                track_id: entry.track_id.clone(),
                title: entry.title.clone(),
                artist: entry.artist.clone(),
                added_at: entry.added_at,
                is_baseline: entry.is_baseline,
                absent_at: entry.absent_at,
            })
            .collect();
        let request_body = serde_json::json!({ "entries": serde_json::to_value(&entries).map_err(SyncError::Corrupt)? });

        // Same posture as the add-event drain: a failed batch stops the pass
        // rather than pressing on, and the rows keep `roster_synced_at NULL`
        // for the next drain.
        if let Err(e) = client.sync_library_roster(&access_token, &request_body) {
            #[cfg(debug_assertions)]
            eprintln!("curfew-agent: library roster batch sync failed: {e}");
            return Err(e);
        }

        let synced_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        // The batch itself, not just its ids: the stamp is a compare-and-set
        // against the values actually sent, so an edit that landed mid-drain
        // stays pending instead of being silently marked synced.
        store::mark_library_roster_synced(conn, batch, synced_at).map_err(SyncError::Store)?;
        summary.synced += batch.len();
    }

    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dj(n: u8) -> Uuid {
        Uuid::from_bytes([n; 16])
    }

    // ---- Task 1: set_id determinism/namespacing --------------------------

    #[test]
    fn same_dj_and_session_identity_always_hashes_to_the_same_id() {
        assert_eq!(set_id(dj(1), "legacy:abc"), set_id(dj(1), "legacy:abc"));
    }

    #[test]
    fn same_session_identity_different_dj_never_collides() {
        assert_ne!(
            set_id(dj(1), "legacy:abc"),
            set_id(dj(2), "legacy:abc"),
            "shared-USB non-collision (AC-4): same session_identity, different dj_id, must differ"
        );
    }

    #[test]
    fn same_dj_different_session_identity_never_collides() {
        assert_ne!(set_id(dj(1), "legacy:abc"), set_id(dj(1), "legacy:xyz"));
    }

    #[test]
    fn set_id_is_a_valid_v5_uuid() {
        let id = set_id(dj(1), "legacy:abc");
        assert_eq!(id.get_version_num(), 5);
    }

    // ---- Task 3: sync client / orchestration ------------------------------

    use crate::auth::store::FakeTokenStore;
    use crate::store::{open_at, upsert_captured, CapturedDerived, CapturedPlay, SessionSource};
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn fixture_jwt(sub: &str) -> String {
        use base64::engine::general_purpose::URL_SAFE_NO_PAD;
        use base64::Engine;
        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"none","typ":"JWT"}"#);
        let payload = URL_SAFE_NO_PAD.encode(format!(r#"{{"exp":9999999999,"sub":"{sub}"}}"#));
        format!("{header}.{payload}.unverified-signature")
    }

    struct FakeAuthClient;
    impl AuthClient for FakeAuthClient {
        fn refresh(&self, _refresh_token: &str) -> Result<TokenPair, AuthError> {
            unreachable!("token is always already valid in these tests")
        }
    }

    /// A queue of canned `sync_set` responses, popped in call order — lets a
    /// single test drive a mixed batch (one row syncs, one mismatches, one
    /// looks offline) without a mocking framework, per this codebase's
    /// established test-double convention.
    #[derive(Default)]
    struct FakeSyncClient {
        calls: AtomicUsize,
        responses: Mutex<std::collections::VecDeque<Result<Uuid, SyncError>>>,
    }

    impl FakeSyncClient {
        fn returning(id: Uuid) -> Self {
            Self::queue(vec![Ok(id)])
        }

        fn queue(responses: Vec<Result<Uuid, SyncError>>) -> Self {
            Self {
                calls: AtomicUsize::new(0),
                responses: Mutex::new(responses.into()),
            }
        }

        fn call_count(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    impl SyncClient for FakeSyncClient {
        fn sync_set(
            &self,
            _access_token: &str,
            _body: &serde_json::Value,
        ) -> Result<Uuid, SyncError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.responses
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(Err(SyncError::Rejected(
                    reqwest::StatusCode::INTERNAL_SERVER_ERROR,
                )))
        }
    }

    fn sample_plays() -> Vec<CapturedPlay> {
        vec![CapturedPlay {
            position: 1,
            title: Some("Track A".into()),
            artist: Some("Artist A".into()),
            started_at: Some(1_000),
            bpm: Some(120.0),
            genre: None,
            camelot_key: None,
            in_library: true,
            played_ms: None,
            library_added_at: None,
            track_id: None,
        }]
    }

    fn sample_derived() -> CapturedDerived {
        CapturedDerived {
            most_played_tracks: vec![],
            most_played_artists: vec![],
            genre_breakdown: Default::default(),
            subgenre_breakdown: Default::default(),
            bpm_distribution: Default::default(),
            camelot_mixing_stats: Default::default(),
            set_length_sec: Some(600),
            track_count: 1,
            energy_arc: vec![],
            confidence: crate::store::CapturedConfidence {
                value: 1.0,
                track_count: 1,
                long_gap_count: 0,
            },
            suggested_segments: vec![],
            idle_gaps: vec![],
        }
    }

    struct TempStoreFile(std::path::PathBuf);
    impl TempStoreFile {
        fn new(tag: &str) -> Self {
            static COUNTER: AtomicUsize = AtomicUsize::new(0);
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "curfew_sync_test_{tag}_{}_{n}.sqlite",
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

    #[test]
    fn sync_pending_sessions_marks_synced_at_on_success_and_stops_returning_the_row() {
        let file = TempStoreFile::new("success");
        let conn = open_at(&file.0).expect("store opens");
        upsert_captured(
            &conn,
            "legacy:abc",
            SessionSource::Legacy,
            "/sessions/one.session",
            Some(1_000),
            Some(1_600),
            &sample_plays(),
            &sample_derived(),
        )
        .unwrap();

        let dj_uuid = dj(9);
        let tokens = Mutex::new(Some(TokenPair {
            access_token: fixture_jwt(&dj_uuid.to_string()),
            refresh_token: "rt".into(),
            expires_at: 9_999_999_999,
        }));
        let token_store = FakeTokenStore::default();
        let auth_client = FakeAuthClient;
        let expected_id = set_id(dj_uuid, "legacy:abc");
        let sync_client = FakeSyncClient::returning(expected_id);

        let summary = sync_pending_sessions(
            &conn,
            &tokens,
            &token_store,
            &auth_client,
            &sync_client,
            &HashSet::new(),
        )
        .expect("sync pass succeeds");

        assert_eq!(summary.attempted, 1);
        assert_eq!(summary.synced, 1);
        assert_eq!(sync_client.call_count(), 1);

        let row = store::get_by_identity(&conn, "legacy:abc")
            .unwrap()
            .unwrap();
        assert!(row.synced_at.is_some(), "synced_at must be stamped");

        assert!(
            store::rows_pending_sync(&conn).unwrap().is_empty(),
            "a synced row must no longer appear as pending"
        );
    }

    #[test]
    fn a_set_id_mismatch_is_an_error_and_leaves_synced_at_null() {
        let file = TempStoreFile::new("mismatch");
        let conn = open_at(&file.0).expect("store opens");
        upsert_captured(
            &conn,
            "legacy:abc",
            SessionSource::Legacy,
            "/sessions/one.session",
            Some(1_000),
            Some(1_600),
            &sample_plays(),
            &sample_derived(),
        )
        .unwrap();

        let dj_uuid = dj(9);
        let tokens = Mutex::new(Some(TokenPair {
            access_token: fixture_jwt(&dj_uuid.to_string()),
            refresh_token: "rt".into(),
            expires_at: 9_999_999_999,
        }));
        let token_store = FakeTokenStore::default();
        let auth_client = FakeAuthClient;
        // A deliberately wrong id, never matching this agent's own local
        // set_id(dj_uuid, "legacy:abc") computation.
        let sync_client = FakeSyncClient::returning(Uuid::nil());

        let summary = sync_pending_sessions(
            &conn,
            &tokens,
            &token_store,
            &auth_client,
            &sync_client,
            &HashSet::new(),
        )
        .expect("sync pass itself does not abort on a per-row failure");

        assert_eq!(summary.attempted, 1);
        assert_eq!(summary.synced, 0);

        let row = store::get_by_identity(&conn, "legacy:abc")
            .unwrap()
            .unwrap();
        assert!(
            row.synced_at.is_none(),
            "a mismatched/failed sync must leave synced_at NULL for a later retry"
        );
    }

    #[test]
    fn a_row_with_no_time_bounds_fails_loudly_instead_of_defaulting_to_epoch() {
        let file = TempStoreFile::new("missing-bounds");
        let conn = open_at(&file.0).expect("store opens");
        // started_at/ended_at both None -- e.g. the first/last play's own
        // start_time was itself missing (a real parsing gap, not a
        // hypothetical -- see capture::session_bounds).
        upsert_captured(
            &conn,
            "legacy:abc",
            SessionSource::Legacy,
            "/sessions/one.session",
            None,
            None,
            &sample_plays(),
            &sample_derived(),
        )
        .unwrap();

        let dj_uuid = dj(9);
        let tokens = Mutex::new(Some(TokenPair {
            access_token: fixture_jwt(&dj_uuid.to_string()),
            refresh_token: "rt".into(),
            expires_at: 9_999_999_999,
        }));
        let token_store = FakeTokenStore::default();
        let auth_client = FakeAuthClient;
        let sync_client = FakeSyncClient::returning(Uuid::nil());

        let summary = sync_pending_sessions(
            &conn,
            &tokens,
            &token_store,
            &auth_client,
            &sync_client,
            &HashSet::new(),
        )
        .expect("sync pass itself does not abort on a per-row failure");

        assert_eq!(summary.attempted, 1);
        assert_eq!(summary.synced, 0, "must not sync a bogus epoch-0 date");
        assert_eq!(
            sync_client.call_count(),
            0,
            "must fail before ever calling the RPC, not send started_at/ended_at = 0"
        );

        let row = store::get_by_identity(&conn, "legacy:abc")
            .unwrap()
            .unwrap();
        assert!(
            row.synced_at.is_none(),
            "a row with no time bounds must leave synced_at NULL for a later retry"
        );
    }

    #[test]
    fn no_pending_rows_is_a_no_op_zero_summary() {
        let file = TempStoreFile::new("empty");
        let conn = open_at(&file.0).expect("store opens");

        let dj_uuid = dj(9);
        let tokens = Mutex::new(Some(TokenPair {
            access_token: fixture_jwt(&dj_uuid.to_string()),
            refresh_token: "rt".into(),
            expires_at: 9_999_999_999,
        }));
        let token_store = FakeTokenStore::default();
        let auth_client = FakeAuthClient;
        let sync_client = FakeSyncClient::returning(Uuid::nil());

        let summary = sync_pending_sessions(
            &conn,
            &tokens,
            &token_store,
            &auth_client,
            &sync_client,
            &HashSet::new(),
        )
        .expect("sync pass succeeds with nothing to do");

        assert_eq!(summary, SyncSummary::default());
        assert_eq!(sync_client.call_count(), 0);
    }

    // ---- Story 3.3 Task 1/3: error classification + SyncSummary extension ----

    #[test]
    fn a_server_error_status_is_classified_transient() {
        assert_eq!(
            SyncError::Rejected(reqwest::StatusCode::INTERNAL_SERVER_ERROR).retry_class(),
            RetryClass::Transient
        );
        assert_eq!(
            SyncError::Rejected(reqwest::StatusCode::SERVICE_UNAVAILABLE).retry_class(),
            RetryClass::Transient
        );
    }

    #[test]
    fn a_non_server_error_status_is_classified_permanent() {
        assert_eq!(
            SyncError::Rejected(reqwest::StatusCode::BAD_REQUEST).retry_class(),
            RetryClass::Permanent
        );
        assert_eq!(
            SyncError::Rejected(reqwest::StatusCode::UNAUTHORIZED).retry_class(),
            RetryClass::Permanent
        );
    }

    #[test]
    fn a_rate_limit_status_is_classified_transient() {
        assert_eq!(
            SyncError::Rejected(reqwest::StatusCode::TOO_MANY_REQUESTS).retry_class(),
            RetryClass::Transient,
            "429 is a try-again-later condition, not a data/logic problem to skip-list forever"
        );
    }

    #[test]
    fn a_network_transport_failure_is_classified_transient() {
        // A real `reqwest::Error` -- `reqwest::Error` has no public test
        // constructor, so this is the established way to obtain one. Uses a
        // malformed URL rather than an actual loopback connection attempt:
        // `Client::get` defers URL parsing to `.send()`, so this fails
        // immediately with no real network I/O -- avoids the flakiness of
        // depending on a sandboxed/firewalled CI runner actually refusing a
        // connection on a given port. `retry_class()` only inspects the
        // `SyncError::Http` variant, not the underlying error's specific
        // kind, so any real `reqwest::Error` proves the same thing.
        let client = reqwest::blocking::Client::new();
        let err = client
            .get("not a valid url")
            .send()
            .expect_err("a malformed URL must fail to send without any real network call");
        assert_eq!(SyncError::Http(err).retry_class(), RetryClass::Transient);
    }

    #[test]
    fn logic_and_data_errors_are_classified_permanent() {
        let corrupt = serde_json::from_str::<serde_json::Value>("not json").unwrap_err();
        assert_eq!(
            SyncError::Corrupt(corrupt).retry_class(),
            RetryClass::Permanent
        );
        assert_eq!(
            SyncError::MalformedDjId.retry_class(),
            RetryClass::Permanent
        );
        assert_eq!(
            SyncError::MissingTimeBounds.retry_class(),
            RetryClass::Permanent
        );
        assert_eq!(
            SyncError::SetIdMismatch {
                expected: Uuid::nil(),
                actual: Uuid::max()
            }
            .retry_class(),
            RetryClass::Permanent
        );
    }

    #[test]
    fn sync_summary_extension_fields_populate_correctly_across_a_mixed_batch() {
        let file = TempStoreFile::new("mixed-batch");
        let conn = open_at(&file.0).expect("store opens");

        for identity in ["legacy:ok", "legacy:mismatch", "legacy:serverdown"] {
            upsert_captured(
                &conn,
                identity,
                SessionSource::Legacy,
                "/sessions/x.session",
                Some(1_000),
                Some(1_600),
                &sample_plays(),
                &sample_derived(),
            )
            .unwrap();
        }

        let dj_uuid = dj(9);
        let tokens = Mutex::new(Some(TokenPair {
            access_token: fixture_jwt(&dj_uuid.to_string()),
            refresh_token: "rt".into(),
            expires_at: 9_999_999_999,
        }));
        let token_store = FakeTokenStore::default();
        let auth_client = FakeAuthClient;

        let ok_id = set_id(dj_uuid, "legacy:ok");
        let sync_client = FakeSyncClient::queue(vec![
            Ok(ok_id),
            Ok(Uuid::nil()), // mismatches legacy:mismatch's real expected id
            Err(SyncError::Rejected(
                reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            )),
        ]);

        let summary = sync_pending_sessions(
            &conn,
            &tokens,
            &token_store,
            &auth_client,
            &sync_client,
            &HashSet::new(),
        )
        .expect("pass itself succeeds despite per-row failures");

        assert_eq!(summary.attempted, 3);
        assert_eq!(summary.synced, 1);
        assert_eq!(summary.failed_transient, 1);
        assert_eq!(summary.failed_permanent, 1);
        assert_eq!(
            summary.permanent_failure_identities,
            vec!["legacy:mismatch".to_string()]
        );
    }

    #[test]
    fn skip_list_excludes_rows_from_the_pass_without_deleting_them() {
        let file = TempStoreFile::new("skip-list");
        let conn = open_at(&file.0).expect("store opens");

        for identity in ["legacy:skip-me", "legacy:attempt-me"] {
            upsert_captured(
                &conn,
                identity,
                SessionSource::Legacy,
                "/sessions/x.session",
                Some(1_000),
                Some(1_600),
                &sample_plays(),
                &sample_derived(),
            )
            .unwrap();
        }

        let dj_uuid = dj(9);
        let tokens = Mutex::new(Some(TokenPair {
            access_token: fixture_jwt(&dj_uuid.to_string()),
            refresh_token: "rt".into(),
            expires_at: 9_999_999_999,
        }));
        let token_store = FakeTokenStore::default();
        let auth_client = FakeAuthClient;
        let expected_id = set_id(dj_uuid, "legacy:attempt-me");
        let sync_client = FakeSyncClient::returning(expected_id);

        let mut skip = HashSet::new();
        skip.insert("legacy:skip-me".to_string());

        let summary = sync_pending_sessions(
            &conn,
            &tokens,
            &token_store,
            &auth_client,
            &sync_client,
            &skip,
        )
        .expect("pass succeeds");

        assert_eq!(
            summary.attempted, 1,
            "the skip-listed row must not count toward attempted"
        );
        assert_eq!(summary.synced, 1);
        assert_eq!(
            sync_client.call_count(),
            1,
            "the skip-listed row must never reach the RPC call"
        );

        let skipped_row = store::get_by_identity(&conn, "legacy:skip-me")
            .unwrap()
            .unwrap();
        assert!(
            skipped_row.synced_at.is_none(),
            "skipping is not syncing -- the row is left exactly as it was"
        );
        assert_eq!(
            store::rows_pending_sync(&conn).unwrap().len(),
            1,
            "the skipped row still appears as pending -- skipping never deletes/hides it from the store"
        );
    }

    // ---- Story 4.2 Task 4: library add-event batch drain (AD-21) ----------

    /// Records every batch body it was handed, so a test can assert on the
    /// exact wire shape rather than only on the summary. Same hand-rolled
    /// double convention as `FakeSyncClient` above.
    #[derive(Default)]
    struct FakeAddEventClient {
        bodies: Mutex<Vec<serde_json::Value>>,
        fail_after: Option<usize>,
    }

    impl FakeAddEventClient {
        fn failing_after(calls: usize) -> Self {
            Self {
                fail_after: Some(calls),
                ..Default::default()
            }
        }
        fn bodies(&self) -> Vec<serde_json::Value> {
            self.bodies.lock().unwrap().clone()
        }
    }

    impl LibraryAddEventClient for FakeAddEventClient {
        fn sync_library_add_events(
            &self,
            _access_token: &str,
            body: &serde_json::Value,
        ) -> Result<(), SyncError> {
            let mut bodies = self.bodies.lock().unwrap();
            if let Some(limit) = self.fail_after {
                if bodies.len() >= limit {
                    return Err(SyncError::Http(
                        reqwest::blocking::Client::new()
                            .get("http://127.0.0.1:1")
                            .send()
                            .expect_err("a refused connect is the transient-failure fixture"),
                    ));
                }
            }
            bodies.push(body.clone());
            Ok(())
        }
    }

    fn add_event_auth() -> (Mutex<Option<TokenPair>>, FakeTokenStore, FakeAuthClient) {
        (
            Mutex::new(Some(TokenPair {
                access_token: fixture_jwt(&dj(9).to_string()),
                refresh_token: "rt".into(),
                expires_at: 9_999_999_999,
            })),
            FakeTokenStore::default(),
            FakeAuthClient,
        )
    }

    #[test]
    fn a_successful_add_event_drain_stamps_synced_at_and_stops_returning_the_rows() {
        let file = TempStoreFile::new("add-events");
        let conn = open_at(&file.0).expect("store opens");
        store::record_library_tracks(
            &conn,
            &[
                (
                    "aaaaaaaaaaaaaaaa".to_string(),
                    Some(1_772_323_200),
                    None,
                    None,
                ),
                ("bbbbbbbbbbbbbbbb".to_string(), None, None, None),
            ],
            false,
            1_700_000_000,
        )
        .unwrap();

        let (tokens, token_store, auth_client) = add_event_auth();
        let client = FakeAddEventClient::default();

        let summary =
            sync_pending_library_add_events(&conn, &tokens, &token_store, &auth_client, &client)
                .expect("drain succeeds");

        assert_eq!(summary.attempted, 2);
        assert_eq!(summary.synced, 2);
        assert!(
            store::library_add_events_pending_sync(&conn)
                .unwrap()
                .is_empty(),
            "a synced add-event must no longer appear as pending"
        );

        let bodies = client.bodies();
        assert_eq!(bodies.len(), 1, "both events ride one batch");
        let events = bodies[0]["events"].as_array().expect("events array");
        assert_eq!(events[0]["track_id"], "aaaaaaaaaaaaaaaa");
        assert_eq!(events[0]["added_at"], 1_772_323_200_i64);
        assert!(
            events[1]["added_at"].is_null(),
            "an unresolvable date goes up as null, never a guessed epoch"
        );
    }

    /// D-1/AC-4 at the sync boundary: even if every other guard failed, a
    /// baseline row is structurally unreachable from the drain.
    #[test]
    fn baseline_rows_are_never_drained_however_many_passes_run() {
        let file = TempStoreFile::new("add-events-baseline");
        let conn = open_at(&file.0).expect("store opens");
        store::record_library_tracks(
            &conn,
            &[
                (
                    "aaaaaaaaaaaaaaaa".to_string(),
                    Some(1_600_000_000),
                    None,
                    None,
                ),
                (
                    "bbbbbbbbbbbbbbbb".to_string(),
                    Some(1_600_000_001),
                    None,
                    None,
                ),
            ],
            true,
            1_700_000_000,
        )
        .unwrap();

        let (tokens, token_store, auth_client) = add_event_auth();
        let client = FakeAddEventClient::default();

        let summary =
            sync_pending_library_add_events(&conn, &tokens, &token_store, &auth_client, &client)
                .expect("drain succeeds");

        assert_eq!(summary, AddEventSyncSummary::default());
        assert!(
            client.bodies().is_empty(),
            "AC-4: a first-run baseline must not cost even one network call"
        );
    }

    #[test]
    fn a_failed_batch_leaves_its_rows_pending_for_the_next_pass() {
        let file = TempStoreFile::new("add-events-fail");
        let conn = open_at(&file.0).expect("store opens");
        store::record_library_tracks(
            &conn,
            &[("aaaaaaaaaaaaaaaa".to_string(), None, None, None)],
            false,
            1_700_000_000,
        )
        .unwrap();

        let (tokens, token_store, auth_client) = add_event_auth();
        let client = FakeAddEventClient::failing_after(0);

        let result =
            sync_pending_library_add_events(&conn, &tokens, &token_store, &auth_client, &client);

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().retry_class(),
            RetryClass::Transient,
            "a refused connection is worth retrying, not a permanent skip"
        );
        assert_eq!(
            store::library_add_events_pending_sync(&conn).unwrap().len(),
            1,
            "a failed batch must stay queued -- at-least-once, never at-most-once"
        );
    }

    /// The pass must be free for the overwhelmingly common case of nothing to
    /// send: an unlinked or idle agent must not fetch a token (or surface an
    /// auth error) on every single drain tick.
    #[test]
    fn an_empty_queue_costs_no_token_fetch_and_no_network_call() {
        let file = TempStoreFile::new("add-events-empty");
        let conn = open_at(&file.0).expect("store opens");

        let no_tokens = Mutex::new(None);
        let client = FakeAddEventClient::default();

        let summary = sync_pending_library_add_events(
            &conn,
            &no_tokens,
            &FakeTokenStore::default(),
            &FakeAuthClient,
            &client,
        )
        .expect("an empty queue is not an error even with no token at all");

        assert_eq!(summary, AddEventSyncSummary::default());
        assert!(client.bodies().is_empty());
    }

    #[test]
    fn a_large_queue_is_split_into_bounded_batches() {
        let file = TempStoreFile::new("add-events-batching");
        let conn = open_at(&file.0).expect("store opens");
        let tracks: Vec<store::IdentifiedLibraryTrack> = (0..ADD_EVENT_BATCH_SIZE + 5)
            .map(|i| (format!("{i:016x}"), None, None, None))
            .collect();
        store::record_library_tracks(&conn, &tracks, false, 1_700_000_000).unwrap();

        let (tokens, token_store, auth_client) = add_event_auth();
        let client = FakeAddEventClient::default();

        let summary =
            sync_pending_library_add_events(&conn, &tokens, &token_store, &auth_client, &client)
                .expect("drain succeeds");

        assert_eq!(summary.synced, ADD_EVENT_BATCH_SIZE + 5);
        let bodies = client.bodies();
        assert_eq!(
            bodies.len(),
            2,
            "a crate import is batched, not one call per track"
        );
        assert_eq!(
            bodies[0]["events"].as_array().unwrap().len(),
            ADD_EVENT_BATCH_SIZE
        );
        assert_eq!(bodies[1]["events"].as_array().unwrap().len(), 5);
    }

    // ---- Story 4.11: library roster batch drain (AD-22) -------------------

    /// Same hand-rolled double convention as `FakeAddEventClient`.
    #[derive(Default)]
    struct FakeRosterClient {
        bodies: Mutex<Vec<serde_json::Value>>,
        fail_after: Option<usize>,
    }

    impl FakeRosterClient {
        fn failing_after(calls: usize) -> Self {
            Self {
                fail_after: Some(calls),
                ..Default::default()
            }
        }
        fn bodies(&self) -> Vec<serde_json::Value> {
            self.bodies.lock().unwrap().clone()
        }
    }

    impl LibraryRosterClient for FakeRosterClient {
        fn sync_library_roster(
            &self,
            _access_token: &str,
            body: &serde_json::Value,
        ) -> Result<(), SyncError> {
            let mut bodies = self.bodies.lock().unwrap();
            if let Some(limit) = self.fail_after {
                if bodies.len() >= limit {
                    return Err(SyncError::Http(
                        reqwest::blocking::Client::new()
                            .get("http://127.0.0.1:1")
                            .send()
                            .expect_err("a refused connect is the transient-failure fixture"),
                    ));
                }
            }
            bodies.push(body.clone());
            Ok(())
        }
    }

    #[test]
    fn a_successful_roster_drain_stamps_roster_synced_at_and_stops_returning_the_rows() {
        let file = TempStoreFile::new("roster");
        let conn = open_at(&file.0).expect("store opens");
        store::record_library_tracks(
            &conn,
            &[(
                "aaaaaaaaaaaaaaaa".to_string(),
                Some(1_772_323_200),
                Some("Track A".to_string()),
                Some("Artist A".to_string()),
            )],
            false,
            1_700_000_000,
        )
        .unwrap();

        let (tokens, token_store, auth_client) = add_event_auth();
        let client = FakeRosterClient::default();

        let summary =
            sync_pending_library_roster(&conn, &tokens, &token_store, &auth_client, &client)
                .expect("drain succeeds");

        assert_eq!(summary.attempted, 1);
        assert_eq!(summary.synced, 1);
        assert!(
            store::library_roster_pending_sync(&conn)
                .unwrap()
                .is_empty(),
            "a synced roster entry must no longer appear as pending"
        );

        let bodies = client.bodies();
        let entries = bodies[0]["entries"].as_array().expect("entries array");
        assert_eq!(entries[0]["track_id"], "aaaaaaaaaaaaaaaa");
        assert_eq!(entries[0]["title"], "Track A");
        assert_eq!(entries[0]["artist"], "Artist A");
        assert_eq!(entries[0]["is_baseline"], false);
    }

    /// Story 4.11 AC-3's central invariant, checked at the sync boundary too:
    /// a baseline row IS drained by the roster sync (unlike the add-event
    /// drain, which structurally excludes it) — that is this story's whole
    /// point.
    #[test]
    fn baseline_rows_are_drained_by_the_roster_sync_unlike_add_events() {
        let file = TempStoreFile::new("roster-baseline");
        let conn = open_at(&file.0).expect("store opens");
        store::record_library_tracks(
            &conn,
            &[(
                "aaaaaaaaaaaaaaaa".to_string(),
                Some(1_600_000_000),
                Some("Track A".to_string()),
                Some("Artist A".to_string()),
            )],
            true,
            1_700_000_000,
        )
        .unwrap();

        let (tokens, token_store, auth_client) = add_event_auth();
        let client = FakeRosterClient::default();

        let summary =
            sync_pending_library_roster(&conn, &tokens, &token_store, &auth_client, &client)
                .expect("drain succeeds");

        assert_eq!(
            summary.synced, 1,
            "a baseline row reaches the roster, unlike library_track_events"
        );
        let bodies = client.bodies();
        assert_eq!(bodies[0]["entries"][0]["is_baseline"], true);
    }

    #[test]
    fn a_failed_roster_batch_leaves_its_rows_pending_for_the_next_pass() {
        let file = TempStoreFile::new("roster-fail");
        let conn = open_at(&file.0).expect("store opens");
        store::record_library_tracks(
            &conn,
            &[(
                "aaaaaaaaaaaaaaaa".to_string(),
                None,
                Some("Track A".to_string()),
                Some("Artist A".to_string()),
            )],
            false,
            1_700_000_000,
        )
        .unwrap();

        let (tokens, token_store, auth_client) = add_event_auth();
        let client = FakeRosterClient::failing_after(0);

        let result =
            sync_pending_library_roster(&conn, &tokens, &token_store, &auth_client, &client);

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().retry_class(),
            RetryClass::Transient,
            "a refused connection is worth retrying, not a permanent skip"
        );
        assert_eq!(
            store::library_roster_pending_sync(&conn).unwrap().len(),
            1,
            "a failed batch must stay queued -- at-least-once, never at-most-once"
        );
    }

    #[test]
    fn an_empty_roster_queue_costs_no_token_fetch_and_no_network_call() {
        let file = TempStoreFile::new("roster-empty");
        let conn = open_at(&file.0).expect("store opens");

        let no_tokens = Mutex::new(None);
        let client = FakeRosterClient::default();

        let summary = sync_pending_library_roster(
            &conn,
            &no_tokens,
            &FakeTokenStore::default(),
            &FakeAuthClient,
            &client,
        )
        .expect("an empty queue is not an error even with no token at all");

        assert_eq!(summary, RosterSyncSummary::default());
        assert!(client.bodies().is_empty());
    }

    /// Story 4.11 AC-4: a re-tag resets `roster_synced_at` so the drain picks
    /// it up again, even though the row already synced once.
    #[test]
    fn a_retagged_track_is_re_drained_after_already_syncing_once() {
        let file = TempStoreFile::new("roster-retag");
        let conn = open_at(&file.0).expect("store opens");
        store::record_library_tracks(
            &conn,
            &[(
                "aaaaaaaaaaaaaaaa".to_string(),
                Some(1_700_000_000),
                Some("Track A".to_string()),
                Some("Artist A".to_string()),
            )],
            false,
            1_700_000_000,
        )
        .unwrap();

        let (tokens, token_store, auth_client) = add_event_auth();
        let client = FakeRosterClient::default();
        sync_pending_library_roster(&conn, &tokens, &token_store, &auth_client, &client)
            .expect("first drain");
        assert!(store::library_roster_pending_sync(&conn)
            .unwrap()
            .is_empty());

        store::refresh_library_track_tags(
            &conn,
            &[(
                "aaaaaaaaaaaaaaaa".to_string(),
                Some("Retagged".to_string()),
                Some("Retagged Artist".to_string()),
            )],
        )
        .unwrap();

        let pending = store::library_roster_pending_sync(&conn).unwrap();
        assert_eq!(
            pending.len(),
            1,
            "a re-tag must re-enter the pending queue, not stay synced forever"
        );

        let summary =
            sync_pending_library_roster(&conn, &tokens, &token_store, &auth_client, &client)
                .expect("second drain");
        assert_eq!(summary.synced, 1);
        let bodies = client.bodies();
        assert_eq!(bodies[1]["entries"][0]["title"], "Retagged");
    }

    #[test]
    fn a_large_roster_queue_is_split_into_bounded_batches() {
        let file = TempStoreFile::new("roster-batching");
        let conn = open_at(&file.0).expect("store opens");
        let tracks: Vec<store::IdentifiedLibraryTrack> = (0..ROSTER_BATCH_SIZE + 5)
            .map(|i| {
                (
                    format!("{i:016x}"),
                    None,
                    Some(format!("Track {i}")),
                    Some(format!("Artist {i}")),
                )
            })
            .collect();
        store::record_library_tracks(&conn, &tracks, false, 1_700_000_000).unwrap();

        let (tokens, token_store, auth_client) = add_event_auth();
        let client = FakeRosterClient::default();

        let summary =
            sync_pending_library_roster(&conn, &tokens, &token_store, &auth_client, &client)
                .expect("drain succeeds");

        assert_eq!(summary.synced, ROSTER_BATCH_SIZE + 5);
        let bodies = client.bodies();
        assert_eq!(
            bodies.len(),
            2,
            "a crate import is batched, not one call per track"
        );
        assert_eq!(
            bodies[0]["entries"].as_array().unwrap().len(),
            ROSTER_BATCH_SIZE
        );
        assert_eq!(bodies[1]["entries"].as_array().unwrap().len(), 5);
    }

    // ---- Story 4.11 Task 7: baseline-never-reaches-cohort-math invariant --

    /// The hazard this story's Context & Authority section names as the most
    /// plausible one it introduces: `synced_at` (the add-event watermark,
    /// feeding `library_track_events` -- the cohort denominator, AD-21) and
    /// `roster_synced_at` (this story's watermark, feeding `library_roster`)
    /// must stay two wholly independent signals on the same `library_tracks`
    /// row. If a future edit ever conflated them -- e.g. made
    /// `mark_library_roster_synced` touch `synced_at`, or vice versa -- a
    /// roster-only sync could make a track look add-event-synced (or
    /// vice versa) with no such thing having happened, corrupting whichever
    /// cloud table's completeness the wrong column implies.
    ///
    /// Proven directly: running ONLY the roster drain must leave `synced_at`
    /// untouched, and running ONLY the add-event drain must leave
    /// `roster_synced_at` untouched, even though both drains process the
    /// exact same row.
    #[test]
    fn roster_sync_and_add_event_sync_never_touch_each_others_watermark() {
        let file = TempStoreFile::new("roster-watermark-isolation");
        let conn = open_at(&file.0).expect("store opens");
        store::record_library_tracks(
            &conn,
            &[(
                "aaaaaaaaaaaaaaaa".to_string(),
                Some(1_700_000_000),
                Some("Track A".to_string()),
                Some("Artist A".to_string()),
            )],
            false,
            1_700_000_000,
        )
        .unwrap();

        let synced_at_before = |conn: &rusqlite::Connection| -> Option<i64> {
            conn.query_row(
                "SELECT synced_at FROM library_tracks WHERE track_id = 'aaaaaaaaaaaaaaaa'",
                [],
                |row| row.get(0),
            )
            .unwrap()
        };
        let roster_synced_at = |conn: &rusqlite::Connection| -> Option<i64> {
            conn.query_row(
                "SELECT roster_synced_at FROM library_tracks WHERE track_id = 'aaaaaaaaaaaaaaaa'",
                [],
                |row| row.get(0),
            )
            .unwrap()
        };

        assert_eq!(synced_at_before(&conn), None);
        assert_eq!(roster_synced_at(&conn), None);

        // Roster-only drain: synced_at (the add-event watermark) must stay
        // untouched even though the SAME row is being processed.
        let (tokens, token_store, auth_client) = add_event_auth();
        sync_pending_library_roster(
            &conn,
            &tokens,
            &token_store,
            &auth_client,
            &FakeRosterClient::default(),
        )
        .expect("roster drain");

        assert!(
            roster_synced_at(&conn).is_some(),
            "roster drain must stamp roster_synced_at"
        );
        assert_eq!(
            synced_at_before(&conn),
            None,
            "roster drain must NEVER touch synced_at (the add-event watermark)"
        );

        // Add-event-only drain on the same row: roster_synced_at must stay
        // exactly as the roster drain left it.
        let roster_synced_at_after_roster_drain = roster_synced_at(&conn);
        sync_pending_library_add_events(
            &conn,
            &tokens,
            &token_store,
            &auth_client,
            &FakeAddEventClient::default(),
        )
        .expect("add-event drain");

        assert!(
            synced_at_before(&conn).is_some(),
            "add-event drain must stamp synced_at"
        );
        assert_eq!(
            roster_synced_at(&conn),
            roster_synced_at_after_roster_drain,
            "add-event drain must NEVER touch roster_synced_at"
        );
    }

    /// The other half of the invariant, at the write-path layer rather than
    /// the sync layer: the roster's local read/write functions only ever
    /// touch `library_tracks` (never a second local table), and its cloud
    /// RPC (`sync_library_roster`) is structurally a different endpoint from
    /// the add-event RPC (`sync_library_add_events`) -- proven by asserting
    /// the two FakeClient doubles never see each other's calls, i.e. a
    /// roster drain with an add-event client wired in (impossible by type,
    /// which IS the guarantee) can't happen; this test instead pins the
    /// wire body's own key (`entries` vs `events`) as the structural tripwire
    /// a reviewer or future refactor would trip if the two payloads were
    /// ever accidentally merged into one.
    #[test]
    fn roster_and_add_event_wire_payloads_use_distinct_keys() {
        let file = TempStoreFile::new("roster-wire-distinct");
        let conn = open_at(&file.0).expect("store opens");
        store::record_library_tracks(
            &conn,
            &[(
                "aaaaaaaaaaaaaaaa".to_string(),
                Some(1_700_000_000),
                Some("Track A".to_string()),
                Some("Artist A".to_string()),
            )],
            false,
            1_700_000_000,
        )
        .unwrap();

        let (tokens, token_store, auth_client) = add_event_auth();
        let roster_client = FakeRosterClient::default();
        sync_pending_library_roster(&conn, &tokens, &token_store, &auth_client, &roster_client)
            .expect("roster drain");
        let roster_body = &roster_client.bodies()[0];
        assert!(roster_body.get("entries").is_some());
        assert!(roster_body.get("events").is_none());

        store::record_library_tracks(
            &conn,
            &[(
                "bbbbbbbbbbbbbbbb".to_string(),
                Some(1_700_000_001),
                None,
                None,
            )],
            false,
            1_700_000_000,
        )
        .unwrap();
        let add_event_client = FakeAddEventClient::default();
        sync_pending_library_add_events(
            &conn,
            &tokens,
            &token_store,
            &auth_client,
            &add_event_client,
        )
        .expect("add-event drain");
        let add_event_body = &add_event_client.bodies()[0];
        assert!(add_event_body.get("events").is_some());
        assert!(add_event_body.get("entries").is_none());
    }
}
