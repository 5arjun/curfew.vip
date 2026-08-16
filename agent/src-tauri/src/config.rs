//! Build-time Supabase/web-URL config (Story 2.10, Task 2). Values are baked
//! into the binary at compile time via `build.rs`'s `cargo:rustc-env` emission
//! — this is the single place other modules read them from, rather than
//! scattering `env!()` calls. An unset value compiles to an empty string
//! (`build.rs` never fails the build over a missing `.env.local`); callers
//! that need a non-empty config (Tasks 5/6) surface the calm failure copy
//! themselves rather than panicking here.

/// Supabase project URL (e.g. `http://127.0.0.1:54321` for local dev).
pub const SUPABASE_URL: &str = env!("SUPABASE_URL");

/// Supabase publishable (anon) key — safe to embed in a distributed binary,
/// same publishable-key convention `web/`'s `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
/// uses.
pub const SUPABASE_PUBLISHABLE_KEY: &str = env!("SUPABASE_PUBLISHABLE_KEY");

/// Base URL of the `web/` app the "Link Account" tray item opens
/// (`{CURFEW_WEB_URL}/link-agent`). Production value is `https://curfew.vip`
/// — the domain move landed 2026-08-14, so the "deferred to Arjun, no
/// confirmed value" note that stood here is resolved. Still supplied via the
/// environment rather than defaulted in code, so local/dev builds keep
/// pointing at `localhost:3000` without an override.
pub const CURFEW_WEB_URL: &str = env!("CURFEW_WEB_URL");

/// The running build's own version — a compiler-provided env var sourced
/// from `Cargo.toml`'s `[package] version`, unlike the other constants in
/// this file, which need `build.rs`'s `.env.local`/CI-secret plumbing.
/// Tags every [`crate::error_reporting`] event (AD-13/AR-7 layer 2) and is
/// stamped onto every `parse_failures` row (Story 3.4, Task 2) — the value
/// [`crate::backfill::reprocess_parse_failures`] compares against to decide
/// whether a fix has actually shipped since a given failure was recorded.
pub const AGENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Sentry project DSN (Story 3.4, Task 1). The project now exists (a Rust
/// project covering this agent; `web/` has no Sentry project of its own) and
/// the `SENTRY_DSN` repo secret was set 2026-08-01 — both release workflows
/// already pass it into this build, so signed builds report for real. Local
/// dev still leaves it unset unless you add it to `.env.local`, in which case
/// this compiles to an empty string and [`crate::error_reporting`] no-ops
/// everywhere, same "never fail the build over a missing value" treatment
/// as [`CURFEW_WEB_URL`] above.
pub const SENTRY_DSN: &str = env!("SENTRY_DSN");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_version_is_non_empty_and_matches_cargo_toml() {
        assert!(!AGENT_VERSION.is_empty());
        assert_eq!(AGENT_VERSION, env!("CARGO_PKG_VERSION"));
        // set_agent_status rejects versions over 32 chars (errcode 22023) —
        // a longer CARGO_PKG_VERSION (prerelease/build metadata) would kill
        // every heartbeat in prod. Catch it at build time instead (Story
        // 3.10 code review).
        assert!(
            AGENT_VERSION.len() <= 32,
            "AGENT_VERSION {AGENT_VERSION:?} exceeds the DB's 32-char cap"
        );
    }
}
