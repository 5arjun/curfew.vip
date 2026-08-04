"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { detectDancefloor } from "@/lib/sets/dancefloor";
import { arcPeakPosition, newTracks, scopedPlays, type NewTracksWindow, type Scope } from "@/lib/sets/setDetail";
import type { SetRecord } from "@/lib/sets/types";
import { SilkBackdrop } from "@/app/components/dashboard/SilkBackdrop";
import type { Focus, OverlayKind, ScopeFrame } from "./model";
import { SetHeader } from "./SetHeader";
import { DetailArc } from "./DetailArc";
import { StatsColumn } from "./StatsColumn";
import { Tracklist } from "./Tracklist";

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
  // Detection runs client-side from plays[] on every open (D2) — v0 global
  // heuristic, knowingly interim (5.2 calibrates it, no UI change).
  const segment = useMemo(() => detectDancefloor(set.plays), [set.plays]);

  const [scope, setScope] = useState<Scope>("dancefloor");
  const [focus, setFocusState] = useState<Focus | null>(null);
  const [overlay, setOverlay] = useState<OverlayKind>(null);
  const [visibleRows, setVisibleRows] = useState(INITIAL_ROWS);
  // The New-tracks Week/Month toggle lives on its module (AC-30) but the
  // tracklist's ·new· markers react to it too (AC-18), so it lives here.
  const [newWindow, setNewWindow] = useState<NewTracksWindow>("week");

  // No detected dancefloor → the toggle hides and the whole set is the one
  // honest frame (AC-35/36).
  const effectiveScope: Scope = segment ? scope : "whole";

  const frame: ScopeFrame = useMemo(() => {
    const plays = scopedPlays(set.plays, segment, effectiveScope);
    return {
      scope: effectiveScope,
      segment,
      plays,
      peakPosition: arcPeakPosition(plays),
    };
  }, [set.plays, segment, effectiveScope]);

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
          const index = set.plays.findIndex((p) => p.position === first);
          if (index >= 0) {
            setVisibleRows((v) => (index < v ? v : Math.ceil((index + 1) / INITIAL_ROWS) * INITIAL_ROWS));
          }
          pendingScrollTo.current = first;
        }
        return next;
      });
    },
    [set.plays],
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

  // D1: the flip changes every pane to one frame at once — a focus computed
  // under the previous frame would mix two frames, so it clears.
  const flipScope = useCallback((next: Scope) => {
    setScope(next);
    setFocusState(null);
  }, []);

  return (
    <main className="sd" data-scope={frame.scope}>
      {/* Same Silk ground as the dashboard (post-review parity ruling). */}
      <SilkBackdrop />
      <header className="sd-header">
        <SetHeader set={set} frame={frame} onScopeChange={flipScope} scopeToggleVisible={segment != null} />
        <DetailArc set={set} frame={frame} />
      </header>

      <div className="sd-body">
        <div className="sd-spine" ref={listRef}>
          <Tracklist
            set={set}
            frame={frame}
            focus={focus}
            onDismissFocus={() => setFocusState(null)}
            newTrackRows={newTrackRows}
            visibleRows={visibleRows}
            onLoadMore={() => setVisibleRows((v) => v + INITIAL_ROWS)}
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
