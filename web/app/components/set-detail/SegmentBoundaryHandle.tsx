"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { formatClock } from "@/lib/sets/format";
import { boundaryKeyAction, boundaryValueText } from "@/lib/sets/segmentEditor";
import type { BoundaryEdge, SegmentVisualState } from "@/lib/sets/segmentEditor";
import type { SetPlay } from "@/lib/sets/types";

// One draggable/arrow-able segment boundary (Story 5.3, D-34/D-36/D-37).
//
// ROLE. `role="slider"` per handle, not one widget for the pair. The ARIA
// authoring practices model a two-ended range as TWO sliders, each bounding the
// other through its own `aria-valuemin`/`aria-valuemax` — which is exactly the
// relationship `nudgeDraftEdge` already enforces, so the announced range and
// the enforced one come from the same numbers rather than two descriptions of
// the same intent. `aria-orientation="vertical"`: the tracklist runs down the
// page, so Up/Down are the natural keys and Left/Right are accepted as aliases.
//
// This is genuinely new interaction infrastructure (D-36): a codebase-wide scan
// found no arrow-key or slider-shaped widget anywhere to extend. The one
// adjacent precedent, `SetSimilarity.tsx`'s documented `tabIndex`/`aria-hidden`
// trap, is a cautionary note rather than a pattern — which is why the
// accessible name and value here are built from real track data below rather
// than from the position integer alone.
//
// `aria-valuetext` IS the accessible value. `aria-valuenow` carries the raw
// position because the role requires a number, but a screen reader announcing
// "4" tells a DJ nothing about which track they landed on — the entire content
// of the sighted experience. The track title and clock time are what make this
// the same interaction for both, and `useSegmentEditor` announces the same
// sentence into a live region on every nudge for the same reason.
//
// SEGMENT IDENTITY. Every handle belongs to a segment (`segmentId`), including
// ones that are not the active edit — `Tracklist` renders one per segment so
// every floor's rail is always visible, not just the selected one. Every
// callback here carries `segmentId` so `useSegmentEditor` can tell "the handle
// the DJ touched" from "the segment currently being edited" and reconcile them,
// rather than silently acting on whichever draft happened to be active (code
// review finding, 2026-08-11 — this is what makes AC #2's per-handle keyboard
// path actually per-handle).
export function SegmentBoundaryHandle({
  segmentId,
  zone,
  edge,
  position,
  plays,
  bounds,
  state,
  active,
  placing,
  dragging,
  focusOnMount,
  pending,
  onNudge,
  onCommit,
  onStartPlacing,
  onDragTo,
  onDragStateChange,
}: {
  segmentId: string;
  /** The set's own IANA zone, resolved once by the page (Story 7.7). */
  zone: string;
  edge: BoundaryEdge;
  position: number;
  plays: SetPlay[];
  bounds: { min: number; max: number };
  state: SegmentVisualState;
  /** Whether this handle belongs to the segment currently being edited (D-30). */
  active: boolean;
  /** Whether this handle is armed and waiting for a row tap (D-37). */
  placing: boolean;
  /** Whether THIS handle's edge is the one currently being dragged — owned by
   * `useSegmentEditor`, not a local ref, so it survives this component
   * remounting under a different row mid-drag. */
  dragging: boolean;
  /** Set right after a keyboard nudge moves this edge to a new row, which
   * remounts this component — consumed once, on mount, to reclaim focus. */
  focusOnMount: boolean;
  /** Mirrors the visible Confirm button's guard: Enter must not double-fire a
   * write while one from this editor is already in flight. */
  pending: boolean;
  onNudge: (segmentId: string, edge: BoundaryEdge, delta: number) => void;
  onCommit: (segmentId: string) => void;
  onStartPlacing: (segmentId: string, edge: BoundaryEdge) => void;
  /** Absolute move, for the drag path (D-37's enhancement). */
  onDragTo: (segmentId: string, edge: BoundaryEdge, position: number) => void;
  /** Reports drag start/end so the "no transition, live transform" visual
   * state is React-owned rather than an imperative DOM write. */
  onDragStateChange: (segmentId: string | null, edge: BoundaryEdge | null) => void;
}) {
  const play = plays.find((p) => p.position === position);
  const valueText = boundaryValueText(edge, play, formatClock(play?.started_at ?? null, zone));

  // Drag offset, held in a ref and written straight to `style.transform` rather
  // than through React state. A boundary snaps to whole tracks, so the handle's
  // laid-out position jumps a full row height at a time; without this the grip
  // teleported under the cursor every time it crossed a track. Recomputing the
  // offset from LIVE rects on every move means the handle tracks the pointer
  // 1:1 and the row-to-row re-parent underneath it is invisible.
  //
  // Deliberately not React state: this fires at pointer rate, and a re-render
  // per move is exactly the jank being removed here. The COARSER "is a drag in
  // progress" flag that drives the CSS transition toggle is `dragging`, a prop
  // from `useSegmentEditor` — see that hook for why the two are split.
  const gripRef = useRef<HTMLButtonElement | null>(null);
  /** True once real pointer movement has been seen for the in-progress
   * gesture — distinguishes an actual drag from a stationary tap, so the
   * `click` that follows every `pointerup` (drag or not — see `onClick` below)
   * knows whether to re-arm tap-placement. */
  const didDragRef = useRef(false);
  /** Detaches the current gesture's `window` listeners. Called from
   * `pointerup`/`pointercancel` normally, and from the unmount effect below so
   * a mid-drag unmount (e.g. this same remount-on-row-crossing) can never leak
   * them. */
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  // Reclaim focus after a keyboard nudge remounted this handle under a new
  // row. `useLayoutEffect` so it happens before paint — no visible flash of
  // the handle rendering unfocused first.
  useLayoutEffect(() => {
    if (focusOnMount) gripRef.current?.focus();
  }, [focusOnMount]);

  return (
    <div className="sd-boundary" data-edge={edge} data-state={state} data-active={active || undefined}>
      {/* Grip first, THEN the line. The line is `flex: 1`, so the other order
          pushed the grip to the far right edge of the tracklist — ~830px from
          the timeline rail that anchors the segment, and nowhere near the "+"
          affordance in the same gutter. The thing you grab belongs beside the
          rail; the line is what stretches. (Caught in the 1440 browser pass.) */}
      <button
        type="button"
        className="sd-boundary-grip"
        ref={gripRef}
        role="slider"
        aria-orientation="vertical"
        aria-valuemin={bounds.min}
        aria-valuemax={bounds.max}
        aria-valuenow={position}
        aria-valuetext={valueText}
        aria-label={`Dancefloor ${edge === "first" ? "start" : "end"} boundary`}
        data-placing={placing || undefined}
        data-dragging={dragging || undefined}
        onClick={() => {
          // A real drag's `pointerup` is still followed by a native `click` on
          // this same element (pointer capture keeps it targeted here, and
          // `preventDefault` on `pointerdown` does not suppress `click` the way
          // it suppresses the other compatibility mouse events) — so without
          // this check, finishing a drag re-arms tap-placement for the edge
          // that was JUST placed, and the very next tracklist tap moves it
          // again unexpectedly. A stationary tap has no movement to report and
          // falls through to the real handler below (code review finding,
          // 2026-08-11).
          if (didDragRef.current) {
            didDragRef.current = false;
            return;
          }
          onStartPlacing(segmentId, edge);
        }}
        // Desktop drag (D-37's enhancement, layered onto the tap state rather
        // than replacing it). Pointer events, not a drag library: this app has
        // none, `framer-motion`'s drag primitives are unused anywhere in the
        // codebase, and adding a first use of either for one gesture would be a
        // dependency decision rather than a gesture.
        //
        // The hit test reads the rows' existing `data-position` attributes —
        // the same idiom `SetDetail`'s scroll-to-focus effect already queries,
        // and the reason this story does not touch that attribute.
        onPointerDown={(event) => {
          // Primary button/pointer only — a right-click, or a second touch
          // finger while another drag is already live, must not start a
          // second, conflicting drag.
          if (event.button !== 0 || !event.isPrimary) return;
          const rows = event.currentTarget
            .closest(".sd-rows")
            ?.querySelectorAll<HTMLElement>("[data-position]");
          if (!rows || rows.length === 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();

          didDragRef.current = false;
          const grip = event.currentTarget;
          onDragStateChange(segmentId, edge);

          const moveTo = (clientY: number) => {
            let nearest: number | null = null;
            let best = Number.POSITIVE_INFINITY;
            for (const row of rows) {
              const rect = row.getBoundingClientRect();
              const distance = Math.abs(rect.top + rect.height / 2 - clientY);
              const position = Number(row.dataset.position);
              if (distance < best && Number.isFinite(position)) {
                best = distance;
                nearest = position;
              }
            }
            if (nearest != null) onDragTo(segmentId, edge, nearest);
            // Re-measure AFTER the snap so the offset cancels whatever row the
            // handle just landed in — this is what turns a per-track jump into
            // continuous motion. If the row crossed just remounted this
            // component under a new parent, `grip` (this closure's node) is
            // already detached — writing to it is a harmless no-op, and the
            // freshly mounted instance renders at its own row's natural flow
            // position with `data-dragging` already true (a prop, not this
            // write), so the "no transition" behavior carries over regardless.
            grip.style.transform = "translateY(0px)";
            const rect = grip.getBoundingClientRect();
            grip.style.transform = `translateY(${clientY - (rect.top + rect.height / 2)}px)`;
          };

          let queued: number | null = null;
          const onMove = (moveEvent: PointerEvent) => {
            didDragRef.current = true;
            // One update per frame: pointermove can outpace paint, and the
            // extra `getBoundingClientRect` reads would thrash layout.
            if (queued != null) cancelAnimationFrame(queued);
            queued = requestAnimationFrame(() => moveTo(moveEvent.clientY));
          };
          const cleanup = () => {
            if (queued != null) cancelAnimationFrame(queued);
            // Hand the last few pixels back to CSS: the grip eases from wherever
            // the finger left it onto the track it snapped to, instead of
            // vanishing back into place.
            grip.style.transform = "";
            onDragStateChange(null, null);
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
            dragCleanupRef.current = null;
          };
          const onUp = () => cleanup();
          dragCleanupRef.current = cleanup;
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
          // `pointercancel` matters on touch: a scroll gesture taking over
          // cancels the pointer without ever firing `pointerup`, and without
          // this the listeners would outlive the drag.
          window.addEventListener("pointercancel", onUp);
        }}
        onKeyDown={(event) => {
          // The mapping itself lives in `boundaryKeyAction` so it is testable
          // without a DOM — this repo runs no jsdom by design. What stays here
          // is only what needs a real event.
          const action = boundaryKeyAction(event.key, position, bounds);
          if (action == null) return;
          // `preventDefault` on Enter matters beyond scroll suppression: this is
          // a <button>, so Enter would otherwise ALSO fire the click handler and
          // re-arm placement at the instant the DJ committed — a confirm that
          // visibly re-opens the editor.
          event.preventDefault();
          if (action.kind === "commit") {
            // Mirrors the visible Confirm button's `disabled={pending}` — Enter
            // is a second entry point to the same commit and must not be able
            // to fire a second concurrent write while one is already in flight.
            if (pending) return;
            onCommit(segmentId);
          } else {
            onNudge(segmentId, edge, action.delta);
          }
        }}
      >
        <span className="sd-boundary-grip-dot" aria-hidden="true" />
        <span className="sr-only">{valueText}</span>
      </button>
      <span className="sd-boundary-line" aria-hidden="true" />
    </div>
  );
}
