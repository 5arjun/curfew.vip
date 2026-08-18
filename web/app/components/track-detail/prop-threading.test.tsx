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
 * `ClockStrip` and `ClientDayDate` render their real output here (Story 7.7).
 * They used to render a pre-hydration placeholder, and this suite used to
 * assert that no hour or day string appeared in a server render at all — the
 * D-32 guarantee, back when no zone existed anywhere in the system and the
 * server's own zone was the only thing a server render could have used.
 *
 * A set now carries the zone it was captured in, so the guarantee inverted:
 * the hour and the day MUST render server-side, and must be the DJ's. The
 * tests at the bottom of this file assert the new rule in the only way that
 * actually distinguishes it from the old bug — by rendering the same instant
 * under two different set zones and requiring the output to differ.
 */

function derived(
  confidence = 1.0,
  trackCount = 40,
  timezone: string | null = "America/Los_Angeles",
): SyncSetDerived {
  return {
    timezone,
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
  /** The zone the SET was captured in (Story 7.7). `null` = a pre-7.7 agent. */
  timezone?: string | null;
  play?: Partial<SyncPlay>;
}): TrackPlayRecord {
  return {
    setId: overrides.setId ?? "set-1",
    setLabel: "setLabel" in overrides ? (overrides.setLabel ?? null) : "serato4:975",
    setStartedAt: "2026-06-01T21:00:00.000Z",
    setDerived: derived(
      1.0,
      overrides.trackCount ?? 40,
      "timezone" in overrides ? (overrides.timezone ?? null) : "America/Los_Angeles",
    ),
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
      <TrackDetail plays={[record({})]} roster={ROSTER} neighbourRows={[]} djTimezone={null} />,
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
        djTimezone={null}
      />,
    );
    // BPM, key, genre and add date — four Unknowns, none of them omitted.
    expect(html.match(/Unknown/g)?.length).toBe(4);
  });

  it("treats a whitespace-only title as absent rather than rendering a blank heading", () => {
    const html = renderToStaticMarkup(
      <TrackDetail plays={[record({ play: { title: "   ", artist: "" } })]} roster={null} neighbourRows={[]} djTimezone={null} />,
    );
    expect(html).toContain(">Unknown</h1>");
  });

  it("renders a genre with no subgenre without inventing the arrow", () => {
    const html = renderToStaticMarkup(
      <TrackDetail
        plays={[record({ play: { genre: { raw: "Techno", normalized: "techno", taxonomy_version: 1 } } })]}
        roster={ROSTER}
        neighbourRows={[]}
        djTimezone={null}
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
        djTimezone={null}
      />,
    );
    expect(html).toContain('href="/set/872d5614-9894-5803-80f5-aa1dd4177944"');
    expect(html).toContain("SET 975");
  });

  // NEGATIVE CONTROL for the label fallback.
  it("renders an unlabelled set as Untitled set rather than as a uuid", () => {
    const html = renderToStaticMarkup(
      <TrackDetail plays={[record({ setLabel: null })]} roster={ROSTER} neighbourRows={[]} djTimezone={null} />,
    );
    expect(html).toContain("Untitled set");
  });
});

describe("ride time reaches the DOM (AC-9/AC-11)", () => {
  it("renders the duration at minute-and-second scale", () => {
    const html = renderToStaticMarkup(
      <TrackDetail plays={[record({}), record({ setId: "set-2" })]} roster={ROSTER} neighbourRows={[]} djTimezone={null} />,
    );
    expect(html).toContain("3m 42s");
  });

  // AC-11's n=1 form, and the word this story must not ship at n=1.
  it("never says 'typically' on a single play", () => {
    const html = renderToStaticMarkup(
      <TrackDetail plays={[record({})]} roster={ROSTER} neighbourRows={[]} djTimezone={null} />,
    );
    expect(html).toContain("on its one play");
    expect(html).not.toContain("typical");
  });

  // NEGATIVE CONTROL — the Story 4.7 R-2 shape: the disclosure must survive the
  // case where EVERY play is missing a duration.
  it("discloses the excluded count when no play carried a duration", () => {
    const html = renderToStaticMarkup(
      <TrackDetail plays={[record({ play: { played_ms: null } })]} roster={ROSTER} neighbourRows={[]} djTimezone={null} />,
    );
    expect(html).toContain("1 play carries no duration");
    // Scoped to the ride-time module, not the whole document (Story 7.7): the
    // clock strip now renders server-side, and its per-hour hover tips
    // legitimately read "6pm · 0 plays" for every empty hour. A page-wide
    // string check would fail on that unrelated text while proving nothing
    // about the assertion's real subject — that RIDE TIME must disclose the
    // exclusion rather than fabricate a zero.
    const rideTime = html.slice(html.indexOf("Ride time"));
    expect(rideTime).not.toContain("0 plays");
  });
});

describe("mix neighbours reach the DOM (AC-10, D-26)", () => {
  it("renders both sides, linking only the neighbour that has an identity", () => {
    const html = renderToStaticMarkup(
      <TrackDetail
        plays={[record({})]}
        roster={ROSTER}
        neighbourRows={NEIGHBOURS}
        djTimezone={null}
      />,
    );
    expect(html).toContain("Came Before");
    expect(html).toContain("Came After");
    expect(html).toContain('href="/track/id-before"');
    // NEGATIVE CONTROL: the unlinkable neighbour is present and is NOT a link.
    expect(html).not.toContain("/track/id-after");
  });

  it("uses no ranking vocabulary anywhere in the rendered page", () => {
    const html = renderToStaticMarkup(
      <TrackDetail
        plays={[record({})]}
        roster={ROSTER}
        neighbourRows={NEIGHBOURS}
        djTimezone={null}
      />,
    );
    expect(html.toLowerCase()).not.toMatch(/\b(best|winner|ranked|#1)\b/);
  });
});

describe("the clock strip buckets server-side, in the SET's zone (Story 7.7)", () => {
  // The guarantee, inverted. This suite used to assert that a server render
  // emitted "Reading your clock" and not a single hour label, because there was
  // no zone in the system and a server-rendered hour could only have been the
  // SERVER's. A set now carries the zone it was captured in, so the hour is
  // computed here, on the server, and the placeholder is gone.
  //
  // If this ever regresses to a placeholder, the aggregation has been pushed
  // back to the client and the histogram's answer once again depends on who is
  // looking at it.
  it("renders real hours rather than a pre-hydration placeholder", () => {
    const html = renderToStaticMarkup(
      <TrackDetail plays={[record({})]} roster={ROSTER} neighbourRows={[]} djTimezone={null} />,
    );
    expect(html).not.toContain("Reading your clock");
    expect(html).toMatch(/\b\d{1,2}(am|pm)\b/);
  });

  // THE test for this story. One instant, two set zones, two different hours —
  // which is the only assertion that distinguishes a correct implementation
  // from the bug, since the suite is TZ-pinned to UTC (`vitest.config.ts:18`)
  // and a process-zone implementation would look perfectly green on any single
  // fixture. 22:00Z is 3pm in Los Angeles and 7am the next day in Tokyo.
  it("buckets the same play into a different hour under a different set zone", () => {
    const la = renderToStaticMarkup(
      <TrackDetail
        plays={[record({ timezone: "America/Los_Angeles" })]}
        roster={ROSTER}
        neighbourRows={[]}
        djTimezone={null}
      />,
    );
    const tokyo = renderToStaticMarkup(
      <TrackDetail
        plays={[record({ timezone: "Asia/Tokyo" })]}
        roster={ROSTER}
        neighbourRows={[]}
        djTimezone={null}
      />,
    );

    expect(la).toContain("landed in the 3pm hour");
    expect(tokyo).toContain("landed in the 7am hour");
    expect(la).not.toEqual(tokyo);
  });

  // The fallback chain, end to end through the component: a set from a pre-7.7
  // agent carries no zone, so `djs.timezone` decides. It must still render —
  // AD-3 makes a zone-less payload permanently valid, so this is not a
  // transitional case that eventually stops happening.
  it("falls back to the DJ's zone for a set captured before this story", () => {
    const html = renderToStaticMarkup(
      <TrackDetail
        plays={[record({ timezone: null })]}
        roster={ROSTER}
        neighbourRows={[]}
        djTimezone="Asia/Tokyo"
      />,
    );
    expect(html).toContain("landed in the 7am hour");
  });

  it("falls back to UTC when neither the set nor the DJ has a zone", () => {
    const html = renderToStaticMarkup(
      <TrackDetail
        plays={[record({ timezone: null })]}
        roster={ROSTER}
        neighbourRows={[]}
        djTimezone={null}
      />,
    );
    expect(html).toContain("landed in the 10pm hour");
  });
});

describe("day labels render server-side, in the DJ's own zone (Story 7.7)", () => {
  // Same inversion as the clock strip, at day granularity. `ClientDayDate` used
  // to emit "–" on the server and fill in after hydration; it now renders the
  // real day, because there is finally a zone that makes a server-rendered day
  // meaningful.
  it("renders the add date rather than a placeholder", () => {
    const html = renderToStaticMarkup(
      <TrackDetail plays={[]} roster={ROSTER} neighbourRows={[]} djTimezone="America/Los_Angeles" />,
    );
    expect(html).toMatch(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s/);
  });

  it("renders first/last played and per-set dates", () => {
    const html = renderToStaticMarkup(
      <TrackDetail
        plays={[record({})]}
        roster={ROSTER}
        neighbourRows={[]}
        djTimezone="America/Los_Angeles"
      />,
    );
    expect(html).toContain("First played");
    expect(html).toMatch(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s/);
  });

  // The per-set row uses the SET's zone, not the page's — the case a touring
  // DJ makes real. The play is at 22:00Z on 2026-06-01, so the set date is
  // Jun 1 in Los Angeles and Jun 2 in Tokyo.
  it("dates a per-set row in that set's own zone", () => {
    const tokyo = renderToStaticMarkup(
      <TrackDetail
        plays={[record({ timezone: "Asia/Tokyo" })]}
        roster={ROSTER}
        neighbourRows={[]}
        djTimezone="America/Los_Angeles"
      />,
    );
    // 21:00Z on Jun 1 is 06:00 on Jun 2 in Tokyo.
    expect(tokyo).toContain("Tue, Jun 2");
  });
});

/* ── Restored by the Story 7.7 code review (2026-08-17) ──────────────────────
   These two blocks were removed alongside the D-32 placeholder assertions when
   this file was rewritten for Story 7.7. They assert nothing about zones or
   about server-vs-client rendering — they are Story 4.10's cold-start (D-38)
   and reveal (D-34) guarantees, and this is the only file in `web/` that
   renders `TrackDetail`, so deleting them left that behaviour with no
   component-level coverage anywhere. Restored verbatim apart from the
   `djTimezone` prop the component now requires. */

describe("the cold start is a designed state, not four empty modules (D-38)", () => {
  it("renders identity, the add date and one honest line for an owned, unplayed track", () => {
    const html = renderToStaticMarkup(
      <TrackDetail plays={[]} roster={ROSTER} neighbourRows={[]} djTimezone={null} />,
    );
    expect(html).toContain("Deep End");
    expect(html).toContain("In your library, not played yet");
    // NEGATIVE CONTROL: none of the four play-side modules render at all.
    expect(html).not.toContain("Play history");
    expect(html).not.toContain("Ride time");
    expect(html).not.toContain("Mix neighbours");
  });

  it("says so when a played track is no longer in the library sync", () => {
    const html = renderToStaticMarkup(
      <TrackDetail plays={[record({})]} roster={null} neighbourRows={[]} djTimezone={null} />,
    );
    expect(html).toContain("not in your current library sync");
  });

  // NEGATIVE CONTROL for the line above.
  it("stays silent about the roster when the track is in it", () => {
    const html = renderToStaticMarkup(
      <TrackDetail plays={[record({})]} roster={ROSTER} neighbourRows={[]} djTimezone={null} />,
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
        djTimezone={null}
      />,
    );
    expect(html).toContain("short or low-confidence");
    // One play surviving, not two — the soundcheck is excluded by default.
    expect(html).toContain("Played 1 time across 1 set");
  });

  // NEGATIVE CONTROL: no control at all when the predicate hides nothing.
  it("renders no reveal control when every set clears the predicate", () => {
    const html = renderToStaticMarkup(
      <TrackDetail plays={[record({})]} roster={ROSTER} neighbourRows={[]} djTimezone={null} />,
    );
    expect(html).not.toContain("short or low-confidence");
  });
});
