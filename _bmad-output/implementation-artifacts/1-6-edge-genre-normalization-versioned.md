---
baseline_commit: 50b6338399038e8d2ad8d72fa7ef921c18f89363
---

# Story 1.6: Edge genre normalization, versioned

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a DJ,
I want raw Serato genre tags normalized to a fixed Curfew taxonomy on the agent, storing raw + normalized + `taxonomy_version` per play,
So that genre stats are consistent and trends recompute cleanly after the table evolves.

## Acceptance Criteria

1. **Given** a raw genre string, **When** normalized against the fixed table, **Then** a normalized value + the current `taxonomy_version` are stored alongside the raw string. *(FR-8, AR-6)*
2. **Given** a raw genre absent from the table, **When** normalized, **Then** it maps to the table's defined default bucket deterministically (never dropped).
3. **Given** V1, **Then** the taxonomy is not DJ-editable — no edit UI exists. *(FR-8)*

### Scope boundaries (binding — read before writing code)

- **Absent genre (`None`) is NOT the default bucket.** AC-2's "default bucket" is for a genre that is *present but unrecognized* (a real raw string the table has no mapping for). A play with **no genre at all** (`None` — the AD-11 "Unknown" case that Stories 1.4/1.5 leave `None`) must **stay absent** and route to the display-layer "Unknown," never be forced into the default bucket. These are two different states and the code must keep them distinct. Concretely: `normalize(None) → None` (no normalized record produced); `normalize(Some("Trance")) → Some(known bucket)`; `normalize(Some("some-obscure-tag")) → Some(default bucket)`. Conflating "missing" with "unrecognized" would silently manufacture a normalized value for a track that never had a genre — exactly the "never guess" violation AD-11 forbids.

- **Persistence boundary.** AC-1 says the triple (raw + normalized + `taxonomy_version`) is "stored alongside" per play. At this point in the pipeline **there is no store, no assembled per-play record, and no sync contract carrying genre** (the local store, sync-queue, stat-engine, and the `shared/` genre fields are all later work — the pipeline is built only through `joiner`). This story's job **ends at producing** the normalized triple as an in-memory value/type from a raw input; wiring it into a persisted row or the sync payload is a downstream story. Do **not** add genre fields to `shared/src/index.ts` / `shared/schema/sync-payload.schema.json` in this story, and do **not** build a store filter. (Mirror Story 1.5's "display boundary": the module's responsibility stops at the typed value it returns.)

- **Source-selection is out of scope.** Two raw genre strings can exist for one play: `parser::Play.genre` (the play-log's own inline field 9 / `history_entry.genre`) and `joiner::JoinedMetadata.genre` (library/embedded). The joiner explicitly defers "which one wins" to "whichever stage assembles the final per-play record" (`joiner/mod.rs:33-38`) — and that assembly stage does not exist yet. This story normalizes **a** raw genre string; it does **not** decide which of the two sources supplies it. Build `normalize` to take a single raw genre input so it composes with whatever assembly stage (Story 1.7 / stat-engine territory) later selects the source. See Open Question #1.

- **Not DJ-editable (AC-3) is satisfied by construction.** The taxonomy is a compile-time-fixed, Curfew-maintained table baked into the agent binary. AC-3 is met by there simply being **no edit path / no UI / no runtime mutation** — do not add a settings surface, a config file the DJ can edit, or a "custom mapping" hook. There is nothing to build for AC-3 except the absence of an editor; it is a guardrail, not a feature.

- **No DSP, no inference.** Genre normalization is deterministic table lookup only. No audio analysis, no ML, no "smart" fuzzy classification of unknown genres beyond the deterministic rules the table itself defines (NFR-3, consistent with the whole edge pipeline).

## Tasks / Subtasks

- [ ] **Task 1 — Author the fixed Curfew genre taxonomy + version** (AC: 1, 2, 3)
  - [ ] The taxonomy table **does not exist anywhere in the repo yet** (`grep -ri "taxonomy\|normaliz" agent/ shared/` returns nothing) — this story authors it. It is **Curfew-maintained and product-defined**: the exact set of normalized buckets and which raw strings map to them is a content decision, not a mechanical one. Draft a reasonable V1 taxonomy for electronic/DJ genres (e.g. buckets like `House`, `Techno`, `Trance`, `Drum & Bass`, `Dubstep`, `Hip-Hop`, `Pop`, `Disco`, etc.) with raw-string aliases mapping into each bucket (e.g. `"deep house"`, `"tech house"`, `"progressive house"` → `House`), **and** one explicitly-named **default bucket** for unrecognized-but-present genres (e.g. `Other` or `Uncategorized`). Flag the specific bucket list + default-bucket name in Open Questions for Arjun's confirmation — do not block implementation on it, ship a sensible default set and let him refine the content later (the *mechanism* is what this story proves; the *contents* are cheap to edit once the mechanism exists).
  - [ ] Define `pub const TAXONOMY_VERSION: u32 = 1;` (or a suitable opaque monotonic version type) in the new module. This is the version **of the table itself** — every normalized value the agent produces is stamped with the version of the table it was normalized against (AD-12's whole point: a heterogeneous agent fleet may carry different table versions, so each play must self-describe which version produced its normalized value, enabling consistent cloud recompute later).
  - [ ] **Table storage: prefer a compile-time-static Rust table over a runtime-parsed asset.** A `const`/`static` table (a `match`, or a `&[(&str, &str)]` slice, or a lazily-built `HashMap` from a const slice) keeps normalization a **total, infallible function** — there is no file to read, no parse that can fail, nothing to make the function return `Result`. This matches the module's infallible contract (Task 2) and needs **no new dependency**. If you instead embed a JSON/TOML asset via `include_str!` + `serde_json` (both already available), the parse must happen once at first use and a malformed embedded asset is a **programmer error → a test must catch it**, never a runtime `Result` on the hot path. Do **not** add `phf`, `lazy_static`, `once_cell`, or any new crate just for the table — `std::sync::OnceLock` (stable since 1.70) covers lazy init with zero dependencies if you need a `HashMap`.

- [ ] **Task 2 — Implement the normalizer module's public surface** (AC: 1, 2)
  - [ ] Create the new module as a **sibling pipeline filter** to `parser` and `joiner`. Recommended: `agent/src-tauri/src/genre.rs` (flat file — single concern, no submodules, unlike `parser/`/`joiner/` which are directories only because they have multiple submodules), registered via `pub mod genre;` in `agent/src-tauri/src/lib.rs` next to `pub mod joiner;` (line 16) and `pub mod parser;` (line 20). (If you embed a data asset and prefer a directory, `genre/mod.rs` is acceptable — but a flat file is the simpler fit here.)
  - [ ] Public function shape: a **total, infallible** transform, e.g. `pub fn normalize(raw: Option<&str>) -> Option<NormalizedGenre>` — **no `Result`, no new error enum.** Rationale mirrors `joiner::embedded_tags::fill_gaps` exactly: every possible input has a correct defined output (a known raw → its bucket; a present-but-unrecognized raw → the default bucket, AC-2; an absent raw → `None`, the "Unknown" path). There is no failure mode with a different valid response, so `Result` would be ceremony. Do not wrap it.
  - [ ] Introduce a **new output type** — do **not** mutate `parser::Play` or `joiner::JoinedMetadata` (both are frozen; their owners' doc comments say "do not change its shape"). Suggested:
    ```rust
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct NormalizedGenre {
        /// The raw genre string exactly as the source stored it — preserved
        /// verbatim, never trimmed or rewritten (AD-12: the raw string is the
        /// input to cloud re-normalization when the table later evolves).
        pub raw: String,
        /// The normalized bucket from the fixed Curfew taxonomy. Always present:
        /// a present-but-unrecognized raw maps to the default bucket (AC-2),
        /// never dropped.
        pub normalized: String,
        /// The version of the taxonomy table this value was normalized against
        /// ([`TAXONOMY_VERSION`]). Stamped per play so a heterogeneous fleet's
        /// plays can be recomputed consistently after the table changes (AD-12).
        pub taxonomy_version: u32,
    }
    ```
    (`normalized` may instead be a typed enum of buckets if you prefer stronger typing — a string is simpler and matches how the eventual persisted column will look; your call, but keep `raw` a `String` and preserve it verbatim.)
  - [ ] **Preserve the raw string verbatim.** The stored `raw` must be byte-identical to the input — **never trimmed, lowercased, or rewritten** (same discipline as `joiner::non_empty`, which normalizes only the emptiness test, never the value). The lookup *key* used to match against the table **may** be case-/whitespace-normalized for matching purposes (see next subtask), but that normalization is internal to the lookup and must never touch the `raw` you store.
  - [ ] **Matching semantics — make them deterministic and document them.** Decide and pin: case-insensitive lookup (recommended — `"House"`, `"house"`, `"HOUSE"` should all hit the same bucket), and whitespace-trimmed for the *lookup key* (recommended). Whatever you choose, it must be deterministic (AC-2) — the same raw string always maps to the same bucket, run to run. Add an explicit determinism test (Task 4). Note `joiner::non_empty` already guarantees empty strings never reach here as `Some("")` when the input came through the joiner — but `normalize` is public and may be called with a raw `Some("")`; treat an empty/whitespace-only string as **absent-equivalent → default-bucket or `None`?** Decide explicitly (recommend: an empty/whitespace-only `Some("")` → `None`, i.e. treat "present but blank" as "no genre," consistent with `non_empty`'s semantics) and test it.

- [ ] **Task 3 — Handle the legacy-numeric-TCON hand-off from Story 1.5** (AC: 1, 2)
  - [ ] Story 1.5 deliberately stores legacy ID3v1 numeric genre references **raw and uninterpreted** — e.g. a `TCON` of `"(17)"` is left as the literal string `"(17)"`, explicitly deferring interpretation to **this story** (1.5 Task 3, 1.5 Open Question #5, and the `embedded_tags.rs` code comment: *"interpreting a legacy numeric ID3v1 genre reference is Story 1.6's job, not this one's"*). This story is where `"(17)"` (and the bare-number and `"(17)Rock"` refinement forms) get a defined mapping.
  - [ ] **Decide the policy explicitly** (flag in Open Questions): either (a) expand the ID3v1 numeric genre table (`17 → "Rock"`, a well-known fixed 0–191 mapping) as part of the taxonomy so `"(17)"` normalizes to the `Rock`-family bucket, or (b) treat `"(17)"`-form strings as just another unrecognized raw string → default bucket (simpler, deterministic, defensible for V1 since Serato-tagged electronic libraries rarely use ID3v1 numeric genres). Recommend **(b) for V1** unless Arjun wants (a) — it keeps the table purely string-keyed and avoids importing a 192-entry legacy table for a case that may never appear in a real Serato electronic library. Whichever you pick, add a test with a `"(17)"`-style input proving the deterministic outcome (this is the concrete cross-story hand-off Story 1.5 set up — it must have an explicit test here).

- [ ] **Task 4 — Unit tests: synthetic inputs, one per AC + determinism** (AC: 1, 2, 3)
  - [ ] Inline `#[cfg(test)] mod tests { use super::*; ... }` at the bottom of the new module — same convention as every prior story (no `tests/` dir exists; there is no `[dev-dependencies]` section and you must not add one). Plain `#[test]` + `assert_eq!`/`assert!`/`matches!`, no external test crates.
  - [ ] Each test carries a `///` doc comment citing the AC / rationale it covers (the established house style — see `parser/mod.rs` and `embedded_tags.rs` tests).
  - [ ] Cover, at minimum:
    - **(AC-1)** a known raw genre (e.g. `"Deep House"`) → correct bucket, `taxonomy_version == TAXONOMY_VERSION`, and `raw` returned **byte-identical** to the input (assert the raw is preserved verbatim, un-lowercased).
    - **(AC-1, matching)** case/whitespace variants of a known genre (`"deep house"`, `"  Deep House "`, `"DEEP HOUSE"`) all hit the same bucket, but each preserves its **own** raw string verbatim.
    - **(AC-2)** a present-but-unrecognized raw (e.g. `"totally-made-up-genre-xyz"`) → the **default bucket** (assert the exact default-bucket value), never dropped, `taxonomy_version` stamped.
    - **(scope boundary)** `normalize(None)` → `None` (no genre → stays absent, NOT default bucket) — the critical missing/unrecognized distinction.
    - **(scope boundary)** `normalize(Some(""))` and a whitespace-only `Some("   ")` → your chosen blank policy (recommend `None`) — test whatever you decided in Task 2.
    - **(Task 3)** a `"(17)"`-style legacy numeric TCON input → your chosen deterministic outcome (Task 3).
    - **(determinism, AC-2)** normalizing the same raw string twice yields identical results (a `normalize_is_deterministic`-style test, mirroring `parser::parse_is_deterministic`).
    - **(AC-1, version stamp)** every produced `NormalizedGenre` carries `taxonomy_version == TAXONOMY_VERSION` (a guard so a future table bump can't silently ship un-stamped values).
  - [ ] Full crate gate stays green: `cargo fmt --manifest-path agent/src-tauri/Cargo.toml -- --check`, `cargo clippy --manifest-path agent/src-tauri/Cargo.toml --all-targets -- -D warnings`, `cargo build --manifest-path agent/src-tauri/Cargo.toml`, `cargo test --manifest-path agent/src-tauri/Cargo.toml`.

- [ ] **Task 5 — Confirm the existing CI gate covers this without changes** (AC: all)
  - [ ] This module lives inside the already-gated `agent/src-tauri` crate, and adds **no new dependency** (pure-Rust `std`-only table + lookup). `.github/workflows/ci.yml`'s existing `agent` job (fmt check, `clippy --all-targets -D warnings`, build, test — steps at lines ~81-91) already covers it. **No CI changes should be needed** — same reasoning Stories 1.3/1.4/1.5 used. If you find a change is needed, that's new information, not a reason to add a workaround speculatively.
  - [ ] If (and only if) you chose to add a new crate for the table (you shouldn't — see Task 1), re-verify its current non-yanked version on crates.io immediately before adding it and note it here, per this project's standing dependency-verification discipline.

## Dev Notes

### The one genuinely new thing this story builds

Everything upstream (parse → join → embedded-tag fallback) produces **raw** genre strings and deliberately refuses to interpret them — `joiner/mod.rs:28-31` and the `JoinedMetadata.genre` doc (`joiner/mod.rs:73`) both say in so many words *"normalization is Story 1.6's job."* This story is that job, and it is **net-new**: there is no taxonomy table, no `taxonomy_version`, and no normalization code anywhere in the repo today. The deliverable is a small, pure, exhaustively-tested filter — the genre analogue of how `joiner::embedded_tags::fill_gaps` is a pure transform over an existing type.

### Pipeline placement

The documented pipeline (`lib.rs:4-8`, `parser/mod.rs:3-6`) is `watcher → parser → joiner → stat-engine → local store → sync-queue`, built only through `joiner` so far. Genre normalization (AD-12: "runs on the agent before sync") sits logically **after enrichment (parser+joiner produce the raw genre), before the stat-engine** — the stat engine (Story 1.7) computes the genre *breakdown* and therefore consumes the *normalized* value, while the *raw* value + `taxonomy_version` are retained for later cloud recompute. This story builds the filter in isolation; nothing consumes its output yet (Story 1.7 will), exactly as `joiner` was built before any stat-engine existed to consume `JoinedMetadata`.

### AD-12 / AR-6 — why raw AND normalized AND version, all three

- **AD-12 (ARCHITECTURE-SPINE.md, "Normalize genres on the edge, but store raw + normalized + taxonomy version"):** normalization runs **on the agent** against a Curfew-maintained fixed table; the cloud stores **both** the raw string **and** the normalized value **and** a `taxonomy_version` per play, "so trends (FR-9) can be recomputed consistently after the table changes." Binds FR-8, FR-9, FR-24.
- **The "prevents" clause is the whole reason:** a heterogeneous, already-deployed agent fleet means old sets get normalized under table `vN` and new sets under `vN+1`. If you stored only the normalized value, comparing them across time would be silent cross-time trend corruption. Storing the **raw string** lets the cloud later **re-run the lookup** over it and pin one `taxonomy_version` per aggregate (AD-1, AR-8 "taxonomy re-normalization"). **Dropping the raw string forfeits this** — it is the input to consistent recompute, not redundant with the normalized value.
- **AR-8 / AD-1 (content one-way flow):** genre normalization output is *content* (flows agent→cloud only, written by the agent's content-scoped upsert) and must never touch overlay columns. The cloud MAY re-normalize over the stored raw string but NEVER re-parses Serato binary. None of that cloud/upsert machinery is built in this story — it's context for *why* the triple must be produced now.

### Established idioms to follow (from Stories 1.3–1.5)

- **Infallible-by-design transforms** where any "failure" has one correct degrade: `embedded_tags::fill_gaps` returns its type directly (no `Result`). `normalize` is a *total* function (AC-2 guarantees a bucket for every present input), so it is infallible too — no `Result`, no error enum. Contrast with `ParseError`/`JoinError`/`SchemaLoadError`, which exist only because reading the DJ's *one* Serato file has a UI-actionable hard-failure mode; table lookup has none.
- **Hand-written types, not `anyhow`/`thiserror`** — if you somehow need an error type (you shouldn't), it's a small `enum` implementing `Display` + `std::error::Error`, matching `SchemaLoadError` (`lib.rs:37-52`). `legacy.rs:35` is explicit about preferring "a small enum in application code rather than an `anyhow` chain."
- **No `.unwrap()`/`.expect()` on production paths** — the consistent bar across all prior stories (`.expect()` appears only in tests).
- **Raw values preserved, never rewritten** — `non_empty` (`joiner/mod.rs:88-96`) normalizes only the emptiness test, never trims the value. Your `raw` field must be equally untouched.
- **Heavy, rationale-first doc comments** — a `//!` module doc opening the file that states which pipeline filter this is, which Story/ACs it implements (FR-8 / AD-12 / AR-6), its invariants (deterministic, total/infallible, never-guess, raw-preserved, not-DJ-editable), and what it deliberately does *not* do (no persistence, no source-selection, no DSP). Mirror `parser/mod.rs:1-31` and `joiner/mod.rs:1-38`.
- **`#[derive(Debug, Clone, Default, PartialEq)]`** on data structs, adding `Eq` where there are no floats (`NormalizedGenre` has no floats → include `Eq`). Note `Default` may not make sense for `NormalizedGenre` (there's no sensible default normalized bucket) — omit `Default` if it doesn't, unlike `Play`/`JoinedMetadata` which are meaningfully all-`None`-by-default.

### Frozen types this story must NOT change

- **`parser::Play`** (`parser/mod.rs:49-74`, frozen Story 1.3/1.3b) — carries the play-log inline `genre: Option<String>` (field 9). Read-only input candidate; do not edit the struct.
- **`joiner::JoinedMetadata`** (`joiner/mod.rs:60-75`, frozen Story 1.4, "do not change its shape") — carries the library/embedded `genre: Option<String>`. Read-only input candidate; do not edit the struct.
- Neither has a normalized-genre or version field, and this story does **not** add one to them. The `NormalizedGenre` triple is a **new** type; how it eventually attaches to a per-play record is the (not-yet-built) assembly stage's concern.
- **Optional, non-blocking doc-sync:** `JoinedMetadata.genre`'s doc comment (`joiner/mod.rs:73`) says "normalization is Story 1.6" — a forward reference that remains *accurate* (it points at where normalization now lives). You may optionally update it to name the new `genre::normalize` entry point, but it is not required and not a behavioral change. Do not treat this as a mandated edit the way Story 1.5 had to fix the genuinely-*stale* "does not read embedded tags" line.

### `shared/` contract is out of scope for this story

`shared/src/index.ts`'s `SyncPlayDraft` (lines 43-50) carries only `position`/`played_at`/`confidence` — **no genre fields**, and the contract is **DRAFT, not frozen until Story 1.10 (AR-1)**. This story does **not** put genre on the wire — there is no sync of genre yet, no store, no assembled play row. Adding genre fields to the draft contract + `sync-payload.schema.json` is a **later** story's job (whichever one first persists/syncs plays), and it must keep the TS↔JSON-schema parity tests green (`shared/src/index.test.ts` and the Rust mirror `lib.rs::parses_shared_sync_contract_schema`) when it happens. Touching `shared/` here would be premature scope creep.

### Testing standards

Same bar as Stories 1.3/1.4/1.5: synthetic in-test inputs only (here, just literal `&str` genre strings — no fixtures, no files, no real data), inline `#[cfg(test)]`, one test per AC + a determinism test, no committed real data, no new dev-dependencies, full four-command crate gate stays green (`fmt --check`, `clippy --all-targets -D warnings`, `build`, `test`). This story is *unusually* easy to test exhaustively because it's a pure `&str → value` function with no IO at all — lean into that: cover the AC boundaries and the missing-vs-unrecognized distinction thoroughly.

### Git intelligence

Recent per-story shape is a clean sequence — spec commit → implementation commit → code-review commit (sometimes a second review pass): `93324e8` (1.5 spec) → `6b7cf9b` (1.5 impl) → `334ca38` (1.5 review) → `50b6338` (merge). Expect the same shape here. Story 1.3b/1.4/1.5 also show real-data/API findings feeding back into `deferred-work.md` even across stories — if implementing this surfaces a real-world genre-tagging quirk worth remembering (e.g. a real `"(17)"`-form value actually appearing, or a genre string that argues for a taxonomy bucket you didn't include), log it in `_bmad-output/implementation-artifacts/deferred-work.md`, not only in this story's Dev Agent Record (story files get archived; `deferred-work.md` is the durable cross-story home, per Story 1.4's RF-4 correction).

### Project Structure Notes

- **New:** `agent/src-tauri/src/genre.rs` (the normalizer filter + its taxonomy table + `TAXONOMY_VERSION` + tests). *(Or `agent/src-tauri/src/genre/mod.rs` if you embed a data asset and prefer a directory — flat file recommended.)*
- **Modified:** `agent/src-tauri/src/lib.rs` (add `pub mod genre;` with a `///` doc comment locating it in the pipeline, next to the existing `pub mod joiner;`/`pub mod parser;`).
- **Optionally modified (non-blocking):** `agent/src-tauri/src/joiner/mod.rs` (only if you choose the optional doc-sync on `JoinedMetadata.genre`'s comment — see above).
- **Untouched:** `agent/src-tauri/src/parser/` (frozen), `agent/src-tauri/src/joiner/{legacy,serato4,embedded_tags}.rs` and `JoinedMetadata`/`Play` shapes (frozen), `shared/`, `web/`, `.github/workflows/ci.yml` (no changes expected — Task 5), `agent/src-tauri/Cargo.toml` (no new dependency expected — Task 1).

### Latest tech / versions

No new dependency is expected for this story — the taxonomy table and lookup are pure `std`-only Rust. The already-pinned deps (`triseratops` `8e92aae1`, `id3 1.17.0`, `lofty 0.24.0`, `rusqlite 0.40.1`, `serde`/`serde_json 1`) are **not** touched by this story; if you embed a JSON asset you'd reuse the already-present `serde_json`, no version change. `std::sync::OnceLock` (stable since Rust 1.70) is the zero-dependency answer if you need lazy `HashMap` init — do not add `lazy_static`/`once_cell`/`phf`. Per standing project discipline, if you do end up adding any crate, re-verify its current non-yanked crates.io version immediately before adding it.

### References

- [epics.md — Story 1.6, Epic 1 design notes, FR-8, AR-6](../planning-artifacts/epics.md)
- [ARCHITECTURE-SPINE.md — AD-12 (edge genre normalization, raw+normalized+version), AD-1 (edge owns raw-Serato derivation; cloud may re-normalize), AD-11 (never guess / never drop), Consistency Conventions](../planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md)
- [SOLUTION-DESIGN.md — §3.4/§3.5 content one-way flow + cloud re-normalization over stored raw string](../planning-artifacts/architecture/architecture-name-pending-2026-07-20/SOLUTION-DESIGN.md)
- [1-5-off-library-embedded-tag-fallback-with-visible-unknown.md — previous story; the raw-`TCON`-`"(17)"` hand-off (its Task 3 / Open Question #5) is this story's Task 3; `fill_gaps` is the infallible-pure-transform pattern to mirror](./1-5-off-library-embedded-tag-fallback-with-visible-unknown.md)
- [agent/src-tauri/src/lib.rs — crate root; register `pub mod genre;` here (lines 16-20 show the existing `joiner`/`parser` declarations)](../../agent/src-tauri/src/lib.rs)
- [agent/src-tauri/src/joiner/mod.rs — `JoinedMetadata.genre` (raw, "normalization is Story 1.6"), `non_empty` (raw-preserving emptiness convention), the "merge policy belongs to whichever stage assembles the final per-play record" note (:33-38)](../../agent/src-tauri/src/joiner/mod.rs)
- [agent/src-tauri/src/joiner/embedded_tags.rs — `.genre()` not `.genre_parsed()`; the "interpreting a legacy numeric ID3v1 genre reference is Story 1.6's job" comment (:177-178)](../../agent/src-tauri/src/joiner/embedded_tags.rs)
- [agent/src-tauri/src/parser/mod.rs — `Play.genre` (field 9, frozen), `parse_is_deterministic` test to mirror for the determinism test](../../agent/src-tauri/src/parser/mod.rs)

## Open Questions / Assumptions
*(None block starting the story — reasonable defaults chosen; flagged for Arjun's confirmation before/during implementation.)*

1. **[DESIGN — source selection deferred] Which raw genre normalizes when a play has both an inline `Play.genre` and a joined `JoinedMetadata.genre`?** The joiner deliberately left this to "whichever stage assembles the final per-play record" (`joiner/mod.rs:33-38`), and that stage doesn't exist yet. This story builds `normalize` to take **a single** raw genre input and does not decide the source — source-selection lands with the assembly/stat-engine stage (Story 1.7). No action needed now; flagged so it isn't mistaken for an omission.
2. **[CONTENT — needs Arjun] The V1 taxonomy bucket list and the default-bucket name are a product decision.** No taxonomy exists in the repo; this story authors a sensible electronic/DJ-focused V1 set + a named default bucket (Task 1). The *mechanism* (fixed table, versioned, deterministic default) is what this story proves and freezes; the *contents* are cheap to edit later (bump `TAXONOMY_VERSION` when they change — that's exactly what the version field is for). Confirm/refine the bucket list and default-bucket name with Arjun; do not block implementation on it.
3. **[DESIGN — needs a decision, recommend (b)] Legacy ID3v1 numeric `TCON` handling (`"(17)"`-form).** Story 1.5 stores these raw for this story to interpret. Option (a): expand the fixed 0–191 ID3v1 genre-number table so `"(17)" → Rock`-family bucket. Option (b): treat `"(17)"`-form strings as ordinary unrecognized raw → default bucket. **Recommend (b) for V1** (keeps the table purely string-keyed; Serato-tagged electronic libraries rarely carry ID3v1 numeric genres). Either way, an explicit test proves the deterministic outcome (Task 3).
4. **[DESIGN — recommend blank→`None`] How to treat a present-but-blank raw genre (`Some("")` / whitespace-only).** Recommend treating it as absent-equivalent → `None` (consistent with `joiner::non_empty`'s "empty string ≠ a real value"), rather than routing it to the default bucket. This keeps "no meaningful genre" as one state (Unknown), reserving the default bucket for genuinely-present-but-unrecognized strings. Tested either way (Task 4).
5. **[MATCHING — recommend case/whitespace-insensitive lookup] Lookup key normalization.** Recommend case-insensitive and whitespace-trimmed *lookup keys* so `"Deep House"`/`"deep house"`/`"  DEEP HOUSE "` all hit `House`, while the stored `raw` stays byte-identical to the input. Deterministic and tested (Task 4). Confirm this is the intended behavior (vs. exact-match-only, which would fragment real-world casing).

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

## Change Log

| Date | Change |
|---|---|
| 2026-07-23 | Story 1.6 context-engineered (edge genre normalization, versioned): net-new pure `genre::normalize` filter producing a raw+normalized+`taxonomy_version` triple against a compile-time-fixed Curfew taxonomy; infallible-by-design (mirrors `embedded_tags::fill_gaps`); missing-genre (`None`) kept distinct from present-but-unrecognized (default bucket, AC-2); no new dependency, no `shared/` contract change, no store/source-selection (both later stories); legacy `"(17)"`-form TCON hand-off from Story 1.5 given a deterministic policy. Status → ready-for-dev. |
