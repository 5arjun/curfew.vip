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
    /// reset) and a `5xx` `Rejected` status are treated as transient; every
    /// other variant is permanent. There is no reachability/ping crate in
    /// this codebase and none should be added for this story (Dev Notes) — a
    /// failed sync attempt *is* the offline signal.
    pub fn retry_class(&self) -> RetryClass {
        match self {
            SyncError::Http(_) => RetryClass::Transient,
            SyncError::Rejected(status) if status.is_server_error() => RetryClass::Transient,
            // `Auth`/`Store` never actually reach a per-row classification in
            // practice — `sync_pending_sessions` fetches the token and opens
            // the connection once, up front, before iterating rows, so
            // either one aborts the whole pass rather than failing one row
            // (see `sync_queue.rs`'s pass-level handling). Grouped here as
            // permanent anyway so this method stays total over every variant.
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
fn debug_sync_base_url() -> String {
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
    fn a_network_transport_failure_is_classified_transient() {
        // A real `reqwest::Error` (loopback connection refused, no network
        // dependency) -- `reqwest::Error` has no public test constructor, so
        // this is the established way to obtain one.
        let client = reqwest::blocking::Client::new();
        let err = client
            .get("http://127.0.0.1:1")
            .send()
            .expect_err("port 1 on loopback must refuse the connection");
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
}
