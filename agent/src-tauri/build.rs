// Build-time Supabase/web-URL config (Story 2.10, AD-10). Mirrors `web/`'s
// `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` convention
// (see `web/README.md#Environment`) with non-`NEXT_PUBLIC_`-prefixed names,
// since this crate isn't Next.js. Loaded here, not at runtime, so the values
// are baked into the binary via `env!()` in `src/config.rs`.
fn emit_build_time_env() {
    // `.env.local` is optional (e.g. CI without local dev secrets yet) — must
    // never fail the build if absent. `from_path` (not `from_filename`,
    // which walks upward through parent directories looking for a
    // same-named file) loads exactly this path with no traversal — a repo
    // can easily have an unrelated `.env.local` at a higher directory level
    // (e.g. `web/`'s or the repo root's), and this must never pick that one
    // up by accident.
    let _ = dotenvy::from_path(".env.local");
    println!("cargo:rerun-if-changed=.env.local");

    for key in ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "CURFEW_WEB_URL"] {
        let value = std::env::var(key).unwrap_or_default();
        println!("cargo:rustc-env={key}={value}");
    }
}

fn main() {
    emit_build_time_env();
    tauri_build::build()
}
