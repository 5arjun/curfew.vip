---
baseline_commit: eb47ed1c17c857e2c080a7be8214e10594b10082
---

# Story 1.3: Clean-room `.session` parser

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want a clean-room Rust parser that reads a Serato `.session` file into an ordered list of plays (track ref + timestamps),
So that the raw as-played sequence is available on-device for enrichment and stats.

## Acceptance Criteria

1. **Given** a valid `.session` file, **When** parsed, **Then** an ordered list of plays with per-play timestamp and track reference is produced. *(AR-5)*
2. **Given** the pinned `triseratops` git commit + `id3` crate, **When** the parser uses them, **Then** it depends on the exact pinned commit (not the stale crates.io `0.0.3`). *(AR-5)*
3. **Given** a malformed or truncated `.session`, **When** parsed, **Then** it fails safely with a diagnostic (never a panic that crashes the agent) **And** the raw file is retained for backfill. *(AR-5, AR-7)*
4. **Given** the same file, **When** parsed twice, **Then** output is deterministic (identical ordered plays).

## Tasks / Subtasks

- [x] **Task 1 — Wire the pinned parser dependencies into production `Cargo.toml`** (AC: 2)
  - [x] In `agent/src-tauri/Cargo.toml`, add `triseratops = { git = "https://github.com/Holzhaus/triseratops.git", rev = "8e92aae1794c4f02a2405eb88ea72f251b077f0c" }` — re-verify this is still `main`'s HEAD immediately before implementing (verified unchanged as of 2026-07-22; re-check via `git ls-remote https://github.com/Holzhaus/triseratops.git main`). Do not float `main`; pin the exact commit.
  - [x] Add `id3 = "1.17.0"` (re-verified current on crates.io as of 2026-07-22).
  - [x] Remove the "NOTE: parser/enrichment crates ... are intentionally NOT added here" comment in `Cargo.toml` (it's stale once this task lands).
  - [x] `cargo build --manifest-path agent/src-tauri/Cargo.toml` succeeds, pulling the pinned git commit. Note: this story's own parser code (Task 2) does not call either crate — see Dev Notes → Why pin now if unused.

- [x] **Task 2 — Implement the clean-room `.session` parser module** (AC: 1, 3, 4)
  - [x] Create `agent/src-tauri/src/parser/mod.rs` (public surface) and `agent/src-tauri/src/parser/session.rs` (the binary decode), registered via `pub mod parser;` in `lib.rs`. This follows the `watcher → parser → joiner → stat-engine → local store → sync-queue` pipeline naming already documented in `agent/src-tauri/src/lib.rs`'s module doc comment.
  - [x] Implement the envelope + field-ID decode fresh, against the confirmed structure in Dev Notes → Confirmed binary format below (sourced from Story 1.2's findings doc, not ported from any third-party parser — see Dev Notes → Clean-room discipline).
  - [x] **Top-level walk is structural, never a byte scan.** Loop over the buffer reading tag(4 bytes) + length(4-byte BE `u32`), then always advance by exactly that declared length — for **every** top-level tag, not just `oent`. When the tag is `oent`, decode it as a play (see below); any other top-level tag (e.g. the leading `vrsn` header — see Dev Notes → Confirmed binary format) is skipped by arithmetic alone. Do **not** port the spike's `i += 1` byte-by-byte resync loop — advancing by the declared length instead of scanning for a literal `"oent"` match eliminates the resync-desync risk category entirely, it isn't just deprioritized (see Dev Notes → What must NOT be inherited from the spike).
  - [x] Public API: `pub fn parse(data: &[u8]) -> Result<Vec<Play>, ParseError>` (pure, no IO — the primary unit-testable entry point) and `pub fn parse_session_file(path: &Path) -> Result<Vec<Play>, ParseError>` (reads the file via `std::fs::read`, maps IO failure to `ParseError::Io`, then delegates to `parse`).
  - [x] `Play` carries only the high-confidence fields from the findings doc's field map, **every field `Option<...>`**: `path: Option<String>` (track reference, field 2), `title` (6), `artist` (7), `label` (8), `genre` (9), `grouping` (17), `year` (23), `start_time: Option<u32>` (28), `deck: Option<u32>` (31), `duration_sec: Option<u32>` (45), `key` (51) — string fields `Option<String>`. Optional-everywhere is not defensive hedging: the spike's own real-data run observed a "High confidence" field (`artist`) come back `None` on an otherwise well-formed record (see spike sample output, findings doc §9), so absence is a normal case, not corruption. AC-1's "track reference" means the field exists on `Play`, not that it's guaranteed non-null — no play is filtered out of the result for having missing fields. Do **not** include field 15 (candidate BPM) or fields 29/53 (candidate end/modified time) — findings doc §3 marks these low-confidence; BPM must come from the library join / embedded tags (Stories 1.4/1.5), not this play-log field.
  - [x] Dedup by field-1 `row_id` before returning from `parse` — order-preserving (first occurrence in file order wins), using a `HashSet<u32>` of seen row IDs rather than assuming duplicates are adjacent. A play with no parseable `row_id` (`None`) is never deduped against anything. `row_id` itself is **not** a field on `Play` — it's consumed internally by `parse` purely to drive the dedup set, then dropped; downstream consumers never see it (matches the field list above, and nothing in Story 1.10's contract inputs table needs it). This is required for AC-1's "ordered list of plays" to be truthful: findings doc §5 (D1) found byte-for-byte duplicate `oent` records in roughly half of real sessions tested, which would silently double-count plays without this. Dedup must be internal/invisible to callers — `parse`'s return value is already the deduped list (findings doc §8).
  - [x] `ParseError` has exactly two variants, both actually reachable and tested (unlike the spike's dead `Truncated` — see Dev Notes → What must NOT be inherited from the spike): `Io(std::io::Error)` and `Truncated { offset: usize }`. **Every declared length is checked against its own enclosing bound, and a violation returns `Err(Truncated)` — never a silent clamp**: an outer `oent` record's length is checked against the remaining file buffer; an `adat` record's length is checked against its enclosing `oent`'s payload bounds (not the whole file); an individual field's length is checked against its enclosing `adat`'s payload bounds. All three levels must fail loud on overrun, not silently truncate the slice and continue with partial/wrong data — this is precisely the pattern the spike used at all three levels (`.unwrap_or(n).min(n)`-style clamps) that made `Truncated` unreachable there. Follow the `Display`/`std::error::Error` impl pattern already established by `SchemaLoadError` in `agent/src-tauri/src/lib.rs:28-43`. A file with zero recognizable `oent` tags is **not** an error — it parses to an empty `Vec` (a session with no plays is valid data, not corruption).
  - [x] No panics anywhere on the parse path: no `.unwrap()`, `.expect()`, or slice indexing that can go out of bounds. Every fallible step returns `Result`/`Option` and is propagated, not asserted.

- [x] **Task 3 — Guarantee raw-file safety at this build stage** (AC: 3)
  - [x] `parse_session_file` and everything it calls must be read-only: never delete, move, rename, or truncate the source `.session` file, on either the success or the error path. At this point in the build sequence (Epic 1, before Story 2.8's durable local-SQLite raw-retention store exists), "the raw file is retained for backfill" is satisfied trivially by the parser never touching the source file — Serato's own `History/Sessions/` folder is the retention mechanism until 2.8 lands. Do **not** build any SQLite persistence in this story; that would duplicate Story 2.8's scope.
  - [x] Add a test asserting the source file's bytes are unchanged after a `parse_session_file` call, including a call that returns `Err`.

- [x] **Task 4 — Unit tests: determinism, dedup, malformed handling, file safety** (AC: 1, 3, 4)
  - [x] Do not commit real Serato session data as fixtures — real `.session` files contain real personal DJ history/track names, and golden-file fixtures are explicitly Story 1.9's job, not this story's. Build small synthetic byte fixtures in-test (a helper that emits a valid `oent`/`adat` record from given field values) matching the confirmed envelope.
  - [x] Test: a synthetic multi-play file parses to an ordered `Vec<Play>` with correct field values (path/title/artist/start_time/deck/etc.).
  - [x] Test: two byte-identical `oent` records (same `row_id`) → output contains that play exactly once; ordering of the remaining plays is preserved.
  - [x] Test: a truncated file (an `oent`/`adat` length that points past the end of the buffer) → `Err(ParseError::Truncated { .. })`, never a panic.
  - [x] Test: parsing the same bytes twice yields identical output (`assert_eq!`).
  - [x] Test from Task 3: source file bytes unchanged after both a successful and a failing `parse_session_file` call.
  - [x] Test: a file with zero recognizable `oent` tags (e.g. only a leading `vrsn`-style header, or an empty buffer) → `Ok(vec![])`, not an error.
  - [x] All tests run under the crate's existing gates: `cargo fmt --manifest-path agent/src-tauri/Cargo.toml -- --check`, `cargo clippy --manifest-path agent/src-tauri/Cargo.toml -- -D warnings`, `cargo test --manifest-path agent/src-tauri/Cargo.toml`.

- [x] **Task 5 — Confirm the existing CI gate covers this without changes** (AC: all)
  - [x] `.github/workflows/ci.yml`'s existing `agent` job already runs fmt/clippy/build/test against `agent/src-tauri/Cargo.toml` (lines 81-91) — this module lives inside that same crate, so no CI file changes should be needed (unlike Story 1.2's deliberately CI-invisible spike). Verify this holds; if it doesn't, that's a signal something drifted into the wrong location.
  - [x] Confirm the CI runner can resolve the new git dependency (network access to GitHub is available to `ubuntu-latest` runners by default — no secrets/auth needed for a public repo).

## Review Findings — Advanced Elicitation Pass (2026-07-22)

Produced post-implementation (status `review`) by self-consistency validation of the shipped decode against the Story 1.2 spike and a third re-derivation from findings §3, plus a cascading-failure trace through the `watcher → parser → joiner → stat-engine → local store → sync-queue` pipeline. These are the second-commit (code-review) items for this story; see Git intelligence below for the expected two-commit shape.

**Status: RF-1..RF-5 implemented and merged into the parser (see Dev Agent Record → Review-pass notes). Two deliberate deviations from the original tasks, both recorded below: a third `ParseError` variant (`Desync`) beyond Task 2's "exactly two", and start-time ordering in place of raw file order.**

- [x] **RF-1 — Restore the numeric payload-length guard.** The spike guarded every numeric field (`1 if payload.len() == 4`, same for 28/31/45); the rewrite dropped it, so `read_u32_be(value, 0)` takes the **first 4 bytes of any payload ≥ 4** and ignores the rest (`session.rs` `assign_field`). A 6- or 8-byte payload yields a silently wrong `start_time`/`deck`/`duration_sec`, and a wrong `row_id` **corrupts the dedup set** — dropping a real play or admitting a duplicate. Add `value.len() == 4` guards; test a numeric field with a 6-byte payload.
- [x] **RF-2 — Detect the structural walk's own desync.** The strict top-level walk has no self-check. If a real file carries padding, a length that includes its header, or a container variant, the walk lands in garbage tag space, matches no `oent`, and returns **`Ok(vec![])` with no error**. The spike's byte-resync tolerated exactly this — which is why it worked across 474 real files. This story eliminated the resync-desync risk category but **converted it into a silent-wrong-answer category**, which AC-3 ("fails safely with a diagnostic") does not cover. Restore detection without giving up the structural walk: (a) reject a top-level tag that is not 4 printable-ASCII bytes, and (b) error when the walk terminates with a non-empty trailing remainder (`offset != n`). Both are arithmetic/structural — no byte scanning reintroduced.
- [x] **RF-3 — Stop emitting phantom plays.** A record whose inner tag is not `adat` currently yields `Play::default()` — all fields `None`, no `row_id`, therefore never deduped — pushed into the result as a play that references no track (`decode_oent`, early returns). The spike behaves identically, but shared lineage is not independent confirmation. Skip the record or make it an error; do not emit a ghost row.
- [x] **RF-4 — Instrument the parse (records seen / plays emitted / duplicates dropped).** Dedup is currently silent and uncounted. The spike *printed* `raw / distinct row_id / missing row_id`, and that instrumentation is how D1 (findings §5) was discovered at all. Without counters, a row-ID collision across genuinely distinct plays silently deletes real plays with no way for any caller to detect it, and `Ok(vec![])` remains indistinguishable between "DJ played nothing", "zero-`oent` stub", and "walk desynced" (RF-2). Return counts alongside the plays.
- [x] **RF-5 — Decide the partial-success contract before Stories 1.6/1.7 depend on the signature.** Serato appends to `.session` **during** the gig. The watcher fires on change, the parser reads a file whose last record is half-written, the declared length overruns the buffer, and `Err(Truncated)` **discards the 150 already-valid plays before it**. During a live set, "truncated" is the file's normal state, not corruption. `Result<Vec<Play>, ParseError>` has no partial-success channel, so the watcher's only options are drop-everything or retry-hot. Recommended: return decoded plays alongside the error (`ParseOutcome { plays, error: Option<ParseError> }`, or a `parse_partial`), keeping a **mid-file** overrun loud while a **tail** truncation self-resolves on the next write. Cheap to change now, expensive once the stat-engine's semantics are built on all-or-nothing.

**Deviation 1 — `ParseError` now has three variants, not the two Task 2 specified.** RF-2 needs a distinct failure for "the walk is no longer on a record boundary", which is not a length overrun and must not borrow `Truncated`'s message ("a record length overruns its bounds") to say so. `Desync { offset }` was added. The spirit of Task 2's constraint is preserved — every variant is reachable and directly tested, which is what the spike's dead `Truncated` failed at.

**Deviation 2 — plays are returned in start-time order, not raw file order.** See Dev Notes → Ordering. Both orders are "ordered lists of plays" under AC-1; start-time order is the one Story 1.2 validated against ground truth.

**Why these matter more than their individual severity:** the parser is the only component that ever sees raw `oent` records. Anything it drops, dedups, or phantom-emits is unrecoverable downstream except by a full re-parse of the retained raw file — so Task 3's read-only guarantee (AR-7) is the **sole compensating control** for every finding above, and Story 2.8's durable retention is load-bearing rather than routine. RF-2 + RF-4 together are what keep a silent parser failure from propagating through stat-engine → local store → sync-queue into a wrong or empty gig published on the user's profile with no error raised at any hop.

## Dev Notes

### Ordering: what Story 1.2 actually validated (correction)
The shipped `parse` doc comment asserts *"File order is chronological in every real session Story 1.2 inspected, so the returned order is the as-played order."* The empirical record is narrower than that. The spike's ground-truth harness **sorts by `start_time` before comparing positionally** against `master.sqlite` (`agent/spike-1-2-parser-validation/src/main.rs:370` — `deduped.sort_by_key(|p| p.start_time.unwrap_or(0))`). So:
- Findings §5's **count** evidence (302 raw → 151 distinct = 151 in `master.sqlite`; 506 → 253 = 253) is order-independent and transfers to this module unchanged.
- Findings §5's **position-by-position track order/name match** was produced from a `start_time`-sorted list, **not** from raw file order. That evidence does **not** transfer to a parser that returns file order.

AC-1's "ordered list of plays" therefore rested on an unvalidated claim. Resolve one of two ways (recommended: the first, since it is what was actually validated): stable-sort by `start_time` inside `parse` (file order breaks ties; `None` keeps its file position), **or** keep file order, downgrade the doc comment to state plainly that order is file order with chronology unverified, and make ordering an explicit assertion in Story 1.9's golden-file suite.

**Resolved (review pass): the first.** `parse`/`parse_partial` now stable-sort by field 28. `sort_by_key` is stable, so equal start times keep file order; a play with no start time inherits the last known one so it stays in its file neighbourhood rather than being flung to the front of the set. Deterministic for identical input, so AC-4 is unaffected. Two tests cover it (`orders_plays_by_start_time_not_file_order`, `play_without_start_time_keeps_its_file_neighbourhood`). Story 1.9 should still assert ordering against a real file — this makes the parser's order match what was validated, it does not re-validate it.

### Downstream contract decisions this story locks in
Only the `parser` filter exists today; `watcher`/`joiner`/`stat-engine`/`local store`/`sync-queue` land in Stories 1.4-1.7/1.10/2.8. Two of this module's signatures are therefore contract decisions, not implementation details, and are cheapest to settle here:
1. **Partial success** (RF-5): whether a truncation anywhere in the file voids every play in it. Directly determines whether live, mid-set stats are possible at all.
2. **Empty vs. failed** (RF-2/RF-4): `Ok(vec![])` is currently the correct answer for a zero-`oent` file, a `vrsn`-only stub, *and* a desynced walk. Downstream filters cannot distinguish "played nothing" from "parser lost the plot" without counters.

### What this story is (and isn't)
This is the **first production** (non-throwaway) Serato-parsing code in the repo. It builds on Story 1.2's spike findings/GO recommendation but does not reuse spike code verbatim — the spike (`agent/spike-1-2-parser-validation/`) is explicitly throwaway (Story 1.2 AC-4) and stays in place, untouched, isolated from the build graph, for reference only. Re-implement fresh in `agent/src-tauri/src/parser/`, fixing the bugs the spike's own code review already found (see below) rather than repeating them.

### Confirmed binary format (from Story 1.2's findings doc §3 — do not re-derive from scratch)
- **Outer envelope**: 4-byte ASCII tag + 4-byte big-endian `u32` length + payload. Each play is one `oent` record; inside it, one `adat` record holds the fields.
- **Leading non-`oent` header record**: the file does not start directly with the first play. Real files carry at least one top-level non-`oent` record before the first `oent` (a version/header tag — the spike's own code names it `vrsn`, see `agent/spike-1-2-parser-validation/src/legacy_session.rs:103`), same tag+length+payload shape as any other top-level record. This detail was confirmed in the spike's code but never promoted into this findings doc — carrying it forward explicitly here so the production parser's top-level walk skips it (and any other non-`oent` top-level tag) structurally rather than needing a byte-scan workaround. Re-confirm the exact tag/shape against a real file immediately before implementing, same spirit as the dependency re-pin checks in Task 1.
- **Inner fields**: NOT ASCII-tagged. Each is a 4-byte big-endian `u32` numeric field ID + 4-byte BE `u32` length + payload. Text payloads are UTF-16BE, NUL-terminated.
- **Field ID map** (high confidence only — see findings doc §3 for the full table including low-confidence fields, which this story deliberately excludes from `Play`):

  | ID | Field |
  |---|---|
  | 1 | row ID (sequential per session — used for dedup) |
  | 2 | absolute file path (track reference) |
  | 6 | title |
  | 7 | artist |
  | 8 | label |
  | 9 | genre |
  | 17 | grouping |
  | 23 | year |
  | 28 | start_time (Unix epoch, UTC) |
  | 31 | deck (observed 1 or 2) |
  | 45 | duration_sec |
  | 51 | key (Camelot notation, e.g. `"1A"`) |

### Clean-room discipline (carries forward from Story 1.2)
Consulting Story 1.2's own findings doc and spike code is fine — it's this project's own prior research. **Do not port or transcribe code** from Mixxx (GPL), or any other existing `.session`/history parser implementation (e.g. the TS `seratolibraryparser` or Go `seratoparser` projects). Public *documentation* of the general envelope shape is fine to reference; production code must be written fresh against the confirmed structure above.

### What must NOT be inherited from the spike
Story 1.2's code review deferred three issues specifically because the spike is throwaway and never extended by this story — production code does not get that exemption:
- `ParseError::Truncated` was unreachable dead code in the spike — concretely, because the spike clamps every declared length to its containing buffer with a `.unwrap_or(n).min(n)`-style pattern (`agent/spike-1-2-parser-validation/src/legacy_session.rs:96,122,133`) instead of ever returning `Err`, at all three nesting levels (outer `oent`, inner `adat`, individual field). Task 2 requires the inverse at all three levels: a length that would overrun its enclosing bound is `Err(Truncated)`, never a silently-clamped read of partial/wrong data.
- `home()`/path `.unwrap()`/`.expect()` calls panicked instead of failing gracefully in the spike (acceptable there, not here — Task 2 requires zero panics on the parse path).
- The spike's byte-resync loop (`i += 1` until the next literal `"oent"`, used to skip the leading `vrsn` header) was never observed to desync against the real corpus, but is a known theoretical risk of scanning for a literal tag inside a UTF-16BE payload. **This story does fix it differently**: Task 2's structural top-level walk (advance by each record's own declared length, regardless of tag) skips the header — and anything else — without ever scanning for a byte pattern, closing the risk category rather than accepting it.

### Why pin `triseratops`/`id3` now if this story's own code doesn't call them (AC-2)
The `.session` binary parser built in this story is entirely from-scratch (clean-room) and uses neither crate — `triseratops::library` is Story 1.4's library-join concern, and `id3` is Story 1.5's embedded-tag concern. AC-2 is satisfied by adding both to `agent/src-tauri/Cargo.toml`'s production dependencies now (Task 1), so 1.4/1.5 aren't blocked on dependency wiring. Cargo does not warn on a declared-but-unused external crate dependency (only unused *imports* within code trigger warnings), so this causes no `clippy -D warnings` failure.

### Dedup is load-bearing, not optional
Findings doc §5 (D1): `2521.session` had 302 raw `oent` records but only 151 real plays (verified against `master.sqlite`'s independently-migrated history for the same gig); `11627.session` had 506 raw vs. 253 real. The duplication is session-dependent (not universal — `19544.session` had none) and the trigger wasn't conclusively isolated, so **every session must be deduped by row ID**, not just ones that "look" duplicated. A naive "count `oent` tags" implementation will silently double-count plays for roughly half of real sessions.

### Open scope gap inherited from Story 1.2 — do not silently absorb it here
Story 1.2's findings (§6) found this DJ's `master.sqlite` (Serato 4+) holds the DJ's **entire** play history (2021-2026) via its own `history_session`/`history_entry` tables — no binary decoding needed at all — and that the legacy `~/Music/_Serato_/History/Sessions/` folder this story parses is **frozen as of 2025-12-11** (the DJ's engine migrated). The findings doc explicitly recommends prioritizing `master.sqlite` support, but as epics.md currently scopes it, **no story yet owns reading the play log directly from `master.sqlite`** — Story 1.3 (this story) is scoped to the legacy `.session` file only (its ACs literally say "a valid `.session` file"), and Story 1.4 ("Library join") as written treats `master.sqlite` purely as a metadata-lookup library, not as an alternate play-log source. **Do not expand this story's scope to cover `master.sqlite`** — stay within the literal ACs above. This gap is recorded in Open Questions below for Arjun to resolve before/during Story 1.4's creation.

### Architecture citations
- **AR-5**: clean-room `.session` parser + pinned `triseratops`/`id3`; must eventually handle both legacy `database V2` and Serato 4+ `master.sqlite` (the two-format requirement as a whole — this story covers the legacy play-log half only, per the scope gap above).
- **AD-11**: two-path parser; off-library → embedded tags → visible "Unknown" (Stories 1.4/1.5, not this one).
- **AD-13**: format-drift resilience is 3 layers + backfill. This story's clean, non-panicking error handling is what makes Story 1.9's golden-file CI tests meaningful (a parser that panics on drift can't be caught by a test that expects a `Result`).
- **AR-7**: raw retention for backfill — satisfied trivially at this build stage (Task 3); the durable mechanism is Story 2.8.

### Previous story intelligence (1.2)
- Rust toolchain: Homebrew `rustup` (keg-only, must be on `PATH`), stable ~1.97, edition 2021 — match the existing `agent/src-tauri` crate's edition.
- `agent/src-tauri/src/lib.rs`'s `SchemaLoadError` (lines 28-43) is the established idiom for a small `Read`/`Parse`-shaped error enum with `Display` + `std::error::Error` — mirror this pattern for `ParseError` rather than inventing a new style.
- 1.1's code review already fixed a panic-on-error pattern in `lib.rs` (`load_sync_payload_schema`) — this story continues that "prefer `Result` over panic" convention, now as a hard requirement (Task 2) rather than a nice-to-have.

### Git intelligence
Recent commits (`ad86bde`, `eb47ed1`) establish this repo's pattern: a story's initial commit implements it, and a **second, separate code-review commit** extends/fixes the same code after an adversarial review pass (not just approves it) — deferred, lower-value findings get recorded in `_bmad-output/implementation-artifacts/deferred-work.md` rather than fixed immediately. Expect the same two-commit shape for this story.

### Project Structure Notes
- New: `agent/src-tauri/src/parser/mod.rs`, `agent/src-tauri/src/parser/session.rs`.
- Modified: `agent/src-tauri/src/lib.rs` (add `pub mod parser;`), `agent/src-tauri/Cargo.toml` (two new production dependencies).
- Untouched: `shared/`, `web/`, `agent/spike-1-2-parser-validation/` (kept in place per Story 1.2, still throwaway/isolated — do not extend it), `.github/workflows/ci.yml` (no changes expected — see Task 5).

### Testing standards
Unlike Story 1.2's spike (no CI wiring, no test bar — throwaway), this module lives inside `agent/src-tauri`, which already has a full CI bar (`cargo fmt --check`, `cargo clippy -D warnings`, `cargo build`, `cargo test`, `.github/workflows/ci.yml` lines 81-91). No new CI configuration should be needed. Use synthetic in-test byte fixtures (Task 4), not committed real Serato data — real session files are personal data and golden-file fixtures are Story 1.9's dedicated concern.

**Real-corpus validation gap, by design, until Story 1.9**: this story's coverage is entirely synthetic fixtures. The empirical confidence behind the confirmed binary format and the dedup requirement (findings doc §4/§5) comes from Story 1.2's spike code running against the real 474-file corpus — a separate, throwaway codebase. Because Story 1.3 is a from-scratch clean-room rewrite (not a port), that real-corpus evidence does not automatically transfer to this module; nothing re-validates the rewrite against real files until Story 1.9's golden-file suite lands. Acceptable for this story to merge on synthetic tests alone, but flag 1.9 as a near-term follow-on, not a backlog item — this module carries real-world-unverified risk until it runs.

### Latest tech / versions (re-verified 2026-07-22, unchanged from Story 1.2's spike)
- **`triseratops`**: `main`'s HEAD is still `8e92aae1794c4f02a2405eb88ea72f251b077f0c` (2025-11-24) — no drift since the spike. Re-verify once more immediately before implementation. License MPL-2.0 (confirmed safe for a proprietary product, AD-11).
- **`id3`**: latest stable is still `1.17.0` — no drift.
- **Rust**: stable, edition 2021 (matches existing crate).

### References
- [epics.md — Story 1.3 + Epic 1 design notes](../planning-artifacts/epics.md)
- [ARCHITECTURE-SPINE.md — AD-11, AD-13, AR-5/AR-7 (via Additional Requirements)](../planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md)
- [1-2-parser-validation-spike-against-real-sessions.md — previous story](./1-2-parser-validation-spike-against-real-sessions.md)
- [1-2-parser-validation-spike-findings.md — confirmed binary format (§3), discrepancies (§5), prioritization recommendation (§6), contract inputs (§8)](./1-2-parser-validation-spike-findings.md)
- [deferred-work.md — spike code-review deferrals this story must not repeat](./deferred-work.md)
- [agent/src-tauri/src/lib.rs — `SchemaLoadError` pattern to mirror for `ParseError`](../../agent/src-tauri/src/lib.rs)
- [agent/spike-1-2-parser-validation/src/legacy_session.rs — reference only, do not copy verbatim (throwaway)](../../agent/spike-1-2-parser-validation/src/legacy_session.rs)

## Open Questions / Assumptions
*(None block starting the story — reasonable defaults chosen; flagged for Arjun's confirmation before/during implementation.)*

1. **[OPEN — promoted, now blocks the watcher story] `master.sqlite` play-log scope gap** (Dev Notes above): Story 1.2's findings recommend prioritizing `master.sqlite` support since it's this DJ's actual live data source and needs no binary decoding, but no current epics.md story owns reading play-log data directly from `master.sqlite`'s `history_session`/`history_entry` tables — Story 1.4 as written treats `master.sqlite` only as a metadata-join library. This story deliberately stays scoped to the legacy `.session` file only.
   **Promotion rationale (elicitation pass, cascading-failure trace):** originally flagged as "decide before/during Story 1.4's creation." The trace moved it earlier. `~/Music/_Serato_/History/Sessions/` has been **frozen since 2025-12-11** — the watcher story is about to be pointed at a directory that no longer changes, and every downstream filter (joiner, stat-engine, local store, sync-queue) would be integration-tested only against a dead source. Epic 1 can finish fully green while producing **zero plays on the DJ's actual machine**. Decide before the watcher story is created, not before 1.4.
2. **[ASSUMPTION] Module location**: `agent/src-tauri/src/parser/{mod.rs,session.rs}`, matching the pipeline-filter naming already documented in `lib.rs`. Reversible/renameable.
3. **[ASSUMPTION] `Play` excludes BPM (field 15) and end/modified-time (fields 29/53)** as low-confidence per findings doc §3 — BPM is expected to come from the library join (Story 1.4) instead. Confirm this doesn't block any nearer-term consumer than currently planned.
4. **[NOTE, not a task — for the UI/onboarding story] `ParseError::Io` conflates "corrupt" with "not permitted."** macOS TCC can deny reads under `~/Music/_Serato_/` (Files-and-Folders / Full Disk Access), so a permissions failure during onboarding reaches the UI through the same single opaque `Io` variant as a genuine read error, and will surface to the user as a parse failure rather than a "grant access" prompt. `ParseError::source()` preserves the underlying `io::ErrorKind` (`PermissionDenied`/`NotFound`), so no parser change is required — the UI story just has to specify the mapping. Flagging so it isn't discovered during onboarding QA.
5. **[NOTE, not a task]** `deferred-work.md`'s `csp: null` item was flagged as relevant "before the agent loads/parses untrusted local file content" — this story does add local-file parsing, but in Rust (`std::fs`), not in the Tauri **webview**, which is what the CSP actually governs. The trigger condition for that deferred item (untrusted content rendered/executed *in the webview*) still hasn't occurred; it likely fires when parsed data is first displayed in the UI. Not pulled into this story's scope — flagging so it isn't lost.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Opus 4.8), via the bmad-dev-story workflow.

### Debug Log References

No blocking issues; the implementation passed the crate's full gate on the first run.
Gate commands (Rust via keg-only Homebrew `rustup` on `PATH` — `/opt/homebrew/opt/rustup/bin`):
- `cargo build --manifest-path agent/src-tauri/Cargo.toml` — pulls pinned `triseratops` git commit + `id3 1.17.0`, builds clean.
- `cargo fmt --manifest-path agent/src-tauri/Cargo.toml -- --check` — clean.
- `cargo clippy --manifest-path agent/src-tauri/Cargo.toml -- -D warnings` — no warnings.
- `cargo test --manifest-path agent/src-tauri/Cargo.toml` — 11 passed (10 new parser tests + the pre-existing shared-contract test), 0 failed, no regressions.

### Completion Notes List

- **Spec committed first** (per request) as `c62b336` before any implementation, isolating the story spec + its story-creation artifacts (sprint-status, deferred-work, party memlog) from the implementation diff. The frontmatter `baseline_commit` (`eb47ed1`) was preserved unchanged per the workflow rule.
- **AC-2 — pinned deps**: re-verified `triseratops` `main` HEAD immediately before implementing via `git ls-remote` — still `8e92aae1794c4f02a2405eb88ea72f251b077f0c` (no drift). `id3` still `1.17.0`. Cargo resolves the dependency as `triseratops v0.0.3 (git…rev=8e92aae1)` — the pinned git commit, **not** the stale crates.io `0.0.3`. Neither crate is called by this story's code (they are wired for Stories 1.4/1.5); a declared-but-unused external crate does not trip `clippy -D warnings`, confirmed.
- **AC-1 — ordered plays**: the top-level walk is purely structural — read `tag(4) + length(4 BE)`, always advance by the declared length, for every top-level record. The leading `vrsn` header (and any non-`oent` tag) is skipped by arithmetic; the spike's `i += 1` byte-resync loop is **not** carried forward, eliminating the resync-desync risk category. `Play` carries exactly the 11 high-confidence fields, every one `Option<…>`; `row_id` (field 1) is internal-only and dropped after driving dedup; low-confidence fields (15/BPM, 29/53, 50) are excluded.
- **AC-1 — dedup**: order-preserving dedup by field-1 `row_id` via a `HashSet<u32>` (first occurrence wins). Tested with **non-adjacent** duplicates so an adjacent-only dedup would fail — the HashSet approach is required (findings §5/D1). A play with `row_id == None` is never deduped.
- **AC-3 — fail loud, never clamp**: `ParseError` has exactly the two required variants (`Io`, `Truncated { offset }`), mirroring `SchemaLoadError`'s `Display`/`Error` idiom (plus `source()` for the IO chain). Declared lengths are checked against their own enclosing bound at all three levels — outer `oent` vs. file buffer, `adat` vs. `oent` payload, field vs. `adat` payload — each an `Err(Truncated)` on overrun, never a silent `.min()` clamp. All three overruns are directly tested (the spike's dead `Truncated` is now reachable and covered). A file with zero `oent` records parses to `Ok(vec![])`.
- **AC-3 — no panics**: verified no `.unwrap()`/`.expect()`/`panic!`/panicking slice-index on the production parse path (scanned outside `#[cfg(test)]`). All reads go through `slice::get` + `checked_add` + `Option`/`Result`; every proven-in-bounds slice is justified by a prior bound check.
- **AC-3 — raw-file safety (Task 3)**: `parse_session_file` is read-only (`std::fs::read` only). Two tests assert the source bytes are byte-for-byte unchanged after both a successful and a failing (`Truncated`) call. No SQLite persistence built (that is Story 2.8).
- **AC-4 — determinism**: tested via `assert_eq!(parse(x), parse(x))` (`Play` derives `PartialEq`/`Eq`).
- **Task 4 fixtures**: synthetic in-test byte builders only (no real Serato data committed — golden-file fixtures are Story 1.9). Temp-file tests write to a unique path under the system temp dir and clean up.
- **Task 5 — CI**: no `.github/workflows/ci.yml` change needed; the existing `agent` job (ci.yml:81-91) already runs fmt/clippy/build/test against this same crate. Confirmed the git dependency resolves and builds locally (public repo → no auth needed on `ubuntu-latest`).
- **Real-corpus validation gap (by design)**: coverage is entirely synthetic until Story 1.9's golden-file suite runs the from-scratch rewrite against real files. Flagged in the story's Dev Notes as a near-term follow-on, not a backlog item.

### Review-pass notes (elicitation findings RF-1..RF-5)

Implemented in the same two files as the original story; the full crate gate was re-run green (`cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo build`, `cargo test` — **21 passed**, 10 of them new, 0 regressions).

- **RF-1**: `assign_field` now decodes fields 1/28/31/45 only from an exactly-4-byte payload. Tests: `numeric_field_with_wrong_payload_width_is_ignored` (6-byte `start_time` and 2-byte `deck` stay `None`), `wrong_width_row_id_does_not_drive_dedup` (an 8-byte field 1 yields no row ID, so the record is emitted rather than collapsed against a value read from a prefix).
- **RF-2**: added `is_plausible_tag` (4 printable-ASCII bytes) plus a hard failure on a trailing fragment too short to hold a record header — both `ParseError::Desync { offset }`. Tests: `desync_on_implausible_tag_errors`, `trailing_fragment_errors`. Note the first fixture understates a *header* record's length, not an `oent`'s: a short `oent` is caught earlier and more specifically by the inner `adat` bound (`Truncated`), so it would never reach the tag check — found by writing the test, and worth knowing for Story 1.9's fixtures.
- **RF-3**: `decode_oent` returns `Ok(None)` when the inner record is not a decodable `adat`; the caller skips and counts it (`records_skipped`) instead of pushing an all-`None` phantom play. Test: `oent_without_adat_is_skipped_not_emitted`.
- **RF-4**: new public `ParseStats` (`top_level_records`, `oent_records_seen`, `plays_emitted`, `duplicates_dropped`, `records_skipped`, `plays_without_row_id`), returned by `parse_partial`. Test: `stats_report_what_the_walk_saw`.
- **RF-5**: new `parse_partial(&[u8]) -> ParseOutcome { plays, stats, error }` and `parse_session_file_partial(&Path)`. `parse`/`parse_session_file` keep their exact strict signatures and behaviour (all original tests unchanged), and `parse` is now implemented on top of `parse_partial`. Tests: `parse_partial_keeps_plays_before_a_truncated_tail` (asserts the error offset identifies the tail, which is how a caller tells a mid-gig half-written record from real mid-file corruption), `parse_session_file_partial_is_read_only`.
- **Ordering**: `sort_by_start_time` (stable, carry-forward for a missing start time) — see Dev Notes → Ordering.
- Also fixed two pre-existing `clippy::redundant_closure` warnings in the test module. These were never CI-visible: `.github/workflows/ci.yml` runs `cargo clippy` **without** `--all-targets`, so test code is not linted in CI. Worth deciding separately whether CI should lint tests; not changed here.

### File List

- `agent/src-tauri/Cargo.toml` — modified: added pinned `triseratops` (git rev) + `id3 = "1.17.0"`; removed the stale "intentionally NOT added" NOTE.
- `agent/src-tauri/src/lib.rs` — modified: added `pub mod parser;` declaration.
- `agent/src-tauri/src/parser/mod.rs` — new: public surface (`Play`, `ParseError`, `ParseStats`, `ParseOutcome`, `parse_session_file`, `parse_session_file_partial`, re-export of `parse`/`parse_partial`) + test suite (21 tests).
- `agent/src-tauri/src/parser/session.rs` — new: the clean-room binary decode (structural walk, tag-plausibility + nested-bound checks, field map with numeric width guards, dedup, start-time ordering, partial-result walk).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — modified: story 1-3 status tracking (`ready-for-dev` → `in-progress` → `review`).

## Change Log

| Date | Change |
|---|---|
| 2026-07-22 | Committed story spec as a clean baseline (`c62b336`) before implementation, per request. |
| 2026-07-22 | Implemented the clean-room `.session` parser (Tasks 1–5): pinned parser deps, structural decode with three-level overrun checks + dedup, read-only file wrapper, 10 synthetic-fixture tests. All ACs satisfied; full crate gate (fmt/clippy `-D warnings`/build/test) green. Status → review. |
| 2026-07-22 | Implemented Review Findings RF-1..RF-5 + the ordering correction: numeric payload-width guards, `ParseError::Desync` (tag plausibility + trailing fragment), no phantom plays, `ParseStats` counters, `parse_partial`/`parse_session_file_partial`, stable start-time ordering. `parse`/`parse_session_file` signatures and strict behaviour unchanged. Full crate gate green — 21 tests (10 new), 0 regressions. |
| 2026-07-22 | Advanced-elicitation pass (self-consistency validation vs. the 1.2 spike + cascading-failure trace through the pipeline) while in `review`. Added Review Findings RF-1..RF-5 (numeric payload guards, walk-desync detection, phantom plays, parse instrumentation, partial-success contract); corrected the ordering claim — findings §5's position-by-position order match came from a `start_time`-sorted list, so it does not transfer to a file-order parser; added the downstream-contract Dev Note; promoted the `master.sqlite` scope gap to block the watcher story; noted the `Io` → permissions-vs-corruption UI mapping. |
