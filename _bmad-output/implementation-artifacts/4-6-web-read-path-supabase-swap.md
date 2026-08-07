---
baseline_commit: 22b449b8c0884a5a525d2b3d39133113725e6fa0
---

# Story 4.6: Web read path — swap the committed fixture for Supabase

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a DJ,
I want the dashboard, Set Detail, and Style Evolution pages to show my real synced data,
so that the sets and library adds the agent has been syncing since Epic 3 actually appear, instead of the same committed fixture every DJ sees.

## Context & Authority

**No separate design-spec doc exists for this story — it is pure infrastructure, not a feature.** Its authority is `epics.md` Story 4.6 (added 2026-08-07, this session) plus the ruling below, worked out directly with Arjun while reviewing Story 4.2's deferred-work backlog.

**The gap:** `web/lib/sets/index.ts` is the one seam every set/library-consuming page imports through (Story 3.6 Task 4, AC-13/SM-1) — its own header comment says "when the cloud read path lands, only the three function bodies below change to a Supabase query and every component keeps working unchanged (Decision A: the fixture is the day-one stand-in for the real read)." That swap has never happened. The agent write path has been fully live since Epic 3 (`sync_set` → `sessions`/`sets`/`plays`, idempotent `PUT`) and Story 4.2 added a second live write path (`sync_library_add_events` → `library_track_events`). Meanwhile `getRecentSets`, `getSetById`, `deleteSet`, and `getLibraryAddEvents` all still read `recent-sets.fixture.json` / `library-add-events.fixture.json` — the same static, committed data for every DJ, regardless of what their agent has actually synced. Only `getAgentStatus` (Story 3.9) reads Supabase for real; it is this story's working model for how the other four should behave.

**Why this couldn't just get flagged and left:** production data is already accumulating (every real DJ's agent has been syncing since Epic 3) that the product cannot display. Flagged as a "[LAUNCH BLOCKER — unstoried]" entry in `deferred-work.md` during Story 4.2's review — it didn't fit Epic 4 (Style Evolution/Library Utilization features), Epic 5 (segments/enrichment), 6 (marketing), or 7 (billing), so it sat undiscovered by the normal per-epic story-creation process. Ruled by Arjun 2026-08-07: create the story now, sequence it at the end of Epic 4 (cross-cutting infrastructure, not a Style Evolution feature, but needs to land before Epic 5 work starts reading through the same seam), rather than let it accrete further.

**Sources:**
- `web/lib/sets/index.ts` — the seam itself. Read the whole file before starting; it is short (142 lines) and every doc comment on it is load-bearing context, not decoration.
- `deferred-work.md` — the "[LAUNCH BLOCKER — unstoried]" entry this story closes (originally logged during Story 4.2's implementation, confirmed still open during this story's creation).
- `sprint-status.yaml` — Epic 4 section, `4-6-web-read-path-supabase-swap` entry and its comment.
- `ARCHITECTURE-SPINE.md` AD-7 — the owner-`SELECT`-only RLS convention every table here already follows (`sessions`/`sets`/`plays`/`library_track_events`/`agent_status`). This story reads through existing RLS; it does not add or change any policy.
- `supabase/migrations/20260730204057_create_sessions_sets_plays.sql` — the actual `sessions`/`sets`/`plays` table shapes and RLS policies `getRecentSets`/`getSetById`/`deleteSet` must query against.
- `supabase/migrations/20260807100000_create_library_track_events.sql` — the `library_track_events` table shape `getLibraryAddEvents` must query against.
- `3-9-console-voice-failure-register-state-a11y-responsive-pass.md` (or wherever `getAgentStatus` was introduced/hardened) — the resilience pattern (lazy `createClient` import, try/catch, dev-only `console.error`, calm `null`/empty fallback in production) this story's four functions must match, not reinvent.
- `3-6-dashboard-home.md` Task 4 — the seam's own founding contract (AC-13/SM-1: "the dashboard and Set Detail import ONLY from here — never a fixture file, a Supabase client, or the wire envelope directly").
- `4-2-library-to-setlist-correlation-trend.md` — introduced `getLibraryAddEvents()` on the same fixture-first-swap-later footing as the other three; its Dev Notes/File List are the most recent precedent for this exact seam.

## Acceptance Criteria

Reproduced verbatim from `epics.md` Story 4.6 (added 2026-08-07):

1. **Given** the data-access seam in `web/lib/sets/index.ts`, **Then** `getRecentSets`, `getSetById`, `deleteSet`, and `getLibraryAddEvents` read from Supabase (`sessions`/`sets`/`plays`/`library_track_events`, all owner-SELECT via RLS per AD-7) instead of the committed fixtures — no `dj_id` filter needed or wanted, `auth.uid()` is the filter, matching `getAgentStatus`'s existing precedent exactly. *(Decision A's swap point; AD-7)*
2. **Given** every component that currently imports from this seam — confirmed at story-creation time to be `dashboard/page.tsx` (`getRecentSets`), `style-evolution/page.tsx` (`getRecentSets`, `getLibraryAddEvents`), `set/[id]/page.tsx` (`getSetById`), and `set/[id]/actions.ts` (a server action wrapping `deleteSet` for `DeleteModal.tsx`) — **not** `library-utilization/page.tsx`, still a Story 3.5 throwaway stub that imports nothing from this seam today — **Then** none of them change — the seam's function signatures and return shapes are preserved so the swap is invisible above this file, per the seam's own founding contract ("only the function bodies below change"). *(Story 3.6 Task 4, AC-13/SM-1)*
3. **Given** a DJ with no synced sets or add-events yet (a brand-new account, or Epic 3/4's own dev/test accounts before the agent has run), **Then** each function returns the same empty/`null` shape the fixture stage returns today, rendering the existing insufficient-history / empty-dashboard states — never a thrown error. *(Mirrors `getLibraryAddEvents`'s existing "day one, every DJ is empty by construction" contract)*
4. **Given** a genuine Supabase read failure (missing env, broken RLS, network), **Then** it fails calmly and resiliently exactly like `getAgentStatus` does today — rendered identically to "nothing synced yet" in production, but logged loudly in non-production so a real regression cannot sit invisible indefinitely. *(Mirrors `getAgentStatus`'s existing resilience contract)*
5. **Given** `deleteSet`, **Then** it performs a real hard delete against Supabase (not the fixture stage's in-memory `store` mutation), scoped by RLS so a DJ can only ever delete their own row. *(AC-12's original "removal path" intent, now against the real store)*
6. **Given** the committed fixtures (`recent-sets.fixture.json`, `library-add-events.fixture.json`) and their generator scripts (`build-fixture.mjs`, `build-library-fixture.mjs`), **Then** a decision is made and recorded on whether they are retired, or kept solely as local-dev/test fixtures decoupled from the production seam — not left ambiguous about which one `web/lib/sets/index.ts` actually serves. *(Prevents the same "which one is real" ambiguity this story exists to close)*
7. **Given** the full test suite, **Then** existing seam-consuming component tests are updated to mock/stub the Supabase client rather than relying on fixture data being served automatically, and the seam itself gains coverage for the empty-state and failure-state paths (AC-3/AC-4). *(Standing gate discipline, ai-8)*

## Tasks / Subtasks

> Suggested order: read the seam and its callers first (nothing here is safe to guess) → design the four queries against the real table shapes → swap the bodies one at a time, `getAgentStatus`-style → decide the fixtures' fate → update/add tests → doc writebacks → verification.

- [ ] **Task 1 — Read before writing** (no AC, prerequisite for all)
  - [ ] Read `web/lib/sets/index.ts` in full — every doc comment on it describes a contract this story must preserve or deliberately supersede; do not skim.
  - [ ] Read every current caller of `getRecentSets`, `getSetById`, `deleteSet`, `getLibraryAddEvents` — confirmed at story-creation time: `dashboard/page.tsx`, `style-evolution/page.tsx`, `set/[id]/page.tsx`, and `set/[id]/actions.ts` (the server action `deleteSet` actually goes through, one layer below `DeleteModal.tsx`) — to confirm none of them need to change (AC-2). `library-utilization/page.tsx` is **not** a current caller (still Story 3.5's stub) — re-grep for the seam's exports anyway rather than trusting this list is still exhaustive by the time this story is implemented.
  - [ ] Read `supabase/migrations/20260730204057_create_sessions_sets_plays.sql` and `supabase/migrations/20260807100000_create_library_track_events.sql` in full for the real column names, RLS policies, and any existing indexes the queries below should use.
  - [ ] Read `SetRecord` (`web/lib/sets/types.ts`) — it is `SyncPayload["set"]` verbatim (`external_id`, `started_at`, `ended_at`, `plays[]`, `derived`) — and `LibraryAddEvent`/`LibraryAddEventSnapshot` (`libraryConversion.ts`, `index.ts`) to know the exact shape each query must reconstruct.

- [ ] **Task 2 — `getLibraryAddEvents`: the simplest swap first** (AC: 1, 3, 4)
  - [ ] Rewrite the body to select `track_id, added_at` from `library_track_events`, no `dj_id` filter (RLS is the filter), matching `getAgentStatus`'s try/catch/lazy-import/dev-only-log shape exactly.
  - [ ] Empty result → `{ events: [], readAtMs: Date.now() }`, same as today's fixture-empty case would look like — confirm this actually renders the insufficient-history copy per AC-3, don't just assume the shape matches.
  - [ ] Do this one first: it is a flat single-table read with no join, the smallest possible version of the pattern the other three repeat.

- [ ] **Task 3 — `getRecentSets` / `getSetById`: reconstructing `SetRecord`** (AC: 1, 2, 3, 4)
  - [ ] Design the query (or queries) that reconstruct a `SetRecord` (`external_id`, `started_at`, `ended_at`, `plays[]`, `derived`) from `sessions`/`sets`/`plays`. Confirmed at story-creation time: `derived` is a `jsonb` column directly on `sets` (`20260730204057_create_sessions_sets_plays.sql:42`) — a plain `select` retrieves it with no reassembly needed.
  - [ ] **`sets.id` IS the `external_id`/`set_id` — there is no separate `external_id` column** (same migration, lines 27-29). `getSetById`/`deleteSet` must filter on `sets.id = externalId`, not a column literally named `external_id`; don't let the `SetRecord.external_id` field name in the TS type lead to querying a column that doesn't exist.
  - [ ] `getRecentSets`: newest-first by `started_at` — the fixture-stage comment already notes the sort is applied in-function "regardless of fixture order or a future unsorted Supabase result"; keep sorting in the function rather than trusting query order, per that existing rationale.
  - [ ] `getSetById(externalId)`: single-row fetch by `id = externalId` (see the `sets.id` note above), `null` on not-found — RLS makes a not-found and a not-mine indistinguishable by design, matching the fixture stage's existing `?? null` behavior.
  - [ ] No results (new account) → `[]` / `null` respectively, per AC-3.

- [ ] **Task 4 — `deleteSet`: a real hard delete, blocked on a new migration** (AC: 1, 5)
  - [ ] **Confirmed at story-creation time: no DJ-facing `DELETE` grant or policy exists on `sessions`/`sets`/`plays` today** (`20260730204057_create_sessions_sets_plays.sql:92-109` — only `select` grants + `*_select_own` policies; the migration's own comment says write access, including delete, is deliberately withheld pending a future write-path story). **This story is that story.** A client-side Supabase `.delete()` will fail (permission denied / RLS-filtered to nothing) until this is added — do not attempt to implement AC-5 without first writing the migration.
  - [ ] Add a new migration granting a scoped DJ-owned `DELETE` policy (`for delete using (auth.uid() is not null and auth.uid() = dj_id)`, matching the shape of the existing `*_select_own` policies), or a `SECURITY DEFINER` RPC mirroring `sync_set`/`sync_library_add_events`'s shape — pick whichever fits this codebase's existing convention better for a DJ-initiated (not agent-initiated) write; a direct RLS-scoped `DELETE` policy is likely the simpler and more consistent choice, since this is a user action through the authenticated web client, not an agent sync.
  - [ ] Once the delete path exists, replace the fixture stage's in-memory `store = store.filter(...)` with the actual `delete` against Supabase scoped to `id = externalId` (see the `sets.id` note in Task 3), relying on RLS to make cross-DJ deletion impossible rather than adding a redundant application-level `dj_id` check.
  - [ ] Confirm cascade behavior: deleting a `sets` row should also remove its `plays` rows (check for `on delete cascade` on `plays`'s foreign key, or handle it explicitly if not present) so a delete never leaves orphaned play rows behind.
  - [ ] New pgTAP isolation test for the delete policy, mirroring the existing `*_isolation_test.sql` pattern: a DJ can delete their own set, cannot delete another DJ's set.

- [ ] **Task 5 — Fixtures' fate (AC-6)** (AC: 6)
  - [ ] Decide, in the open rather than by default: retire `recent-sets.fixture.json` / `library-add-events.fixture.json` and their generators from the production import path entirely, or explicitly repurpose them as local-dev/test-only fixtures wired through a separate, clearly-named seam (e.g. a `USE_FIXTURE_DATA` dev flag, or fixture-backed test doubles only). Either is acceptable; leaving `web/lib/sets/index.ts` importing both a fixture and a Supabase client with no documented reason is not.
  - [ ] If kept for tests, update their own header comments (they currently describe themselves as the production stand-in) so a future reader doesn't reach the same "which one is real" confusion this story exists to resolve.

- [ ] **Task 6 — Tests** (AC: 7)
  - [ ] No existing test file or Supabase-client mocking convention covers `web/lib/sets/index.ts` today — confirmed by grep during story creation. This story establishes that pattern; look at how `getAgentStatus`'s own callers/tests (if any) handle the lazy `@/lib/supabase/server` import for a starting point, and keep the mock shape consistent across all four rewritten functions rather than inventing a new approach per function.
  - [ ] New test coverage for the seam itself: empty-state path (AC-3) and failure-state path (AC-4) for each of the four functions, at minimum.
  - [ ] Audit existing component/page tests that currently pass because they transitively read the committed fixture through this seam — they need to mock the seam (or the Supabase client) explicitly once the fixture is no longer the default read path, or they will start failing (or worse, silently pass against stale assumptions) after this story lands.

- [ ] **Task 7 — Doc writebacks** (no AC, process)
  - [ ] `deferred-work.md`: close the "[LAUNCH BLOCKER — unstoried]" entry this story resolves, pointing here.
  - [ ] `web/lib/sets/index.ts`'s own header comment: it currently describes itself as fixture-backed with Supabase as a future swap — rewrite it to describe current reality once this story ships, the same way `getAgentStatus`'s comment already does.
  - [ ] `sprint-status.yaml`: this story's own comment block (added at creation) already explains why it's sequenced here; no further note needed unless Task 4's RLS finding changes scope.

- [ ] **Task 8 — Verification & gates** (AC: all)
  - [ ] Full `web` gate: lint, typecheck, test, `next build` — clean.
  - [ ] Manual verification against a real Supabase project with real synced data (at least one DJ account with agent-synced sets and library add-events): dashboard, Set Detail, and Style Evolution all render real data, not the old fixture's fixed set. Delete a set via Set Detail's `DeleteModal` (through `set/[id]/actions.ts`) and confirm it is actually gone from Supabase (including its `plays` rows), not just the page.
  - [ ] Manual verification against a brand-new/empty DJ account: every page renders its existing empty/insufficient-history state, not an error.
  - [ ] Force a Supabase read failure (e.g. temporarily bad env var) and confirm the calm-fallback behavior matches `getAgentStatus`'s (empty/no-agent-equivalent rendering, dev-console log, no thrown error reaching a page).

## Dev Notes

- **This is `web/` plus one new `supabase/` migration — not agent or `shared/`.** The `sessions`/`sets`/`plays`/`library_track_events` tables and their `SELECT` RLS this story reads through already exist and are correct (built across Epic 3 and Story 4.2) — no changes needed there. But Task 4 is confirmed, not speculative: **no DJ-facing `DELETE` policy exists on `sets`/`sessions`/`plays` today**, so AC-5 cannot ship without a new migration adding one. Budget for that migration + its own pgTAP test as real, in-scope work, not a stretch goal.
- **Follow `getAgentStatus` as the pattern, not as a template to copy blindly.** It is the one function in this file already doing the real thing: lazy `@/lib/supabase/server` import (keeps `next/headers` out of every fixture-only consumer — no longer relevant once all four are real, worth reconsidering whether the lazy import is still needed or whether a top-level import is now fine), try/catch around the whole body, `error && process.env.NODE_ENV !== "production"` for dev-only logging, and a `{ ...snapshot, readAtMs: Date.now() }` shape so callers get the read time alongside the data (already established for `LibraryAddEventSnapshot` too — `buildLibraryConversion` needs an injected clock, not `Date.now()` inside a "pure" function, per Story 4.1's review).
- **Do not change any component.** AC-2 is a hard constraint: if a page needs to change to make this work, that is a sign the query design is wrong, not a sign the constraint should bend. The seam's entire reason for existing (Story 3.6 Task 4) is that swap.
- **RLS is the filter, not an application-level `dj_id` check.** Every existing table already follows AD-7's owner-`SELECT`-only convention; querying without a manual `dj_id` filter (letting `auth.uid()` do the scoping via policy) is the established pattern (`getAgentStatus` already does this) — adding a redundant client-side filter would be new, unnecessary complexity, not extra safety.
- **Watch for `derived`.** `SetRecord.derived` (`SyncSetDerived`) is a computed/cached summary — confirm from the migration whether it round-trips as a single JSON(B) column on `sets` or was decomposed into relational columns at write time. Getting this wrong is the most likely way `getRecentSets`/`getSetById` silently return a shape that satisfies TypeScript but renders wrong.
- **No test-mocking convention exists yet for this seam** — flagged explicitly in Task 6 rather than left to be discovered mid-implementation. Whatever pattern is chosen here will likely become the template for future Supabase-backed seam functions; keep it simple and consistent across all four rewrites rather than four different approaches.

### Project Structure Notes

- Updated: `web/lib/sets/index.ts` (all four function bodies + header comment); possibly `web/lib/sets/recent-sets.fixture.json` / `library-add-events.fixture.json` / `build-fixture.mjs` / `build-library-fixture.mjs` headers (Task 5) or their removal from the production path.
- New: a Supabase migration adding the `DELETE` policy (Task 4, confirmed required) + its pgTAP test; a test file (or files) for `web/lib/sets/index.ts` and whatever Supabase-client mock helper Task 6 establishes.
- Unchanged (per AC-2): `dashboard/page.tsx`, `style-evolution/page.tsx`, `set/[id]/page.tsx`, `set/[id]/actions.ts`. `library-utilization/page.tsx` is untouched because it isn't a caller yet, not because AC-2 protects it.

### References

- [Source: web/lib/sets/index.ts] — the seam itself; every doc comment is a contract.
- [Source: deferred-work.md, "[LAUNCH BLOCKER — unstoried]" entry] — the gap this story closes.
- [Source: ARCHITECTURE-SPINE.md#AD-7] — owner-SELECT-only RLS convention.
- [Source: supabase/migrations/20260730204057_create_sessions_sets_plays.sql] — `sessions`/`sets`/`plays` shapes and RLS.
- [Source: supabase/migrations/20260807100000_create_library_track_events.sql] — `library_track_events` shape and RLS.
- [Source: web/lib/sets/types.ts] — `SetRecord = SyncPayload["set"]`.
- [Source: 3-6-dashboard-home.md, Task 4] — the seam's founding contract (AC-13/SM-1).
- [Source: 4-2-library-to-setlist-correlation-trend.md] — `getLibraryAddEvents()`'s introduction, most recent precedent for this exact seam.
- [Source: epics.md#Story 4.6] — this story's acceptance criteria, verbatim.
- [Source: sprint-status.yaml, `4-6-web-read-path-supabase-swap` entry] — sequencing rationale.

## Dev Agent Record

### Agent Model Used

_To be filled in by the dev agent at implementation time._

### Debug Log References

_To be filled in by the dev agent at implementation time._

### Completion Notes List

_To be filled in by the dev agent at implementation time._

### File List

_To be filled in by the dev agent at implementation time._
