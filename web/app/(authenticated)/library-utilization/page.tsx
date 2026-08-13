import { getLibraryAddEvents, getLibraryRoster, getObservationStart, getRecentSets } from "@/lib/sets";
import { buildAgingShelf } from "@/lib/sets/agingShelf";
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
  type UtilizationIndex,
} from "@/lib/sets/libraryUtilization";
import { buildTrackSearchIndex } from "@/lib/sets/trackSearch";
import { unidentifiableTracksDisclosure } from "@/lib/sets/libraryRoster";
import type { SetRecord } from "@/lib/sets";
import type { LibraryAddEventSnapshot } from "@/lib/sets";
import type { LibraryRosterSnapshot } from "@/lib/sets/libraryRoster";
import { SilkBackdrop } from "@/app/components/dashboard/SilkBackdrop";
import { AgingShelf } from "@/app/components/library-utilization/AgingShelf";
import { LibraryUtilizationReveal } from "@/app/components/library-utilization/LibraryUtilizationReveal";
import { LibraryUtilizationView } from "@/app/components/library-utilization/LibraryUtilizationView";
import { OneAndDone } from "@/app/components/library-utilization/OneAndDone";
import { RepeatTrackRate } from "@/app/components/library-utilization/RepeatTrackRate";
import { RotationSize } from "@/app/components/library-utilization/RotationSize";
import { SetSimilarity } from "@/app/components/library-utilization/SetSimilarity";
import { TimeToFirstPlay } from "@/app/components/library-utilization/TimeToFirstPlay";
import { Workhorses } from "@/app/components/library-utilization/Workhorses";

// Library Utilization (Story 4.3, AC-5; Story 4.4; Story 4.5; Story 4.7,
// AC-3; composed by Story 4.9) — supersedes the Story 3.5 throwaway stub.
// Reads through the SAME data-access seam `style-evolution/page.tsx` uses
// (`getRecentSets`, `getLibraryAddEvents`), plus `getLibraryRoster` (Story
// 4.11 — now a real Supabase read as of Story 4.4, feeding both the
// disclosure below and the aging shelf's rows) and `getObservationStart`
// (Story 4.4).
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
  const [sets, addEvents, roster, observationStartMs] = await Promise.all([
    getRecentSets(),
    getLibraryAddEvents(),
    getLibraryRoster(),
    // Story 4.4, Context §3: `djs.created_at`, the lower bound on the aging
    // shelf's clock. `null` is a BINDING instruction to suppress the shelf's
    // no-play branch (AC-11), not merely "render nothing" — see
    // `getObservationStart`'s own doc comment before treating it like the
    // other calm fallbacks on this line.
    getObservationStart(),
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

  // Story 4.10. Hoisted OUT of `renderBody` and threaded in, because search
  // needs both populations at once and `renderBody` only ever sees one. Not an
  // extra pass either — `renderBody` used to build its own index per call, so
  // this is the same two builds, now reachable from both consumers.
  const survivingIndex = buildUtilizationIndex(surviving);
  // Reuses the surviving index when nothing was hidden: the two populations are
  // then the same list, and `buildUtilizationIndex` is a full walk over every
  // play of every set. Same "don't build what nothing can read" rule the
  // `including` prop below already follows.
  const allIndex = hidden.length > 0 ? buildUtilizationIndex(sets) : survivingIndex;
  const searchIndex = buildTrackSearchIndex(survivingIndex, allIndex, roster.entries);

  return (
    <main className="lu">
      <SilkBackdrop />
      {/* The subtitle ("How much of your library actually makes it to the
          dancefloor.") is GONE — Arjun, 2026-08-12. It restated the page title
          in a longer form, and it sat directly above `.lu-capture-note`, which
          is a second line of page-level prose the DJ actually needs. Two
          stacked explanatory sentences before the first number is what made the
          top of this page read as a preamble. */}
      <header className="lu-header">
        <h1 className="lu-title">Library Utilization</h1>
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
      {/* Story 4.10 (AC-1/AC-2/AC-13) — the track lookup, threaded through the
          reveal's `search` slot.

          **PLACEMENT DEVIATES FROM D-36, deliberately and flagged for review.**
          D-36 asks for the field "inside the 'Tracks' group, above the pair",
          and in the same breath names the reason it cannot be there: the Tracks
          group lives inside `renderBody`, `renderBody` is called TWICE, and
          "putting query state inside it produces two independent search
          fields" — a DJ's typed query silently discarded the moment they touch
          the reveal. The two clauses are not both satisfiable, and only one of
          them has a named failure mode, so that one governs.

          Page level is also where a search field belongs on its merits: it is
          the one control here that answers a question about a single track
          rather than about an aggregate, and it reads as the page's lead tool
          rather than as a caption on the workhorses list.

          It is a SLOT on the reveal rather than a sibling here because its
          results carry play counts and so are governed by the same exclusion —
          see `LibraryUtilizationReveal`'s `search` prop for the two-controls
          defect that shape fixes.

          No new `<h2>` and no new landmark, per the rest of D-36. */}
      <LibraryUtilizationReveal
        hiddenCount={hidden.length}
        search={searchIndex}
        excluding={renderBody(
          surviving,
          survivingIndex,
          addEvents,
          unidentifiableDisclosure,
          roster,
          observationStartMs,
        )}
        including={
          hidden.length > 0
            ? renderBody(sets, allIndex, addEvents, unidentifiableDisclosure, roster, observationStartMs)
            : null
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
  // Story 4.10: built by the page rather than here, because the search field
  // outside this function needs BOTH populations' indices and this function
  // only ever sees one. Passed in rather than rebuilt so the two never diverge.
  utilization: UtilizationIndex,
  addEvents: LibraryAddEventSnapshot,
  unidentifiableDisclosure: string | null,
  // Story 4.4's two inputs, threaded rather than closed over. The aging shelf
  // is built in here (not in the page body where 4.4 had it) because its
  // `plays` argument is the per-population play index — so the shelf moves
  // with the D-20 reveal like every other figure on the page, instead of
  // being the one module that silently keeps counting soundchecks.
  roster: LibraryRosterSnapshot,
  observationStartMs: number | null,
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

  // Story 4.4 (FR-12): the aging shelf. The FOURTH module to read the one
  // shared `playIndex` — it asks a different question of the same ascending
  // arrays (the LAST play, where the three conversion metrics read the first
  // at-or-after), which is exactly why one index is shared rather than each
  // module diffing `sets` for itself.
  //
  // Reads `roster.entries`, NOT `addEvents.events`, and the difference is the
  // point: `library_track_events` is go-forward-only by construction, so it
  // structurally cannot contain the pre-install back catalogue this shelf
  // exists to surface. `library_roster` carries baseline tracks on purpose
  // (AD-22) — which is also why `observationStartMs` has to clamp the clock
  // here where Story 4.5's module needed no such filter.
  //
  // **`roster.added_at`/`is_baseline` stop here.** They must never reach any
  // conversion computation: `library_track_events` remains the only cohort
  // denominator (AD-22, Story 4.11 AC-3), and a baseline track's real
  // pre-install add-date entering cohort math would retroactively populate old
  // months against a still-go-forward numerator, silently changing numbers the
  // DJ has already seen.
  //
  // Clock from the data seam (`readAtMs`), never `Date.now()` here — Story
  // 4.1's review lesson, and `react-hooks/purity` rejects it besides.
  const agingShelf = buildAgingShelf(
    roster.entries,
    observationStartMs,
    addEvents.readAtMs,
    playIndex,
  );

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
      {/* Layout pass (Arjun, 2026-08-13): these two were the last direct `.lu`
          children still capped at 440px, stacked one above the other, which
          left an 864 × 590px empty rectangle down the right of the page's
          final screen — the single worst piece of the dead space this pass
          exists to remove. They are now a `.lu-pair` like the two rows above,
          so the page has exactly two row shapes (halves, and full width)
          instead of five widths.

          Pairing them is defensible on the content too: both are about a
          track's distance from a dancefloor in TIME — how long the played ones
          waited, and how long the unplayed ones have been waiting.

          **Open copy question, flagged rather than decided.** The `<h2>First
          play</h2>` above now sits over a two-card row whose right card is the
          shelf, and it only describes the left one. The DOM heading order is
          unchanged (`First play`, then `AgingShelf`'s own `<h2>`), so nothing
          about heading navigation moved — but the visible label is now doing
          less work than it looks like it is. Renaming it to cover both is a
          copy decision, which is not this pass's to make. */}
      <div className="lu-pair">
        <TimeToFirstPlay model={timeToFirstPlay} />

      {/* ── Shelf ─────────────────────────────────────────────────────────
          Story 4.4's aging shelf, kept at the placement it SHIPPED with — a
          sibling below `TimeToFirstPlay`, outside `LibraryUtilizationView`,
          for the same reason stated at length above: the shelf has no trailing
          window, so nesting it under the shared conversion dropdown would put
          a window-independent list under a control that visibly does not move
          it.

          Story 4.9 had left a note here suggesting the shelf belongs NEXT TO
          one-and-done under "Tracks", since both are neglect lists. 4.4 landed
          first and placed it here, and re-siting shipped UI is not a decision
          a merge should make on its own — so the suggestion is recorded as
          still open rather than silently applied or silently dropped. It needs
          no heading from this page: `AgingShelf` renders its own `<h2>Aging
          shelf</h2>`, and adding one here put TWO H2s over one module in the
          rendered outline — caught by the post-merge browser pass, not by
          reading the diff.

          One inconsistency left deliberately: `AgingShelf` renders a
          `<section aria-label>`, so the page's landmark count is 3 rather than
          the 2 that R-10's fix established by converting every module to
          `<div role="group">`. 4.4 shipped it that way in parallel; changing
          another story's markup is not a merge decision. Logged in
          `deferred-work.md` instead.

          The two lists remain complements, not duplicates, and the distinction
          is the reason a merge could reasonably leave them apart: one-and-done
          is about tracks the DJ DID play and dropped; the shelf is about
          tracks never reached at all.

          Unlike the modules above it this one IS a client component, but only
          for a single `useState` holding the sort direction — the whole model
          is computed on the server and passed in, so the page itself stays a
          server component and no data work crosses the boundary. */}
        <AgingShelf model={agingShelf} />
      </div>

      {/* Last, so they sit under everything they speak for.

          TWO lines, not one, and they are not interchangeable: the first names
          exclusions on the ADD side (tracks with no add date, tracks whose add
          date can't be reconciled) and covers the meter, time-to-first-play and
          the shelf; the second names exclusions on the PLAY side (sets with no
          date) and covers Story 4.9's five modules. Folding them together would
          produce one sentence claiming both sets of exclusions apply to every
          figure above, which is false in both directions.

          Both return `null` rather than "0 excluded" when there is nothing to
          disclose — the Story 4.7 R-2 failure was a count dropping to 0
          precisely when it had the most to say. */}
      {undatedNote && <p className="lu-disclosure">{undatedNote}</p>}
      {utilizationNote && <p className="lu-disclosure">{utilizationNote}</p>}
    </>
  );
}
