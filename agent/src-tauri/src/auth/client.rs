//! JWT/refresh handling + `dj_id` extraction (Story 2.10, Task 5). A
//! Supabase-issued JWT's signature is never verified here — Supabase's own
//! backend verifies it server-side on every request that matters; this only
//! reads the `exp`/`sub` claims out of the token's payload segment.

use std::sync::Mutex;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::Deserialize;

use super::store::TokenStore;

/// A refreshed (or just-linked) access/refresh token pair. `expires_at` is a
/// Unix epoch second count, matching this crate's existing
/// `started_at`/`ended_at`/`captured_at` convention (`store.rs`) rather than a
/// `chrono` type — no `chrono` dependency exists in this crate today.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenPair {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
}

#[derive(Debug)]
pub enum AuthError {
    /// No refresh token exists yet (never linked, or cleared) — not an
    /// exceptional condition, just a clear signal to the caller.
    NotLinked,
    /// The stored/received JWT could not be decoded into its `exp`/`sub`
    /// claims (malformed token — never logs the raw token value).
    MalformedToken,
    Http(reqwest::Error),
    /// The refresh endpoint returned a non-success status.
    RefreshRejected(reqwest::StatusCode),
    Store(super::store::TokenStoreError),
}

impl std::fmt::Display for AuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AuthError::NotLinked => write!(f, "agent is not linked to a DJ account yet"),
            AuthError::MalformedToken => write!(f, "access token could not be decoded"),
            AuthError::Http(e) => write!(f, "auth network error: {e}"),
            AuthError::RefreshRejected(status) => {
                write!(f, "token refresh rejected by server: {status}")
            }
            AuthError::Store(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for AuthError {}

/// The two JWT claims this agent ever reads. Extra fields are ignored by
/// default (serde, no `#[serde(deny_unknown_fields)]`) — this agent never
/// verifies the signature, so there's no reason to reject an otherwise-valid
/// token over an unrecognized claim.
#[derive(Debug, Deserialize)]
struct JwtClaims {
    exp: i64,
    sub: String,
}

/// Decodes a Supabase-issued JWT's payload (middle, `.`-separated) segment
/// into its `exp`/`sub` claims, without verifying the signature (Supabase's
/// backend does that server-side on every request that matters).
fn decode_jwt_claims(token: &str) -> Result<JwtClaims, AuthError> {
    let payload_b64 = token.split('.').nth(1).ok_or(AuthError::MalformedToken)?;
    let payload = URL_SAFE_NO_PAD
        .decode(payload_b64)
        .map_err(|_| AuthError::MalformedToken)?;
    serde_json::from_slice(&payload).map_err(|_| AuthError::MalformedToken)
}

/// The DJ's `auth.uid()` (per ARCHITECTURE-SPINE.md's Consistency
/// Conventions: `dj_id = auth.uid()`), read off an access token's `sub`
/// claim. Built for Story 3.2's sync call to use when it stamps/authenticates
/// outbound requests — no live caller exists yet in this story.
pub fn current_dj_id(access_token: &str) -> Option<String> {
    decode_jwt_claims(access_token).ok().map(|c| c.sub)
}

/// The access token's `exp` claim, as a Unix epoch second count — what a
/// freshly-linked deep-link handoff uses to build a [`TokenPair`] (the
/// deep-link URL itself only carries the raw tokens, not an expiry).
pub fn token_expiry(access_token: &str) -> Result<i64, AuthError> {
    decode_jwt_claims(access_token).map(|c| c.exp)
}

/// Wraps the Supabase Auth REST call this story needs — mirrors
/// `watcher::detect.rs`'s `DiskSource` trait-injection pattern so tests never
/// make a real network call.
pub trait AuthClient {
    fn refresh(&self, refresh_token: &str) -> Result<TokenPair, AuthError>;
}

/// Supabase's refresh-token response shape. `expires_at` is Supabase's own
/// absolute Unix-epoch field (not `expires_in`, a relative seconds-from-now
/// count) — verified against a real local Supabase GoTrue response during
/// this story's Task 8 manual walkthrough.
#[derive(Debug, Deserialize)]
struct RefreshResponse {
    access_token: String,
    refresh_token: String,
    expires_at: i64,
}

/// The real implementation: `POST {SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`.
pub struct SupabaseAuthClient {
    http: reqwest::blocking::Client,
}

/// Generous but bounded — an unreachable/slow Supabase host must not hang
/// agent startup (this client's only caller today) indefinitely.
const HTTP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

impl SupabaseAuthClient {
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

impl Default for SupabaseAuthClient {
    fn default() -> Self {
        Self::new()
    }
}

impl AuthClient for SupabaseAuthClient {
    fn refresh(&self, refresh_token: &str) -> Result<TokenPair, AuthError> {
        let url = format!(
            "{}/auth/v1/token?grant_type=refresh_token",
            crate::config::SUPABASE_URL
        );
        let response = self
            .http
            .post(&url)
            .header("apikey", crate::config::SUPABASE_PUBLISHABLE_KEY)
            .json(&serde_json::json!({ "refresh_token": refresh_token }))
            .send()
            .map_err(AuthError::Http)?;

        if !response.status().is_success() {
            return Err(AuthError::RefreshRejected(response.status()));
        }

        let body: RefreshResponse = response.json().map_err(AuthError::Http)?;
        Ok(TokenPair {
            access_token: body.access_token,
            refresh_token: body.refresh_token,
            expires_at: body.expires_at,
        })
    }
}

/// Safety margin subtracted from `expires_at` before treating a held access
/// token as still valid — arbitrary but standard. `[ASSUMPTION]`, same as this
/// crate's other unpinned timing constants (e.g. `LEGACY_QUIET_PERIOD_SEC`).
const EXPIRY_SAFETY_MARGIN_SEC: i64 = 60;

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock is before the Unix epoch")
        .as_secs() as i64
}

/// Returns a currently-valid access token, refreshing transparently (AC-2) if
/// the held one is missing/expired/near-expiry. Proactive, not reactive-on-
/// 401 — there is no live 401 to react to yet, since no sync path exists
/// (resolved this way in the story itself).
///
/// Checks the in-memory pair first; if still valid, returns it directly
/// without calling `refresh` at all ("transparent," not "always refreshes").
/// Otherwise loads the refresh token from `store`, calls `client.refresh`,
/// and updates both the in-memory pair and the persisted refresh token —
/// Supabase rotates refresh tokens on use, so the **new** one from the
/// response overwrites the stored one, never assumed unchanged.
pub fn get_valid_access_token(
    tokens: &Mutex<Option<TokenPair>>,
    store: &dyn TokenStore,
    client: &dyn AuthClient,
) -> Result<String, AuthError> {
    {
        let guard = tokens.lock().expect("auth token mutex poisoned");
        if let Some(pair) = guard.as_ref() {
            if pair.expires_at > now_unix() + EXPIRY_SAFETY_MARGIN_SEC {
                return Ok(pair.access_token.clone());
            }
        }
    }

    let refresh_token = store
        .load()
        .map_err(AuthError::Store)?
        .ok_or(AuthError::NotLinked)?;

    let refreshed = match client.refresh(&refresh_token) {
        Ok(pair) => pair,
        Err(err @ AuthError::RefreshRejected(_)) => {
            // The stored refresh token is rejected (revoked/already rotated
            // elsewhere) and can never succeed again — clear it so future
            // calls surface a clean `NotLinked` instead of retrying a
            // permanently-doomed token on every restart. Best-effort: a
            // clear failure here doesn't change the outcome, the refresh
            // already failed.
            let _ = store.clear();
            return Err(err);
        }
        Err(err) => return Err(err),
    };
    store
        .save(&refreshed.refresh_token)
        .map_err(AuthError::Store)?;

    let access_token = refreshed.access_token.clone();
    *tokens.lock().expect("auth token mutex poisoned") = Some(refreshed);
    Ok(access_token)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::store::FakeTokenStore;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A hand-built, synthetic JWT fixture — never a real Supabase token
    /// (mirrors `parser/session.rs`'s synthetic-fixture-builder convention).
    fn fixture_jwt(exp: i64, sub: &str) -> String {
        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"none","typ":"JWT"}"#);
        let payload = URL_SAFE_NO_PAD.encode(format!(r#"{{"exp":{exp},"sub":"{sub}"}}"#));
        format!("{header}.{payload}.unverified-signature")
    }

    #[test]
    fn decodes_exp_and_sub_from_a_synthetic_jwt() {
        let token = fixture_jwt(1_900_000_000, "dj-123");
        let claims = decode_jwt_claims(&token).expect("well-formed fixture must decode");
        assert_eq!(claims.exp, 1_900_000_000);
        assert_eq!(claims.sub, "dj-123");
    }

    #[test]
    fn current_dj_id_reads_the_sub_claim() {
        let token = fixture_jwt(1_900_000_000, "dj-abc");
        assert_eq!(current_dj_id(&token), Some("dj-abc".to_string()));
    }

    #[test]
    fn malformed_token_is_an_error_not_a_panic() {
        assert!(matches!(
            decode_jwt_claims("not-a-jwt"),
            Err(AuthError::MalformedToken)
        ));
        assert_eq!(current_dj_id("not-a-jwt"), None);
    }

    #[derive(Default)]
    struct FakeAuthClient {
        calls: AtomicUsize,
        response: Mutex<Option<Result<TokenPair, ()>>>,
    }

    impl FakeAuthClient {
        fn returning(pair: TokenPair) -> Self {
            Self {
                calls: AtomicUsize::new(0),
                response: Mutex::new(Some(Ok(pair))),
            }
        }

        fn call_count(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    impl AuthClient for FakeAuthClient {
        fn refresh(&self, _refresh_token: &str) -> Result<TokenPair, AuthError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            match self.response.lock().unwrap().take() {
                Some(Ok(pair)) => Ok(pair),
                _ => Err(AuthError::RefreshRejected(
                    reqwest::StatusCode::UNAUTHORIZED,
                )),
            }
        }
    }

    #[test]
    fn a_still_valid_token_is_returned_without_calling_refresh() {
        let tokens = Mutex::new(Some(TokenPair {
            access_token: "still-valid".to_string(),
            refresh_token: "rt-old".to_string(),
            expires_at: now_unix() + 3600,
        }));
        let store = FakeTokenStore::default();
        let client = FakeAuthClient::returning(TokenPair {
            access_token: "should-not-be-used".to_string(),
            refresh_token: "should-not-be-used".to_string(),
            expires_at: now_unix() + 3600,
        });

        let token = get_valid_access_token(&tokens, &store, &client).unwrap();

        assert_eq!(token, "still-valid");
        assert_eq!(
            client.call_count(),
            0,
            "transparent means no refresh call when still valid"
        );
    }

    #[test]
    fn an_expired_token_triggers_exactly_one_refresh_and_rotates_both_stores() {
        let tokens = Mutex::new(Some(TokenPair {
            access_token: "expired".to_string(),
            refresh_token: "rt-old".to_string(),
            expires_at: now_unix() - 10,
        }));
        let store = FakeTokenStore::default();
        store.save("rt-old").unwrap();
        let client = FakeAuthClient::returning(TokenPair {
            access_token: "new-access".to_string(),
            refresh_token: "rt-new-rotated".to_string(),
            expires_at: now_unix() + 3600,
        });

        let token = get_valid_access_token(&tokens, &store, &client).unwrap();

        assert_eq!(token, "new-access");
        assert_eq!(client.call_count(), 1);
        assert_eq!(
            tokens.lock().unwrap().as_ref().unwrap().refresh_token,
            "rt-new-rotated",
            "in-memory pair must hold the newly rotated refresh token, not the old one"
        );
        assert_eq!(
            store.load().unwrap(),
            Some("rt-new-rotated".to_string()),
            "persisted refresh token must be the newly rotated one, not the old one"
        );
    }

    #[test]
    fn near_expiry_within_safety_margin_also_triggers_a_refresh() {
        let tokens = Mutex::new(Some(TokenPair {
            access_token: "near-expiry".to_string(),
            refresh_token: "rt-old".to_string(),
            expires_at: now_unix() + 30, // inside the 60s safety margin
        }));
        let store = FakeTokenStore::default();
        store.save("rt-old").unwrap();
        let client = FakeAuthClient::returning(TokenPair {
            access_token: "refreshed".to_string(),
            refresh_token: "rt-new".to_string(),
            expires_at: now_unix() + 3600,
        });

        let token = get_valid_access_token(&tokens, &store, &client).unwrap();

        assert_eq!(token, "refreshed");
        assert_eq!(client.call_count(), 1);
    }

    #[test]
    fn a_missing_refresh_token_returns_not_linked_never_panics() {
        let tokens = Mutex::new(None);
        let store = FakeTokenStore::default();
        let client = FakeAuthClient::returning(TokenPair {
            access_token: "unused".to_string(),
            refresh_token: "unused".to_string(),
            expires_at: now_unix() + 3600,
        });

        let result = get_valid_access_token(&tokens, &store, &client);

        assert!(matches!(result, Err(AuthError::NotLinked)));
        assert_eq!(client.call_count(), 0);
    }

    #[test]
    fn a_rejected_refresh_clears_the_stored_token_so_it_is_never_retried() {
        let tokens = Mutex::new(Some(TokenPair {
            access_token: "expired".to_string(),
            refresh_token: "rt-revoked".to_string(),
            expires_at: now_unix() - 10,
        }));
        let store = FakeTokenStore::default();
        store.save("rt-revoked").unwrap();
        let client = FakeAuthClient::default(); // always rejects, per its Default impl

        let result = get_valid_access_token(&tokens, &store, &client);

        assert!(matches!(result, Err(AuthError::RefreshRejected(_))));
        assert_eq!(
            store.load().unwrap(),
            None,
            "a rejected refresh token must be cleared, not left to be retried forever"
        );
    }
}
