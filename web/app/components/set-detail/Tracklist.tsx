"use client";

import { useMemo, useState } from "react";
import { Key, Plus } from "lucide-react";
import { formatBpm, formatClock } from "@/lib/sets/format";
import { formatPlayedLength, parseCamelot, transitions, type Transition } from "@/lib/sets/setDetail";
import { positionBounds, segmentVisualState } from "@/lib/sets/segmentEditor";
import type { SetRecord } from "@/lib/sets/types";
import { CursorChip, useCursorChipTarget } from "@/app/components/ui/CursorChip";
import type { Focus, ScopeFrame } from "./model";
import { SegmentBoundaryHandle } from "./SegmentBoundaryHandle";
import { SegmentSelector } from "./SegmentSelector";
import { NEW_SEGMENT_ID, type SegmentEditor } from "./useSegmentEditor";

/** Transition copy — descriptive, never a judgement of the mixing
 * ("in key"/"out of key", post-review wording ruling). */
function transitionLabel(t: Transition): string {
  const keys = `${t.fromKey ?? "—"} → ${t.toKey ?? "—"}`;
  const state = t.state === "smooth" ? "in key" : t.state === "clash" ? "out of key" : "no key";
  return `${keys} · ${state}`;
}

// Section F — the tracklist, the page's stable spine (spec §3a-F).
// Row anatomy: timeline rail (timestamp + node) · title/artist · right-aligned
// mono metadata columns (BPM · played-length · key chip) that align for column
// scanning, plus the ·new· marker (AC-17/18).
//
// In-key connectors (Q1/AC-19): a marker ON the connector between consecutive
// rows — same Camelot rule as the harmonic aggregate. Always visible, always
// quiet: smooth = soft cyan glow + link glyph; clash = faint dashed connector,
// neutral-muted (never red, UX-DR18); no key = plain, no marker.
//
// DR-1 (AC-25): focusing highlights in place — non-matching rows dim, the
// sequence never filters/hides (hiding would break the timeline AND these
// connectors), and a dismissable "Focused: X ✕" pill sits atop the list.
//
// SEGMENT EDITING (Story 5.3, D-34/D-37) rides the same between-rows anatomy the
// connectors established: a boundary is a sibling element BETWEEN two rows, not
// a selected row — matching "point at the first and last track that count"
// exactly. Bracketed rows carry a left-edge rail so a floor's extent reads at a
// glance without any interaction at all.
//
// Rows come from `set.plays` (the whole night), never `frame.plays` (the
// scope-filtered slice), the same rule the dimming logic already follows: a
// segment's own boundaries can legitimately sit anywhere in the timeline
// regardless of which scope is being viewed, so indexing handles against the
// filtered slice would put them on the wrong tracks.
export function Tracklist({
  set,
  frame,
  focus,
  onDismissFocus,
  newTrackRows,
  visibleRows,
  onLoadMore,
  editor,
  editable,
  viewSelectedId,
  onSelectView,
}: {
  set: SetRecord;
  frame: ScopeFrame;
  focus: Focus | null;
  onDismissFocus: () => void;
  newTrackRows: Set<number>;
  visibleRows: number;
  onLoadMore: () => void;
  editor: SegmentEditor;
  /** `false` for fixture-backed sets, whose plays have no cloud row to point at. */
  editable: boolean;
  /** Threaded straight through to the dancefloor strip in this card's header. */
  viewSelectedId: string | null;
  onSelectView: (id: string) => void;
}) {
  // Connectors are between adjacent rows of the full list (the timeline),
  // keyed by the upper row's position — the same rule, and on the whole set
  // the same counts, as derived.camelot_mixing_stats (AC-19).
  const connectorAfter = useMemo(() => {
    const map = new Map<number, Transition>();
    for (const t of transitions(set.plays)) map.set(t.fromPosition, t);
    return map;
  }, [set.plays]);

  const focusSet = useMemo(() => (focus ? new Set(focus.positions) : null), [focus]);
  const visible = set.plays.slice(0, visibleRows);
  const remaining = set.plays.length - visible.length;

  const bounds = useMemo(() => positionBounds(set.plays), [set.plays]);

  /**
   * Every segment's rendered extent, keyed by the position its handles sit at.
   *
   * Built from `editor.positionsFor`, so the segment being edited contributes
   * its LIVE draft while the rest contribute their stored boundaries — one
   * source of truth (D-34), read the same way by the rail, the handles and the
   * arc.
   */
  const segmentLayout = useMemo(() => {
    const startsAt = new Map<number, { id: string; state: "suggested" | "confirmed"; active: boolean }>();
    const endsAt = new Map<number, { id: string; state: "suggested" | "confirmed"; active: boolean }>();
    const railAt = new Map<number, { state: "suggested" | "confirmed"; active: boolean }>();

    const entries = editor.segments.map((segment) => ({
      id: segment.id,
      state: segmentVisualState(segment),
      active: segment.id === editor.activeId,
      positions: editor.positionsFor(segment),
    }));

    // A manual segment being drawn has no row yet, so it is not in `segments` —
    // but it must render, or the DJ would be placing an invisible boundary.
    if (editor.draft != null && editor.draft.segmentId == null) {
      entries.push({
        id: NEW_SEGMENT_ID,
        state: "confirmed",
        active: true,
        positions: {
          firstPosition: editor.draft.firstPosition,
          lastPosition: editor.draft.lastPosition,
        },
      });
    }

    for (const entry of entries) {
      if (entry.positions == null) continue;
      const meta = { id: entry.id, state: entry.state, active: entry.active };
      startsAt.set(entry.positions.firstPosition, meta);
      endsAt.set(entry.positions.lastPosition, meta);
      for (let p = entry.positions.firstPosition; p <= entry.positions.lastPosition; p += 1) {
        // An active segment's rail wins where two segments would otherwise
        // claim the same row — reachable only mid-draft, since the D-29 trigger
        // forbids committing an overlap.
        if (!railAt.has(p) || entry.active) railAt.set(p, { state: entry.state, active: entry.active });
      }
    }
    return { startsAt, endsAt, railAt };
  }, [editor]);

  const placingEdge = editor.placing?.edge ?? null;
  // Something is actually bracketed — a floor is selected, or a new one has had
  // its first boundary placed. Distinct from `isEditing`, which is also true in
  // the moment between "+ New" and the first tap.
  const hasActiveExtent = editor.activeId != null || editor.draft != null;

  // Connector hover detail rides the shared CursorChip (compact) — the same
  // pop-up language as the calendar/nav (post-review ruling).
  const chipTarget = useCursorChipTarget();
  const [hoverTransition, setHoverTransition] = useState<Transition | null>(null);

  return (
    <section
      className="sd-tracklist dz-shell"
      aria-label="Tracklist"
      data-editing={editor.isEditing || undefined}
    >
      <span className="dz-dots" aria-hidden="true" />
      {/* The dancefloor strip lives INSIDE this card (Arjun, 2026-08-12).
          Stacked above it in `.sd-spine` it pushed the tracklist down by its
          own height, so the card no longer topped out level with the stats rail
          beside it — the two columns visibly disagreed about where the page's
          content started, and the offset moved with the number of floors. It
          governs this list, so it belongs to this list's container. */}
      <SegmentSelector
        editor={editor}
        editable={editable}
        viewSelectedId={viewSelectedId}
        onSelectView={onSelectView}
      />
      {focus && (
        <div className="sd-focus-pill-row">
          <button type="button" className="sd-focus-pill" onClick={onDismissFocus}>
            Focused: {focus.label} <span aria-hidden="true">✕</span>
            <span className="sr-only">— clear focus</span>
          </button>
        </div>
      )}

      <ol className="sd-rows">
        {visible.map((play, i) => {
          const isPeak = frame.peakPosition === play.position;
          const dimmed = focusSet != null && !focusSet.has(play.position);
          const unknown = play.title == null && play.artist == null;
          const connector = i < visible.length - 1 ? connectorAfter.get(play.position) : undefined;
          const camelot = play.camelot_key ? parseCamelot(play.camelot_key) : null;

          const startsHere = segmentLayout.startsAt.get(play.position);
          const endsHere = segmentLayout.endsAt.get(play.position);
          const rail = segmentLayout.railAt.get(play.position);
          // The "+" only exists in EDIT MODE (Arjun, 2026-08-11) — outside it,
          // a stray click in a row gap could silently start a segment. Within
          // edit mode it still only offers itself where a new floor could
          // actually begin: inside an existing segment there is nothing to add
          // that would not immediately overlap, which D-29 would reject anyway.
          const canAddHere = editable && editor.adding && rail == null;

          return (
            <li key={play.position} className="sd-row-item">
              {startsHere && bounds && (
                <SegmentBoundaryHandle
                  segmentId={startsHere.id}
                  edge="first"
                  position={play.position}
                  plays={set.plays}
                  bounds={bounds}
                  state={startsHere.state}
                  active={startsHere.active}
                  placing={startsHere.active && placingEdge === "first"}
                  dragging={
                    startsHere.active &&
                    editor.draggingSegmentId === startsHere.id &&
                    editor.draggingEdge === "first"
                  }
                  focusOnMount={startsHere.active && editor.justNudgedEdge === "first"}
                  pending={editor.pending}
                  onNudge={editor.nudge}
                  onCommit={editor.commit}
                  onStartPlacing={editor.startPlacing}
                  onDragTo={editor.setEdge}
                  onDragStateChange={editor.setDragging}
                />
              )}

              {canAddHere && (
                <div className="sd-add-boundary">
                  <button
                    type="button"
                    className="sd-add-boundary-button"
                    onClick={() => editor.startManualAt(play.position)}
                  >
                    <Plus size={12} strokeWidth={2.4} aria-hidden="true" />
                    <span className="sr-only">
                      Mark a dancefloor starting at {play.title ?? "this track"}
                    </span>
                  </button>
                </div>
              )}

              <div
                className="sd-row"
                data-position={play.position}
                data-dimmed={dimmed || undefined}
                data-peak={isPeak || undefined}
                data-in-segment={rail ? rail.state : undefined}
                data-segment-active={rail?.active || undefined}
                // In edit mode the tracks OUTSIDE the floor being edited step
                // back, so the segment's extent is the thing you read (Arjun,
                // 2026-08-11). Kept as its own attribute rather than folded
                // into `data-dimmed`, which belongs to the DR-2 focus
                // mechanism and must stay independently controllable.
                //
                // Gated on there being an active extent at all: while "+ New"
                // is armed and no boundary has been placed yet, there is
                // nothing to be outside OF, and dimming the entire night would
                // grey out the very rows the DJ is being asked to choose from.
                data-outside-segment={hasActiveExtent && !rail?.active ? "true" : undefined}
                // Tap-to-mark (D-37): inert unless a boundary is armed. Every
                // row is also part of the DR-2 focus-highlight mechanism, so a
                // bare row tap moving a boundary would hijack that — the arming
                // step is what keeps the two interactions from colliding.
                onClick={placingEdge ? () => editor.tapRow(play.position) : undefined}
                data-taptarget={placingEdge ? "true" : undefined}
              >
                <div className="sd-row-rail">
                  <time className="sd-row-time">{formatClock(play.started_at)}</time>
                  <span className="sd-row-node" aria-hidden="true" />
                  {isPeak && (
                    <span className="sd-row-peak" aria-label="Peak of the energy arc">
                      ★ PEAK
                    </span>
                  )}
                </div>

                <div className="sd-row-main">
                  {unknown ? (
                    <p className="sd-row-title sd-row-unknown">Unknown track data</p>
                  ) : (
                    <>
                      <p className="sd-row-title">{play.title ?? "Unknown title"}</p>
                      <p className="sd-row-artist">{play.artist ?? "—"}</p>
                    </>
                  )}
                </div>

                <div className="sd-row-meta">
                  {newTrackRows.has(play.position) && <span className="sd-row-new">·new·</span>}
                  <span className="sd-row-bpm">{formatBpm(play.bpm)}</span>
                  <span className="sd-row-length">{formatPlayedLength(play.played_ms)}</span>
                  <span
                    className="sd-row-key"
                    data-empty={play.camelot_key == null || undefined}
                    // Camelot wheel coloring: each key rides its own hue token
                    // (tokens.css --camelot-*, post-review ruling). Built from
                    // the parsed key, not the raw string — a malformed value
                    // must fall back to neutral, not reference a nonexistent
                    // CSS custom property (which would be invalid-at-computed-
                    // value-time instead of triggering the var() fallback).
                    style={
                      camelot
                        ? ({
                            "--sd-key-color": `var(--camelot-${camelot.number}${camelot.letter.toLowerCase()})`,
                          } as React.CSSProperties)
                        : undefined
                    }
                  >
                    {play.camelot_key ?? "—"}
                  </span>
                </div>
              </div>

              {endsHere && bounds && (
                <SegmentBoundaryHandle
                  segmentId={endsHere.id}
                  edge="last"
                  position={play.position}
                  plays={set.plays}
                  bounds={bounds}
                  state={endsHere.state}
                  active={endsHere.active}
                  placing={endsHere.active && placingEdge === "last"}
                  dragging={
                    endsHere.active &&
                    editor.draggingSegmentId === endsHere.id &&
                    editor.draggingEdge === "last"
                  }
                  focusOnMount={endsHere.active && editor.justNudgedEdge === "last"}
                  pending={editor.pending}
                  onNudge={editor.nudge}
                  onCommit={editor.commit}
                  onStartPlacing={editor.startPlacing}
                  onDragTo={editor.setEdge}
                  onDragStateChange={editor.setDragging}
                />
              )}

              {connector && (
                <div
                  className="sd-connector"
                  data-state={connector.state}
                  aria-hidden="true"
                  onMouseEnter={(e) => {
                    chipTarget.current = { x: e.clientX, y: e.clientY };
                    setHoverTransition(connector);
                  }}
                  onMouseMove={(e) => {
                    chipTarget.current = { x: e.clientX, y: e.clientY };
                  }}
                  onMouseLeave={() => setHoverTransition(null)}
                >
                  <span className="sd-connector-line" />
                  {connector.state === "smooth" && (
                    <span className="sd-connector-glyph">
                      <Key size={11} strokeWidth={2.2} />
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {remaining > 0 && (
        <button type="button" className="sd-load-more" onClick={onLoadMore}>
          Load more · {remaining} remaining
        </button>
      )}

      <CursorChip
        target={chipTarget}
        visible={hoverTransition != null}
        contentKey={hoverTransition ? `t-${hoverTransition.fromPosition}` : null}
        offsetY={-44}
        compact
      >
        {hoverTransition && <p className="cursor-chip-mono">{transitionLabel(hoverTransition)}</p>}
      </CursorChip>
    </section>
  );
}
