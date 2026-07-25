---
baseline_commit: 8208b1d0f166235ddcf798b58392536f323a7b17
---

# Story 1.9: Golden-file regression harness

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want CI golden-file regression tests over known-good `.session`/library fixtures,
So that a Serato format change is caught before it silently corrupts synced data.

## Acceptance Criteria

1. **Given** golden `.session` + `database V2` + `master.sqlite` fixtures with expected parsed output, **When** CI runs, **Then** any deviation fails the build. *(NFR-4, NFR-5, AR-7 layer 1)*
2. **Given** a newly discovered format quirk, **When** a fixture is added, **Then** it becomes a permanent regression guard.
3. **Given** the fixture set, **Then** it covers both legacy and Serato 4+ library formats. *(AR-5)*

### Scope boundaries (binding — read before writing code)

- **This story covers the two format-decode filters, not the whole pipeline.** "Format drift" (AD-13's own framing) only threatens the two stages that decode Serato's actual on-disk bytes: `parser` (`.session` binary, `master.sqlite` `history_entry` reads) and `joiner` (`database V2` binary catalogue, `master.sqlite` metadata reads). `stats` and `confidence` are pure arithmetic over already-decoded Rust structs — a Serato format change cannot silently corrupt their output, only the parser/joiner's. Golden coverage targets **`parser::parse`/`parser::parse_partial`, `parser::serato4::read_session`, `joiner::legacy::LegacyLibrary::from_database_bytes`, `joiner::serato4::join_session`**. Do not build end-to-end pipeline glue (`watcher -> parser -> joiner -> stats`) — no story has wired that yet (deferred-work.md, `enrich_session` entry), and wiring it is explicitly not this story's job.
- **`joiner::embedded_tags` (ID3/Vorbis fallback) is out of scope.** AC-3 names "legacy and Serato 4+ **library** formats" — the two catalogue formats, not the embedded-tag fallback. Building minimal-but-valid synthetic MP3/WAV/FLAC containers with embedded tags is a materially different (and much larger) task than the tag/length/value binary formats this story targets. Do not attempt it; if you find it trivial once the harness exists, flag it as a follow-up in deferred-work.md rather than expanding scope silently.
- **No AC-4 full-pipeline perf benchmark.** deferred-work.md's Story 1.7 entry ("`AC-4's ≤10s p95 full-library-pass target... could not be honestly benchmarked`") explicitly names *both* this story and Epic 2 Story 2.8 as candidate homes, "whichever first exercises the full pipeline against real data" — and this story deliberately does not (see above). Leave that entry as-is; do not attempt the benchmark here.
- **Fixtures are synthetic, never real DJ data.** Three separate places in the current codebase already commit to this as this story's job and must not be violated: `parser/mod.rs:196` ("Real Serato session data is personal DJ history and is never committed as a fixture — golden-file fixtures are Story 1.9's job"), `joiner/legacy.rs:103` ("without ever committing real library data — Story 1.9 owns fixtures"), `joiner/serato4.rs:111-112` ("Real Serato data is never committed as a fixture"). Every checked-in fixture file must be **hand-built synthetic bytes**, constructed the same way the existing inline tests already do (`parser/mod.rs`'s `oent`/`adat`/`text_field`/`u32_field` builders; `joiner/serato4.rs`'s/`parser/serato4.rs`'s `in_memory_history()` schema). Real Serato data may be **read, never written to a commit** — see Task 1.
- **This is the first story to introduce a `tests/` integration-test directory.** Every prior Epic 1 story used inline `#[cfg(test)] mod tests` only, specifically because no story before this one needed a file-backed fixture. That convention doesn't fit here: a "golden file" is definitionally a checked-in file, and Rust's own convention for tests that need on-disk fixtures is `agent/src-tauri/tests/` (a `cargo test`-discovered integration-test crate, run automatically by the existing CI `agent` job's `cargo test --manifest-path agent/src-tauri/Cargo.toml` — no CI or `Cargo.toml` change needed). Do not force this into inline `#[cfg(test)]` modules; do not add a new `[dev-dependencies]` entry — everything needed (`rusqlite`, the crate's own public API) is already a normal dependency or already `pub`.

## Tasks / Subtasks

- [ ] **Task 1 — Real-data reconnaissance (read-only; informs Tasks 2-4, closes several standing deferred-work items)** (AC: 2, 3)
  - This machine has Arjun's real Serato data, already inspected by Stories 1.2/1.3b/1.4/1.8 (see paths below). Several code-review findings from those stories explicitly deferred a real-data check to "Story 1.9's fixture work" — do that check now, log findings to `deferred-work.md`, and **only** turn a finding into a code change if the fixture work surfaces a genuine bug (AD-11: log, don't guess; never fix speculatively).
  - Known real paths (confirmed by prior stories, re-verify each still exists before reading — do not error the story if one is missing, e.g. the USB drive may not be mounted):
    - `~/Music/_Serato_/History/Sessions/2521.session` — multi-track wedding session (302 plays).
    - `~/Music/_Serato_/History/Sessions/19544.session` — USB-hosted + WAV-heavy session (116 plays, 14 WAV).
    - `~/Music/_Serato_/database V2` — local legacy library (661,594 bytes, root-hosted).
    - `/Volumes/ARJUN SSD/_Serato_/database V2` — USB-hosted library (3,217,384 bytes, 4,972 tracks) — **only if the SSD is mounted**; skip and note "unavailable this run" in deferred-work.md if not.
    - `~/Library/Application Support/Serato/Library/master.sqlite` — Serato 4+ (489 sessions, 23,254 `history_entry` rows).
  - Specific checks to run, each tied to a standing deferred-work.md entry (read the full entry before starting — cited below by its exact anchor text):
    1. **Volume-hosted `database V2` path resolution** — read the USB `database V2`'s stored path strings (via `LegacyLibrary::from_database_bytes` on the real bytes, in a throwaway, uncommitted script/test) and compare their shape against a `.session` play's absolute path for a track on that same volume. Confirm or refute whether `joiner/legacy.rs`'s "strip one leading `/`" convention (Story 1.2 findings §5/D4) actually resolves a volume-hosted path, or whether it needs a volume-root strip Story 1.4 didn't add. [deferred-work.md — "Flag for Story 1.9 (golden-file suite) — volume-hosted `database V2` path resolution is unproven against real data."]
    2. **Path Unicode/case encoding mismatch** — while the USB `database V2` is open, find one accented-artist track (e.g. containing `é`, `ö`, `ó`) and compare its stored path bytes against the same file's path as it appears in a `.session` play record. Confirm whether `.session` and `database V2` agree on NFC/NFD normalization and case. [deferred-work.md — "Flag for Story 1.9 — path *encoding* mismatch is untested in either direction..."]
    3. **Duplicate-path last-wins tiebreak** — scan the local or USB `database V2` for two track records sharing the same file path (a re-analyzed track). If found, confirm which one's fields (e.g. BPM) match Serato's own displayed value today, validating or refuting the "last-processed wins" assumption in `LegacyLibrary::from_database_bytes`. [deferred-work.md — "Duplicate-path last-wins tiebreak is an unconfirmed assumption."]
    4. **RF-2 trailing-fragment/desync false positive** — run `parser::parse` (or `parse_partial`) over all 474 real `.session` files in `~/Music/_Serato_/History/Sessions/` (throwaway script, not committed) and check whether any real file produces `ParseError::Desync` from benign trailing padding rather than genuine corruption. [deferred-work.md — "Flag for Story 1.9 (golden-file suite) — RF-2's trailing-fragment hard failure is unverified against real files."]
    5. **Legacy numeric TCON genre forms** — while inspecting real embedded tags is out of this story's fixture scope (see Scope Boundaries), if the `database V2`/`.session` scan incidentally surfaces a numeric-form genre string (e.g. `"(17)"`), note it for `deferred-work.md`'s existing genre-taxonomy entry; do not go out of your way to hunt for this one.
  - For each check: log the outcome (confirmed / refuted / inconclusive / SSD unavailable) as an update to the **existing** deferred-work.md entry (do not delete the entry — append a `[REAL DATA FOUND <date>, Story 1.9]` note the way Story 1.3b's entries already do), and if a check reveals a genuine quirk worth guarding against, build a **synthetic** fixture in Tasks 2-3 that reproduces the shape of that quirk (never the real bytes themselves).

- [ ] **Task 2 — `.session` golden fixtures + harness** (AC: 1, 2, 3)
  - Create `agent/src-tauri/tests/golden_session.rs` (a `cargo test`-discovered integration test file).
  - Build fixture bytes using the same tag/length/value structure as `parser/mod.rs`'s existing inline test helpers (`oent`, `adat`/`tagged`, `text_field`, `u32_field`, `vrsn_header`) — either by duplicating those small helpers locally in the new test file (integration tests cannot import a crate's private inline test module) or, if it doesn't fight the borrow/visibility rules, extracting them to a `pub(crate)` test-support module the two locations share. Prefer duplication if extraction adds meaningful complexity — these are ~10-line pure functions, not worth a shared-module abstraction for two call sites.
  - At minimum, cover fixtures for:
    - A normal multi-play session (several `oent` records, a leading `vrsn` header, mixed field presence) with its exact expected `Vec<Play>` asserted.
    - A session exercising the duplicate-row-by-row-ID dedup path (mirrors `dedups_duplicate_rows_by_row_id_preserving_order`, but as a **checked-in fixture file**, not an inline byte literal).
    - A **desync** case: per deferred-work.md's fixture-construction gotcha, remember a short `oent` triggers `Truncated` (the inner `adat` bound catches it first) — to get a genuine `Desync`, understate a top-level *header* record's length instead (see `desync_on_implausible_tag_errors`'s exact technique). Do not accidentally write a `Truncated` fixture when you mean `Desync`.
    - A **truncated** case (any of the three levels: outer `oent`, inner `adat`, or a field).
    - If Task 1's real-corpus scan (check 4) surfaced a genuine trailing-padding false-positive, add a fixture reproducing that padding shape and assert it now parses cleanly (or, if the finding instead confirms current behavior is correct, add a fixture proving today's `Desync` result is intentional and add a comment citing the real-data confirmation).
  - Each fixture file lives under `agent/src-tauri/tests/fixtures/session/` with a descriptive name (e.g. `multi_play.session`, `duplicate_row_id.session`, `desync_bad_header.session`, `truncated_field.session`) generated once (e.g. via a throwaway `#[test]`-adjacent generator you run once and commit the output, or a small local `main()`/example you don't keep) and committed as binary files — the "golden" artifact AC-1 asks for.
  - Each test reads its fixture via `parser::parse_session_file`/`parse_session_file_partial` (exercise the file-reading entry points, not just `parse`/`parse_partial` on in-memory bytes, since the golden-file harness's job is specifically to catch drift in file-backed real usage) and asserts the exact expected `Vec<Play>` / `ParseOutcome`, matching the assertion style already used in `parser/mod.rs`'s inline tests (full-struct `assert_eq!`, not spot-checks).

- [ ] **Task 3 — `database V2` golden fixtures + harness** (AC: 1, 2, 3)
  - Create `agent/src-tauri/tests/golden_legacy_library.rs`.
  - Constructing valid `database V2` bytes from scratch is more involved than `.session` (it's `triseratops::library::database::parse`'s format, not a format this codebase's own tests currently hand-build). Before writing a byte-builder from scratch, inspect the pinned `triseratops` commit's own test fixture at `~/.cargo/git/checkouts/triseratops-*/8e92aae/tests/data/library/usb_drive/_Serato_/database V2` (2,538 bytes) — it is a small, already-synthetic (MPL-2.0, the same license already adopted per AD-11), non-personal fixture the upstream crate ships for its own tests. Use it as a reference for the byte shape, and as a candidate base to copy in directly (checking it carries the `Field::Track`/`Field::BPM`/`Field::Key`/`Field::Genre`/`Field::FilePath` variants `LegacyLibrary::from_database_bytes` reads) rather than reverse-engineering the format from zero.
  - At minimum, cover fixtures for:
    - A normal catalogue with several tracks, each with BPM/key/genre, asserting the exact resulting `LegacyLibrary` (via its public surface — `len()`, and by joining a synthetic `Play` against it with `joiner::legacy::join` and asserting the resulting `JoinedMetadata`, since `LegacyLibrary`'s internal `tracks` map is private).
    - A track record with no file path (must be skipped, not indexed — mirrors the existing "no phantom entry" discipline elsewhere in this codebase).
    - If Task 1 check 1 (volume-hosted path) produced a confirmed real shape, a fixture reproducing that path convention, joined against a synthetic play using the same convention, asserting today's resolve/no-resolve behavior matches what the real data showed.
    - If Task 1 check 3 (duplicate path) produced a confirmed real shape, a fixture with two records at the same path, asserting `from_database_bytes`'s last-wins behavior matches the real-world-confirmed expectation (or documents a still-unconfirmed assumption if the real data was inconclusive — do not invent a "fix" either way).
  - Fixture files live under `agent/src-tauri/tests/fixtures/legacy_library/`, committed as binary files (this format is not human-editable text, unlike Task 4's recommended approach — see that task's note on why `master.sqlite` differs).
  - Tests call `LegacyLibrary::from_database_bytes` directly on the fixture's bytes (read via `std::fs::read` in the test) — this exercises the same decode path `LegacyLibrary::load` uses without needing a full `<library_root>/_Serato_/database V2` directory shape on disk.

- [ ] **Task 4 — `master.sqlite` golden fixtures + harness** (AC: 1, 2, 3)
  - Create `agent/src-tauri/tests/golden_serato4.rs`.
  - **Recommended fixture format: a checked-in `.sql` script, not a binary `.sqlite` file.** Reasons: (a) it stays git-diffable and human-reviewable, unlike a binary blob; (b) it matches the existing established pattern — `parser/serato4.rs::in_memory_history()` and `joiner/serato4.rs::in_memory_history()` already build the exact same `history_entry` schema in-memory via `execute_batch` with a SQL string; a checked-in `.sql` fixture is the same technique with the SQL moved to a file instead of a Rust string literal; (c) `rusqlite`'s bundled SQLite version is pinned by the crate, so a hand-crafted binary `.sqlite` file risks a page-format mismatch this codebase doesn't otherwise need to worry about. This is this story's one open design decision if you'd rather do it differently — see Open Questions.
  - Fixture files live under `agent/src-tauri/tests/fixtures/serato4/` as `.sql` scripts (e.g. `history_session_and_entries.sql`) containing `CREATE TABLE`/`INSERT` statements for `history_session`/`history_entry` covering the union of both functions' columns: `id`, `session_id`, `name`, `artist`, `genre`, `"key"`, `start_time`, `deck`, **and `bpm`** (`join_session` reads `bpm` but `read_session` does not — check both functions' `SELECT`s directly, they are not identical).
  - Test loads the fixture via `Connection::open_in_memory()` + `conn.execute_batch(&std::fs::read_to_string(fixture_path)?)`, then calls **both** `parser::serato4::read_session` and `joiner::serato4::join_session` against the same connection and session ID (this is the one live exercise of the connection-sharing contract deferred-work.md flags as untested: *"Connection-sharing contract between `parser::serato4::read_session` and `joiner::serato4::join_session` has no integration test"* — closing that gap is a natural side-effect of this task, not extra scope).
  - At minimum, cover fixtures for:
    - A normal session with several `history_entry` rows, asserting both functions' exact output.
    - The confirmed-real `end_time = -1` "unset" sentinel and empty-string "absent" convention (both already documented in `parser/serato4.rs`'s doc comments as confirmed-real, not yet fixture-covered) — a row with `end_time = -1` and empty-string `genre`/`key`, asserting they resolve to `None`, not `Some("")`/a derived duration.
    - A multi-deck session (real data confirms deck values "1"-"4" occur) to guard the `deck` text-to-`u32` parse.

- [ ] **Task 5 — Confirm CI coverage, no CI changes expected** (AC: 1)
  - `cargo test --manifest-path agent/src-tauri/Cargo.toml` (the existing `agent` CI job step, `.github/workflows/ci.yml`) auto-discovers every file under `agent/src-tauri/tests/` as its own test binary — no `Cargo.toml` or `ci.yml` edit is needed for the new tests to run and gate the build. Verify this locally (`cargo test --manifest-path agent/src-tauri/Cargo.toml` picks up `golden_session`/`golden_legacy_library`/`golden_serato4` as separate test binaries in the output) rather than assuming it.
  - Gate: `cargo fmt --manifest-path agent/src-tauri/Cargo.toml -- --check`, `cargo clippy --manifest-path agent/src-tauri/Cargo.toml --all-targets -- -D warnings`, `cargo build --manifest-path agent/src-tauri/Cargo.toml`, `cargo test --manifest-path agent/src-tauri/Cargo.toml`. If this machine lacks a linked Rust toolchain, don't skip silently — log it to `deferred-work.md` per the standing discipline (Stories 1.5/1.6), though Story 1.8's Debug Log References note the toolchain is present at `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin` (not on `PATH` by default).

- [ ] **Task 6 — Deferred-work + sprint-status housekeeping** (AC: 2)
  - Update every deferred-work.md entry Task 1 investigated, per that task's logging instruction (append findings, don't delete entries).
  - If Task 1 surfaces a **new** format quirk not already tracked anywhere, log it as a new deferred-work.md entry (per this project's standing convention, one entry per discovery, dated and file/line-anchored) even if a fixture already guards it going forward.

## Dev Notes

### Why this story is scoped the way it is

Every prior Epic 1 story (1.3, 1.3b, 1.4, 1.5) explicitly deferred its own real-data validation to "Story 1.9" by name, in five separate deferred-work.md entries (cited in Task 1). This story is the accumulated payoff of that discipline — it is not just "write some fixture tests," it is the designated checkpoint where those specific open questions get real-data-checked, using a real 474-session/two-library-format/one-Serato-4-profile corpus that already exists on this machine and has already been partially explored by Stories 1.2, 1.3b, and 1.8. Do the reconnaissance in Task 1 before writing fixtures in Tasks 2-4 — several of those fixtures are meant to encode exactly what Task 1 finds, not a generic "looks plausible" shape invented independently.

### Frozen types/files this story must NOT change

- `agent/src-tauri/src/parser/mod.rs`, `parser/serato4.rs`, `parser/session.rs` — read-only; this story adds tests, not parser changes, **unless** Task 1's reconnaissance finds an actual bug (not just an unconfirmed assumption becoming confirmed) — see AD-11 discipline: only fix what's proven wrong, never speculatively.
- `agent/src-tauri/src/joiner/*.rs` — same: read-only unless a real bug is found.
- `agent/src-tauri/src/stats/*`, `confidence.rs`, `genre.rs` — untouched; out of this story's format-decode scope entirely (see Scope Boundaries).
- `shared/`, `web/`, `.github/workflows/ci.yml`, `agent/src-tauri/Cargo.toml` — no changes expected (Task 5 confirms `tests/` auto-discovery needs none).

### Established idioms to follow

- **Infallible test harness, fallible-by-design production code stays that way.** Golden tests assert on `Result`/`Option` values the same way existing inline tests do (`assert_eq!(parse(&data).unwrap(), ...)`, `matches!(result, Err(ParseError::Truncated { .. }))`) — don't introduce a different assertion style for file-backed fixtures.
- **Full-struct equality, not spot-checks.** Every existing test in `parser/mod.rs`/`parser/serato4.rs`/`joiner/serato4.rs` asserts the entire `Play`/`JoinedMetadata` struct via `assert_eq!`, catching an accidental future field addition immediately (see `parser/serato4.rs`'s `full_row_maps_to_play_with_untouched_fields_none` comment). Golden tests must do the same — never assert only the one field you're focused on.
- **No `.unwrap()`/`.expect()` on production paths** — this story adds zero production code by default (see Frozen types above), only tests, where `.expect()` is idiomatic per house style.
- **Deterministic, no real filesystem dependency at test time.** Even though fixtures started life informed by real-data reconnaissance (Task 1), the checked-in fixtures themselves must be self-contained synthetic files that pass on any machine, in CI, with no dependency on `~/Music/_Serato_/` or any other real path existing.

### Testing standards (this story's deviation from prior stories, explained)

Stories 1.3-1.8 used inline `#[cfg(test)] mod tests` exclusively — appropriate because every fixture they needed could be built inline as a byte literal or an in-memory SQLite connection. This story is different by design: AC-1 explicitly asks for **checked-in fixture files**, which is what makes it a "golden-file" harness rather than more unit tests. Use `agent/src-tauri/tests/*.rs` (Rust's standard integration-test convention, auto-discovered by `cargo test`, zero new Cargo.toml entries needed) with fixtures under `agent/src-tauri/tests/fixtures/<format>/`. This is the one new structural convention this story introduces — don't also convert any existing inline test module to this style; leave Stories 1.3-1.8's tests exactly where they are.

### Git intelligence

Recent per-story shape (Stories 1.4-1.8): spec commit → implementation commit → code-review commit (sometimes two passes) → merge. This story is larger in surface area than 1.8 (three new integration-test files, ~10+ fixture files, one real-data reconnaissance pass) but smaller in new *production* code (ideally zero, unless Task 1 finds a real bug) — closer in shape to Story 1.2's spike (real-data-driven, findings-heavy) than to a typical single-module story. Expect the Dev Agent Record's Completion Notes to read more like a findings summary than a typical "implemented X" note.

### Project Structure Notes

- **New:** `agent/src-tauri/tests/golden_session.rs`, `agent/src-tauri/tests/golden_legacy_library.rs`, `agent/src-tauri/tests/golden_serato4.rs`; fixture files under `agent/src-tauri/tests/fixtures/session/`, `agent/src-tauri/tests/fixtures/legacy_library/`, `agent/src-tauri/tests/fixtures/serato4/`.
- **Modified:** `_bmad-output/implementation-artifacts/deferred-work.md` (Task 1/6 findings — expected, not optional, this time, unlike most prior stories' "only if surfaced" framing).
- **Untouched (expected):** all `agent/src-tauri/src/**` production files (barring a confirmed real bug from Task 1), `shared/`, `web/`, `.github/workflows/ci.yml`, `agent/src-tauri/Cargo.toml`.

### References

- [epics.md — Story 1.9, Epic 1 overview, NFR-4/NFR-5](../planning-artifacts/epics.md)
- [ARCHITECTURE-SPINE.md — AD-13 (three-layer format-drift resilience; golden-file CI tests are layer 1)](../planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md)
- [deferred-work.md — five entries explicitly deferred to this story: Story 1.4's volume-hosted-path and path-encoding entries, Story 1.4's duplicate-path-tiebreak entry, Story 1.3's RF-2 trailing-fragment entry and its fixture-construction gotcha, Story 1.6's numeric-TCON entry, and Story 1.7's AC-4 full-pipeline-benchmark entry (explicitly optional here)](./deferred-work.md)
- [1-2-parser-validation-spike-findings.md — real corpus map: exact file paths, sizes, and per-session play counts used in Task 1](./1-2-parser-validation-spike-findings.md)
- [agent/src-tauri/src/parser/mod.rs — `Play`, `ParseError`, `ParseOutcome`, `parse_session_file`/`parse_session_file_partial`; its own test module's byte-builder helpers to reuse/duplicate; line 194's fixture-ownership comment](../../agent/src-tauri/src/parser/mod.rs)
- [agent/src-tauri/src/parser/serato4.rs — `read_session`; its `in_memory_history()` schema to mirror as a `.sql` fixture](../../agent/src-tauri/src/parser/serato4.rs)
- [agent/src-tauri/src/joiner/legacy.rs — `LegacyLibrary::from_database_bytes`, `join`; line 103's fixture-ownership comment](../../agent/src-tauri/src/joiner/legacy.rs)
- [agent/src-tauri/src/joiner/serato4.rs — `open_read_only`, `join_session`; its `in_memory_history()` schema; line 111-112's fixture-ownership comment](../../agent/src-tauri/src/joiner/serato4.rs)
- [1-8-live-practice-confidence-signal.md — previous story; confirms real `master.sqlite` path and toolchain location on this machine](./1-8-live-practice-confidence-signal.md)

## Open Questions / Assumptions

1. **[DESIGN — recommended default given] `master.sqlite` fixture format: checked-in `.sql` script vs. binary `.sqlite` file.** Task 4 recommends a `.sql` script loaded via `execute_batch` at test time (git-diffable, matches the existing in-memory-schema pattern, avoids a SQLite page-format/version mismatch risk). A binary `.sqlite` file is the more literal reading of AC-1's "master.sqlite fixtures" wording but has none of those advantages. Proceed with the `.sql` recommendation unless Arjun prefers otherwise.
2. **[PRODUCT — carried forward from deferred-work.md] Several of Task 1's checks may confirm a real bug (e.g. volume-hosted path resolution genuinely failing, or a Unicode-normalization mismatch).** If so, per AD-11 discipline this story fixes only what Task 1 concretely proves broken — it does not go hunting for or speculatively patching adjacent issues. Flag any such fix clearly in the Dev Agent Record so it reads as a data-driven bug fix, not scope creep.
3. **[SSD availability]** If `/Volumes/ARJUN SSD` is not mounted when this story is implemented, Task 1's checks 1-2 (both keyed on the USB library) cannot run this pass. Log as "unavailable this run" in deferred-work.md rather than skipping silently or blocking the story — the local (non-USB) `database V2` and the 474 `.session` files remain available regardless.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
