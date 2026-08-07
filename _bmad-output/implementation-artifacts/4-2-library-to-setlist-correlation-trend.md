---
baseline_commit: 8968c016b0b6e60f67b78c05f3b5778b0f6110ab
---

# Story 4.2: Library-to-setlist correlation trend

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a DJ,
I want a trend line of whether my recently-added library tracks are making it into sets,
so that I know if my digging is translating to the dancefloor.

## Context & Authority

**No separate design-spec doc exists for this story** (same situation as 4.1). The epics.md ACs plus the "Design decisions locked this session" block below are this story's authority — worked out directly with Arjun before any code was written, closing a real data-model gap Story 1.10 flagged and explicitly deferred to whichever Epic 4 story implemented FR-10 (this one).

**The gap:** the frozen `shared/` contract (`shared/src/index.ts`) only syncs a track's add-date on a per-**play** basis (`SyncPlay.library_added_at`). There is no synced record of the DJ's full library — a track that was added but never played is invisible to the cloud. Read literally, epics AC-1 (*"share of recently-added tracks that appear in sets"*) needs a denominator (how many tracks were added) that doesn't exist in synced data today. Story 1.10 named this directly: *"a purpose-built (possibly hashed/opaque) per-track identity field can be added later... flagged as Open Question #1 for Arjun re: future Epic 4 FR-10 correlation"* (`1-10-freeze-the-shared-sync-contract.md:163`; `deferred-work.md:263`). This story is the one that resolves it — and Story 4.3's FR-11 conversion-rate denominator has the **identical** problem, so resolving it here unblocks that story too rather than pushing the same wall one story down the epic.

**Two ways to close the gap were weighed live with Arjun:** (A) build go-forward library-add-event capture so the cloud can see adds, not just plays, or (B) reframe the metric to a play-data-only proxy (no agent/cloud work, but a materially weaker metric, and it still leaves 4.3 stuck). **Arjun chose A.**

**Sources:**
- `epics.md` §Story 4.2 (lines 809–819) + Epic 4 overview (lines 790–794, Decision B's "played = played-on-Curfew," go-forward, never-a-receipt copy rule — this story extends that same go-forward discipline to library *adds*, not just plays).
- PRD `prd.md`: **FR-10 sits under PRD §4.3 "Style Evolution" (line 211), directly below FR-9 (line 217) — not under §4.4 "Library Utilization" (line 228) where FR-11–13 (Stories 4.3–4.5) live.** This is a real, currently-undocumented IA signal — see D-11 below.
- `1-10-freeze-the-shared-sync-contract.md:163` (Open Question #1) + `deferred-work.md:263` — the identity-field deferral this story closes.
- `ARCHITECTURE-SPINE.md`: AD-1 (line 58, edge-derives/cloud-may-SQL-reaggregate-over-synced-rows — this is the line the monthly cohort join runs cloud-side legally under), AD-3 (frozen contract — this story's `shared/` change must stay additive), AD-4 (line 76, idempotent sync precedent), AD-8 (line 102, "the agent's **only** write is the idempotent set sync... except the AD-20 status heartbeat, the one named, column-scoped amendment to this rule" — **this story is a second, new amendment to that rule, see D-5**), AD-15 (line 144, additive-only forever), AD-20 (line 183, the heartbeat precedent for "a second sanctioned agent write").
- `shared/src/index.ts` — `SyncPlay` (lines 76–128), `SyncPayload` (lines 190–216, one-set-per-`PUT`, confirms a library-add-event batch needs its **own** payload shape, not a field bolted onto `SyncPayload`).
- `agent/src-tauri/src/capture.rs` — `fnv1a_hex` (line 134), the existing deterministic/cross-build-stable hash already used for session identity (lines 150–164) — reused here for track identity (D-2), not reinvented.
- `agent/src-tauri/src/store.rs` — local SQLite schema convention: `CREATE TABLE IF NOT EXISTS` inline in Rust, no external migration tool (lines 35, 57).
- `agent/src-tauri/src/sync_queue.rs` — the durable local-queue + backoff `sync_loop` (Story 3.3) this story's add-event queue rides.
- `supabase/migrations/20260730204057_create_sessions_sets_plays.sql` (lines 21–101) — the RLS pattern this story's new table must match: `dj_id` denormalized directly onto the table (not join-based, for RLS performance), `for select using (auth.uid() is not null and auth.uid() = dj_id)`, no DJ-facing INSERT/UPDATE/DELETE policy.
- UX `EXPERIENCE.md` line 73 (Trend chart component pattern — currently lists only BPM/genre/key, **not** library conversion; see D-11), line 74 (Chart Summary "one shared utility"), line 91 (insufficient-history exact copy pattern), line 98 (chart-failed state).
- `4-1-style-evolution-trend-view-excludes-low-confidence.md` — the precedent this story extends: `TrendChart.tsx`'s month-bucketed categorical-axis component (its D-3), `localMonthKey` (its Task 1), the Chart Summary generator pattern (its Task 2), and its own D-8 "gap, not a fabricated value" discipline, reused here as D-9.
- `3-3-offline-sync-queue.md` — the durable at-least-once/idempotent local queue pattern this story's add-event sync reuses rather than building a second one.

## Design decisions locked this session (2026-08-06, Arjun)

1. **D-1 — First-run seeding trap.** On an agent's very first run, diffing the DJ's whole existing library against an empty local store would make the **entire library** look newly-added, flooding month one and violating the exact go-forward frame Decision B already established for plays. Fix: first run takes a **silent local baseline snapshot** of every track ID currently in the library (stored locally, **never synced as add-events**); only a track ID that appears on a **later** scan and wasn't in the baseline counts as a real add-event.
2. **D-2 — Track identity = `fnv1a_hex` of the portable path** (`capture.rs:134`), the same hash function already used for session identity — reused, not reinvented; "deterministic and cross-build-stable" is the only property needed. Raw path is never sent (privacy, same posture as the existing `SyncPlay` contract) — this is the "purpose-built hashed/opaque identity field" Story 1.10's Open Question #1 anticipated.
3. **D-3 — Detection piggybacks on the existing library read**, not a new dedicated watcher: the agent already reads the library DB (`database V2`/`master.sqlite`) for the `tadd`/`uadd` join at capture time (Story 3.7 §3d) — diff current track IDs against the local baseline/seen-set there. New IDs get queued through the **same** durable local-SQLite offline queue Story 3.3 already built for sets (at-least-once + idempotent, same `sync_loop` backoff), not a second queue mechanism.
4. **D-4 — Contract additions, both additive per AD-15, freeze not reopened:** (a) `SyncPlay.track_id?: string | null` — same opaque hash, so a play can join back to its add-event by identity instead of fragile title/artist matching; (b) a new, **separate** `SyncLibraryAddEvent { track_id: string; added_at: string | null }` payload type, synced as a batch — separate from `SyncPayload` because add-events aren't tied to a set (`SyncPayload` is one-`PUT`-per-set, AD-4). `added_at` is `null` when `tadd`/`uadd` is unreachable (the existing ~6% Architecture Spine gap, epics.md's OQ#2) — never guessed.
5. **D-5 — New cloud table `library_track_events`**, `dj_id`-scoped, matching `sessions_sets_plays`'s exact RLS shape (denormalized `dj_id`, owner-`select`-only, no DJ write grant). **This is a second amendment to AD-8's "the agent's only write is the idempotent set sync," after AD-20's status heartbeat** — needs its own named, scoped exception the same way AD-20 got one, not a silent bypass. Task 8 below writes this back to the spine as a proposed **AD-21**. Idempotent upsert keyed `(dj_id, track_id)` — an add-event for a track already on file is a no-op, matching the sync layer's existing at-least-once discipline.
6. **D-6 — Cohort math computed in `web/`, not a cloud SQL view.** AD-1 says the cloud *may* SQL-reaggregate over synced rows; it doesn't say it must. Every existing Style Evolution / dashboard stat (`web/lib/sets/*.ts`) is a pure TS function over already-fetched records, not a DB view — matching that established convention beats introducing a second computation style for one story.
7. **D-7 — Reuses `TrendChart.tsx` (4.1), single-line rendering** — the same code path 4.1 uses for genre/key diversity, not a new component.
8. **D-8 — X-axis = month-added cohort** (reuse/extract 4.1's `localMonthKey`, don't duplicate it — if 4.1 hasn't factored it into a shared helper yet, this story does that extraction). **Y-axis = % of that month's added tracks played within a 90-day fixed window of being added** — deliberately the *same* 90-day window Story 4.3's FR-11 already locked (2026-07-21, Arjun), so the trend line and the future conversion-rate meter never disagree with each other over two different window lengths.
9. **D-9 — Cohort-recency honesty.** A cohort younger than 90 days hasn't finished its window; it's **omitted from the plotted line** entirely, never plotted as a misleadingly-low provisional number. Mirrors 4.1's D-8 "gap, not a fabricated value" rule.
10. **D-10 — Unknown-add-date disclosure.** Tracks with no resolvable `tadd`/`uadd` are excluded from the cohort math but their count is **always shown**, never silently dropped — same pattern Story 4.3's AC-4 will need for the identical underlying gap.
11. **D-11 — [ASSUMPTION — UX/PRD-sync owed] Renders as a 4th chip on the existing `/style-evolution` page, not on `/library-utilization`.** PRD groups FR-10 under §4.3 "Style Evolution" directly with FR-9 (`prd.md:211,217,224`), not under §4.4 "Library Utilization" (`prd.md:228`) where FR-11–13 live — despite the nav nomenclature and this story's own "library" framing suggesting the other page. `EXPERIENCE.md:73`'s Trend-chart row currently lists only BPM/genre/key and needs a fourth line added. Going with the PRD's own grouping over the nav label; flagging for Arjun to confirm rather than silently picking either page. `/library-utilization`'s throwaway stub (`web/app/(authenticated)/library-utilization/page.tsx`) stays untouched — it's owed to Story 4.3, not this one.
12. **D-12 — No scope split.** Despite touching agent + `shared/` + cloud + `web/`, Arjun chose to keep this as one story rather than an a/b split (contrast 2.3a–d, 2.9a–c, 3.3b).

## Acceptance Criteria

Extends epics.md Story 4.2 AC-1…AC-3 (epics.md:817-819); AC-4…AC-8 are new, closing the D-1/D-4/D-5/D-10 gaps.

1. **(extends epics AC-1)** Given library add-events captured go-forward (D-1/D-3) and play history, **Then** a trend line shows, per month-added cohort, the % of that cohort's tracks played within a 90-day fixed window of being added (D-8) — cohorts younger than 90 days are omitted, never shown as a fabricated low number (D-9). *(FR-10)*
2. **(extends epics AC-2)** Given the chart, **Then** it reuses `TrendChart.tsx` (D-7)'s single-line rendering path plus the Chart Summary generator pattern (visible caption + aria text + render-failure fallback, per `energyArc.ts`'s template) — no new chart component, no chip toggle (this is one metric, not three). *(UX-DR6, UX-DR7)*
3. **(extends epics AC-3)** Given fewer than 2 completed (≥90-day-old) monthly cohorts, **Then** the insufficient-history state renders, positive-framed, matching 4.1's register. *(UX-DR19)*
4. **(new, closes D-1)** Given an agent's first-ever run, **Then** the DJ's existing library is captured as a silent local baseline and **zero** add-events are synced for it — only tracks added on a **subsequent** scan generate an add-event. A DJ who has used Curfew for years never sees their entire back-catalogue appear as "added this month."
5. **(new, closes D-4)** Given a newly-detected library track, **Then** the agent syncs a `SyncLibraryAddEvent { track_id, added_at }` where `track_id` is `fnv1a_hex` of the portable path (D-2, never the raw path) and `added_at` is `null` (never guessed) when `tadd`/`uadd` is unreachable. `SyncPlay` gains the same `track_id` (optional, additive) so a play can join back to its add-event by identity.
6. **(new, closes D-5)** Given the cloud, **Then** `library_track_events` is `dj_id`-scoped with owner-only `select` RLS matching `sessions`/`sets`/`plays`'s existing policy shape, and an add-event write is idempotent on `(dj_id, track_id)`.
7. **(new, closes D-10)** Given tracks with no resolvable add-date, **Then** they are excluded from the per-cohort conversion math but their count is always disclosed alongside the chart, never silently folded in or dropped.
8. **(new, process)** Given this story ships, **Then** Story 1.10's Open Question #1 is marked resolved (pointing here) and `ARCHITECTURE-SPINE.md` gains the proposed AD-21 entry for the new sanctioned agent write (D-5) — a decision this consequential doesn't get made silently in code.

## Tasks / Subtasks

> Suggested order: agent library-diff/baseline → shared contract additions → cloud table/RLS → agent sync-queue wiring → web cohort lib → chart summary → chart wiring → doc writebacks → verification. Roughly mirrors 4.1's ordering, extended for the agent/shared/cloud layers 4.1 didn't need to touch.

- [x] **Task 1 — Agent: library-track baseline + go-forward diff** (AC: 1, 4, 5)
  - [x] New local SQLite table (`store.rs`, `CREATE TABLE IF NOT EXISTS` inline, no external migration tool — matching `captured_sessions`/`parse_failures`'s existing convention) tracking every known `track_id` (D-2) the agent has ever seen, with `first_seen_locally_at` and (if resolvable) `added_at`.
  - [x] Reuse the existing library-DB read already done for the `tadd`/`uadd` join (Story 3.7 §3d, `database V2` legacy + `master.sqlite`) — do not open a second connection/query path.
  - [x] `fn track_id(portable_path: &str) -> String` — thin wrapper over `fnv1a_hex` (`capture.rs:134`), reusing the existing hash rather than adding a new one.
  - [x] First-run detection: local table empty → insert every currently-known track ID as baseline, emit **zero** add-events (D-1). Unit test this explicitly — it's the single easiest way to get this story catastrophically wrong.
  - [x] Subsequent runs: diff current library track-ID set vs. the local table; a track ID not previously on file → emit `SyncLibraryAddEvent{track_id, added_at}` (Task 2's type) and insert into the local table so it's never re-emitted. `added_at = None` when `tadd`/`uadd` unreachable for that track (never guessed).
  - [x] Unit tests: first run seeds silently; a genuinely new track on a later scan emits exactly one event; re-scanning an unchanged library emits nothing; a track missing both `tadd`/`uadd` still emits an event with `added_at: None`.

- [x] **Task 2 — Shared contract additions** (AC: 5)
  - [x] `shared/src/index.ts`: add `SyncPlay.track_id?: string | null` (additive, optional — AD-15). Doc comment cross-referencing this story and Story 1.10's Open Question #1.
  - [x] New exported `SyncLibraryAddEvent { track_id: string; added_at: string | null }` — a **separate** type/payload from `SyncPayload`, not a field on it (`SyncPayload` is one-`PUT`-per-set per AD-4; add-events aren't set-scoped). Decide and document the batch envelope shape (e.g. `SyncLibraryAddEventBatch { events: SyncLibraryAddEvent[] }`) alongside a `SYNC_LIBRARY_ADD_EVENTS_SCHEMA_PATH` constant mirroring `SYNC_PAYLOAD_SCHEMA_PATH` (`index.ts:222`).
  - [x] New JSON schema file (mirrors `shared/schema/sync-payload.schema.json`'s existing structure/`additionalProperties: false` discipline) + wire it into the same additive-only CI guard pattern Story 1.10 built (`shared/src/additive-only.test.ts`) so this new type gets the same regression protection the frozen contract has.
  - [x] Unit tests in `shared/src/index.test.ts`: required/optional field shape for both the new `track_id` and `SyncLibraryAddEvent`.

- [x] **Task 3 — Cloud: `library_track_events` table + RLS** (AC: 6, 8)
  - [x] New Supabase migration: `library_track_events(dj_id uuid not null references public.djs(id) on delete cascade, track_id text not null, added_at timestamptz, unique(dj_id, track_id))` — `dj_id` denormalized directly on the row (not join-derived), matching `sessions_sets_plays`'s existing RLS-performance rationale (`20260730204057_create_sessions_sets_plays.sql:73-80`).
  - [x] RLS: `create policy "library_track_events_select_own" ... for select using (auth.uid() is not null and auth.uid() = dj_id)` — same shape as `sessions_select_own`/`sets_select_own`/`plays_select_own`. No DJ-facing INSERT/UPDATE/DELETE policy (write path is the sync mechanism only, same as `sets`/`plays`).
  - [x] Idempotent upsert on `(dj_id, track_id)` for the write path (Task 4) — a re-synced event for a track already on file is a no-op.
  - [x] pgTAP isolation test mirroring `supabase/tests/sessions_sets_plays_isolation_test.sql`'s pattern for the new table.

- [x] **Task 4 — Agent: sync-queue wiring for add-event batches** (AC: 5)
  - [x] Extend the existing durable local queue + `sync_loop` backoff (`sync_queue.rs`, Story 3.3's pattern) to also drain pending `SyncLibraryAddEvent` rows — same at-least-once/idempotent discipline, no second poll loop, no second backoff implementation.
  - [x] Confirms with D-5: this is a **second** amendment to AD-8's "agent's only write is the idempotent set sync" (after AD-20's heartbeat) — Task 8 below writes this back to the architecture spine rather than leaving it implicit in code.

- [x] **Task 5 — Web: cohort-computation pure lib** (AC: 1, 3, 7)
  - [x] New `web/lib/sets/libraryConversion.ts`, mirroring the existing `web/lib/sets/{hero,listModel,rightColumn,dancefloor,styleEvolution}.ts` convention: pure, deterministic, over already-fetched records, never mutating them (D-6).
  - [x] New data-access seam `getLibraryAddEvents()` next to `getRecentSets()` (`web/lib/sets/index.ts:36-38`) fetching the DJ's `library_track_events` rows.
  - [x] Reuse/extract 4.1's `localMonthKey` (`styleEvolution.ts`) rather than duplicating the month-bucketing logic — factor it into a shared helper if 4.1 hasn't already by the time this story branches.
  - [x] Per-month cohort: group add-events by `localMonthKey(added_at)`; for each cohort, join by `track_id` against synced `plays` to determine which were played within 90 days of `added_at` (D-8's window, matching FR-11's already-locked length). Cohorts where `now - cohort_month < 90 days` are omitted from output entirely (D-9) — not zero, not partial, simply not emitted.
  - [x] `no_add_date_count`: tracks with `added_at: null` tallied separately, always surfaced, never folded into the cohort denominator (D-10).
  - [x] Unit tests: cohort bucketing across a year boundary; the 90-day boundary itself (played on day 89 vs. day 91 of add); omission of cohorts inside their still-converting window; `no_add_date_count` disclosure; empty/no-events state.

- [x] **Task 6 — Web: Chart Summary generator** (AC: 2)
  - [x] One new generator following `energyArc.ts`'s `arcTextEquivalent` pattern (visible caption + aria text-equivalent + render-failure fallback, one function, three duties) — phrasing adapted to a conversion-rate trend (e.g. "62% of tracks added in March made it into a set within 90 days, up from 41% in January").

- [x] **Task 7 — Web: chart wiring** (AC: 1, 2, 3)
  - [x] **Blocks on 4.1 merging** — `TrendChart.tsx` must exist first. Add this metric as a 4th single-line rendering case, following whatever prop shape 4.1's chip-toggle already established for genre/key diversity.
  - [x] Per D-11 (flagged assumption, confirm with Arjun): render on the **existing** `/style-evolution` page as a 4th chip alongside BPM Range / Genre Diversity / Key Usage, not on `/library-utilization`. If Arjun overrides this, retarget to `/library-utilization` instead — leave that page's throwaway stub (`web/app/(authenticated)/library-utilization/page.tsx`) untouched either way; it's Story 4.3's to replace.
  - [x] Insufficient-history state per AC-3.
  - [x] Render failure falls through to the Chart Summary text (UX-DR19 `chart-failed` state, matching 3.8/4.1 precedent).

- [x] **Task 8 — Doc writebacks** (AC: 8)
  - [x] `ARCHITECTURE-SPINE.md`: add **AD-21** — the second sanctioned agent write (library-add-event batch sync), naming it explicitly the way AD-20 named the heartbeat exception, amending AD-8's "only write" rule text to reference it.
  - [x] `1-10-freeze-the-shared-sync-contract.md`'s Open Question #1: mark resolved, pointing at this story's D-2/D-4.
  - [x] `deferred-work.md:263`: annotate closed, same pointer.
  - [x] `EXPERIENCE.md:73`: add the 4th Trend-chart metric line (or note the page-placement question per D-11 if still unresolved at ship time).
  - [x] `sprint-status.yaml`: note that this story's `library_track_events` table + `track_id` field close Story 4.3's FR-11 denominator gap too, so 4.3's story-creation session doesn't need to independently rediscover the same problem.

- [x] **Task 9 — Verification & gates** (AC: all)
  - [x] Full gate: `agent` fmt/clippy `-D warnings`/test; `shared` build/typecheck/test (incl. the new additive-only guard case); `supabase db reset` + pgTAP (incl. the new isolation test); `web` lint/typecheck/test.
  - [x] Manual first-run verification against a fixture library: confirm zero add-events sync on initial baseline seed, and that a track added to the fixture *after* the baseline is captured produces exactly one event.
  - [x] Real-browser walkthrough (1440 + 375, per 3.6–4.1 precedent): chart renders on whichever page D-11 resolved to; insufficient-history state against a trimmed fixture; unknown-add-date count visibly disclosed; forced render failure falls through to Chart Summary text; zero console errors.

## Dev Notes

- **This story is not `web/`-only** (unlike 4.1) — it's the first Epic 4 story to touch `agent/`, `shared/`, and `supabase/` together since Epic 3. Budget accordingly; this is closer in shape to 3.7 (agent+web+cloud) than to a pure UI story.
- **Data sources:** library DB read already used for `tadd`/`uadd` (Story 3.7 §3d) — reused, not reopened. `SyncPlay.library_added_at` (existing, per-play) stays as-is; this story's new `track_id`/`SyncLibraryAddEvent` are additive alongside it, not a replacement.
- **Field/mechanism NOT to build:** a full historical library backfill. D-1's baseline-then-diff approach deliberately avoids ever reconstructing "when was everything already in my library added" — that's a materially harder, unbounded-scope problem this story does not take on. Go-forward only, matching Decision B's existing precedent for plays.
- **AD-8 amendment:** this is a real architecture-spine change (a second sanctioned agent write), not a routine additive field — Task 8 exists so it's recorded, not discovered later the way ai-6 flagged Decision A never propagating.
- **No change to `SyncPayload`'s existing shape or the `PUT /sets/:set_id` idempotency contract** — the new payload is a wholly separate sync path.
- **Reuse:** `fnv1a_hex` (`capture.rs:134`), the Story 3.3 offline-queue/backoff pattern, `TrendChart.tsx` + `localMonthKey` (4.1), `CursorChip` hover treatment, `format.ts` formatters where applicable.
- **D-11 is a flagged assumption, not a locked decision** — confirm page placement with Arjun before or during Task 7; everything else in this story is independent of which page it lands on.

### Project Structure Notes

- New: `web/lib/sets/libraryConversion.ts` (+ `.test.ts`); one new Chart Summary generator (co-located per Task 6); a new Supabase migration + pgTAP isolation test; `shared/schema/` gains a second schema file for `SyncLibraryAddEvent`.
- Updated (additive only): `shared/src/index.ts` (`SyncPlay.track_id`, new `SyncLibraryAddEvent`), `agent/src-tauri/src/store.rs` (new local table), `agent/src-tauri/src/capture.rs` (new `track_id` helper reusing `fnv1a_hex`), `agent/src-tauri/src/sync_queue.rs` (drains the new queue), `web/lib/sets/index.ts` (`getLibraryAddEvents()`), `web/app/components/style-evolution/TrendChart.tsx` (4th metric case — 4.1's file), `ARCHITECTURE-SPINE.md` (new AD-21).
- Unchanged: `SyncPayload`'s existing shape; `web/app/(authenticated)/library-utilization/page.tsx` (Story 4.3's to replace); `FloatingNav.tsx` (both routes already reserved by Story 3.5).
- Follows the existing `web/lib/sets/*` pure-function-over-fetched-records convention; the existing agent local-store `CREATE TABLE IF NOT EXISTS` convention (no external migration tool on the agent side); the existing Supabase RLS/isolation-test convention.

### References

- [Source: epics.md#Story 4.2, lines 809-819] — base ACs, FR-10/UX-DR6/DR7/DR19 citations.
- [Source: epics.md, lines 790-794] — Epic 4 overview, Decision B go-forward/copy-rule precedent this story extends to library adds.
- [Source: prd.md, lines 211-228] — FR-10's placement under §4.3 Style Evolution, not §4.4 Library Utilization (D-11).
- [Source: prd.md, line 239] — FR-11's 90-day rolling-window definition, reused verbatim for this story's cohort window (D-8).
- [Source: 1-10-freeze-the-shared-sync-contract.md, line 163] — Open Question #1, closed by this story.
- [Source: deferred-work.md, line 263] — the same deferral, annotated closed by Task 8.
- [Source: ARCHITECTURE-SPINE.md#AD-1, line 58] — edge-derives/cloud-may-SQL-reaggregate boundary (informs D-6's "web computes, not a cloud view" call — still legal either way, this just matches existing convention).
- [Source: ARCHITECTURE-SPINE.md#AD-3, AD-4, AD-15] — frozen-contract/idempotency/additive-only discipline this story's `shared/` changes must honor.
- [Source: ARCHITECTURE-SPINE.md#AD-8, line 102; AD-20, line 183] — "the agent's only write" rule and its one existing named exception — this story proposes a second (D-5, Task 8's AD-21).
- [Source: shared/src/index.ts, lines 76-128, 190-216] — `SyncPlay`, `SyncPayload`'s one-set-per-`PUT` shape (why the new payload is separate).
- [Source: agent/src-tauri/src/capture.rs, lines 134, 150-164] — `fnv1a_hex`, reused for track identity (D-2).
- [Source: agent/src-tauri/src/store.rs, lines 35, 57] — local SQLite `CREATE TABLE IF NOT EXISTS` convention.
- [Source: agent/src-tauri/src/sync_queue.rs] — durable local queue + backoff `sync_loop`, reused not duplicated.
- [Source: supabase/migrations/20260730204057_create_sessions_sets_plays.sql, lines 21-101] — RLS/table-shape pattern this story's `library_track_events` matches.
- [Source: 4-1-style-evolution-trend-view-excludes-low-confidence.md] — `TrendChart.tsx` (its D-3), `localMonthKey` (its Task 1), Chart Summary generator pattern (its Task 2), the D-8 "gap not fabricated value" precedent reused here as D-9.
- [Source: 3-3-offline-sync-queue.md] — the offline queue precedent this story's add-event sync reuses.
- [Source: EXPERIENCE.md, lines 73, 74, 91, 98] — Trend chart component pattern (D-11's gap), Chart Summary register, insufficient-history copy pattern, chart-failed fallback.
- [Source: web/app/components/nav/FloatingNav.tsx, lines 42-49] — both `/style-evolution` and `/library-utilization` routes already reserved (Story 3.5); D-11 decides which one this story targets.
- [Source: web/app/(authenticated)/library-utilization/page.tsx] — the throwaway stub this story does NOT replace.

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (`claude-opus-5`), dev-story session 2026-08-07, worktree `.claude/worktrees/story-4-1` (branch `story/4-1-style-evolution`) — Story 4.1's components already existed there, satisfying Task 7's stated dependency.

### Debug Log References

- **D-11 resolved live with Arjun (2026-08-07), in two steps.** Asked before Task 7 as the story required. Arjun first chose `/library-utilization`, then immediately asked "can we actually make it on the same graph as the others or is it too late?" — nothing chart-side had been built (only Tasks 1–2), so switching was free. Presented the constraint that mattered: sharing the chart component and page is fine, but the two cannot be overlaid as two lines on one plot, because this metric's x-axis is *months tracks were added* while the other three are *months sets were played*, and this line always stops ~90 days short of the others. Arjun chose **4th chip on `/style-evolution`** — the story's own PRD-grounded default. `/library-utilization`'s stub is untouched, as the story specified for that branch.
- **pgTAP first run failed on 2 assertions, both mine, neither a code defect:** a hand-computed expected timestamp (epoch `1772323200` is `2026-03-01T00:00:00Z`, not the `2026-02-28T22:40:00Z` I wrote) and a `plan(20)` against 23 actual tests. Fixed the test file; the migration and RPC were correct as written.
- **`react-hooks/purity` rejected `Date.now()` in the server component.** Moved the clock read behind the data seam as `getLibraryAddEvents(): { events, readAtMs }`, mirroring `getAgentStatus`'s existing `{ row, readAtMs }` shape — which is also what keeps `buildLibraryConversion` deterministic (Story 4.1's review lesson).
- **Real-browser walkthrough** (Playwright, real dev server, 1440x900 and 375x812): 4th chip renders; granularity toggle + low-confidence reveal correctly hidden for this metric; fixed 0/50/100% axis; `aria-label` byte-identical to the visible caption in every branch; D-10 disclosure visible ("711 tracks have no known add date, and 1 recent month is still inside the 90-day window — not counted here"); insufficient-history state verified against an emptied fixture; render-failure verified by injecting a forced throw, which fell through to the Chart Summary with the identical string and reset cleanly on the next chip switch; all four metrics switch both directions with no stuck error boundary; zero console errors or warnings; no horizontal overflow at either width; y-axis labels clear of the leftmost data column at 375px (right edge 64px vs. first dot at 65px).

### Completion Notes List

**All 9 tasks complete; all 8 ACs satisfied. Full gate green:** agent 373 tests + `cargo fmt --check` + `clippy -D warnings` clean; `shared` 30 tests + clean `tsc`; `supabase db reset` + **119 pgTAP tests pass**; `web` 263 tests + clean `tsc` + clean `eslint` + clean `next build`.

Net new tests: 9 (agent capture/library-scan) + 5 (agent add-event sync) + 6 (shared) + 26 (web cohort lib) + 23 (pgTAP) = **69**.

**Decisions taken beyond the story's own D-1..D-12, flagged for review rather than buried:**

1. **A late-mounting volume is D-1's trap in a second shape, and gets the same answer.** D-1 covers the first run. It does not cover the DJ whose USB was unplugged when the baseline was taken and who plugs it in a month later — that volume's entire contents are new to the local store and would have flooded a single cohort with years of digging, breaking D-1's own stated promise ("a DJ who has used Curfew for years never sees their entire back-catalogue appear as added this month"). `scan_library_adds` therefore also seeds silently any track whose own `tadd`/`uadd` **predates the baseline timestamp** — it demonstrably existed before Curfew first looked. This uses the library's own recorded date, never a guess. A track with *no* resolvable date is still emitted (it carries no cohort weight by D-10, and suppressing it would hide the very count D-10 exists to disclose). Covered by `a_late_mounting_volume_seeds_silently_rather_than_flooding_a_cohort`.
2. **Cohort completeness is measured from the END of the month, not its start.** The story's D-9 phrasing is "cohorts where `now - cohort_month < 90 days`". Read literally from the month's start, a track bought on March 31st would be scored a failure in late June having had only ~80 days. Implemented as `end-of-month + 90 days`, so a plotted cohort is one where *every* track had its full window. Strictly more conservative; covered by `measures_completeness_from_the_END_of_the_month_not_its_start`.
3. **The cloud write is `on conflict do nothing`, not `do update`.** AC-6 says "idempotent upsert". A literal `do update` would let a re-scan taken with a drive unmounted overwrite a resolved `added_at` with `null` — losing real data to a redelivery. First-write-wins is enforced at the DB boundary, not left to caller discipline. Covered by pgTAP Case 6c.
4. **Conversion counts a track's EARLIEST play, and only plays at-or-after the add date.** A track first played two years late does not become a conversion because it was also played last week; and a play *predating* its add date is a catalogue inconsistency, not a conversion, so counting it would inflate the rate using data that says the opposite of the claim.
5. **`localMonthKey` was imported from `styleEvolution.ts`, not extracted into a new shared module.** Task 5 says "reuse/extract... factor it into a shared helper if 4.1 hasn't already". 4.1 already exports it, tested, so the anti-duplication intent is met; splitting a cohesive shipped module for one import seemed worse than the import. Flagging in case the extraction was actually wanted.
6. **The library metric hides the granularity toggle and the low-confidence reveal.** Cohorts are month-only and an add-event is not a set, so neither control has anything to act on. Hidden rather than disabled — an inert visible control is worse than an absent one.
7. **Fixture identity is a documented stand-in.** The wire shape deliberately carries no path, so `build-library-fixture.mjs` hashes `title|artist` with the same FNV-1a algorithm the agent uses on the portable path. Both sides of the join use it, so the fixture is internally consistent; it is replaced wholesale when the real cloud read lands. **Known bias, stated in the builder's header:** the fixture can only see tracks that were *played*, so rates read systematically high (several cohorts at 100%) — the shape varies usefully (18/39/47/72/98%) and exercises the chart honestly, but the *level* is not a product signal yet.

**Two findings logged to `deferred-work.md` rather than fixed here:**

- **A pre-existing Story 4.1 accessibility regression, found during this story's 375px pass.** The chart explainer's tap target measures exactly 24x24 (4.1's `::after` fix is correctly *sized*), but corner hit-testing shows only the top-left corner actually reaches the button — `.se-chart-head` and `.se-chart-hit` cover the other three, so WCAG 2.2 AA SC 2.5.8 is not actually met. **Reproduced identically on the Genre Diversity chip, which 4.2 never touched**, which is what identifies it as 4.1's defect rather than this story's. Not fixed here: it is 4.1's component, the fix is a stacking change to shipped code outside 4.2's ACs, and a silent drive-by edit under a different story is the exact pattern the Epic 3 retro flagged.
- **A one-track cohort plots with the same weight as a 256-track cohort** (`2026-04` at 100% sits beside `2025-04` at 18%). Same failure shape as 4.1's most-played "2-play track from a soundcheck", and the same fix would work — a minimum cohort size — but choosing that threshold is a product call, so this story did not invent one. Worth settling before Story 4.3 reads the same cohorts.

**Post-review additions (2026-08-07, same session, both at Arjun's direction):**

- **D-13 — conversion-window toggle (90/60/30).** Asked for directly ("similarly to how the bpm graph has a week and month toggle"). All three windows are precomputed in one pass so switching is a lookup, not a recompute (`styleEvolution`'s own no-work-on-click discipline). **90 remains the default and D-8's rationale is untouched** — it is the length FR-11 locked, so the trend a DJ meets first and Story 4.3's meter still cannot disagree; 60/30 are an exploration affordance layered on top, which is why the active window is named in the caption, the subtitle, the explainer and the disclosure line rather than left implicit. Two intended effects: rates fall (a day-75 play counts at 90, not at 60), and the line gets *longer* (a cohort needs only its own window to complete, so shorter windows score more recent months). 9 new tests including rate monotonicity across windows and denominator-invariance. Occupies the slot the week/month toggle vacates for this metric.
- **Real library export built** (`agent/src-tauri/tests/export_real_library.rs`), replacing the play-derived fixture stand-in. Env-gated and `#[ignore]`d exactly like `export_real_fixtures.rs`, read-only, and it emits **opaque ids only, never paths** — it calls the very same `DateAddedIndex::all_tracks()` the shipping add-scan calls, so anything it sees the agent would have too. Run against Arjun's real library: **930 tracks, 100% date coverage, spanning 2022-02 → 2026-06.** `build-library-fixture.mjs` now consumes it and simulates the D-1 go-forward frame with a configurable install date (default 2025-01-01, matching where the play fixture's history begins): 216 tracks baselined silently, **714 add-events of which 571 were never played.** That is a real denominator — the committed chart now reads 0% → 11% → 3% → 50% → 32% → 88% → 78% instead of a wall of 100%s. `build-fixture.mjs` also now carries the agent's real path-derived `track_id` straight off the export, so both halves share one identity space.

**Open for Arjun:** AD-21 is recorded as `[PROPOSED]` in `ARCHITECTURE-SPINE.md`, matching how AD-20 was introduced. It needs ratification to `[ADOPTED]` — it is the third sanctioned agent write, and AD-8's rule text now says explicitly that an unnamed fourth is a violation rather than a precedent.

**Note for Story 4.3:** the sprint-status entry now lists exactly what 4.3 inherits already-built (table, RPC, `plays.track_id`, the data seam, `libraryConversion.ts` with the shared 90-day window, the D-10 disclosure) and what it still owes (the pip meter, and the `/library-utilization` page itself, still a Story 3.5 stub).

### File List

**Agent (`agent/src-tauri/`)**
- `src/store.rs` — new `library_tracks` local table + `PendingLibraryAddEvent`, `library_track_count`, `known_track_ids`, `library_baseline_at`, `record_library_tracks`, `library_add_events_pending_sync`, `mark_library_add_events_synced`; `CapturedPlay.track_id`
- `src/capture.rs` — `track_id()`, `portable_form()`, `LibraryScanOutcome`, `scan_library_adds()`; `track_id` populated on both source paths; 9 new tests
- `src/joiner/legacy.rs` — `LegacyLibrary::entries()` (whole-catalogue read)
- `src/joiner/date_added.rs` — `DateAddedIndex::all_tracks()`, `is_loaded()`, `ensure_loaded()`
- `src/sync.rs` — `LibraryAddEventClient` trait + `SupabaseSyncClient` impl, `SyncLibraryAddEventWire`, `AddEventSyncSummary`, `sync_pending_library_add_events()`, `ADD_EVENT_BATCH_SIZE`; 5 new tests
- `src/sync_queue.rs` — `drain_library_add_events()` wired into the existing `sync_loop`
- `src/watcher/mod.rs` — add-scan wired to the end of the watch-loop iteration; `dates` threaded into `advance_legacy`/`recheck_legacy_quiet_periods`; `now_unix()`
- `src/backfill.rs` — `CapturedPlay` literal updated for the new field

**Shared (`shared/`)**
- `src/index.ts` — `SyncPlay.track_id`, `SyncLibraryAddEvent`, `SyncLibraryAddEventBatch`, `SYNC_LIBRARY_ADD_EVENTS_SCHEMA_PATH`
- `schema/sync-library-add-events.schema.json` *(new)* + `schema/sync-library-add-events.schema.frozen-baseline.json` *(new)*
- `schema/sync-payload.schema.json` — `play.track_id`
- `src/additive-only.test.ts` — generalized to a `SCHEMA_PAIRS` table so the new schema gets the same CI guard, plus a self-test proving the guard actually rejects a narrowing
- `src/index.test.ts` — 6 new tests
- `package.json` — new schema export

**Cloud (`supabase/`)**
- `migrations/20260807100000_create_library_track_events.sql` *(new)* — table + index + RLS + `sync_library_add_events` RPC; `plays.track_id` + index; `sync_set` replaced to carry it
- `tests/library_track_events_isolation_test.sql` *(new)* — 23 pgTAP assertions

**Web (`web/`)**
- `lib/sets/libraryConversion.ts` *(new)* — cohort model + Chart Summary generator + disclosure generator
- `lib/sets/libraryConversion.test.ts` *(new)* — 26 tests
- `lib/sets/build-library-fixture.mjs` *(new)* — fixture derivation
- `lib/sets/library-add-events.fixture.json` *(new)* — 1,285 add-events (574 dated, 711 undated)
- `lib/sets/recent-sets.fixture.json` — `track_id` stamped onto all 2,294 plays
- `lib/sets/build-fixture.mjs` — header note on the required second pass
- `lib/sets/index.ts` — `getLibraryAddEvents()` + `LibraryAddEventSnapshot`
- `app/components/style-evolution/TrendChart.tsx` — `"library"` metric: series, `PCT_DOMAIN`, caption, subtitle/explainer, percent axis, hover chip
- `app/components/style-evolution/MetricChipToggle.tsx` — 4th chip
- `app/components/style-evolution/StyleEvolutionView.tsx` — library model, cohort buckets, per-metric controls + disclosure
- `app/components/style-evolution/InsufficientHistory.tsx` — optional `copy` prop + `LIBRARY_INSUFFICIENT_COPY`
- `app/(authenticated)/style-evolution/page.tsx` — reads the new seam, builds the model, updated subtitle

**Docs (`_bmad-output/`)**
- `planning-artifacts/architecture/.../ARCHITECTURE-SPINE.md` — **AD-21 `[PROPOSED]`**; AD-8 amended
- `planning-artifacts/ux-designs/.../EXPERIENCE.md` — 4th Trend-chart metric + a Library-conversion row
- `implementation-artifacts/1-10-freeze-the-shared-sync-contract.md` — Open Question #1 marked RESOLVED
- `implementation-artifacts/deferred-work.md` — the 1.10 identity-field entry CLOSED; two new 4.2 entries
- `implementation-artifacts/sprint-status.yaml` — 4-2 in-progress→review, expanded 4-3 inheritance note, `last_updated`
- `implementation-artifacts/4-2-library-to-setlist-correlation-trend.md` — this record
