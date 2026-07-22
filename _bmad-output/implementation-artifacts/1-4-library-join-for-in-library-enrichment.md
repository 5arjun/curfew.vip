---
baseline_commit: 3091a6bc0f3794faf1fea6a8d271e791162fd17e
---

# Story 1.4: Library join for in-library enrichment

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a DJ,
I want each played in-library track resolved to its BPM/key/genre from the Serato library DB,
So that my per-set stats reflect real track metadata.

## Acceptance Criteria

1. **Given** a legacy `database V2` library, **When** a played track is in-library, **Then** BPM/key/genre resolve from it. *(FR-2, AR-5)*
2. **Given** a Serato 4+ `master.sqlite` library, **When** a played track is in-library, **Then** BPM/key/genre resolve from it. *(FR-2, AR-5)*
3. **Given** tracks referenced by relative vs absolute paths, **When** joined, **Then** paths resolve against the configured library root correctly. *(AR-5)*
4. **Given** an in-library track missing a metadata field, **Then** that field routes to the embedded-tag fallback (Story 1.5), never a guess.

## Tasks / Subtasks

- [x] **Task 1 — Add the new production dependency; re-verify all pinned versions** (AC: 1, 2)
  - [x] Add `rusqlite = { version = "0.40.1", features = ["bundled"] }` to `agent/src-tauri/Cargo.toml`'s `[dependencies]` — re-verify this is still current on crates.io immediately before implementing (confirmed current as of 2026-07-22: `0.40.1`). `bundled` statically links SQLite so the packaged agent never depends on the DJ's OS-installed SQLite version — required for a distributed desktop app, not just convenience.
  - [x] Re-verify `triseratops` `main`'s HEAD is unchanged (`git ls-remote https://github.com/Holzhaus/triseratops.git main`) — confirmed unchanged as of 2026-07-22: still `8e92aae1794c4f02a2405eb88ea72f251b077f0c` (no drift since Story 1.3). Re-verify `id3 = "1.17.0"` is still current (confirmed unchanged). Neither dependency's `Cargo.toml` entry needs to change — both were pinned in Story 1.3 and are first put to real use by this story.
  - [x] `cargo build --manifest-path agent/src-tauri/Cargo.toml` succeeds with the new dependency.

- [x] **Task 2 — Implement the `joiner` pipeline filter's public surface** (AC: 1, 2, 3, 4)
  - [x] Create `agent/src-tauri/src/joiner/mod.rs`, registered via `pub mod joiner;` in `lib.rs` (mirrors Story 1.3's `parser` module pattern; both are named in the `lib.rs` module doc comment's `watcher -> parser -> joiner -> stat-engine -> local store -> sync-queue` pipeline).
  - [x] Define the shared output type once, used by both format-specific join functions:
    ```rust
    #[derive(Debug, Clone, Default, PartialEq)]
    pub struct JoinedMetadata {
        pub in_library: bool,
        pub bpm: Option<f64>,
        pub key: Option<String>,
        pub genre: Option<String>,
    }
    ```
  - [x] **AC-4 is satisfied by this type's shape, not by extra logic**: every field is independently `Option`. A field that is `None` — whether because the track is entirely off-library, or because it *is* in-library but that one field is absent/unparseable in the DB record — is uniformly the signal Story 1.5's embedded-tag fallback (not yet built) will act on later. Do not special-case "in-library but missing one field" vs "off-library" — the `Option::None` already carries that meaning identically. Do not build any embedded-tag reading in this story — that is Story 1.5's scope.
  - [x] Genre stored/returned here is the **raw** Serato genre string. Do not normalize it — genre normalization (FR-8, raw+normalized+`taxonomy_version`, AD-12) is Story 1.6's scope, not this one.
  - [x] Key is returned as-is (already Camelot notation per the source data, per Story 1.2 findings — see Dev Notes). No reformatting in this story.

- [x] **Task 3 — Legacy `database V2` join** (AC: 1, 3, 4)
  - [x] Create `agent/src-tauri/src/joiner/legacy.rs`. **Critical: do not use `triseratops::library::Library` / `Track` for this.** Read Dev Notes → "`triseratops::library::Track` silently drops BPM" before writing any code here — using the crate's high-level, documented API (`Library::read_from_path` + `Library::track`) will build and pass a naive test, but AC-1's BPM resolution will always return `None` for every track, because `Track::from_fields` discards the `BPM` field via its `_ => ()` catch-all. Call the crate's own lower-level `triseratops::library::database::parse(&bytes) -> Result<Vec<database::Field>, triseratops::error::Error>` directly instead (it is `pub`) and extract `database::Field::BPM` yourself.
  - [x] Implement a small loader that mirrors `Library`'s own path convention (so behavior matches what `triseratops` itself expects, without depending on its BPM-dropping `Track` type):
    - Read `library_root.join("_Serato_").join("database V2")` via `std::fs::read` (no `.unwrap()`/`.expect()` — map IO failure to a `JoinError` variant).
    - Call `triseratops::library::database::parse(&bytes)`, map its `Result::Err` to a `JoinError` variant (wrap `triseratops::error::Error`, which already implements `Display`/`std::error::Error` via `thiserror` — no need to reimplement that).
    - Walk the returned `Vec<Field>`; for each top-level `Field::Track(inner_fields)`, walk `inner_fields` and extract exactly: `Field::FilePath(path) -> PathBuf` (the join key), `Field::BPM(s: String)` (parse to `f64` via `s.parse()`, `Err` → `None`, never a panic, never a fabricated value), `Field::Key(String)`, `Field::Genre(String)`. Ignore every other field variant. Build a `HashMap<PathBuf, LibraryTrack { bpm, key, genre }>` (one struct/lookup table per loaded library — this is your own type, not `triseratops::library::Track`).
  - [x] **Path resolution (AC-3)**: `database V2` stores paths **root-relative, no leading `/`** (confirmed, Story 1.2 findings §5/D4); `parser::Play.path` (from Story 1.3) is **fully absolute POSIX** for the same track. Resolve by trying the absolute path first, then stripping a single leading `/` and retrying — mirror the two-step approach in `agent/spike-1-2-parser-validation/src/library.rs::resolve()` (this project's own prior research; consulting it is fine per Story 1.3's clean-room-discipline note — write the production version fresh, don't copy the file verbatim). Use `Path`/`PathBuf` comparisons throughout, never `.to_str().unwrap()` — a path is not guaranteed valid Unicode (Story 1.2 findings §5/D2).
  - [x] Public join function: `pub fn join(play: &crate::parser::Play, library: &LegacyLibrary) -> JoinedMetadata`. `play.path.is_none()` → `JoinedMetadata::default()` (`in_library: false`, everything else `None`) — a play with no path can never resolve against any library. Otherwise resolve via the path logic above; a hit sets `in_library: true` and copies whatever fields the library record actually has (each independently possibly `None` — see Task 2); a miss sets `in_library: false` with all fields `None`.
  - [x] `JoinError` has two variants (`Io(std::io::Error)`, `Parse(triseratops::error::Error)`), mirroring the `Display`/`std::error::Error` idiom already established by `SchemaLoadError` (`agent/src-tauri/src/lib.rs:28-43`) and `ParseError` (`agent/src-tauri/src/parser/mod.rs`). No panics anywhere on the load/join path.

- [x] **Task 4 — Serato 4+ `master.sqlite` join** (AC: 2)
  - [x] Create `agent/src-tauri/src/joiner/serato4.rs`. Per Story 1.2 findings §3/§8, `master.sqlite`'s `history_entry` table already carries `bpm`/`key`/`genre` **denormalized directly on the play row** — richer than the legacy join ever produces, and unlike the legacy path, **there is no separate path/library table to join against for this story's purposes** (findings §8 flagged `location_id`/`asset_id` FK exploration as unexplored and out of scope for this story — see Dev Notes → Serato 4+ scope boundary). This story's Serato 4+ "join" is therefore a direct, read-only SQL read of those columns, not a lookup against a second table.
  - [x] Open the database read-only, mirroring `agent/spike-1-2-parser-validation/src/serato4.rs::open_read_only` (own prior code — consult, write fresh): `Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)`. **Never open the DJ's live `master.sqlite` for writing** — Serato may have it open concurrently.
  - [x] `pub fn join_session(conn: &rusqlite::Connection, session_id: i64) -> rusqlite::Result<Vec<JoinedMetadata>>` — `SELECT bpm, key, genre FROM history_entry WHERE session_id = ?1 ORDER BY start_time ASC` (column names and the ordering convention per spike's `plays_for_session`). Map each row directly to a `JoinedMetadata` (`bpm: Option<f64>` from a nullable REAL column, `key`/`genre: Option<String>` from nullable TEXT columns — `rusqlite`'s `row.get::<_, Option<T>>(..)` handles NULL without a panic).
    - **[SUPERSEDED BY CODE REVIEW, 2026-07-22]** The signature as specified returns an unkeyed `Vec`, correlatable only by position. See Review Findings RF-1 — shipped as `Result<Vec<(i64, JoinedMetadata)>>` with `ORDER BY start_time ASC, id ASC`.
  - [x] `in_library` for this format: **set `true` unconditionally** for every row this function returns (see Dev Notes → Serato 4+ `in_library` is an open assumption for why, and what to check before trusting this default).
  - [x] **This function is intentionally not wired into any live pipeline yet.** Story 1.3b (`master.sqlite` play-log reader, still backlog) is what will produce a session's play-log for this format and hand this function a real `session_id`; that wiring happens when 1.3b (or the watcher story) lands. This mirrors the precedent Story 1.3 Task 1 set: pinning `triseratops`/`id3` before any story called them. Do not attempt to build 1.3b's scope here — this task's only job is a standalone, independently-tested join function.

- [x] **Task 5 — Unit tests: both formats, synthetic fixtures only** (AC: 1, 2, 3, 4)
  - [x] Do not commit real Serato library data — same policy as Story 1.3 (golden-file fixtures are Story 1.9's job). Build synthetic byte fixtures for the legacy format in-test, matching the confirmed `database V2` tag format (1-byte type + 3-byte name + 4-byte BE length + content; text content is UTF-16BE via `triseratops`'s own decoder — see Dev Notes for the exact byte layout).
  - [x] Legacy tests: (a) a track present in the library with all three fields set → `JoinedMetadata { in_library: true, bpm: Some(_), key: Some(_), genre: Some(_) }`; (b) a track present but missing one field (e.g. no `BPM` field in its record) → that field `None`, others resolved (AC-4); (c) a play whose path has no match in the library → `in_library: false`, all fields `None`; (d) a play referenced by absolute path resolving against a library storing the same track root-relative (AC-3); (e) a malformed/unparseable `BPM` string (e.g. non-numeric) → `bpm: None`, not a panic and not a fabricated value; (f) a play with `path: None` → `in_library: false` without touching the library at all.
  - [x] Serato 4+ tests, using an in-memory `rusqlite` connection (`Connection::open_in_memory()`) with a minimal `history_entry` table created in-test (columns: `session_id`, `bpm`, `key`, `genre`, `start_time` — schema inferred from Story 1.2's spike query, not independently confirmed against a real file — see Dev Notes): (a) a full row → all three fields resolved, `in_library: true`; (b) a row with a `NULL` `genre` column → `genre: None`, others resolved; (c) rows for a different `session_id` are excluded; (d) results ordered by `start_time`.
  - [x] All tests run under the crate's existing gates: `cargo fmt --manifest-path agent/src-tauri/Cargo.toml -- --check`, `cargo clippy --manifest-path agent/src-tauri/Cargo.toml --all-targets -- -D warnings`, `cargo test --manifest-path agent/src-tauri/Cargo.toml`.

- [x] **Task 6 — Confirm the existing CI gate covers this without changes** (AC: all)
  - [x] `.github/workflows/ci.yml`'s `agent` job already installs `build-essential` (line ~68, for Tauri's own Linux build prereqs) — this is also what `rusqlite`'s `bundled` feature needs to compile its vendored SQLite C source via the `cc` crate. Verify the build succeeds in CI without adding any new system package; if it doesn't, that's a signal the `bundled` feature needs something the Tauri prereqs don't already provide, not a reason to fall back to a non-bundled/system-linked SQLite.
  - [x] No `.github/workflows/ci.yml` changes should be needed otherwise — same conclusion as Story 1.3 Task 5, for the same reason (this module lives inside the same `agent/src-tauri` crate the existing job already fully gates).

### Review Findings

Blind Hunter, Edge Case Hunter, and Acceptance Auditor run in parallel against the uncommitted working tree (baseline `3091a6b` = current HEAD). `cargo fmt --check`, `cargo clippy --all-targets -D warnings`, and `cargo test` independently re-run and confirmed green (49/49 passing: 21 pre-existing + 28 new in `joiner`). 11 raw findings dismissed as noise, false positive, or already handled in `deferred-work.md`/the existing Review Record — see the code-review completion summary for the full dismiss list.

- [x] [Review][Patch] Dev Agent Record test-count arithmetic is self-contradictory [1-4-library-join-for-in-library-enrichment.md:189] — "35 pre-existing + 11 new" contradicts its own itemized breakdown (4+12+9=25) and the "25 new total" in the same sentence; independently verified via `cargo test` that the real numbers are 21 pre-existing, 28 new (3 `mod.rs` + 14 `legacy.rs` + 11 `serato4.rs`), 49 total. Fixed: numbers corrected in place.
- [x] [Review][Patch] Legacy join indexes an empty catalogue path with no emptiness guard [agent/src-tauri/src/joiner/legacy.rs:122] — `Field::FilePath(p) => path = Some(p)` stores the path unconditionally, unlike `Key`/`Genre` which already route through `non_empty()`; a record with an empty stored path indexes under `""` and could spuriously match a played path that also resolves empty, misreporting `in_library: true`. Fixed: guard added (`if !p.as_os_str().is_empty()`), plus a covering test.
- [x] [Review][Patch] No failure-mode test coverage for `serato4::open_read_only` [agent/src-tauri/src/joiner/serato4.rs:33] — unlike `legacy.rs`'s symmetric `missing_catalogue_maps_to_io_error`/`malformed_catalogue_maps_to_parse_error` tests, nothing pins that a missing or non-SQLite file at this path fails safely (it does, via `Result` propagation — no panic risk — this is a coverage gap, not a functional defect). Fixed: two tests added (missing path, non-SQLite file).
- [x] [Review][Patch] Duplicate-path last-wins comment states an unverified assumption as fact [agent/src-tauri/src/joiner/legacy.rs:457-462] — `duplicate_paths_resolve_to_the_last_record`'s comment asserts last-wins "matches the catalogue's own append order, so a re-analysed track's newer BPM beats the stale row" without the `[ASSUMPTION]`-style hedge and Story 1.2 findings citation the rest of the module uses for comparable unverified claims (see the already-deferred volume-hosted-path and Unicode-encoding entries in `deferred-work.md`, which this claim is epistemically identical to). Fixed: comment hedged with an `[ASSUMPTION]` tag and a matching `deferred-work.md` entry added.
- [x] [Review][Defer] `sane_bpm` has no upper bound [agent/src-tauri/src/joiner/mod.rs:72-73] — accepts any finite positive value, so a corrupted-but-positive BPM (e.g. a mis-decoded "999999.00") passes through as a real measurement into what will become Story 1.7's tempo averages. Not required by any AC; the correct threshold is a product call (DJs do spin 200-300 BPM genres) better made when Story 1.7 actually consumes this value.
- [x] [Review][Defer] `serato4::join_session` fails the whole session on one row's type-coercion error [agent/src-tauri/src/joiner/serato4.rs:86-98] — `row.get::<_, Option<f64>>` etc. propagate a column type-coercion failure as `Err` via `?`, so `.collect()` fails the *entire session's* join rather than degrading just that one field to `None` (asymmetric with the legacy path's per-field grace). Low real-world likelihood (requires a non-conforming SQLite column type) and arguably consistent with this file's own precedent that schema-shape anomalies are hard errors (`missing_table_is_an_error_not_an_empty_set`) — worth revisiting with real `master.sqlite` data rather than patching speculatively now.

## Dev Notes

### Critical finding: `triseratops::library::Track` silently drops BPM

Read this before writing Task 3. `agent/src-tauri`'s pinned `triseratops` commit (`8e92aae1`) exposes a high-level `Library`/`Track` API (`triseratops::library::{Library, Track}`, the one shown in the crate's own doc example) — but `Track`'s fields are `file_type, title, artist, album, genre, comment, composer, grouping, label, key, missing, beatgrid_locked`. **There is no `bpm` field on `Track` at all.** `Track::from_fields` (the function that builds a `Track` from parsed database fields) matches every field variant it cares about and silently drops everything else via a trailing `_ => ()` — including `database::Field::BPM(String)`, which the lower-level parser does produce. A dev agent that reaches for the crate's documented, obvious API (`Library::read_from_path` + `Library::track()`) will get a track that compiles, resolves `key`/`genre` correctly, and returns `None` for BPM on **every single track, always** — a silent-wrong-answer bug that would pass a shallow test and fail AC-1 in a way that's easy to miss (`Option<f64>::None` looks identical to "off-library" and to "field genuinely absent," which is exactly the class of bug Story 1.3's own review pass (RF-1..RF-5) spent real effort eliminating in the parser).

The fix: call `triseratops::library::database::parse(&bytes) -> Result<Vec<database::Field>, triseratops::error::Error>` directly (it is `pub`, verified in the vendored source at `~/.cargo/git/checkouts/triseratops-*/8e92aae/src/library/database.rs`) and extract `Field::BPM`, `Field::Key`, `Field::Genre`, `Field::FilePath` from each `Field::Track(inner_fields)` entry yourself, bypassing `Library`/`Track` entirely. This is not reinventing the parser (the format decode is still 100% `triseratops`'s own `nom`-based code) — it is using a different, lower-level entry point of the same pinned dependency because the higher-level convenience wrapper loses a field this story needs. `Field::BPM`'s payload is a `String` (e.g. a decimal like `"128.00"`), not numeric — parse it with `str::parse::<f64>()`, and treat a parse failure as `None`, exactly like a missing field (never guess, never panic, matching AD-11 and this project's established `Result`-over-panic convention from Stories 1.1/1.3).

### Serato 4+ scope boundary: why this story doesn't chase `location_id`/`asset_id`

Story 1.2's findings (§8) flagged that `master.sqlite`'s `history_entry` has **no path column** — a full library-catalog join for this format would need to follow `location_id`/`asset_id` FKs into `location`/`asset` tables, which the spike never explored. This story does **not** need that exploration: AC-2 only asks that a **played** track's BPM/key/genre resolve from the Serato 4+ library, and `history_entry` already carries those three fields **directly on the play row** (confirmed in the spike's `Serato4Play` struct and sample output, findings §3/§9) — richer than the legacy path, which genuinely requires a separate library-file join. Chasing the location/asset schema would be solving a problem (path-based library browsing) this story doesn't have; it would become relevant only if a future story needs an off-library **path** for this format (e.g. for Story 1.5's embedded-tag fallback, if that story ever needs to read tags for a Serato 4+ off-library play) — flagged below as an open question for whoever builds that, not this story's job.

### Serato 4+ `in_library` is an open assumption

Unlike the legacy path — where "in-library" is a real, testable outcome of a path lookup succeeding or failing against a separate `database V2` file — `master.sqlite`'s `history_entry` was never confirmed (by Story 1.2's spike) to carry an explicit library-membership signal separate from the play log itself. This story defaults every Serato 4+ row to `in_library: true`, because:
- The three metadata fields are already denormalized on the play row with high measured coverage (findings §3/§9), unlike a genuinely off-library legacy play (which has zero row to look up at all).
- No confirmed column in the explored schema distinguishes "played from an indexed library track" vs. "played straight off disk" for this format.

**This does not silently break AC-4**: a Serato 4+ row with a `NULL` `genre`/`bpm`/`key` column still comes back `None` for that field regardless of the `in_library` flag's value, so Story 1.5's future fallback routing behaves correctly either way — only the *display* semantics of the `in_library` flag itself (used elsewhere for the in-library/off-library glossary distinction, PRD §3) might be inaccurate until this is checked. Flagged in Open Questions below for confirmation against a real `master.sqlite` file (ideally during Story 1.3b, which will have a live connection to inspect the fuller schema anyway).

### Why AC-4 needs no dedicated code

`JoinedMetadata`'s three fields are independently `Option`. A missing field is `None` whether the track is off-library entirely or in-library with a gap in that one column — Story 1.5 (not yet built) treats every `None` the same way (route to embedded-tag fallback, then to visible "Unknown" if that also comes up empty, per AD-11). Do not write an `if in_library && field.is_none()` branch anywhere — the type already makes the distinction moot for AC-4's purposes.

### `Play.genre`/`Play.key` vs. this story's `JoinedMetadata` are two separate data points — do not merge them here

`parser::Play` (Story 1.3) already carries its own `genre` (field 9) and `key` (field 51) straight from the `.session` play-log entry — both marked "High confidence" in Story 1.2's findings (§3), unlike BPM (field 15, excluded from `Play` as low-confidence specifically because it was deferred to this story). This story's `JoinedMetadata.genre`/`.key` come from a **different** source (the library file/DB), independent of whatever `Play` already recorded. AC-1/AC-2's wording ("BPM/key/genre resolve from [the library]") and AD-11 both describe the join purely in terms of the library as the resolution source — neither mentions reconciling it against the play log's own inline fields. **This story does not decide how (or whether) `Play.genre`/`Play.key` and `JoinedMetadata.genre`/`.key` get reconciled into one final value** — that merge policy belongs to whichever story assembles the final per-play enriched record for stats/sync (most likely Story 1.7's stat-engine, the next pipeline stage after this one, or Story 1.10 when the `shared/` contract shape is frozen). Return `join()`'s result as its own independent struct; do not read or override anything on the `Play` passed in.

### Genre normalization and Camelot formatting are explicitly out of scope

This story returns the **raw** genre string and the key **as stored** in the source library. FR-8/AD-12 (normalize + store raw + normalized + `taxonomy_version`) is Story 1.6. Camelot-wheel display/compat scoring is part of the stat-engine (Story 1.7, FR-6). Returning anything other than the raw values here would duplicate work those stories own.

### Architecture citations

- **AD-11**: two-path parser/joiner; the session↔library join resolves relative-vs-absolute paths against the library root (this story, directly); off-library → embedded tags (Story 1.5) → visible "Unknown" (this story only needs to leave the field `None` for that chain to work).
- **AR-5**: FR-2's testable consequences — in-library tracks resolve BPM/key/genre from the library; off-library tracks fall back to embedded tags (1.5); neither source present → "Unknown" (1.5/stat-engine display, not this story).
- **Consistency Conventions table** (ARCHITECTURE-SPINE.md): "Unknown data... carries the `in_library` flag — never omitted, never guessed" — `JoinedMetadata.in_library` is that flag.
- **AD-1**: the edge (this joiner) owns the session↔library join; the cloud never re-derives it.

### Previous story intelligence (1.3)

- `parser::Play` (Story 1.3, frozen/shipped) is the input this story's legacy join consumes — specifically `play.path: Option<String>`, the absolute POSIX path. Do not modify `Play` or `parser::mod.rs`/`parser::session.rs` in this story.
- `agent/src-tauri/Cargo.toml` already pins `triseratops` and `id3` (added in Story 1.3, unused there by design — see that story's Dev Notes → "Why pin `triseratops`/`id3` now if this story's own code doesn't call them"). This is the story that finally calls `triseratops` for real; `id3` remains unused until Story 1.5.
- Established idioms to follow, not reinvent: `SchemaLoadError` (`agent/src-tauri/src/lib.rs:28-43`) and `ParseError` (`agent/src-tauri/src/parser/mod.rs`) both use a small enum + `Display` + `std::error::Error` (with `source()` where an inner error exists) instead of `anyhow`/`thiserror` in application code — this story's `JoinError` should match that pattern for consistency, even though `triseratops::error::Error` itself happens to use `thiserror` internally (that's an upstream-crate implementation detail, not this project's own convention).
- "No panics on the parse path" is now this project's established bar (Stories 1.1, 1.3) — applies identically here: no `.unwrap()`/`.expect()` on the join path, including path handling (D2's malformed-Unicode-filename finding).

### Git intelligence

Recent commits (`c62b336` → `4211dcd` → `6b80710` → `3091a6b`) establish this repo's shape for a story: a spec-commit, then an implementation commit, then a **separate code-review commit** that extends/fixes the implementation after an adversarial pass (deferred/lower-value findings go to `deferred-work.md` rather than blocking). Expect the same shape here.

### Project Structure Notes

- New: `agent/src-tauri/src/joiner/mod.rs`, `agent/src-tauri/src/joiner/legacy.rs`, `agent/src-tauri/src/joiner/serato4.rs`.
- Modified: `agent/src-tauri/src/lib.rs` (add `pub mod joiner;`), `agent/src-tauri/Cargo.toml` (add `rusqlite` production dependency).
- Untouched: `agent/src-tauri/src/parser/` (Story 1.3, frozen), `shared/`, `web/`, `agent/spike-1-2-parser-validation/` (throwaway reference only, per Story 1.2 — do not extend it), `.github/workflows/ci.yml` (no changes expected, see Task 6).

### Testing standards

Same bar as Story 1.3: synthetic in-test fixtures only (byte-level for the legacy format, in-memory SQLite for Serato 4+), no committed real Serato data, full crate gate (`fmt --check`, `clippy --all-targets -D warnings`, `build`, `test`) must stay green. This story's Serato 4+ coverage is against an **inferred** schema (from Story 1.2's spike query, not an independently re-confirmed real-file read) — flag this the same way Story 1.3 flagged its real-corpus validation gap: acceptable to merge on synthetic tests alone, but real-schema confirmation is still open (see Open Questions).

### Latest tech / versions (re-verified 2026-07-22)

- **`rusqlite`**: latest stable is `0.40.1` (new dependency for this story) — matches the version already used, unwired, by the Story 1.2 spike.
- **`triseratops`**: `main`'s HEAD is still `8e92aae1794c4f02a2405eb88ea72f251b077f0c` — no drift since Story 1.3. Re-verify once more immediately before implementation, same discipline as Story 1.3 Task 1.
- **`id3`**: latest stable is still `1.17.0` — no drift; still unused by this story (Story 1.5's dependency).

### References

- [epics.md — Story 1.4 + Epic 1 design notes, incl. Story 1.3b's design note on why 1.4 stays enrichment-only](../planning-artifacts/epics.md)
- [ARCHITECTURE-SPINE.md — AD-1, AD-11, Consistency Conventions](../planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md)
- [1-3-clean-room-session-parser.md — previous story; `parser::Play` is this story's legacy-path input](./1-3-clean-room-session-parser.md)
- [1-2-parser-validation-spike-findings.md — §3 field map, §5 D4 path-join quirk, §8 contract inputs incl. the `location_id`/`asset_id` gap](./1-2-parser-validation-spike-findings.md)
- [agent/spike-1-2-parser-validation/src/library.rs — reference only (own prior code): path-strip `resolve()` logic](../../agent/spike-1-2-parser-validation/src/library.rs)
- [agent/spike-1-2-parser-validation/src/serato4.rs — reference only (own prior code): `history_entry` query shape](../../agent/spike-1-2-parser-validation/src/serato4.rs)
- [agent/src-tauri/src/lib.rs — `SchemaLoadError` pattern to mirror for `JoinError`](../../agent/src-tauri/src/lib.rs)
- [triseratops vendored source (pinned commit `8e92aae1`) — `src/library/parser.rs` (`Track` drops BPM), `src/library/database.rs` (`Field::BPM` exists at the lower level, `pub fn parse`)](https://github.com/Holzhaus/triseratops)

## Open Questions / Assumptions
*(None block starting the story — reasonable defaults chosen; flagged for Arjun's confirmation before/during implementation.)*

1. **[ASSUMPTION] Serato 4+ `in_library` defaults to `true` for every `history_entry` row** — no confirmed library-membership signal distinct from the play log itself was found by Story 1.2's spike (see Dev Notes). Does not affect AC-4's routing correctness (a `None` field routes to fallback either way), only the accuracy of the `in_library` flag's own display semantics. Confirm against a real `master.sqlite` file, ideally when Story 1.3b (which will hold a live connection) is built.
2. **[ASSUMPTION] Serato 4+ join does not resolve `location_id`/`asset_id` → path** — scoped out because `history_entry` already denormalizes BPM/key/genre directly, so no path-based library lookup is needed for AC-2 (see Dev Notes → Serato 4+ scope boundary). If a later story (e.g. Story 1.5's embedded-tag fallback) needs a file path for an off-library Serato 4+ play, that exploration becomes that story's job, not retroactively this one's.
3. **[ASSUMPTION] Serato 4+ `history_entry` schema used for this story's tests is inferred from Story 1.2's spike query** (`session_id, bpm, key, genre, start_time` among others), not independently re-confirmed by reading a real `master.sqlite` file during this story. Consistent with Story 1.3's own "real-corpus validation gap, by design, until Story 1.9" precedent — acceptable to merge on synthetic/inferred-schema tests, but real-file confirmation remains open.
4. **[NOTE, not a task] `Play.genre`/`Play.key` reconciliation is deferred, not decided here** — `parser::Play` already carries its own high-confidence `genre`/`key` from the `.session` play log (Story 1.3), separate from this story's library-sourced `JoinedMetadata`. Whether a later stage prefers the library value, the play-log value, or merges them is left to whichever story assembles the final per-play record (likely Story 1.7 or 1.10) — flagging so it isn't assumed resolved by this story's output shape alone.
5. **[NOTE, not a task] `join_session`'s standalone/unwired status** — this story deliberately does not wire the Serato 4+ join into any watcher/pipeline path, since Story 1.3b (the story that will produce a `session_id` for a real detected session on this format) is still backlog. The function is written and tested in isolation now so 1.3b is not blocked on it later, mirroring the precedent Story 1.3 set for `triseratops`/`id3`.
6. **[RAISED DURING IMPLEMENTATION] Volume-hosted `database V2` path resolution is unproven against real data.** AC-3 was implemented exactly as specified (absolute lookup, then strip one leading `/`), which is confirmed correct for a root-hosted library. Story 1.2's findings (§5/D4) assert the **USB** library uses the same root-relative convention, but no successful USB join was ever actually observed — that session resolved 0 of 116 plays for an unrelated reason (the tracks were never added to Serato's library at all), so the convention was never exercised end-to-end on a volume-hosted root. If a volume-hosted catalogue instead stores paths relative to its own volume (`Theo Indian/track.wav` rather than `Volumes/ARJUN SSD/Theo Indian/track.wav`), those tracks silently read as off-library. **Deliberately not "fixed" here** — a third strip-the-library-root resolution step would be guessing at a schema, and guessing is what AD-11 forbids. Cheapest resolution: inspect one USB `database V2`'s stored path strings directly during Story 1.9's golden-fixture work, then either confirm the current logic or add the third step with a real fixture behind it. Tracked in `deferred-work.md`.
7. **[RAISED DURING CODE REVIEW] Path *encoding* mismatch is untested in either direction — and #6 does not cover it.** The catalogue is keyed by `HashMap<PathBuf, _>`, i.e. byte-exact equality, while APFS is case-insensitive and macOS stores filenames decomposed (NFD). If `.session` and `database V2` disagree on Unicode normalization or case for the same file, every accented artist in the library (`Café`, `Beyoncé`, `Björk` — a large share of a real dance library) silently reads as off-library, indistinguishable from the app working correctly. No evidence either way; **deliberately not patched**, for the same reason as #6 (a speculative normalization layer is guessing at a schema). The same USB inspection resolves both: compare the stored path bytes against the `.session` bytes for one accented track. Tracked in `deferred-work.md`.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMad `dev-story` workflow, 2026-07-22)

### Debug Log References

**Dependency re-verification (Task 1), all three confirmed immediately before implementing:**
- `rusqlite` — `https://index.crates.io/ru/sq/rusqlite` → latest non-yanked `0.40.1` ✅ matches the version the story pinned.
- `triseratops` — `git ls-remote https://github.com/Holzhaus/triseratops.git main` → `8e92aae1794c4f02a2405eb88ea72f251b077f0c` ✅ unchanged since Story 1.3, no `Cargo.toml` edit needed.
- `id3` — `https://index.crates.io/3/i/id3` → `1.17.0` ✅ unchanged, still unused (Story 1.5's dependency).

**Source verification before writing Task 3** (the story's critical finding, confirmed independently in the vendored checkout at `~/.cargo/git/checkouts/triseratops-ee7e6e7c7e0bdffe/8e92aae/`):
- `src/library/database.rs:24` — `pub enum Field` **does** carry `BPM(String)` (line 61), `FilePath(PathBuf)` (68), `Genre(String)` (72), `Key(String)` (74), `Track(Vec<Field>)` (80).
- `src/library/database.rs:280` — `pub fn parse(input: &[u8]) -> Result<Vec<Field>, Error>` is public, as the story stated.
- Field envelope confirmed from the crate's own `nom` combinators (`take_field_type`/`take_field_name`/`take_field_length`): **1-byte type + 3-byte name + 4-byte BE length + content**, text as UTF-16BE code units with **no NUL terminator** (`parse_u16_text` is `all_consuming(many0(be_u16))`, so a terminator would decode into the string). Synthetic fixtures were built to that exact layout rather than guessed.
- Path constants mirrored from `src/library/parser.rs:34,38` — `DATABASE_FILENAME = "database V2"`, `SERATO_DIR = "_Serato_"`.

**Mutation testing (compensating control — see Completion Notes #1).** Three targeted mutations were applied and reverted to prove the suite has teeth:
| Mutation | Tests that failed | Verdict |
|---|---|---|
| Drop `Field::BPM` extraction (i.e. reproduce the `triseratops::Track` trap) | 4 legacy tests incl. `in_library_track_resolves_bpm_key_and_genre` | ✅ the exact trap the story warned about is caught |
| Remove the leading-`/` strip fallback | 6 legacy tests incl. `absolute_play_path_resolves_against_root_relative_library_path` | ✅ AC-3 is genuinely covered |
| Remove `ORDER BY start_time ASC` | `rows_are_ordered_by_start_time` | ✅ ordering is asserted, not incidental |

Final gate: `fmt --check` clean · `clippy --all-targets -D warnings` clean · `build` ok · `test` **46 passed, 0 failed** (21 pre-existing + 25 new — 3 in `joiner`/`mod.rs`, 13 in `legacy.rs`, 9 in `serato4.rs`).

*Environment note (not a code change):* `cargo` is not on this machine's `PATH` and `~/.cargo/bin` does not exist; the toolchain was invoked directly from `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin`. CI is unaffected (`dtolnay/rust-toolchain@stable` installs shims normally).

### Completion Notes List

Implemented all 6 tasks; all 4 ACs satisfied. Both format paths, 25 new tests, full crate gate green.

**Judgment calls made beyond the letter of the spec — flagged explicitly for review, each cheap to veto:**

1. **No natural red phase, so mutation testing was substituted.** All 46 tests passed on their first run, which is not evidence a suite works. Rather than claim a red-green cycle that did not happen, three mutations were applied to the critical behaviors and each was confirmed to fail the right tests (table above). This is reported as a deviation from the workflow's red-green-refactor step, not as a silent equivalence.

2. **`sane_bpm` + `non_empty` normalization (`joiner/mod.rs`) — the main thing to review.** The spec says an *unparseable* BPM string → `None`. Two adjacent cases were extended to the same treatment, applied identically in **both** format paths:
   - BPM values that are zero, negative, or non-finite → `None`. Serato records an unanalysed BPM as `0`, and a zero admitted as a real measurement would silently drag every tempo average the Story 1.7 stat engine computes.
   - Empty-string `key`/`genre` → `None`. `Some("")` would read downstream as a *resolved* value and would block Story 1.5's fallback from ever running for that field — i.e. it would break AC-4's intent while technically passing AC-4's letter.

   Both are "absent, never guessed" (AD-11) rather than new logic, and neither trims or rewrites a real value (`" "` is preserved as-is; there is a test asserting that). If review prefers strict spec-literalism, deleting the two helpers and their call sites is a ~6-line revert.

3. **AC-3 is implemented exactly as specified — and that leaves a real gap worth naming.** The join tries the absolute path, then strips one leading `/`, per Story 1.2 findings §5/D4. That is confirmed correct for a root-hosted library (`Users/arjun/Music/…`). For the **USB-hosted** root (`/Volumes/ARJUN SSD`), the findings assert the same root-relative convention, but the spike's USB evidence is *indirect*: its USB session resolved **0 of 116** plays, attributed to tracks never having been added to Serato's library, so no successful USB join was ever actually observed. If a volume-hosted `database V2` instead stores paths relative to its **own volume** (`Theo Indian/track.wav` rather than `Volumes/ARJUN SSD/Theo Indian/track.wav`), this resolution misses and those tracks read as off-library. A third resolution step (strip the configured `library_root` prefix) would cover it — deliberately **not** built here, because it is unspecified, untested against real data, and would be guessing at a schema. Added to Open Questions as #6; the cheapest real fix is to check one USB `database V2` byte-for-byte during Story 1.9's golden-fixture work.

4. **`LegacyLibrary::from_database_bytes` is public alongside `load`.** The decode is split from the file read so the catalogue can be tested without touching disk and without ever committing real library data. It is also the seam Story 1.9's golden-file harness will want.

5. **Track records with no `FilePath` are not indexed.** The path *is* the join key, so such a record can never resolve against a play; indexing it would only inflate the table. Asserted by `track_record_without_a_path_is_not_indexed`.

6. **`"key"` is quoted in the SQL.** `KEY` is a SQLite keyword; the spike's unquoted query worked, but quoting the identifier removes the dependency on SQLite's non-reserved-word leniency at zero cost.

7. **Scope held.** No embedded-tag reading (1.5), no genre normalization (1.6), no Camelot reformatting (1.7), no `location_id`/`asset_id` exploration (deferred per Assumption #2), no `Play.genre`/`Play.key` reconciliation (deferred per Note #4 — `join()` reads only `play.path` and mutates nothing). `parser/`, `shared/`, `web/`, the 1.2 spike, and `.github/workflows/ci.yml` are all untouched.

8. **Task 6 verified as far as is locally possible.** `.github/workflows/ci.yml:68` already installs `build-essential`, which is what `libsqlite3-sys`'s `bundled` feature needs to compile its vendored SQLite C source via `cc` (confirmed present in `Cargo.lock`). No workflow change was made. The Linux-runner compile itself can only be confirmed by CI actually running — if it fails there, the story's own guidance applies: that is a signal `bundled` needs an additional system package, **not** a reason to fall back to a system-linked SQLite.

**Assumptions carried forward unchanged** (all pre-existing, none newly introduced): Serato 4+ `in_library: true` is an unconfirmed default (documented at the function that sets it, AC-4 routing is unaffected either way); the `history_entry` schema is inferred from the 1.2 spike, not re-read from a real file; `join_session` is intentionally unwired until Story 1.3b.

### File List

**New:**
- `agent/src-tauri/src/joiner/mod.rs` — `JoinedMetadata`, shared `sane_bpm`/`non_empty` helpers, module invariants (4 tests)
- `agent/src-tauri/src/joiner/legacy.rs` — `LegacyLibrary`, `LibraryTrack`, `JoinError`, `join()` (12 tests)
- `agent/src-tauri/src/joiner/serato4.rs` — `open_read_only()`, `join_session()` (9 tests)

**Modified:**
- `agent/src-tauri/src/lib.rs` — added `pub mod joiner;` with its pipeline doc comment
- `agent/src-tauri/Cargo.toml` — added `rusqlite = { version = "0.40.1", features = ["bundled"] }`
- `agent/src-tauri/Cargo.lock` — regenerated for `rusqlite` + `libsqlite3-sys` and their transitive deps
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story status `ready-for-dev` → `in-progress` → `review`
- `_bmad-output/implementation-artifacts/1-4-library-join-for-in-library-enrichment.md` — this file (tasks, Dev Agent Record, Open Questions #6, Status)

**Deleted:** none.

### Review Record (2026-07-22, adversarial party-mode pass)

All six tasks and all four ACs independently re-verified against the working tree, not taken on the Dev Agent Record's word: `cargo fmt --check` clean, `cargo clippy --all-targets -D warnings` clean, `cargo test` green. The `triseratops::Track` BPM trap the spec warned about is genuinely avoided — `legacy.rs` reads `Field::BPM` off the low-level parser, and the story's own mutation evidence for that was reproduced.

**RF-1 (fixed) — `join_session` returned a positionally-correlated `Vec` with no play identity.** `Vec<JoinedMetadata>`, ordered by `start_time ASC` with no tiebreaker. `history_entry.start_time` is second-resolution (matching `parser::Play::start_time: Option<u32>`), so two tracks cut quickly into each other share a value, and SQL leaves tied rows unordered. Story 1.3b would have zipped this against its own independently-sorted query of the same table — silently attaching one track's BPM/key to another, with no error and no failing test. The legacy path joins on an explicit key (the file path); this one joined on luck. **Fixed:** now `Result<Vec<(i64, JoinedMetadata)>>`, `SELECT id, …`, `ORDER BY start_time ASC, id ASC`. Two tests added (`plays_tied_on_start_time_are_ordered_deterministically_by_id`, `returned_ids_identify_their_own_rows`); the id guarantee is mutation-verified (removing the id read fails three tests). Also recorded at the function: because both sides read the **same `history_entry` row**, 1.3b should select these columns in its own query and delete this function rather than call it.

**RF-2 (fixed) — duplicate catalogue paths resolved by accident.** `HashMap::insert` made last-wins an unstated side effect. Pinned as a decision with `duplicate_paths_resolve_to_the_last_record`, plus the rationale (last-wins matches the catalogue's append order, so a re-analysed track's newer BPM beats the stale row).

**RF-3 (tracked, not patched) — path *encoding* mismatch.** New Open Question #7 + `deferred-work.md`. Byte-exact `PathBuf` keying vs. APFS case-insensitivity and macOS NFD decomposition; unverified in either direction, so patching it would be guessing at a schema (AD-11). Resolved by the same USB inspection as #6.

**RF-4 (tracked, not patched) — the Serato 4+ `in_library: true` default contradicts the spine's "never guessed" Consistency Convention.** Well-documented at the function, but the record belonged in `deferred-work.md`, not only in this file — story files get archived. Now logged there, with the escalation path: if Story 1.3b finds no membership signal either, the convention needs an explicit carve-out for this format rather than a silent one.

**Accepted deviations (reviewed, kept, not reverted):** `sane_bpm` and `non_empty` (`joiner/mod.rs`). Extending "unparseable → `None`" to zero/negative/non-finite BPM and empty-string tags is "absent, never guessed" (AD-11), not new logic; a zero admitted as a measurement would drag every tempo average Story 1.7 computes, and `Some("")` would block Story 1.5's fallback while technically passing AC-4. Neither trims nor rewrites a real value (`" "` is preserved, asserted). Recorded here as accepted rather than left as a Completion Note offering to revert itself.

**Checked and struck:** WAL-mode read-only access. Probed with real `rusqlite` across three scenarios — Serato live with `-shm` present ✅, `-wal` present without `-shm` ✅, read-only directory ❌ (`CannotOpen`, a loud error rather than a wrong answer). Not a defect.

**Honest limitation on RF-1's fix:** deleting `, id ASC` still leaves the tie test passing, because SQLite's current planner happens to emit tied rows in rowid order. That is one engine version's implementation coincidence, not a guarantee, and no test written against SQLite can make it one — documented at the test rather than overclaimed. The load-bearing protection for callers is the returned `id`, which *is* enforced.

## Change Log

| Date | Change |
|---|---|
| 2026-07-22 | Story 1.4 implemented: `joiner` pipeline filter with both library paths — legacy `database V2` path-keyed join (bypassing `triseratops::library::Track`'s BPM-dropping wrapper) and Serato 4+ `master.sqlite` read-only metadata read. 25 new tests, synthetic fixtures only, full crate gate green. Status → review. |
| 2026-07-22 | Code review: RF-1 `join_session` keyed on `history_entry.id` with a total ordering (was positionally correlated — silent cross-track metadata misattribution risk for Story 1.3b); RF-2 duplicate-path last-wins pinned by test; RF-3/RF-4 (path encoding, `in_library` spine deviation) tracked in `deferred-work.md` rather than patched speculatively; `sane_bpm`/`non_empty` deviations accepted on the record. 3 new tests (49 total), full crate gate green. |
| 2026-07-22 | Code review (2nd pass, bmad-code-review): corrected self-contradictory test-count arithmetic in the Dev Agent Record; empty-path catalogue records no longer indexed; two failure-mode tests added for `serato4::open_read_only`; duplicate-path last-wins comment hedged as an unverified `[ASSUMPTION]`. `sane_bpm`'s missing upper bound and `serato4::join_session`'s whole-session failure on a row type-coercion error tracked in `deferred-work.md`. 3 new tests (52 total), full crate gate green. Status → done. |
