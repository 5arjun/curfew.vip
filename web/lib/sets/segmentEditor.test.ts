// Story 5.3 — the editor's position arithmetic (D-34/D-36/D-37).
//
// Every one of the editor's three input paths (tap a row, drag a handle, arrow
// a focused boundary) reduces to `setDraftEdge` or `nudgeDraftEdge`, so the
// rules live here once rather than three times in three components. These cases
// are what let D-37's "tap now, drag later" build order be additive: the drag
// pass adds a gesture, not a second copy of these rules.
import { describe, expect, it } from "vitest";
import {
  boundaryKeyAction,
  boundaryValueText,
  draftContains,
  draftFromSegment,
  draftIsDirty,
  nudgeDraftEdge,
  playIdAtPosition,
  positionBounds,
  segmentPositions,
  segmentVisualState,
  setDraftEdge,
  type SegmentDraft,
} from "./segmentEditor";
import type { DancefloorSegment } from "./dancefloor";
import type { SetPlay } from "./types";

const plays = [
  { position: 1, id: "p1" },
  { position: 2, id: "p2" },
  { position: 3, id: "p3" },
  { position: 4, id: "p4" },
  { position: 5, id: "p5" },
] as unknown as SetPlay[];

const BOUNDS = { min: 1, max: 5 };

const segment: DancefloorSegment = {
  id: "seg-1",
  firstPlayId: "p2",
  lastPlayId: "p4",
  confirmed: false,
  start: "2026-08-05T00:00:00.000Z",
  end: "2026-08-05T01:00:00.000Z",
};

const draft = (firstPosition: number, lastPosition: number): SegmentDraft => ({
  segmentId: "seg-1",
  firstPosition,
  lastPosition,
});

describe("positionBounds", () => {
  it("returns the set's own first and last position", () => {
    expect(positionBounds(plays)).toEqual({ min: 1, max: 5 });
  });

  it("does not assume the list is sorted", () => {
    // `set.plays` IS sorted by the read seam, but this module is handed a list
    // by three different callers and a min/max that quietly depended on order
    // would fail in exactly one of them.
    const shuffled = [{ position: 4 }, { position: 1 }, { position: 9 }] as unknown as SetPlay[];
    expect(positionBounds(shuffled)).toEqual({ min: 1, max: 9 });
  });

  it("returns null for a set with no plays — there is no timeline to edit on", () => {
    expect(positionBounds([])).toBeNull();
  });
});

describe("segmentPositions", () => {
  it("locates both boundaries on the timeline", () => {
    expect(segmentPositions(segment, plays)).toEqual({ firstPosition: 2, lastPosition: 4 });
  });

  it("returns null when a boundary play is not in the list", () => {
    // Reachable, not theoretical: the read seam drops a segment whose boundary
    // play RLS filtered out. A segment that cannot be located on the timeline
    // cannot be drawn on it, and inventing a position would be guessing (AD-11).
    const orphan = { ...segment, lastPlayId: "p-missing" };
    expect(segmentPositions(orphan, plays)).toBeNull();
  });

  it("ignores plays carrying no cloud id rather than matching them", () => {
    const idless = [{ position: 1 }, { position: 2, id: "p2" }] as unknown as SetPlay[];
    expect(segmentPositions({ ...segment, firstPlayId: "p2", lastPlayId: "p2" }, idless)).toEqual({
      firstPosition: 2,
      lastPosition: 2,
    });
  });
});

describe("draftFromSegment", () => {
  it("carries the segment's id, so a commit knows to UPDATE rather than INSERT", () => {
    expect(draftFromSegment(segment, plays)).toEqual({
      segmentId: "seg-1",
      firstPosition: 2,
      lastPosition: 4,
    });
  });

  it("is null when the segment cannot be placed on the timeline", () => {
    expect(draftFromSegment({ ...segment, firstPlayId: "gone" }, plays)).toBeNull();
  });
});

describe("setDraftEdge — the tap and drag path (D-37)", () => {
  it("moves the tapped edge", () => {
    expect(setDraftEdge(draft(2, 4), "first", 1, BOUNDS)).toEqual(draft(1, 4));
    expect(setDraftEdge(draft(2, 4), "last", 5, BOUNDS)).toEqual(draft(2, 5));
  });

  it("clamps to the set's own timeline", () => {
    expect(setDraftEdge(draft(2, 4), "first", -10, BOUNDS)).toEqual(draft(1, 4));
    expect(setDraftEdge(draft(2, 4), "last", 99, BOUNDS)).toEqual(draft(2, 5));
  });

  it("DRAGS the far edge along rather than ignoring a tap past it", () => {
    // A DJ who taps a row has said something unambiguous. Refusing the tap
    // because it crossed the other boundary would leave them tapping again with
    // no feedback about why nothing moved.
    expect(setDraftEdge(draft(2, 4), "first", 5, BOUNDS)).toEqual(draft(5, 5));
    expect(setDraftEdge(draft(2, 4), "last", 1, BOUNDS)).toEqual(draft(1, 1));
  });

  it("never produces a reversed draft, whatever it is handed", () => {
    for (const position of [-5, 0, 1, 3, 5, 50]) {
      for (const edge of ["first", "last"] as const) {
        const next = setDraftEdge(draft(2, 4), edge, position, BOUNDS);
        expect(next.firstPosition).toBeLessThanOrEqual(next.lastPosition);
      }
    }
  });
});

describe("nudgeDraftEdge — the arrow-key path (AC #2, D-36)", () => {
  it("moves one track at a time", () => {
    expect(nudgeDraftEdge(draft(2, 4), "first", -1, BOUNDS)).toEqual(draft(1, 4));
    expect(nudgeDraftEdge(draft(2, 4), "last", 1, BOUNDS)).toEqual(draft(2, 5));
  });

  it("stops at the set's edge instead of running off it", () => {
    expect(nudgeDraftEdge(draft(1, 4), "first", -1, BOUNDS)).toEqual(draft(1, 4));
    expect(nudgeDraftEdge(draft(2, 5), "last", 1, BOUNDS)).toEqual(draft(2, 5));
  });

  it("stops at the OTHER boundary rather than pushing it, unlike a tap", () => {
    // The deliberate difference from `setDraftEdge`. An arrow press is small and
    // repeated; having the far boundary start following along once the near one
    // reaches it is a surprise nobody asked for.
    expect(nudgeDraftEdge(draft(4, 4), "first", 1, BOUNDS)).toEqual(draft(4, 4));
    expect(nudgeDraftEdge(draft(2, 2), "last", -1, BOUNDS)).toEqual(draft(2, 2));
  });

  it("reaches and holds a single-track segment", () => {
    // first === last is a legal shape the D-29 trigger explicitly admits, and
    // the one D-27's clamp collapses to when a re-sync shrinks a set.
    const collapsed = nudgeDraftEdge(nudgeDraftEdge(draft(2, 4), "last", -1, BOUNDS), "last", -1, BOUNDS);
    expect(collapsed).toEqual(draft(2, 2));
    expect(nudgeDraftEdge(collapsed, "last", -1, BOUNDS)).toEqual(draft(2, 2));
  });
});

// AC #2, asserted directly: "Tab reaches a boundary, arrows nudge, Enter
// confirms — a full keyboard path." Tab reachability is a property of the
// rendered `<button role="slider">` and is asserted in the prop-threading
// suite; the two halves that are pure logic are asserted here.
describe("boundaryKeyAction — the keyboard path (AC #2, D-36)", () => {
  it("nudges one track earlier on Up AND Left", () => {
    expect(boundaryKeyAction("ArrowUp", 3, BOUNDS)).toEqual({ kind: "nudge", delta: -1 });
    expect(boundaryKeyAction("ArrowLeft", 3, BOUNDS)).toEqual({ kind: "nudge", delta: -1 });
  });

  it("nudges one track later on Down AND Right", () => {
    // Both pairs, deliberately: the list is vertical but slider muscle memory
    // is horizontal, and supporting only one would feel broken to half of users.
    expect(boundaryKeyAction("ArrowDown", 3, BOUNDS)).toEqual({ kind: "nudge", delta: 1 });
    expect(boundaryKeyAction("ArrowRight", 3, BOUNDS)).toEqual({ kind: "nudge", delta: 1 });
  });

  it("jumps to the ends of the set on Home and End", () => {
    expect(boundaryKeyAction("Home", 3, BOUNDS)).toEqual({ kind: "nudge", delta: -2 });
    expect(boundaryKeyAction("End", 3, BOUNDS)).toEqual({ kind: "nudge", delta: 2 });
  });

  it("commits on Enter — AC #2's verbatim 'Enter confirms'", () => {
    expect(boundaryKeyAction("Enter", 3, BOUNDS)).toEqual({ kind: "commit" });
  });

  it("ignores every other key, so the handle never swallows Tab or Escape", () => {
    // Returning null is what lets the component skip `preventDefault` — a
    // handle that ate Tab would trap keyboard focus on the boundary it exists
    // to make reachable.
    for (const key of ["Tab", "Escape", " ", "a", "PageDown", "Shift"]) {
      expect(boundaryKeyAction(key, 3, BOUNDS)).toBeNull();
    }
  });
});

describe("draftContains", () => {
  it("brackets the rows that get the rail, inclusive at both ends", () => {
    expect(draftContains(draft(2, 4), 1)).toBe(false);
    expect(draftContains(draft(2, 4), 2)).toBe(true);
    expect(draftContains(draft(2, 4), 3)).toBe(true);
    expect(draftContains(draft(2, 4), 4)).toBe(true);
    expect(draftContains(draft(2, 4), 5)).toBe(false);
  });
});

describe("draftIsDirty", () => {
  it("is false when nothing moved, so a no-op commit writes nothing", () => {
    expect(draftIsDirty(draft(2, 4), { firstPosition: 2, lastPosition: 4 })).toBe(false);
  });

  it("is true when either boundary moved", () => {
    expect(draftIsDirty(draft(1, 4), { firstPosition: 2, lastPosition: 4 })).toBe(true);
    expect(draftIsDirty(draft(2, 5), { firstPosition: 2, lastPosition: 4 })).toBe(true);
  });

  it("is true for a segment that does not exist yet — there is nothing it could match", () => {
    expect(draftIsDirty(draft(2, 4), null)).toBe(true);
  });
});

// Regression: the handle said "Untitled track" while the live region said "an
// untitled track", so a non-sighted DJ heard two different names for the same
// track depending on whether they focused it or arrowed onto it. Caught in the
// browser pass; one shared builder is what makes that unrepresentable.
describe("boundaryValueText (D-36)", () => {
  const play = { title: "Peak Time" };

  it("names the track and the clock, not just a position", () => {
    expect(boundaryValueText("first", play, "10:20 PM")).toBe(
      "Dancefloor starts at Peak Time, 10:20 PM",
    );
    expect(boundaryValueText("last", play, "10:20 PM")).toBe(
      "Dancefloor ends at Peak Time, 10:20 PM",
    );
  });

  it("adds 'now' only for the change tense the live region uses", () => {
    expect(boundaryValueText("first", play, "10:20 PM", "change")).toBe(
      "Dancefloor now starts at Peak Time, 10:20 PM",
    );
  });

  it("uses ONE untitled-track wording across both tenses", () => {
    const state = boundaryValueText("last", { title: null }, "10:20 PM");
    const change = boundaryValueText("last", { title: null }, "10:20 PM", "change");
    expect(state).toContain("an untitled track");
    // The only difference between the two is the tense word.
    expect(change).toBe(state.replace("ends", "now ends"));
  });

  it("omits the comma when a play has no clock at all", () => {
    expect(boundaryValueText("first", play, "")).toBe("Dancefloor starts at Peak Time");
  });

  it("survives a play that is missing entirely", () => {
    expect(boundaryValueText("first", undefined, "")).toBe("Dancefloor starts at an untitled track");
  });
});

describe("playIdAtPosition", () => {
  it("translates the position the DJ pointed at into the uuid the write path needs", () => {
    expect(playIdAtPosition(plays, 2)).toBe("p2");
  });

  it("returns null for a play carrying no cloud id — a boundary genuinely cannot go there", () => {
    // Fixture-backed plays have no database row behind them, so this is the
    // literal truth rather than a degraded state.
    const idless = [{ position: 1 }] as unknown as SetPlay[];
    expect(playIdAtPosition(idless, 1)).toBeNull();
  });

  it("returns null for a position that is not in the set", () => {
    expect(playIdAtPosition(plays, 99)).toBeNull();
  });
});

describe("segmentVisualState (D-35)", () => {
  it("reads unconfirmed as the algorithm's open proposal", () => {
    expect(segmentVisualState({ confirmed: false })).toBe("suggested");
  });

  it("reads a confirmed suggestion and a manual boundary IDENTICALLY", () => {
    // Deliberate, per D-35: `source` still separates them in the database
    // (D-18's provenance rule) but the DJ experiences both as settled, and
    // drawing a visual difference would surface a distinction that exists for a
    // future active-learning loop rather than for them.
    expect(segmentVisualState({ confirmed: true })).toBe("confirmed");
  });
});
