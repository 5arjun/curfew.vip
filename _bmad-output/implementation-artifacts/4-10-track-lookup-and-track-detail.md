# Story 4.10: Track lookup and track detail

Status: review

## Story

As a DJ,
I want to look up a track and see its tags, how often and when I've played it, which sets it appeared in, and what I mix it with,
so that I can answer questions about a specific record instead of only reading aggregates.

## Non-negotiables

1. **Pure `web/`.** No migration, no `shared/` change, no agent change. Every field this story renders already exists in the cloud (§Data inventory). If you find yourself wanting a column, you have misread the inventory — re-read it, then flag rather than add.
2. **The accessible name never states a figure the visible UI declined to state**, and never states the same figure twice in two registers. One `*Summary(model)` generator per module, branching on the *same* predicate as the visible state.
3. **A missing value is a gap, never a fabricated zero** (D-8). No `0 plays, 0 unique`. Models return `null`/absent for "not enough data".
4. **Every exclusion is disclosed as a count** (SM-C1), and the count must not drop to `0` in the case where 100% was excluded — that is Story 4.7 R-2, the single most-repeated defect in this epic.
5. **No silent caps.** Every capped list states the full qualifying count and which end it shows. Sort before the cap, never after.
6. **No ranking vocabulary** in any string — `DESIGN.md:199`, "no 'best,' 'winner,' or ranking language, ever." AC-9's mix neighbours are *ordered by recurrence*; the data may rank, the words may not.
7. **Decision B's copy rule**: this is the DJ's record, never a receipt. No "since you joined", no "in your N months", no elapsed-membership framing. (`ai-7`, still open, binds every string this story adds.)
8. **No hardcoded colors** anywhere in `web/app/**` — `no-hardcoded-colors.test.ts` bans hex, `rgb()`, `hsl()`, `oklch()`, `color-mix()`, CSS named colors, **and the bare words `transparent`/`currentColor`**, including inside comments.
9. **Empty string is not null.** `""` passes every `== null` guard in this codebase and has already shipped one phantom-track bug (4.9). Guard with `.trim()`, everywhere, on both title and artist.

## Context & Authority

`epics.md:966-987` holds ACs 1-12 and the scope-boundary blockquote. `sprint-status.yaml:1020` has this story at `backlog`; the epic's other ten stories are all `done` except 4.9 (merged, review closed). **This is the last unbuilt story in Epic 4.**

### GAP-1 — the epic's own scope boundary for this story is now stale, and it is the story's biggest decision

`epics.md:972` says, verbatim:

> **⚑ Scope boundary — this searches PLAYED tracks, not the library, and the copy must not pretend otherwise.** … a track the DJ owns but never played can be neither found *nor named*. The sequencing follows from that asymmetry: a never-played track's detail page would be nearly empty anyway, so build the rich half now and **widen discovery when the roster lands** (see the prerequisite note below).

The roster landed. Story 4.11 shipped `public.library_roster` (`track_id`, `title`, `artist`, `added_at`, `is_baseline`, `absent_at`) on 2026-08-08, and **4.11's own AC-9 assigns the consequence to this story**, `epics.md:1009`:

> **Given** the new roster, **Then** Story 4.10's search widens from played tracks to the full library and its AC-2 empty-state copy is revisited — the ambiguity that AC exists to manage is exactly what this story removes.

Two ACs written for a pre-roster world are therefore live contradictions: AC-1's label *"tracks you've played," never "your library"* and AC-2's empty state, whose entire job is resolving an ambiguity that no longer exists. Ruled in **D-25**. Doc-sync owed on the blockquote itself (Task 10) — the ai-2/ai-6 accretion shape, closed here rather than left.

### GAP-2 — a fifth of the DJ's plays cannot have a detail page, and the epic never says so

AC-3 mandates `/track/[track_id]`. `plays.track_id` is **nullable**, and Story 4.3's identity change made it structurally so: `track_id_from_title_artist` requires **both** title and artist (AD-11 — one field alone is too little signal to trust as an identity). Measured on Arjun's real library (`4-3-conversion-rate-led-pip-meter.md:126`):

> 473 of 2,294 real plays (~21%) now carry no `track_id` at all, because they resolve no artist tag (380), no title (28), or neither (65).

Corroborated at catalogue level — `deferred-work.md:471`: **271 of 930 rows carry no `tart` (artist) field at all**; `.m4a` 24/24, `.mp4` 14/14 and `.mov` 6/6 are 100% artist-less. The committed seed reproduces it: **1,055 distinct non-null `track_id`s, 473 plays with `track_id = null`**.

So Workhorses and one-and-done — the two lists `library-utilization/page.tsx:341` names as this story's link targets — contain rows that **can never be linked**, because the identity they'd need does not exist. This is not a bug to route around; it is AD-11 working. Ruled in **D-26** (unlinkable, disclosed as a count) and **D-27** (never re-derive the identity in TypeScript).

### GAP-3 — "what time of night" has no timezone, and nothing in the system stores one

AC-7's clock-time strip needs a wall-clock hour. `plays.started_at` is `timestamptz` — the capture-side offset is normalized to UTC and lost. There is no venue timezone, no DJ timezone on `djs`, and no set-level offset. Rendering an hour server-side means rendering it in the *server's* zone, which is (a) wrong and (b) a hydration mismatch — the fourth instance in this epic, after 4.7's float-precision mismatch (fixed) and the locale-dependent axis ticks (`deferred-work.md:491`, still open). Ruled in **D-32**.

### GAP-4 — this page already has two track-identity key spaces, deliberately, and 4.10 is where they meet

Story 4.9's five modules key on `trackKey(title, artist)` = `JSON.stringify([title, artist ?? ""])` (`libraryUtilization.ts:125-127`). Conversion and the aging shelf key on `track_id`. Story 4.9's **D-18 explicitly forbids reconciling them**: *"Do not 'fix' this into agreeing with `libraryConversion.ts`'s `track_id` keying — that file answers a different question."* The two key spaces are not the same set, and mixing them double-counts.

This story must consume both without merging them: the **display and search surface** is `trackKey`-space (it covers 100% of played rows, including artist-less ones); the **route** is `track_id`-space (the only identity that can also reach an *owned but never played* track). D-27 carries the mapping one-directionally, from plays, without ever re-deriving it.

### GAP-5 — a server-side search would be a sequential scan, and there is no extension to fix it

Complete index inventory across all 18 migrations shows **no index on `plays.title`, `plays.artist`, `library_roster.title`, or `library_roster.artist`**. There is **no `pg_trgm`, no full-text search, no `tsvector`, no `unaccent`, no `citext`** — the only extension any migration creates is `uuid-ossp`. A PostgREST `ilike` search is a seq scan behind the RLS `dj_id` filter, and adding a GIN index would be a migration this story is scoped out of. Drives **D-29** (client-side filter over a server-built index, the house pattern).

### GAP-6 — the one index this story needs already exists

`plays_dj_id_track_id_idx on public.plays (dj_id, track_id)` (`20260807100000_create_library_track_events.sql:130`). The `/track/[track_id]` read is indexed; `getRecentSets`'s own hot query is not (`deferred-work.md:73`). This is why D-30 uses a new targeted read rather than filtering the 500-set array in memory.

### Decisions

**D-25 — Search covers played ∪ owned, and says which each result is. ⚑ RULED 2026-08-10 (Arjun).** 4.11 AC-9 is a later, shipped ruling and supersedes 4.10's pre-roster scope-boundary blockquote. The field's label names both populations honestly; a result carries a state — *played* (n plays) or *in your library, not played yet* (added date). This is also the story's best cold-start answer (D-38). AC-1 and AC-2 are amended accordingly; the blockquote gets a struck-through ruling note in Task 10.

**D-26 — The route is `/track/[track_id]`, and a track with no `track_id` is not linkable. ⚑ RULED 2026-08-10 (Arjun)**, against two alternatives that were costed and declined: keying the route on `trackKey` (title+artist) would cover 100% of both populations, but produces encoded URLs, contradicts AC-3, and inherits `trackKey`'s un-trimmed/un-case-folded keying so `"Deep End "` becomes a second page; a hybrid falling back from id to key covers everything but puts two URL shapes and a third identity usage on a page that already deliberately runs two (D-18). Path on disk: `web/app/(authenticated)/track/[track_id]/page.tsx` — inside the route group, not `web/app/track/`. A row whose track has no identity renders as plain text, not a dead link, and **the count of such rows is disclosed on the page** (SM-C1). Do not invent a title-only identity to paper over it: AD-11 ruled one field is too little signal, and Story 4.3 paid a measured 21% coverage cost to honor that.

**D-27 — `track_id` is carried through from the plays, never re-derived.** `track_id` is `fnv1a_hex(normalize(title) ␞ normalize(artist))` computed in Rust (`capture.rs:146-189`). **Do not reimplement fnv1a or `normalize_identity_text` in TypeScript** — a second implementation that drifts by one whitespace rule silently produces 404s. `SET_WITH_PLAYS_SELECT` (`lib/sets/index.ts:99-100`) already selects `track_id` on every play, so `buildUtilizationIndex` gains one map, `trackIdByKey`, populated from the play rows it is already walking. Zero new computation, zero new query.

**D-28 — A key mapping to more than one `track_id` fails closed.** Possible in principle: a play synced before Story 4.3's deploy carries the old *path-hash* `track_id` permanently, and nothing re-derives a historical play's identity (`4-3…md:117`). If a `trackKey` group's plays carry ≥2 distinct non-null `track_id`s, render the row **unlinked** and count it into the same disclosure as D-26 — never pick one arbitrarily. **Verify the population before assuming it is unreachable**: Story 4.9 measured production at 1 dj / 0 sets / 0 plays on 2026-08-08 (Task 1's stop-condition re-measures). If prod is still empty, no legacy path-hash row exists anywhere and this branch is defensive only — say so, and cover it with a unit test rather than a browser state.

**D-29 — Search filters client-side over a compact server-built index; it is not persisted.** The house pattern is `SpotlightSearch` + `SetListPanel` (`SetListPanel.tsx:76-90`): a lowercased `haystack` precomputed **in the model layer**, every whitespace token must hit it, filtering in a `useMemo`. Follow it exactly. Both source arrays are already loaded by this page's server component (`getRecentSets` for plays, `getLibraryRoster` for owned), so **no new seam function is needed for search**. Ship a compact index (`trackId | null`, `title`, `artist`, `haystack`, `playCount`, `setCount`, `addedAt`, `state`) — not raw rows. A window persists; a transient view does not (`AgingShelf`'s own doc comment), so the query is `useState`, no `localStorage`, no `useSearchParams`. **Task 3 carries a measured payload stop-condition.**

**D-30 — The detail route reads through a new, indexed seam function, not `getRecentSets()`.** `getTrackPlays(trackId)` selects from `plays` filtered `.eq("track_id", trackId)` — served by `plays_dj_id_track_id_idx` — embedding `sets(id, started_at, derived, sessions(session_identity))` so AC-6's linked set rows, AC-7's clock strip and AC-11's confidence predicate all resolve from one read. Filtering the 500-set array in memory would ship ~2,294 plays to render one track and would silently inherit the 500-set horizon (`deferred-work.md:95`). Follow `getSetById`'s shape exactly: lazy `await import("@/lib/supabase/server")`, no `dj_id` filter (RLS is the filter, AD-7), try/catch around the whole body, dev-only `console.error`, calm `null`/empty on failure — **never throw from a read**. Bound it explicitly; PostgREST silently truncates at `max_rows = 1000` with HTTP 200 and `error: null`.

**D-31 — Mix neighbours come from a second bounded read, and adjacency is `position ± 1` within the same set only.** `plays` has `unique (set_id, position)`, 1-based. Step 2: `.in("set_id", setIds).in("position", neighbourPositions)`, then filter to the exact `(set_id, position)` pairs client-side — the cross-product over-fetches but is bounded by (sets this track appeared in) × (≤2 positions each). A neighbour that is the track itself (played twice back-to-back) is a real answer, not a bug. No crossing a set boundary: the last track of one night is not the neighbour of the first track of the next.

**D-32 — Clock-time labels are produced in the browser, from epoch ms.** The model ships `startedAtMs: number` and **never a formatted hour**. The strip's hour labels and any "2:14am" readout are computed in a `"use client"` boundary after mount, in the viewer's own zone — which is the only zone that is ever right for "what time of night do I drop this", since the DJ plays where they live. Do not SSR a locale/zone-dependent string; this epic already carries one unfixed instance of that mismatch and must not add a second. The strip's **text equivalent** (AC-12) is generated from the same client-side values so the two cannot drift.

**D-33 — Ride time is a median, with n stated; at n=1 there is no median.** AC-8's "how long the DJ typically rides the track". Story 4.5 ruled *mean* for time-to-first-play deliberately and for trust reasons across a wide, skewed population; a single track's play durations are a tight distribution where the median describes the typical spin and one 20-second false-start does not move it. **State the n every time.** At n=1 render the single duration and say it is one play — never the word "typically", never a median presented as a distribution (AC-10). Plays missing `played_ms` are excluded **with their count disclosed**, and the count must survive the case where *every* play is missing it (R-2).

**D-34 — AC-11 reuses `LibraryUtilizationReveal`, and the predicate is `listModel.ts`'s compound one.** `LibraryUtilizationReveal.tsx` was built as a page-level primitive expressly for this story (its doc comment says so). Use it on **both** surfaces: the search results on `/library-utilization`, and the detail page. The predicate is `isLowConfidenceSet` from `lib/sets/listModel.ts:99-102` — `confidence.value < 1.0 || trackCount < HERO_MIN_TRACKS` — **not** `styleEvolution.ts`'s bare `< 1.0`, which lets a 2-3 track soundcheck through at confidence 1.0. Descriptor copy on this page is `"short or low-confidence"`. Both subtrees arrive prerendered and swap; never recompute on reveal.

**D-35 — `/track` must be added to `GATED_PREFIXES`.** `web/lib/supabase/phone-gate.ts:23-30` lists `/dashboard`, `/style-evolution`, `/library-utilization`, `/set`, `/settings`, `/link-agent`, and its own doc comment says *"A new route added to the (authenticated) group must be added here too."* Omitting it makes the new route silently bypass the phone-on-file gate. Add the prefix **and** a case to `phone-gate.test.ts`. This is the one thing in this story that ships broken and green.

**D-36 — The search field renders inside the "Tracks" group, above the pair; no new `<h2>`, no new landmark.** The page's outline is `H1 → H2 Conversion → H2 Rotation → H2 Tracks → H2 First play`, with `<h3 className="lu-stat-label">` per module and **measured landmark count 2** (`main` + `nav`) after Story 4.9's R-10 fix. Every module is `<div className="lu-module dz-shell" role="group" aria-label={summary}>` — **copy `Workhorses`' markup, not `AgingShelf`'s**, which still renders a `<section aria-label>` and is the one logged exception. Search is window-independent, so it renders **outside** `LibraryUtilizationView` (D-21's placement rule). Critical: `renderBody()` is called **twice** (excluding/including populations) — putting query state inside it produces two independent search fields. Give the field its own thin `"use client"` component at page level, the way `LibraryUtilizationReveal` is.

**D-37 — `notFound()` on an unknown `track_id`, exactly like `/set/[id]`.** The seam returns `null` for "doesn't exist", "not this DJ's", "deleted" and "read failed" alike — RLS makes them indistinguishable by design and that is the correct privacy posture. Do not add a distinguishing message. There is no `not-found.tsx` / `error.tsx` / `loading.tsx` anywhere in this app; do not introduce one as a side effect. No `metadata` export either — no page in this app has one.

**D-38 — The cold-start state is a feature here, not an error branch.** A DJ with a synced roster and zero sets can search and find tracks they *own* — the first surface in the product that says something true on day one. Design that state deliberately: search works, results carry the *in your library, not played yet* state, and the detail page for such a track shows identity + add date + an honest "no plays yet" rather than four empty modules. A DJ with **neither** plays nor roster gets one positive-framed insufficient state via `InsufficientHistory` with **module-specific copy** — do not reuse another module's string (ruled twice, in 4.3 and 4.5), and **the gate and the sentence must describe the same quantity** (4.5's review: a gate counting *adds* while its copy said go *play*).

## Acceptance Criteria

Amended from `epics.md:976-987` where D-25 supersedes. Amendments are marked; unmarked ACs are the epic's wording.

1. *(Amended, D-25)* **Given** the Library Utilization page, **Then** a search field finds tracks by title and artist across **both the tracks the DJ has played and the tracks in their synced library**, and its label states exactly that — never "your library" alone (which would over-promise on the ~28% of catalogue rows with no resolvable identity), never "tracks you've played" alone (which is now false).
2. *(Amended, D-25)* **Given** a result, **Then** it states which population it comes from — played (with its play count) or owned-but-not-yet-played (with its add date) — so the DJ never has to guess why a track shows no plays. **Given** a query with no match, **Then** the empty state says plainly that Curfew has no record of that track in either population, without apology, and without implying the library is complete. *(UX-DR18 calm failure register)*
3. **Given** a result **that has a resolvable identity**, **Then** it opens a track detail route at `/track/[track_id]`, mirroring the existing `/set/[id]` route convention rather than inventing a second pattern. *(Story 3.7 precedent; D-26)*
4. *(New, D-26)* **Given** results whose tracks carry no `track_id` — no resolvable artist, or no title — **Then** they still appear in the results and are still readable, are **not** rendered as dead links, and their count is disclosed on the page in one sentence. *(SM-C1; AD-11)*
5. **Given** the detail view, **Then** it shows identity and tags — title, artist, BPM, Camelot key, genre → subgenre — sourced from the play rows, with any absent field rendered per FR-2's **Unknown** convention rather than blank or guessed. *(FR-2; AD-11)*
6. **Given** `library_added_at` is present, **Then** the detail view shows when the track entered the library; **Given** it is absent, **Then** it renders as a distinct honest state — never guessed, never defaulted to the first play. *(Architecture Spine OQ#2; Decision B; AD-11)*
7. **Given** play history for the track, **Then** the detail view shows times played, first and last play, and the count of distinct sets — **And** lists those sets as rows linking into `/set/[id]`.
8. **Given** the track's plays, **Then** a **clock-time strip** shows what time of night the DJ drops it, with its hour labels resolved in the viewer's own timezone and never server-rendered. *(D-32; epic-4 unstoried note item (g), now homed)*
9. **Given** `played_ms`, **Then** the view shows how long the DJ typically rides the track as a **median with its n stated**, **And** plays missing `played_ms` are excluded with their count disclosed — never folded in, and never dropped to `0` in the case where every play is missing it. *(SM-C1; Story 4.7 R-2; D-33)*
10. **Given** the track's position in each set, **Then** **mix neighbours** render: what was played immediately before and after it, across all plays, ordered by recurrence, never crossing a set boundary. *(D-31)*
11. **Given** a track played exactly once, **Then** every aggregate above degrades honestly to its n=1 form — a single dot, a single neighbour pair, no median presented as though it were a distribution. *(D-8)*
12. **Given** low-confidence sets, **Then** both the search results and the detail view apply the same exclude-**visibly** contract as the rest of Epic 4, via `LibraryUtilizationReveal` and `listModel`'s compound predicate — a track's play count must not be silently inflated by soundchecks, nor silently reduced without the DJ being told. *(FR-27; Story 4.1 AC-2; D-34)*
13. *(New, D-38)* **Given** a DJ with a synced roster and zero sets, **Then** search works and returns owned tracks; **Given** a DJ with neither, **Then** one positive-framed insufficient state renders whose copy describes the same quantity its gate tests.
14. **Given** 375px and 320px, **Then** both surfaces hold with no horizontal overflow and every target meets WCAG 2.2 AA SC 2.5.8's 24×24 minimum, **measured against the DOM in a real browser**, with the clock-time strip and mix-neighbour lists carrying text equivalents and both surfaces fully keyboard-operable. *(UX-DR21, UX-DR22; 4.1's review lesson)*

## Tasks / Subtasks

- [ ] **Task 1 — Measure before building (stop-conditions).** (AC: 3, 4)
  - [ ] Re-run the four-command gate to establish the true baseline. **Recorded baseline at story creation: 596 tests / 28 files, `pnpm lint|typecheck|test|build` clean on `fix/4-5-4-11-status-bookkeeping` @ `0d9bf79`.** Report the new total; never report a total that went down without saying why. *(ai-8)*
  - [ ] Read production read-only: `select count(*)` across `djs`/`sessions`/`sets`/`plays`/`library_roster`. Story 4.9 measured 1/0/0/0/0 on 2026-08-08. **If production is no longer empty, stop and flag** — D-28's legacy path-hash branch stops being defensive-only and becomes a real population, and that is Arjun's call. Record the measurement, not the inference.
  - [ ] Measure, on the committed seed, how many `trackKey` groups have (a) a single non-null `track_id`, (b) no `track_id`, (c) ≥2 distinct `track_id`s. These three numbers set the expected values for D-26/D-28's tests and for AC-4's disclosure. Write them into the Completion Notes.

- [ ] **Task 2 — Carry the identity through the index.** (AC: 3, 4)
  - [ ] Add `trackIdByKey: Map<string, string | null>` to `UtilizationIndex` in `web/lib/sets/libraryUtilization.ts`, populated from the play rows the builder already walks. **Do not re-derive** — no fnv1a, no `normalize_identity_text`, in TypeScript (D-27). Doc-comment why, on the map itself, because that is the comment that survives into code review.
  - [ ] Fail closed on conflict: ≥2 distinct non-null ids for one key ⇒ `null` (D-28). Unit-test all three shapes.
  - [ ] Guard `""` as absent on both title and artist, with `.trim()` (Non-negotiable 9). `trackKey`'s doc comment claims "Normalized" and the function neither trims nor case-folds — do **not** change `trackKey` (that would silently re-partition Story 4.9's five shipped metrics); guard at the call sites this story adds.

- [ ] **Task 3 — The search index and field.** (AC: 1, 2, 4, 13; D-29, D-36)
  - [ ] Build the index in the model layer, not the component: one entry per track across played ∪ owned, carrying `trackId | null`, `title`, `artist`, `haystack` (lowercased title + artist), `state` (`played` | `owned`), `playCount`, `setCount`, `addedAt`. Dedupe across the two populations on `track_id` where both have one; a played track that is also in the roster is one entry, not two.
  - [ ] Filter client-side: every whitespace-split token must hit the haystack, `useMemo`, mirroring `SetListPanel.tsx:76-90` exactly.
  - [ ] Reuse `SpotlightSearch`'s visual language and its accessibility shape — real `<input>` with an explicit `aria-label`, decorative placeholder `aria-hidden`, icons `aria-hidden`, `<MotionConfig reducedMotion="user">`. `.spot-*` CSS already exists at `dashboard.css:1208-1330`. **Do not** copy its `role="tab"`/`aria-selected` chip pattern — `deferred-work.md:135` has it logged as an incomplete tablist (no roving tabindex, no `aria-controls`); this story must not add a fourth instance.
  - [ ] **Stop-condition: measure the serialized index size** at seed scale (653 roster + 1,055 identified played tracks) and state the number in the Completion Notes. If it exceeds ~150 KB, stop and flag rather than shipping it — a server-side search is the alternative and it needs its own ruling (GAP-5).
  - [ ] Cap rendered results, state the cap with the full match count, sort before capping (Non-negotiable 5). Native `<details>` for any "show more" — `EXPERIENCE.md:108` bans infinite scroll on track lists.
  - [ ] Placement per D-36: own client component, page level, inside the "Tracks" group above the `.lu-pair`, outside both `LibraryUtilizationView` and `renderBody`.

- [ ] **Task 4 — Link the two existing lists.** (AC: 3, 4)
  - [ ] Thread `trackId` into `WorkhorseRow` / one-and-done rows and through `TrackRowList`, making the row title a link when an id exists and plain text when it does not. Add the D-26/D-28 disclosure line — one sentence, `<p className="lu-disclosure">`, returning `null` (never "0 excluded") when nothing is excluded.
  - [ ] **Do not** add links to `AgingShelf`'s rows. Its rows are read-only by an explicit Arjun ruling (`deferred-work.md:7-11`) and changing them is not this story's call.
  - [ ] Verify `.lu > .lu-module { max-width: 440px }` still holds with a link inside a row — 4.4 verified a title—artist—value row truncates with ellipsis at 320px rather than pushing the value out; re-verify with the anchor.

- [ ] **Task 5 — The seam reads.** (AC: 5, 6, 7, 8, 9, 10, 12; D-30, D-31)
  - [ ] `getTrackPlays(trackId)` in `web/lib/sets/index.ts`, following `getSetById`'s shape verbatim (lazy import, no `dj_id` filter, try/catch, dev-only `console.error`, calm empty on failure, explicit bound). Embed `sets(id, started_at, derived, sessions(session_identity))` so one read serves the set rows, the clock strip and the confidence predicate.
  - [ ] `getMixNeighbours(...)` per D-31 — second bounded read, exact `(set_id, position)` pair filtering client-side.
  - [ ] `getTrackRosterEntry(trackId)` for the owned-but-unplayed case (D-38) — `library_roster`, `.is("absent_at", null)`, `.maybeSingle()`.
  - [ ] Tests reuse `index.test.ts`'s existing two-tier `mockSupabase` helper **verbatim** — it faithfully models postgrest-js (`from()` is not thenable and has no `eq`; only `select()`/`delete()` yield the filter builder). Assert: empty-for-new-account, read error ⇒ calm fallback + exactly one `console.error`, unexpected throw ⇒ calm fallback, and that the select string contains every required column **written out independently** (asserting against the exported constant is tautological).

- [ ] **Task 6 — The detail route.** (AC: 3, 5, 6, 7, 11, 12; D-37)
  - [ ] `web/app/(authenticated)/track/[track_id]/page.tsx` — server component, `params` is a `Promise`, one seam call, `notFound()` on `null`. No metadata export, no `loading.tsx`/`error.tsx`, no `export const dynamic`. Mirror `/set/[id]`'s 26-line shape.
  - [ ] Page shell mirrors `SetDetail`: `<main>` → `<SilkBackdrop />` → header → body. New `web/app/track-detail.css` with a `td-` prefix, **added to `globals.css`'s `@import` chain** or it silently does nothing.
  - [ ] Desktop nav clearance at the `900.02px` breakpoint — copy `.lu`'s or `.sd`'s `padding-left: calc(var(--nav-rail-inset) + var(--nav-rail-width) + var(--space-gutter))` block. `FloatingNav` needs **no** change: `isActiveNavItem` does an exact match, so `/track/…` has no active item, exactly like `/set/…` today.
  - [ ] Unknown fields render as FR-2 **Unknown**, never blank, never guessed (AC-5). Guard `""` (Non-negotiable 9).

- [ ] **Task 7 — `/track` into the phone gate.** (AC: all; D-35)
  - [ ] Add `"/track"` to `GATED_PREFIXES` in `web/lib/supabase/phone-gate.ts` and a case to `phone-gate.test.ts`. **This is the one omission that ships green and broken.**

- [ ] **Task 8 — Clock strip, ride time, mix neighbours.** (AC: 8, 9, 10, 11; D-31, D-32, D-33)
  - [ ] Model ships `startedAtMs` and `playedMs` only — no formatted strings (D-32). Hour labels and the strip's text equivalent are generated from the same client-side values so they cannot drift.
  - [ ] Ride time: median + n stated; n=1 renders the single duration and does not say "typically". Excluded-count disclosed and non-zero-collapsing (R-2). **Do not reuse `format.ts`'s `formatElapsed`** without checking its tiers: 4.4 found it coarsens above 60 days, which made a sorted list read as broken. A ride time is minutes-and-seconds — pick or write the scale-appropriate formatter and say which.
  - [ ] Mix neighbours: ordered by recurrence, no ranking words, no row numbers. Text equivalent for the list.
  - [ ] Every n=1 form gets a test (AC-11).

- [ ] **Task 9 — Gate + real-browser pass.** (AC: 14)
  - [ ] Four-command gate from `web/`: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Actually run them (ai-8).
  - [ ] Browser pass against a **production build** (`pnpm build` + `pnpm start`), **not `next dev`** — dev emits HMR-websocket errors that make "zero console errors" meaningless, and `NEXT_PUBLIC_*` are inlined at build time so `.env.local` must exist *before* `pnpm build`. Use a non-3000 port and **do not `pkill` a server you did not start** (4.7 killed another session's).
  - [ ] Populate via `supabase db reset` with the committed seed (`[db.seed] enabled = true`). Local-stack quirk: `docker restart supabase_kong_name-pending` afterwards or the auth route 502s. Login `dev@curfew.local` / `curfew-dev-password`. **Do not re-point `web/lib/sets/index.ts` at the fixtures** — that silently reverts Story 4.6 and is the failure D-23 exists to prevent.
  - [ ] **Measure the DOM** (`getBoundingClientRect()` via Playwright), do not eyeball a screenshot. Widths 1440 / 375 / 320. Hit-test sub-24px targets at four corners of a 24×24 box rather than trusting bounding boxes.
  - [ ] Drive **every** state, not just the populated one: no query, no match, a match with an id, a match with **no** id, an owned-not-played track, a track played exactly once, low-confidence hidden **and** revealed, a `null`-title play, and a deleted-set link. Story 4.5's pass found three defects living exclusively in non-populated branches.
  - [ ] Verify the outline is unchanged — four `<h2>`s — and **landmark count stays 2** on `/library-utilization`. Report warnings honestly; `[~]` rather than `[x]` if any appear.

- [ ] **Task 10 — Doc-sync, closed not deferred.** (AC: 1, 2)
  - [ ] `epics.md:972` — annotate the scope-boundary blockquote with D-25's ruling (struck through, ruling attached), and amend AC-1/AC-2 to match. Mark 4.11 AC-9 as discharged.
  - [ ] PRD §4.4 — track lookup and track detail are a post-PRD extension, the same shape 4.7/4.8 had to close. Add as **FR-31** (next free after FR-30) and extend §4.4's Description, which has already accreted stale once.
  - [ ] `EXPERIENCE.md` — Component Patterns row for the search field and the detail view.
  - [ ] `deferred-work.md` — log anything flagged-not-fixed in this story's own format; do not leave it untouched while the notes claim entries closed (4.9's review caught exactly that).
  - [ ] Re-check this story's own Dev Notes / File List against `git diff --stat` before promoting to review (ai-11, ai-14).

## Dev Notes

### Data inventory — everything this story can render, and nothing more

| Fact | Source | Nullable? |
|---|---|---|
| title, artist | `plays.title`, `plays.artist` / `library_roster.title`, `.artist` | yes (and `""` occurs) |
| bpm | `plays.bpm` `real` | yes — ~100% coverage measured |
| camelot key | `plays.camelot_key` `text` | yes — 98.8% |
| genre → subgenre | `plays.genre_raw`, `.genre_normalized`, `.taxonomy_version`, `.subgenre` — four columns, never collapsed (AD-12) | yes — 80.4% overall, **WAV/AIFF 0%, QuickTime 25%** |
| ride duration | `plays.played_ms` `bigint` | yes — ~98% |
| library add date | `plays.library_added_at` `timestamptz` | yes — ~6% missing |
| clock time | `plays.started_at` `timestamptz` | yes |
| set membership + order | `plays.set_id`, `plays.position` `int not null`, `unique (set_id, position)` | no |
| identity | `plays.track_id` `text` | **yes — ~21% of real plays are null** |
| owned-not-played | `library_roster` (`track_id`, `title`, `artist`, `added_at`, `is_baseline`, `absent_at`) | — |
| set label | `sessions.session_identity` via `formatSessionLabel` — **never `external_id`**, which post-4.6 is a uuid and has already shipped a `SET 872d5614-…` regression | — |
| confidence | `sets.derived->'confidence'->>'value'` + `track_count` — **jsonb, no column, unindexed** | cast, not validated |

**Does not exist anywhere in the cloud**: album, label, year, file path (AD-2 keeps it off the wire permanently), track duration (only *played* duration), artwork, rating, play count as a stored field. `library_roster` has **no bpm/key/genre** — Tier B is explicitly parked (Spine :205). Do not design a detail page that needs any of these.

### Reuse, don't rebuild

| Need | Use | Path |
|---|---|---|
| empty / insufficient state | `InsufficientHistory` (`{ copy? }`) — with **module-specific** copy | `components/style-evolution/InsufficientHistory.tsx` |
| exclude-visibly reveal | `LibraryUtilizationReveal` (`{ hiddenCount, excluding, including }`) — built for this story | `components/library-utilization/LibraryUtilizationReveal.tsx` |
| track row lists | `TrackRowList` (`{ rows, visibleRows, moreLabel }`) — server component, `<details>` disclosure | `components/library-utilization/TrackRowList.tsx` |
| module shell | copy `Workhorses.tsx` — `<div className="lu-module dz-shell" role="group" aria-label={summary}>` + `<h3 className="lu-stat-label">` + `<span className="dz-dots" aria-hidden>` | `components/library-utilization/Workhorses.tsx` |
| search UI + CSS | `SpotlightSearch` + `.spot-*` (already global) | `components/dashboard/SpotlightSearch.tsx`, `app/dashboard.css:1208` |
| hover readout | `CursorChip` + `useCursorChipTarget` | `components/ui/CursorChip.tsx` |
| page backdrop | `SilkBackdrop` | `components/dashboard/SilkBackdrop.tsx` |
| confidence predicate | `isLowConfidenceSet` | `lib/sets/listModel.ts:99` |
| disclosures | **not a component** — pure `string | null` builders in `lib/sets/*` rendered as `<p className="lu-disclosure">` | — |

There is **no** disclosure component, no dedicated empty-state component beyond `InsufficientHistory`, and no styled input suited to a live filter (`GhostInput` is uncontrolled and auth-form-shaped). Do not reach for shadcn.

### Recurring failure modes — the list this epic has paid for

Extended from `4-9…md:262-267`. Each has shipped at least once:

1. **aria/visible drift** — an accessible name stating a figure the visible UI withheld, or the same count twice in two registers. Hit 4.3, 4.5 (×3), 4.4, 4.9. *Guard: one generator, both duties; gate-blind summaries fall back to naming the region.*
2. **Copy that outlives its premise** — a string promising "their 90 days" after the same story retired the 90-day window; doc comments pointing at deleted files. *Guard: grep the diff for temporal and numeric claims before calling it done.*
3. **Disclosure counts dropping to 0 exactly when everything was excluded** (4.7 R-2, again in 4.9). The "never omitted" contract failing in the one case it exists for.
4. **An AC asserted in the completion notes but never implemented** (4.7 R-3). Re-read each AC against the running page, not against the notes.
5. **Shared CSS re-scoped for one call site, breaking another** — `.lu-module`'s width cap, `.se-empty`'s min-height. Both invisible to every gate.
6. **`""` bypassing null guards**, merging distinct tracks into one phantom row (4.9). **This story's highest-risk instance**, because search and identity both key on title/artist.
7. **Identity keys that don't normalize what their doc comment claims** — `trackKey` trims nothing and case-folds nothing, so `"Deep End"` and `"Deep End "` are two tracks.
8. **Null/duplicate labels producing duplicate React keys** — two `"Untitled set"` rows collide on both axes. AC-7 lists set rows.
9. **Copy asserting a false claim in the day-one state** — "every track you've played has come round again" at 0 plays.
10. **Antecedent/pluralization drift** — "1 plays", "1 unusable dates", "N of them" with the wrong antecedent.
11. **Hidden DOM cost from prerendered dual subtrees** — 4.9 emitted ~2,360 `<li>` to display 12. This story adds three more row lists to the same page.
12. **SSR/hydration mismatch from float precision and locale** — 4.7's 17-significant-digit inline style fired on every page load. D-32 exists so AC-8 does not become the next one.
13. **Binary/invisible files and stray dev routes shipping through green gates** — a raw NUL byte made `Workhorses.tsx` invisible to `git diff`, `git log -p`, PR review and `grep -r` while all four gates stayed green; 4.8's `/dev48` route was claimed deleted and wasn't. **If you create a temporary preview route, delete it and verify it is gone.**
14. **Divergent confidence predicates** — three exist; use `listModel`'s (D-34).

### Constraints inherited, not up for relitigation

- `getRecentSets()` is capped at **500 sets**. "Lifetime" means "within the 500 most recent". Name it in a comment; do not add a second query to work around it.
- The `(authenticated)` group has **no gating middleware** and only `dashboard/page.tsx` self-guards (`deferred-work.md:112`). Story 4.9 ruled this explicitly out of scope; do the same, deliberately, rather than half-fixing it on one new route.
- Every render of this page already fetches all 14 play columns of every set, uncached (`deferred-work.md:111`). Do not add a third full-history read.
- Window-governed modules render inside `LibraryUtilizationView`; window-independent ones are siblings (D-21). Search and track detail are window-independent.
- Do not extract the `useSyncExternalStore` + `localStorage` boilerplate — it is at 2 copies and 4.4 already declined to become the third. D-29 means this story does not add one either.
- `NFR-1`'s ≤500ms/≤10s budgets are scoped to the **agent**. There is no web-side budget — pick an explicit named cap and state it rather than citing a number that does not apply.

### Testing

Vitest 4, `vitest.config.ts` pins `TZ=UTC` and `LC_ALL=en-US` (4 tests failed under a different TZ and 20 under a different locale before pinning) — **so a UTC-passing test proves nothing about D-32's browser-zone rendering; test the epoch math, and verify the rendered hour in the browser pass.** Tests colocate as `<name>.test.ts(x)`. Pure functions in `lib/sets/*` carry the logic; component assertions use `renderToStaticMarkup` from `react-dom/server` with string matching and **a negative control per threaded prop** (`prop-threading.test.tsx`, D-24) — no RTL, no jsdom. `no-hardcoded-colors.test.ts` and `tokens.test.ts` gate any new CSS.

Four-command gate from `web/`: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. CI (`.github/workflows/ci.yml`) orders build before test and additionally runs the Rust suite, the additive-only migration guard, a from-scratch `supabase migration up`, and 209 pgTAP tests. **This story adds no migration, so the pgTAP count must not change** — if it does, something out of scope moved.

### Project Structure Notes

New files: `web/app/(authenticated)/track/[track_id]/page.tsx`, `web/app/track-detail.css` (+ `globals.css` import), `web/app/components/track-detail/*`, one `"use client"` search component under `web/app/components/library-utilization/`, and model + tests under `web/lib/sets/`. Modified: `lib/sets/index.ts`, `lib/sets/libraryUtilization.ts`, `lib/supabase/phone-gate.ts`, `library-utilization/page.tsx`, `TrackRowList.tsx`, `Workhorses.tsx`, `OneAndDone.tsx`.

Note the route-group path: `web/app/(authenticated)/track/…`, **not** `web/app/track/…`. Getting this wrong yields a route with no nav, no layout and no phone gate that still renders.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md:966-987`] — ACs 1-12 and the scope boundary (superseded in part by D-25).
- [Source: `_bmad-output/planning-artifacts/epics.md:1009`] — Story 4.11 AC-9, the widening this story discharges.
- [Source: `.../architecture/.../ARCHITECTURE-SPINE.md:64,96,102,120,144,189,198`] — AD-2, AD-7, AD-8, AD-11, AD-15, AD-21, AD-22.
- [Source: `supabase/migrations/20260730204057…`, `20260803190000…`, `20260807100000…`, `20260807110000…`] — the schema in the data inventory.
- [Source: `shared/src/index.ts:76-146, 311-346`] — `SyncPlay`, `SyncLibraryRosterEntry`. Frozen, additive-only.
- [Source: `web/lib/sets/index.ts:99-100`] — `SET_WITH_PLAYS_SELECT` already carries `track_id`.
- [Source: `web/lib/sets/libraryUtilization.ts:125-127`] — `trackKey`, the other key space.
- [Source: `web/lib/sets/listModel.ts:99-102`] — the compound low-confidence predicate.
- [Source: `web/lib/supabase/phone-gate.ts:23-30`] — `GATED_PREFIXES`, D-35.
- [Source: `web/app/(authenticated)/library-utilization/page.tsx:332-346`] — the slot this story was left.
- [Source: `_bmad-output/implementation-artifacts/4-3-…md:117,125-127`] — the identity change and its measured 21% cost.
- [Source: `_bmad-output/implementation-artifacts/4-9-…md:57,73,217-229,262-267`] — GAP-5/D-23, the browser-pass procedure, the recurring-failure list.
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md:7-11,73,95,111,112,135,471`] — prep-crate ruling, index reality, the 500-set horizon, per-render cost, the tablist debt, the artist-coverage measurement.
- [Source: `sprint-status.yaml:1127,1132,1145,1150,1168`] — ai-7, ai-8, ai-10, ai-11, ai-14.

## Dev Agent Record

### Agent Model Used

claude-opus-5

### Debug Log References

- Gate baseline re-run in a fresh worktree off `origin/main` @ `ac58637`.
- Production counts read read-only through the Supabase MCP (`select count(*)` only).
- Seed measurements taken against the local stack already seeded from the committed `supabase/seed.sql` (verified 2,294 plays / 653 roster rows before measuring).
- Payload measurements scripted against the seed's real title/artist strings, not estimated.
- Browser pass on a production build (`pnpm build` + `pnpm start`) on port **3010**, Playwright driving Chrome at 1440 / 375 / 320.

### Completion Notes List

**Task 1 — the three stop-conditions, measured not inferred (2026-08-10).**

1. **Gate baseline, fresh worktree @ `ac58637`:** `pnpm lint` clean, `pnpm typecheck` clean, **596 tests / 28 files**, `pnpm build` exit 0. *(One transient failure worth recording: the first `pnpm build` failed with `next/font/google` module-not-found — a network flake fetching Google Fonts, not a code failure. Re-ran clean and every subsequent build passed.)*
2. **Production, re-measured read-only:** `djs 1 / sessions 0 / sets 0 / plays 0 / library_roster 0` — **unchanged** from Story 4.9's 2026-08-08 measurement. **No stop.** D-28's legacy path-hash branch therefore stays defensive-only, covered by unit tests rather than by a browser state, exactly as D-28 anticipated.
3. **Committed seed, `trackKey` group shapes** (title non-null and non-blank):
   - **1,267** `trackKey` groups total
   - **(a) exactly one distinct non-null `track_id`: 1,055** — and 0 of those are "mixed" (some plays carrying the id, some null); all 1,055 are clean
   - **(b) no `track_id` at all: 212**
   - **(c) two or more distinct `track_id`s: 0** — D-28 is unreachable on the seed as well as in production
   - Supporting: 2,294 plays; 93 with a null/empty title; 473 with a null `track_id`; 1,055 distinct non-null `track_id`s; roster 653 rows, all `absent_at IS NULL`; 58 sets, of which **19** are low-confidence under `listModel`'s compound predicate (11 by `confidence.value < 1.0`, 12 by `track_count < 8`).
   - Also measured, because Non-negotiable 9 turns on it: **0 empty-string and 0 whitespace-only** titles or artists in either `plays` or `library_roster`. The `.trim()` guards this story adds are therefore **defensive on today's data** — which is precisely why they are written rather than inferred from a green test run.

**Task 3 — the payload stop-condition FIRED, and was ruled (D-39, Arjun 2026-08-10).**

D-29 as written — one object per track carrying a precomputed `haystack` — measures **498.9 KB** serialized at seed scale (1,644 entries), **3.3x** the ~150 KB bar. Breakdown: the actual content is only 92.5 KB of title+artist (avg title 39.7 chars, avg artist 17.9); the rest is per-entry JSON key names (~148 KB), the `haystack` duplicating title+artist, and a redundant `key`. Measured alternatives:

| encoding | raw | gzip |
|---|---|---|
| D-29 as written (objects + haystack + key) | 498.9 KB | 117.0 KB |
| lean objects (no haystack/key) | 277.3 KB | 67.5 KB |
| **tuple rows, haystack client-side — SHIPPED** | **157.2 KB** | **61.8 KB** |
| 6-tuple + sparse overrides for the 247 differing rows | 153.2 KB | 61.8 KB |

Ruled: tuple rows. D-29's architecture is untouched — the filter is still client-side over a server-built index, and the haystack is still built **once per index rather than once per keystroke** (a `useMemo` keyed on the rows array); only the wire encoding changed. **The shipped 157.2 KB is 4.8% over the nominal bar and that overage is stated rather than rounded away:** it is entirely AC-12's second count pair (6.4 KB), which is what lets the reveal be a swap rather than a recompute or a second read. The sparse-override form saves 4 KB and costs a second indirection on every read; declined.

**Two defects found by the browser pass that no gate could have caught.**

1. **Two identical reveal controls, ~200px apart.** The first build gave `TrackSearch` its own `LibraryUtilizationReveal`, so the page rendered "16 short or low-confidence sessions hidden — show them" twice — the identical-sentence-twice failure Story 4.5's review already ruled against for `undatedDisclosure`. Fixed by making the search field a **slot on the page's one reveal**, so a single boolean governs both surfaces and they can never describe different set populations at the same moment. Verified after the fix: typing a query, toggling the reveal, and finding the query still in the field with the counts correctly changed.
2. **Interactive targets under SC 2.5.8's 24x24 floor.** The row `<li>` carried `min-height: 24px`, but **the target is the anchor, not the row** — measured 18px for the set links, 20px for the neighbour titles and for `.lu-row-link`. Grown on the anchors themselves. Also caught at 320px: the ride-time readout wrapped mid-value ("3m" above "15s"), a single quantity split across two lines; fixed with `text-wrap: nowrap` on the figure plus `flex-wrap` on the row.

**Task 9 — browser pass, production build, port 3010, real DOM measurement.**

- **D-32 verified against the actual clock, not asserted.** This is the one thing `vitest` structurally cannot check, since `vitest.config.ts` pins `TZ=UTC`. Browser in `America/New_York`; the track's plays are stored at **15:00 UTC** and the strip rendered **11am**, with the accessible summary reading "Of 10 timed plays, 4 landed in the 11am hour". UTC rendering would have said 3pm. The pre-hydration branch emits a placeholder and no hour at all, which the component test pins independently.
- **Every state driven, not just the populated one:** no query; no match; a match with an id; a match with **no** id (rendered unlinked); an owned-but-never-played track (search row reads "Not played yet · added Sat, May 25"; detail page renders identity + add date + one honest line and **zero** empty modules); a track played exactly once (`Played once, for 1m 32s` — the word "typically" absent); low-confidence hidden **and** revealed on both surfaces; an unknown `track_id` (**404**); and a stale `/set/[id]` link (**404**, the same path a deleted-set row hits).
- **Outline and landmarks unchanged.** `/library-utilization` renders five `<h2>`s and **3** landmarks before and after this story — this story adds none. **Note the story's Task 9 asks to confirm "four `<h2>`s" and "landmark count 2"; both numbers were already stale before this story started**, because `AgingShelf` renders its own `<h2>` and its own `<section aria-label>` (the single logged exception, recorded in `page.tsx`'s own comment and in `deferred-work.md`). Reported as measured rather than as asked.
- **Targets:** `/track/[track_id]` — 28 targets, **0** under 24x24 at 1440/375/320. `/library-utilization` — 97 targets, **1** under the floor at every width: `.se-hidden-toggle` at 63.5 x 19.5, which is Story 4.1's shipped `LowConfidenceReveal` button shared with `/style-evolution`. Pre-existing, not introduced here, **flagged rather than fixed** — see `deferred-work.md`. *(A methodology note, because the first audit reported 76 false failures: rows inside a collapsed `<details>` keep layout boxes but are not hit-testable, and a scroll-and-hit-test loop races the scroll on a page this long. The numbers above are measured with every `<details>` opened and the scroll settled.)*
- **No horizontal overflow** at 1440 / 375 / 320 on either surface; mix-neighbour columns stack below 640px. **Zero console errors and zero warnings** on both pages.
- **Keyboard:** the field, every result link and every `<details>` toggle are reachable and operable; focus rings render on the new links; the field carries an explicit `aria-label` and its placeholder is `aria-hidden`.

**Deviations and flags — none silently resolved.**

- **D-36's two clauses are not both satisfiable** (placement "inside the Tracks group" vs. "renderBody is called twice"). The clause with the named failure mode governs; the field ships at page level as a slot on the reveal. Logged in `deferred-work.md` with the constraint to preserve if Arjun wants it moved.
- **`.se-hidden-toggle` fails SC 2.5.8** — pre-existing, shared with another page, flagged not fixed.
- **`SpotlightSearch`'s own placeholder is not `aria-hidden`** — noticed while reusing its shape; another story's component, flagged not fixed.
- `getMixNeighbours` needed `.in()` on `index.test.ts`'s `mockSupabase`, which the helper did not model. Added the same way the helper already models `is` vs `eq` — as a **distinct** method, so a test asserting the cross-product shape cannot pass against `eq`. The helper is otherwise reused verbatim.

**Post-implementation change, requested by Arjun (2026-08-10) — Story 4.9's set-similarity matrix.**

Two asks, both done on this branch even though the component is 4.9's: the axes are now **links into `/set/[id]`**, and they render **dates rather than Serato session numbers**. Recorded here because it widens this story's blast radius beyond its own File List.

- `SetSimilarityModel.labels: string[]` became `axes: SimilarityAxis[]` (`setId`, `label`, `dayLabel`) — the string never carried a route key. The session label is kept, not discarded: it rides the link's accessible name (`"Sat, Jun 13, SET 967"`), so the identity `SetDetail`'s header uses stays reachable and the two surfaces cannot read as different sets. Verified in the browser: clicking the `Sat, Jun 13` axis lands on a Set Detail whose header reads `SAT · 13 JUN 2026 · SET 967`.
- **Same-night collisions disambiguate with the real session number** (`Jun 13 · 975`), not a counter — two gigs in one night is ordinary, and `Jun 13 1` / `Jun 13 2` looks like a typo and identifies neither. The old numeric guard still runs behind it for the pair that shares a night *and* has no session label.
- **Making the axes interactive moved the `aria-hidden` boundary**, and this was the one genuine hazard in the change: focusable content inside an `aria-hidden` subtree is a keyboard trap. The attribute moved down off the grid and onto the cells, which is a strict a11y improvement — ten navigable set links where there were none, with the 100 cell percentages still out of the tree. Column headers are the same ten destinations, so they are `aria-hidden` + `tabIndex={-1}`.
- **One defect caught by re-measuring, not by the gate:** the phone-width ranked list's `.lu-row-title` wrapper was 24px while the anchors inside it were 18px — the same row-is-not-the-target mistake found earlier on the track rows. Fixed on the anchors. Re-measured at 375 and 320: 10 visible links, **0** under the floor, no overflow.
- Tests updated rather than deleted: the two disambiguation cases now assert date labels, plus a new case for same-night sets and one pinning `setId`/`label` alongside `dayLabel`. 719 tests / 31 files.

**Gate, after implementation.** `pnpm lint`, `pnpm typecheck`, `pnpm build` all clean; **719 tests / 31 files**, up from the 596 / 28 baseline (**+123 tests, +3 files**; no test was removed or skipped). **This story adds no migration, so pgTAP stays at 209** — `git diff --stat` confirms zero files under `supabase/migrations/`. Also verified against failure mode 13: no binary files and no stray NUL bytes in the diff, and no temporary/preview routes left behind.

### File List

**New**
- `web/app/(authenticated)/track/[track_id]/page.tsx`
- `web/app/components/track-detail/TrackDetail.tsx`
- `web/app/components/track-detail/ClockStrip.tsx`
- `web/app/components/track-detail/prop-threading.test.tsx`
- `web/app/components/library-utilization/TrackSearch.tsx`
- `web/app/track-detail.css`
- `web/lib/sets/trackDetail.ts`
- `web/lib/sets/trackDetail.test.ts`
- `web/lib/sets/trackSearch.ts`
- `web/lib/sets/trackSearch.test.ts`

**Modified**
- `web/app/(authenticated)/library-utilization/page.tsx`
- `web/app/components/library-utilization/LibraryUtilizationReveal.tsx`
- `web/app/components/library-utilization/TrackRowList.tsx`
- `web/app/components/library-utilization/Workhorses.tsx`
- `web/app/components/library-utilization/OneAndDone.tsx`
- `web/app/components/library-utilization/prop-threading.test.tsx`
- `web/app/components/library-utilization/SetSimilarity.tsx` *(Story 4.9's component — axes linked + date-labelled at Arjun's request, 2026-08-10)*
- `web/app/globals.css`
- `web/app/library-utilization.css`
- `web/lib/sets/index.ts`
- `web/lib/sets/index.test.ts`
- `web/lib/sets/libraryUtilization.ts`
- `web/lib/sets/libraryUtilization.test.ts`
- `web/lib/supabase/phone-gate.ts`
- `web/lib/supabase/phone-gate.test.ts`

**Docs (Task 10)**
- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/planning-artifacts/prds/prd-name-pending-2026-07-19/prd.md`
- `_bmad-output/planning-artifacts/ux-designs/ux-name-pending-2026-07-19/EXPERIENCE.md`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/4-10-track-lookup-and-track-detail.md` *(this file)*

Checked against `git diff --stat`: 30 files, and every one of them is listed above.

## Change Log

| Date | Note |
|---|---|
| 2026-08-10 | **Two decisions ruled by Arjun the same session.** D-25 confirmed: search covers played ∪ owned, honoring 4.11 AC-9 over 4.10's own pre-roster blockquote. D-26 confirmed: unlinkable rows stay readable, render unlinked, and their count is disclosed — the two full-coverage alternatives (trackKey-keyed route, hybrid fallback) were costed and declined. |
| 2026-08-10 | **Story created.** Fourteen decisions recorded (D-25..D-38) and six gaps named. Three were resolved rather than left for review: the epic's scope boundary for this story is stale post-4.11 and its own AC-9 assigns the widening here (D-25); `/track/[track_id]` is unreachable for ~21% of real plays by AD-11's design, so unlinkable rows are a disclosed state rather than a bug to route around (D-26/D-27/D-28); and AC-7's clock strip has no timezone anywhere in the system, so its labels must be produced client-side or become this epic's second unfixed hydration mismatch (D-32). Also caught: `/track` must join `GATED_PREFIXES` or the new route silently bypasses the phone-on-file gate (D-35) — the one omission in this story that ships green and broken. Baseline gate measured, not assumed: 596 tests / 28 files. |
