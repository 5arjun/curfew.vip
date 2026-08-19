"use client";

import type { SegmentWriteReason } from "@/lib/sets/segmentWrites";
import type { SegmentEditor } from "./useSegmentEditor";

// The dancefloor strip — ONE chip per floor, doing both jobs (Story 5.3 D-30
// for editing, Story 5.4 AC #2 for view scope).
//
// WHY THIS EXISTS AT ALL, since a full comparison view is Story 5.4's:
// `primaryDancefloorSegment`'s longest-wins pick was a harmless rendering
// shortcut for as long as the web could only READ segments — showing one floor
// and staying quiet about a second costs a DJ nothing they could act on. The
// instant editing ships, that silence turns actively misleading: a DJ could
// adjust "the" dancefloor while a second real one sits invisible and untouched.
// A plain chip list is the floor that stops that, and deliberately not more.
//
// Chip order is `dancefloorSegments`' ranking, whose head is by construction the
// same segment `primaryDancefloorSegment` hands the card and the hero — so
// "Dancefloor 1" here and "the dancefloor" everywhere else can never disagree.
//
// MERGED FROM TWO STRIPS (Arjun, 2026-08-12 — the consolidation call Story
// 5.4's Dev Notes deliberately left open). 5.4 shipped a second, parallel chip
// list (`SegmentViewSelector`) stacked directly above this one: identical
// labels, identical shape, different meaning. On a two-floor set that read as
// four dancefloor buttons for two dancefloors, and nothing on screen said which
// row did what. One floor is one chip.
//
// The two meanings survive as two STEPS on the same chip rather than as two
// controls, which is also why the merge does not reintroduce the coupling
// model.ts's `ScopeFrame.activeSegmentId` comment warns about:
//
//   click an unviewed chip  → it becomes the viewed floor (stats/arc/tracklist
//                             rescope). No edit mode: reading a second floor's
//                             median BPM must not grow boundary handles and a
//                             Confirm bar.
//   click the viewed chip   → it becomes the edit target as well.
//   click it again          → edit mode ends; it stays the viewed floor.
//
// On the overwhelmingly common one-floor set the first step is already
// satisfied on mount (`resolveViewSegment` falls back to segments[0]), so the
// first click still opens the editor exactly as it did in 5.3.
//
// View scope keys off the segment's STORED bounds throughout; only the arc's
// mirror reads the live draft (D-34). A boundary drag therefore still cannot
// rewrite the right column on every arrow press, which was the whole reason the
// two selectors were kept apart in the first place.

/**
 * Developer-facing rejection text.
 *
 * DJ-facing copy for these four is owed to a writing-guidelines pass, exactly
 * like D-35's confirm affordance — this story's job (Task 4.2) is that the four
 * cases are DISTINGUISHABLE at all, which they now are. What ships here is
 * plain and specific rather than a fabricated voice: an unreviewed error string
 * is the worst place to guess at tone.
 */
function reasonText(reason: SegmentWriteReason): string {
  switch (reason) {
    case "overlaps-another-segment":
      return "That would overlap another dancefloor on this set.";
    case "boundaries-reversed":
      return "The start of a dancefloor has to come before its end.";
    case "boundary-outside-set":
      return "That boundary isn't a track from this set.";
    case "type-not-supported":
      return "Only dancefloor segments can be saved right now.";
    case "not-permitted":
      return "That change wasn't permitted.";
    case "invalid-state":
      return "That combination isn't allowed for this segment.";
    default:
      return "That change couldn't be saved.";
  }
}

export function SegmentSelector({
  editor,
  editable,
  viewSelectedId,
  onSelectView,
}: {
  editor: SegmentEditor;
  /**
   * `false` when the set's plays carry no cloud ids — fixture-backed data, where
   * no boundary can be written because there is no row behind any track. The
   * selector still lists what exists; it just does not offer edits it cannot
   * perform.
   */
  editable: boolean;
  /**
   * Which floor the stats/arc/tracklist are currently scoped to. Never `null`
   * once a segment exists — `resolveViewSegment` resolves an unmade pick to the
   * ranked head — so exactly one chip always carries the viewed state.
   */
  viewSelectedId: string | null;
  onSelectView: (id: string) => void;
}) {
  const { segments, activeId, isNew, isEditing, adding, pending, error } = editor;

  // Nothing to select between and nothing to add: on a set with no dancefloor
  // at all the whole strip would be a lone "+ New" with no context, so it stays
  // out of the way until there is either a floor or a reason to draw one.
  if (segments.length === 0 && !editable) return null;

  return (
    // STICKY while editing (Arjun, 2026-08-11). The tracklist is the editing
    // surface and a floor can run eighty rows, so a DJ dragging its far boundary
    // would otherwise have scrolled Confirm/Cancel/Remove off the top of the
    // screen — the controls have to stay where the work is. Only while editing:
    // pinned permanently it would just be a bar stealing height from the list.
    <div
      className="sd-segment-selector"
      role="group"
      aria-label="Dancefloors"
      data-editing={isEditing || undefined}
    >
      <ul className="sd-segment-chips">
        {segments.map((segment, index) => {
          const positions = editor.positionsFor(segment);
          const trackCount =
            positions == null ? null : positions.lastPosition - positions.firstPosition + 1;
          const viewing = segment.id === viewSelectedId;
          const editing = segment.id === activeId;
          // The two-step above, as one handler. Reading a floor never arms an
          // edit; the second click on the floor you are already reading does.
          const onClick = () => {
            if (!viewing) {
              onSelectView(segment.id);
              return;
            }
            if (!editable) return;
            editor.selectSegment(editing ? null : segment.id);
          };
          return (
            <li key={segment.id}>
              <button
                type="button"
                className="sd-segment-chip"
                data-selected={viewing || undefined}
                data-editing={editing || undefined}
                data-state={segment.confirmed ? "confirmed" : "suggested"}
                aria-pressed={viewing}
                onClick={onClick}
              >
                {/* Two stacked labels in a clipped box: the name rides up and
                    out while the verb rides in beneath it, so hovering says what
                    the chip DOES rather than only what it is. `aria-hidden` on
                    the second — a screen reader should hear one name, and the
                    button's own text is the first. The verb is the step this
                    particular chip is on, so the hover never promises an edit
                    on a chip whose click will only rescope the page. */}
                <span className="sd-segment-chip-swap">
                  <span className="sd-segment-chip-face">
                    Dancefloor {index + 1}
                    {trackCount != null && (
                      <span className="sd-segment-chip-count"> · {trackCount} tracks</span>
                    )}
                  </span>
                  <span className="sd-segment-chip-face sd-segment-chip-edit" aria-hidden="true">
                    {!viewing ? "View" : !editable ? "Viewing" : editing ? "Editing" : "Edit"}
                  </span>
                </span>
                {!segment.confirmed && <span className="sd-segment-chip-dot" aria-hidden="true" />}
                {!segment.confirmed && <span className="sr-only">, suggested, not yet confirmed</span>}
                {editing && <span className="sr-only">, editing this dancefloor</span>}
              </button>
            </li>
          );
        })}

        {/* The way in when nothing is selected — and the only way in at all on a
            set with no floors yet, now that the gutter "+" is edit-mode only. */}
        {editable && !isEditing && (
          <li>
            <button type="button" className="sd-segment-chip" onClick={editor.beginAdd}>
              + New
            </button>
          </li>
        )}
      </ul>

      {editable && isEditing && (
        <div className="sd-segment-actions">
          {adding ? (
            <>
              <p className="sd-segment-hint">Pick where it starts.</p>
              <button
                type="button"
                className="sd-segment-action"
                onClick={editor.cancel}
                disabled={pending}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="sd-segment-action"
                data-primary="true"
                onClick={() => editor.commit()}
                disabled={pending}
              >
                {isNew ? "Add dancefloor" : "Confirm"}
              </button>
              <button
                type="button"
                className="sd-segment-action"
                onClick={editor.cancel}
                disabled={pending}
              >
                Cancel
              </button>
              {!isNew && (
                <button
                  type="button"
                  className="sd-segment-action"
                  onClick={editor.removeActive}
                  disabled={pending}
                >
                  Remove
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* The rejection lands next to the control that caused it, and is polite
          rather than assertive: the DJ is still mid-edit and their segment is
          untouched, so this is information, not an interruption. */}
      <p className="sd-segment-error" role="status" aria-live="polite">
        {error ? reasonText(error) : ""}
      </p>

      {/* D-36: every nudge re-announces which track the boundary now sits on.
          `aria-valuetext` alone only speaks when focus moves onto the handle;
          this is what makes each individual arrow press audible. */}
      <p className="sr-only" role="status" aria-live="polite">
        {editor.announcement}
      </p>
    </div>
  );
}
