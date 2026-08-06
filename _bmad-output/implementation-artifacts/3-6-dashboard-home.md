---
baseline_commit: 29afe0ef446849dc14f06ce7005978a242463143
---

# Story 3.6: Dashboard home (+ the stat-correctness fixes that make it real)

Status: done (code review complete 2026-08-05, all 3 chunks — agent/Rust, web logic, dashboard React components, CSS/config)

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- SCOPE NOTE (Arjun, 2026-08-02): this story was deliberately widened past the epics.md "Dashboard home" line. The dashboard is only worth opening if the stats it shows are *usable and true*, so the agent-side data-correctness fixes that feed it (Camelot key recovery, genre source re-check, local backfill) are folded into THIS story, not split off. Downstream stories (3.7 / 3.8 / 5.1 / 5.2) also had details decided this session; those were written back into epics.md so nothing is lost — see "Downstream decisions recorded" in Dev Notes. -->

## Story

As a DJ,
I want a dashboard that shows my recent sets as cards with **accurate, usable** stats — keys that are actually there, genres read from the right place, and numbers drawn from the part of the night that was the dancefloor, not the warm-up or dinner —
so that the morning after a gig I land somewhere that reflects my night and is worth opening, the way a runner opens Strava (UJ-1, SM-2).

## Acceptance Criteria

### A. Dashboard surface (the epics.md 3.6 ACs, revised)

1. **Set cards.** Each synced set renders as a Card-Reflection card: hairline border, no shadow, **mono date + session-id header**, genre chips, energy-arc thumbnail. Clicking **anywhere** on the card opens Set Detail at `/set/[id]`. *(UX-DR4, UX-DR13, UX-DR17)*
2. **Cold state.** With no sets, the cold dashboard renders — positive-framed, After-Hours Archive console voice, **no error tone**. This is the day-one launch experience for every new user (Decision A: go-forward-only, sparse-first), so it is a first-class state, not a fallback. *(UX-DR19 cold dashboard)*
3. ~~**Passive NEW marker (REVISES the epics.md Add/Skip nudge).** A set that is synced but **not yet opened** shows an inline marker: lavender @20% border, pulsing lavender dot, "NEW SET DETECTED". **There is no Add button** — sets appear automatically (they already auto-sync). Opening the set clears the marker; the "seen" state persists **client-side, per-set**, and never re-prompts. Never a modal, never a push. Deletion (AC 12) is the only removal path. *(revises UX-DR5; keeps UX-DR19/UX-DR20 non-modal/non-push)*~~ **DROPPED (Arjun, 2026-08-06):** superseded by the dashboard-redesign row anatomy, which has no marker and reserves no room for one. Sets appear automatically via auto-sync regardless; nothing about discoverability regresses without it.
4. **Fixed app-shell scroll.** The dashboard page itself **does not scroll** — it is locked to the viewport (`100dvh`, not `100vh`, so mobile browser chrome never clips the frame). Only the set list scrolls, **inside its own bounded region**. The floating nav and any header stay put. Layout is the fixed centered 1100px grid adapting fluidly to tablet/phone. *(UX-DR22; Arjun 2026-08-02)*
5. **Card depth (exact allocation).** The card face shows ONLY: mono header · energy-arc thumbnail · 2–3 genre chips · **set length** + **track count**. Everything else in the derived blob (most-played tracks/artists, BPM distribution, Camelot mixing stats, full annotated chart, tracklist) is **reserved for Set Detail (3.7)**. The card is the glance; the click earns the depth. *(Arjun 2026-08-02)*

### B. Dancefloor v0 — basic detection from the jump

6. **Suggested dancefloor segment, computed at render from `plays[]`.** A basic detector (global-heuristic v0) buckets the set into ~10-minute windows, scores each on play-density + median BPM, takes the **longest contiguous run** of windows clearing simple floors as the dancefloor, and merges small gaps. It yields **zero, one, or several** candidates and **falls back to the whole set** when nothing qualifies or the qualifying run spans essentially the whole night (never force exactly one). *(AR-13 shape)*
7. **Stats reflect the dancefloor.** The card's length / track-count / genre / and the emphasized region of the arc thumbnail reflect the detected dancefloor segment (recomputed from `plays[]`), so numbers are "not clouded by unrelated tracks" (Arjun). The arc thumbnail still draws the **full night** with the dancefloor window emphasized.
8. **Explicitly interim.** v0 uses **global** density/BPM floors. AR-13 mandates **per-DJ-calibrated** floors ("never a global constant") — that calibrated version is **Story 5.2** and supersedes v0. This story ships the interim knowingly and the code/comment must say so (do not silently ship a global constant as if it were AR-13-final). *(AR-13, tracked interim)*

### C. Stat-correctness fixes (agent / Rust — the data feeding A & B)

9. **Camelot key recovery.** The Serato-4 joiner must read Serato's canonical **`key_value` INTEGER** column (not, or in addition to, the mixed free-text `key`) and map deterministically:
   - `key_value == -1` → no key (`None`)
   - else `number = (key_value % 12) + 1`; `letter = key_value < 12 ? 'A' : 'B'`
   
   This recovers ~94% key coverage (was ~12% on real data — see Dev Notes). The false premise *"key is already Camelot notation at the source (findings §3)"* in `joiner/mod.rs:30` and the `JoinedMetadata.key` doc is retired/corrected. A capture-path test asserts a musically-notated Serato library (`Em`, `Ebm`, `G#m`…) yields populated Camelot keys, not `None`. *(FR-6 harmonic mixing; fixes Story 1.4/1.8 assumption)*
10. **Genre source re-check.** Before trusting the ~50%-untagged genre rate observed in real data, verify we read genre from the **richest available Serato source** (compare `history_entry.genre` vs the library `asset` genre, and the embedded-tag fallback). If a richer source exists, read it; if ~50% is genuinely the ceiling, record that finding so the UI's genre-chip fallback is designed against truth, not a bug. *(FR-8 / AD-12; investigation-then-fix)*
11. **Backfill the already-captured sets.** Re-derive the **491 already-captured local sets** from retained raw (`captured_sessions.raw_ref` → the live Serato `master.sqlite#<session_id>`) through the **fixed** joiner, overwriting `plays_json` / `derived_json` so historical sets carry correct keys/genres. Idempotent, no data loss; uses Story 3.4's retained-raw backfill mechanism. (Nothing is cloud-synced yet — `synced_at` is NULL for all rows — so this is purely local re-derivation.) *(NFR-4, Story 3.4 backfill; AR-2 idempotency)*

### D. Data source + real fixture

12. **Delete a set.** A DJ can delete a set (the removal path that replaces the old "Skip"). For this story the affordance and its calm, non-alarm confirm live on **Set Detail (3.7)**; 3.6 must not block it (the `/set/[id]` route exists) but need not implement the deleted-state re-render beyond removing the row from the local data source. Semantics: hard-delete the local captured row (and, once cloud sync exists, the cloud row) — **not** a visibility flag. *(new requirement, Arjun 2026-08-02)*
13. **Render from real data, not lorem-ipsum.** Extract real set(s) from the agent's `local.sqlite` (`~/Library/Application Support/app.curfew.agent/local.sqlite`, e.g. set **975** = 5.9h / 178 plays / confidence 1.0, plus a 1-play soundcheck like id 17577 to exercise low-confidence + sparse states) and commit them as a **wire-shape JSON fixture** in `web/` (epoch → ISO conversion at build time per the frozen contract). The dashboard reads through a **data-access seam** that later swaps the fixture for the Supabase read path without touching components. *(Decision A sparse-first; SM-1)*

### E. Liquid-metal CTA + voice/a11y

14. **Liquid-metal button component.** Install `@paper-design/shaders`; add the liquid-metal button to `app/components/ui/` (new dir — the shadcn `ui` alias target). Adapt it: `'use client'`, dynamic import with `ssr:false`, **reduced-motion path** (freeze the shader via `setSpeed(0)` and drop the ripple under `prefers-reduced-motion`), move its `document.head` `<style>` injection into `globals.css`, and map its colors to Obsidian tokens (decide: true-chrome vs lavender-tinted — a **new material** in the palette). It is a **designated hero/CTA** component used where a primary CTA exists (Arjun wants it in-product too, not only marketing); it is **WebGL-context-limited (~16/page)** so it is used at 1–2 hero moments, **never** as a general Button variant. *(Arjun 2026-08-02 design direction)*
15. **Voice, motion, a11y.** All copy uses the After-Hours Archive console voice; **no** streak counters / celebratory badges / "crushing it" / exclamations; no scroll-driven or celebratory motion on this logged-in surface; WCAG 2.2 AA holds; the energy-arc thumbnail has a text-equivalent. *(UX-DR18, UX-DR20, UX-DR21 — SM-C2 non-negotiable)*

## Tasks / Subtasks

- [x] **Task 1 — Fix Camelot key capture (agent/Rust)** (AC: 9)
  - [x] Add `key_value` to the `history_entry` SELECT in `agent/src-tauri/src/joiner/serato4.rs:135` and to the test-harness schema/inserts (`serato4.rs:172-196`, and the three ad-hoc schemas at ~392/430/477).
  - [x] Map `key_value` → Camelot on the library-join path: `-1 → None`; else `format!("{}{}", (v % 12) + 1, if v < 12 {'A'} else {'B'})`. Prefer `key_value` as source of truth; keep the free-text `key`/embedded-tag path only as fallback for sources without `key_value`.
  - [x] Correct the false doc premise in `joiner/mod.rs:30` and `JoinedMetadata.key`'s doc comment ("already Camelot notation at the source (findings §3)").
  - [x] Test (capture-path, layer 1): a musically-notated Serato library (`Em`, `Ebm`, `G#m`, plus a `-1`) yields populated, correct Camelot keys and one `None` — asserting the 24/24 mapping, not string round-trips. This is the regression that would have caught the incident.
- [x] **Task 2 — Genre source re-check (agent/Rust)** (AC: 10)
  - [x] Compare genre fill/quality between `history_entry.genre` and the library `asset` genre for real data; document which is richer.
  - [x] If `asset` (or a join to it) is materially richer, read from there; otherwise record the ~50%-untagged rate as a real ceiling in Dev Agent Record so the UI fallback is designed against truth. Respect Story 1.6 normalization (raw + normalized + `taxonomy_version`).
- [x] **Task 3 — Backfill captured sets (agent/Rust)** (AC: 11)
  - [x] Re-derive every `captured_sessions` row from its `raw_ref` through the fixed joiner + stat engine; overwrite `plays_json`/`derived_json`. Idempotent; skip rows whose raw source is unreachable (drive unplugged) rather than corrupting them.
  - [x] Reuse Story 3.4's backfill entry point rather than a new mechanism. Verify on set 975: keys go from 21/178 → ~177/178.
- [x] **Task 4 — Real-data fixture + data-access seam (web)** (AC: 13, 5)
  - [x] After Task 3, export set 975 (+ a 1-play low-confidence set, + optionally a warmup-heavy set to exercise the dancefloor cut) to a committed wire-shape JSON fixture under `web/` (epoch→ISO conversion, `SyncSetDerived`/`SyncPlay` shapes from `shared/`).
  - [x] Add a `getRecentSets()` data-access module the dashboard imports; back it with the fixture now, structured so the Supabase read path swaps in later with zero component change.
- [x] **Task 5 — Dancefloor v0 detector + segment-scoped stats (web)** (AC: 6, 7, 8)
  - [x] Pure function `detectDancefloor(plays)` → `{start, end} | null` (window bucketing, density+BPM floors, longest contiguous run, gap-merge, whole-set fallback). Global constants, **commented as interim / superseded by Story 5.2 AR-13**.
  - [x] Pure function to recompute the card-facing stats (length, track count, genre breakdown) over a segment from `plays[]`; unit-test against set 975 and the whole-set-fallback case.
- [x] **Task 6 — Set card component (web)** (AC: 1, 5)
  - [x] `app/components/ui` or `app/components/dashboard` set card: mono header, genre chips, length + track count, whole-card link to `/set/[id]`. Hairline border, no shadow, Obsidian tokens only.
- [x] **Task 7 — Energy-arc thumbnail (web, reusable)** (AC: 1, 5, 7, 15)
  - [x] Build the mini arc renderer as the **reusable** energy-arc primitive (thumbnail mode now; Story 3.8 adds the full annotated/captioned chart mode over the same core). Lavender 2px stroke, no fill; emphasize the dancefloor window. Provide a text-equivalent (min/max/direction) for a11y.
  - [x] Heed the `@property`/`setProperty` gotcha (memory `ref-property-setproperty-bug`): if any CSS custom prop is animated at runtime, use an **unregistered** var + rAF lerp, not a registered `@property` + `setProperty`.
- [x] **Task 8 — Fixed app-shell + list scroll (web)** (AC: 4)
  - [x] Lock the dashboard to `100dvh`; make the set list the only scroll container (its own `overflow-y:auto`); keep nav/header fixed. Verify no horizontal body scroll and no mobile-chrome clipping at 375px.
- [x] **Task 9 — Cold state + ~~passive NEW marker~~ (web)** (AC: 2, ~~3~~)
  - [x] Cold state copy (console voice, sets go-forward expectation calmly). ~~NEW marker as a passive treatment on unopened sets; per-set "seen" in `localStorage`; cleared on open. No buttons, no modal, no push.~~ **DROPPED (Arjun, 2026-08-06)** — see AC-3 above.
- [x] **Task 10 — `/set/[id]` route stub + delete seam (web)** (AC: 1, 12)
  - [x] Create the `/set/[id]` route so card clicks resolve (minimal placeholder; Story 3.7 fills it). Ensure the data-access seam supports a delete that removes the row from the source (full delete UI is 3.7).
- [x] **Task 11 — Liquid-metal CTA component (web)** (AC: 14)
  - [x] `pnpm add @paper-design/shaders`; create `app/components/ui/` and add the adapted liquid-metal button ('use client', dynamic `ssr:false`, reduced-motion freeze + no ripple, tokenized colors, `<style>` moved to `globals.css`). Document the WebGL-context limit in the component so it is never spread across many instances.
  - [x] Wire it as the primary CTA where one exists on this surface; if none is natural on the dashboard itself, land the component + one demo usage and note the marketing/subscribe/login placements for their stories.
- [x] **Task 12 — Voice/motion/a11y pass + gates** (AC: 15)
  - [x] After-Hours Archive copy review (no celebratory/exclamatory strings). Reduced-motion + keyboard + WCAG 2.2 AA check. Run the full repo gate (agent: cargo build/fmt/clippy -D warnings/test; web: pnpm lint/typecheck/test) green, and a real browser walkthrough (the 3-5 retro proved code review alone missed two real bugs).

### Review Findings

_Scope note: this pass covered the agent/Rust stat-correctness layer + web dashboard logic/lib (27 files, chunk 1 of 2). The UI/styling layer (dashboard.css, tokens, Silk/GlassCalendar/MetalButton/SetListPanel/etc., ~22 files) is a follow-up run._

- [x] [Review][Decision] Hero band stat strip contradicts the locked D8 design and reintroduces reserved Camelot stats — `describe.ts`'s `stats` array produces `SET LENGTH · TRACKS · PEAK BPM · IN-KEY BLENDS`, but `PLAN.md` D8 (locked 2026-08-03) specifies `dancefloor songs · median BPM · average BPM`, and `IN-KEY BLENDS` (`camelot_mixing_stats.compatible_transitions`, `describe.ts:127-128`) is exactly what AC-5 names as reserved for Set Detail. **Resolved (Arjun, 2026-08-05): keep the shipped stat set** — ruling logged in `dashboard-redesign/REFINEMENTS.md` ("Hero stat strip — ruling supersedes D8"). No code change.
- [x] [Review][Decision] `FloatingNav.tsx` was substantially rewritten (liquid-metal rail, `CursorChip` hover system, focus/blur handling, rail/dock media-query branching) despite this story's own Dev Agent Record stating it was "left untouched and excluded from this story." **Resolved (Arjun, 2026-08-05): the rewrite was intentional** (part of the 2026-08-03 redesign refinement pass) — corrected the stale Dev Agent Record note in the "NOT part of this story" section above rather than treating it as scope creep.
- [x] [Review][Patch] Genre chips have no data path from the dashboard row model — `topGenres()` (`format.ts:80-86`) and `segmentStats().genre_breakdown` (`dancefloor.ts:135-138,177-180`) both exist and are AC-5-labeled, but `listModel.ts`'s `buildSetRows()` never calls `topGenres(floor.genre_breakdown)` or includes a genre field on `SetRowModel`. [web/lib/sets/listModel.ts:84-98] — **Fixed:** added `genreChips: string[]` to `SetRowModel`, wired via `topGenres(floor.genre_breakdown)`.
- [x] [Review][Patch] Card stats mix dancefloor-scoped and whole-set numbers on the same row — `durationLabel` uses `set.derived.set_length_sec` (whole-set) while `floorCount` on the same object uses `floor.track_count` (dancefloor-scoped), contradicting AC-7 and the D9-locked "dancefloor track count · duration" pairing. [web/lib/sets/listModel.ts:89-90] — **Fixed:** `durationLabel` now uses `floor.set_length_sec`.
- [x] [Review][Patch] `detectDancefloor`'s window-bucket index only clamps the upper bound (`Math.min(windowCount-1, …)`), no lower clamp — an out-of-chronological-order `plays[]` produces a negative index, and `windows[w].push(p)` throws on `undefined`, crashing the whole dashboard render (reached via `buildSetRows` for every set in one call). `segmentStats`'s length calc has the same unsorted-input assumption with a quieter wrong-number failure mode instead of a crash. [web/lib/sets/dancefloor.ts:82, 166-172] — **Fixed:** added a `Math.max(0, …)` clamp to the window index; `segmentStats`'s length calc now derives the span from actual min/max epoch instead of array position.
- [x] [Review][Patch] `backfill_captured_serato4`'s `rows_with_status` query-error branch returns silently with no `reporter.report(...)` call, unlike the write-failure path a few lines below in the same function — a systemic DB read failure would be indistinguishable from "nothing to backfill," forever. [agent/src-tauri/src/backfill.rs:147-149] — **Fixed:** reports on the query-error branch (the "no source configured" branch stays silent by design).
- [x] [Review][Patch] `mark_for_resync`'s result is discarded with `.ok()` and `changed` still increments even when clearing the resync flag fails — the local row is corrected but the cloud correction can silently never get queued, with no error reported. [agent/src-tauri/src/backfill.rs:209] — **Fixed:** reports on failure; `changed` still increments (the local write did succeed).
- [x] [Review][Patch] `formatDuration` has no NaN guard; reachable via `segmentStats`'s length calc if a non-null-but-unparseable `started_at` slips into `plays[]` (that filter only checks for `null`, not parseability, unlike the sibling `timedPlays()` in the same file). Renders literal "NaNh NaNm" on a card. [web/lib/sets/format.ts:24-34] — **Fixed:** added `!Number.isFinite(seconds)` to the early-return guard.
- [x] [Review][Patch] Whitespace-only `full_name`/`dj_name` wins over a valid fallback name, producing a nameless greeting. Superseded by Story 3.10's `resolveFirstName` helper (the old inline `getFirstName` in dashboard/page.tsx no longer exists). [web/lib/account/greeting.ts] — **Fixed:** `full_name`/`name` now require `.trim() !== ""` before winning the precedence chain, matching the guard `djName` already had.
- [x] [Review][Patch] `rightColumn.ts` contains a literal null byte used as a Map-key delimiter (`` `${title}\x00${artist}` ``) — this is why git renders the whole file as a binary diff, which made it invisible to all three review layers this pass. Not a runtime bug, but it silently defeats diff/review tooling for this file permanently. [web/lib/sets/rightColumn.ts:67] — **Fixed:** delimiter replaced with `JSON.stringify([title, artist ?? ""])`; file now diffs as text (confirmed 0 null bytes remain — git still shows this specific diff as binary because the *previous* committed blob still has it; the next commit's diff will render as text).
- [x] [Review][Defer] Camelot mapping's doc-comment claim ("verified 24/24 against real data, 20k+ rows") isn't backed by a committed script/artifact — the mapping function itself is unit-tested with correct boundary cases, so this is a reproducibility/documentation gap, not a correctness concern. [agent/src-tauri/src/joiner/serato4.rs:174-175] — deferred, pre-existing documentation practice
- [x] [Review][Defer] Dancefloor density-floor tuning is a known interim gap (explicitly commented, superseded by Story 5.2/AR-13); structural bias toward short-track genres is real but is the acknowledged reason 5.2 exists. [web/lib/sets/dancefloor.ts:23] — deferred to Story 5.2
- [x] [Review][Defer] `MIN_PLAYS_FOR_DETECTION` (dancefloor.ts) and `HERO_MIN_TRACKS` (hero.ts) are two separately-hardcoded `6`s linked only by a comment. [web/lib/sets/dancefloor.ts:21, web/lib/sets/hero.ts:10] — deferred, low-cost hardening not a bug today
- [x] [Review][Defer] Backfill sweep re-reads/re-derives all captured serato4 rows on every startup with no "already fully backfilled" skip-flag; bounded by the self-terminating unchanged-comparison and a ~491-row ceiling. [agent/src-tauri/src/backfill.rs:137-213] — deferred, real but bounded
- [x] [Review][Defer] `FloatingNav.tsx`'s `:focus-visible`-dependent focus handling reintroduces a pattern that was the source of a Safari regression fixed in Story 3.9; `RAIL_QUERY = "900.02px"` is synced to `dashboard.css`'s 900px breakpoint only by comment, no shared token. [web/app/components/nav/FloatingNav.tsx:20, 180] — deferred to the UI/styling review pass
- [x] [Review][Defer] `export_real_fixtures.rs`'s `SETS` constant hardcodes real gig dates/play-counts as source comments — privacy/data-hygiene nitpick on an env-gated dev tool, not shipped user-facing behavior. [agent/src-tauri/tests/export_real_fixtures.rs] — deferred, dev-tool only
- [x] [Review][Defer] `arcDirection`'s first-vs-last BPM delta can label a set with a dramatic mid-set arc as "steady" — a copy-quality nuance, not incorrect data. [web/lib/sets/describe.ts:61-67] — deferred, copy polish
  > ✏️ **Correction (chunk 2/2 review, 2026-08-05):** moot — `describe.ts` turned out to be dead code once the UI/styling chunk was reviewed (see below). No live consumer, so this finding no longer applies to anything that renders.

### Review Findings — chunk 2/2 (UI components)

_Scope: React UI components introduced by the dashboard redesign (16 files) — Silk/SilkBackdrop, GlassCalendar, HeroBand, MetalButton/liquid-metal-button/metal-hooks, MostPlayedCard/OdometerCard/ConfidenceTile/RightColumn, SetListPanel, SpotlightSearch, CursorChip, tokens.test.ts. The CSS/config group (dashboard.css, tokens.css, globals.css, package.json etc., ~2.5k lines) is a further follow-up if wanted._

- [x] [Review][Defer] **AC-3's passive NEW marker (unopened-set indicator) has silently vanished.** Chunk 1's review confirmed Task 9 (cold state + passive NEW marker) shipped in the original 2026-08-02 dev session. This chunk's `SetListPanel.tsx` wholesale-replaces that row rendering with the redesigned D4/D9 list, and the concept doesn't survive: `SetRowModel` has no `isNew`/`seen` field, `SetListPanel.tsx` never renders a badge/dot/border-tint per row, and there is no `useSeenSets` hook, `ColdState.tsx`, or `SetCard.tsx` left anywhere in the tree (confirmed: zero matches for "NEW SET"/`isNew`/`useSeenSets`/`markSeen`/`seenSets` under `web/app`). Neither `PLAN.md` nor `REFINEMENTS.md` records a decision to drop this AC — unlike the tracklist/BPM changes in chunk 1, which were explicitly logged. **Deferred (Arjun, 2026-08-05): low priority right now** — reimplement in the new row anatomy or consciously drop AC-3/Task 9 in a future pass; needs a design call on placement, not a quick same-session ruling.
  > ✏️ **RULED (Arjun, 2026-08-06): drop it.** AC-3/Task 9 are revised below to remove the passive NEW marker as a requirement — the redesigned row anatomy has no marker and none is owed. No code change (there was nothing left to remove).
- [x] [Review][Patch] `GlassCalendar.tsx`'s view-tab `onClick` runs its sync logic unconditionally, even when clicking the already-active tab — clicking "Monthly" while already on Monthly (after navigating months forward via the chevrons) resets `currentMonth` back to `weekStart`'s stale initial value, silently discarding the navigation. [web/app/components/dashboard/GlassCalendar.tsx:158-162] — **Fixed:** added `if (v === view) return;` guard.
- [x] [Review][Patch] `SpotlightSearch.tsx`'s sort-by-date/length chips are gated purely on `hovered` (set only by `onMouseEnter`/`onMouseLeave`, no keyboard equivalent) — per the file's own doc comment these are the *only* way to change list ordering, so keyboard/touch users can never reach them. [web/app/components/dashboard/SpotlightSearch.tsx:114-115,150] — **Fixed:** added `onFocus`/`onBlur` (with a `contains(relatedTarget)` check so focus moving within the group doesn't hide the chips).
- [x] [Review][Patch] `tokens.test.ts`'s `TEXT_45` constant (`#eaf3f873`) is stale — `--color-abyss-text-45` was lifted to `#eaf3f885` (REFINEMENTS.md item 12, 2026-08-03) and now measures 4.63–5.18:1 (clears normal-text AA 4.5:1), but the test still asserts the old value against only the weaker 3:1 large-text floor, so it gives zero regression protection for the token actually shipping. [web/app/tokens.test.ts:145,163-167] — **Fixed:** value corrected to `#eaf3f885`, assertion upgraded to `AA_NORMAL_TEXT_MIN` (verified 5.09–5.19:1 against all three surfaces); comment updated.
- [x] [Review][Patch] `web/lib/sets/describe.ts` is orphaned dead code — zero importers anywhere in the tree. `HeroBand.tsx` independently reimplements equivalent (and actually D8-matching: "Dancefloor tracks · Median BPM · Average BPM") logic inline via `dancefloor.ts` directly. This also means the chunk-1 review's decision-needed ruling ("keep describe.ts's 4-stat hero output") was resolved against code that never runs — see correction note above. — **Fixed:** file deleted (no test coverage depended on it).
- [x] [Review][Patch] `ui/liquid-metal-button.tsx`'s ripple cleanup depends solely on a CSS `animationend` event — if the animation is interrupted or the element is hidden/detached before it fires, the ripple `<span>` leaks permanently. The sibling `MetalButton.tsx` in this same diff uses a more robust `setTimeout`-based cleanup. [web/app/components/ui/liquid-metal-button.tsx:84-91] — **Fixed:** added a 600ms fallback timer, cleared if `animationend` fires first.
- [x] [Review][Patch] `MetalButton.tsx` has no fallback fill when `colors` is `null` (pre-hydration / unsupported `getComputedStyle`) — the sibling `liquid-metal-button.tsx` explicitly implements a fallback gradient "so the CTA never renders as a bare rectangle"; this one renders empty until the token read resolves. [web/app/components/dashboard/MetalButton.tsx:116-136] — **Fixed:** added a `background` fallback on `.mtl-shader` in `dashboard.css` using the metal-abyss tint/back tokens.
- [x] [Review][Patch] `SetListPanel.tsx`'s calendar-day auto-expand `setTimeout(() => open(dayRows[0]), 450)` isn't tracked in a ref or cleared on unmount, unlike its sibling `unmountTimer`/`pulseTimer`. [web/app/components/dashboard/SetListPanel.tsx:125,132-137] — **Fixed:** added a tracked `autoOpenTimer` ref, cleared on unmount and before reassignment.
- [x] [Review][Patch] `SetListPanel.tsx`'s `close()` unconditionally starts a new 600ms unmount timer even when no sheet is open — every Escape keypress anywhere on the page (or a calendar-day click with nothing to close) churns a wasted state update + timer. [web/app/components/dashboard/SetListPanel.tsx:96-100,104-105] — **Fixed:** added `if (!sheetRow) return;` guard.
- [x] [Review][Patch] `ConfidenceTile.tsx` checks `pct != null` but not finiteness — a NaN confidence value would render the literal string "NaN%". [web/app/components/dashboard/ConfidenceTile.tsx:10] — **Fixed:** switched to `Number.isFinite(pct)`.
- [x] [Review][Defer] `Greeting.tsx`'s `useSyncExternalStore` subscribe is a permanent no-op — the day-part greeting goes stale across a 5am/12pm/6pm boundary on a long-lived tab. Real but low-consequence and narrow (a DJ leaving the dashboard open overnight). [web/app/components/dashboard/Greeting.tsx:17-23] — deferred, cosmetic
- [x] [Review][Defer] `Silk.jsx`'s `hexToNormalizedRGB` has no format validation — a malformed hex produces NaN color channels. Currently only fed by internal design tokens, not user input. [web/app/components/Silk.jsx:11-18] — deferred, low reachability
- [x] [Review][Defer] Aggregate WebGL context budget (Silk's permanent canvas + up to 2 simultaneous LiquidMetal instances when a sheet is open over the hero) is documented per-component but never reconciled against real device context limits. — deferred, needs device testing not a code read
- [x] [Review][Defer] Incomplete ARIA tablist pattern across `GlassCalendar`/`MostPlayedCard`/`SpotlightSearch` chips (`role="tab"`/`aria-selected` without roving tabindex, arrow-key nav, or `aria-controls`); `GlassCalendar` day buttons also expose selection only via a CSS-only `data-selected` hook, no `aria-pressed`/`aria-current`. — deferred, better tackled as one a11y pass across all three than three point-patches
- [x] [Review][Defer] `RightColumn.tsx`'s `ResizeObserver` is attached to the scrolling container, which doesn't fire when children grow without the container's own box changing (OdometerCard count-up, MostPlayedCard AnimatePresence) — scroll-fade indicators can go stale until the next manual scroll. [web/app/components/dashboard/RightColumn.tsx:29] — deferred, cosmetic
- [x] [Review][Defer] `SetListPanel.tsx`'s expanded sheet geometry is computed once at open-time with no resize/rotation handling. [web/app/components/dashboard/SetListPanel.tsx:80-94] — deferred, narrow (viewport resize mid-interaction)
- [x] [Review][Defer] `CursorChip.tsx`'s cursor-follow rAF lerp isn't gated by `prefers-reduced-motion` (only the content fade/scale is, via Framer Motion). [web/app/components/ui/CursorChip.tsx] — deferred, minor motion-compliance gap
- [x] [Review][Defer] `MetalButton.tsx` ripple position for keyboard-triggered clicks uses `e.clientX`/`clientY`, browser-dependent for synthetic events — could render the ripple in the wrong spot. [web/app/components/dashboard/MetalButton.tsx:69-79] — deferred, cosmetic
- [x] [Review][Dismiss] `RightColumn.tsx` missing a `typeof ResizeObserver === 'undefined'` guard — supported in all evergreen browsers (incl. Safari) since 2020, not a realistic gap for this app's target environment.

### Review Findings — chunk 2/2 (CSS/config, final sub-chunk)

_Scope: `dashboard.css` (~1980 lines), `globals.css` (~360 lines), `tokens.css` (~150 lines), plus trivial `components.json`/`eslint.config.mjs`/`package.json` diffs. This closes out Story 3.6's review — all three chunks now complete._

- [x] [Review][Decision] **AC-4/D9's fixed-viewport scroll lock is released below 900px, self-flagged in code but never elevated to an approved decision.** `dashboard.css:216` (`@media (max-width: 900px) { .dz { height: auto; overflow: visible; } }`) makes the whole page scroll on phone/tablet widths, contradicting AC-4's unconditional text ("the dashboard page itself does not scroll... adapting fluidly to tablet/phone") and D9's "hard requirement" that "the page, hero, and right column never move." The code's own comment (`dashboard.css:16-19`) concedes this is "a deviation from the desktop zone map, not from any ref mechanic" — but unlike every other sanctioned deviation in this story, it was never logged in `PLAN.md`/`REFINEMENTS.md`'s decision record. **Resolved (Arjun, 2026-08-05): approved as an intentional mobile exception** — ruling logged in `dashboard-redesign/REFINEMENTS.md` ("Mobile scroll-lock exception supersedes AC-4/D9"). No code change.
- [x] [Review][Patch] `.conf-hint`, `.mp-label`, and `.cal-dow` all use `--color-abyss-text-22` (~1.85:1 contrast against the shell background) for real copy — "Improves as you correct set edges.", "Track"/"Artist" labels, and weekday-initial headers — directly contradicting the token's own doc comment in this same diff ("decorative only, never copy"). Far below both the 4.5:1 normal-text and 3:1 large-text AA floors. [web/app/dashboard.css:1413,1615,1667; web/app/tokens.css:342] — **Fixed:** all 4 uses of `text-22` for real copy (also caught `.dz-sheet-tracklist li::before`'s track-number counter, same violation, not just the 3 originally named) switched to `--color-abyss-text-45` (verified ~5:1, clears normal-text AA).
- [x] [Review][Patch] `.cal-day[data-selected][data-today]` has no combined-state rule — when today is also the selected day, the later `[data-today]` rule's `box-shadow` (the thin ring) fully replaces `[data-selected]`'s `box-shadow` (the glow) since box-shadow isn't additive across separate same-specificity rules. The selection indicator silently disappears whenever today is selected. [web/app/dashboard.css:1451-1460] — **Fixed:** added `.cal-day[data-selected][data-today]` combining both box-shadows.
- [x] [Review][Patch] `.dz-gblur`/`.dz-efade` (an 11-layer `backdrop-filter` blur stack) aren't covered by the `prefers-reduced-transparency` query, unlike `.dz-shell` a few rules away which is. [web/app/dashboard.css:87-93,898-1043] — **Fixed:** added to the existing `prefers-reduced-transparency` block, neutralizing `backdrop-filter` on both.
- [x] [Review][Patch] `.dz-list-actions` is hidden at rest via `opacity: 0` alone — no `pointer-events: none`, unlike its sibling `.dz-sheet` a few lines away which explicitly sets `pointer-events: none` at rest / `all` when active for the same collapsed/expanded problem. Its focusable children stay tabbable/clickable while invisible unless the React layer separately unmounts them. — **Fixed:** added `pointer-events: none`/`all` matching `.dz-sheet`'s pattern.
- [x] [Review][Dismiss] Blind Hunter flagged `globals.css`'s `--color-primary-glow: var(--color-primary-glow);`-style declarations (12 instances) as "guaranteed-invalid circular custom properties." Verified false — these sit inside `@theme inline { ... }` (`globals.css:26`), Tailwind v4's documented idiom for exposing an existing `:root` token as a theme utility without inlining a literal value at build time; not runtime CSS circularity.
- [x] [Review][Dismiss] Both Blind Hunter and Edge Case Hunter independently flagged `.liquid-metal-ripple` (globals.css) lacking a `prefers-reduced-motion` override that its sibling `.mtl-ripple` (dashboard.css) has. Verified false — both `liquid-metal-button.tsx`'s and `MetalButton.tsx`'s ripple-spawning functions already gate ripple-element creation behind `if (reduced) return` in JS (confirmed by direct read in the chunk-2a review), so neither ripple element is ever created under reduced motion. `.mtl-ripple`'s CSS override is redundant defense-in-depth, not load-bearing; `.liquid-metal-ripple` not having one is not a gap.
- [x] [Review][Defer] Several selector blocks are reopened non-adjacently and silently override earlier declarations with no cross-reference (`.dz-hero`, `.dz-shell` ×3, `.dz-card`, `.dz-right-pair`, and the "Compaction pass" section's `.cal-month-row`/`.cal-day`/`.mp-rows` re-declarations, which make the file's *first* margin/size/gap values on those selectors permanently dead). Renders correctly today (cascade resolves to the intended final values), but it's a real maintainability hazard — an edit to the "obvious" first copy of any of these can be silently clobbered by a later block. Needs a dedicated CSS consolidation pass across the whole file, not a rushed point-fix.
- [x] [Review][Defer] Motion tokens (`--motion-duration-liquid-open/-close/-grand`, `--motion-ease-liquid`/`-spark`) are defined but routinely bypassed with hardcoded magic numbers in `.mtl-*` and elsewhere (`0.8s`, `0.4s ease`, the same `cubic-bezier(0.4, 0, 0.2, 1)` copy-pasted 3+ times), contradicting the section's own comment that "all timings/easings are the ref's, via the liquid motion tokens." — deferred, consistency debt not a bug
- [x] [Review][Defer] Inconsistent focus-ring outer-glow radius: most controls use `6px`, but `.cal-tab`/`.cal-nav button`/`.cal-day`/`.mp-toggle button` use `5px` — unexplained, un-tokenized drift confined to the right-column card controls. — deferred, cosmetic
- [x] [Review][Defer] `.dz-row:focus-visible` reuses the exact same soft glow as `:hover` instead of a distinct ring — keyboard focus on a set row looks identical to a mouse hover. — deferred, minor a11y nuance
- [x] [Review][Defer] No z-index scale exists — values are ad hoc across the file (2, 10, 20, 30, 40, 60, 99) with no documented relationship. — deferred, architecture debt not a bug
- [x] [Review][Defer] `.spot-goo`'s `filter: url(#dz-blob)` (SVG goo/blob filter) has no `@supports` guard or fallback, unlike the file's `backdrop-filter` usages which consistently pair the `-webkit-` prefix (and, for `.dz-shell`, a `prefers-reduced-transparency` fallback). Known Safari rendering/perf risk. — deferred, needs device testing
- [x] [Review][Defer] `components.json` registers a third-party shadcn component registry (`@react-bits` → `reactbits.dev`) — a new, unpinned external supply-chain trust boundary bundled into what reads like a routine config diff. — deferred, worth a conscious look before anyone runs `shadcn add @react-bits/...`, not a code defect
- [x] [Review][Defer] `eslint.config.mjs` blanket-ignores the entire vendored `Silk.jsx` rather than disabling only the specific offending rule inline — reasonable for vendored code, but any future hand-edit to that file goes unlinted too. — deferred, low cost either way
- [x] [Review][Defer] `.dz` has a `min-width: 900.02px` desktop query but the mobile query is `max-width: 900px` (not `900.02px`/`width < 900.02px` like the nav rail's own matching breakpoint) — a ~0.02px gap where neither query matches. Astronomically unlikely to be hit by a real viewport width; align to the rail's exact pattern when touching this file next. — deferred, effectively unreachable
- [x] [Review][Defer] `.dz-hero-stats` has no `flex-wrap` while `.dz-hero` clips overflow — extra hero stats could be cut off instead of wrapping on narrow viewports. — deferred, narrow
- [x] [Review][Defer] `forced-colors: active` mode — `.cal-day`/`.cal-tab`/`.mp-toggle` selected/active states rely solely on background-color, which forced-colors suppresses; `prefers-contrast: more` has no boost path for the text-45/text-22 tokens. — deferred, niche a11y enhancement, not a regression
- [x] [Review][Defer] `.dz-actions-date` has no ellipsis truncation unlike sibling truncated fields; `.cursor-chip-body`'s `max-width: 240px` isn't clamped to the viewport edge; `.dz-shell:focus-within`'s glint is gated to `(hover: hover) and (pointer: fine)` so tablet+keyboard users miss it; `.cursor-chip`'s opacity+scale transition has no `prefers-reduced-motion` coverage; `.dz` has no `max-width` cap for ultrawide viewports. — deferred, minor polish items, batch for a dedicated design pass
- [x] [Review][Dismiss] `--color-abyss-text-45`'s name says "45" but its value is 52% alpha (lifted per REFINEMENTS item 12). Not misleading in practice — the token's own comment already states "52% ... lifted from 45%" — a reader who checks the comment gets the right answer; not worth an invasive rename across dozens of call sites for a naming nitpick the comment already resolves.
- [x] [Review][Dismiss] "Orphaned cool-direction token block" (`--color-ice*`, `--color-hero-atmos*`, `--color-spotlight-*`, `--metal-cool-*`) sitting unused next to the Abyss Cyan block — real dead tokens from a superseded palette direction, but harmless (no runtime cost, not consumed anywhere) and cheap to leave for a future token-file cleanup rather than a review-driven deletion.
- [x] [Review][Dismiss] Scroll regions hiding their scrollbars unconditionally (`.dz-list-scroll`, `.dz-right`, `.cal-strip`, `.dz-sheet-tracklist ol`) — this is a repeatedly-documented, intentional design decision throughout this story's REFINEMENTS.md ("hidden scrollbar per ref convention"), not an oversight.

## Dev Notes

### The real-data findings this story is built on (verified 2026-08-02 against Arjun's machine)

Agent DB: `~/Library/Application Support/app.curfew.agent/local.sqlite`, table `captured_sessions`, **491 captured serato4 sets** (plus 474 `incomplete` legacy twins that are correctly suppressed). Reference gig: **id 975 / session_identity `master.sqlite#488`** — 178 plays, 5.9h, `confidence.value = 1.0`. Many 1-play soundchecks exist (e.g. id 17577) — these are the low-confidence / sparse-state cases the UI must handle.

- **Camelot keys were being thrown away, not absent.** Set 975: **177/178 plays have a key in Serato; only 21 were captured (~12%).** Library-wide ~94% coverage was being dropped.
  - Root cause: `agent/src-tauri/src/joiner/serato4.rs:135` reads the free-text `key` column, which stores **mixed notation — mostly musical** (`Em`, `Ebm`, `Fm`, `Cm`, `G#m`…) with only a few already-Camelot (`9B`). `agent/src-tauri/src/stats/camelot.rs:46` `parse()` accepts **only** `<1-12><A|B>`, so `Em → 'm' → None`. ~88% silently dropped.
  - Fix source of truth: Serato's `key_value` INTEGER (present on both `history_entry` and `asset`; `-1` = no key). **Verified 24/24 mapping** by cross-tabbing `key_value` ↔ `key_norm` across 20k+ rows:
    - `key_value` 0–11 = minor / Camelot **A** ring; 12–23 = major / **B** ring.
    - `number = (key_value % 12) + 1`, `letter = key_value < 12 ? A : B`. Spot checks: `0→1A (g#m)`, `7→8A (am)`, `8→9A (em)`, `16→5B (eb)`, `23→12B (e)`.
  - This is more AD-11-"never guess"-compliant than parsing the messy text column (no enharmonic ambiguity — Serato folds `g#m`/`abm` to one value).
  - **Design consequence:** harmonic/Camelot mixing is a **real ~94%-coverage feature**, reversing the earlier (wrong) call to treat keys as near-empty. It becomes a legitimate headline stat on Set Detail and a candidate for the card. Genre (AC 10) is flagged for the same "are we reading the right column?" scrutiny before we design its fallback.
- **Genre looked ~50% untagged** on set 975 (`no_genre: 82/178`, big `Other: 49`). Suspect after the key bug — verify the source before trusting it (Task 2).
- **Data is messy in reality:** mic/announcement "tracks" (`"Boys Court Dance\n"`), null titles, trailing newlines. The FR-2 unknown fallback + light hygiene apply. Titles filled 157/178, artists 158/178.
- **Storage detail:** `local.sqlite` stores `energy_arc.started_at` as **epoch ints**; the frozen wire contract (`shared/src/index.ts`) carries **ISO 8601 strings** ("converted at payload-build time"). The fixture builder must convert.

### The frozen data ceiling (what any card/detail can render)

Everything renders from `set.derived` (`shared/src/index.ts:114`, `SyncSetDerived`) + `set.{external_id, started_at, ended_at}` + `plays[]` (`SyncPlay`, `shared/src/index.ts:76` — carries `position, title, artist, started_at (ISO), bpm, genre{raw,normalized,taxonomy_version,subgenre?}, camelot_key, in_library`). Because every `SyncPlay` carries per-play timestamp + bpm + genre + key, **segment-scoped stats can be recomputed from `plays[]`** — this is what makes the dancefloor v0 (AC 6/7) and the future pointer editor (Story 5.1) buildable without a schema change. `derived` is the whole-set default/cache; segment stats are recomputed.

`SyncSetDerived` fields: `most_played_tracks`, `most_played_artists`, `genre_breakdown{buckets,no_genre_count}`, `subgenre_breakdown?`, `bpm_distribution{count,min,max,mean,median}`, `camelot_mixing_stats{compatible,incompatible,excluded_no_key}`, `set_length_sec`, `track_count`, `energy_arc[{started_at,bpm}]`, `confidence{value,track_count,long_gap_count}`.

### Files to touch

**Agent (Rust):**
- `agent/src-tauri/src/joiner/serato4.rs` — SELECT + `key_value` mapping (READ fully first; it also owns the id-correlation join contract at ~102-106 — do not break it).
- `agent/src-tauri/src/stats/camelot.rs` — `parse()` stays for the fallback path; the library path uses `key_value`. `mixing_stats`/`compatible` unchanged.
- `agent/src-tauri/src/joiner/mod.rs` — retire the "findings §3 / already Camelot" premise (line ~30 + `JoinedMetadata.key` doc).
- `agent/src-tauri/src/joiner/legacy.rs` — sanity-check the database-V2 key source too (lower priority; Arjun's library is serato4).
- Backfill entry point from Story 3.4 (find it; do not invent a parallel one) + `store.rs` (`captured_sessions`, `raw_ref` format `<db_path>#<session_id>`).

**Web (Next / Tailwind v4 / shadcn base-nova):**
- `web/app/(authenticated)/dashboard/page.tsx` — **currently a throwaway stub** (Story 3.5 Task 5.2); this story replaces it entirely.
- `web/app/(authenticated)/layout.tsx` — the fixed-shell wrapper lives here or in the page; note there is **no auth-gating redirect on this route group yet** (pre-existing gap flagged in 3-5; do not rely on it, do not silently fix it in this story unless needed).
- `web/app/components/nav/FloatingNav.tsx` — already done (3.5); the shell must not fight the fixed `bottom-6` nav.
- New: `web/app/components/ui/` (shadcn `ui` alias target `@/app/components/ui`, per `components.json` — does **not** exist yet), the set card + arc thumbnail + liquid-metal button, `/set/[id]` route, the data-access seam + JSON fixture.
- `web/app/globals.css` / `web/app/tokens.css` — Obsidian tokens only; the liquid-metal `<style>` injection moves here.

### Previous-story intelligence (Story 3.5, 2026-08-01)

- Stack as established: **Tailwind v4 (`tailwindcss`/`@tailwindcss/postcss` 4.3.3)**, **shadcn CLI 4.16.1** with **Base UI + `base-nova` preset** (a newer generation than the classic shadcn/Radix), **`@phosphor-icons/react` 2.1.10** (House/TrendUp/VinylRecord/UserCircle in use). `clsx` / `tailwind-merge` / `class-variance-authority` present; `lucide-react` was **removed** in 3.5 as out-of-scope — the liquid-metal component imports `lucide-react` (`Sparkles`), so it will be **re-added** with `@paper-design/shaders` (acceptable, it is the CTA's own dep).
- **CSS Cascade Layers gotcha (real bug in 3.5):** an *unlayered* rule beats every `@layer` rule regardless of order; a hand-written unlayered reset silently disabled every Tailwind utility. Keep new global CSS layered; don't reintroduce unlayered resets.
- **`@property` + `setProperty` gotcha** (memory `ref-property-setproperty-bug`): Next16/Tailwind v4 silently ignores runtime `setProperty` on **registered** `@property` vars — use **unregistered** vars + rAF lerp for any runtime-animated custom prop (relevant to the arc thumbnail's dancefloor emphasis and any glow).
- **Verify in a real browser, not just code review** — 3.5's two worst bugs (the layers reset; a 524px pill overflowing a 375px viewport) were caught only by an actual Playwright/headless-Chrome walkthrough. Screenshot the cold state, a populated card, the NEW marker, mobile 375px, and keyboard focus.
- Repo gate is expected green across agent/shared/web throughout.

### Downstream decisions recorded (stories we are NOT building now)

Written back into `epics.md` this session so they survive:
- **Story 3.7 (Set Detail):** dancefloor-**filtered** stats (recomputed from `plays[]`); a "we detected dancefloor from X–Y" line with an **edit** affordance; the editor UI = the **tracklist with two draggable pointers** the DJ moves to bracket the segment; that **same surface** hosts second-layer data (tags, pics); **delete-set** lives here (calm confirm); whole-set is the honest fallback until a segment is set.
- **Story 3.8 (Energy arc chart):** the full annotated + captioned chart is the **same reusable renderer** as this story's thumbnail (Task 7), in "full" mode.
- **Story 5.1 (Segments overlay schema):** the cloud-only `segments` table (`type ∈ {dancefloor,dinner,performance,custom}`, AR-15). **Story 5.3 (Segment editor):** the two-pointer editor rendered **over the tracklist** (Arjun's model), unified with **Story 5.5 (Layer-2 enrichment: tags + pics)** on one Set Detail surface. **Story 5.4 (Segment-scoped stats):** the cloud SQL re-aggregation that 3.6's client-side v0 previews.
- **Story 5.2 (Segment detection):** replaces this story's **global-heuristic v0** with **per-DJ-calibrated** floors (AR-13, validated on the 474-session corpus 2026-07-20); stats then filter to the confirmed segment.
- **Liquid-metal CTA placements:** subscribe/paywall CTA (Story 7.x, UX-DR14), login "Initialize Session" primary, marketing/landing hero — in addition to the in-product usage Arjun wants.

### Project Structure Notes

- Route slugs are frozen by Story 3.5 Task 3.2: `/dashboard`, `/style-evolution`, `/library-utilization`, `/settings`. This story adds `/set/[id]`.
- shadcn `ui` alias is `@/app/components/ui` (`web/components.json`), tsconfig `@/*` → `./*`. Registry/primitive components (liquid-metal button) belong under `app/components/ui/`; feature components (set card, arc thumbnail) may live under `app/components/dashboard/` — match the existing `app/components/{auth,nav}` grouping.
- **Scope variance (intentional, Arjun 2026-08-02):** this story spans agent + web, unusual for a "dashboard" story. Rationale in the Scope Note at top: the dashboard's value proposition is *accurate* reflection, so the data-correctness fixes are in-scope, not deferred.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.6: Dashboard home] — base ACs (revised here per Arjun 2026-08-02).
- [Source: _bmad-output/planning-artifacts/epics.md#Decision A] — go-forward-only / sparse-first launch; the empty dashboard IS the launch experience.
- [Source: _bmad-output/planning-artifacts/epics.md#AR-13] — per-DJ-calibrated segment detection (v0 here is the interim).
- [Source: _bmad-output/planning-artifacts/epics.md#AR-15] — entity model; `segments` type enum; `derived` render-cache.
- [Source: shared/src/index.ts:76,114] — frozen `SyncPlay` / `SyncSetDerived` contract.
- [Source: agent/src-tauri/src/joiner/serato4.rs:135] — the SELECT to fix.
- [Source: agent/src-tauri/src/stats/camelot.rs:46] — the parser that dropped musical keys.
- [Source: agent/src-tauri/src/joiner/mod.rs:30] — the false "already Camelot" premise to retire.
- [Source: agent/src-tauri/src/store.rs:32,266] — `local.sqlite` location + `captured_sessions` schema / `raw_ref`.
- [Source: _bmad-output/implementation-artifacts/3-5-floating-pill-nav.md] — stack, CSS-layers gotcha, verify-in-browser discipline.
- [Memory: bug-serato-key-parsing] — the verified fix + blast radius. [Memory: ref-property-setproperty-bug] — runtime CSS-var gotcha. [Memory: feedback_design_taste] — match reference intensity, don't tone down.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (`claude-opus-4-8`) via the bmad-dev-story workflow.

### Debug Log References

- Agent gate: `cargo fmt --check` clean · `cargo clippy --all-targets --all-features -- -D warnings` clean · `cargo test --lib` 331 passed.
- Shared gate: `vitest run` 20 passed (frozen-contract additive-only + schema-parity guards — contract untouched).
- Web gate: `tsc --noEmit` clean · `eslint` clean · `vitest run` 52 passed.
- Real-data verification (read-only, non-destructive): `agent/src-tauri/tests/export_real_fixtures.rs` re-derived set 975 (session 488) through the fixed pipeline → **177/178 Camelot keys recovered** (was ~21), confirming AC-9/AC-11 on the reference gig.
- Browser walkthrough (Playwright, dev server): populated dashboard, NEW markers + pulse + border tint, click→markSeen persistence (`localStorage: ["975"]` after opening 975, 17577 stays new), set-detail stub + liquid-metal CTA, cold state, mobile 375px (no horizontal overflow), keyboard focus ring. Zero console errors throughout. Caught + fixed one real bug code review missed: the "NEW SET DETECTED" badge overlapped the session-id header (both were top-right) — resolved by swapping the header's right slot to show the badge *in place of* the session-id while unopened.

### Completion Notes List

**Agent / data-correctness (Tasks 1–3)**
- ✅ **Camelot key recovery (AC-9).** Root cause was subtler than the story framed: the free-text `"key"` was read in TWO places (`joiner::serato4::join_session` AND `parser::serato4::read_session` → `Play.key`), and `stats::enrich` *prefers* `Play.key`, so fixing only the joiner would have left the broken free-text key shadowing the fix and **failed the required capture-path test**. Fix (Option B, clean + DRY, legacy untouched): the joiner now maps `key_value`→Camelot into `JoinedMetadata.key`, and the serato4 parser **stops reading the free-text key** (`Play.key = None`), so — exactly like BPM already does — key flows from the library join. Legacy's play-log key (`.session` field 51, genuinely Camelot) is unchanged. Three false premises retired: `joiner/mod.rs` module doc, `JoinedMetadata.key` doc, AND `stats::enrich`'s "confirmed Camelot notation at the source for both formats" comment. `key_value`→Camelot only maps the verified `0..=23` range (−1 and out-of-range → `None`, never a fabricated position — AD-11). Regression tests: full 24-value ring mapping, key_value-wins-over-free-text, and a capture-path test through `build_serato4` (`Em`/`Ebm`/`G#m` + a −1 → correct Camelot + one `None`).
- ✅ **Genre source re-check (AC-10) — no code change, finding recorded.** Verified against the real `master.sqlite`: `asset.genre` is nearly empty (523 filled rows library-wide) vs `history_entry.genre` (17,392). Joining to `asset` would *lose* genres, not gain them (only 7 rows library-wide are asset-richer; 2 on set 975). **`history_entry.genre` — what the joiner already reads — is the richest source.** The ~46% untagged rate on set 975 (~25% library-wide) is a **genuine library ceiling, not a reading bug**; the UI genre-chip fallback is designed against that truth (a set with no tagged genres simply shows no chips).
- ✅ **Backfill (AC-11).** New `backfill::backfill_captured_serato4` sweeps every `captured` serato4 row and re-derives it through the fixed pipeline by reusing the Story 3.4 capture entry point (`capture_and_store_serato4` → idempotent `upsert_captured`), wired into the same startup thread as `reprocess_parse_failures`. Purely local, idempotent, skips an unreachable source rather than corrupting rows. Verified: re-derivation recovers 177/178 keys on set 975 and **preserves `synced_at`**.
- ✅ **Cloud re-sync (Arjun ruling 2026-08-02).** The story's "`synced_at` is NULL for all rows" premise was factually wrong — all 491 captured rows already carry a `synced_at` (Stories 3.2/3.3), so the cloud held the *old* keys. Arjun ruled: **all data lives in the cloud so the dashboard reads the same on every device.** So the backfill now clears `synced_at` on any row whose re-derivation actually *changed* (`store::mark_for_resync`); the existing sync-queue drain loop re-pushes it and Story 3.2's `external_id` idempotency updates the existing cloud row (no duplicates). It is **self-terminating** — it compares freshly-derived JSON to what is stored and only writes/re-queues on a real difference, so it does not re-sync every set on every startup. (Note: the real `local.sqlite` backfill has NOT been persisted this session — that mutates real user data; the agent runs the wired startup sweep on next launch. Verification above was read-only re-derivation.)

**Web / dashboard (Tasks 4–12)**
- ✅ **Real-data fixture + seam (AC-13).** Set 975 + the 1-play soundcheck (17577) re-derived from the real `master.sqlite` through the *fixed* Rust pipeline, then `build-fixture.mjs` converts epoch→ISO into the frozen `SyncPayload["set"]` wire shape (`web/lib/sets/recent-sets.fixture.json`). The dashboard reads only through `getRecentSets`/`getSetById`/`deleteSet` (`web/lib/sets/index.ts`); the Supabase read path swaps in there with zero component change.
- ✅ **Dancefloor v0 (AC-6/7/8)** — pure `detectDancefloor` + `segmentStats`, global constants **explicitly commented interim / superseded by Story 5.2 AR-13**. Card stats scope to the detected dancefloor; the arc draws the full night with that window emphasised. (Set 975's mid-set gap makes it detect a real ~1h peak segment rather than the whole 5.9h — so the card reads "1h 6m / 38 tracks", the dancefloor, per AC-7.)
- ✅ **Reusable `EnergyArc`** (thumbnail mode; 3.8 renders the same geometry in "full"), token-driven stroke (`stroke-primary`, no `currentColor`/literals), static (no celebratory motion), degenerate handling (solo dot for 1 play, dashed baseline for none), a11y text-equivalent.
- ✅ **Fixed shell, cold state, passive NEW marker, `/set/[id]` stub + delete seam, liquid-metal CTA** all built and browser-verified. Liquid-metal: `'use client'` + `dynamic(ssr:false)`, reduced-motion freeze (`speed=0`) + ripple dropped, colours **tokenized** (new rose-tinted-chrome material in `tokens.css`, read at runtime since the shader's hex parser can't take a `var()`), the reference's `document.head` `<style>` moved into `globals.css`, WebGL-context limit documented. Landed with ONE in-product demo usage on the set-detail stub; real hero placements (login/subscribe/marketing) noted for their stories.

**Corrections & deviations (flagged, not silent)**
- **"lavender" → Ember rose.** The story's AC-3/Task-7 "lavender @20% border / lavender 2px stroke" predates the 2026-07-28 Ember revision; the live accent is `--color-primary` (rose) and lavender is a commented-out alternate. Used the live token throughout — the same stale-wording correction Stories 2.4/3.5 already made.
- **Session-id moved within the header slot, not removed.** To resolve the NEW-badge overlap, the header's right slot shows the NEW badge while unopened and the session-id once seen (they never coexist). Both still live in the header per AC-1.

**Deferred / out of scope (for later stories)**
- The real `local.sqlite` backfill of all 491 rows persists on next agent launch (wired) — not run this session to avoid mutating real user data. The cloud correction rides along automatically (the changed rows clear `synced_at` and the drain loop re-pushes them).
- Pagination/virtualization: `getRecentSets` returns all sets; at fixture scale (2) that is fine, but the Supabase read path should page/virtualize before rendering hundreds of dancefloor-computing cards.

**NOT part of this story (intentional, untouched) — SUPERSEDED, see correction below**
- `web/app/components/nav/FloatingNav.tsx` carries nav-padding WIP (6→2px incl. an invalid `p-0.2`, glow radius 52→90px) that **Arjun added via a parallel agent** so this session had up-to-date code — matches the `nav/pill-tighten-padding` worktree. Left untouched and **excluded from this story**; it commits separately (Arjun 2026-08-02). The invalid `p-0.2` (no such Tailwind step — renders no padding) is worth a look in that separate change.
  > ✏️ **Correction (code review, 2026-08-05):** this note describes the file's state as of 2026-08-02 only. The later dashboard-redesign refinement pass (2026-08-03, `REFINEMENTS.md` items 4/19 and others) substantially rewrote `FloatingNav.tsx` in-story as part of bringing the nav rail onto the liquid-metal/Abyss design language — new rail shader, `CursorChip` hover-label system, rail/dock media-query branching, keyboard-focus handling. That rewrite **is** in scope and shipped as part of this story; only the original padding-tweak WIP referenced above stayed out of scope. This note was never updated when the redesign pass touched the file — confirmed intentional, not scope creep.
- `_bmad-output/planning-artifacts/epics.md` was already modified before this session (the downstream-decisions write-back) — not touched here.

### File List

**Agent (Rust) — modified**
- `agent/src-tauri/src/joiner/serato4.rs` — `key_value`→Camelot mapping + source-of-truth read; `camelot_from_key_value`; fixtures + regression tests.
- `agent/src-tauri/src/parser/serato4.rs` — stop reading the free-text `"key"` (key now from the join); docs + tests.
- `agent/src-tauri/src/joiner/mod.rs` — retired the false "already Camelot at the source" premise (module doc + `JoinedMetadata.key`).
- `agent/src-tauri/src/stats/mod.rs` — corrected the `enrich` key-policy doc.
- `agent/src-tauri/src/capture.rs` — `key_value` fixtures + capture-path Camelot regression test.
- `agent/src-tauri/src/backfill.rs` — `backfill_captured_serato4` (change-detecting, cloud-re-syncing, self-terminating) + tests; module doc.
- `agent/src-tauri/src/store.rs` — `mark_for_resync` (clears `synced_at` so a corrected row re-syncs).
- `agent/src-tauri/src/lib.rs` — wired the captured-backfill into the startup sweep.
- `agent/src-tauri/src/watcher/mod.rs` — `key_value` column in the test fixture.

**Agent (Rust) — new**
- `agent/src-tauri/tests/export_real_fixtures.rs` — env-gated, read-only real-data exporter (Task 3 verification + Task 4 fixture source).

**Web — new**
- `web/app/(authenticated)/set/[id]/page.tsx` — Set Detail route stub + liquid-metal demo.
- `web/app/components/dashboard/{EnergyArc,SetCard,SetList,ColdState}.tsx`, `useSeenSets.ts`
- `web/app/components/ui/liquid-metal-button.tsx`
- `web/lib/sets/{index,types,dancefloor,energyArc,format}.ts` (+ `dancefloor.test.ts`, `energyArc.test.ts`, `format.test.ts`)
- `web/lib/sets/recent-sets.fixture.json`, `web/lib/sets/build-fixture.mjs`

**Web — modified**
- `web/app/(authenticated)/dashboard/page.tsx` — real dashboard (was a stub).
- `web/app/globals.css` — dashboard shell/card/marker/liquid-metal styles (token-only) + motion + reduced-motion/forced-colors.
- `web/app/tokens.css` — `@theme` additions + the rose-tinted-chrome metal material.
- `web/package.json`, `pnpm-lock.yaml` — `@paper-design/shaders`, `@paper-design/shaders-react`, `lucide-react`.

**Story bookkeeping**
- `_bmad-output/implementation-artifacts/3-6-dashboard-home.md` (this file), `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Change Log

| Date | Change |
|------|--------|
| 2026-08-02 | Story 3.6 implemented across agent + web. Camelot `key_value` recovery (21→177/178 keys on set 975, verified on real data); genre-source re-check (history_entry.genre confirmed richest; ~46% untagged is a real ceiling); captured-set backfill (idempotent, self-terminating); real-data wire-shape fixture + data-access seam; dancefloor v0 detector + segment-scoped stats; Card-Reflection dashboard (cards, reusable energy arc, fixed 100dvh shell, cold state, passive NEW marker, `/set/[id]` stub, liquid-metal CTA). Full repo gate green (agent fmt/clippy/test, shared, web lint/typecheck/test) + browser walkthrough. Status → review. |
| 2026-08-02 | Follow-up (Arjun rulings): backfill now **re-syncs corrected rows to the cloud** (clears `synced_at` on changed rows so the drain loop re-pushes; self-terminating) so the dashboard reads the same on every device — the "`synced_at` is NULL" story premise was wrong (all 491 rows were already synced). FloatingNav nav-padding WIP confirmed intentional (parallel agent) and kept out of this story's scope. Agent gate re-green (332 tests). |
