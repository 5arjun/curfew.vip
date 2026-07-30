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
/// (`{CURFEW_WEB_URL}/link-agent`). No confirmed production value yet — the
/// `curfew.vip` domain move is deferred to Arjun; release builds must supply
/// this via the environment until then.
pub const CURFEW_WEB_URL: &str = env!("CURFEW_WEB_URL");
