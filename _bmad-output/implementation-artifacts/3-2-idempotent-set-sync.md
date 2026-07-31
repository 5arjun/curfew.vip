---
baseline_commit: e826dd60cf1f94fd1460007b344f46cef43cec23
---

# Story 3.2: Idempotent set sync

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a DJ,
I want each completed set to sync via an idempotent `PUT /sets/:set_id` on a deterministic namespaced id, updating only content columns,
so that a set appears in the cloud exactly once and re-parses never duplicate it or clobber overlays.

## Acceptance Criteria

1. **Given** a set, **When** synced, **Then** it PUTs to `set_id = hash(dj_id, session_identity)` — deterministic, never a fresh UUID, never session-identity alone. *(FR-4, AR-2/AD-4)*
2. **Given** a re-parse/re-run, **When** synced again, **Then** content updates in place with no duplicate row and no re-keying/re-partition. *(AR-2/AD-4)*
3. **Given** the upsert, **Then** it is column-scoped to content columns; overlay columns are never touched, enforced by a `shared/` contract test. *(AR-8/AD-16)*
4. **Given** two DJs sharing a USB library, **Then** their sessions do not collide (`dj_id` is in the key). *(AR-2/AD-4)*
5. **Given** contract tests for idempotency, no-backfill-dupes, shared-USB non-collision, and content/overlay disjointness, **Then** they are first-class passing acceptance criteria, not afterthoughts.
6. **Given** `session_identity` (the AC-1 hash input), **Then** it is derived from a stable intrinsic property of the session (its immutable start-anchor / first-play identity) — **never** file mtime, path, or filename — so a later Serato re-save does not re-key or duplicate the set, **and** two distinct same-night sessions never collide. *(AD-16, resolved 2026-07-20 — already reflected in the frozen `session_identity` derivation built by Story 2.8; this AC is a contract test proving it, not new derivation work.)*

## Tasks / Subtasks

- [x] **Task 1: Deterministic UUID v5 hash — `hash(dj_id, session_identity) -> Uuid`** (AC: 1, 4, 6)
  - [x] Add the `v5` feature to the `uuid` crate in `agent/src-tauri/Cargo.toml` (currently only `["v4"]` — line 145; `Uuid::new_v5` is gated behind it).
  - [x] Implement the hash as a pure, unit-testable function (new module, e.g. `agent/src-tauri/src/sync.rs`): `set_id(dj_id: Uuid, session_identity: &str) -> Uuid` using `Uuid::new_v5(&dj_id, session_identity.as_bytes())` — `dj_id` as the UUID v5 *namespace*, `session_identity` as the *name*. This is precisely what "deterministic and namespaced by `dj_id`" (AD-4) means; UUID v5 is the standard construct for it, don't hand-roll a hash.
  - [x] Unit tests, no DB required: same `(dj_id, session_identity)` in → same UUID out every time (determinism); same `session_identity`, different `dj_id` → different UUID (AC-4, shared-USB non-collision); different `session_identity`, same `dj_id` → different UUID.
  - [x] Per the Story 3.1 schema comments, this **same** hash value is what both `sessions.id` and `sets.id` are set to (both columns have no DB default specifically so the agent supplies this value — see Dev Notes). Do not compute two different values for the two tables.
  - [x] AC-6 contract test: `legacy_session_identity(first_play: &Play)` (`capture.rs:137-147`) intentionally hashes `first_play.path` (the *played track's* own audio file path — content data, part of what makes the session's first play unique) together with `first_play.start_time`; this is **not** a violation of AD-16, which forbids hashing the *watched session/log file's own* mtime, path, or filename (`raw_ref` / `serato4_raw_ref`/legacy `.session` path) — a filesystem artifact of the log file itself that changes on re-save even though the session's content hasn't. Write the test at that boundary: assert `session_identity` is stable when the same session is re-detected via a different `raw_ref` (e.g. the watched file got renamed/re-saved, same `first_play.path`/`start_time`) — i.e. prove `session_identity` never depends on `raw_ref`, since it's computed purely from parsed play content, not from the file being watched. This re-proves Story 2.8's derivation as this story's own first-class AC, per AC-5 — don't just point at 2.8's existing tests and call it done.

- [x] **Task 2: Migration — write path as a `SECURITY DEFINER` RPC function, not raw table grants** (AC: 2, 3, 4)
  - [x] New additive migration in `supabase/migrations/` following the existing `_create_sessions_sets_plays.sql` / `_add_djs_phone_column.sql` conventions (`check-additive-only-migrations.sh` only forbids `DROP`/`RENAME`/`ALTER COLUMN TYPE` — new functions, grants, and policies always pass).
  - [x] Define a single `SECURITY DEFINER` Postgres function (e.g. `sync_set(session_identity text, started_at timestamptz, ended_at timestamptz, derived jsonb, plays jsonb) returns uuid`) that:
    - Derives `dj_id` **only** from `auth.uid()` inside the function — never from a client-supplied parameter. This is the direct fix for the gap Story 3.1 flagged (line 138 of that story): nothing at the DB layer today guarantees a client-supplied `dj_id` matches the authenticated caller, so the function must not accept `dj_id` as an argument at all.
    - Computes `set_id` itself server-side using the identical UUID v5 formula from Task 1 (`uuid_generate_v5(auth.uid(), session_identity)` — confirm the `uuid-ossp` extension is enabled on the project; enable it in this migration if not, it's additive) rather than trusting a client-supplied id. This keeps the agent's locally-computed `set_id` (Task 1) and the server's authoritative one mathematically identical without ever trusting the client's copy.
    - Upserts `sessions` (`on conflict (dj_id, session_identity) do nothing` — it's an immutable anchor, never updated after creation) and `sets` (`on conflict (id) do update set derived = excluded.derived` — **content column only**, `visibility` is never in the `SET` clause, never in the function's parameter list at all — the simplest and strongest way to make AC-3 mechanically true).
    - Replaces `plays` for this `set_id` on every call: `delete from plays where set_id = ... and dj_id = auth.uid()` then bulk-insert from the `plays jsonb` array. This is simpler and safer than a per-position upsert (no orphaned trailing rows if a re-parse produces fewer plays than before) and stays AC-2-compliant — it refreshes content under the same `set_id`/`session_id`, it does not re-key or re-partition the set itself.
    - Returns the `set_id` so the agent can confirm success and mark `synced_at` locally.
  - [x] Grant `execute` on the function to `authenticated` only (no direct `insert`/`update` grant on the three tables — keep today's SELECT-only table grants from Story 3.1 unchanged).
  - [x] pgTAP tests in `supabase/tests/` (new file, e.g. `sync_set_isolation_test.sql`, mirroring `sessions_sets_plays_isolation_test.sql`'s structure) — these ARE the AC-5 contract tests at the DB layer:
    - Calling `sync_set(...)` twice with identical arguments as the same authenticated user produces exactly one `sessions` row and one `sets` row (idempotency, AC-2).
    - Calling it as two different authenticated users with the *same* `session_identity` string produces two distinct `set_id`s / two distinct rows, each owned by its own `dj_id` (AC-4, shared-USB non-collision).
    - Calling it a second time after a manual `update sets set visibility = 'public' where id = ...` leaves `visibility` unchanged (AC-3, overlay untouched by re-sync).
    - `anon` cannot execute the function at all (`42501`).

- [x] **Task 3: Rust sync client — authenticated PostgREST RPC call** (AC: 1, 2)
  - [x] New module (e.g. `agent/src-tauri/src/sync.rs`, or extend it from Task 1) building a `reqwest::blocking::Client` POST to `{SUPABASE_URL}/rest/v1/rpc/sync_set` with headers `apikey: {SUPABASE_PUBLISHABLE_KEY}` and `Authorization: Bearer {access_token}` — mirror `SupabaseAuthClient`'s request-building shape in `agent/src-tauri/src/auth/client.rs`, this is the first PostgREST (not Auth-endpoint) caller in the codebase, no existing helper to call into.
  - [x] Get the bearer token via the exact function Story 2.10 built and left uncalled for this purpose: `auth::client::get_valid_access_token(...)`. Get `dj_id` (for the agent's own local hash computation in Task 1 — the server derives its own copy independently, per Task 2) via `auth::client::current_dj_id(...)`, also built and left uncalled for this purpose.
  - [x] Body: `session_identity`, `started_at`, `ended_at`, `derived` (jsonb), `plays` (jsonb array) — built from a `captured_sessions` row's `plays_json`/`derived_json` columns (`agent/src-tauri/src/store.rs`). Do not send `dj_id` or `set_id` in the request body — the function computes both server-side (Task 2).
  - [x] On a successful (2xx) response, update the local row: `UPDATE captured_sessions SET synced_at = ? WHERE session_identity = ?` (this is the column Story 2.8 left `NULL forever ... Story 3.2 owns setting it`, `store.rs:46`).
  - [x] Read source: rows in `captured_sessions` where `status = 'captured' AND synced_at IS NULL`. Do not build a queue/retry/backoff mechanism here — that is Story 3.3's explicit scope (`epics.md` Story 3.3 AC-1: "queues in local SQLite" is new scope, confirming no queue exists yet). This story's sync call can be a straightforward "attempt once, leave `synced_at` NULL on failure for a later story to retry."

- [x] **Task 4: `shared/` contract test — content/overlay disjointness** (AC: 3, 5)
  - [x] New test file in `shared/src/` (e.g. `content-overlay-scoping.test.ts`), following the walker/assertion idiom already established by `shared/src/no-raw-data.test.ts` (resolve `$ref`/`oneOf`/`allOf`/`items` with a cycle guard, assert a fixed invariant at every matched node) rather than writing a new walker from scratch.
  - [x] Define the canonical overlay-column allowlist as data (today: `sets.visibility` only) and assert it never appears in the agent's outbound sync payload shape. Since the actual wire payload for this story is the RPC function's parameter list (Task 2), not `sync-payload.schema.json` itself (that schema is frozen per Story 1.10/AD-15 and already excludes `visibility` — confirmed by `shared/src/index.ts:38-41`), this test's job is to assert the *documented* overlay-column list stays in sync with what Task 2's migration actually withholds — prevents future drift if a table gains a new overlay column later without this test being updated.

- [x] **Task 5: Verification**
  - [x] Run the full local gate (per the standing Epic 2+ rule — AR-8/ai-8 — gate must be run for real, not assumed green): Rust `cargo test`/`cargo clippy`/`cargo fmt --check` in `agent/src-tauri`, `pnpm lint`/`pnpm typecheck`/`pnpm test` workspace-wide, `supabase test db` for the new pgTAP suite, `supabase db reset` + migration apply clean, additive-only guard script passes on the new migration.
  - [x] Manually verify against local Supabase: sync the same captured set twice, confirm one `sessions` row + one `sets` row + correct `plays` row count both times; sync as two different local test users with the same `session_identity`, confirm two distinct `set_id`s.

### Review Findings

- [x] [Review][Patch] Missing `started_at`/`ended_at` silently defaults to Unix epoch (1970) instead of erroring [agent/src-tauri/src/sync.rs:194] — Fixed: added `SyncError::MissingTimeBounds`; `build_request` now uses `.ok_or(SyncError::MissingTimeBounds)?` for both fields, matching the existing `Corrupt` pattern two lines above instead of defaulting. Regression test added (`a_row_with_no_time_bounds_fails_loudly_instead_of_defaulting_to_epoch`).
- [x] [Review][Patch] `uuid` crate's `serde` feature is not explicitly requested, relies on transitive resolution [agent/src-tauri/Cargo.toml:147] — Fixed: added `"serde"` explicitly to the `uuid` features list, with a comment explaining why. Verified `Cargo.lock` unchanged (the feature was already transitively resolved) and the full gate still passes.
- [x] [Review][Patch] Per-row sync failures inside `sync_pending_sessions` are silently discarded [agent/src-tauri/src/sync.rs:231] — Fixed: the loop now matches on `sync_one`'s result and logs the failure reason (`#[cfg(debug_assertions)] eprintln!`, matching this codebase's existing convention) before continuing to the next row.
- [x] [Review][Patch] AC-6 "watched-file rename" contract test is tautological [agent/src-tauri/src/capture.rs:472] — Fixed: rewritten as `ac6_session_identity_depends_only_on_first_play_path_and_start_time`, which holds `path`/`start_time` fixed while varying every other `Play` field (`title`/`artist`/`duration_sec`) and asserts the identity is unchanged — a falsifiable test of what the hash actually depends on, rather than calling the function twice with identical input.
- [x] [Review][Patch] pgTAP suite never asserts orphaned play rows are gone after a shrinking re-sync [supabase/tests/sync_set_isolation_test.sql:86] — Fixed: added a `count(*) from public.plays` assertion after Case 3's shrinking re-sync, asserting `0` rows remain. `plan(9)` bumped to `plan(10)`. Verified live against local Supabase: 58/58 pgTAP assertions pass (was 57).
- [x] [Review][Defer] No pagination/batching/cap on a sync pass; serial blocking HTTP calls per row [agent/src-tauri/src/sync.rs:231] — deferred, tied to Story 3.3's ownership of retry/backoff/queue wiring design; not reachable until `sync_pending_sessions` is actually called from a live loop.
- [x] [Review][Defer] `SetIdMismatch` has no circuit breaker — would retry indefinitely once wired into a retry loop [agent/src-tauri/src/sync.rs] — deferred, Story 3.3 explicitly owns retry/backoff design per this story's own Dev Notes.
- [x] [Review][Defer] No guard against concurrent/overlapping `sync_pending_sessions` calls (e.g. multi-machine same DJ) [agent/src-tauri/src/sync.rs] — deferred, idempotent upserts make this a redundancy/efficiency concern rather than data corruption, and it only matters once wired into a live/periodic trigger (Story 3.3's territory).

## Dev Notes

- **This is the first story to write to `sessions`/`sets`/`plays` at all.** Story 3.1 deliberately shipped SELECT-only grants and zero write policies, explicitly handing the write-path design to this story (`3-1-...md:140`). There is no existing write-path code or convention to follow beyond the `SECURITY DEFINER` steer in AD-19 and the `djs` table's trigger precedent — you are establishing the pattern, not extending one.
- **`sessions.id` and `sets.id` are the *same* value.** Both columns are `uuid primary key` with **no DB default** specifically because the agent (Task 1) / function (Task 2) supplies `hash(dj_id, session_identity)` for both (`3-1-...md:78,86`). Do not generate two different ids. `sets.id` IS the `set_id`/`external_id` the frozen `SyncPayload.set.external_id` field and epics.md both refer to — there is no separate `external_id` column anywhere.
- **Never trust a client-supplied `dj_id`.** This is a named, explicit gap from Story 3.1's review (`3-1-...md:138`): nothing at the DB layer today guarantees a client-supplied `dj_id` on `sets`/`plays` actually matches the authenticated caller. The `SECURITY DEFINER` function (Task 2) closes this by deriving `dj_id` exclusively from `auth.uid()` inside the function body — the client never gets to assert its own `dj_id` or `set_id` and have it trusted.
- **`session_identity` already exists — this story only hashes it, it does not derive it.** Story 2.8 built and froze the local derivation (`agent/src-tauri/src/capture.rs`): `serato4:{history_session.id}` for Serato 4, `legacy:{fnv1a_hex(first_play.path + first_play.start_time)}` for legacy, persisted in `captured_sessions.session_identity` (`store.rs:37`, `UNIQUE`). AC-6 is a **contract test proving** this derivation already satisfies "intrinsic, never mtime/path/filename" — it is not new derivation work for this story.
- **HTTP/auth primitives already exist, waiting on this story's caller.** `agent/src-tauri/src/auth/client.rs` has `get_valid_access_token(...)` and `current_dj_id(...)`, both built in Story 2.10 with code comments naming Story 3.2 as the intended (and only) caller. `reqwest` (blocking, `rustls`, `json` features) is already a dependency, used today only for the Auth refresh endpoint — this story's PostgREST RPC call is the first non-Auth Supabase REST call in the codebase, so there is no existing generic client to reuse; mirror `SupabaseAuthClient`'s request-building shape instead of inventing a new one.
- **Column-scoping is enforced at three independent layers, not one** — schema-level (the `SECURITY DEFINER` function's parameter list and `SET` clause never mention `visibility`, Task 2), DB-test-level (pgTAP asserting a re-sync doesn't touch a manually-set `visibility`, Task 2), and `shared/`-test-level (Task 4, per AC-3's explicit wording). All three are required; none alone satisfies AC-3/AC-5.
- **Scope boundary vs. Story 3.3:** this story is synchronous/online-only sync of already-`captured` rows. It does **not** build a retry queue, backoff, or offline-detection — `captured_sessions.synced_at` staying `NULL` after a failed attempt is sufficient; Story 3.3 ("Offline sync queue") owns turning that into durable queueing. Don't build queue infrastructure here.
- **`plays` has no overlay columns yet** — delete-and-reinsert on every sync (Task 2) is safe today. If a future epic (5, segment/enrichment overlays) adds a `plays` overlay column, that story will need to revisit this function; not this story's problem.

### Project Structure Notes

- New Rust code: `agent/src-tauri/src/sync.rs` (or similar name) — a new module in the existing `watcher -> parser -> joiner -> stat-engine -> local store -> sync-queue` pipeline described in `agent/src-tauri/src/lib.rs`'s and `watcher/mod.rs`'s module docs; this story is literally "sync-queue" from that pipeline diagram (the synchronous half of it).
- New SQL: one additive migration in `supabase/migrations/` (function + grants), one new pgTAP file in `supabase/tests/`.
- New TS: one new test file in `shared/src/`, following existing file-per-invariant convention (`additive-only.test.ts`, `no-raw-data.test.ts`).
- No `web/` changes — this story is agent + supabase only, same scope discipline Story 3.1 followed.
- No changes to `shared/schema/sync-payload.schema.json` — it's frozen (Story 1.10/AD-15); this story's wire format is the RPC function's own parameter shape, a separate (new, not-yet-frozen) contract.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2: Idempotent set sync] — acceptance criteria (verbatim above).
- [Source: _bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md#AD-4] — `set_id = hash(dj_id, session_identity)`, namespaced, never a fresh UUID, never session_identity alone.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md#AD-16] — column-scoped upsert, overlay columns disjoint and agent-never-writes, `session_identity` intrinsic-derivation requirement, `stable_session_identity` resolution note.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md#AD-19] — write mechanism should be a Postgres-side `SECURITY DEFINER` function, never a raw elevated-key `UPDATE` from server code.
- [Source: _bmad-output/planning-artifacts/prds/prd-name-pending-2026-07-19/prd.md#FR-4] — auto-sync, idempotent, offline-queue consequence (queue itself deferred to Story 3.3).
- [Source: _bmad-output/planning-artifacts/prds/prd-name-pending-2026-07-19/addendum.md] — `PUT /sets/{set_id}` over HTTPS/JWT, derived-only payload shape.
- [Source: _bmad-output/implementation-artifacts/3-1-sessions-sets-plays-schema-visibility-content-overlay-split.md] — schema this story writes to; lines 78/86 (no-default id columns), 138 (dj_id-trust gap), 140 (SECURITY DEFINER steer), 103-109 (current SELECT-only grant state).
- [Source: _bmad-output/implementation-artifacts/2-8-set-capture-into-local-sqlite.md] — `session_identity` derivation (Task 4 of that story), `synced_at` reserved column, explicit hand-off note to this story.
- [Source: _bmad-output/implementation-artifacts/2-10-agent-secure-token-storage.md] — `get_valid_access_token`/`current_dj_id`, both built for this story's use.
- [Source: agent/src-tauri/src/store.rs] — `captured_sessions` schema, `synced_at` column.
- [Source: agent/src-tauri/src/capture.rs] — `session_identity` derivation functions, module doc naming this story as the sync-queue half.
- [Source: agent/src-tauri/src/auth/client.rs] — token/dj_id retrieval functions, `SupabaseAuthClient` request-building precedent.
- [Source: shared/src/no-raw-data.test.ts] — walker/assertion idiom to reuse for the new `shared/` contract test.
- [Source: supabase/scripts/check-additive-only-migrations.sh] — confirms new functions/grants/policies always pass the additive-only guard.
- [Source: supabase/migrations/20260730204057_create_sessions_sets_plays.sql] — current schema, SELECT-only grants, RLS policies to leave unchanged.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `cargo test --lib` (agent/src-tauri): 251 passed, 0 failed.
- `cargo test` (agent/src-tauri, full incl. golden/integration suites): 251 + 9 integration tests, all passed.
- `cargo clippy --lib --tests -- -D warnings`: clean.
- `cargo fmt --check`: clean (after one `cargo fmt` pass to normalize new code).
- `pnpm lint` / `pnpm typecheck` / `pnpm test` (workspace-wide via turbo): all green, incl. `@curfew/shared` (20 tests, 4 files) and `web` (23 tests, unaffected).
- `supabase db reset`: applies all 5 migrations clean, including the new `20260731120000_create_sync_set_function.sql`.
- `supabase test db`: 3 files, 57 pgTAP assertions, all passed (incl. the 9 new `sync_set_isolation_test.sql` assertions).
- `bash supabase/scripts/check-additive-only-migrations.sh`: passes on the new migration.
- Manual verification against local Supabase over real HTTP (not just pgTAP's role-switch simulation): created two real `auth.users` via the Admin API, signed in for real access tokens, called `POST /rest/v1/rpc/sync_set` — (1) twice as the same user with identical args → same returned `set_id` both times, exactly 1 `sessions`/1 `sets`/1 `plays` row for that user afterward (re-sync didn't duplicate the play row); (2) once as a second user with the identical `session_identity` string → a distinct `set_id`, confirming shared-USB non-collision end-to-end through the real PostgREST layer, not just SQL. Test users deleted and `supabase db reset` re-run afterward to leave the local stack clean.

### Completion Notes List

- Task 1: `agent/src-tauri/src/sync.rs::set_id` implements `hash(dj_id, session_identity)` via `Uuid::new_v5`. AC-6 contract test placed in `capture.rs` (not `sync.rs`) since it proves a property of `legacy_session_identity` itself (its signature never takes `raw_ref` as input, so a watched-file rename/re-save can't affect it) — `sync.rs`'s own tests cover `set_id`'s determinism/namespacing separately.
- Task 2: the migration's function parameter names (`session_identity`, `started_at`, `ended_at`, `derived`) collide with real column names on `sessions`/`sets`, which plpgsql flagged as a hard "ambiguous column reference" parse error in the `ON CONFLICT` target list and `SET` clause. Fixed with the standard `#variable_conflict use_column` pragma (documented inline in the migration) rather than renaming parameters, which would have changed the RPC's wire-visible parameter names for no benefit.
- Task 2 (deviation from the story's literal sketch): `started_at`/`ended_at` are `bigint` (unix epoch seconds) rather than `timestamptz`, matching this codebase's existing timestamp convention (`store.rs`, `auth/client.rs` both already avoid a `chrono`/ISO-8601 dependency) — cast via `to_timestamp()` inside the function. The story's signature was explicitly given as "e.g."
- Task 2 (deviation): the `sets` `ON CONFLICT ... DO UPDATE` also refreshes `started_at`/`ended_at` alongside `derived`, not `derived` alone as the story's literal sketch showed — both are content columns (not the `visibility` overlay column AC-3 protects), and leaving them stale after a re-parse that extends a session's bounds would silently violate AC-2's "content updates in place." Covered by a dedicated pgTAP assertion.
- Task 3: `sync_pending_sessions` independently recomputes `set_id` locally (via `sync::set_id`, using the `dj_id` claim off the fetched access token) and verifies it against the server's returned id before stamping `synced_at` — a defense-in-depth check the story's Dev Notes motivate ("keeps the agent's locally-computed set_id and the server's authoritative one mathematically identical") but don't explicitly mandate verifying; implemented as a hard `SetIdMismatch` error (row stays unsynced) rather than silently trusting the server's response.
- Task 3: not wired into any live/periodic trigger (watcher loop, tray, startup thread) — the story's tasks scope this to the sync client function itself; a caller wiring `sync_pending_sessions` into a running loop is not one of this story's ACs or tasks (FR-4's "auto-sync" cadence reads as Story 3.3's retry-queue territory, per the story's own scope-boundary Dev Note).

### File List

- `agent/src-tauri/Cargo.toml` — added `v5` feature to the `uuid` crate.
- `agent/src-tauri/Cargo.lock` — resolved (adds `sha1_smol`, the `v5` feature's SHA-1 dependency).
- `agent/src-tauri/src/sync.rs` — new: `set_id` (Task 1), `SyncClient`/`SupabaseSyncClient`/`sync_pending_sessions` (Task 3), unit tests for both.
- `agent/src-tauri/src/lib.rs` — added `pub mod sync;`.
- `agent/src-tauri/src/store.rs` — added `rows_pending_sync`, `mark_synced`, plus their unit tests.
- `agent/src-tauri/src/capture.rs` — added the AC-6 contract tests (`ac6_session_identity_is_stable_across_a_watched_file_rename_re_save`, `ac6_two_distinct_same_night_sessions_never_collide`).
- `supabase/migrations/20260731120000_create_sync_set_function.sql` — new: the `sync_set` `SECURITY DEFINER` RPC function + `execute` grant.
- `supabase/tests/sync_set_isolation_test.sql` — new: pgTAP contract tests for Task 2/AC-5.
- `shared/src/content-overlay-scoping.test.ts` — new: the `shared/` content/overlay disjointness contract test (Task 4).
- `_bmad-output/implementation-artifacts/3-2-idempotent-set-sync.md` — this story file (frontmatter, task checkboxes, Dev Agent Record, Change Log, Status).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status updates (ready-for-dev → in-progress → review).

### Change Log

- 2026-07-31: Implemented all 5 tasks (deterministic `set_id` hash, `sync_set` SECURITY DEFINER RPC migration + pgTAP, Rust sync client, `shared/` content/overlay contract test); full local verification gate run for real (cargo test/clippy/fmt, pnpm lint/typecheck/test, supabase test db, db reset, additive-only guard, manual real-HTTP verification); story moved to review.
