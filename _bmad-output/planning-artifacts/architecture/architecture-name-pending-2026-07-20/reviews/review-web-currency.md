# Review — Technology-Currency (web-verified)

- **Target:** `ARCHITECTURE-SPINE.md` (Curfew, 2026-07-20)
- **Lens:** Every committed technology decision reality-checked against the live web, not asserted from stale knowledge. Exists? Maintained? Version current? Fits stated role?
- **Reviewed:** 2026-07-20
- **Web tools:** available (WebSearch / WebFetch used). Items marked "not deep-verified" were sanity-checked but not fetched from a primary source this pass.

## Verdict: **CURRENT** — one watch-item (`triseratops` staleness), no deprecated or mismatched choices.

Every named technology still exists, is actively maintained, and the pinned/named versions are the current defaults for a local-first desktop-agent + managed-Postgres + web shape. Tauri 2 + Next.js 16 + Supabase remain the sensible current stack for this shape. The only substantive finding is that the `triseratops` crate's latest *published* release is ~2.5 years old (a known, already-mitigated risk), and a small terminology drift on "Auth (GoTrue)".

## Per-technology findings

| Name | Claimed in spine | Current finding (2026-07-20) | Verdict | Source |
| --- | --- | --- | --- | --- |
| Tauri | `2.x` | 2.0 went stable 2024-10-02; still the current stable major, patched through 2026. No Tauri 3. Fits local-first desktop agent (Rust core, secure storage, signed static-JSON updater). | CURRENT | v2.tauri.app blog/release; GitHub tauri-apps/tauri releases |
| Rust | `stable` | Stable channel, appropriate for agent core + parsers. | CURRENT | (not deep-verified — non-versioned claim) |
| `triseratops` (Serato parser) | `pinned exact (MPL-2.0)` | **License MPL-2.0 CONFIRMED** from raw `Cargo.toml` (`license = "MPL-2.0"`) — earlier AGPL-3.0 hits from lib.rs/crates.io search summaries were incorrect. **BUT latest published version is `0.0.3`, released 2023-11-30** — pre-1.0, ~2.5 yrs stale on crates.io, and README still warns "under heavy development / breaking API changes." Repo (Holzhaus/triseratops) has later commits than the crates.io release. | CURRENT-w/CAVEAT | raw.githubusercontent Cargo.toml; github.com/Holzhaus/triseratops; lib.rs/crates.io |
| `id3` (crate) | `current` | Latest `1.17.0`, released **2026-05-27**; actively maintained, mature 1.x. | CURRENT | lib.rs/crates/id3 |
| Local store — SQLite via Tauri/Rust | SQLite | Standard, current; embedded SQLite via Tauri/Rust is a well-supported pattern. | CURRENT | (not deep-verified — stable, uncontroversial) |
| Next.js | `16` | 16 stable shipped **2025-10**; current is **16.2.7** (June 2026). Turbopack now default bundler, Cache Components, React Compiler stable. Recommended choice for new projects in 2026. | CURRENT | GitHub vercel/next.js releases; nextjs.org/blog/next-16 |
| React / TypeScript | `current` | Current; React 19 + TS is the Next.js 16 baseline. | CURRENT | (not deep-verified — non-versioned) |
| Supabase — Postgres / Auth (GoTrue) / Realtime / Storage | Auth labeled "GoTrue" | All four services current & managed. **Terminology drift:** the Auth service was rebranded "Supabase Auth (formerly GoTrue)" ~2025; the `GoTrue` name is now legacy (binary still references it internally). Spine's "Auth (GoTrue)" is accurate but slightly dated branding. | CURRENT (minor label) | supabase.com/docs/guides/auth/architecture; github.com/supabase/auth |
| Vercel (web host) | Vercel | Current; standard Next.js host. | CURRENT | (not deep-verified — uncontroversial) |
| `tauri-action` (CI/release) | GitHub Actions | Actively maintained by Tauri Contributors in 2026; added Android/iOS build support; **dropped Tauri v1 & unstable-v2 support** (fine — spine targets v2 stable). Generates signed installers + updater JSON/`.sig`. | CURRENT | github.com/tauri-apps/tauri-action; v2.tauri.app/distribute/pipelines/github |
| PostgREST (auto-gen read API) | auto-generated API | v14 current in 2026; new even-only MAJOR scheme (odd = dev). Maintained; Supabase's API layer. Fits AD-14 read/serve role. | CURRENT | github.com/PostgREST/postgrest releases; postgrest.org |
| Supabase Realtime (Phase 2 feed) | managed WebSockets | Current managed service; correct fit for AD-14 scene feed vs. a self-run socket server. | CURRENT | supabase.com/docs (Realtime) |
| Static-JSON auto-updater (Tauri) | signed static JSON on Releases/S3 | Tauri v2 updater uses a static JSON endpoint + signature; `tauri-action` auto-generates the updater JSON/`.sig`. Fits AD-13 fast-fix delivery. | CURRENT | v2.tauri.app/distribute/pipelines/github (updater JSON/.sig) |

## Watch-items / recommendations

1. **`triseratops` is a pre-1.0, ~2.5-yr-stale published crate** (0.0.3, 2023-11-30) with a standing breaking-change warning. The spine's mitigations are sound and should stay explicit:
   - "pinned exact" is correct; decide **crates.io 0.0.3 vs. a pinned git commit** (repo has newer commits than the last release) and record which.
   - AD-11 already makes the clean-room Rust `.session` parser the *primary* path and uses `triseratops` only for the library DB — good blast-radius containment for a volatile dep. Keep it that way.
   - License claim **MPL-2.0 is accurate** (file-level copyleft, acceptable for a proprietary agent); no AGPL exposure despite conflicting third-party listings.
2. **Auth terminology:** consider updating "Auth (GoTrue)" → "Supabase Auth (GoTrue-derived)" to match current branding. Cosmetic, not a fit problem.
3. Non-deep-verified rows (Rust stable, SQLite-via-Tauri, React/TS, Vercel) are uncontroversial current defaults; flagged here only for honesty about verification depth, not as concerns.

## Note on conflicting sources

lib.rs and crates.io *search summaries* reported `triseratops` as AGPL-3.0-or-later; the **authoritative raw `Cargo.toml` says `MPL-2.0`**, matching the repo LICENSE and the spine. Treat the AGPL reports as summary-model error.
