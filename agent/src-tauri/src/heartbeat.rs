//! Agent-status heartbeat (Story 3.9, AC-1 / AD-20): the agent's **second and
//! only other** cloud write, alongside the idempotent set sync.
//!
//! AD-8 says the agent's only write is `sync_set`. AD-20 amends that to admit
//! exactly one more — this one — scoped by a `SECURITY DEFINER` RPC to a
//! single per-DJ `agent_status` row. It carries no derived Serato data
//! (AD-1/AD-2 untouched), is **not** a field on the frozen `shared/`
//! sync-payload contract (AD-3 — a separate endpoint), and is **never** gated
//! by `subscription_status` (AD-19: a lapsed subscriber's agent still beats,
//! because the dashboard's "is my agent alive" answer must not depend on
//! billing).
//!
//! **Beat-on-idle, ride the loop (Arjun, 2026-08-05).** The beat fires on
//! *every* drain pass of the existing [`crate::sync_queue::sync_loop`], with
//! the *current* state, **deduped against nothing**. That is the whole design:
//! a fire-on-change beat freezes `updated_at` on an idle-but-alive agent,
//! making it indistinguishable from a dead one, so "stale degrades gracefully"
//! could never actually be true. Beating unconditionally turns `updated_at`
//! into a genuine liveness signal. It adds **no new timer, thread, or poll
//! loop** — `sync_loop` already wakes every `BASE_INTERVAL` (30s) when idle,
//! backing off to `MAX_INTERVAL` (300s) while failing, and that cadence *is*
//! the heartbeat cadence.
//!
//! The agent is deliberately **dumb about staleness** — nothing here knows or
//! cares what "stale" means. The dashboard owns that definition
//! (`STALE_AFTER = 600s`, 2× `MAX_INTERVAL`, web-side), which is why the
//! coarse, backoff-coupled cadence above is acceptable.
//!
//! Everything here is **fire-and-forget**: [`beat`] returns a `Result` purely
//! so tests can assert on it, and the caller in `sync_queue` discards it. A
//! failed beat must never block, fail, retry, or otherwise perturb set sync —
//! and it cannot hot-loop by construction, since it is bounded by the drain
//! cadence it rides.

use std::sync::Mutex;

use serde::Serialize;

use crate::auth::client::{get_valid_access_token, AuthClient, AuthError, TokenPair};
use crate::auth::store::TokenStore;
use crate::tray::TrayState;

/// The wire body for `POST {SUPABASE_URL}/rest/v1/rpc/set_agent_status`.
///
/// Deliberately excludes `dj_id`: the RPC derives it from `auth.uid()` and
/// never accepts a client-supplied copy (AD-20, mirroring `sync_set`). The
/// field name must match the SQL function's parameter name — PostgREST maps
/// the JSON body key to the argument by name.
#[derive(Debug, Serialize)]
struct SetAgentStatusRequest<'a> {
    sync_state: &'a str,
}

/// Everything that can go wrong sending one heartbeat. Mirrors
/// [`crate::sync::SyncError`]'s small-enum `Display`/`std::error::Error` idiom.
///
/// There is deliberately no `retry_class` here, unlike `SyncError`: nothing
/// retries a beat. The next drain pass simply sends a fresher one, which is
/// strictly better than replaying a stale state.
#[derive(Debug)]
pub enum HeartbeatError {
    Auth(AuthError),
    Http(reqwest::Error),
    /// The `set_agent_status` RPC returned a non-success status. A `400` here
    /// means the state string was rejected by the RPC's allow-list — i.e.
    /// [`TrayState::wire_state`] and the migration have drifted apart.
    Rejected(reqwest::StatusCode),
}

impl std::fmt::Display for HeartbeatError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HeartbeatError::Auth(e) => write!(f, "heartbeat: {e}"),
            HeartbeatError::Http(e) => write!(f, "heartbeat: network error: {e}"),
            HeartbeatError::Rejected(status) => {
                write!(f, "heartbeat: set_agent_status rejected: {status}")
            }
        }
    }
}

impl std::error::Error for HeartbeatError {}

/// Wraps the `set_agent_status` RPC call — mirrors [`crate::sync::SyncClient`]'s
/// trait-injection pattern so tests never make a real network call.
pub trait StatusClient {
    fn set_agent_status(&self, access_token: &str, state: TrayState) -> Result<(), HeartbeatError>;
}

/// Deliberately tighter than `sync::HTTP_TIMEOUT` (15s) — and tighter than an
/// earlier 10s (Story 3.9 code review): `beat_status` calls this
/// synchronously on `sync_loop`'s own thread, so this timeout is also the
/// worst-case delay it can add to the *next* drain pass on a network-down
/// host. A beat is a tiny fire-and-forget POST whose only consumer is a 600s
/// staleness window, so there is nothing to gain by waiting longer on a host
/// that is evidently not answering — the next pass sends a fresher beat
/// anyway.
const HTTP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

/// The real implementation: `POST {SUPABASE_URL}/rest/v1/rpc/set_agent_status`,
/// reusing `sync.rs`'s exact auth/header shape (`apikey` +
/// `Authorization: Bearer`) and its `debug_sync_base_url()` test seam rather
/// than inventing a second HTTP client configuration.
pub struct SupabaseStatusClient {
    http: reqwest::blocking::Client,
}

impl SupabaseStatusClient {
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

impl Default for SupabaseStatusClient {
    fn default() -> Self {
        Self::new()
    }
}

impl StatusClient for SupabaseStatusClient {
    fn set_agent_status(&self, access_token: &str, state: TrayState) -> Result<(), HeartbeatError> {
        let url = format!(
            "{}/rest/v1/rpc/set_agent_status",
            crate::sync::debug_sync_base_url()
        );
        let response = self
            .http
            .post(&url)
            .header("apikey", crate::config::SUPABASE_PUBLISHABLE_KEY)
            .header("Authorization", format!("Bearer {access_token}"))
            .json(&SetAgentStatusRequest {
                sync_state: state.wire_state(),
            })
            .send()
            .map_err(HeartbeatError::Http)?;

        // The RPC `returns void`, so PostgREST answers 204 No Content on
        // success — `is_success()` covers the whole 2xx range, so this must
        // not be tightened to an `== OK` check.
        if !response.status().is_success() {
            return Err(HeartbeatError::Rejected(response.status()));
        }
        Ok(())
    }
}

/// Sends one heartbeat carrying `state`.
///
/// Fetches a currently-valid access token through the same
/// [`get_valid_access_token`] path set sync uses (transparently refreshing
/// only when actually expired, so a beat costs no network call of its own on
/// the common path). `dj_id` is never sent — the RPC derives it from
/// `auth.uid()`.
///
/// Nothing here consults `subscription_status`, and nothing may be added that
/// does (AD-19/AD-20).
pub fn beat(
    tokens: &Mutex<Option<TokenPair>>,
    token_store: &dyn TokenStore,
    auth_client: &dyn AuthClient,
    status_client: &dyn StatusClient,
    state: TrayState,
) -> Result<(), HeartbeatError> {
    let access_token =
        get_valid_access_token(tokens, token_store, auth_client).map_err(HeartbeatError::Auth)?;
    status_client.set_agent_status(&access_token, state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::store::FakeTokenStore;
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
    struct FakeStatusClient {
        calls: AtomicUsize,
        sent: Mutex<Vec<TrayState>>,
        fail: bool,
    }

    impl FakeStatusClient {
        fn failing() -> Self {
            Self {
                fail: true,
                ..Default::default()
            }
        }
        fn call_count(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
        fn sent_states(&self) -> Vec<TrayState> {
            self.sent.lock().unwrap().clone()
        }
    }

    impl StatusClient for FakeStatusClient {
        fn set_agent_status(
            &self,
            _access_token: &str,
            state: TrayState,
        ) -> Result<(), HeartbeatError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.sent.lock().unwrap().push(state);
            if self.fail {
                return Err(HeartbeatError::Rejected(
                    reqwest::StatusCode::INTERNAL_SERVER_ERROR,
                ));
            }
            Ok(())
        }
    }

    fn valid_tokens() -> Mutex<Option<TokenPair>> {
        Mutex::new(Some(TokenPair {
            access_token: fixture_jwt("00000000-0000-0000-0000-000000000009"),
            refresh_token: "rt".into(),
            expires_at: 9_999_999_999,
        }))
    }

    #[test]
    fn a_beat_sends_the_state_it_was_given() {
        let tokens = valid_tokens();
        let client = FakeStatusClient::default();

        beat(
            &tokens,
            &FakeTokenStore::default(),
            &FakeAuthClient,
            &client,
            TrayState::Queued,
        )
        .expect("beat succeeds");

        assert_eq!(client.sent_states(), vec![TrayState::Queued]);
    }

    #[test]
    fn every_tray_state_can_be_beaten_including_drive_not_connected() {
        // DriveNotConnected is NOT rendered on the dashboard (spec: tray +
        // Settings only), but the agent still reports it honestly — deciding
        // what to surface is the web's job, not the agent's.
        let tokens = valid_tokens();
        let client = FakeStatusClient::default();

        for state in TrayState::ALL {
            beat(
                &tokens,
                &FakeTokenStore::default(),
                &FakeAuthClient,
                &client,
                state,
            )
            .expect("beat succeeds");
        }

        assert_eq!(client.sent_states(), TrayState::ALL.to_vec());
    }

    #[test]
    fn repeated_beats_of_an_identical_state_are_never_deduped() {
        // The 2026-08-05 beat-on-idle ruling, asserted as a contract: an
        // idle-but-alive agent must keep refreshing `updated_at`, or the
        // dashboard cannot tell it from a dead one. If anyone reintroduces a
        // last-sent dedup, this fails.
        let tokens = valid_tokens();
        let client = FakeStatusClient::default();

        for _ in 0..3 {
            beat(
                &tokens,
                &FakeTokenStore::default(),
                &FakeAuthClient,
                &client,
                TrayState::Idle,
            )
            .expect("beat succeeds");
        }

        assert_eq!(
            client.call_count(),
            3,
            "every pass must POST, even when the state has not changed"
        );
        assert_eq!(
            client.sent_states(),
            vec![TrayState::Idle, TrayState::Idle, TrayState::Idle]
        );
    }

    #[test]
    fn a_failing_beat_surfaces_an_error_rather_than_panicking_or_retrying() {
        // Fire-and-forget means the CALLER discards this; what matters here is
        // that one attempt is made and the failure is returned, not retried
        // internally (which would be the hot-loop the ruling forbids).
        let tokens = valid_tokens();
        let client = FakeStatusClient::failing();

        let result = beat(
            &tokens,
            &FakeTokenStore::default(),
            &FakeAuthClient,
            &client,
            TrayState::Failed,
        );

        assert!(result.is_err());
        assert_eq!(
            client.call_count(),
            1,
            "a failed beat must not retry inside beat() -- the next drain pass is the retry"
        );
    }

    #[test]
    fn a_beat_with_no_linked_account_fails_before_any_network_call() {
        // An unlinked agent has no token; it must not reach the RPC at all.
        let tokens: Mutex<Option<TokenPair>> = Mutex::new(None);
        let client = FakeStatusClient::default();

        let result = beat(
            &tokens,
            &FakeTokenStore::default(),
            &FakeAuthClient,
            &client,
            TrayState::Idle,
        );

        assert!(matches!(result, Err(HeartbeatError::Auth(_))));
        assert_eq!(client.call_count(), 0);
    }
}
