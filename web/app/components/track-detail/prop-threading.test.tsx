import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TrackDetail } from "./TrackDetail";
import type { LibraryRosterEntry } from "@/lib/sets/libraryRoster";
import type { MixNeighbourRow, TrackPlayRecord } from "@/lib/sets/trackDetail";
import type { SyncPlay, SyncSetDerived } from "@/lib/sets/types";

/**
 * PROP-THREADING ASSERTIONS for `/track/[track_id]` (Story 4.10, D-24).
 *
 * Same scope and same house rules as
 * `components/library-utilization/prop-threading.test.tsx`: string assertions
 * over rendered markup, **no React Testing Library and no jsdom**, and every
 * threaded prop gets a negative control. The real behaviour is covered by
 * `lib/sets/trackDetail.test.ts`'s pure-function suite; this file answers one
 * question only — *does the value reach the DOM?*
 *
 * `ClockStrip` renders its pre-hydration branch here, which is exactly right:
 * `useSyncExternalStore`'s server snapshot is `false`, so this suite sees the
 * markup a real server render produces, and the fact that no hour string
 * appears in it IS D-32's guarantee under test.
 */

function derived(confidence = 1.0, trackCount = 40): SyncSetDerived {
  return {
    most_played_tracks: [],
    most_played_artists: [],
    genre_breakdown: { buckets: [], no_genre_count: 0 },
    bpm_distribution: { count: 0, min: 0, max: 0, mean: 0, median: 0 },
    camelot_mixing_stats: { compatible_transitions: 0, incompatible_transitions: 0, excluded_no_key: 0 },
    set_length_sec: null,
    track_count: trackCount,
    energy_arc: [],
    confidence: { value: confidence, track_count: trackCount, long_gap_count: 0 },
  } as unknown as SyncSetDerived;
}

function record(overrides: {
  setId?: string;
  setLabel?: string | null;
  trackCount?: number;
  play?: Partial<SyncPlay>;
}): TrackPlayRecord {
  return {
    setId: overrides.setId ?? "set-1",
    setLabel: "setLabel" in overrides ? (overrides.setLabel ?? null) : "serato4:975",
    setStartedAt: "2026-06-01T21:00:00.000Z",
    setDerived: derived(1.0, overrides.trackCount ?? 40),
    play: {
      position: 4,
      title: "Deep End",
      artist: "Hardrive",
      started_at: "2026-06-01T22:00:00.000Z",
      bpm: 124,
      genre: { raw: "House", normalized: "house", taxonomy_version: 1, subgenre: "deep house" },
      camelot_key: "8A",
      in_library: true,
      played_ms: 222_000,
      library_added_at: "2026-05-01T00:00:00.000Z",
      ...overrides.play,
    } as SyncPlay,
  };
}

const ROSTER: LibraryRosterEntry = {
  track_id: "id-deep",
  title: "Deep End",
  artist: "Hardrive",
  added_at: "2026-05-01T00:00:00.000Z",
  is_baseline: true,
  absent_at: null,
};

const NEIGHBOURS: MixNeighbourRow[] = [
  { set_id: "set-1", position: 3, title: "Came Before", artist: "A", track_id: "id-before" },
  { set_id: "set-1", position: 5, title: "Came After", artist: "B", track_id: null },
];

describe("identity and tags reach the DOM (AC-5)", () => {
  it("renders title, artist and every tag", () => {
    const html = renderToStaticMarkup(
      <TrackDetail plays={[record({})]} roster={ROSTER} neighbourRows={[]} />,
    );
    expect(html).toContain("Deep End");
    expect(html).toContain("Hardrive");
    expect(html).toContain("124");
    expect(html).toContain("8A");
    expect(html).toContain("house → deep house");
  });

  // NEGATIVE CONTROL — FR-2's convention is that an absent field is NAMED, not
  // blank and not guessed. Without this, the assertions above would pass
  // against markup that simply omitted a missing tag.
  it("renders Unknown for every absent tag rather than a blank cell", () => {
    const html = renderToStaticMarkup(
      <TrackDetail
        plays={[record({ play: { bpm: null, camelot_key: null, genre: null, library_added_at: null } })]}
        roster={null}
        neighbourRows={[]}
      />,
    );
    // BPM, key, genre and add date — four Unknowns, none of them omitted.
    expect(html.match(/Unknown/g)?.length).toBe(4);
  });

  it("treats a whitespace-only title as absent rather than rendering a blank heading", () => {
    const html = renderToStaticMarkup(
      <TrackDetail plays={[record({ play: { title: "   ", artist: "" } })]} roster={null} neighbourRows={[]} />,
    );
    expect(html).toContain(">Unknown</h1>");
  });

  it("renders a genre with no subgenre without inventing the arrow", () => {
    const html = renderToStaticMarkup(
      <TrackDetail
        plays={[record({ play: { genre: { raw: "Techno", normalized: "techno", taxonomy_version: 1 } } })]}
        roster={ROSTER}
        neighbourRows={[]}
      />,
    );
    expect(html).toContain("techno");
    expect(html).not.toContain("→");
  });
});

describe("play history reaches the DOM (AC-7)", () => {
  it("links each set row into /set/[id] under its session label, not its uuid", () => {
    const html = renderToStaticMarkup(
      <TrackDetail
        plays={[record({ setId: "872d5614-9894-5803-80f5-aa1dd4177944" })]}
        roster={ROSTER}
        neighbourRows={[]}
      />,
    );
    expect(html).toContain('href="/set/872d5614-9894-5803-80f5-aa1dd4177944"');
    expect(html).toContain("SET 975");
  });

  // NEGATIVE CONTROL for the label fallback.
  it("renders an unlabelled set as Untitled set rather than as a uuid", () => {
    const html = renderToStaticMarkup(
      <TrackDetail plays={[record({ setLabel: null })]} roster={ROSTER} neighbourRows={[]} />,
    );
    expect(html).toContain("Untitled set");
  });
});

describe("ride time reaches the DOM (AC-9/AC-11)", () => {
  it("renders the duration at minute-and-second scale", () => {
    const html = renderToStaticMarkup(
      <TrackDetail plays={[record({}), record({ setId: "set-2" })]} roster={ROSTER} neighbourRows={[]} />,
    );
    expect(html).toContain("3m 42s");
  });

  // AC-11's n=1 form, and the word this story must not ship at n=1.
  it("never says 'typically' on a single play", () => {
    const html = renderToStaticMarkup(
      <TrackDetail plays={[record({})]} roster={ROSTER} neighbourRows={[]} />,
    );
    expect(html).toContain("on its one play");
    expect(html).not.toContain("typical");
  });

  // NEGATIVE CONTROL — the Story 4.7 R-2 shape: the disclosure must survive the
  // case where EVERY play is missing a duration.
  it("discloses the excluded count when no play carried a duration", () => {
    const html = renderToStaticMarkup(
      <TrackDetail plays={[record({ play: { played_ms: null } })]} roster={ROSTER} neighbourRows={[]} />,
    );
    expect(html).toContain("1 play carries no duration");
    expect(html).not.toContain("0 plays");
  });
});

describe("mix neighbours reach the DOM (AC-10, D-26)", () => {
  it("renders both sides, linking only the neighbour that has an identity", () => {
    const html = renderToStaticMarkup(
      <TrackDetail plays={[record({})]} roster={ROSTER} neighbourRows={NEIGHBOURS} />,
    );
    expect(html).toContain("Came Before");
    expect(html).toContain("Came After");
    expect(html).toContain('href="/track/id-before"');
    // NEGATIVE CONTROL: the unlinkable neighbour is present and is NOT a link.
    expect(html).not.toContain("/track/id-after");
  });

  it("uses no ranking vocabulary anywhere in the rendered page", () => {
    const html = renderToStaticMarkup(
      <TrackDetail plays={[record({})]} roster={ROSTER} neighbourRows={NEIGHBOURS} />,
    );
    expect(html.toLowerCase()).not.toMatch(/\b(best|winner|ranked|#1)\b/);
  });
});

describe("the clock strip renders no hour server-side (D-32)", () => {
  // The guarantee, under test: `useSyncExternalStore`'s SERVER snapshot is
  // `false`, so a server render emits the placeholder and not a single hour
  // label. If this ever fails, the page has started rendering the SERVER's
  // timezone to every DJ — and would hydrate-mismatch besides.
  it("emits the placeholder, never a formatted hour", () => {
    const html = renderToStaticMarkup(
      <TrackDetail plays={[record({})]} roster={ROSTER} neighbourRows={[]} />,
    );
    expect(html).toContain("Reading your clock");
    expect(html).not.toMatch(/\b\d{1,2}(am|pm)\b/);
  });
});

describe("the cold start is a designed state, not four empty modules (D-38)", () => {
  it("renders identity, the add date and one honest line for an owned, unplayed track", () => {
    const html = renderToStaticMarkup(<TrackDetail plays={[]} roster={ROSTER} neighbourRows={[]} />);
    expect(html).toContain("Deep End");
    expect(html).toContain("In your library, not played yet");
    // NEGATIVE CONTROL: none of the four play-side modules render at all.
    expect(html).not.toContain("Play history");
    expect(html).not.toContain("Ride time");
    expect(html).not.toContain("Mix neighbours");
  });

  it("says so when a played track is no longer in the library sync", () => {
    const html = renderToStaticMarkup(
      <TrackDetail plays={[record({})]} roster={null} neighbourRows={[]} />,
    );
    expect(html).toContain("not in your current library sync");
  });

  // NEGATIVE CONTROL for the line above.
  it("stays silent about the roster when the track is in it", () => {
    const html = renderToStaticMarkup(
      <TrackDetail plays={[record({})]} roster={ROSTER} neighbourRows={[]} />,
    );
    expect(html).not.toContain("not in your current library sync");
  });
});

describe("AC-12's reveal is wired on this surface too (D-34)", () => {
  it("renders the reveal control when a play sits in a short set, and hides that play", () => {
    const html = renderToStaticMarkup(
      <TrackDetail
        plays={[record({}), record({ setId: "soundcheck", trackCount: 2 })]}
        roster={ROSTER}
        neighbourRows={[]}
      />,
    );
    expect(html).toContain("short or low-confidence");
    // One play surviving, not two — the soundcheck is excluded by default.
    expect(html).toContain("Played 1 time across 1 set");
  });

  // NEGATIVE CONTROL: no control at all when the predicate hides nothing.
  it("renders no reveal control when every set clears the predicate", () => {
    const html = renderToStaticMarkup(
      <TrackDetail plays={[record({})]} roster={ROSTER} neighbourRows={[]} />,
    );
    expect(html).not.toContain("short or low-confidence");
  });
});
