# Addendum: Curfew PRD

Technical-how, mechanism/transport decisions, and depth that informs downstream architecture work but doesn't belong in the PRD's capability-level narrative. Source: technical architecture research (`technical-dj-stats-platform-end-to-end-system-architecture-serato-app-web-research-2026-07-17.md`) and domain research (`domain-serato-history-file-parsing-metadata-research-2026-07-07.md`), confirmed against Arjun's decisions during PRD discovery.

## Backend / Storage

- Supabase: Postgres + Auth (GoTrue) + PostgREST + Realtime + Storage.
- Per-DJ data isolation enforced via Row-Level Security, `auth.uid() = dj_id` — realizes PRD's "per-DJ data isolation enforced server-side" capability requirement (Constraints and Guardrails).
- Frontend: Next.js on Vercel.

## Local Agent

- Tauri 2 (Rust). Watches Serato History folder (`fs` plugin / `notify` crate), scoped to the configured Serato data path only — no broader disk access.
- Local SQLite cache for offline queueing and raw-data retention (supports backfill if a format-drift bug is later fixed).
- Two parser paths: clean-room Rust `.session` parser (chunked binary format, fields verified against sample) + `triseratops` crate (Rust, MPL-2.0 — confirm license terms with counsel before shipping, not just noting the SPDX identifier) for library DB/GEOB tags, + `id3` crate for embedded ID3 tags. `triseratops` is under heavy development with explicit breaking-API-change warnings upstream — pin the version and gate upgrades behind the golden-file test suite (see Format-Drift Mitigation), don't float on latest.
- Serato 4+ stores its library as `master.sqlite` (standard SQLite) rather than the legacy binary `database V2` format — the parser needs to handle both, not just V2. Verify which format a given DJ's install uses before assuming V2's field layout applies.
- Post-set batch sync is the v1 default (not live/streaming watch) — simpler, matches "auto-sync after each detected set" requirement without needing to handle mid-set partial data.

## Sync Protocol

- Idempotent `PUT /sets/{set_id}` over HTTPS/JWT.
- Derived-only JSON payload: `set_id`, `dj_id`, `played_at`, `tracks[]` (`bpm`, `key`, `camelot`, `in_library` flag), `derived.energy_arc`, `derived.key_compat_score`, `derived.library_utilization`.

## Format-Drift Mitigation

- Golden-file CI tests against checked-in `.session` + library DB fixtures — catches Serato format changes before they silently corrupt synced data.
- Signed auto-updater (Tauri) ships parser fixes fast without requiring manual DJ reinstall.
- Field validation alone only catches drift caught in CI, before release. Production-side detection (e.g. Sentry-style error reporting from the agent, tagged with an `agent_version`) closes the loop for drift that only shows up on a real DJ's machine post-release — needed to complete this mitigation, not just the pre-release half.

## Build Sequencing (engineering practice, distinct from product phasing)

Technical research recommends validating the parser against real multi-track session data locally (no cloud, no certs) before wiring up Supabase sync — de-risks the highest-uncertainty piece (parsing correctness, Open Question 1) before paying for cloud/signing infrastructure. This is an internal engineering milestone, not a product phase: Phase 1 (PRD §9) still ships with the web dashboard, which requires sync to exist. Practically: get the parser passing against real gig data first, then build the sync pipeline on top of a parser you already trust.

## Fixed Cost: Code-Signing

- Beyond marginal per-DJ cost (§5.3 of the PRD, near-zero), code-signing is a real **fixed** cost gate before the agent can ship at all: Apple Developer Program enrollment (macOS notarization) + a Windows code-signing certificate (EV strongly preferred to avoid SmartScreen friction). Exact current pricing not confirmed in research — verify before committing to a launch budget.

## Path-Join Complexity (feeds FR-2)

- Session file stores absolute paths; library DB stores relative paths (0% absolute in sampled DB) — join requires resolving against the library root, not naive string matching.
- Off-library tracks (never imported into Serato's library) get zero DB match — sampled play was 100% off-library, which "overstates the real rate but proves the failure mode is live" per research. Confirms FR-2's tag-fallback path is load-bearing, not an edge case.

## Platform / Code-Signing

- macOS: Developer ID + notarization required for Gatekeeper.
- Windows: code-signing required to avoid SmartScreen warnings (EV cert = instant trust; OV = cheaper, shows warning until reputation builds).

## Venue Auto-Suggest (feeds FR-18)

- Requires OS-level location permission on the local agent (opt-in, off by default).
- Reverse-geocoding provider not yet chosen — options include Google Places, Apple Maps, or OpenStreetMap Nominatim. Trade-off (cost vs. accuracy vs. attribution requirements) deferred to architecture phase.
- Suggestion only, never silent auto-fill — dense nightlife blocks (multiple venues per building) make blind auto-attribution unreliable.

## Open Item: "Date Added to Library" Field

- Library Utilization (FR-11–FR-13) depends on a reliable "date added to library" timestamp from Serato's library DB. Domain research's field-coverage table (measured across 4,974 tracks) didn't explicitly confirm this field's presence/coverage rate — needs direct verification during architecture/parser implementation, not assumed solid.

## Field Coverage (measured, n=4,974 tracks, one real library)

Baseline for FR-2/FR-6 and for SM-C1's "Unknown rate must stay honestly visible" — these are the actual observed rates, not assumptions:

- BPM (`tbpm`): 100.0% (4972/4974)
- Key (`tkey`): 98.8% (4912/4974), Camelot-ready notation, 53 distinct keys
- Title/file path (`tsng`/`pfil`): 100%
- Artist (`tart`): 89.2% — FR-6's "most played artists" stat has no stated Unknown-fallback behavior for the ~11% gap; worth deciding during UX/architecture.
- Genre (`tgen`): 80.4% overall, but **collapses hard by file type even for in-library tracks**, independent of the taxonomy-dirtiness issue FR-8 already addresses: WAV/AIFF measured at 0% genre coverage, QuickTime-container files at 25%, vs. MP3 at 80.7%. A DJ whose library is WAV-heavy will see materially worse genre stats than one on MP3 — this isn't a long-tail edge case, it's a file-type-correlated gap FR-6/FR-9/FR-24 should account for (Unknown display per FR-2, not a silently thin chart).
- Genre taxonomy is dirty at the string level: 169 distinct raw genre strings feed FR-8's normalization table, with a 419-track "Other" bucket in the sampled library — sets the scale of what the fixed mapping table needs to cover.
- Release year (`ttyr`): 78.4%.

## WAV Embedded-Tag Fallback Risk (feeds FR-2)

FR-2's off-library fallback path (embedded GEOB/ID3 tags) is verified for MP3/AIFF/FLAC/MP4 in the research's format table, but **WAV is not listed** as a confirmed-supported embedded-tag format. This matters because the one real off-library play in the research sample was itself a `.wav` file — exactly the case FR-2's fallback exists to handle. Needs direct verification during parser implementation of whether WAV embedded tags (if any) are readable, or whether WAV off-library tracks fall through to "Unknown" more often than other formats.
