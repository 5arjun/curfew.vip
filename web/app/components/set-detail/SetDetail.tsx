"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dancefloorSegments } from "@/lib/sets/dancefloor";
import {
  arcPeakPosition,
  newTracks,
  resolveViewSegment,
  scopedPlays,
  viewSegmentFirstPosition,
  type NewTracksWindow,
  type Scope,
} from "@/lib/sets/setDetail";
import type { SetRecord } from "@/lib/sets/types";
import { SilkBackdrop } from "@/app/components/dashboard/SilkBackdrop";
import type { Focus, OverlayKind, ScopeFrame } from "./model";
import { SetHeader } from "./SetHeader";
import { DetailArc } from "./DetailArc";
import { StatsColumn } from "./StatsColumn";
import { Tracklist } from "./Tracklist";
import { useSegmentEditor } from "./useSegmentEditor";

// Set Detail shell (Story 3.7) — owns the three pieces of view state the whole
// screen shares and nothing else persists (D5: view-only):
//   scope   — D1/D2: dancefloor by default on EVERY open, flips everything at
//             once; never stored as a preference.
//   focus   — DR-2: the single shared highlight-the-tracklist mechanism.
//   overlay — which right-column drill-in is open (rides the sticky column).
//
// Whole-page scroll (L-2): no 100dvh shell, no nested scroll region — the
// tracklist drives page height and the right column is `position: sticky`.
const INITIAL_ROWS = 50;

export function SetDetail({ set }: { set: SetRecord }) {
  // The dancefloor cut arrives ON the set row (Story 5.2) — detected agent-side
  // against this DJ's own calibrated floors, stored as `segments` rows, fetched
  // by the read seam. `null` still means "no dancefloor", which the scope
  // toggle below already handles.
  const segments = useMemo(() => dancefloorSegments(set.segments), [set.segments]);

  // Story 5.4: which dancefloor the DJ is VIEWING, independent of `editor`'s
  // editing-target selection below (model.ts's `activeSegmentId` doc comment
  // names this split explicitly). `null` means "no explicit pick yet", which
  // resolves to `segments[0]` — the same longest-first pick
  // `primaryDancefloorSegment` used to hand back, so a 0/1-segment set (and a
  // freshly opened 2+-segment one) renders byte-identical to before.
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const segment = useMemo(
    () => resolveViewSegment(segments, selectedSegmentId),
    [segments, selectedSegmentId],
  );

  // A set whose plays carry no cloud id cannot be edited: there is no row for a
  // boundary to point at. True of fixture-backed data by construction, and
  // never of a real synced set — so this reads as "nothing to edit here" rather
  // than as a disabled feature.
  const editable = useMemo(() => set.plays.some((play) => play.id != null), [set.plays]);

  const [scope, setScope] = useState<Scope>("dancefloor");
  const [focus, setFocusState] = useState<Focus | null>(null);
  const [overlay, setOverlay] = useState<OverlayKind>(null);
  const [visibleRows, setVisibleRows] = useState(INITIAL_ROWS);
  // The New-tracks Week/Month toggle lives on its module (AC-30) but the
  // tracklist's ·new· markers react to it too (AC-18), so it lives here.
  const [newWindow, setNewWindow] = useState<NewTracksWindow>("week");
  // Object-wrapped rather than a bare number so selecting the SAME floor twice
  // still scrolls — a plain `position` would compare equal and the effect
  // would not re-run.
  const [scrollTarget, setScrollTarget] = useState<{ position: number } | null>(null);

  // "Load more" pages of 50 stay the only row-count mechanism (see `setFocus`
  // below, which has needed this since 3.7). Shared by both callers rather than
  // reimplemented, so a boundary and a focus target page identically.
  const revealPosition = useCallback(
    (position: number, scrollIntoView = false) => {
      const index = set.plays.findIndex((p) => p.position === position);
      if (index < 0) return;
      setVisibleRows((v) => (index < v ? v : Math.ceil((index + 1) / INITIAL_ROWS) * INITIAL_ROWS));
      // Selecting a floor scrolls to where it actually starts (Arjun,
      // 2026-08-11): the boundary can be eighty rows down, and an editor whose
      // subject is off-screen makes the DJ hunt for what they just picked.
      if (scrollIntoView) setScrollTarget({ position });
    },
    [set.plays],
  );

  // Story 5.3: the editor's state, owned here because three surfaces read it —
  // the tracklist draws the handles, the arc mirrors the live boundary (D-34),
  // and the selector says which floor is being edited (D-30).
  const editor = useSegmentEditor(set, revealPosition);

  // No detected dancefloor → the toggle hides and the whole set is the one
  // honest frame (AC-35/36).
  const effectiveScope: Scope = segment ? scope : "whole";

  // The live draft as ISO bounds, for the arc's mirror (D-34). Resolved from
  // the same `set.plays` the handles are indexed against, so the band and the
  // handles can never describe different boundaries.
  const editingBounds = useMemo(() => {
    if (editor.draft == null) return null;
    const start = set.plays.find((p) => p.position === editor.draft!.firstPosition)?.started_at;
    const end = set.plays.find((p) => p.position === editor.draft!.lastPosition)?.started_at;
    if (start == null || end == null) return null;
    return { start, end };
  }, [editor.draft, set.plays]);

  const frame: ScopeFrame = useMemo(() => {
    const plays = scopedPlays(set.plays, segment, effectiveScope);
    return {
      scope: effectiveScope,
      segment,
      activeSegmentId: editor.activeId,
      editingBounds,
      plays,
      peakPosition: arcPeakPosition(plays),
    };
  }, [set.plays, segment, effectiveScope, editor.activeId, editingBounds]);

  // AC-18: the ·new· row markers share the module's computation exactly.
  const newTrackRows = useMemo(
    () => new Set(newTracks(set.plays, set.started_at, newWindow).positions),
    [set.plays, set.started_at, newWindow],
  );

  // DR-1: focusing scrolls the WINDOW to the first match (the 3.6 refinement's
  // scrollIntoView-scrolled-ancestor-shells bug does not exist on a whole-page
  // scroll, but window-level scrolling is still the deliberate choice here).
  const listRef = useRef<HTMLDivElement>(null);
  const pendingScrollTo = useRef<number | null>(null);

  const setFocus = useCallback(
    (next: Focus | null) => {
      setFocusState((prev) => {
        if (next && prev?.key === next.key) return prev;
        if (next && next.positions.length > 0) {
          const first = next.positions[0];
          // Ensure the first match is rendered before scrolling to it —
          // "Load more" pages of 50 stay the only row-count mechanism.
          revealPosition(first);
          pendingScrollTo.current = first;
        }
        return next;
      });
    },
    [revealPosition],
  );

  useEffect(() => {
    if (focus == null || pendingScrollTo.current == null) return;
    const position = pendingScrollTo.current;
    pendingScrollTo.current = null;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-position="${position}"]`);
    if (!row) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const top = row.getBoundingClientRect().top + window.scrollY - window.innerHeight / 3;
    window.scrollTo({ top: Math.max(0, top), behavior: reduced ? "auto" : "smooth" });
  }, [focus]);

  // Scrolls to a boundary the editor just made active. Separate from the focus
  // effect above because it fires on selection rather than on a focus change,
  // but it lands the row in the same upper third and honours the same
  // reduced-motion check.
  useEffect(() => {
    if (scrollTarget == null) return;
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-position="${scrollTarget.position}"]`,
    );
    if (!row) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const top = row.getBoundingClientRect().top + window.scrollY - window.innerHeight / 3;
    window.scrollTo({ top: Math.max(0, top), behavior: reduced ? "auto" : "smooth" });
  }, [scrollTarget]);

  // D1: the flip changes every pane to one frame at once — a focus computed
  // under the previous frame would mix two frames, so it clears.
  const flipScope = useCallback((next: Scope) => {
    setScope(next);
    setFocusState(null);
  }, []);

  // Same precedent, for the same reason (Task 1.2): switching which dancefloor
  // is being VIEWED swaps the frame just as switching dancefloor/whole does, so
  // a focus computed under the old segment clears rather than mixing two frames.
  //
  // The reveal below is the OTHER precedent in this file, and it belongs here
  // for exactly the reason `revealPosition`'s own doc comment gives ("Required,
  // not a nicety"): the tracklist pages at 50 rows and a set's second or third
  // dancefloor routinely starts past that — fixture 975's start at positions 69
  // and 96. Without it, picking "Dancefloor 2" rescoped the stats, the arc and
  // the header onto rows that were neither rendered nor on screen, and
  // `frame.peakPosition` moved to a row behind "Load more", so the ★ peak marker
  // vanished from the list instead of moving. Story 5.3 hit and fixed this same
  // bug for the editing selector; the view selector reintroduced it.
  // (Code review 2026-08-11 — invisible to lint/typecheck/build/test.)
  const selectViewSegment = useCallback(
    (id: string) => {
      setSelectedSegmentId(id);
      setFocusState(null);
      // Derived from `set.plays` rather than `editor.positionsFor`, which is
      // draft-aware: a live boundary drag on ANOTHER floor must not decide
      // where the view jumps. View-scope stays independent of edit state.
      const firstPosition = viewSegmentFirstPosition(
        set.plays,
        segments.find((s) => s.id === id) ?? null,
      );
      if (firstPosition != null) revealPosition(firstPosition, true);
    },
    [segments, set.plays, revealPosition],
  );

  return (
    <main className="sd" data-scope={frame.scope}>
      {/* Same Silk ground as the dashboard (post-review parity ruling). */}
      <SilkBackdrop />
      <header className="sd-header">
        <SetHeader set={set} frame={frame} onScopeChange={flipScope} scopeToggleVisible={segment != null} />
        {/* 3.8: the arc + key strip click-to-jump ride the SAME DR-2 setFocus
            every stat module uses — no second focus path. */}
        <DetailArc set={set} frame={frame} setFocus={setFocus} />
      </header>

      <div className="sd-body">
        <div className="sd-spine" ref={listRef}>
          {/* The dancefloor strip — view scope (Story 5.4 AC #2) and edit target
              (D-30) on ONE chip list — now renders inside the tracklist card
              itself (Arjun's 2026-08-12 merge call). Two stacked strips of
              same-named chips read as four buttons for two dancefloors, and the
              stack pushed the card out of line with the stats rail. */}
          <Tracklist
            set={set}
            frame={frame}
            focus={focus}
            onDismissFocus={() => setFocusState(null)}
            newTrackRows={newTrackRows}
            visibleRows={visibleRows}
            onLoadMore={() => setVisibleRows((v) => v + INITIAL_ROWS)}
            editor={editor}
            editable={editable}
            viewSelectedId={segment?.id ?? null}
            onSelectView={selectViewSegment}
          />
        </div>

        <aside className="sd-rail" aria-label="Set stats">
          <StatsColumn
            set={set}
            frame={frame}
            focus={focus}
            setFocus={setFocus}
            overlay={overlay}
            setOverlay={setOverlay}
            newWindow={newWindow}
            setNewWindow={setNewWindow}
          />
        </aside>
      </div>
    </main>
  );
}
