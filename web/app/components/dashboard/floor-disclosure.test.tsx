import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeroBand } from "./HeroBand";
import { SetListPanel } from "./SetListPanel";
import { buildSetRows } from "@/lib/sets/listModel";
import type { DancefloorSegment } from "@/lib/sets/dancefloor";
import type { SetRecord, SyncPlay } from "@/lib/sets/types";

/** Story 7.7: an explicit zone, never the process's. The suite is TZ-pinned to
 *  UTC, so a bare default would make these assertions prove nothing about zones. */
const TEST_ZONE = "America/Los_Angeles";

/**
 * RENDER ASSERTIONS for AC #4's "+N more floors" disclosure (Story 5.4, Task 3.3).
 *
 * This file exists because the story shipped WITHOUT it, on the recorded
 * grounds that these two components "could not get render-assertion tests:
 * both call hooks (`usePrefersReducedMotion` et al.) that read
 * `window.matchMedia` synchronously during initial render, which crashes under
 * this repo's jsdom-less `renderToStaticMarkup` test harness."
 *
 * That is not true, and the distinction is worth keeping written down: the hook
 * chain here (`MetalButton` → `useMediaQuery`, `app/components/ui/metal-hooks.ts`)
 * is `useSyncExternalStore` with a `getServerSnapshot` of `() => false`. React
 * calls the SERVER snapshot on a server render and never touches
 * `window.matchMedia` at all. A hook *importing* a browser API is not the same
 * as a hook *calling* it during SSR — check for the third `useSyncExternalStore`
 * argument before concluding a component is untestable here.
 *
 * Both AC #4 surfaces render clean below with no jsdom and no mocking.
 * (Code review 2026-08-11.)
 */

const play = (position: number, started_at: string): SyncPlay =>
  ({
    id: `p${position}`,
    position,
    started_at,
    title: `Track ${position}`,
    artist: "An Artist",
    bpm: 128,
    key_value: null,
    key_camelot: null,
    genre: "Techno",
    subgenre: null,
    duration_sec: 300,
    is_new: false,
  }) as unknown as SyncPlay;

const seg = (id: string, start: string, end: string): DancefloorSegment => ({
  id,
  firstPlayId: `first-${id}`,
  lastPlayId: `last-${id}`,
  confirmed: true,
  start,
  end,
});

/**
 * `confidence: 1.0` and a track count at or above the hero minimum are both
 * load-bearing: `isLowConfidenceSet` hides anything below either bar, and a
 * hidden row renders no disclosure to assert on. Getting this wrong is what
 * makes a green disclosure test that never rendered a row.
 */
function set(segments: DancefloorSegment[]): SetRecord {
  return {
    id: "set-1",
    started_at: "2026-06-21T22:00:00.000Z",
    ended_at: "2026-06-22T03:00:00.000Z",
    venue: "A Venue",
    derived: {
      bpm_distribution: { count: 3, mean: 128, median: 128 },
      confidence: { value: 1.0 },
      set_length_sec: 18000,
      track_count: 12,
      energy_arc: [
        { started_at: "2026-06-21T22:10:00.000Z", value: 0.4 },
        { started_at: "2026-06-21T23:10:00.000Z", value: 0.8 },
        { started_at: "2026-06-22T01:10:00.000Z", value: 0.6 },
      ],
    },
    plays: [
      play(1, "2026-06-21T22:10:00.000Z"),
      play(2, "2026-06-21T23:10:00.000Z"),
      play(3, "2026-06-22T01:10:00.000Z"),
    ],
    segments,
  } as unknown as SetRecord;
}

const ONE_FLOOR = [seg("a", "2026-06-21T22:00:00.000Z", "2026-06-22T00:00:00.000Z")];
const THREE_FLOORS = [
  seg("a", "2026-06-21T22:00:00.000Z", "2026-06-22T00:00:00.000Z"),
  seg("b", "2026-06-22T01:00:00.000Z", "2026-06-22T01:30:00.000Z"),
  seg("c", "2026-06-22T02:00:00.000Z", "2026-06-22T02:20:00.000Z"),
];

describe("HeroBand's floor disclosure (AC #4)", () => {
  it("says nothing on a single-floor set — the common case stays untouched", () => {
    const html = renderToStaticMarkup(<HeroBand set={set(ONE_FLOOR)} zone={TEST_ZONE} />);
    expect(html).toContain("Dancefloor tracks");
    expect(html).not.toContain("more floor");
  });

  it("discloses the rest on a several-floor set", () => {
    const html = renderToStaticMarkup(<HeroBand set={set(THREE_FLOORS)} zone={TEST_ZONE} />);
    expect(html).toContain("+2 more floors");
  });

  it("renders at all with zero segments — the whole-set fallback, no disclosure", () => {
    const html = renderToStaticMarkup(<HeroBand set={set([])} zone={TEST_ZONE} />);
    expect(html).not.toContain("more floor");
    expect(html.length).toBeGreaterThan(0);
  });
});

describe("SetListPanel's floor disclosure (AC #4)", () => {
  it("says nothing on a single-floor row", () => {
    const html = renderToStaticMarkup(<SetListPanel rows={buildSetRows([set(ONE_FLOOR)], TEST_ZONE)} />);
    expect(html).toContain("dz-row-meta");
    expect(html).not.toContain("more floor");
    expect(html).not.toContain("dz-floor-disclosure");
  });

  it("discloses the rest on a several-floor row, pluralized", () => {
    const html = renderToStaticMarkup(<SetListPanel rows={buildSetRows([set(THREE_FLOORS)], TEST_ZONE)} />);
    expect(html).toContain("dz-floor-disclosure");
    expect(html).toContain("+2 more floors");
  });

  it("uses the singular at exactly two floors", () => {
    const html = renderToStaticMarkup(
      <SetListPanel rows={buildSetRows([set(THREE_FLOORS.slice(0, 2))], TEST_ZONE)} />,
    );
    expect(html).toContain("+1 more floor");
    expect(html).not.toContain("+1 more floors");
  });
});
