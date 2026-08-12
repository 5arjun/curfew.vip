"use client";

import type { DancefloorSegment } from "@/lib/sets/dancefloor";

// Which dancefloor the stats/arc/tracklist are SCOPED to (Story 5.4, AC #2).
//
// Deliberately a NEW, independent selector rather than an extension of
// `SegmentSelector.tsx`'s editing-target chips (`editor.activeId`) — model.ts's
// own doc comment on `ScopeFrame.activeSegmentId` names the split: recomputing
// stats against the segment being edited would make every arrow press rewrite
// the whole right column. This selector is plain click-to-select, always
// populated (never `null` once a segment exists), and has zero edit-mode side
// effects — a DJ can view floor 1's stats while editing floor 2's boundary.
//
// Chip order/labels mirror `SegmentSelector`'s ("Dancefloor N" off
// `dancefloorSegments`' ranking) so the two controls can never disagree about
// which floor is "Dancefloor 1" — and so the two chip lists read as clearly
// related once both are on screen, ahead of the later UI-consolidation call
// this story's Dev Notes leave open.

export function SegmentViewSelector({
  segments,
  selectedId,
  onSelect,
}: {
  /** Every dancefloor segment on this set, ranked (`dancefloorSegments`). */
  segments: DancefloorSegment[];
  /** The segment currently scoping the stats/arc/tracklist. */
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // AC #1/#3: a 0/1-segment set shows no picker — this story adds no UI
  // clutter for the overwhelmingly common case.
  if (segments.length <= 1) return null;

  return (
    <div className="sd-view-segment-selector" role="group" aria-label="Viewing dancefloor">
      <ul className="sd-segment-chips">
        {segments.map((segment, index) => {
          const selected = segment.id === selectedId;
          return (
            <li key={segment.id}>
              <button
                type="button"
                className="sd-segment-chip"
                data-selected={selected || undefined}
                aria-pressed={selected}
                onClick={() => onSelect(segment.id)}
              >
                Dancefloor {index + 1}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
