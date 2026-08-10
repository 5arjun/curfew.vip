import { getLibraryAddEvents, getLibraryRoster, getRecentSets } from "@/lib/sets";
import {
  buildLibraryConversion,
  buildLiveConversionRate,
  buildTimeToFirstPlay,
  CONVERSION_WINDOWS,
  playsByTrack,
  undatedDisclosure,
  unreconciledDateCount,
} from "@/lib/sets/libraryConversion";
import {
  buildOneAndDone,
  buildRepeatTrackRate,
  buildRotationSize,
  buildSetSimilarity,
  buildUtilizationIndex,
  buildWorkhorses,
  partitionSetsByConfidence,
  utilizationDisclosure,
} from "@/lib/sets/libraryUtilization";
import { unidentifiableTracksDisclosure } from "@/lib/sets/libraryRoster";
import type { SetRecord } from "@/lib/sets";
import type { LibraryAddEventSnapshot } from "@/lib/sets";
import { SilkBackdrop } from "@/app/components/dashboard/SilkBackdrop";
import { LibraryUtilizationReveal } from "@/app/components/library-utilization/LibraryUtilizationReveal";
import { LibraryUtilizationView } from "@/app/components/library-utilization/LibraryUtilizationView";
import { OneAndDone } from "@/app/components/library-utilization/OneAndDone";
import { RepeatTrackRate } from "@/app/components/library-utilization/RepeatTrackRate";
import { RotationSize } from "@/app/components/library-utilization/RotationSize";
import { SetSimilarity } from "@/app/components/library-utilization/SetSimilarity";
import { TimeToFirstPlay } from "@/app/components/library-utilization/TimeToFirstPlay";
import { Workhorses } from "@/app/components/library-utilization/Workhorses";

// Library Utilization (Story 4.3, AC-5; Story 4.5; Story 4.7, AC-3; composed
// by Story 4.9) — supersedes the Story 3.5 throwaway stub. Reads through the
// SAME data-access seam `style-evolution/page.tsx` uses (`getRecentSets`,
// `getLibraryAddEvents`), plus `getLibraryRoster` (Story 4.11) for the
// disclosure below.
//
// Story 4.7 AC-3 moved Style Evolution's library-conversion TREND here
// (`buildLibraryConversion`), alongside Story 4.3's LIVE meter
// (`buildLiveConversionRate`) — same underlying add-events/sets, two
// deliberately different computations (see `libraryConversion.ts`'s own
// doc comments on why the live meter is not a read of the cohort model).
// Both share ONE conversion-window selection (`LibraryUtilizationView`).
//
// **The page has two tiers, and the split is the conversion window.**
// `LibraryUtilizationView` is a client component whose whole reason to exist
// is owning that ONE shared selection; everything it renders is governed by
// the dropdown in its head. Story 4.5's time-to-first-play is measured over
// the lifetime population with no trailing window at all, so it sits OUTSIDE
// that view as a sibling here — see the render block below for why that
// placement is the load-bearing part, not an arrangement detail. Story 4.9's
// rotation-size tile is placed by the same rule in the same direction (D-21).
//
// **Story 4.9 AC-10 / D-20 — the page-level low-confidence contract.** Every
// figure on this page is now computed from the SURVIVING set population, and
// the whole body is built twice up front: once excluding the sets
// `isLowConfidenceSet` hides, once including them. `LibraryUtilizationReveal`
// swaps which prerendered subtree renders. Nothing recomputes on click, and
// every module stays a server component.
//
// Unlike the trend's OWN insufficient-history state (rendered inside
// `LibraryConversionTrend`), this page has no page-level gate: the meter is
// a live snapshot that already renders "zero tracks added" honestly on its
// own, the trend's insufficient state is scoped to itself, and each Story
// 4.5/4.9 module renders its own gate inside its own shell.
export default async function LibraryUtilizationPage() {
  const [sets, addEvents, roster] = await Promise.all([
    getRecentSets(),
    getLibraryAddEvents(),
    getLibraryRoster(),
  ]);
  // Story 4.11 AC-6: measured 27.7% (252/910) of Arjun's real catalogue rows
  // excluded for having no resolvable title/artist at all — well above the
  // ~5% materiality bar, so this renders, not silently omitted. (The 272/930
  // this comment carried until now predates 4.11's own review, which dropped
  // the 20 video files from both counts; the committed fixture has always
  // said 252/910.)
  const unidentifiableDisclosure = unidentifiableTracksDisclosure(
    roster.excludedNoIdentityCount,
    roster.totalCatalogueRows,
  );

  // Story 4.9 AC-10 (D-20). The predicate is `listModel.ts`'s COMPOUND
  // `isLowConfidenceSet`, not Style Evolution's bare `< 1.0` — see
  // `partitionSetsByConfidence`'s own doc comment for why the obvious reading
  // of AC-10 selects the one predicate that does not do what AC-10 asks for.
  //
  // Retrofitted over three already-shipped figures (the meter, the trend,
  // time-to-first-play), which was safe exactly once: production held 0 sets
  // and 0 plays when this landed, re-measured read-only on 2026-08-08.
  const { surviving, hidden } = partitionSetsByConfidence(sets);

  return (
    <main className="lu">
      <SilkBackdrop />
      <header className="lu-header">
        <h1 className="lu-title">Library Utilization</h1>
        <p className="lu-subtitle">How much of your library actually makes it to the dancefloor.</p>
      </header>

      {/* AC-8, said ONCE and at page level because it governs the modules above
          and below it alike — it cannot live inside any of them.

          Subject to Decision B's binding copy rule: never "since you joined",
          never "in your N months", never framed as a limitation. This is the
          DJ's record, stated as a fact about the archive rather than as an
          apology for what predates it. It also neither duplicates nor
          contradicts the subtitle above (which is about the library) or the
          disclosures below (which name specific exclusions). */}
      <p className="lu-capture-note">
        Everything here is measured from the sets Curfew has captured — your archive, building from
        here.
      </p>

      {/* `including` is built ONLY when there is something to reveal. Both
          arguments used to be evaluated eagerly, so a DJ with no low-confidence
          sets — the control never renders for them, and `revealed` can never
          become true — still paid two `playsByTrack` passes, two
          `buildLibraryConversion`, two `buildTimeToFirstPlay`, two
          `buildUtilizationIndex` plus five metrics each, and shipped two copies
          of the markup in the RSC payload. The doc comment below defends "the
          expensive work happens once, server-side, up front"; it was happening
          twice. */}
      <LibraryUtilizationReveal
        hiddenCount={hidden.length}
        excluding={renderBody(surviving, addEvents, unidentifiableDisclosure)}
        including={
          hidden.length > 0 ? renderBody(sets, addEvents, unidentifiableDisclosure) : null
        }
      />
    </main>
  );
}

/**
 * The whole page body for ONE set population (Story 4.9, D-20).
 *
 * Called twice from the page — once with the surviving sets, once with every
 * set — so the reveal is a swap rather than a recompute. Every model below is
 * therefore a pure function of `sets`, and nothing here reads the clock beyond
 * the `readAtMs` the data seam already stamped.
 */
function renderBody(
  sets: SetRecord[],
  addEvents: LibraryAddEventSnapshot,
  unidentifiableDisclosure: string | null,
) {
  // Decision E-1: the LIVE current-window rate, not a read of the Story 4.2
  // cohort model — see `buildLiveConversionRate`'s own doc comment. The clock
  // comes from the data seam (`readAtMs`), never read in render (Story 4.1's
  // review lesson; `react-hooks/purity` rejects `Date.now()` here besides).
  //
  // Every selectable window is precomputed here, up front — the dropdown
  // just looks one up, matching D-13's "no work happens on click" discipline
  // the trend's own window toggle established.
  //
  // ONE play index, built once and shared by all three modules below
  // (post-merge integration review). It used to be two — a global-earliest
  // index for the two conversion metrics and this one for Story 4.5 — which
  // was both a wasted pass over every play and the vehicle for a real bug:
  // the conversion metrics asked their question of the global minimum, so a
  // track played once before its add and again after counted as unconverted
  // while Story 4.5's module, 200px away, reported its debut.
  //
  // That one-index rule is scoped to these three CONVERSION consumers, and
  // Story 4.9's play-side metrics deliberately build their own separate
  // set-membership index instead (GAP-4): this one is `track_id`-keyed and
  // carries no set identity, so it cannot answer "which sets was this track
  // in" at all. See `buildUtilizationIndex`.
  const playIndex = playsByTrack(sets);
  const rates = Object.fromEntries(
    CONVERSION_WINDOWS.map((window) => [
      window,
      buildLiveConversionRate(addEvents.events, sets, addEvents.readAtMs, window, playIndex),
    ]),
  ) as Record<(typeof CONVERSION_WINDOWS)[number], ReturnType<typeof buildLiveConversionRate>>;
  const library = buildLibraryConversion(addEvents.events, sets, addEvents.readAtMs, playIndex);

  // Story 4.5, AC-1/AC-2: the population boundary ("tracks added on or after
  // the DJ's subscription start") needs no extra filter here — see the
  // story's Context & Authority section. `addEvents.events` can only ever
  // contain go-forward adds (Story 4.2's D-1 baseline-then-diff design), so
  // it is already the qualifying population.
  //
  // NOTE (Story 4.5 review): that guarantee holds for DATED rows only. The
  // agent emits undated tracks unconditionally (`capture.rs`'s baseline
  // partition can only compare a date it has), so an undated row may predate
  // observation — which is why they are excluded from the math and disclosed
  // as a count rather than being trusted into the population.
  //
  // Shares `playIndex` with the two conversion metrics above — this metric
  // asks the same at-or-after question they do, which is exactly why there is
  // one index now instead of two. The clock comes from the data seam
  // (`readAtMs`), never read in render.
  const timeToFirstPlay = buildTimeToFirstPlay(addEvents.events, sets, addEvents.readAtMs, playIndex);

  // Rendered ONCE for the page, not once per module (Story 4.5 review). The
  // meter and Story 4.5's module read the same `addEvents.events` and
  // `noAddDateCount` is window-independent, so leaving each to render its own
  // produced the identical sentence twice, 200px apart, reading as a bug.
  // That dedup is now MORE load-bearing than when it was ruled, not less:
  // Story 4.7 put the meter and the trend side by side in one row, so the
  // meter's own copy would have sat inches from the trend's — which opens with
  // the same "N tracks have no known add date" clause — rather than a screen
  // away. `ConversionRateMeter` accordingly no longer builds its own.
  //
  // The trend KEEPS its own, and that is not an inconsistency: its disclosure
  // also carries `pendingCohortCount`, which is genuinely window-dependent, so
  // it belongs inside the window-governed section where it changes with the
  // dropdown. This note carries only clauses that do not.
  //
  // Carries the unreconciled-date count too (Story 4.5 review, findings 1+3):
  // tracks whose plays all predate their add date, and tracks with a
  // future-dated add. Both were excluded from every figure the module states
  // and named nowhere — the first also passed the population gate, so a DJ
  // with 20 tracks, 6 debuts and 14 of these saw a module reporting on 6 and
  // mentioning nothing. Deliberately NOT folded into `noAddDateCount`: those
  // tracks have a date, it just can't be reconciled.
  //
  // `window: 0` is deliberate and safe: the argument is interpolated ONLY into
  // the `pendingCohortCount` clause, which is pinned to 0 here because neither
  // module this note covers has cohorts. No "0-day window" string can reach a
  // DJ. Story 4.7's collapse of the two window scales into one
  // `CONVERSION_WINDOWS` did not disturb that — the parameter is still a plain
  // `number`, precisely so a window-independent caller can opt out like this.
  const undatedNote = undatedDisclosure(
    {
      noAddDateCount: timeToFirstPlay.noAddDateCount,
      unreconciledDateCount: unreconciledDateCount(timeToFirstPlay),
      pendingCohortCount: 0,
    },
    0,
  );

  // Story 4.9's five play-side metrics (AC-2 … AC-7). ONE set-membership index,
  // built once and read by all five — and deliberately NOT `playIndex` above
  // (GAP-4): that one is `track_id`-keyed and carries no set identity, so it
  // cannot answer "which sets was this track in" at all.
  const utilization = buildUtilizationIndex(sets);
  const rotation = buildRotationSize(utilization, addEvents.readAtMs);
  const repeats = buildRepeatTrackRate(utilization);
  const similarity = buildSetSimilarity(utilization);
  const workhorses = buildWorkhorses(utilization);
  const oneAndDone = buildOneAndDone(utilization);
  const utilizationNote = utilizationDisclosure(utilization);

  return (
    <>
      <LibraryUtilizationView
        rates={rates}
        library={library}
        unidentifiableDisclosure={unidentifiableDisclosure}
      />

      {/* ── Rotation ──────────────────────────────────────────────────────
          Three modules about the same question — how wide the DJ is digging
          and how much repeats — grouped under one real `<h2>` rather than
          stacked in arrival order (AC-1).

          Rotation size sits HERE and not inside `LibraryUtilizationView`
          (D-21): its window is fixed at 60 days, and that view's dropdown
          governs everything inside it. Nesting it there would also file a
          play-side stat under the `<h2>Conversion</h2>` heading, which is not
          what it measures. Same placement rule as `TimeToFirstPlay`, applied
          in the same direction. (An earlier draft of this comment said
          "landmark named Conversion" — R-10's fix in this same story replaced
          that `aria-label` with a heading, so the wording outlived its
          premise by one commit.)

          `.lu-pair` carries its OWN width cap for its children. `.lu >
          .lu-module { max-width: 440px }` is scoped to DIRECT children of
          `.lu`, so a module inside this wrapper silently loses it — a
          regression that has already shipped once on this page. */}
      <h2 className="lu-group-heading">Rotation</h2>
      <div className="lu-pair">
        <RotationSize model={rotation} />
        <RepeatTrackRate model={repeats} />
      </div>
      <SetSimilarity model={similarity} />

      {/* ── Tracks ────────────────────────────────────────────────────────
          Workhorses and one-and-done are a matched pair and read as one
          thought: what you lean on, and what you tried once. Side by side is
          the composition, not an accident of order.

          NOTE for Story 4.4: the aging shelf is a "neglect" list on this same
          page. It belongs NEXT TO one-and-done, and the two must
          read as complements rather than duplicates — one-and-done is about
          tracks the DJ DID play and dropped; the shelf is about tracks never
          reached at all. Slot left here deliberately, the same courtesy 4.7
          extended to 4.8. Story 4.10's track search / `/track/[track_id]`
          route targets these two lists specifically (`epics.md:970`), and its
          AC-11 reuses the exclude-visibly contract — which is why that lives on
          `LibraryUtilizationReveal` as a page-level primitive rather than
          welded to these modules. */}
      <h2 className="lu-group-heading">Tracks</h2>
      <div className="lu-pair">
        <Workhorses model={workhorses} />
        <OneAndDone model={oneAndDone} />
      </div>

      {/* ── First play ────────────────────────────────────────────────────
          Its OWN `<h2>`, not a member of "Tracks". Time-to-first-play is an
          ADD-side metric — how long a track waits between entering the library
          and reaching a dancefloor — while "Tracks" groups the two play-side
          lists (what you lean on, what you tried once). Filing it there made a
          screen-reader user navigating by heading hear it as a third member of
          a group it has nothing to do with. R-10's outline fix recorded this
          arrangement without noticing the mis-filing.

          OUTSIDE `LibraryUtilizationView`, deliberately — this is the merge's
          real decision, so it is written down rather than left to look like
          arrival order.

          That view renders one `<section className="lu-conversion">` with the
          shared window dropdown in its head and the meter and trend in its
          body. Everything inside that section is governed by the dropdown.
          Time-to-first-play is measured over the lifetime population and has
          no trailing window, so nesting it there would put a window-independent
          figure under a control that visibly does not move it — the same
          "two modules disagreeing on screen" failure 4.7's AC-3 exists to
          prevent, just inverted: not two controls for one number, but one
          control appearing to own a number it does not.

          Being a sibling of the section, not a child of it, is what makes the
          scoping legible rather than merely documented. It also keeps this a
          SERVER component: `LibraryUtilizationView` is `"use client"` only
          because it owns window state, and a module with no state and no
          interactivity has no reason to be dragged across that boundary.

          Below the pair rather than above it, per `LibraryUtilizationView`'s
          own note that further modules are expected to grow below it. */}
      <h2 className="lu-group-heading">First play</h2>
      <TimeToFirstPlay model={timeToFirstPlay} />

      {/* Last, so they sit under everything they speak for.

          TWO lines, not one, and they are not interchangeable: the first names
          exclusions on the ADD side (tracks with no add date, tracks whose add
          date can't be reconciled) and covers the meter and time-to-first-play;
          the second names exclusions on the PLAY side (plays with no track
          name, sets with no date) and covers Story 4.9's five modules. Folding
          them together would produce one sentence claiming both sets of
          exclusions apply to every figure above, which is false in both
          directions.

          Both return `null` rather than "0 excluded" when there is nothing to
          disclose — the Story 4.7 R-2 failure was a count dropping to 0
          precisely when it had the most to say. */}
      {undatedNote && <p className="lu-disclosure">{undatedNote}</p>}
      {utilizationNote && <p className="lu-disclosure">{utilizationNote}</p>}
    </>
  );
}
