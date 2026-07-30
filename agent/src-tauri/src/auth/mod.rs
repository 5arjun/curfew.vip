//! Account linking + secure token handling (Story 2.10, AD-10). The agent
//! obtains a Supabase JWT + refresh token via a deep-link handoff from `web/`'s
//! `/link-agent` page (see the story's "Resolved before this story was
//! written" section for why a deep link, not a pairing code) and persists the
//! refresh token via OS-native secure storage — never browser storage, never
//! disk in plaintext.
//!
//! This story builds the capability with no live caller yet (same shape as
//! Story 2.8 building the whole capture pipeline before anything called it):
//! the actual sync path (Story 3.2/3.3) is what will call
//! [`client::get_valid_access_token`]/[`client::current_dj_id`].

/// The `AuthClient` trait + `SupabaseAuthClient` real impl, JWT claim parsing,
/// and the proactive-refresh/`dj_id` logic (Task 5). See [`client`].
pub mod client;
/// The `TokenStore` trait + `KeyringTokenStore` real impl wrapping the OS
/// keychain/Credential Manager/Secret Service (Task 4). See [`store`].
pub mod store;

use std::sync::Mutex;

use client::TokenPair;

/// Tauri-managed state holding the in-memory access/refresh token pair. Only
/// the refresh token is ever persisted (via [`store::TokenStore`]) — the
/// access token lives here only, never written to disk in any form.
#[derive(Default)]
pub struct AuthState {
    pub tokens: Mutex<Option<TokenPair>>,
    /// The one-time CSRF nonce the agent generated for the in-flight "Link
    /// Account" click, if any — `None` once consumed (single-use) or if no
    /// link is currently in flight. Taken (not cloned) by the deep-link
    /// handler so it's cleared regardless of whether the returning URL's
    /// nonce actually matches.
    pub pending_nonce: Mutex<Option<String>>,
}

/// The tokens (+ CSRF nonce) extracted from a `curfew-agent://link?...`
/// deep-link URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkTokens {
    pub access_token: String,
    pub refresh_token: String,
    /// One-time value the agent generated when it opened the browser for
    /// this specific "Link Account" click — echoed back by the web page so
    /// the agent can reject an unsolicited trigger of this same URL shape.
    pub nonce: String,
}

/// A `curfew-agent://link` URL was missing or malformed in a way that must
/// never proceed with an empty/absent token — an empty stored "refresh token"
/// is worse than none: it looks linked but every refresh call will fail.
#[derive(Debug, PartialEq, Eq)]
pub enum LinkUrlError {
    /// Host/path wasn't exactly `link` — reject rather than silently
    /// processing an unrecognized action under this scheme as if it were one.
    UnknownAction,
    MissingAccessToken,
    MissingRefreshToken,
    EmptyAccessToken,
    EmptyRefreshToken,
    /// The CSRF-mitigation nonce (see [`LinkTokens::nonce`]) was absent —
    /// never proceed without one, an empty/missing nonce would defeat the
    /// whole point of checking it.
    MissingNonce,
    EmptyNonce,
}

impl std::fmt::Display for LinkUrlError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LinkUrlError::UnknownAction => write!(f, "link URL is not a recognized action"),
            LinkUrlError::MissingAccessToken => write!(f, "link URL missing access_token"),
            LinkUrlError::MissingRefreshToken => write!(f, "link URL missing refresh_token"),
            LinkUrlError::EmptyAccessToken => write!(f, "link URL has an empty access_token"),
            LinkUrlError::EmptyRefreshToken => write!(f, "link URL has an empty refresh_token"),
            LinkUrlError::MissingNonce => write!(f, "link URL missing nonce"),
            LinkUrlError::EmptyNonce => write!(f, "link URL has an empty nonce"),
        }
    }
}

impl std::error::Error for LinkUrlError {}

/// Parses `access_token`/`refresh_token`/`nonce` out of a `curfew-agent://link`
/// deep link's query string (not a URL fragment — see the story's Task 3
/// rationale: there is no server leg to keep values out of logs of, and
/// fragments parse inconsistently across URL-parsing crates for non-`http(s)`
/// schemes).
///
/// Both `on_open_url` (already-running instance) and a cold-start
/// `get_current()` check converge on this one function so the parsing logic
/// is never duplicated. Only `curfew-agent://link` (host/path exactly
/// `"link"`) is accepted — this is the only action defined under the scheme
/// today, but a future second action reusing these same param names must not
/// be silently misrouted into this one.
pub fn parse_link_url(url: &url::Url) -> Result<LinkTokens, LinkUrlError> {
    if url.host_str() != Some("link") {
        return Err(LinkUrlError::UnknownAction);
    }

    let mut access_token: Option<String> = None;
    let mut refresh_token: Option<String> = None;
    let mut nonce: Option<String> = None;

    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "access_token" => access_token = Some(value.into_owned()),
            "refresh_token" => refresh_token = Some(value.into_owned()),
            "nonce" => nonce = Some(value.into_owned()),
            _ => {}
        }
    }

    let access_token = access_token.ok_or(LinkUrlError::MissingAccessToken)?;
    if access_token.is_empty() {
        return Err(LinkUrlError::EmptyAccessToken);
    }
    let refresh_token = refresh_token.ok_or(LinkUrlError::MissingRefreshToken)?;
    if refresh_token.is_empty() {
        return Err(LinkUrlError::EmptyRefreshToken);
    }
    let nonce = nonce.ok_or(LinkUrlError::MissingNonce)?;
    if nonce.is_empty() {
        return Err(LinkUrlError::EmptyNonce);
    }

    Ok(LinkTokens {
        access_token,
        refresh_token,
        nonce,
    })
}

/// A `curfew-agent://link` URL either failed to parse, its nonce didn't match
/// the one the agent itself generated when it opened the browser, or its
/// access token could not be decoded for an expiry.
#[derive(Debug)]
pub enum LinkError {
    Url(LinkUrlError),
    /// The nonce echoed back by the web page didn't match the one-time value
    /// the agent generated for this specific "Link Account" click (CSRF
    /// mitigation) — reject rather than accept tokens from an unsolicited
    /// `curfew-agent://link` trigger (e.g. a malicious page auto-redirecting
    /// to the same URL shape).
    NonceMismatch,
    Token(client::AuthError),
}

impl std::fmt::Display for LinkError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LinkError::Url(e) => write!(f, "{e}"),
            LinkError::NonceMismatch => {
                write!(
                    f,
                    "link URL nonce did not match the expected one-time value"
                )
            }
            LinkError::Token(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for LinkError {}

/// Resolves a `curfew-agent://link` deep-link URL into a full [`TokenPair`],
/// ready to hand to [`AuthState`]/[`store::TokenStore`]. Both the
/// already-running (`on_open_url`) and cold-start (`get_current()`) paths
/// converge on this one function so parsing + expiry extraction is never
/// duplicated (Task 3).
///
/// `expected_nonce` is the one-time value the agent itself generated when it
/// opened the browser to `/link-agent` for this specific click — the caller
/// is responsible for single-use consumption (taking it out of `AuthState`
/// before calling this, so it's cleared regardless of the outcome here).
pub fn resolve_link_tokens(url: &url::Url, expected_nonce: &str) -> Result<TokenPair, LinkError> {
    let LinkTokens {
        access_token,
        refresh_token,
        nonce,
    } = parse_link_url(url).map_err(LinkError::Url)?;
    if nonce != expected_nonce {
        return Err(LinkError::NonceMismatch);
    }
    let expires_at = client::token_expiry(&access_token).map_err(LinkError::Token)?;
    Ok(TokenPair {
        access_token,
        refresh_token,
        expires_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;

    fn parse(raw: &str) -> Result<LinkTokens, LinkUrlError> {
        parse_link_url(&url::Url::parse(raw).expect("test fixture URL must itself be valid"))
    }

    /// A hand-built, synthetic JWT fixture — never a real Supabase token
    /// (mirrors `client.rs`'s own `fixture_jwt` test-fixture-builder
    /// convention; duplicated here rather than exported since it's test-only).
    fn fixture_jwt(exp: i64, sub: &str) -> String {
        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"none","typ":"JWT"}"#);
        let payload = URL_SAFE_NO_PAD.encode(format!(r#"{{"exp":{exp},"sub":"{sub}"}}"#));
        format!("{header}.{payload}.unverified-signature")
    }

    #[test]
    fn parses_a_well_formed_link_url() {
        let tokens =
            parse("curfew-agent://link?access_token=at-123&refresh_token=rt-456&nonce=nonce-abc")
                .expect("well-formed link URL must parse");
        assert_eq!(tokens.access_token, "at-123");
        assert_eq!(tokens.refresh_token, "rt-456");
        assert_eq!(tokens.nonce, "nonce-abc");
    }

    #[test]
    fn url_decodes_token_values() {
        let tokens =
            parse("curfew-agent://link?access_token=a%2Bb&refresh_token=c%2Fd&nonce=n%2Fn")
                .expect("URL-encoded values must decode");
        assert_eq!(tokens.access_token, "a+b");
        assert_eq!(tokens.refresh_token, "c/d");
        assert_eq!(tokens.nonce, "n/n");
    }

    #[test]
    fn unrecognized_action_host_is_rejected() {
        let err = parse("curfew-agent://not-link?access_token=at-123&refresh_token=rt-456&nonce=n")
            .unwrap_err();
        assert_eq!(err, LinkUrlError::UnknownAction);
    }

    #[test]
    fn missing_access_token_is_an_error_not_a_panic() {
        let err = parse("curfew-agent://link?refresh_token=rt-456&nonce=n").unwrap_err();
        assert_eq!(err, LinkUrlError::MissingAccessToken);
    }

    #[test]
    fn missing_refresh_token_is_an_error_not_a_panic() {
        let err = parse("curfew-agent://link?access_token=at-123&nonce=n").unwrap_err();
        assert_eq!(err, LinkUrlError::MissingRefreshToken);
    }

    #[test]
    fn missing_nonce_is_an_error_not_a_panic() {
        let err =
            parse("curfew-agent://link?access_token=at-123&refresh_token=rt-456").unwrap_err();
        assert_eq!(err, LinkUrlError::MissingNonce);
    }

    #[test]
    fn empty_nonce_is_rejected() {
        let err = parse("curfew-agent://link?access_token=at-123&refresh_token=rt-456&nonce=")
            .unwrap_err();
        assert_eq!(err, LinkUrlError::EmptyNonce);
    }

    #[test]
    fn empty_access_token_is_rejected_not_silently_stored() {
        let err =
            parse("curfew-agent://link?access_token=&refresh_token=rt-456&nonce=n").unwrap_err();
        assert_eq!(err, LinkUrlError::EmptyAccessToken);
    }

    #[test]
    fn empty_refresh_token_is_rejected_not_silently_stored() {
        let err =
            parse("curfew-agent://link?access_token=at-123&refresh_token=&nonce=n").unwrap_err();
        assert_eq!(err, LinkUrlError::EmptyRefreshToken);
    }

    #[test]
    fn no_query_string_at_all_is_an_error() {
        let err = parse("curfew-agent://link").unwrap_err();
        assert_eq!(err, LinkUrlError::MissingAccessToken);
    }

    #[test]
    fn resolve_link_tokens_succeeds_when_nonce_matches() {
        let url = url::Url::parse(&format!(
            "curfew-agent://link?access_token={}&refresh_token=rt-456&nonce=matching-nonce",
            fixture_jwt(1_900_000_000, "dj-123")
        ))
        .unwrap();

        let pair = resolve_link_tokens(&url, "matching-nonce")
            .expect("matching nonce must resolve successfully");
        assert_eq!(pair.refresh_token, "rt-456");
        assert_eq!(pair.expires_at, 1_900_000_000);
    }

    #[test]
    fn resolve_link_tokens_rejects_a_mismatched_nonce() {
        let url = url::Url::parse(&format!(
            "curfew-agent://link?access_token={}&refresh_token=rt-456&nonce=attacker-supplied",
            fixture_jwt(1_900_000_000, "dj-123")
        ))
        .unwrap();

        let err = resolve_link_tokens(&url, "expected-nonce").unwrap_err();
        assert!(matches!(err, LinkError::NonceMismatch));
    }
}
