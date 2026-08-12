import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SegmentBoundaryHandle } from "./SegmentBoundaryHandle";
import { SegmentSelector } from "./SegmentSelector";
import { Tracklist } from "./Tracklist";
import type { SegmentEditor } from "./useSegmentEditor";
import type { ScopeFrame } from "./model";
import type { DancefloorSegment } from "@/lib/sets/dancefloor";
import { formatClock } from "@/lib/sets/format";
import { segmentPositions } from "@/lib/sets/segmentEditor";
import type { SetPlay, SetRecord, SyncSetDerived } from "@/lib/sets/types";

/**
 * RENDER ASSERTIONS for the segment editor (Story 5.3, Tasks 5.6/6.3/7.5/8.3).
 *
 * Same scope and house rules as `components/track-detail/prop-threading.test.tsx`
 * and `components/library-utilization/prop-threading.test.tsx`: string
 * assertions over rendered markup, **no React Testing Library and no jsdom**.
 *
 * The story asked for React Testing Library specifically. This repository has
 * neither RTL nor a DOM environment, by an explicitly documented choice in both
 * files above, and adding them is a dependency decision rather than a dev-time
 * one — so the coverage is split along the seam this codebase already uses
 * instead: what reaches the DOM is asserted here, and the behaviour behind it
 * (every position rule, and the full keyboard mapping AC #2 names) is asserted
 * as pure functions in `lib/sets/segmentEditor.test.ts`, with the write
 * payloads in `lib/sets/segmentWrites.test.ts`. Every threaded prop below gets
 * a negative control, so an assertion cannot pass by rendering nothing.
 */

function derived(): SyncSetDerived {
  return {
    most_played_tracks: [],
    most_played_artists: [],
    genre_breakdown: { buckets: [], no_genre_count: 0 },
    bpm_distribution: { count: 0, min: 0, max: 0, mean: 0, median: 0 },
    camelot_mixing_stats: { compatible_transitions: 0, incompatible_transitions: 0, excluded_no_key: 0 },
    set_length_sec: 3600,
    track_count: 5,
    energy_arc: [],
    confidence: { value: 1, track_count: 5, long_gap_count: 0 },
  } as unknown as SyncSetDerived;
}

const TITLES = ["Opener", "Second", "Peak Time", "Fourth", "Closer"];

const plays: SetPlay[] = TITLES.map((title, i) => ({
  id: `p${i + 1}`,
  position: i + 1,
  title,
  artist: "Artist",
  started_at: new Date(Date.UTC(2026, 7, 5, 22, i * 10)).toISOString(),
  bpm: 128,
  genre: null,
  camelot_key: null,
  in_library: true,
})) as unknown as SetPlay[];

function segment(overrides: Partial<DancefloorSegment> = {}): DancefloorSegment {
  return {
    id: "seg-1",
    firstPlayId: "p2",
    lastPlayId: "p4",
    confirmed: true,
    start: plays[1].started_at!,
    end: plays[3].started_at!,
    ...overrides,
  };
}

function set(segments: DancefloorSegment[]): SetRecord {
  return {
    external_id: "set-1",
    started_at: plays[0].started_at,
    ended_at: plays[4].started_at,
    plays,
    segments,
    derived: derived(),
  } as unknown as SetRecord;
}

/** A stand-in editor: this suite asserts what renders, never what a click does. */
function editorFor(
  segments: DancefloorSegment[],
  overrides: Partial<SegmentEditor> = {},
): SegmentEditor {
  const noop = () => undefined;
  return {
    segments,
    activeId: null,
    draft: null,
    isNew: false,
    isEditing: false,
    adding: false,
    beginAdd: noop,
    placing: null,
    draggingSegmentId: null,
    draggingEdge: null,
    justNudgedEdge: null,
    pending: false,
    error: null,
    announcement: "",
    dirty: false,
    selectSegment: noop,
    startPlacing: noop,
    tapRow: noop,
    setEdge: noop,
    setDragging: noop,
    nudge: noop,
    startManualAt: noop,
    commit: noop,
    cancel: noop,
    removeActive: noop,
    positionsFor: (s) => segmentPositions(s, plays),
    ...overrides,
  };
}

function frameFor(): ScopeFrame {
  return {
    scope: "whole",
    segment: null,
    activeSegmentId: null,
    editingBounds: null,
    plays,
    peakPosition: null,
  };
}

function renderTracklist(editor: SegmentEditor, editable = true): string {
  return renderToStaticMarkup(
    <Tracklist
      set={set(editor.segments)}
      frame={frameFor()}
      focus={null}
      onDismissFocus={() => undefined}
      newTrackRows={new Set()}
      visibleRows={50}
      onLoadMore={() => undefined}
      editor={editor}
      editable={editable}
      viewSelectedId={editor.segments[0]?.id ?? null}
      onSelectView={() => undefined}
    />,
  );
}

/**
 * The merged dancefloor strip (2026-08-12). `viewSelectedId` defaults to the
 * ranked head, which is what `resolveViewSegment` hands it on a real page when
 * the DJ has not picked a floor yet.
 */
function renderSelector(
  editor: SegmentEditor,
  { editable = true, viewSelectedId = editor.segments[0]?.id ?? null } = {},
): string {
  return renderToStaticMarkup(
    <SegmentSelector
      editor={editor}
      editable={editable}
      viewSelectedId={viewSelectedId}
      onSelectView={() => undefined}
    />,
  );
}

describe("boundary handles reach the DOM (Task 5.1, D-34)", () => {
  it("renders one slider per boundary, and only at the bracketed rows", () => {
    const html = renderTracklist(editorFor([segment()]));
    expect(html.match(/role="slider"/g)).toHaveLength(2);
    // The segment spans positions 2..4, so exactly those two ends carry a
    // handle — a handle at position 1 or 5 would be pointing at the wrong track.
    expect(html).toContain("Dancefloor starts at Second");
    expect(html).toContain("Dancefloor ends at Fourth");
    expect(html).not.toContain("Dancefloor starts at Opener");
    expect(html).not.toContain("Dancefloor ends at Closer");
  });

  it("renders NO handle for a set with no segments — the negative control", () => {
    const html = renderTracklist(editorFor([]));
    expect(html).not.toContain('role="slider"');
  });

  it("renders no handle for a segment whose boundary play is not in the list", () => {
    // The read seam drops a segment whose boundary play RLS filtered out; a
    // segment that cannot be located on the timeline must not be drawn on it.
    const html = renderTracklist(editorFor([segment({ lastPlayId: "gone" })]));
    expect(html).not.toContain('role="slider"');
  });

  it("brackets exactly the rows inside the segment with the rail", () => {
    const html = renderTracklist(editorFor([segment()]));
    const railed = html.match(/data-in-segment="[a-z]+"/g) ?? [];
    expect(railed).toHaveLength(3); // positions 2, 3 and 4
  });
});

describe("suggested vs confirmed visual state (Task 5.3, D-35)", () => {
  it("marks an unconfirmed suggestion as suggested", () => {
    const html = renderTracklist(editorFor([segment({ confirmed: false })]));
    expect(html).toContain('data-state="suggested"');
    expect(html).not.toContain('data-state="confirmed"');
  });

  it("marks a confirmed segment as confirmed", () => {
    const html = renderTracklist(editorFor([segment({ confirmed: true })]));
    expect(html).toContain('data-state="confirmed"');
    expect(html).not.toContain('data-state="suggested"');
  });
});

describe('the "+" gutter affordance (Task 5.2, AC #1)', () => {
  it("shows NO + until the DJ has asked to add one", () => {
    // Arjun, 2026-08-11: a "+" sitting in every row gap at rest is something to
    // click by accident. It appears only after "+ New" arms `adding`.
    const html = renderTracklist(editorFor([segment()]));
    expect(html).not.toContain("sd-add-boundary-button");
  });

  it("offers a + at every row outside any segment once adding, and none inside one", () => {
    const html = renderTracklist(editorFor([segment()], { adding: true, isEditing: true }));
    // Positions 1 and 5 are outside the 2..4 floor. Inside it there is nothing
    // to add that would not immediately overlap — which the D-29 trigger would
    // reject anyway, so offering it would be offering a guaranteed failure.
    expect(html.match(/sd-add-boundary-button/g)).toHaveLength(2);
    expect(html).toContain("Mark a dancefloor starting at Opener");
    expect(html).toContain("Mark a dancefloor starting at Closer");
    expect(html).not.toContain("Mark a dancefloor starting at Peak Time");
  });

  it("offers no + at all when the set cannot be edited", () => {
    // Fixture-backed plays have no cloud row for a boundary to point at, so
    // this is an honest absence rather than a disabled feature.
    const html = renderTracklist(editorFor([segment()], { adding: true, isEditing: true }), false);
    expect(html).not.toContain("sd-add-boundary-button");
  });
});

describe("edit mode (Arjun's 2026-08-11 polish pass)", () => {
  it("dims the tracks outside the floor being edited, and only while editing", () => {
    const idle = renderTracklist(editorFor([segment()]));
    expect(idle).not.toContain("data-outside-segment");

    const editing = renderTracklist(
      editorFor([segment()], { isEditing: true, activeId: "seg-1" }),
    );
    // Positions 1 and 5 sit outside the 2..4 floor; 2, 3 and 4 do not.
    expect(editing.match(/data-outside-segment="true"/g)).toHaveLength(2);
  });

  it("marks the tracklist so the dimming has something to key off", () => {
    expect(renderTracklist(editorFor([segment()], { isEditing: true }))).toContain(
      'data-editing="true"',
    );
  });

  it("dims NOTHING between '+ New' and the first boundary tap", () => {
    // There is no extent to be outside of yet, and greying the whole night
    // would grey out the very rows the DJ is being asked to pick from.
    const html = renderTracklist(editorFor([segment()], { isEditing: true, adding: true }));
    expect(html).not.toContain("data-outside-segment");
  });

  it("dims outside a half-drawn manual segment once its first boundary lands", () => {
    const html = renderTracklist(
      editorFor([], {
        isEditing: true,
        isNew: true,
        draft: { segmentId: null, firstPosition: 3, lastPosition: 3 },
      }),
    );
    // Only position 3 is inside; the other four rows recede.
    expect(html.match(/data-outside-segment="true"/g)).toHaveLength(4);
  });

  it("pins the action bar only while editing", () => {
    const idle = renderSelector(editorFor([segment()]));
    // At rest neither the strip nor any chip is in an edit state, so the
    // attribute the sticky rule (and the chip's second ring) key off is absent
    // from the whole render — not merely absent from one element.
    expect(idle).not.toContain("data-editing");
    expect(idle).not.toContain("Confirm");
    // And it offers the way in, now that the gutter "+" is edit-mode only.
    expect(idle).toContain("+ New");

    const editing = renderSelector(editorFor([segment()], { isEditing: true, activeId: "seg-1" }));
    expect(editing).toContain('data-editing="true"');
    expect(editing).toContain("Confirm");
    // "+ New" retires while an edit is in flight — two ways to start something
    // at once is how a DJ loses the edit they were part-way through.
    expect(editing).not.toContain("+ New");
  });

  it("swaps the chip label to Edit on hover, without saying it twice to a screen reader", () => {
    const html = renderSelector(editorFor([segment()]));
    expect(html).toContain("sd-segment-chip-edit");
    expect(html).toContain(">Edit<");
    // The hover face is decorative: the button's accessible name stays the
    // segment's own, not "Dancefloor 1Edit".
    expect(html).toMatch(/aria-hidden="true"[^>]*>Edit</);
  });
});

/**
 * The merged strip (Arjun, 2026-08-12) — one chip per floor carrying BOTH the
 * view scope Story 5.4 shipped as a second parallel chip list and the edit
 * target Story 5.3 shipped here. The click contract is two steps on one chip,
 * so what has to be asserted is that the chip always SAYS which step it is on:
 * a chip whose click will only rescope the page must not promise an edit.
 */
describe("one chip per dancefloor, two steps (2026-08-12 consolidation)", () => {
  const second = segment({ id: "seg-2", firstPlayId: "p5", lastPlayId: "p5" });

  it("renders exactly one chip per floor — never two strips of the same names", () => {
    const html = renderSelector(editorFor([segment(), second]));
    expect(html.match(/Dancefloor 1/g)).toHaveLength(1);
    expect(html.match(/Dancefloor 2/g)).toHaveLength(1);
  });

  it('offers "View" on an unviewed floor and "Edit" on the viewed one', () => {
    const html = renderSelector(editorFor([segment(), second]), { viewSelectedId: "seg-1" });
    // Step 1 on the chip you are not reading, step 2 on the one you are.
    expect(html).toContain(">View<");
    expect(html).toContain(">Edit<");
  });

  it('says "Editing" on the floor whose boundaries are live', () => {
    const html = renderSelector(
      editorFor([segment(), second], { activeId: "seg-1", isEditing: true }),
      { viewSelectedId: "seg-1" },
    );
    expect(html).toContain(">Editing<");
    expect(html).not.toContain(">Edit<");
  });

  it('never offers an edit step on a set that cannot be edited', () => {
    // Fixture-backed plays have no cloud row behind them, so the second click
    // has nothing to do — the chip says so instead of promising one.
    const html = renderSelector(editorFor([segment(), second]), { editable: false });
    expect(html).toContain(">Viewing<");
    expect(html).not.toContain(">Edit<");
  });

  it("marks the viewed floor and the edited floor as distinguishable states", () => {
    const html = renderSelector(
      editorFor([segment(), second], { activeId: "seg-1", isEditing: true }),
      { viewSelectedId: "seg-1" },
    );
    // Exactly one chip is pressed (the viewed floor) — the scoped segment is
    // never ambiguous, which is what the retired view-selector suite asserted.
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(1);
    // And editing carries its own attribute, so "read this floor" and "I am
    // rewriting this floor's boundaries" cannot render identically.
    expect(html).toMatch(/data-selected="true" data-editing="true"/);
  });
});

describe("the live draft renders, not the stored row (Task 5.1/8.1, D-34)", () => {
  it("draws handles at the DRAFT's boundaries while an edit is in flight", () => {
    const active = segment();
    const editor = editorFor([active], {
      activeId: "seg-1",
      draft: { segmentId: "seg-1", firstPosition: 1, lastPosition: 5 },
      positionsFor: (s) =>
        s.id === "seg-1" ? { firstPosition: 1, lastPosition: 5 } : segmentPositions(s, plays),
    });
    const html = renderTracklist(editor);
    // Widened to the whole night mid-edit: the handles follow the draft, and
    // the stored 2..4 boundaries are nowhere on screen.
    expect(html).toContain("Dancefloor starts at Opener");
    expect(html).toContain("Dancefloor ends at Closer");
    expect(html).not.toContain("Dancefloor starts at Second");
  });

  it("draws a manual segment that has no row yet", () => {
    // `segments` is empty — the draft is the only thing to render, and without
    // this the DJ would be placing an invisible boundary.
    const editor = editorFor([], {
      draft: { segmentId: null, firstPosition: 3, lastPosition: 3 },
      isNew: true,
    });
    const html = renderTracklist(editor);
    expect(html).toContain("Dancefloor starts at Peak Time");
    expect(html).toContain("Dancefloor ends at Peak Time");
  });
});

describe("keyboard affordances reach the DOM (Task 7.1/7.3, D-36)", () => {
  const html = renderToStaticMarkup(
    <SegmentBoundaryHandle
      segmentId="seg-1"
      edge="first"
      position={3}
      plays={plays}
      bounds={{ min: 1, max: 5 }}
      state="suggested"
      active
      placing={false}
      dragging={false}
      focusOnMount={false}
      pending={false}
      onNudge={() => undefined}
      onCommit={() => undefined}
      onStartPlacing={() => undefined}
      onDragTo={() => undefined}
      onDragStateChange={() => undefined}
    />,
  );

  it("is a real focusable widget in the Tab order — AC #2's 'Tab reaches a boundary'", () => {
    // A <button>, so it is tabbable without a tabIndex at all. Asserted because
    // the one adjacent precedent in this codebase (`SetSimilarity.tsx`) is a
    // documented tabIndex/aria-hidden trap, not a pattern to copy.
    expect(html).toContain("<button");
    expect(html).not.toContain('aria-hidden="true" role="slider"');
    expect(html).not.toContain('tabindex="-1"');
  });

  it("carries the ARIA slider contract, bounded by the set's own timeline", () => {
    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-valuemin="1"');
    expect(html).toContain('aria-valuemax="5"');
    expect(html).toContain('aria-valuenow="3"');
  });

  it("names the actual track and time in aria-valuetext, not just a number", () => {
    // D-36 is explicit that `aria-valuenow` alone is insufficient: "3" tells a
    // non-sighted DJ nothing about which track they landed on, which is the
    // entire content of the sighted experience.
    // The clock string is whatever `formatClock` produces — asserted through it
    // rather than hardcoded, so this cannot drift from what the rows display.
    expect(html).toContain(
      `aria-valuetext="Dancefloor starts at Peak Time, ${formatClock(plays[2].started_at!)}"`,
    );
  });
});

describe("the multi-segment selector (Task 6.1, D-30)", () => {
  it("renders one chip per real segment, with its track count", () => {
    const second = segment({ id: "seg-2", firstPlayId: "p5", lastPlayId: "p5" });
    const html = renderSelector(editorFor([segment(), second]));
    expect(html).toContain("Dancefloor 1");
    expect(html).toContain("Dancefloor 2");
    expect(html).toContain("3 tracks");
    expect(html).toContain("1 tracks");
  });

  it("says nothing about a second floor when there is only one", () => {
    const html = renderSelector(editorFor([segment()]));
    expect(html).toContain("Dancefloor 1");
    expect(html).not.toContain("Dancefloor 2");
  });

  it("marks which chip is selected, so an edit is never aimed ambiguously", () => {
    const second = segment({ id: "seg-2", firstPlayId: "p5", lastPlayId: "p5" });
    const html = renderSelector(editorFor([segment(), second], { activeId: "seg-2" }), {
      viewSelectedId: "seg-2",
    });
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(1);
  });

  it("announces a rejected write with its specific reason, not a shrug", () => {
    const html = renderSelector(editorFor([segment()], { error: "overlaps-another-segment" }));
    expect(html).toContain("overlap another dancefloor");
    expect(html).toContain('aria-live="polite"');
  });

  it("distinguishes the four rejection reasons from each other", () => {
    const text = (reason: Parameters<typeof editorFor>[1] extends never ? never : string) =>
      renderSelector(editorFor([segment()], { error: reason as never }));
    const messages = [
      text("overlaps-another-segment"),
      text("boundaries-reversed"),
      text("boundary-outside-set"),
      text("type-not-supported"),
    ];
    // The whole point of the trigger raising four distinct messages (D-29) is
    // that they arrive here as four distinct things to say.
    expect(new Set(messages).size).toBe(4);
  });

  it("carries the nudge announcement in a live region (Task 7.3)", () => {
    const html = renderSelector(
      editorFor([segment()], { announcement: "Dancefloor now starts at Second, 10:10pm" }),
    );
    expect(html).toContain("Dancefloor now starts at Second, 10:10pm");
  });
});
