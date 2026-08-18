import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConversionRateMeter } from "./ConversionRateMeter";
import { LibraryUtilizationReveal } from "./LibraryUtilizationReveal";
import { OneAndDone } from "./OneAndDone";
import { RepeatTrackRate } from "./RepeatTrackRate";
import { RotationSize } from "./RotationSize";
import { SetSimilarity } from "./SetSimilarity";
import { Workhorses } from "./Workhorses";
import type { ConversionWindow, LiveConversionRate } from "@/lib/sets/libraryConversion";
import { WORKHORSES_VISIBLE_ROWS } from "@/lib/sets/libraryUtilization";
import type {
  OneAndDoneModel,
  RepeatTrackRateModel,
  RotationSizeModel,
  SetSimilarityModel,
  WorkhorsesModel,
} from "@/lib/sets/libraryUtilization";

/** Story 7.7: an explicit zone — the suite is TZ-pinned to UTC, so a bare
 *  default would make a date assertion prove nothing about zones. */
const TEST_ZONE = "America/Los_Angeles";

/**
 * PROP-THREADING ASSERTIONS (Story 4.9, D-24).
 *
 * `deferred-work.md` has carried this as an open recommendation since the 4.5
 * merge, with a proven prototype that was deleted rather than committed because
 * adopting `web/`'s first component-render test "deserves its own decision".
 * Story 4.9 is that decision, and it is the story that most needed it: it
 * threads optional disclosure and model props through several new hops, and
 * `?: string | null` at every hop means `tsc --noEmit` and `eslint` stay fully
 * green while a line silently stops rendering. Nothing else in this suite would
 * catch that.
 *
 * **SCOPED NARROWLY, ON PURPOSE.** String assertions over rendered markup —
 * **no React Testing Library, no jsdom**. The house rule stands: logic lives in
 * `lib/sets/*` and components stay thin, and all the real behaviour here is
 * already covered by `libraryUtilization.test.ts`'s pure-function suite. This
 * file exists to answer exactly one question: *does the value reach the DOM?*
 * Do not let it grow into a component-testing framework.
 *
 * **EVERY THREADED PROP GETS A NEGATIVE CONTROL** — a case that removes or
 * empties the prop and asserts the copy disappears. Without it, an assertion
 * that some string is present can pass against markup that would render it
 * unconditionally, which is the failure mode this whole file exists to catch.
 */

/* ── Model builders — minimal, hand-written, deliberately not from fixtures ─ */

function rotation(overrides: Partial<RotationSizeModel> = {}): RotationSizeModel {
  return {
    distinctTracks: 180,
    totalPlays: 340,
    windowDays: 60,
    setCount: 12,
    undatedSetCount: 0,
    ...overrides,
  };
}

function repeats(overrides: Partial<RepeatTrackRateModel> = {}): RepeatTrackRateModel {
  return {
    rate: 0.42,
    measuredSetCount: 9,
    windowSets: 5,
    survivingSetCount: 10,
    undatedSetCount: 0,
    ...overrides,
  };
}

function similarity(overrides: Partial<SetSimilarityModel> = {}): SetSimilarityModel {
  return {
    axes: [
      { setId: "set-902", label: "SET 902", dayLabel: "Sat, Jun 13" },
      { setId: "set-901", label: "SET 901", dayLabel: "Fri, Jun 12" },
    ],
    matrix: [
      [null, 0.5],
      [0.5, null],
    ],
    shownSetCount: 2,
    survivingSetCount: 2,
    truncated: false,
    ranked: [{ a: 0, b: 1, share: 0.5 }],
    undatedSetCount: 0,
    ...overrides,
  };
}

function workhorses(rowCount: number): WorkhorsesModel {
  return {
    rows: Array.from({ length: rowCount }, (_, i) => ({
      title: `Track ${i}`,
      artist: `Artist ${i}`,
      setCount: rowCount - i,
      plays: rowCount - i,
      // Story 4.10: every row in this factory is linkable, so the negative
      // control below (a `null` id) is the one that proves the threading.
      trackId: `id${i}`,
    })),
    totalRowCount: rowCount,
    truncated: false,
    setCount: 10,
    nullTitlePlayCount: 0,
  };
}

function oneAndDone(rowCount: number): OneAndDoneModel {
  return {
    rows: Array.from({ length: rowCount }, (_, i) => ({
      title: `Once ${i}`,
      artist: `Artist ${i}`,
      lastPlayedMs: Date.UTC(2026, 5, 1) - i * 86_400_000,
      trackId: `id${i}`,
    })),
    // Non-zero: this factory builds the POPULATED model, and the module picks
    // its empty-state copy off this field (0 identified tracks means "nothing
    // played", not "everything repeated").
    identifiedTrackCount: Math.max(rowCount, 1),
    totalRowCount: rowCount,
    truncated: false,
    setCount: 10,
    nullTitlePlayCount: 0,
  };
}

const RATE: LiveConversionRate = {
  window: 60,
  added: 40,
  played: 20,
  rate: 0.5,
  lowConfidence: false,
  noAddDateCount: 0,
};
const RATES = { 60: RATE, 30: RATE, 14: RATE } as Record<ConversionWindow, LiveConversionRate>;

/* ═══════════════════════════════════════════════════════════════════════════ */

describe("RotationSize threads its model to the DOM (AC-7)", () => {
  it("renders both figures and its own fixed 60-day window", () => {
    const html = renderToStaticMarkup(<RotationSize model={rotation()} />);
    expect(html).toContain("340");
    expect(html).toContain("180");
    // D-21: the fixed window must be stated, or it is indistinguishable on
    // screen from a figure the conversion dropdown forgot to move.
    expect(html).toContain("60 days");
  });

  // NEGATIVE CONTROL.
  it("renders NO figure below its gate, and no figure in its accessible name either", () => {
    const html = renderToStaticMarkup(
      <RotationSize model={rotation({ distinctTracks: null, totalPlays: null, setCount: 0 })} />,
    );
    expect(html).not.toContain("340");
    expect(html).not.toContain("180");
    // AC-9's trap from Story 4.5's browser pass: an accessible name stating a
    // figure the visible UI declined to state.
    expect(html).toContain('aria-label="Rotation size"');
  });
});

describe("RepeatTrackRate threads its model to the DOM (AC-2, AC-3)", () => {
  it("renders the rate, the window and the sample size", () => {
    const html = renderToStaticMarkup(<RepeatTrackRate model={repeats()} />);
    expect(html).toContain("42%");
    // D-17 requires the count of sets the mean averaged over to be stated
    // alongside it — a mean over 1 night and over 40 are different claims.
    expect(html).toContain("9 nights");
    expect(html).toContain("5 sets before each one");
  });

  // NEGATIVE CONTROL.
  it("states nothing when the rate is null", () => {
    const html = renderToStaticMarkup(
      <RepeatTrackRate model={repeats({ rate: null, measuredSetCount: 0 })} />,
    );
    expect(html).not.toContain("42%");
    expect(html).not.toContain("nights");
    expect(html).toContain('aria-label="Repeat tracks"');
  });
});

describe("SetSimilarity threads its model to the DOM (AC-4, D-19, D-22)", () => {
  it("prints each cell's share as TEXT, not opacity alone (SC 1.4.1)", () => {
    const html = renderToStaticMarkup(<SetSimilarity model={similarity()} />);
    expect(html).toContain("50%");
    // The ramp is a redundant encoding; the number is the encoding.
    expect(html).toContain("--lu-sim-intensity");
  });

  it("always renders the degraded ranked list, which CSS alone chooses between (D-22)", () => {
    const html = renderToStaticMarkup(<SetSimilarity model={similarity()} />);
    expect(html).toContain("lu-sim-ranked");
    expect(html).toContain("50% shared");
    // Both forms are in the markup; the media query picks one. `display: none`
    // is what keeps the inactive one out of the accessibility tree.
    expect(html).toContain("lu-sim-grid");
  });

  it("states the cap when it bites (D-19 — a silent top-10 reads as 'all your history')", () => {
    const html = renderToStaticMarkup(
      <SetSimilarity model={similarity({ truncated: true, shownSetCount: 10, survivingSetCount: 58 })} />,
    );
    expect(html).toContain("10 most recent sets, of 58");
  });

  // NEGATIVE CONTROL for the cap note specifically.
  it("does NOT state the cap when nothing was truncated", () => {
    const html = renderToStaticMarkup(<SetSimilarity model={similarity()} />);
    expect(html).not.toContain("most recent sets, of");
  });

  it("hides the duplicate column-header dates from AT without leaving them focusable", () => {
    // Regression: `aria-hidden="true"` combined with `tabIndex={-1}` on a real
    // `<a href>` does not remove the element from the focus tree — only from
    // sequential Tab order — reintroducing the exact "focusable content inside
    // an aria-hidden subtree" trap this module's own doc comment describes
    // fixing for the row axis. The column headers must render as plain,
    // non-interactive markup instead.
    const html = renderToStaticMarkup(<SetSimilarity model={similarity()} />);
    expect(html).not.toMatch(/aria-hidden="true"[^>]*href=/);
    expect(html).not.toMatch(/href="[^"]*"[^>]*aria-hidden="true"/);
    expect(html).not.toContain("tabindex");
    // The row axis is still the one real, announced link into `/set/[id]`.
    expect(html).toContain('href="/set/set-902"');
  });

  // NEGATIVE CONTROL for the whole module.
  it("renders no matrix and no figure below its gate", () => {
    const html = renderToStaticMarkup(
      <SetSimilarity model={similarity({ ranked: [], matrix: [], axes: [], shownSetCount: 0 })} />,
    );
    expect(html).not.toContain("lu-sim-grid");
    // No percentage ABOUT THIS DJ's sets. Scoped to the elements that carry
    // one, rather than to the bare "%" character: the 2026-08-12 explainer
    // tooltip defines the scale with "two identical sets read 100%", which is
    // documentation of the formula and is true of a DJ with no sets at all.
    expect(html).not.toContain("lu-sim-cell-value");
    expect(html).not.toContain("lu-sim-ranked-row");
    expect(html).toContain('aria-label="Set similarity"');
  });
});

describe("Workhorses and OneAndDone thread their rows to the DOM (AC-5, AC-6)", () => {
  it("renders the visible rows with title, artist and value", () => {
    const html = renderToStaticMarkup(<Workhorses model={workhorses(3)} />);
    expect(html).toContain("Track 0");
    expect(html).toContain("Artist 0");
    expect(html).toContain("3 sets");
  });

  // The "Show the other N" `<details>` became a bounded scroll region on
  // 2026-08-12 (Arjun). What has to stay true is the property EXPERIENCE.md:108
  // is actually about — nothing is dropped — so that is what this asserts, and
  // the affordance it is reached by is now an implementation detail.
  // Sized off the constant, never a literal: the visible-row count moved 6 → 10
  // on 2026-08-12 and these assertions were the only thing that noticed.
  const OVERFLOWING = WORKHORSES_VISIBLE_ROWS + 4;

  it("keeps the overflow in the markup rather than dropping it (EXPERIENCE.md:108)", () => {
    const html = renderToStaticMarkup(<Workhorses model={workhorses(OVERFLOWING)} />);
    // Every row is in the DOM, including the ones past the visible height.
    expect(html).toContain(`Track ${OVERFLOWING - 1}`);
    expect(html).not.toContain("<details");
    // The box is bounded to the visible-row count and made focusable, so a
    // keyboard-only user can reach the rows below the fold.
    expect(html).toContain(`--lu-rows-visible:${WORKHORSES_VISIBLE_ROWS}`);
    expect(html).toContain('tabindex="0"');
  });

  // NEGATIVE CONTROL — a list that fits neither reserves the full height nor
  // takes a tab stop that would do nothing.
  it("does not bound or focus a list that already fits", () => {
    const html = renderToStaticMarkup(<Workhorses model={workhorses(4)} />);
    expect(html).toContain("--lu-rows-visible:4");
    expect(html).not.toContain('tabindex="0"');
    expect(html).not.toContain("<details");
  });

  it("uses no ranking vocabulary in the rendered markup (DESIGN.md:199)", () => {
    const html = renderToStaticMarkup(<Workhorses model={workhorses(10)} />).toLowerCase();
    for (const banned of ["top ", "best", "#1", "winner", "champion", "medal", "badge"]) {
      expect(html).not.toContain(banned);
    }
  });

  it("renders one-and-done rows with a date, and an em dash when the play was undated", () => {
    const dated = renderToStaticMarkup(<OneAndDone model={oneAndDone(2)} zone={TEST_ZONE} />);
    expect(dated).toContain("Once 0");

    // Story 7.7: this used to assert `toContain("Jun")`, because the fixture's
    // instant is early on June 1 UTC and the row rendered in the process zone,
    // which the suite pins to UTC. It now renders in the ZONE PROP — and in Los
    // Angeles that instant is still May 31. So the row correctly reads May, and
    // the change of month is itself the proof that the prop reaches the DOM
    // rather than being ignored in favour of the process zone.
    expect(dated).toContain("May 31");
    const utc = renderToStaticMarkup(<OneAndDone model={oneAndDone(2)} zone="UTC" />);
    expect(utc).toContain("Jun 1");

    const undated = renderToStaticMarkup(
      <OneAndDone
        zone={TEST_ZONE}
        model={{
          ...oneAndDone(1),
          rows: [{ title: "No Time", artist: "Artist", lastPlayedMs: -Infinity, trackId: "id0" }],
        }}
      />,
    );
    expect(undated).toContain("No Time");
    expect(undated).toContain("—");
  });

  // NEGATIVE CONTROL.
  it("renders no rows below the gate", () => {
    const html = renderToStaticMarkup(<OneAndDone model={oneAndDone(0)} zone={TEST_ZONE} />);
    expect(html).not.toContain("lu-row-list");
    expect(html).toContain('aria-label="Played once"');
  });
});

describe("LibraryUtilizationReveal threads both subtrees and the descriptor (D-20)", () => {
  it("renders the EXCLUDING subtree by default, never the including one", () => {
    const html = renderToStaticMarkup(
      <LibraryUtilizationReveal
        hiddenCount={3}
        excluding={<p>SURVIVING POPULATION</p>}
        including={<p>EVERY SET</p>}
      />,
    );
    expect(html).toContain("SURVIVING POPULATION");
    // D-4: unpersisted, resets to hidden on every load. If this ever flips,
    // the page silently starts counting soundchecks again.
    expect(html).not.toContain("EVERY SET");
  });

  // D-20(iii). THE COPY BUG THIS PROP EXISTS TO PREVENT: the shared component's
  // default says "low-confidence", which is false here — the compound predicate
  // also hides SHORT sessions that scored a fully confident 1.0.
  it("overrides the reveal's noun so the count's description matches what it hid", () => {
    const html = renderToStaticMarkup(
      <LibraryUtilizationReveal hiddenCount={3} excluding={<p>a</p>} including={<p>b</p>} />,
    );
    expect(html).toContain("3 short or low-confidence sessions hidden");
    expect(html).not.toContain("3 low-confidence sessions hidden");
  });

  // NEGATIVE CONTROL.
  it("renders no control at all when nothing was hidden", () => {
    const html = renderToStaticMarkup(
      <LibraryUtilizationReveal hiddenCount={0} excluding={<p>SURVIVING</p>} including={<p>ALL</p>} />,
    );
    expect(html).not.toContain("hidden");
    expect(html).not.toContain("lu-reveal");
    expect(html).toContain("SURVIVING");
  });
});

// The prop `deferred-work.md` named specifically: `unidentifiableDisclosure` is
// `?: string | null` at all three hops (page → view → meter), so deleting any
// one of them leaves `tsc` and `eslint` green while Story 4.11's AC-6 line
// silently stops rendering.
describe("ConversionRateMeter still renders its threaded disclosure (Story 4.11 AC-6)", () => {
  it("renders the disclosure it is handed", () => {
    const html = renderToStaticMarkup(
      <ConversionRateMeter rates={RATES} window={60} unidentifiableDisclosure="252 of 910 rows have no name" />,
    );
    expect(html).toContain("252 of 910 rows have no name");
  });

  // NEGATIVE CONTROL — the exact assertion that fails if the prop is dropped
  // at any hop.
  it("renders nothing in its place when the prop is absent", () => {
    const html = renderToStaticMarkup(<ConversionRateMeter rates={RATES} window={60} />);
    expect(html).not.toContain("252 of 910");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Story 4.10 — `trackId` threading (AC-3/AC-4, D-26)
   ═══════════════════════════════════════════════════════════════════════════ */

describe("trackId reaches the DOM as a link, and its absence reaches it as plain text", () => {
  it("links a workhorse row's title to /track/[track_id]", () => {
    const html = renderToStaticMarkup(<Workhorses model={workhorses(1)} />);
    expect(html).toContain('href="/track/id0"');
    expect(html).toContain("lu-row-link");
  });

  // NEGATIVE CONTROL — the whole point of D-26. Without this, the assertion
  // above would pass against markup that linked every row unconditionally, and
  // the ~21% of tracks with no identity would ship as links that 404.
  it("renders an unlinkable workhorse row as plain text, not a dead link", () => {
    const model = workhorses(1);
    const html = renderToStaticMarkup(
      <Workhorses model={{ ...model, rows: [{ ...model.rows[0], trackId: null }] }} />,
    );
    expect(html).toContain("Track 0");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("/track/");
  });

  it("links a played-once row's title", () => {
    const html = renderToStaticMarkup(<OneAndDone model={oneAndDone(1)} zone={TEST_ZONE} />);
    expect(html).toContain('href="/track/id0"');
  });

  // NEGATIVE CONTROL.
  it("renders an unlinkable played-once row as plain text", () => {
    const model = oneAndDone(1);
    const html = renderToStaticMarkup(
      <OneAndDone model={{ ...model, rows: [{ ...model.rows[0], trackId: null }] }} zone={TEST_ZONE} />,
    );
    expect(html).toContain("Once 0");
    expect(html).not.toContain("<a");
  });

  // A `track_id` is 16 hex characters, so this is belt-and-braces — but the id
  // is untrusted text off the wire, and building a route from unescaped input
  // is how a path separator becomes a different route.
  it("escapes an id rather than letting it forge a path", () => {
    const model = workhorses(1);
    const html = renderToStaticMarkup(
      <Workhorses model={{ ...model, rows: [{ ...model.rows[0], trackId: "a/../b" }] }} />,
    );
    expect(html).toContain('href="/track/a%2F..%2Fb"');
  });

  it("links rows below the visible fold too", () => {
    // 8 rows exceeds the 6 the box is sized for, so the last two are only
    // reachable by scrolling — and must link like the rest.
    const html = renderToStaticMarkup(<Workhorses model={workhorses(8)} />);
    expect(html).toContain('href="/track/id7"');
  });
});
