---
baseline_commit: ec15b20f81631f310e5a95f598995f43c0a265a8
---

# Story 4.4: Aging shelf

Status: done

<!-- Filename/story key keep the historical `-with-prep-crate-action` suffix for tracking continuity. The action itself is OUT — ruled by Arjun 2026-08-08, see Context & Authority §1. -->

## Story

As a DJ,
I want a list of my library tracks that have gone unplayed for 3+ months, sortable by days unplayed,
so that neglected tracks resurface instead of disappearing into a catalogue I never scroll.

## Context & Authority

Read this whole section before writing code. Five things in it override what `epics.md` currently says.

### 1. THE PREP-CRATE ACTION IS OUT OF MVP — ruled by Arjun, 2026-08-08

`epics.md` Story 4.4 AC-2, PRD FR-12's UJ-6 path, and `EXPERIENCE.md`'s Components row all describe a row-level **"add to prep crate"** action. **Do not build it.** Arjun ruled it out of MVP during this story's creation session.

The finding that forced the question, recorded so it is not re-derived: **there is no cloud→agent command channel anywhere in this system.** The agent only ever pushes — AD-8 plus its three named write amendments (AD-20 heartbeat, AD-21 add-events, AD-22 roster) are all outbound. Nothing pulls instructions down. A real Serato crate write would also be the first-ever *write* to Serato (Story 2.7 scopes the agent's filesystem capability to reads), against a binary `.crate` format, with file-locking hazards while Serato is running. That is its own story or epic, not a task inside this one. The two cheaper substitutes considered and also declined for MVP: a Curfew-side saved list in Supabase, and an `.m3u8` export (weak anyway — AD-2 keeps file paths off the wire, so the roster is title/artist only and Serato would have to re-match on import).

**Consequence you must handle honestly, not paper over:** UX-DR12 calls this action "the one place the product nudges toward an action, not just a report," and without it the shelf *is* the report. Do not invent a substitute affordance to fill the gap — no "mark as reviewed," no dismiss, no star. Ship the list. Rows are non-interactive.

### 2. The clock is clamped — this is the whole Decision B fix

`epics.md`'s re-spec block (2026-08-08) is authoritative:

> **Fix: clamp the "days unplayed" clock to `max(add_date, subscription_start_date)` instead of raw `add_date`.**

Why, restated so the implementation cannot drift: Decision A means Curfew only ever observes plays *going forward*. A veteran's track added in 2019 and played every weekend — but not yet in a Curfew-captured set — would otherwise read "2,400 days unplayed." That is the "reads all-aging" failure Decision B flags. A track's shelf age must never be older than however long Curfew has actually been able to watch it go unplayed.

Two branches, and only one clamps:

| Branch | Condition | Days unplayed measured from |
| --- | --- | --- |
| **Observed** | the track has ≥1 play in a Curfew-captured set | that track's **latest play**, exactly as-is. No clamp — an observed play is a fact, not an inference. |
| **Fallback** | no observed play at all | **`max(added_at, observationStartMs)`** |

Unlike Story 4.5 — which fixed its Decision B problem by *excluding* the pre-subscription population — the aging shelf must cover the DJ's **entire** library, baseline (pre-install) tracks included. Excluding them would gut the feature rather than fix it. That is precisely why Story 4.11 shipped the roster carrying `is_baseline` rows.

**`is_baseline` is NOT a branch condition.** `max()` handles both populations uniformly: a post-install add already has `added_at >= observationStart`, so the clamp is a no-op there. Do not write `if (entry.is_baseline)` anywhere in this model.

### 3. `observationStartMs` = `djs.created_at`, and its failure mode is fail-closed

The re-spec names `subscription_start_date`. The only cloud-side anchor for it is **`djs.created_at`** — one row per DJ, `timestamptz not null default now()`, already owner-`SELECT` via RLS (`20260726012050_create_djs_table.sql`). There is no other candidate:

- `library_roster.created_at` is **wrong** — the roster only began syncing when 4.11 shipped, so for a DJ who installed months earlier it reads as "Curfew started watching last Tuesday" and clamps the entire shelf to empty.
- earliest `sessions.started_at` is **wrong** — a DJ who has synced no sets has none, and that is exactly the DJ this metric is about.

**Known imprecision, accepted, state it in Dev Notes rather than fixing it:** signup precedes agent install, so a DJ who signs up and installs a week later gets up to a week of "unplayed" time Curfew could not actually observe. It errs toward showing *more* age, not less, and Epic 2's onboarding drives install straight off signup. Not worth a second anchor.

**Fail-closed rule (binding).** If `observationStartMs` cannot be read — RLS failure, missing row, network — the **fallback branch is suppressed entirely** and only tracks with a real observed last play can appear on the shelf. It must **never** degrade to raw `added_at`; that is the exact failure this clamp exists to prevent, and a silent degradation would ship the pre-fix behaviour under a story that claims to have fixed it.

### 4. The cold-start state the epic does not name — you must build it

**A brand-new DJ's shelf is structurally empty, and the existing empty-state copy is a lie in that state.** Both branches are bounded below by `observationStartMs`, so if Curfew has been watching for less than 90 days, **no track can possibly qualify**. `EXPERIENCE.md`'s aging-shelf-empty copy — *"Everything you've bought is getting played."* — would be an affirmative false claim to every DJ in their first three months, which is every DJ at launch.

Three distinct terminal states, never collapsed into two:

| State | Condition | Register |
| --- | --- | --- |
| **Not yet possible** | `now − observationStartMs < 90 days` | Positive-framed *wait*, per UX-DR19's insufficient-history pattern. Says nothing about whether tracks are getting played, because nothing is known yet. |
| **Genuinely clear** | observation ≥ 90 days **and** zero qualifying tracks | `EXPERIENCE.md`'s existing aging-shelf-empty copy. Only here is it true. |
| **Nothing synced** | roster is empty (no agent has ever synced a roster) | The day-one empty shape — same contract every other module on this page honors (Story 4.6 AC-3). |

### 5. Tier A only — the rows carry title and artist, and nothing else

`library_roster` is **Tier A**: `track_id`, `title`, `artist`, `added_at`, `is_baseline`, `absent_at`. BPM, key and genre are **Tier B and explicitly parked** (AD-22, Story 4.11's central cost decision). A shelf row is *title — artist — days unplayed*. **Do not add BPM/key/genre columns to the roster table, the roster sync payload, or this UI**, and do not reach into `plays` to synthesize them for the subset that happens to have been played — that would render a shelf where some rows have tags and most do not, which reads as broken data rather than a deliberate scope.

## Acceptance Criteria

1. **Given** library tracks unplayed 3+ months — measured from the real last-play date when one exists, or from **`max(added_at, observationStartMs)`** when falling back to add date — **Then** they render in the aging shelf, sorted by days unplayed. *(FR-12, UX-DR12; clock per Context §2/§3)*
2. **Given** the shelf, **Then** it is sortable by days unplayed in both directions, defaulting to longest-unplayed first. *(FR-12 "sortable by days-unplayed")*
3. **Given** a shelf row, **Then** it is a **read-only** row showing title, artist and days unplayed — **no prep-crate action, and no substitute affordance in its place**. *(Ruled 2026-08-08, Arjun — supersedes `epics.md` AC-2, PRD FR-12's UJ-6 path, and `EXPERIENCE.md`'s Components row; see Context §1)*
4. **Given** Curfew has been observing for **less than 90 days**, **Then** the "not yet possible" state renders — **never** the "everything you've bought is getting played" copy, which would be an affirmative false claim about a library Curfew has not watched long enough to judge. *(Context §4; UX-DR19)*
5. **Given** observation ≥ 90 days **and** nothing qualifies, **Then** `EXPERIENCE.md`'s positive-framed aging-shelf-empty copy renders. *(UX-DR19 aging-shelf-empty)*
6. **Given** tracks whose raw `added_at` is within the last **30 days** with no observed play, **Then** the recently-downloaded nudge state renders as a **count line on this module**, computed from **raw `added_at`, not the clamped clock** — a real fact about the DJ's library, not an inference about observation. *(UX-DR19; 30-day threshold is `[ASSUMPTION]`, PRD-sync owed — see Open Questions)*
7. **Given** a roster entry with **no `added_at`** and **no observed play**, **Then** it renders in a distinct **"Unknown add-date"** group — never silently omitted, never defaulted into a sort position, never counted into the aging total. *(Architecture Spine OQ#2; SM-C1; AD-11)*
8. **Given** a roster entry with `absent_at` set, **Then** it is **excluded** from every count and every list on this module — the DJ deleted it, and recommending a deleted track is the failure AD-22's soft-delete exists to prevent. *(AD-22; Story 4.11 AC-5)*
9. **Given** more qualifying tracks than the module renders, **Then** the cap is **stated out loud** — the full qualifying count and the number shown — never a silently truncated list that reads as the whole answer. *(SM-C1 "no silent caps"; the `no_genre_count` never-omitted contract)*
10. **Given** `getLibraryRoster` currently returns the hardcoded day-one empty shape, **Then** it reads `library_roster` from Supabase with the **same paging discipline** `getLibraryAddEvents` uses, and returns the empty shape rather than throwing on failure or on a brand-new account. *(Story 4.6 AC-3/AC-4; the seam's own doc comment names this story as the owner of that read)*
11. **Given** `observationStartMs` cannot be read, **Then** the fallback branch is suppressed and only observed-last-play tracks can age — **never** a degradation to raw `added_at`. *(Context §3, fail-closed)*
12. **Given** 375px and 320px, **Then** the shelf holds with no horizontal overflow and every interactive target (the sort control) meets WCAG 2.2 AA SC 2.5.8's 24×24 minimum, **measured against the DOM in a real browser, not eyeballed from a screenshot**. *(4.1's review lesson; UX-DR21, UX-DR22)*
13. **Given** the shelf, **Then** it carries a text equivalent for assistive tech naming what the list is and how many tracks are on it, in the same register `TimeToFirstPlay`'s `aria-label` already uses. *(UX-DR7, UX-DR21)*

## Tasks / Subtasks

> Layer order matches 4.2/4.3/4.11: seam → pure model → component → page wiring → browser pass → docs. Tasks 1 and 2 are independently testable before any UI exists.

- [x] **Task 1 — Seam: make `getLibraryRoster` real, and add the observation-start read** (AC: 8, 10, 11)
  - [x] `web/lib/sets/index.ts`: replace `getLibraryRoster`'s hardcoded `{ entries: [], excludedNoIdentityCount: 0, totalCatalogueRows: 0 }` with a **paged** select from `library_roster` — copy `getLibraryAddEvents`'s loop exactly (`MAX_ROWS_PER_PAGE` 1000, `MAX_PAGES` 50, `.order("track_id", { ascending: true })`, return `{ entries: [] , … }` on error rather than the partial pages already collected). PostgREST silently caps an unbounded select at `max_rows` with HTTP 200 and `error: null`; a truncated roster renders a confidently short shelf.
  - [x] Select `track_id, title, artist, added_at, is_baseline, absent_at`. Filter `absent_at is null` **server-side** (`.is("absent_at", null)`) — the `library_roster_dj_id_absent_at_idx` index exists for exactly this predicate, and filtering server-side is what makes the paging cap count present tracks rather than burning pages on deleted ones (AC-8).
  - [x] **Do not touch `excludedNoIdentityCount`/`totalCatalogueRows`.** Leave them `0`. They are scan-level scalars with **no cloud carrier at all** — `library_roster` is per-track (wrong shape) and AD-20's heartbeat carries no derived Serato data. `store::scan_identity_coverage` computes them agent-side with no caller. Making them live needs a named decision (an additive AD-22 RPC argument, or `agent_status` columns) and is tracked in `deferred-work.md`. Do not invent a carrier here.
  - [x] Add `getObservationStart(): Promise<number | null>` — reads `djs.created_at` (`.select("created_at").maybeSingle()`), returns epoch ms, or `null` on any failure/missing row. Same shape as the other reads: lazy `@/lib/supabase/server` import, try/catch, dev-only `console.error`, calm fallback. Its doc comment must state the fail-closed contract (AC-11) and the signup-vs-install imprecision (Context §3) so the next reader doesn't "fix" it into a raw-`added_at` fallback.
  - [x] Export `getObservationStart` from the seam's public surface alongside the existing five functions.
  - [x] Extend `index.test.ts` with the new read's empty-account, paging and failure paths, matching how `getLibraryAddEvents` is covered there.

- [x] **Task 2 — Model: `web/lib/sets/agingShelf.ts`** (AC: 1, 2, 6, 7, 8, 9, 11)
  - [x] New pure module, same convention as `libraryConversion.ts`/`libraryRoster.ts`: deterministic over already-fetched records, clock injected as `nowMs`, **never** `Date.now()` inside.
  - [x] `buildAgingShelf(entries: LibraryRosterEntry[], observationStartMs: number | null, nowMs: number, plays: Map<string, number[]>): AgingShelfModel`. Take the **shared page-level play index** (`playsByTrack`) as a parameter — the page already builds exactly one and shares it across three modules; building a fourth would be both a wasted pass and the shape that produced the earlier global-earliest-play bug.
  - [x] Per entry, in this order: skip if `absent_at != null` (AC-8) → if `added_at == null` **and** no plays, classify `unknown-add-date` (AC-7) → if plays exist, `daysUnplayed` from `max(plays)` unclamped → else if `observationStartMs == null`, **drop** (AC-11) → else `daysUnplayed` from `max(addedMs, observationStartMs)`.
  - [x] `AGING_THRESHOLD_DAYS = 90`. **90 days, not "3 calendar months"** — every other window in Epic 4 is a day count (`CONVERSION_WINDOWS` 60/30/14), and a calendar-month definition drifts by up to 3 days depending on the start month. State the choice in the constant's doc comment so it is not re-litigated.
  - [x] `RECENT_DOWNLOAD_DAYS = 30` (AC-6), computed off **raw `added_at`** with no clamp, over entries with no observed play. Mark it `[ASSUMPTION]` inline, pointing at the PRD-sync owed below.
  - [x] Guard a future-dated `added_at` (`addedMs > nowMs`). **Follow the disposition ruled for the page's other three modules, not a fourth new one** — `deferred-work.md`'s "three-way future-dated disposition" entry is open and explicitly asks for ONE ruling applied consistently. If it is still unruled when you start, count it into the unknown/unreconciled disclosure rather than dropping it silently, and say so in Completion Notes.
  - [x] Model returns at minimum: `rows` (sorted, capped), `qualifyingCount` (uncapped), `unknownAddDateCount`, `recentlyDownloadedCount`, and enough for the component to pick between AC-4/AC-5/day-one states without re-deriving anything.
  - [x] `SHELF_ROW_CAP = 100` (AC-9). A 5,000-track library with a cold catalogue puts thousands of rows on this page; render the longest-unplayed 100 and expose `qualifyingCount` so the component can state the cap. Sorting happens **before** the cap, in both directions, so the ascending sort surfaces the *shortest*-aging 100 rather than reversing the same 100 — a reversed slice would be a different, silently wrong list.
  - [x] `agingShelf.test.ts`: the clamp on both branches; `is_baseline` true and false producing identical behaviour at the same dates (proving §2's no-branch rule); `observationStartMs == null` suppressing the fallback but keeping observed rows (AC-11); the `absent_at` exclusion (**this is the first web-side coverage the soft-delete has ever had** — `deferred-work.md` flags it as the half of 4.11 most likely to be wrong, inherited by this story); unknown-add-date classification; the 90-day boundary exactly at 89/90/91 days; the cap applying after the sort in both directions.

- [x] **Task 3 — Component: `web/app/components/library-utilization/AgingShelf.tsx`** (AC: 2, 3, 4, 5, 6, 7, 9, 13)
  - [x] Match `TimeToFirstPlay.tsx`'s shell exactly: `<section className="lu-module dz-shell" aria-label={summary}>`, `<span className="dz-dots" aria-hidden />`, `<div className="lu-stat-head"><p className="lu-stat-label">…`. Do **not** invent a second module chrome.
  - [x] Rows are **non-interactive** (AC-3). The sort control is the module's only interactive element.
  - [x] Sort control: minimal two-state toggle (longest-unplayed ⇄ shortest-unplayed). **Do not add title/artist sort columns** — FR-12 says "sortable by days-unplayed" and nothing more; extra sorts are unrequested scope.
  - [x] Sort state makes this a client component. **Follow the house convention** the two existing window controls use (`useSyncExternalStore` + `localStorage`) if the selection should persist — and note that `deferred-work.md` already ruled the shared boilerplate **not** worth extracting at two copies; a third copy is the point at which that ruling should be re-checked, not silently ignored. If you decide not to persist, say why in Dev Notes.
  - [x] Three terminal states per Context §4, using `InsufficientHistory` for the "not yet possible" wait state (the component the page's other modules already use). **Pass a `copy` prop** — its default is Style Evolution's "Two more sets and Style Evolution has something to show you," which is the wrong page and the wrong wait. Write the copy in the register `libraryInsufficientCopy` established: name the clock, because "not enough data" with no reason reads as a bug while naming the wait reads as a promise. **Do not** state the wait as elapsed subscription time — Decision B's copy rule is binding ("since you joined" is a self-installed churn button). For the genuinely-clear state use `EXPERIENCE.md`'s existing copy **verbatim**.
  - [x] Unknown-add-date group (AC-7) renders as its own labelled block below the list, never interleaved into the sorted rows.
  - [x] Cap disclosure (AC-9) and the recently-downloaded count (AC-6) render as `lu-disclosure` lines, matching the page's existing disclosure register.
  - [x] a11y (AC-13): `aria-label` states what the list is and its size, in `TimeToFirstPlay`'s register. **Check the accessible name against the visible state** — 4.5's review found a section announcing a figure the UI had explicitly declined to state. If the module is in a gated state, the label must not claim a number.
  - [x] **Read `deferred-work.md`'s open UI finding before adding markup:** `/library-utilization` has **no `<h2>` at all** and already nests three landmark regions. Do not add a fourth bare `<section aria-label>`. Prefer a real `<h2 className="lu-stat-label">` here; if you use `<section>`, note it against that open finding rather than deepening it silently.

- [x] **Task 4 — Page wiring: `web/app/(authenticated)/library-utilization/page.tsx`** (AC: 1, 10, 11)
  - [x] Add `getObservationStart()` to the existing `Promise.all` alongside `getRecentSets`/`getLibraryAddEvents`/`getLibraryRoster`.
  - [x] Build the model with the **existing** `playIndex` and the **existing** `addEvents.readAtMs` clock. Do **not** call `Date.now()` in the page — the clock comes from the data seam (Story 4.1's review lesson; `react-hooks/purity` rejects it besides).
  - [x] Place `<AgingShelf>` as a **sibling below `<TimeToFirstPlay>`**, outside `LibraryUtilizationView`. The shelf has no trailing window, so nesting it under the shared conversion dropdown would put a window-independent figure under a control that visibly does not move it — the inverse of the failure 4.7 AC-3 exists to prevent. `LibraryUtilizationView`'s own doc comment says further modules grow below it. Keeping it outside also keeps the page a server component boundary-wise.
  - [x] Leave the trailing `{undatedNote && …}` disclosure **last** on the page — it speaks for the modules above it.
  - [x] **Do not wire `library_roster.added_at` or `is_baseline` into any conversion computation.** `library_track_events` remains the only cohort denominator (AD-22, Story 4.11 AC-3). A baseline track's real pre-install add-date reaching cohort math retroactively populates old months against a still-go-forward numerator and silently changes numbers the DJ has already seen.

- [x] **Task 5 — Styles: `web/app/library-utilization.css`** (AC: 12)
  - [x] `lu-`-prefixed additions only, Obsidian tokens only — `no-hardcoded-colors.test.ts` is a live gate.
  - [x] Note the existing `.lu > .lu-module { max-width: 440px }` repair rule and `.lu-module .se-empty { min-height: 0 }` — both are in `deferred-work.md` as **unverified in a browser**. A row list is the first `.lu-module` content that is not a single stat readout; check both against it rather than assuming they hold.

- [x] **Task 6 — Browser pass** (AC: 4, 5, 12)
  - [x] Real browser against a live dev server at **1440 / 375 / 320px**. Measure the sort control's tap target **against the DOM** (`getBoundingClientRect`), not from a screenshot — 4.1 and 4.7 both shipped sub-24px targets that survived visual review.
  - [x] Zero console errors/warnings. If you see a hydration warning, root-cause it before dismissing it: 4.7 found a genuine SSR/browser float mismatch, and 4.3 found a browser-extension false positive. Both were real diagnoses, not assumptions.
  - [x] **Exercise the gated states deliberately.** The roster is empty in production today and `noAddDateCount` has been 0 in every fixture, so AC-4/AC-5/AC-7 will render nothing on real data — drive them from `library-roster.fixture.json` (already committed, 653 entries) or a local stub. `deferred-work.md` records that the undated-disclosure state "has never rendered anywhere"; do not repeat that with this story's three.
  - [x] This is also the first browser pass on the **merged four-module composition** of `/library-utilization` — `deferred-work.md` records that even the current three have never been seen together. Note what you find.

- [x] **Task 7 — Docs and spec sync**
  - [x] `epics.md` Story 4.4: AC-2's prep-crate action is already annotated with the 2026-08-08 ruling — confirm it still matches what shipped and extend if you diverged.
  - [x] **PRD-sync owed, do not let it accrete (the ai-2/ai-6 failure shape):** FR-12 reads "unplayed for 3+ months (from add date or last play)" with no clamp and no `[ASSUMPTION]` on the 30-day nudge, and its UJ-6 path (§`prd.md:89`) still describes pulling tracks into a prep crate. `EXPERIENCE.md`'s Components row and UJ-6 step 4 say the same. Sync all four to what actually ships.
  - [x] `deferred-work.md`: close the "AC-5's soft-delete has no web-side or end-to-end coverage" entry with what Task 2 now covers; add the prep-crate action as a named post-MVP item with the cloud→agent-channel finding attached so the cost is not re-measured.
  - [x] `sprint-status.yaml` note in the established style.

### Review Findings

- [x] [Review][Decision] All-clear / not-yet-possible copy can render adjacent to footnotes that contradict it — **Resolved by Arjun 2026-08-08: gate `all-clear` on those counts too.** `agingShelfState` now also returns `not-yet-possible` when `unreconciledDateCount > 0 || unknownAddDateCount > 0`, even if `canJudge` and `qualifyingCount === 0`, so "Everything you've bought is getting played." can no longer render next to "N unusable dates" or "N with no add date". The `recentlyDownloadedCount`-during-`not-yet-possible` overlap noted alongside this finding was explicitly left untouched — it is by-design (the count is meant to survive fail-closed suppression) and out of scope for this ruling. Fixed in `web/lib/sets/agingShelf.ts`'s `agingShelfState`, with two new regression tests in `agingShelf.test.ts`.

- [x] [Review][Patch] Aging-shelf row list has no keyboard-reachable scroll path [web/app/library-utilization.css:212-224] — fixed: `tabIndex={0}` on `.lu-shelf-list` plus a `:focus-visible` ring (and forced-colors variant).
- [x] [Review][Patch] "N unusable dates" has no singular form ("1 unusable dates" at count 1) [web/app/components/library-utilization/AgingShelf.tsx:259] — fixed: singular/plural branch matching `agingShelfSummary`'s existing convention.
- [x] [Review][Patch] sprint-status.yaml's Story 4.4 browser-pass note still cites the pre-redesign 139×28 `<select>` measurement instead of the shipped 34×34 icon chip [_bmad-output/implementation-artifacts/sprint-status.yaml:676] — fixed: note updated to the shipped measurement with a correction pointer.
- [x] [Review][Patch] epics.md Story 4.4's header/story-statement still promise the cut prep-crate action, unannotated, immediately above a fully-annotated AC-2 [_bmad-output/planning-artifacts/epics.md:836,839] — fixed: story statement struck through and annotated; section title/story key left as historical per the story file's own convention.
- [x] [Review][Patch] Completion Notes report two different fixture counts for the same browser pass (616 vs 617 qualifying tracks) [_bmad-output/implementation-artifacts/4-4-aging-shelf-with-prep-crate-action.md:231,253] — fixed: reconciled to 616 (the figure repeated consistently elsewhere for the same fixture/pass), with a note explaining the correction.
- [x] [Review][Patch] `buildAgingShelf`'s doc comment overstates the future-dated guard's coverage ("every clock source... not just added_at") — a future-dated `added_at` behind a real observed play is never checked [web/lib/sets/agingShelf.ts:308-317] — fixed: comment rewritten to state precisely what the guard checks and to name the uncovered case explicitly rather than overclaiming.
- [x] [Review][Defer] Prep-crate action still described without annotation in epics.md's cross-story narrative and ARCHITECTURE-SPINE.md [_bmad-output/planning-artifacts/epics.md:112,201,792,991,1007; ARCHITECTURE-SPINE.md:201] — deferred, pre-existing

## Dev Notes

### Files you will touch, and what they currently do

**`web/lib/sets/index.ts` — UPDATE.** The one data-access seam every page reads through (Story 3.6 Task 4, AC-13/SM-1). Four of five DJ-data functions read Supabase for real since Story 4.6; `getLibraryRoster` is the **one exception**, hardcoded to the empty shape. Its doc comment names this story as the owner of the fix and carefully separates the two halves — `entries` **can** be read now, the two scalars **cannot**. Honor that split exactly. `deleteSet` deliberately throws rather than falling back calmly because it is a mutation; the four reads all fall back calmly. Your two additions are reads.

**`web/lib/sets/libraryConversion.ts` — READ ONLY, do not modify.** Source of `playsByTrack` (shared index), `msOf`, and the three shipped models. Its `buildTimeToFirstPlay` doc comment explains why *that* story needed no subscription filter (`library_track_events` is go-forward by construction) — which is exactly why **this** story does need an explicit clamp: the roster is not go-forward, it carries the whole back catalogue on purpose.

**`web/lib/sets/libraryRoster.ts` — READ ONLY, do not modify.** `LibraryRosterEntry`'s field docs are the contract. `unidentifiableTracksDisclosure` already has a live consumer (the meter) and is not yours.

**`web/app/(authenticated)/library-utilization/page.tsx` — UPDATE.** Server component. Already fetches all three sources in one `Promise.all`, builds exactly **one** `playIndex` shared by three modules (it was two, and the duplication was the vehicle for a real bug), and takes its clock from `addEvents.readAtMs`. Two tiers: everything inside `LibraryUtilizationView` is governed by the shared conversion-window dropdown; window-independent modules are siblings outside it. Your module is window-independent.

**`web/app/components/library-utilization/TimeToFirstPlay.tsx` — READ ONLY, copy its shape.** The closest structural precedent: a window-independent, server-rendered `.lu-module dz-shell` with gated states, `lu-disclosure` lines, and an `aria-label` deliberately kept consistent with the visible state.

### Formatting: the one reuse you should NOT make

`format.ts`'s `formatElapsed(ms)` is the obvious reuse — `TimeToFirstPlay` uses it 200px away — and it is **wrong for a shelf row's days-unplayed value**. It coarsens above 60 days to months and above a year to years, so a list sorted by days unplayed would render `1 year / 1 year / 1 year / 11 months` and read as **unsorted or broken**, precisely because the sort key is the thing being flattened. Render the row's value as a plain day count. `formatElapsed` stays correct wherever a coarse phrase is genuinely wanted (an average, a prose disclosure) — this is a call-site judgment, not a defect in the helper, and it is worth one line in Completion Notes so nobody "fixes" it back.

### No external research was needed

This story adds no dependency and touches no library whose version matters — it is Next/React/Vitest and the Supabase client already in use, against a table and an RLS policy that already exist. No version pinning, API-surface, or breaking-change check applies.

### What must not break

- The three shipped modules on `/library-utilization` and their single shared window selection.
- `library_track_events` as the **only** conversion cohort denominator (AD-22 / 4.11 AC-3).
- `no-hardcoded-colors.test.ts`, `tokens.test.ts`, the additive-only schema guard, the pgTAP grant matrix. **This story needs no migration, no `shared/` change, and no agent change** — if you find yourself writing one, stop and re-read Context §1 and §5.

### Inherited risks — real, and this story is the first consumer of all three

1. **The soft-delete safety gate is a one-way ratchet** (`deferred-work.md`, open). `store::observe_catalogue_reach`'s high-water mark only grows, so a retired/renamed drive makes `complete_reach` permanently false and `mark_absent_tracks` never runs again — **with no log line at any level**. The visible symptom is this shelf rendering tracks deleted years ago as owned-but-never-played. Agent-side fix, out of scope here; if you see impossible rows during the browser pass, this is the first place to look, not a bug in Task 2.
2. **Multi-install oscillation** (AD-22, ruled post-MVP). Two linked machines each mark the other's tracks `absent_at`, so the roster never converges — and this shelf reads the result.
3. **`absent_at` has never been exercised anywhere web-side.** The committed fixture sets `absent_at: null` for all 653 entries by design. Task 2's test is the first real coverage.

### Testing standards

Vitest, colocated `*.test.ts` beside the module. Pure models are tested directly with hand-built inputs and an injected clock; components are tested through the model, not by mounting where a pure assertion will do. Current gate to keep green: `pnpm exec vitest run`, `pnpm exec tsc --noEmit`, `pnpm exec eslint`, `pnpm exec next build`. No agent or Supabase gate applies — this story touches neither.

### Project Structure Notes

Aligns with the established layout with no variances: pure models in `web/lib/sets/*.ts` with colocated tests, page-specific components in `web/app/components/library-utilization/`, page-scoped styles in `web/app/library-utilization.css` under the `lu-` prefix, routes under `web/app/(authenticated)/`. The one deliberate structural choice worth naming: the new module is a **sibling of** `LibraryUtilizationView`, not a child, because it is window-independent — see Task 4.

### Open questions (do not block on these; record your disposition)

1. **The 30-day recently-downloaded threshold is `[ASSUMPTION]`** in both the PRD and `epics.md` AC-4, never confirmed by Arjun. Build to 30; the PRD-sync is Task 7.
2. **`EXPERIENCE.md` places the recently-downloaded nudge on the *Dashboard*** (line 97, "quiet secondary nudge, same banner pattern as new-set-detected") while `epics.md` assigns AC-4 to this story, whose surface is `/library-utilization`. **Ruled here: render it as a count line on this module.** A dashboard banner is a different page and unrequested scope; the count line reverts cleanly if Arjun wants the banner instead.
3. **Low-confidence sets (FR-27) are not excluded here** — deliberately. The three shipped modules on this page all read `getRecentSets()` unfiltered, so a soundcheck play already counts as a play across the whole page. Making the shelf the *one* module that filters would put two modules 200px apart disagreeing about whether a track has been played. Story 4.9 AC-10 owns the page-wide exclude-visibly pass. Note this in Completion Notes so the inconsistency stays visible rather than looking settled.

### References

- Story requirements, re-spec, and the unblock note: [Source: _bmad-output/planning-artifacts/epics.md#Story 4.4: Aging shelf with prep-crate action]
- Decision B (played = played-on-Curfew; the binding copy rule): [Source: _bmad-output/planning-artifacts/epics.md#Epic 4]
- FR-12, the UJ-6 path, the Glossary's "Played" and "Aging shelf" entries: [Source: _bmad-output/planning-artifacts/prds/prd-name-pending-2026-07-19/prd.md#4.4 Library Utilization]
- UX-DR12 (shelf + action), aging-shelf-empty copy, the 30-day nudge: [Source: _bmad-output/planning-artifacts/ux-designs/ux-name-pending-2026-07-19/EXPERIENCE.md]
- AD-22 (roster: current-state, baseline-carrying, Tier A, soft-delete, single-install limit), AD-8's three amendments, AD-7 RLS shape: [Source: _bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md]
- Roster table, RLS, and the `added_at`/`is_baseline` immutability guard: [Source: supabase/migrations/20260807110000_create_library_roster.sql]
- The seam's own statement that this story owns the roster read: [Source: web/lib/sets/index.ts — `getLibraryRoster`]
- Inherited risks 1–3 and the open future-dated-add ruling: [Source: _bmad-output/implementation-artifacts/deferred-work.md]
- Tier A/B cost split, baseline-vs-cohort invariant, soft-delete design: [Source: _bmad-output/implementation-artifacts/4-11-library-roster-sync.md]
- Why 4.5 needed no subscription filter and this story does: [Source: _bmad-output/implementation-artifacts/4-5-time-to-first-play.md]

## Dev Agent Record

### Agent Model Used

claude-opus-5 (Claude Code, `bmad-dev-story`)

### Debug Log References

Browser pass driven through a temporary harness route (`web/app/dev-aging-shelf/page.tsx`, deleted before commit) because the roster is empty in production and the committed fixture has zero undated and zero absent rows by design — AC-4/AC-5/AC-7/AC-9 render nothing on real data. The harness rendered six models (fixture rows + injected long/undated/recent entries, the three gated states, and the fail-closed state) as direct children of `.lu` so `.lu > .lu-module`'s 440px cap was actually exercised rather than skipped by a wrapper.

### Completion Notes List

**Scope held.** Pure `web/`: no migration, no `shared/` change, no agent change. Nothing was added to the roster table, the sync payload, or the UI beyond Tier A.

**The two halves of `getLibraryRoster` were kept apart** (Task 1's central instruction). `entries` is now a real paged read; `excludedNoIdentityCount`/`totalCatalogueRows` stay `0` on every return path because they have no cloud carrier. The pre-existing "does not report another DJ's measured catalogue counts" tests were deliberately kept and one was extended to assert the disclosure still returns `null` *while entries are real* — the point being to stop a future "make it consistent" pass deriving those scalars from the rows, which would be a different number wearing the same name.

**`.is()` not `.eq()`** for the `absent_at` filter, with a test asserting it: `eq` renders `absent_at=eq.null`, a literal string comparison that matches nothing, so the wrong one would have silently returned an empty roster forever.

**Mutation-tested the three binding rules** rather than trusting a green suite. Degrading the fail-closed branch to raw `added_at` fails 2 tests; capping before sorting fails 2; branching on `is_baseline` fails 1. The suite genuinely bites on all three.

**`formatElapsed` was NOT reused for the row value**, per Dev Notes — writing it here so nobody "fixes" it back. It coarsens above 60 days to months and above a year to years, so a list sorted *by* days unplayed would render "1 year / 1 year / 1 year / 11 months" and read as unsorted, precisely because the sort key is the value being flattened. `formatElapsed` remains correct wherever a coarse phrase is wanted; this is a call-site judgment, not a defect in the helper.

**The footnotes were cut to facts** (Arjun, 2026-08-08, on seeing them rendered: "there are so many words, nobody's going to read all that"). The first version stacked up to four full `lu-disclosure` sentences under the list, each explaining its own reasoning — a wall that makes an AC-required disclosure worthless in practice even though it is technically present. **"Must be disclosed" is not "must be explained."** Every disclosure still renders and no AC was weakened; the reasoning moved to the code comments and this file, where the next developer needs it and the DJ does not. Measured on the fixture: the footer went from three stacked sentences to `Showing 100 of 616` (corrected in code review — this paragraph originally said 617, off by one from the 616 this same file's clamp finding and `deferred-work.md` both state for the identical fixture/pass) plus one wrapping caption row (`2 with no add date · 2 unplayed from the last 30 days`) — 15 words where it had been ~45, and 46px shorter. Two things kept deliberately against the compression: the recently-downloaded note **keeps "the last 30 days"**, because "new" with no boundary is a claim the DJ cannot check and this is the one note that is information rather than a caveat; and the cap line **drops** the sort direction it used to name, because the sort control directly above already shows it — the `aria-label` still names it, since a screen-reader user cannot see the icon.

Two bugs the compression surfaced, both found in the browser and neither catchable by any gate (nothing type-checks rendered prose): JSX wrapping across lines dropped the space after a count and rendered `40held back`, now an interpolated string; and the separator between notes, first written as a leading `::before` on a flex row, orphaned itself at the start of a wrapped line at 320px — it now trails the phrase it belongs to in normal inline flow.

**The sort control is a click-to-toggle icon chip, not a dropdown** (Arjun, 2026-08-08, after seeing it in the browser). It borrows `SpotlightSearch`'s sort-chip language from the dashboard — one button carrying its own direction, `aria-label` naming the current state rather than the action, icon `aria-hidden`, `lucide` directional icons (`ArrowDownWideNarrow` ⇄ `ArrowUpNarrowWide`). Two deliberate deviations from that source, both because the two controls sit in different contexts: **no `aria-pressed`** (there it marks which of two sort *keys* is active and has a referent; here there is one key and two directions, so it would have to mean "is ascending"), and **0.7 resting opacity instead of 0.45** (those chips only exist while the search pill is hovered, so they are already inside an active hover context — this one is always on screen and is the module's only affordance, and at 0.45 the single cue telling a DJ the list is sortable is dimmed to near-invisible). 34×34 rather than 48×48, since it sits beside a 15.8px label rather than a 52px search pill; measured in the browser at 34×34, comfortably past SC 2.5.8's 24×24 where the `<select>` it replaced only just cleared it on default platform metrics. Replacing the 139px `<select>` also retired the 320px header-wrap rule it had needed.

**The sort is NOT persisted, and that is a deliberate departure** from the two `useSyncExternalStore` + `localStorage` window controls (Task 3 asked for the reasoning either way). A window is a parameter of the analysis — it changes what the numbers mean, so it should stick. A sort direction is a transient view of one fixed list and changes nothing about what is true; persisting it means a DJ who once flipped to shortest-unplayed returns weeks later to a shelf whose top row is the *least* neglected track, an inverted default with nothing on screen explaining it. This also avoids becoming the third copy of that boilerplate, which `deferred-work.md` names as the point at which its "not worth extracting at two copies" ruling should be re-checked rather than silently deepened.

**Future-dated rows follow `buildTimeToFirstPlay`'s disposition, not a fourth new one.** The three-way ruling in `deferred-work.md` is still open, so this story adopted the one existing disposition that surfaces the row rather than mislabelling it (counted and disclosed as "dates Curfew can't reconcile"). The guard covers *every* clock source that can sit in the future, not just `added_at` — a future-dated play would otherwise render a negative day count. The tally is now 3 modules on that side, 1 each on the other two; the entry has been updated and `buildAgingShelf` names it at the guard so one ruling lands in one place.

**Low-confidence sets (FR-27) are not excluded here, deliberately** — noting it so the inconsistency stays visible rather than looking settled. All four modules on this page read `getRecentSets()` unfiltered, so a soundcheck play already counts as a play page-wide. Making the shelf the one module that filters would put two modules 200px apart disagreeing about whether a track has been played. Story 4.9 AC-10 owns the page-wide pass.

**Two real defects the test suite did not catch, found in the browser pass:**
1. **The accessible name disagreed with the visible list after a sort flip.** Flipping to shortest-unplayed left the section announcing "the longest-unplayed 100 are listed" while the visible disclosure said "shortest". The two capped lists share *no rows at the extremes*, so this was a wrong answer to a screen-reader user, not stale wording — the same failure shape 4.5's review found. `agingShelfSummary` now takes the sort, and there is a regression test plus one asserting no sorted-end clause leaks when the list is not truncated.
2. **`.lu-module .se-empty` rendered as a pill with its copy on a curved edge.** `deferred-work.md` named this rule as "the first thing to measure" and unverified; measured here at 66px tall against a 50px radius (radius > half height) with the copy 6px inside a 50px corner arc. Fixed to `border-radius: 16px` with real horizontal padding. This also fixes `TimeToFirstPlay`'s identical state — same component, same call site, same page, and the finding was logged against it.

**Structural findings checked, not assumed** (Task 5): `.lu > .lu-module { max-width: 440px }` **holds** against list content — a title—artist—days row leaves the track column ~330px and truncates with ellipsis rather than pushing the day count out of the row, verified at 320px. The height is what a list strains, not the width, so the list scrolls inside its own bounds (100 rows would otherwise be a ~3,800px column).

**a11y:** the module contributes the page's first real `<h2>`, partly addressing `deferred-work.md`'s open finding that `/library-utilization` has no `<h2>` at all and heading-nav skips every module. Not extended to the other three: R-10 (whether these module `<section>`s should become `<div role="group">`) is still unruled, and changing four components under an unruled finding is separate work. Net 4 sections / 1 h2, from 3 / 0 — noted rather than deepened silently. The accessible name states **no figure** in any gated state, checked against the rendered state in the browser.

**Two things flagged for a ruling rather than silently resolved** (both in `deferred-work.md`):
- The all-clear copy ("Everything you've bought is getting played.", AC-5, verbatim by requirement) and the 30-day nudge (AC-6, unconditional) can sit adjacent and conflict. The nudge is self-scoping ("in the last 30 days"), so it reads as *these are just new*, but the tension is real and grows with the count. Resolving it either way violates an AC as written.
- **The clamp makes every pre-observation track report the identical day count.** On the fixture: 616 qualifying tracks whose longest-unplayed page is a wall of "730 days", because everything added before `djs.created_at` clamps to exactly the observation length. This is the clamp working correctly, and the `track_id` tie-break keeps the order deterministic — but "sortable by days unplayed" does less for a veteran DJ than FR-12 implies, since only observed-play rows have genuinely varied ages. Deliberately not "fixed": any secondary sort key would have to come from the data the clamp exists to distrust.

**Inherited risk 1 remains live and unaddressed here** (agent-side, out of scope): `observe_catalogue_reach`'s one-way ratchet means a retired drive can permanently disable `mark_absent_tracks`, and the visible symptom is *this shelf* rendering tracks deleted years ago as owned-but-never-played. If impossible rows show up in review, that is the first place to look, not Task 2.

**Gate:** 473 JS/TS tests (25 files) green, `tsc --noEmit` clean, `eslint` clean, `next build` clean, `no-hardcoded-colors` and `tokens` gates green. No Supabase or agent gate applies — this story touches neither.

### File List

- `web/lib/sets/index.ts` — MODIFIED (real paged `getLibraryRoster`; new `getObservationStart`; module header updated)
- `web/lib/sets/index.test.ts` — MODIFIED (mock gained `is`/table tracking; roster read + observation-start coverage)
- `web/lib/sets/agingShelf.ts` — NEW (pure model, state selector, summary generator)
- `web/lib/sets/agingShelf.test.ts` — NEW (60 tests)
- `web/app/components/library-utilization/AgingShelf.tsx` — NEW
- `web/app/(authenticated)/library-utilization/page.tsx` — MODIFIED (fourth `Promise.all` read, model build, sibling placement)
- `web/app/library-utilization.css` — MODIFIED (shelf list/row/day styles, `.lu-shelf-head`, tap-target floor, `.se-empty` radius fix)
- `_bmad-output/planning-artifacts/prds/prd-name-pending-2026-07-19/prd.md` — MODIFIED (FR-12 body + consequences, UJ-6 path/climax, glossary, UJ-1 nudge note)
- `_bmad-output/planning-artifacts/ux-designs/ux-name-pending-2026-07-19/EXPERIENCE.md` — MODIFIED (Components row, aging-shelf-empty row, nudge row, UJ-6 step 4)
- `_bmad-output/planning-artifacts/epics.md` — MODIFIED (AC-1/AC-4/AC-5 annotated, AC-6/AC-7 added)
- `_bmad-output/implementation-artifacts/deferred-work.md` — MODIFIED (Story 4.4 section; soft-delete entry partly closed; future-dated and browser-pass entries updated)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — MODIFIED
- `_bmad-output/implementation-artifacts/4-4-aging-shelf-with-prep-crate-action.md` — MODIFIED (this file)

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-08 | Story created. Prep-crate action ruled out of MVP by Arjun; clock clamp, observation-start anchor, cold-start state and row cap specified. |
| 2026-08-08 | Implemented Tasks 1–7. Seam read made real + fail-closed observation anchor; pure `agingShelf` model; read-only shelf component with three terminal states; page wired as a window-independent sibling; browser pass at 1440/375/320 fixed an accessible-name/visible-state disagreement and the long-open `.se-empty` pill defect; PRD/EXPERIENCE/epics/deferred-work synced. Status → review. |
