//! Sync-queue client (Story 3.2, AR-2/AD-4): the synchronous, online-only
//! half of the `watcher -> parser -> joiner -> stat-engine -> local store ->
//! sync-queue` pipeline (`lib.rs`'s module doc) — pushes rows already
//! `status = 'captured'` in the local store (Story 2.8) up to the cloud via
//! an idempotent PostgREST RPC call, and stamps `synced_at` on success.
//!
//! Does **not** build a retry queue, backoff, or offline-detection (Story
//! 3.3's explicit scope) — a failed attempt here simply leaves `synced_at`
//! `NULL` for a later sync pass (or Story 3.3's queue) to retry.

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

impl SyncClient for SupabaseSyncClient {
    fn sync_set(
        &self,
        access_token: &str,
        request_body: &serde_json::Value,
    ) -> Result<Uuid, SyncError> {
        let url = format!("{}/rest/v1/rpc/sync_set", crate::config::SUPABASE_URL);
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SyncSummary {
    pub attempted: usize,
    pub synced: usize,
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
/// This is a straightforward "attempt once" pass, not a retry loop: a row
/// whose sync fails simply keeps `synced_at` `NULL` and is picked up again by
/// the next call to this function (or Story 3.3's future retry queue) — no
/// backoff/queue machinery is built here (out of this story's scope).
pub fn sync_pending_sessions(
    conn: &rusqlite::Connection,
    tokens: &Mutex<Option<TokenPair>>,
    token_store: &dyn TokenStore,
    auth_client: &dyn AuthClient,
    sync_client: &dyn SyncClient,
) -> Result<SyncSummary, SyncError> {
    let access_token =
        get_valid_access_token(tokens, token_store, auth_client).map_err(SyncError::Auth)?;
    let dj_id_claim =
        crate::auth::client::current_dj_id(&access_token).ok_or(SyncError::MalformedDjId)?;
    let dj_id = Uuid::parse_str(&dj_id_claim).map_err(|_| SyncError::MalformedDjId)?;

    let rows = store::rows_pending_sync(conn).map_err(SyncError::Store)?;
    let mut summary = SyncSummary {
        attempted: rows.len(),
        synced: 0,
    };

    for row in &rows {
        match sync_one(conn, sync_client, &access_token, dj_id, row) {
            Ok(()) => summary.synced += 1,
            Err(_e) => {
                #[cfg(debug_assertions)]
                eprintln!(
                    "curfew-agent: sync failed for session {}: {_e}",
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

    #[derive(Default)]
    struct FakeSyncClient {
        calls: AtomicUsize,
        respond_with: Mutex<Option<Result<Uuid, ()>>>,
    }

    impl FakeSyncClient {
        fn returning(id: Uuid) -> Self {
            Self {
                calls: AtomicUsize::new(0),
                respond_with: Mutex::new(Some(Ok(id))),
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
            match *self.respond_with.lock().unwrap() {
                Some(Ok(id)) => Ok(id),
                _ => Err(SyncError::Rejected(
                    reqwest::StatusCode::INTERNAL_SERVER_ERROR,
                )),
            }
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

        let summary =
            sync_pending_sessions(&conn, &tokens, &token_store, &auth_client, &sync_client)
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

        let summary =
            sync_pending_sessions(&conn, &tokens, &token_store, &auth_client, &sync_client)
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

        let summary =
            sync_pending_sessions(&conn, &tokens, &token_store, &auth_client, &sync_client)
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

        let summary =
            sync_pending_sessions(&conn, &tokens, &token_store, &auth_client, &sync_client)
                .expect("sync pass succeeds with nothing to do");

        assert_eq!(summary, SyncSummary::default());
        assert_eq!(sync_client.call_count(), 0);
    }
}
