---
baseline_commit: 5e78510c7f571dad0c62a55fefc23eda2b0efac3
---

# Story 1.3b: `master.sqlite` play-log reader

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want a reader that produces the same ordered `Vec<Play>` contract as Story 1.3, sourced from Serato 4+'s `master.sqlite` (`history_session`/`history_entry` tables) instead of a legacy `.session` file,
So that DJs on Serato 4+ — whose legacy `~/Music/_Serato_/History/Sessions/` folder no longer changes — still produce plays for the watcher/capture pipeline.

## Acceptance Criteria

1. **Given** a Serato 4+ `master.sqlite`, **When** its `history_session`/`history_entry` tables are read for a given session, **Then** an ordered list of plays is produced in the same shape Story 1.3's `Play` uses (track ref + timestamps), via direct SQL reads — no binary envelope decoding. *(AR-5)*
2. **Given** the same session data, **When** read twice, **Then** output is deterministic (identical ordered plays), matching Story 1.3 AC-4's guarantee.
3. **Given** a session with a malformed or unreadable row, **Then** it fails safely with a diagnostic — never a panic — consistent with Story 1.3 AC-3's failure contract.
4. **Given** Story 2.6 (folder/library auto-detection) and Story 2.8 (set capture), **Then** this reader is the play-log source selected for DJs on a Serato 4+ install, while Story 1.3's `.session` parser remains the source for legacy `database V2` installs — the watcher never has to choose blind. *(closes the scope gap flagged in Story 1.3's Review Findings / Open Questions #1)*

## Tasks / Subtasks

- [ ] **Task 1 — Implement the `parser::serato4` module: a direct-SQL play-log reader producing `Vec<Play>`** (AC: 1, 2, 3)
  - [ ] Create `agent/src-tauri/src/parser/serato4.rs`, registered as a private submodule (`mod serato4;`) inside `agent/src-tauri/src/parser/mod.rs` — mirror the existing `mod session;` + `pub use session::{parse, parse_partial};` pattern exactly: add `pub use serato4::read_session;` alongside it. This keeps both play-log sources under one `parser::` namespace, matching the epics.md framing "two play-log sources, one `Play` contract."
  - [ ] Public signature: `pub fn read_session(conn: &rusqlite::Connection, session_id: i64) -> rusqlite::Result<Vec<crate::parser::Play>>`. **Do not add an `open_read_only` helper to this module and do not import anything from `crate::joiner`.** The `parser` pipeline stage must stay independent of the `joiner` stage that comes after it (`lib.rs`'s documented pipeline: `watcher -> parser -> joiner -> stat-engine -> ...`) — reusing `joiner::serato4::open_read_only` from here would point that dependency backwards. Callers (a future watcher/capture story) open the connection once via the already-shipped `joiner::serato4::open_read_only(path)` and pass the same `&Connection` to both this function and `joiner::serato4::join_session` — see Dev Notes → Connection-sharing contract.
  - [ ] Query exactly: `SELECT name, artist, genre, "key", start_time, deck FROM history_entry WHERE session_id = ?1 ORDER BY start_time ASC, id ASC`. Quote `"key"` (SQLite reserved word), matching `joiner/serato4.rs`'s existing precedent. The `id ASC` tiebreaker is required, not optional — copy it in from the start rather than waiting for a review pass to add it: Story 1.4's own code review (RF-1) found `start_time` is second-resolution, ties are real, and SQL leaves tied rows in undefined order without an explicit tiebreaker. `history_entry.id` is the closest analog to "file order" this format has (there is no byte-position concept in a SQL table).
  - [ ] **Read every column as `Option<T>` — never assume a column is `NOT NULL`.** This includes `start_time`, even though the Story 1.2 spike's own throwaway struct (`agent/spike-1-2-parser-validation/src/serato4.rs::Serato4Play`) modeled it as a bare `i64`. `Play`'s own fields are already `Option`-everywhere by design (Story 1.3: "Optional-everywhere is not defensive hedging"); reading `start_time` as `Option<i64>` and letting a `NULL` row become `Play { start_time: None, .. }` is symmetric with that philosophy and — critically — means one row's missing timestamp doesn't fail the *entire session's* read via a type-coercion error. Convert with `.and_then(|t| u32::try_from(t).ok())`, never `as u32` (silent wraparound) and never `.unwrap()`.
  - [ ] Map columns to `Play` fields exactly as follows — **and no others**:
    ```rust
    Play {
        path: None,                                    // see subtask below — do not attempt a path lookup
        title: row.get::<_, Option<String>>(0)?,        // history_entry.name
        artist: row.get::<_, Option<String>>(1)?,
        label: None,                                   // no equivalent column
        genre: row.get::<_, Option<String>>(2)?,
        grouping: None,                                 // no equivalent column
        year: None,                                     // no equivalent column
        start_time: row.get::<_, Option<i64>>(4)?.and_then(|t| u32::try_from(t).ok()),
        deck: row.get::<_, Option<String>>(5)?.and_then(|d| d.parse().ok()),
        duration_sec: None,                             // see subtask below — do not derive from end_time
        key: row.get::<_, Option<String>>(3)?,
    }
    ```
  - [ ] **`path` stays `None` for every Serato 4+ play — this is load-bearing, not an oversight.** `history_entry` has no path column at all (Story 1.2 findings §8, confirmed again in Story 1.4's Dev Notes → "Serato 4+ scope boundary"); a path would require following unexplored `location_id`/`asset_id` foreign keys, which both prior stories deliberately scoped out as guessing at an unconfirmed schema (AD-11 forbids exactly this). Do not add that exploration here — it only becomes someone's job if a later story needs a path for a Serato 4+ play (e.g. an off-library embedded-tag read), and that story inherits the FK exploration, not this one.
  - [ ] **`duration_sec` stays `None` — do not compute it from `end_time`.** `history_entry.end_time` exists (seen in the Story 1.2 spike's schema) but its semantics were never validated by that spike (findings §8's per-field reliability table has no row for it at all, unlike `start_time`/artist/title/bpm/key/genre/deck, which are explicitly rated). Computing `end_time - start_time` would be asserting an unverified meaning for a column onto a value Story 1.7's stat engine will consume as measured fact — exactly the kind of guess AD-11 forbids. Leave it `None`; flag as Open Question #1 below for whoever needs duration from this source.
  - [ ] **Do not filter rows by `history_entry.played`.** The spike's throwaway struct captured a `played` boolean, but its reliability was never assessed (unlike the legacy format's structurally identical situation: field 50, the "played" flag, is Low confidence per Story 1.2 findings §3 — "always `1` even on rapid-preview entries, does not discriminate a full play from a preview" — and Story 1.3's `Play` correctly excludes it and never filters on it). Treat every `history_entry` row for the session as a play, symmetric with the legacy path's behavior for the same low-confidence signal.
  - [ ] **`history_entry.bpm` is deliberately never read by this function, even though it is right there on the row.** This is the single most important design decision in this story and the one most likely for a dev agent to "fix" by accident — do not add a `bpm` field to `Play`. Story 1.3 excluded BPM from `Play` for the legacy format specifically because BPM is scoped to the library join (Stories 1.4/1.5), never the play-log itself (`Play`'s own doc comment: "low-confidence fields (BPM/field 15...) are excluded by design — BPM comes from the library join / embedded tags in later stories"). `Play` is **one contract for two sources** (epics.md, Epic 1 overview) — if this story added `bpm` only for the Serato 4+ path, the two sources would stop being the same shape, breaking AC-1's explicit "same shape Story 1.3's `Play` uses" requirement and forcing Story 1.7's stat engine to special-case one source over the other. BPM for a Serato 4+ play continues to come exclusively from `joiner::serato4::join_session` (Story 1.4, already shipped) — see Dev Notes → Connection-sharing contract for how the two functions compose without a second query round-trip for genre/key.
  - [ ] No panics anywhere on the read path: no `.unwrap()`, `.expect()`, or indexing that can go out of bounds. Every fallible step is `?`-propagated through `rusqlite::Result`.

- [ ] **Task 2 — Unit tests: field mapping, ordering/determinism, malformed-row failure** (AC: 1, 2, 3)
  - [ ] Do not commit real Serato data (same policy as Stories 1.3/1.4 — golden-file fixtures are Story 1.9's job). Use an in-memory `rusqlite` connection (`Connection::open_in_memory()`) with a minimal `history_entry` table created in-test, mirroring `joiner/serato4.rs`'s existing `in_memory_history()` test helper (columns: `id`, `session_id`, `name`, `artist`, `genre`, `"key"`, `start_time`, `deck` — a superset of that helper's columns, since this reader also needs `name`/`artist`/`deck`).
  - [ ] Test: a full row (`name`/`artist`/`genre`/`key`/`start_time`/`deck` all set) → `Play` with `title`/`artist`/`genre`/`key`/`start_time`/`deck` populated correctly, **and `path`/`label`/`grouping`/`year`/`duration_sec` all `None`** — assert the full struct, not just the populated fields, so a future accidental field addition (e.g. someone wiring in `bpm`) fails this test immediately.
  - [ ] Test: a row with `NULL` `artist`/`genre`/`deck`/`key`/`start_time` (each independently) → that field is `None` on `Play`, the row still returns (not dropped, not an `Err`) — proves the read is column-by-column optional, not all-or-nothing.
  - [ ] Test: rows for a different `session_id` are excluded (mirror `joiner/serato4.rs`'s `other_sessions_are_excluded`).
  - [ ] Test: results are ordered by `start_time` ascending (mirror `rows_are_ordered_by_start_time`).
  - [ ] Test: two rows tied on `start_time` are still ordered deterministically (by `id`) — mirror `joiner/serato4.rs`'s `plays_tied_on_start_time_are_ordered_deterministically_by_id` and its documented caveat: this test pins the contract via the `ORDER BY ... , id ASC` clause but cannot itself *enforce* it (SQLite's planner may coincidentally emit rowid order even without the tiebreaker) — write the test, but do not claim it as proof the tiebreaker is load-bearing beyond what mutation testing would show (see Task 2's gate note below).
  - [ ] Test (AC-2, determinism): calling `read_session` twice against the same fixture data yields `assert_eq!` on the two `Vec<Play>` results (`Play` already derives `PartialEq, Eq` from Story 1.3 — no changes needed there).
  - [ ] Test: a `deck` value that fails to parse as `u32` (e.g. `"unknown"`) → `Play.deck: None`, not a panic and not a fabricated value.
  - [ ] Test (AC-3): a `history_entry` table that does not exist at all → `Err`, never a panic and never an empty `Vec` that would look like "the DJ played nothing" (mirror `joiner/serato4.rs`'s `missing_table_is_an_error_not_an_empty_set` — same failure-mode contract, same table).
  - [ ] Test: a session with zero rows (valid `session_id`, no matching `history_entry` rows) → `Ok(vec![])`, not an error — a quiet session is valid data, not corruption (same as Story 1.3's zero-`oent` case).
  - [ ] All tests run under the crate's existing gates: `cargo fmt --manifest-path agent/src-tauri/Cargo.toml -- --check`, `cargo clippy --manifest-path agent/src-tauri/Cargo.toml --all-targets -- -D warnings`, `cargo test --manifest-path agent/src-tauri/Cargo.toml`.

- [ ] **Task 3 — Confirm the existing CI gate covers this without changes** (AC: all)
  - [ ] `.github/workflows/ci.yml` lines 82-91 already run fmt/clippy(`--all-targets`)/build/test against `agent/src-tauri/Cargo.toml` — this module lives inside that same crate and needs no new dependency (`rusqlite = { version = "0.40.1", features = ["bundled"] }` was already added to `agent/src-tauri/Cargo.toml` by Story 1.4). Verify this holds; no CI file changes are expected.
  - [ ] No new production dependency to re-verify — unlike Stories 1.3/1.4, this story adds zero new crates. If a genuinely new crate turns out to be needed, that's a signal scope has drifted past this story's "direct SQL reads" boundary.

## Dev Notes

### Connection-sharing contract with `joiner::serato4::join_session` (read this before Task 1)

`joiner::serato4::join_session` (Story 1.4, already shipped in `agent/src-tauri/src/joiner/serato4.rs`) reads `bpm`/`key`/`genre` from the **exact same `history_entry` row** this story reads `title`/`artist`/`genre`/`key`/`start_time`/`deck` from. That function's own doc comment predicted this story: *"the play log and this metadata live on the same `history_entry` row. If 1.3b selects these three columns in its own query, it never needs to correlate anything and this function becomes redundant — that is the preferred outcome."*

This story's design **partially fulfills that prediction, deliberately not fully**:
- `genre` and `key`: this reader now reads them directly onto `Play.genre`/`Play.key` (Task 1). For this format only — unlike the legacy format, where `Play.genre`/`Play.key` (the play-log's own inline fields) and `JoinedMetadata.genre`/`.key` (`database V2`'s independently-authored library values) are two genuinely different data points from two different files (Story 1.4 Dev Notes) — Serato 4+ has no second file: `join_session`'s `genre`/`key` reads and this reader's `genre`/`key` reads are the same fact read twice. After this story ships, a caller building a Serato 4+ `Play` no longer needs `join_session`'s `genre`/`key` at all.
- `bpm`: **cannot** be fulfilled the same way — `Play` has no `bpm` field (see Task 1's `bpm` subtask for why it must stay that way). A caller still needs `join_session` for BPM alone.

**What this means for whoever wires this into the pipeline (Story 2.6/2.8, not this story):** open one `Connection` via `joiner::serato4::open_read_only(path)`, call this story's `read_session(&conn, session_id)` for the ordered `Vec<Play>`, and call `joiner::serato4::join_session(&conn, session_id)` only to pull the `bpm` half of its result (its `genre`/`key` are now redundant with what `read_session` already returned). **Do not modify `join_session` in this story** — it is shipped, tested, and its own file already documents this exact situation. Add a note to `deferred-work.md` (see below) rather than editing Story 1.4's code.

### Update `deferred-work.md` as part of this story

Two existing entries under "Deferred from: code review of 1-4-library-join-for-in-library-enrichment" directly concern this story and should be annotated (not deleted — they remain useful history), confirming what actually happened:
- *"Serato 4+ `join_session` may be redundant once Story 1.3b lands."* — confirm: `genre`/`key` are now redundant (this story reads them directly); `bpm` is not (see above) — `join_session` is still needed, just for a narrower reason than before.
- *"Serato 4+ `in_library` is guessed..."* — this story's query (`name, artist, genre, "key", start_time, deck`) surfaces no membership/library-flag column either. If you have access to a real `master.sqlite` to inspect its full `history_entry` schema while implementing, check for anything resembling a library-membership signal (independent of `location_id`/`asset_id`, which stays explicitly out of scope per Story 1.4) and note the finding here — but do not add a speculative column read without confirmed evidence (AD-11).

### Why this story is much smaller than Stories 1.3/1.4

No binary envelope to reverse-engineer (AC-1 says so explicitly), no new crate to pin (`rusqlite` already pinned by Story 1.4), no path-resolution logic (no path column exists for this format at all), no dedup logic (`master.sqlite` already reflects Serato's own deduplicated canonical history — Story 1.2 findings §8: "Not applicable — `master.sqlite` already reflects deduplicated canonical history"). The entire task is a `SELECT` and a field mapping. Resist the urge to add scope (e.g. a `list_sessions`/session-discovery helper) — that belongs to Story 2.6 (folder/library auto-detection, which does the actual "watch `master.sqlite` for new `history_session` rows" work, epics.md Story 2.6 AC-5) or Story 2.8 (set capture), neither of which is this story's job. This story answers exactly one question: given a `session_id`, produce its plays.

### Architecture citations

- **AR-5**: two-path parser — this story is the second path. "Must handle both legacy `database V2` and Serato 4+ `master.sqlite`" (the two-format requirement) is satisfied for the *play-log* half by this story + Story 1.3 together; the *library-join* half is already satisfied by Story 1.4.
- **Epic 1 overview** (epics.md): "two play-log sources, one `Play` contract" — the phrase this story's AC-1 ("same shape Story 1.3's `Play` uses") operationalizes. Do not let the two sources diverge in shape (see Task 1's `bpm` subtask).
- **AD-11 / Consistency Conventions** ("never guessed"): governs three separate decisions in this story — no path lookup via unexplored FKs, no derived `duration_sec` from unvalidated `end_time` semantics, no filter on the unvalidated `played` column.
- **AR-7** (raw retention for backfill): does not require new work here. Unlike Story 1.3 (which had to prove it never mutates a `.session` file it parses), this story never opens the connection itself — the caller does, via the already-shipped `joiner::serato4::open_read_only`, which already opens with `SQLITE_OPEN_READ_ONLY`. This reader issues only `SELECT`s. There is no separate "raw file" for this format to retain — the live `master.sqlite`, owned by Serato, already is the durable source; Story 2.8's job (not this one) is persisting the resulting `Play`s locally, same as for the legacy path.

### Previous story intelligence (1.4, and 1.3 by extension)

- `joiner::serato4.rs`'s existing `in_memory_history()` test helper and its ordering/determinism tests are the direct template for this story's Task 2 — same table, mostly the same columns, same tiebreaker pitfall. Do not re-derive the `start_time`-ties-need-an-`id`-tiebreaker lesson from scratch; Story 1.4's code review (RF-1) already paid for that discovery once.
- `rusqlite = { version = "0.40.1", features = ["bundled"] }` is already in `agent/src-tauri/Cargo.toml` (added by Story 1.4) — no `Cargo.toml` edit needed for this story.
- Established idioms to keep following: no `.unwrap()`/`.expect()`/panicking indexing anywhere on the read path (Stories 1.1/1.3/1.4's consistent bar); `Option`-returning column reads over assumed-`NOT NULL` reads, even where a throwaway spike modeled a column as non-optional.
- `parser::Play` (Story 1.3, frozen/shipped) is the type this story must produce **without modification**. Do not touch `agent/src-tauri/src/parser/mod.rs`'s `Play` struct definition or `agent/src-tauri/src/parser/session.rs` — this story only adds a sibling module and one `pub use` line to `mod.rs`.

### Git intelligence

Recent commits (`c62b336` → `4211dcd` → `6b80710` → `3091a6b` → `4211dcd`-adjacent 1.4 sequence `3091a6b`(baseline)→impl→review→review) establish this repo's shape for a story: a spec-commit (this one, committed first per the project's standing preference), then an implementation commit, then a **separate code-review commit** that extends/fixes the implementation after an adversarial pass — deferred/lower-value findings go to `deferred-work.md` rather than blocking. Expect the same two-or-three-commit shape here. This story's own baseline is `5e78510` (HEAD as of story creation, story 1.4 done).

### Project Structure Notes

- New: `agent/src-tauri/src/parser/serato4.rs`.
- Modified: `agent/src-tauri/src/parser/mod.rs` (add `mod serato4;` + `pub use serato4::read_session;`).
- Untouched: `agent/src-tauri/src/parser/session.rs` (Story 1.3, frozen), `agent/src-tauri/src/joiner/` (Story 1.4, frozen — read Dev Notes above on how to compose with it, but do not edit it), `shared/`, `web/`, `agent/spike-1-2-parser-validation/` (throwaway reference only), `.github/workflows/ci.yml` (no changes expected, see Task 3), `agent/src-tauri/Cargo.toml` (no new dependency).

### Testing standards

Same bar as Stories 1.3/1.4: synthetic in-test fixtures only (an in-memory `rusqlite::Connection` here, no committed real Serato data), full crate gate (`fmt --check`, `clippy --all-targets -D warnings`, `build`, `test`) must stay green. No new real-data validation gap is introduced beyond what Story 1.4 already carries for this table's inferred schema (Open Questions #3 there) — this story reads a subset of the same columns Story 1.4 already flagged as schema-inferred-not-file-confirmed.

### Latest tech / versions (re-verified 2026-07-23)

- **`rusqlite`**: no new dependency — `0.40.1` already pinned by Story 1.4 (re-verified there 2026-07-22, one day prior). This story adds no crates.
- **`triseratops`**: unused by this story (not called). `main`'s HEAD re-checked during this story's creation, still `8e92aae1794c4f02a2405eb88ea72f251b077f0c` — no drift, informational only since this story doesn't touch it.

### References

- [epics.md — Story 1.3b + Epic 1 design notes, incl. the design note explaining why this story is a sibling to 1.3 rather than folded into 1.4](../planning-artifacts/epics.md)
- [ARCHITECTURE-SPINE.md — AR-5, Consistency Conventions ("never guessed")](../planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md)
- [1-3-clean-room-session-parser.md — defines `parser::Play`, the contract this story must match exactly; also the origin of the `master.sqlite` scope-gap Open Question this story resolves](./1-3-clean-room-session-parser.md)
- [1-4-library-join-for-in-library-enrichment.md — `joiner::serato4::join_session`, whose Dev Notes/Review Record directly anticipate this story (RF-1's tiebreaker fix, the "may be redundant" note, the `in_library` assumption)](./1-4-library-join-for-in-library-enrichment.md)
- [1-2-parser-validation-spike-findings.md — §3/§8 `history_entry`/`history_session` schema and per-field reliability table this story's field mapping is built from](./1-2-parser-validation-spike-findings.md)
- [deferred-work.md — entries this story should annotate, not delete](./deferred-work.md)
- [agent/src-tauri/src/joiner/serato4.rs — sibling implementation to mirror for connection-opening flags, quoting `"key"`, and the in-memory test-fixture pattern](../../agent/src-tauri/src/joiner/serato4.rs)
- [agent/spike-1-2-parser-validation/src/serato4.rs — reference only (own prior code): confirms the `history_entry`/`history_session` column set](../../agent/spike-1-2-parser-validation/src/serato4.rs)

## Open Questions / Assumptions
*(None block starting the story — reasonable defaults chosen; flagged for Arjun's confirmation before/during implementation.)*

1. **[NOTE, not a task] `history_entry.end_time` semantics are unconfirmed, so `Play.duration_sec` is left `None` for Serato 4+ plays.** Story 1.2's findings never rated this column's reliability (unlike `start_time`/artist/title/bpm/key/genre/deck, which are explicitly rated in findings §8). If a later story (most likely 1.7's stat engine) needs a measured duration for this source, that story should validate `end_time`'s meaning against a real `master.sqlite` first, not assume `end_time - start_time` is correct.
2. **[ASSUMPTION] No filter on `history_entry.played`.** Symmetric with the legacy format's unfiltered handling of its own low-confidence "played" flag (field 50). If a real Serato 4+ install turns out to log skipped/previewed tracks with `played = 0` at meaningfully different rates than the legacy corpus showed for field 50, this may need revisiting — no evidence either way yet.
3. **[CARRIED FORWARD, unchanged by this story] Serato 4+ `in_library` still defaults to `true` in `joiner::serato4::join_session`.** This story's query surfaces no additional membership signal (see Dev Notes → deferred-work.md update). Still tracked in `deferred-work.md`, still unresolved.
4. **[CARRIED FORWARD, unchanged by this story] `history_entry`'s full schema remains inferred from Story 1.2's spike query, not independently re-confirmed against a real file.** This story reads a subset of the same columns Story 1.4 already flagged this way; real-schema confirmation is still Story 1.9's (or an ad hoc inspection's) job.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

| Date | Change |
|---|---|
| 2026-07-23 | Story drafted (context-engineered): `master.sqlite` play-log reader producing `parser::Play` directly via SQL, reusing the same table `joiner::serato4::join_session` (Story 1.4) already reads, deliberately not adding `bpm` to `Play` to keep one contract across both play-log sources. |
