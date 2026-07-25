---
baseline_commit: fc5ac1781ba33d2b489192a3e78ee8539ab616f3
---

# Story 1.10: Freeze the `shared/` sync contract

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the `shared/` versioned sync-payload / stat-output contract frozen (TS types + JSON-schema) after the spike, validated on both agent and cloud, additive-only, carrying `agent_version`,
So that the one frozen-forever hub artifact reflects parsing reality and its Set Detail + Style Evolution consumers.

## Acceptance Criteria

1. **Given** the spike + stat-engine outputs and the Set Detail + Style Evolution UX specs as inputs, **When** the contract is authored, **Then** its shape covers everything those consumers render. *(AR-1, AR-15, Design note b)*
2. **Given** the contract, **When** a payload is built on the agent and received on the cloud, **Then** both validate against the same schema via contract tests in `shared/`. *(AR-1)*
3. **Given** a proposed contract change, **When** CI runs, **Then** only additive changes pass; every payload carries `agent_version`; the cloud accepts the last N agent versions. *(AR-1)*
4. **Given** sequencing, **Then** the contract is frozen only after Story 1.2's spike — never before. *(Design note c)*

### Scope boundaries (binding — read before writing code)

- **This story touches `shared/` plus the two existing consumer touch-points that already reference the draft shape — nothing else.** In scope: `shared/src/index.ts`, `shared/schema/sync-payload.schema.json`, `shared/src/index.test.ts` (+ any new test file), `shared/README.md`, `agent/src-tauri/src/lib.rs`'s existing `parses_shared_sync_contract_schema` test (it asserts against the exact fields this story changes), and `web/app/page.tsx`'s illustrative import (it imports the type this story renames). **Not in scope:** wiring the real `watcher -> parser -> joiner -> stats -> local store -> sync-queue` pipeline (no local store or sync-queue exist yet — Epic 2 Stories 2.8/3.2), a payload-construction function anywhere in `agent/src-tauri/src` (nothing calls `stats::enrich_session` for real yet — see deferred-work.md's "no live caller" entry), or any cloud ingestion endpoint (no Supabase project exists yet — Epic 2 Story 2.1 is first). Do not create new production modules in `agent/` to "prove" the contract end-to-end; the existing schema-load test is the agent-side proof this story needs.
- **"Validated on both agent and cloud" (AC-2) is scoped to what actually exists in Epic 1.** There is no cloud yet. At this story's altitude, "agent-side, before send" validation is the existing Rust test that loads and shape-asserts the JSON-schema (`agent/src-tauri/src/lib.rs`), and "the cloud, on receive" validation is `shared/`'s own TS-side test that the JSON-schema and the TS types stay in parity — the one artifact both a future cloud ingestion handler and today's `web/` already import. Actual on-receive request validation against a real endpoint is Epic 2/3 wiring against this same frozen schema file, not this story's job.
- **AC-3's "cloud accepts the last N agent versions" is a policy this story documents, not a runtime check it builds.** There is nothing to enforce an acceptance window against yet (no cloud). Record the policy in the frozen contract's doc comments (see Task 6) so whichever future story stands up the sync-ingestion endpoint inherits it as a known requirement, rather than rediscovering AR-1 from scratch.
- **Freezing changes discipline, not runtime behavior.** Before this story, `CONTRACT_VERSION = 1` was provisional and the whole shape was expected to reshape after the Story 1.2 spike (which has since landed — see AC-4). After this story, the same `CONTRACT_VERSION = 1` becomes frozen: every future change to `shared/` must be additive-only (new optional fields, never a removed/renamed/re-typed required field), enforced by Task 5's new CI-run test. No agent/web/cloud code executes any differently as a result of this story; only the contract's evolution rules change.

## Tasks / Subtasks

- [x] **Task 1 — Fix the draft's two content/overlay disjointness bugs before designing anything else (AC: 1, 2)**

  The current DRAFT payload (`shared/src/index.ts`) puts two fields on the agent's outbound payload that AD-6/AD-16 explicitly forbid the agent from ever writing. Both must be removed from the frozen shape; this is not a style preference, it is the exact invariant AR-8 requires this story's contract tests to enforce ("Agent's upsert is column-scoped to content columns; overlay columns are disjoint and never touched (contract-tested in `shared/`)").

  1. **Remove `set.visibility` from the outbound payload.** ARCHITECTURE-SPINE.md AD-6 lists "visibility tier (FR-23)" by name as a web-authored overlay, alongside segments/enrichment/hide — "authored on the web, live only in the cloud, and are never written back to the agent." AD-9's visibility default ("Default-on-sync is public... Phase 1 sets are stored private-equivalent") is something the **cloud** applies, not something the agent decides or sends. Delete the `visibility` field and the `Visibility` import from `SyncPayload`'s `set` shape. Keep the `VISIBILITY` const/`Visibility` type exported from `shared/src/index.ts` unchanged — it is still the AR-15 fixed enum other cloud-side code (the `sets` table's own visibility column) will use later; only its presence *inside the sync payload* is wrong.
  2. **Remove the top-level `segments` array from the outbound payload.** AD-6 lists "segment edits (FR-14)" as the same class of web-authored overlay. Segment *detection* (AD-17, FR-28) — the only mechanism that could populate this array with real data — is explicitly Epic 5's job: `agent/src-tauri/src/stats/mod.rs`'s own module doc states "segment detection (AD-17/FR-28 — Epic 5's job against this module later, even though AD-17 already names this module as where it will eventually live)." Nothing in Epic 1 computes a segment, so an agent-authored `segments` field in a *frozen* contract would either ship permanently empty or, worse, invite a future story to "helpfully" start populating it from the agent side, directly violating AD-16's column-scoping rule. Delete `SyncSegmentDraft` and the `segments` field entirely. Keep `SEGMENT_TYPE`/`SegmentType` exported unchanged (still the AR-15 fixed enum for the cloud-side `segments` table Epic 5 will create) — again, only its presence in the sync payload was wrong. When Epic 5 needs to *suggest* segment boundaries from the agent, that is a new, explicitly-designed additive field on a future story, not a resurrection of this one.
  3. Add an explicit contract test in `shared/` (alongside Task 5's additive-only guard, or as its own test) asserting the frozen JSON-schema's `set` object's `properties` does **not** contain `visibility` or `segments` — a regression guard for exactly the mistake this task fixes, in case a future story reintroduces either field without reading this rationale.

- [x] **Task 2 — Design `set.plays[]` from the real stat-engine output (AC: 1)**

  Base the per-play shape on `agent/src-tauri/src/stats/mod.rs`'s `EnrichedPlay` (Story 1.7's assembled per-play record, the closest thing to "ground truth" for what a play looks like after the full parse→join→genre pipeline) plus `JoinedMetadata.in_library` (`agent/src-tauri/src/joiner/mod.rs`), which `EnrichedPlay` itself does **not** carry — see Dev Notes' "EnrichedPlay is missing `in_library`" note before assuming it's a straight 1:1 mirror.

  Recommended per-play fields (all independently optional except `position`, mirroring `EnrichedPlay`'s and `JoinedMetadata`'s own "every field optional, nothing silently defaulted" discipline — AD-11):
  - `position: number` — 1-based ordinal within the set (already in the draft; keep — a stable ordering key independent of `start_time`, which can itself be absent).
  - `title: string | null`, `artist: string | null` — from `EnrichedPlay.title`/`.artist`. Missing renders as "Unknown" client-side (AD-11) — the contract carries `null`, never a synthesized "Unknown" string; UI-layer text is a `web/` concern.
  - `started_at: string | null` (ISO 8601) — from `EnrichedPlay.start_time` (a Unix-epoch `u32` in Rust; convert to ISO 8601 at payload-build time, matching the Consistency Conventions table: "UTC ISO-8601 on the wire; `played_at` sourced from the session file").
  - `bpm: number | null` — from `EnrichedPlay.bpm`. Already `sane_bpm`-filtered by the joiner (finite, positive) per `stats/mod.rs`'s own doc comment.
  - `genre: { raw: string, normalized: string, taxonomy_version: number } | null` — from `EnrichedPlay.genre: Option<NormalizedGenre>` (`agent/src-tauri/src/genre.rs`'s three-field struct, verbatim: `raw`, `normalized`, `taxonomy_version`). This is AD-12's whole point — store raw **and** normalized **and** the table version so the cloud can recompute trends consistently after the taxonomy table changes. Do not collapse to just `normalized`.
  - `camelot_key: string | null` — from `EnrichedPlay.camelot: Option<CamelotKey>` (`{ number: 1..=12, letter: A | B }` in Rust). Encode on the wire as the Camelot notation string (e.g. `"8A"`), not the two-field struct — it's the source format already (`Play.key`/`JoinedMetadata.key` are stored as Camelot strings per `joiner/mod.rs`'s doc comment), it's what `web/`'s energy-arc/tracklist rendering wants directly, and a string is simpler to validate in JSON-schema (`pattern: "^(1[0-2]|[1-9])[AB]$"`) than a nested object.
  - `in_library: boolean` — from `JoinedMetadata.in_library`, **not** from `EnrichedPlay` (which doesn't carry this field — see Dev Notes). Required, not optional: this is the flag the Consistency Conventions table requires to travel with every play ("Missing metadata renders as a visible 'Unknown', carrying the `in_library` flag — never omitted, never guessed").
  - **Do not include a raw file `path` field.** `EnrichedPlay.path` is an absolute local filesystem path (e.g. `/Users/arjun/Downloads/.../track.mp3` or a Windows equivalent) — sending it to the cloud leaks local username/folder structure for no UX payoff Set Detail or Style Evolution need (neither renders a path; the tracklist shows title/artist/timestamp). This is flagged as Open Question #1 below (not silently decided) because a future Epic 4 feature (FR-10, library-to-setlist correlation) may eventually need *some* stable per-track identity — additive-only means a purpose-built (possibly hashed/opaque) identity field can be added later without reopening this freeze.

- [x] **Task 3 — Design the `set.derived` render-cache blob (AC: 1)**

  ARCHITECTURE-SPINE.md's Structural Seed section says "`sets` carries a denormalized `derived` (jsonb) render-cache so dashboards render without recomputation" (AR-15). Group every stat-engine/confidence output the Set Detail and Style Evolution UX specs need under one `derived` object on `set`, sourced from `agent/src-tauri/src/stats/mod.rs` (Story 1.7) and `agent/src-tauri/src/confidence.rs` (Story 1.8):

  - `most_played_tracks: Array<{ title: string | null, artist: string | null, play_count: number }>` — from `stats::most_played_tracks`, ranked descending, ties broken by first-seen order (already deterministic per `stats/mod.rs`). The Rust function ranks by `TrackIdentity` (path-or-title/artist) for accurate dedup of pathless Serato-4+ plays, but since Task 2 excludes `path` from the wire, the **rendered** identity is title/artist only — compute the ranking edge-side using the full `TrackIdentity` (path included) as today, then project each ranked entry down to `{title, artist, play_count}` for the wire. Matches UX-DR8's tracklist / "impact track" need and EXPERIENCE.md's `card-reflection` set-card summary.
  - `most_played_artists: Array<{ artist: string, play_count: number }>` — from `stats::most_played_artists`. CAP-5 binding: artist-tagged plays only, no "Unknown" bucket, no untagged-count footnote (already enforced by the Rust function — the payload just carries its output verbatim).
  - `genre_breakdown: { buckets: Array<{ genre: string, play_count: number }>, no_genre_count: number }` — from `stats::genre_breakdown`/`GenreBreakdown`. Unlike the artist ranking, `no_genre_count` is always visible here (no CAP-5-style exemption) per that function's own doc comment.
  - `bpm_distribution: { count: number, min: number, max: number, mean: number, median: number }` — from `stats::bpm_distribution`/`BpmDistribution`. An empty distribution is `count: 0` with all other fields `0.0` (a defined value per that function's doc, never `null`/`NaN`) — mirror that in the JSON-schema as required numeric fields, not nullable ones.
  - `camelot_mixing_stats: { compatible_transitions: number, incompatible_transitions: number, excluded_no_key: number }` — from `stats::camelot::mixing_stats`/`CamelotMixingStats`. Three raw counts, not a pre-divided rate (the Rust type deliberately doesn't bake in a rate; keep that on the wire too — let `web/` divide if UX-DR6 wants a ratio).
  - `set_length_sec: number | null` — from `stats::set_length_sec`. `null` when either endpoint's `start_time` is absent (mirrors the Rust `Option<u32>` exactly).
  - `track_count: number` — from `stats::track_count`. Total plays, not unique tracks (the function's own doc distinction).
  - `energy_arc: Array<{ started_at: string, bpm: number }>` (ISO 8601 timestamps) — from `stats::energy_arc`/`EnergyArcPoint`. Only points with both fields present (already filtered by the Rust function); chronological order preserved. This is UX-DR6's `energy-arc-chart` data source and DESIGN.md's cited point-annotation feature (hover/tap shows "Energy peak at 02:15" + a comparison line) — the chart-summary auto-caption (UX-DR7) is computed client-side from this series, not precomputed here.
  - `confidence: { value: number, track_count: number, long_gap_count: number }` — from `confidence::classify`/`SessionConfidence` (Story 1.8, FR-27). Required, not optional — Epic 4's Story 4.1 AC-3 (epics.md line 337) explicitly depends on this signal being synced so Style Evolution can "exclude low-confidence sessions **visibly**... and surface an 'N sessions hidden — show them?' affordance," which is impossible if the value never left the agent. `confidence.rs`'s own module doc says as much: "no `shared/` sync-contract field yet" was true only *before* this story; this story is what closes that gap. Field names mirror `SessionConfidence` exactly (`confidence` → `value` to avoid a `derived.confidence.confidence` stutter; `track_count`/`long_gap_count` unchanged).

- [x] **Task 4 — Rewrite `shared/src/index.ts` and `shared/schema/sync-payload.schema.json` to the frozen shape (AC: 1, 2, 4)**

  - Rename `SyncPayloadDraft` → `SyncPayload`, `SyncPlayDraft` → `SyncPlay`; delete `SyncSegmentDraft` (Task 1). Apply Tasks 2-3's field designs to `SyncPlay` and a new `SyncSetDerived` (or inline) type on `SyncPayload.set.derived`.
  - Update every "DRAFT — NOT FROZEN until Story 1.10" banner (there are three: the `index.ts` file header, the JSON-schema's `description`, and `README.md`'s top warning) to a "FROZEN — additive-only forever" banner citing this story and AD-15. Keep the existing "two consumers, one contract" explanation in the README; it remains accurate.
  - `CONTRACT_VERSION` stays `1` — this story is the freeze commit itself, not a version bump. Update its doc comment: "Bump on every **breaking** change to the payload shape" is no longer possible post-freeze (breaking changes are now forbidden outright, not just version-bumped); rephrase to reflect that a version bump is now reserved for a hypothetical future deliberate contract-version fork, not routine evolution (additive fields never require a bump).
  - Update `shared/schema/sync-payload.schema.json`'s `$defs` to match: keep `play` (redesigned per Task 2), drop `segment` (Task 1). `additionalProperties: false` stays at every level — unchanged discipline.
  - Add a short "Adding a field after freeze" section to `README.md`: new fields are always optional (not in `required`) unless the story explicitly re-derives every already-synced historical payload (out of scope for any Epic 1/2/3 story today) — this is the mechanical rule Task 5's CI guard enforces; stating it in the README saves a future contributor from re-deriving AD-15 from first principles.

- [x] **Task 5 — Additive-only CI guard, closing the existing deferred-work.md gap (AC: 3)**

  deferred-work.md already flags this exact gap from Story 1.1's review: *"Shallow TS↔schema parity check — the parity test (Rust + vitest) asserts only the AR-15 enums and `contract_version`, not full property sets / required keys. Structural drift between the TS type and JSON schema can pass both guards. Deferred to contract-freeze work (Story 1.10)."* Close it now:

  1. Check in a baseline snapshot of the just-frozen schema, e.g. `shared/schema/sync-payload.schema.frozen-baseline.json` — a byte-for-byte copy of `sync-payload.schema.json` as it stands at the end of this story. This file's only purpose is Task 5.2's regression guard; it is never hand-edited after this story merges.
  2. Add a new test (e.g. `shared/src/additive-only.test.ts`) that loads both the baseline and the current `sync-payload.schema.json` and asserts, recursively, that every property present in the baseline (at every nesting level, including `$defs`) is still present in the current schema with a compatible type, and every baseline `required` entry is still `required` in the current schema. New properties in current-but-not-baseline pass freely (that's what "additive" means); a property or a `required` entry present in baseline but missing/retyped in current fails the test with a clear message pointing at AD-15. This is the mechanical, CI-enforced form of AC-3's "only additive changes pass" — the closest feasible in-repo enforcement without a live schema-registry service.
  3. Widen the existing `shared/src/index.test.ts` parity test (currently checks only the AR-15 enums + `contract_version`, per the deferred-work.md citation above) to also assert the full `required` array and top-level property set match between the TS-exported shape and the JSON-schema — not just enums. This directly closes the cited gap, not just works around it with a second test.
  4. No CI workflow change is needed: both new/widened tests live in `shared/src/*.test.ts`, already run by the existing `js` job's `pnpm test` step (`.github/workflows/ci.yml`) — verify this locally (`pnpm --filter @curfew/shared test`) rather than assuming it, mirroring Story 1.9 Task 5's discipline.

- [x] **Task 6 — Document the `agent_version`/last-N-acceptance policy (AC: 3)**

  `agent_version: string` (semver) is already a required top-level field in the draft — keep it required, unchanged. Add a doc comment on `SyncPayload.agent_version` (and a short paragraph in `README.md`) recording AR-1's policy verbatim: *contract evolution is additive-only, and the cloud must accept the last N `agent_version`s* — explicitly noting **N is not yet chosen** (no cloud exists to enforce a window against; this is a placeholder for whichever Epic 2/3 story implements the sync-ingestion endpoint) and that AD-13's backfill mechanism (raw data retained locally, re-synced after a fix ships) is the safety net if an old agent version is ever rejected. Do not invent a number or build an enforcement mechanism here — this task is documentation only, per the Scope Boundaries.

- [x] **Task 7 — Update the two existing consumers to the frozen shape (AC: 2)**

  - `agent/src-tauri/src/lib.rs`'s `parses_shared_sync_contract_schema` test currently asserts `schema["properties"]["set"]["properties"]["visibility"]["enum"]` and `schema["$defs"]["segment"]["properties"]["type"]["enum"]` — both now-removed paths (Task 1). Update this test to assert against the frozen shape instead: keep the `contract_version`/`source` enum assertions (unchanged), and add assertions proving the new required `set.plays[].in_library`/`genre`/`camelot_key` shape and `set.derived.confidence` are present as the schema now defines them (mirroring this test's existing style: literal path assertions against parsed JSON, not a full schema-validator dependency). This is production test code this story **does** touch, unlike Story 1.9's zero-`src/`-changes discipline — the test exists specifically to prove Rust-side consumption of whatever `shared/` currently defines, so it must track this story's redesign.
  - `web/app/page.tsx` imports `type SyncPayloadDraft` and destructures `SyncPayloadDraft["source"]` — update the type name to `SyncPayload` (Task 4's rename). It does not reference `.set.visibility` or `.segments` directly (checked: only `source` and the module-level `CONTRACT_VERSION`/`VISIBILITY` constants), so no other edit is needed there.

- [x] **Task 8 — Gate + housekeeping (AC: all)**
  - Run the full gate: `pnpm --filter @curfew/shared build`, `pnpm --filter @curfew/shared typecheck`, `pnpm --filter @curfew/shared test`, and the repo-root `pnpm lint && pnpm typecheck && pnpm build && pnpm test` (the same commands the `js` CI job runs). Separately, `cargo fmt --manifest-path agent/src-tauri/Cargo.toml -- --check`, `cargo clippy --manifest-path agent/src-tauri/Cargo.toml --all-targets -- -D warnings`, `cargo build --manifest-path agent/src-tauri/Cargo.toml`, `cargo test --manifest-path agent/src-tauri/Cargo.toml` (Task 7's Rust test change). If this machine lacks a linked Rust toolchain, don't skip silently — the toolchain has been found at `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin` (not on default `PATH`) on this machine for Stories 1.6/1.8/1.9; export it explicitly rather than logging a fresh "toolchain missing" deferral.
  - Update deferred-work.md: mark the Story 1.1 "Shallow TS↔schema parity check" entry resolved, citing Task 5's new tests. If Task 2's path-exclusion or Task 1's visibility/segments removal surfaces any other standing deferred-work.md entry this story's design choices touch, cross-reference it there too (do not delete entries — append, per this project's standing convention).
  - This is the last story in Epic 1 (epics.md: Story 1.10 is the epic's final story before `epic-1-retrospective`). After this story reaches `done`, consider whether `epic-1-retrospective` should run before Epic 2 starts — that decision is Arjun's, not this story's to make.

### Review Findings

- [x] [Review][Patch] `additive-only.test.ts` never detects a newly-added `required` field — the classic breaking change AC-3 exists to block sails through undetected [shared/src/additive-only.test.ts:66-74]
- [x] [Review][Patch] `web/app/page.tsx` still says "(draft)" and names its local var `draftContractSource`, contradicting every other "FROZEN — additive-only forever" banner this story added [web/app/page.tsx:6,14]
- [x] [Review][Patch] `additive-only.test.ts` never checks `enum`/`const`/`pattern` narrowing — removing a valid enum value would pass the guard silently [shared/src/additive-only.test.ts:43-95]
- [x] [Review][Patch] `additive-only.test.ts` throws a raw `TypeError` instead of a clear assertion message when a baseline `items` schema is lost in current [shared/src/additive-only.test.ts:76-78]
- [x] [Review][Patch] `additive-only.test.ts`'s `resolveRef()` only resolves one level of `$ref`, silently skipping type-checking on a chained `$ref` (currently unreachable — no chained refs exist in today's schema) [shared/src/additive-only.test.ts:14-21]
- [x] [Review][Patch] `lib.rs`'s `parses_shared_sync_contract_schema` doesn't assert `$defs.segment` is absent (only `properties.segments`) — the TS-side test does check this, so CI is covered today, but the Rust-side "agent-side proof" this story leans on is incomplete on this one point [agent/src-tauri/src/lib.rs:179-188]
- [x] [Review][Patch] `lib.rs`'s new `assert_eq!` on `required` arrays (`confidence`, `genre`) is order-sensitive; a harmless future reorder would fail CI for no functional reason, unlike the order-insensitive `.any()` checks used elsewhere in the same test [agent/src-tauri/src/lib.rs:205-209,231-235]
- [x] [Review][Defer] No test round-trips a realistic payload through real JSON-schema validation (e.g. ajv) — AC-2 says payloads "validate against the same schema via contract tests," but every new/widened test checks property/required-name membership only [shared/src/index.test.ts, shared/src/additive-only.test.ts] — deferred, adding a new schema-validator dependency is a bigger decision than a review-time patch; log for a follow-up story

## Dev Notes

### Why two design bugs get fixed before any new design work

The draft contract (`shared/src/index.ts`, written speculatively during Story 1.1 before the stat engine or confidence signal existed) put `set.visibility` and a top-level `segments` array on the **agent's outbound** payload. Both directly contradict AD-6 ("User-authored overlays... are authored on the web, live only in the cloud, and are never written back to the agent") and AD-16 ("The agent's sync upsert is column-scoped to content columns. User-authored overlay columns... are disjoint and never written by the agent"). AR-8 explicitly names this disjointness as something `shared/` must contract-test — which is exactly what a "frozen forever, additive-only" contract cannot afford to get wrong on its one chance to fix it before permanence. Task 1 is not optional cleanup; it is the single most consequential correctness fix this story makes, because after this story every other change to this file must be additive-only.

### `EnrichedPlay` is missing `in_library` — a real gap, not this story's to fix in `agent/`

`stats::EnrichedPlay` (Story 1.7) assembles from `parser::Play` + `joiner::JoinedMetadata`, but its field list (`title, artist, path, start_time, bpm, genre, camelot`) does not include `JoinedMetadata.in_library`. The Consistency Conventions table requires `in_library` to travel with every play's "Unknown" data, and Task 2 above requires it in the frozen wire shape — but this story does **not** modify `stats/mod.rs`'s `EnrichedPlay` struct or its `enrich`/`enrich_session` functions (out of this story's Scope Boundaries — see Task 1's file list). The contract simply needs the field to exist in the schema now; the actual Rust-side code that reads both `EnrichedPlay` and its paired `JoinedMetadata.in_library` to build a real `SyncPlay` value is payload-construction glue that doesn't exist yet (no pipeline wiring until Epic 2). Leave a clear pointer for whoever writes that glue (Epic 2 Story 2.8 or Epic 3 Story 3.2, whichever wires `stats -> local store -> sync-queue` first) rather than treating this as something to silently paper over.

### Frozen types/files this story must NOT change

- `agent/src-tauri/src/stats/*`, `confidence.rs`, `genre.rs`, `joiner/*`, `parser/*` — read-only. This story's contract redesign is informed by these files' shapes but does not modify the production Rust that produces them.
- Do not build any `agent/`-side payload-construction function, local-store schema, or sync-queue — all future stories (Epic 2 Story 2.8, Epic 3 Story 3.2).
- Do not create a Supabase project, migration, or ingestion route handler — Epic 2 Story 2.1 is the first cloud story; none of that exists on `main` yet.

### Established idioms to follow

- **Every field independently optional, nothing silently defaulted** — the same discipline `Play`, `JoinedMetadata`, and `EnrichedPlay` already hold (AD-11). Mirror it in the JSON-schema: a field that can be `None` in Rust is `["<type>", "null"]` (or simply absent from `required`) in JSON-schema, never given a fabricated default.
- **`additionalProperties: false` at every object level** — already the draft's convention; keep it everywhere the redesign touches, including the new `derived` object and its nested stat objects.
- **Full-struct-shaped assertions in tests, not spot-checks** — mirrors the Rust codebase's own testing convention (see Story 1.9's Dev Notes) and the existing `shared/src/index.test.ts` style (asserts each enum/version explicitly by path). Task 5's new additive-only test should walk the full schema tree, not sample a few fields.
- **Raw preserved verbatim, normalized derived alongside it** — the `genre` field's `raw`/`normalized`/`taxonomy_version` triple (AD-12) is the model for how any future "we might re-derive this differently later" value should be shaped: never overwrite/discard the raw input.

### Git intelligence

Recent per-story shape (Stories 1.6-1.9): context-engineer commit → implement commit → code-review commit (sometimes two passes) → merge via PR. This story's diff shape is closer to Story 1.1 (touches `shared/` + both consumers, a monorepo-spanning design story) than to a typical single-Rust-module story — expect changes in three workspaces (`shared/`, one Rust test in `agent/`, one TSX file in `web/`) but no new Rust production modules. `web/` has had no dedicated story yet since Story 1.1's scaffold; `app/page.tsx` is still the placeholder Story 1.1 left behind (a single illustrative import, not a real screen) — Epic 3 is where real `web/` screens start, so keep this story's `page.tsx` edit to the minimal rename Task 7 describes, not a broader rewrite.

### Project Structure Notes

- **Modified:** `shared/src/index.ts`, `shared/schema/sync-payload.schema.json`, `shared/src/index.test.ts`, `shared/README.md`, `agent/src-tauri/src/lib.rs`, `web/app/page.tsx`, `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`.
- **New:** `shared/schema/sync-payload.schema.frozen-baseline.json` (Task 5), `shared/src/additive-only.test.ts` (Task 5, or folded into `index.test.ts` — dev's call).
- **Untouched (expected):** everything under `agent/src-tauri/src/{stats,confidence.rs,genre.rs,joiner,parser}/`, `.github/workflows/ci.yml`, any Supabase/`supabase/` path (doesn't exist yet).

### References

- [epics.md — Story 1.10, Epic 1 overview + design notes (a)(b)(c), AR-1, AR-15](../planning-artifacts/epics.md)
- [ARCHITECTURE-SPINE.md — AD-1 (edge/cloud compute split), AD-3 (versioned contract), AD-6 (content one-way, overlays cloud-only), AD-9 (visibility default), AD-12 (raw+normalized+version genre), AD-15 (additive-only forever), AD-16 (content-scoped upsert, session/set/overlay disjointness), Structural Seed's `derived` jsonb render-cache note, Consistency Conventions table](../planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md)
- [SOLUTION-DESIGN.md §3.4 (web-authored overlay flow), §3.5 ("reading a set" — where each stat is computed), §4 (data model narrative)](../planning-artifacts/architecture/architecture-name-pending-2026-07-20/SOLUTION-DESIGN.md)
- [EXPERIENCE.md — Set Detail / Style Evolution rows in Information Architecture (line 23-24), Component Patterns (energy arc, tracklist, trend chart, chart summary — lines 65-77), State Patterns (Unknown track data, insufficient history)](../planning-artifacts/ux-designs/ux-name-pending-2026-07-19/EXPERIENCE.md)
- [DESIGN.md — UX-DR6 energy-arc-chart point-annotation spec (line 279)](../planning-artifacts/ux-designs/ux-name-pending-2026-07-19/DESIGN.md)
- [deferred-work.md — "Shallow TS↔schema parity check... Deferred to contract-freeze work (Story 1.10)" (Story 1.1 review section), TrackIdentity/path-collision entry (Story 1.7), Epic 4 Story 4.1 AC-3's confidence-visibility dependency (epics.md line 337)](./deferred-work.md)
- [agent/src-tauri/src/stats/mod.rs — `EnrichedPlay`, `most_played_tracks`/`most_played_artists`/`genre_breakdown`/`bpm_distribution`/`set_length_sec`/`track_count`/`energy_arc`, `camelot::mixing_stats`](../../agent/src-tauri/src/stats/mod.rs)
- [agent/src-tauri/src/confidence.rs — `SessionConfidence`, `classify`](../../agent/src-tauri/src/confidence.rs)
- [agent/src-tauri/src/genre.rs — `NormalizedGenre`](../../agent/src-tauri/src/genre.rs)
- [agent/src-tauri/src/joiner/mod.rs — `JoinedMetadata.in_library`](../../agent/src-tauri/src/joiner/mod.rs)
- [agent/src-tauri/src/lib.rs — `parses_shared_sync_contract_schema`, the test Task 7 updates](../../agent/src-tauri/src/lib.rs)
- [shared/src/index.ts, shared/schema/sync-payload.schema.json, shared/src/index.test.ts, shared/README.md — the draft this story replaces](../../shared/src/index.ts)
- [web/app/page.tsx — the illustrative import Task 7 renames](../../web/app/page.tsx)
- [1-9-golden-file-regression-harness.md — previous story; confirms real Rust toolchain location on this machine](./1-9-golden-file-regression-harness.md)

## Open Questions / Assumptions

1. **[PRODUCT — recommended default given] Should any per-play track-identity field (e.g. a hashed/opaque path token) be in the v1 frozen payload for Epic 4's future library-to-setlist correlation (FR-10)?** Task 2 recommends excluding the raw file path entirely from v1 (privacy: leaks local username/folder structure; no current UX consumer needs it). Additive-only means a purpose-built identity field can be added later without reopening this freeze, so the recommended default is to defer this decision to whichever Epic 4 story implements FR-10, rather than guess at its shape now. Proceed with exclusion unless Arjun prefers reserving a field now.
2. **[DESIGN — recommended default given] `agent_version`'s "last N" acceptance-window value is left unset (Task 6, documentation only).** No cloud exists yet to enforce it against. Proceed with documenting the policy without a number, per Task 6.
3. **[PRODUCT] Is Epic 1 "done" once this story reaches `done`, warranting `epic-1-retrospective` before Epic 2 starts?** Not this story's call — flagged in Task 8 for Arjun.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via `bmad-dev-story`.

### Debug Log References

- Rust toolchain present at `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin` (rustup-installed but not on default `PATH`) — same as Stories 1.6/1.8/1.9; exported explicitly for every cargo invocation this session.
- No new dependency added to any workspace.

### Completion Notes List

**Task 1 — Fixed both disjointness bugs:** Removed `set.visibility` and the top-level `segments` array from `SyncPayload` in `shared/src/index.ts` and their corresponding entries from `shared/schema/sync-payload.schema.json` (including deleting the `segment` `$def`). `VISIBILITY`/`Visibility` and `SEGMENT_TYPE`/`SegmentType` stay exported unchanged, with doc comments clarifying they're now cloud-side-only enums. Added regression guards in `shared/src/index.test.ts` asserting `set.visibility`/top-level `segments`/`$defs.segment` are all absent from the frozen schema, plus a matching Rust-side assertion in `lib.rs`.

**Task 2 — `SyncPlay` designed from `EnrichedPlay` + `JoinedMetadata.in_library`:** All 8 fields per the story's recommendation (`position`, `title`, `artist`, `started_at`, `bpm`, `genre{raw,normalized,taxonomy_version}`, `camelot_key`, `in_library`) — every field except `position`/`in_library` is a required-but-nullable key (never omitted), matching `EnrichedPlay`'s "every field optional, nothing silently defaulted" discipline. `camelot_key` encoded as a Camelot-notation string (JSON-schema `pattern: "^(1[0-2]|[1-9])[AB]$"`), not the two-field Rust struct. No `path` field — excluded per the story's privacy rationale (Open Question #1).

**Task 3 — `SyncSetDerived` designed from `stats::mod.rs` + `confidence.rs`:** All 9 fields (`most_played_tracks`, `most_played_artists`, `genre_breakdown`, `bpm_distribution`, `camelot_mixing_stats`, `set_length_sec`, `track_count`, `energy_arc`, `confidence`) mapped verbatim from their Rust source functions/structs, grouped under `set.derived`. `confidence.value`/`track_count`/`long_gap_count` mirror `SessionConfidence` exactly (renamed `confidence`→`value` to avoid a `derived.confidence.confidence` stutter). `bpm_distribution`/`camelot_mixing_stats`/`genre_breakdown.no_genre_count` are required non-nullable numeric fields (never `null`), matching their Rust functions' "defined value, never NaN" contracts.

**Task 4 — `shared/src/index.ts` + `shared/schema/sync-payload.schema.json` rewritten to the frozen shape:** `SyncPayloadDraft`→`SyncPayload`, `SyncPlayDraft`→`SyncPlay` renamed; `SyncSegmentDraft` deleted. All three "DRAFT — NOT FROZEN" banners (index.ts file header, schema `description`, README top warning) replaced with "FROZEN — additive-only forever" banners citing Story 1.10 and AD-15. `CONTRACT_VERSION` stays `1`; its doc comment rephrased to note a version bump is now reserved for a hypothetical deliberate contract fork, since routine evolution is additive-only and needs no bump. Schema `$id` updated from `sync-payload.draft.json` to `sync-payload.json`. `additionalProperties: false` preserved at every object level, including the new `derived` object and its nested stat objects.

**Task 5 — Additive-only CI guard (closes the Story 1.1 review's deferred-work.md gap):** Checked in `shared/schema/sync-payload.schema.frozen-baseline.json` (byte-for-byte copy of the frozen schema, verified via `diff`). New `shared/src/additive-only.test.ts` recursively walks the baseline against the current schema (resolving `$ref`/`oneOf`/`items`/`properties`/`required` at every nesting level, including every `$defs` entry) and fails with an AD-15-referencing message on any removed/retyped property or `required` entry; new properties pass freely. Widened `shared/src/index.test.ts` beyond the four original enum/version checks to also assert the full top-level `SyncPayload`/`set`/`SyncPlay`/`SyncSetDerived`/`confidence` `required` arrays and property sets match the TS interface shapes verbatim, plus explicit visibility/segments-absence regression tests (Task 1.3). No CI workflow change needed — both test files live under `shared/src/*.test.ts`, already run by the existing `js` job's `pnpm test` step; verified locally via `pnpm --filter @curfew/shared test` (13/13 passed).

**Task 6 — `agent_version`/last-N policy documented:** Doc comment added on `SyncPayload.agent_version` in `index.ts` and a new "`agent_version` acceptance policy" section in `README.md`, both recording AR-1's policy verbatim (additive-only evolution, cloud accepts the last N agent versions) with N explicitly left unset (no cloud exists yet) and AD-13's backfill mechanism noted as the safety net. Documentation only — no enforcement mechanism built, per the Scope Boundaries.

**Task 7 — Both existing consumers updated:** `agent/src-tauri/src/lib.rs`'s `parses_shared_sync_contract_schema` test rewritten — kept the `contract_version`/`source` enum assertions, replaced the removed `visibility`/`segment` enum assertions with explicit absence assertions, and added new assertions proving `set.plays[]`'s required fields (`position`, `genre`, `camelot_key`, `in_library`) and `set.derived`'s required fields (all 9, plus `confidence`'s 3 sub-fields) are present as the frozen schema now defines them — literal path assertions against parsed JSON, matching the test's existing style. Also corrected a stale "DRAFT until Story 1.10" doc comment on `SYNC_PAYLOAD_SCHEMA_RELPATH` to reflect the freeze. `web/app/page.tsx`'s `SyncPayloadDraft` type import/usage renamed to `SyncPayload`; no other edit needed there (confirmed: it only references `.source`, not `.set.visibility`/`.segments`, matching the story's own pre-check).

**Task 8 — Gate + housekeeping:**
- Full gate green: `pnpm --filter @curfew/shared build/typecheck/test` (13/13 tests passed) + repo-root `pnpm lint && pnpm typecheck && pnpm build && pnpm test` (all green, including `web`'s Next.js build with the renamed `SyncPayload` type) + `cargo fmt --check`/`cargo clippy --all-targets -- -D warnings`/`cargo build`/`cargo test` on the rustup toolchain (136/136 passed, including the widened `parses_shared_sync_contract_schema`).
- `deferred-work.md` updated: the Story 1.1 "Shallow TS↔schema parity check" entry marked `[RESOLVED 2026-07-25, Story 1.10]`, citing the new/widened tests. Two new entries added under a new "implementation of 1-10" section (`EnrichedPlay` missing `in_library` — a real gap flagged for whoever writes the Epic 2/3 payload-construction glue; raw `path` exclusion — a recorded product decision, not a defect). The existing `enrich_session` pairing-order-invariant entry annotated with a cross-reference noting Story 1.10 froze the consuming wire shape but still didn't build a real caller.
- Epic-1-retrospective timing left as Open Question #3 for Arjun, per Task 8's explicit note that this is not this story's call.

**Scope discipline:** Zero changes to `agent/src-tauri/src/{stats,confidence.rs,genre.rs,joiner,parser}/**`, `.github/workflows/ci.yml`, or any Supabase/cloud path — confirmed by the File List below. No `agent/`-side payload-construction function, local-store schema, or sync-queue built.

### File List

**New:**
- `shared/schema/sync-payload.schema.frozen-baseline.json`
- `shared/src/additive-only.test.ts`

**Modified:**
- `shared/src/index.ts`
- `shared/schema/sync-payload.schema.json`
- `shared/src/index.test.ts`
- `shared/README.md`
- `agent/src-tauri/src/lib.rs`
- `web/app/page.tsx`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

## Change Log

| Date | Change |
|---|---|
| 2026-07-25 | Story 1.10 context-engineered (freeze the `shared/` sync contract): designed the frozen `set.plays[]`/`set.derived` shape from the real Story 1.7/1.8 stat-engine + confidence outputs; fixed two content/overlay disjointness bugs in the DRAFT payload (`set.visibility`, top-level `segments`); flagged `EnrichedPlay` missing `in_library` and the raw-path privacy exclusion as open items; scoped to `shared/` + two existing consumer touch-points only. Status → ready-for-dev. |
| 2026-07-25 | Story 1.10 implemented: froze `shared/src/index.ts` + `shared/schema/sync-payload.schema.json` to the designed shape (`SyncPayload`/`SyncPlay`/`SyncSetDerived`, `SyncPayloadDraft` family renamed/removed); added the additive-only CI guard (frozen-baseline snapshot + `additive-only.test.ts` + widened `index.test.ts` parity checks), closing the Story 1.1 review's deferred-work.md gap; documented the `agent_version` last-N policy; updated both existing consumers (`lib.rs`'s schema test, `web/app/page.tsx`'s type import). Full gate green (pnpm lint/typecheck/build/test + cargo fmt/clippy/build/test, 136 Rust tests passed). Two deferred-work.md entries added, one annotated. Status → review. |
| 2026-07-25 | Story 1.10 code review (bmad-code-review, 3 parallel layers — Blind Hunter, Edge Case Hunter, Acceptance Auditor): Acceptance Auditor found zero AC/scope violations. 7 patches applied: `additive-only.test.ts` now catches a newly-added `required` field and `enum`/`const`/`pattern` narrowing (both real gaps in the AC-3 enforcement guard itself), fails with a clear message instead of a raw `TypeError` on a lost `items` schema, and resolves chained `$ref`s; `web/app/page.tsx`'s residual "(draft)"/`draftContractSource` naming fixed to match the frozen banners everywhere else; `lib.rs`'s schema test gained a `$defs.segment` absence assertion and switched two order-sensitive `assert_eq!`s to sorted comparisons. 1 item deferred (no `ajv`-backed schema-validation round-trip test yet — adding a new dependency is a bigger call than a review patch) and logged in deferred-work.md. 6 dismissed as noise/handled-elsewhere. Full gate re-verified green after patches (pnpm lint/typecheck/build/test + cargo fmt/clippy -D warnings/build/test, 136 Rust tests). Status → done. |
