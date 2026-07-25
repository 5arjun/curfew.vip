---
baseline_commit: 0c78794c3f0cc742cdafeb69c07a25c33b3828ad
---

# Story 1.8: Live/practice confidence signal

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the system,
I want a live-vs-practice classification confidence computed per session from Phase 1 onward, with no user-facing prompt,
So that the signal exists for later use (Phase 2 confirmation; Epic 4 trend exclusion) without gating anything now.

## Acceptance Criteria

1. **Given** a parsed session, **When** classified, **Then** a confidence value is computed and stored. *(FR-27)*
2. **Given** Phase 1, **Then** no confirmation prompt is shown **And** the DJ's own dashboard is never gated by this signal. *(FR-27)*
3. **Given** the Epic 4 decision to exclude low-confidence sessions from Style Evolution **visibly** (a reveal, never a silent erase), **Then** the signal is exposed in a form Epic 4 can both filter on **And** surface an "N sessions hidden — show them?" affordance from. *(Resolved 2026-07-20: exclude-**visibly**; PRD-sync owed)*
4. **Given** distinguishing home rehearsal from a live gig by data alone, **Then** it is out of scope — the signal is a heuristic confidence, not ground truth. *(FR-27 scope)*

### Scope boundaries (binding — read before writing code)

- **This is a SESSION-level classification, not a per-set stat and not a segment-detection algorithm — don't conflate the three.** Story 1.7 computes stats over a *set*; Epic 5/AD-17 will eventually detect *windows* (segments) inside a set; this story classifies a whole *session* (AD-16's immutable anchor — the raw unit before any set/segment boundary decision). The input is a whole session's `&[stats::EnrichedPlay]`, in the chronological order Story 1.7's `enrich_session` already guarantees (do not re-sort).
- **`stats/mod.rs`'s own module doc already reserves this exact story and explicitly rules out where it does NOT live**: *"the FR-27 live/practice confidence signal (Story 1.8, the very next story) — a session-level classification, not a per-set stat, so no confidence field is added to any type here."* Honor that: do not add a `confidence` field to `EnrichedPlay`, `JoinedMetadata`, or `Play` — all three are frozen by their owning stories. This story's own new type is the only place a confidence value lives.
- **No UI, no confirmation prompt, no gating logic (AC-2).** Per PRD FR-27 notes, "this FR's actual gate (visibility to others) has nothing to protect until Phase 2's feed/comparisons ship — in Phase 1, every session is dashboard-only regardless of classification confidence, so the confirmation prompt never fires." AC-2 is satisfied **by omission** — there is no watcher, no local store, and no web surface yet for a prompt to attach to (same situation Story 1.7's `enrich_session` shipped in, with no live caller). Do not build a prompt, a dialog, or any gating branch — there is nothing correct to gate yet.
- **No persistence.** No local SQLite store exists yet (Epic 2 Story 2.8) and no `shared/` sync-contract field for confidence exists yet (Story 1.10). This story's job ends at producing a typed in-memory value from a `&[EnrichedPlay]`, exactly like Story 1.7's own Persistence boundary. Do not add fields to `shared/src/index.ts` / `shared/schema/sync-payload.schema.json`, and do not write to SQLite.
- **No per-DJ historical calibration.** AD-17 (Epic 5's segment detection) calibrates its density/BPM floors from a DJ's own historical plays — that requires a local store of past sessions, which doesn't exist yet at this point in the build (Story 2.8 hasn't landed), and AD-17 itself is explicitly Epic 5's territory, not this story's. Do not import or depend on AD-17's windowing/density/BPM-floor/transition-smoothness machinery here — this story ships a simpler, uncalibrated, session-level heuristic. A future story can revisit once real history exists to calibrate against, the same "ship a default now, refine later" discipline Story 1.6 used for its taxonomy content.
- **The heuristic is explicitly *not* claiming to solve an unsolved problem (AC-4).** PRD FR-27's own research note: *"Reliably distinguishing a realistic home rehearsal from a real live gig by data alone — research found no available signal (Serato's own 'Played' flag fires identically in Practice Mode) and no comparable tool in this space has solved it."* This module computes a **heuristic confidence** (how classifiable the session's play pattern is, not "is this definitely live"), never a ground-truth label. Don't name anything `is_live`/`is_practice` — name it around *confidence*, matching the FR and the story title.
- **Exact thresholds are this story's one open design decision — ship a sensible default, flag it (like every prior story's open content/shape questions).** No PRD, epic, or architecture doc locks a numeric threshold or formula for this signal anywhere (confirmed by search — the only "threshold" hits nearby are Story 4.3's unrelated 90-day window and Story 4.4's unrelated 30-day nudge). Task 3 below gives a concrete recommended default; Open Questions #1 flags it for Arjun.

## Tasks / Subtasks

- [x] **Task 1 — Define the `confidence` module + `classify` entrypoint** (AC: 1, 4)
  - [x] Create `agent/src-tauri/src/confidence.rs` as a **flat single file**, mirroring `genre.rs`'s pattern (one pure concern, one entrypoint) — not a directory like `stats/`/`joiner`/`parser`, which each hold several independently-testable sub-concerns; this story has exactly one.
  - [x] Register `pub mod confidence;` in `agent/src-tauri/src/lib.rs` next to the existing `pub mod genre;` / `pub mod joiner;` / `pub mod parser;` / `pub mod stats;`, with a doc comment explaining it is **not** a sequential stage in the documented pipeline (`watcher -> parser -> joiner -> stat-engine -> local store -> sync-queue`) but a sibling consumer of the same `stats::EnrichedPlay` output the stat-engine produces — it classifies the session those plays came from, in parallel with (not instead of) Story 1.7's per-set stats. Update the pipeline doc-comment line in `lib.rs` to note this (a parenthetical is enough — do not restructure the arrow-chain; confidence doesn't feed local store/sync-queue in this story).
  - [x] Define:
    ```rust
    #[derive(Debug, Clone, Copy, PartialEq)]
    pub struct SessionConfidence {
        /// 0.0 = most ambiguous (dense, continuous, no natural break — could be a
        /// real set or a realistic home rehearsal, per PRD FR-27), 1.0 = most
        /// confidently classifiable (either "obviously a real set" or "obviously
        /// not a set"). A heuristic proxy, never a ground-truth live/practice label
        /// (AC-4).
        pub confidence: f64,
        /// Total plays considered (transparency for callers/tests — mirrors why
        /// `CamelotMixingStats` exposes its three counts instead of a pre-divided
        /// rate).
        pub track_count: usize,
        /// How many consecutive-play gaps met or exceeded the "long gap" threshold.
        pub long_gap_count: usize,
    }
    ```
  - [x] Write `pub fn classify(plays: &[crate::stats::EnrichedPlay]) -> SessionConfidence`. **Total and infallible** — same idiom as `genre::normalize`/`stats::bpm_distribution`: every input (including an empty slice) has a defined output, no `Result`, no panic path.

- [x] **Task 2 — Session shape signals** (AC: 1)
  - [x] **Reuse, don't reimplement**: call `crate::stats::track_count(plays)` for the play count — do not re-derive `plays.len()` separately.
  - [x] Compute consecutive-play gaps: collect `plays.iter().filter_map(|p| p.start_time)` (preserves the existing chronological order — `enrich_session` guarantees it, so this function must not re-sort), then walk consecutive pairs with `saturating_sub` (never panic on an out-of-order value, mirroring `stats::set_length_sec`'s same discipline) to get each gap in seconds.
  - [x] Plays with `start_time: None` are simply absent from the gap walk (skipped, not treated as zero-length gaps) — a documented approximation, not a silent guess, since a play's *position* in the session is still known even when its exact timestamp isn't.
  - [x] **Fewer than 2 known start_times → gaps are unknowable.** Do not divide by zero or index out of bounds; this case degrades to Task 3's safe default.

- [x] **Task 3 — Confidence heuristic** (AC: 1, 4 — the story's one open design decision; see Open Questions #1)
  - [x] Recommended default constants (name them, document each as `[ASSUMPTION]`, first-ever numbers proposed for this signal — no prior doc locks them):
    ```rust
    /// Fewer real plays than this is confidently "not a set" (PRD FR-27's own
    /// example: "a single track briefly cued"). [ASSUMPTION]
    const MIN_PLAYS_FOR_AMBIGUITY: usize = 4;
    /// A consecutive-play gap at/above this is a "long gap" — PRD FR-27's own
    /// framing: "dense, continuous play with no long gaps" is the ambiguous case.
    /// [ASSUMPTION]
    const LONG_GAP_THRESHOLD_SEC: u32 = 300; // 5 minutes
    /// The confidence value for the dense/continuous ambiguous case. Not 0.0 —
    /// this is a heuristic proxy, never a claim of certainty in either direction
    /// (AC-4). [ASSUMPTION]
    const LOW_CONFIDENCE_VALUE: f64 = 0.2;
    ```
  - [x] Tiering (mirrors the PRD's own worked examples almost verbatim):
    1. `track_count < MIN_PLAYS_FOR_AMBIGUITY` → `confidence = 1.0` (obviously not a set — confidently classifiable, high confidence).
    2. Fewer than 2 known `start_time`s (gaps unknowable, Task 2) → `confidence = 1.0` (safe default — never manufacture an "ambiguous" reading from data that can't support it).
    3. `track_count >= MIN_PLAYS_FOR_AMBIGUITY` **and** zero gaps `>= LONG_GAP_THRESHOLD_SEC` → `confidence = LOW_CONFIDENCE_VALUE` (dense, continuous, no natural break — the PRD's explicitly-named ambiguous case).
    4. Otherwise (at least one long gap present) → `confidence = 1.0` (naturally punctuated — confidently classifiable as a real set).
  - [x] Doc-comment this function heavily with the "heuristic proxy, not ground truth" framing from AC-4 and the Scope Boundaries section — a future reader must not mistake `confidence` for a live/practice probability.

- [x] **Task 4 — Unit tests** (AC: all)
  - [x] Inline `#[cfg(test)] mod tests` in `confidence.rs` — same convention as every prior story; no `tests/` dir, no new `[dev-dependencies]`.
  - [x] Each test carries a `///` doc comment citing the AC/scope rule it proves — house style, see `genre.rs`/`stats/mod.rs`.
  - [x] Cover at minimum:
    - **(AC-1)** `track_count < MIN_PLAYS_FOR_AMBIGUITY` (e.g. 1-2 synthetic plays) → `confidence == 1.0`.
    - **(AC-1, AC-4)** `track_count >= MIN_PLAYS_FOR_AMBIGUITY`, consecutive `start_time`s all closely spaced (all gaps `< LONG_GAP_THRESHOLD_SEC`) → `confidence == LOW_CONFIDENCE_VALUE`, `long_gap_count == 0`.
    - **(AC-1)** same play count, but one gap `>= LONG_GAP_THRESHOLD_SEC` → `confidence == 1.0`, `long_gap_count >= 1`.
    - **(Task 2)** fewer than 2 plays with a known `start_time` (including all-`None`) → `confidence == 1.0`, no panic.
    - **(Task 1)** empty `plays` slice → defined output, no panic.
    - **(determinism)** running `classify` twice over the same input yields identical output — mirrors `genre::normalize_is_deterministic`/`stats`'s own determinism test.
  - [x] Gate: `cargo fmt --manifest-path agent/src-tauri/Cargo.toml -- --check`, `cargo clippy --manifest-path agent/src-tauri/Cargo.toml --all-targets -- -D warnings`, `cargo build --manifest-path agent/src-tauri/Cargo.toml`, `cargo test --manifest-path agent/src-tauri/Cargo.toml`. If this machine lacks a Rust toolchain, do not skip the gate silently — log it to `deferred-work.md` and get it run on a macOS/CI box before merge, per this project's standing discipline (Stories 1.5/1.6 both hit this).

## Review Findings

- [x] [Review][Defer] Dense/continuous tier can fire off a low ratio of known-timestamps to total plays, and has no density/rate ceiling — both already reproduced on real data in this diff's own deferred-work.md entry. — Edge Case Hunter and Blind Hunter independently found that (a) a session with a large `track_count` but very few known `start_time`s (e.g. 2 known out of 200 plays) has its entire tier decided by that 2-point sample, and (b) a very-high-density/short-duration session (rapid library previewing) scores the same `LOW_CONFIDENCE_VALUE` as an ordinary dense set — not theoretical, this is the exact 865-play/~27.5-minute session already logged in this diff's `deferred-work.md` entry. [agent/src-tauri/src/confidence.rs:104-132] — deferred: already logged, thresholds are Arjun's call (Open Questions #1), not a code guess (AD-11 discipline)
- [x] [Review][Patch] `SessionConfidence.confidence` field doc contradicts its own constant's doc on the meaning of `0.0`. [agent/src-tauri/src/confidence.rs:74-77]
- [x] [Review][Patch] Dev Agent Record's File List omits two files the diff actually modifies (`deferred-work.md`, `sprint-status.yaml`). [_bmad-output/implementation-artifacts/1-8-live-practice-confidence-signal.md]
- [x] [Review][Patch] `long_gap_count` doc doesn't disclose that `start_time: None` plays are filtered out before pairing, so two plays far apart in real order can be counted as one gap post-filter. [agent/src-tauri/src/confidence.rs:83]
- [x] [Review][Patch] Untested boundary at `track_count == MIN_PLAYS_FOR_AMBIGUITY - 1` (3 plays) — tests cover 2 and 4 plays but never the exact tier-flip boundary. [agent/src-tauri/src/confidence.rs tests]
- [x] [Review][Patch] `lib.rs` retains a stale Story-1.1 sentence ("this story only proves the shell compiles...") in the same paragraph this diff edited to add the `confidence` module note. [agent/src-tauri/src/lib.rs:8-9]
- [x] [Review][Defer] No guard against a violated `start_time`-sorted-order invariant — mirrors Story 1.7's already-deferred `enrich_session` pairing-order issue; `count_long_gaps`'s `saturating_sub` silently reads a reversed pair as a 0-second gap instead of surfacing corrupted/out-of-order input. No live caller yet, same situation as the 1.7 precedent. [agent/src-tauri/src/confidence.rs:138-143] — deferred, pre-existing pattern

## Dev Notes

### Why this story exists now, and what it deliberately does not do

Story 1.7's own module doc named this story explicitly and drew the line: FR-27's confidence signal is "a session-level classification, not a per-set stat," with "no confidence field... added to any type" in `stats/mod.rs`. This story is that named follow-up. It is small and self-contained by design: one new pure function over data Story 1.7 already assembles, no new dependency, no wiring into a pipeline that doesn't exist yet (no watcher, no local store — both Epic 2). Resist the temptation to build anything AC-2 doesn't ask for (a prompt, a gate, a UI) — there is nothing for it to gate yet, and building it now would be scope creep the epic itself defers to Phase 2.

### Why the heuristic is what it is (and why it's *not* AD-17's approach)

AD-17 (Epic 5, segment detection) and this story both classify DJ play patterns, but they solve different problems at different granularities, and it would be a mistake to reach for AD-17's machinery here:

- **AD-17** finds *where inside a set* the dancefloor segment is, using windowed density + median BPM **calibrated from that DJ's own historical plays**, confirmed by transition-smoothness. It needs per-DJ history (a local store of past sessions) to calibrate against, and BPM data.
- **This story** classifies *the whole session* as confidently-classifiable vs. ambiguous, with **no history to calibrate from** (Story 2.8's local store doesn't exist yet) and using only what Story 1.7's `EnrichedPlay` already carries: play count and start-time gaps. It deliberately does not touch BPM, genre, or Camelot data — PRD FR-27's own worked example ("dense, continuous play with no long gaps") is phrased entirely in terms of *density and gaps*, not tempo or genre, so the recommended default follows that framing directly rather than inventing a richer signal the PRD doesn't ask for.

The two are complementary, not redundant: Epic 5 will eventually be able to *use* this session-level signal (e.g. to decide whether it's worth looking for a dancefloor segment at all), but that wiring is out of scope here.

### Frozen types this story must NOT change

- **`crate::stats::EnrichedPlay`** (`stats/mod.rs`) — read-only input. Do not add a `confidence` field.
- **`crate::joiner::JoinedMetadata`**, **`crate::parser::Play`**, **`crate::genre::NormalizedGenre`** — untouched transitively; this story doesn't read them directly at all, only `EnrichedPlay`.
- This story's own `SessionConfidence` is the only new type it may freely design.

### Established idioms to follow (from Stories 1.3-1.7)

- **Infallible-by-design**: `classify` is total — no `Result`, no error enum, defined output for every input including the empty-slice edge case.
- **No `.unwrap()`/`.expect()` on production paths** — `.expect()` only in tests.
- **Deterministic**: no randomness, no hash-iteration-order dependence (this story doesn't need a `HashMap` at all, unlike Story 1.7's ranking functions).
- **Heavy, rationale-first doc comments**: a `//!` module doc for `confidence.rs` naming what it is (FR-27's session-level classification), its invariants (heuristic-only, deterministic, arithmetic-only — no ML/audio DSP, mirroring `genre.rs:51` and `stats/mod.rs`'s own "arithmetic-only" lines), and what it deliberately does not do (no UI, no persistence, no calibration, no AD-17 machinery).
- **`#[derive(Debug, Clone, PartialEq)]`** baseline on `SessionConfidence` (add `Copy` too — it's small and has no owned heap data, unlike `EnrichedPlay`).

### A real gotcha carried from Story 1.7 (read before writing gap logic)

`parser::serato4::read_session` always leaves `path: None`, but `start_time` is populated normally for Serato 4+ (unlike `path`) — so start_time-based gap computation is safe for both formats. However, a play can still degrade to `start_time: None` on an out-of-range value (`parser/serato4.rs`'s `out_of_range_start_time_is_none_not_a_panic` test documents this). Task 2's `filter_map` approach already handles this correctly — just don't replace it with an indexed loop that assumes every play has a `start_time`.

### Testing standards

Same bar as Stories 1.3-1.7: synthetic in-test fixtures only (hand-built `EnrichedPlay` values via helper constructors — reuse the pattern in `stats/mod.rs`'s own test module if convenient, or write a minimal local one), inline `#[cfg(test)]`, one test per AC/scope-boundary rule plus a determinism test, no committed real data, no new dev-dependencies, full four-command crate gate stays green.

### Git intelligence

Recent per-story shape (Stories 1.4-1.7): spec commit → implementation commit → code-review commit (sometimes two passes) → merge. Expect the same shape here. This story is smaller than 1.7 (one function, one heuristic, no assembly step) — closer in size to Story 1.6's single-concern `genre.rs` than to 1.7's multi-concern `stats/` directory, which is exactly why it's a flat file, not a new directory.

### Project Structure Notes

- **New:** `agent/src-tauri/src/confidence.rs` (the `SessionConfidence` type, `classify`, module doc, tests).
- **Modified:** `agent/src-tauri/src/lib.rs` (add `pub mod confidence;` with a doc comment; update the pipeline doc-comment line to note this module's relationship to the stat-engine stage).
- **Untouched:** `agent/src-tauri/src/stats/*` (frozen — call `stats::track_count`, don't reimplement), `agent/src-tauri/src/joiner/*`, `agent/src-tauri/src/parser/*`, `agent/src-tauri/src/genre.rs`, `shared/`, `web/`, `.github/workflows/ci.yml` (no changes expected — same reasoning as every prior Epic 1 story: new in-crate module, existing `agent` CI job already covers it), `agent/src-tauri/Cargo.toml` (no new dependency expected — pure `std` arithmetic, same as Story 1.7).
- **Possibly modified:** `_bmad-output/implementation-artifacts/deferred-work.md` — only if implementation surfaces a real gap worth logging (e.g. the "no calibration yet" limitation, if it feels worth a durable cross-story record); optional, dev's call.

### References

- [epics.md — Story 1.8, Epic 1 overview, FR-27 lineage, Story 4.1's consumption of this signal](../planning-artifacts/epics.md)
- [ARCHITECTURE-SPINE.md — AD-16 (session is the immutable anchor — this story classifies at that granularity), AD-17 (segment detection — a different, more sophisticated, calibrated approach at a different granularity; context only, not implemented here)](../planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md)
- [SOLUTION-DESIGN.md — §3.6 "Finding the dancefloor" (AD-17's validated density+BPM+smoothness approach, the precedent this story deliberately does NOT reuse at session granularity)](../planning-artifacts/architecture/architecture-name-pending-2026-07-20/SOLUTION-DESIGN.md)
- [prd.md §4.1 FR-27 (full text: the "dense, continuous play, no long gaps" ambiguous case, the "single track briefly cued" obviously-not-a-set case, the "no comparable tool has solved it" research note), §4.3 FR-9 (Story 4.1's consumption), §10 SM-C3 (why a loosened confidence gate damages trust more than a quiet feed)](../planning-artifacts/prds/prd-name-pending-2026-07-19/prd.md)
- [1-7-core-per-set-stat-engine.md — previous story; the `EnrichedPlay` type this story consumes, and the module-doc line that explicitly names this story as the next one](./1-7-core-per-set-stat-engine.md)
- [agent/src-tauri/src/stats/mod.rs — `EnrichedPlay`, `track_count`, `set_length_sec`; the module doc's explicit carve-out for this story](../../agent/src-tauri/src/stats/mod.rs)
- [agent/src-tauri/src/genre.rs — the flat single-concern module pattern this story's `confidence.rs` mirrors](../../agent/src-tauri/src/genre.rs)
- [agent/src-tauri/src/parser/serato4.rs — confirms `start_time` (unlike `path`) is normally populated for Serato 4+, and its out-of-range-degrades-to-`None` behavior](../../agent/src-tauri/src/parser/serato4.rs)
- [agent/src-tauri/src/lib.rs — crate root; register `pub mod confidence;` here, update the pipeline doc-comment line](../../agent/src-tauri/src/lib.rs)

## Open Questions / Assumptions
*(None block starting the story — reasonable defaults chosen; flagged for Arjun's confirmation before/during implementation.)*

1. **[DESIGN — needs Arjun] Exact confidence heuristic/thresholds.** No PRD/epic/architecture doc locks a numeric formula or threshold for this signal — this story is the first to propose one. Recommended default (Task 3): `MIN_PLAYS_FOR_AMBIGUITY = 4`, `LONG_GAP_THRESHOLD_SEC = 300` (5 min), `LOW_CONFIDENCE_VALUE = 0.2`, tiered per PRD FR-27's own worked examples. Confirm or adjust — ideally by eyeballing the tiering against a slice of Arjun's own real 474-session Serato history (the same corpus AD-17 was validated against), though no automated harness wires that up in this story.
2. **[DESIGN — recommend deferring] Should "obviously not a set" (too few plays) get a distinct value from "confidently a real set" (long, gappy session)?** The recommended default maps both to `confidence = 1.0` (confidence is symmetric — "how sure," not "which direction"). `SessionConfidence` already exposes `track_count`/`long_gap_count` so a caller wanting to distinguish the two cases can, without a second field. Revisit only if Epic 4's UI or Phase 2's prompt copy ends up needing to say *why* a session was confident, not just that it was.
3. **[PRODUCT — carried forward] The confirmation-prompt cutoff (Phase 2) and Story 4.1's trend-exclusion cutoff are separate, later decisions.** This story ships the raw `confidence` value only; it does not decide what threshold either downstream consumer applies. Flag for whoever implements Phase 2's FR-27 prompt or Story 4.1's exclusion filter.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- Full four-command cargo gate run on this machine via the pre-installed but unlinked `rustup` toolchain (`/Users/arjun/.rustup/toolchains/stable-aarch64-apple-darwin/bin`, not on `PATH` by default): `cargo fmt -- --check`, `cargo clippy --all-targets -- -D warnings`, `cargo build`, `cargo test`. Gate was **not** deferred — no toolchain-missing situation this time, unlike Stories 1.5/1.6.
- `cargo fmt -- --check` failed once on the test module's `enriched(None), enriched(None), enriched(None), enriched(None)]` vec literal exceeding line width; fixed by running `cargo fmt` (rustfmt reflowed it to one element per line).
- `cargo clippy` flagged `clippy::if_same_then_else` on the initial four-tier `if`/`else if` chain (tiers 1, 2, and 4 all returned the same `1.0` literal). Collapsed to a single inverted boolean condition (`if track_count >= MIN_PLAYS_FOR_AMBIGUITY && start_times.len() >= 2 && long_gap_count == 0 { LOW_CONFIDENCE_VALUE } else { 1.0 }`) — same tiering semantics (all four cases from Task 3 still produce the documented output), expressed without duplicate branches. Re-ran fmt+clippy clean after the fix.
- Final gate: `cargo test` → 126 passed (120 pre-existing + 6 new in `confidence::tests`), 0 failed.

### Completion Notes List

- Implemented `agent/src-tauri/src/confidence.rs`: `SessionConfidence` struct (`confidence`, `track_count`, `long_gap_count`) and `pub fn classify(plays: &[EnrichedPlay]) -> SessionConfidence`, total and infallible per the established `genre::normalize`/`stats::bpm_distribution` idiom.
- `classify` reuses `stats::track_count` (no reimplementation), computes consecutive-play gaps via `filter_map(|p| p.start_time)` + `.windows(2)` + `saturating_sub` (never re-sorts, never panics on an out-of-order value), and applies the Task 3 tiering: too-few-plays, gaps-unknowable, and long-gap-present all map to `confidence = 1.0`; only the dense/continuous/zero-long-gap case (with ≥`MIN_PLAYS_FOR_AMBIGUITY` plays and ≥2 known start times) maps to `LOW_CONFIDENCE_VALUE` (0.2) — confidence is symmetric per Open Questions #2, not directional.
- Registered `pub mod confidence;` in `lib.rs` with a doc comment clarifying it is a sibling consumer of `stats::EnrichedPlay`, not a sequential pipeline stage; updated the pipeline doc-comment line with a parenthetical noting the same, without restructuring the arrow-chain.
- 6 new inline tests in `confidence.rs` covering: too-few-plays, dense/continuous (low confidence), one-long-gap (high confidence), fewer-than-two-known-start-times (including all-`None`, no panic), empty slice, and determinism. Each carries a doc comment citing the AC/task it proves.
- No UI, no persistence, no gating logic, no AD-17 calibration machinery added — all per the story's binding Scope Boundaries. No new dependency. `stats::EnrichedPlay`/`joiner`/`parser`/`genre`/`shared`/CI untouched, confirmed by the File List below.
- Open Questions #1 (exact thresholds) ships the story's recommended defaults verbatim (`MIN_PLAYS_FOR_AMBIGUITY = 4`, `LONG_GAP_THRESHOLD_SEC = 300`, `LOW_CONFIDENCE_VALUE = 0.2`), each flagged `[ASSUMPTION]` in the doc comment for Arjun's confirmation — not independently re-derived or adjusted by this implementation.
- **Validated against real data, per Open Questions #1's suggestion.** Ran `classify` over all 489 real sessions in `~/Library/Application Support/Serato/Library/master.sqlite` via a throwaway (not committed) `cargo run --example` script: no panics, 174 sessions (35.6%) scored `LOW_CONFIDENCE_VALUE`, 315 (64.4%) scored `1.0`. Surfaced one real edge case worth flagging for the eventual threshold review — an 865-play session spanning only ~27.5 minutes (rapid library previewing, not real track changes, per its `played=1` rows) scores the same low-confidence tier as an ordinary dense set, since the heuristic has no density/upper-bound signal. Not fixed (thresholds are Arjun's call, AD-11 forbids guessing a new rule); logged to `deferred-work.md`.

### File List

- `agent/src-tauri/src/confidence.rs` (new)
- `agent/src-tauri/src/lib.rs` (modified — registered `pub mod confidence;`, updated pipeline doc-comment)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified — logged the real-data density/short-duration edge case found during validation)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — status log entries)

## Change Log

| Date | Change |
|---|---|
| 2026-07-24 | Story 1.8 context-engineered (live/practice confidence signal): new `confidence.rs` module classifying a whole session's `Vec<EnrichedPlay>` into a heuristic `SessionConfidence` (dense/continuous-no-long-gap sessions score low, per PRD FR-27's own worked example; too-few-plays and gappy sessions both score high, since confidence is symmetric, not directional); explicitly scoped away from AD-17's calibrated segment-detection machinery (different granularity, no history to calibrate from yet) and from any UI/persistence (AC-2 satisfied by omission — no consumer wired yet, matching Story 1.7's `enrich_session` precedent). No new dependency; `stats::EnrichedPlay`/`joiner`/`parser`/`genre`/`shared`/CI untouched. Status → ready-for-dev. |
| 2026-07-25 | Story 1.8 implemented: `confidence.rs` (`SessionConfidence`, `classify`) built to spec; `lib.rs` updated to register the module. Task 3's `if`/`else if` chain collapsed to one boolean condition to satisfy `clippy::if_same_then_else` (semantics unchanged). Full four-command cargo gate run and green on this machine (fmt, clippy -D warnings, build, test — 126 passed, 6 new). No new dependency; `stats`/`joiner`/`parser`/`genre`/`shared`/CI untouched. Status → review. |
