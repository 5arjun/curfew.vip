"use client";

import { useEffect, useRef, useState } from "react";
import { formatDuration, formatSessionLabel, formatSetDate, formatTimeRange } from "@/lib/sets/format";
import type { Scope } from "@/lib/sets/setDetail";
import type { SetRecord } from "@/lib/sets/types";
import type { ScopeFrame } from "./model";
import { DeleteModal } from "./DeleteModal";
import { MetalRim } from "./MetalRim";

// Section A (identity bar) + B (scope line) — spec §3e/§1.
// Identity: mono `date · SET 975` (dashboard card continuity — same
// formatters), `length · track count` beneath, scope-reactive (AC-31).
// The [⋯] overflow is delete's calm home (never a prominent button).
// D3/D4: the scope line only STATES the detected window — no edit affordance
// anywhere (5.3 ships it with the drag that makes it real).

/** Low-confidence display rule (AC-38): the note shows for the ambiguous
 * dense-continuous classification (value ≤ 0.5) and for a session too sparse
 * to be a set at all (fewer than 4 plays — confidence.rs's own
 * MIN_PLAYS_FOR_AMBIGUITY). Quiet and non-hiding: no stat is ever hidden. */
function isLowConfidence(set: SetRecord): boolean {
  const c = set.derived.confidence;
  return c.value <= 0.5 || c.track_count < 4;
}

function scopedLength(frame: ScopeFrame): number | null {
  const timed = frame.plays
    .map((p) => p.started_at)
    .filter((t): t is string => t != null);
  if (timed.length < 2) return timed.length === 1 ? 0 : null;
  return Math.max(
    0,
    Math.round((new Date(timed[timed.length - 1]).getTime() - new Date(timed[0]).getTime()) / 1000),
  );
}

export function SetHeader({
  set,
  frame,
  onScopeChange,
  scopeToggleVisible,
}: {
  set: SetRecord;
  frame: ScopeFrame;
  onScopeChange: (scope: Scope) => void;
  scopeToggleVisible: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // The overflow menu closes on outside click / Escape — calm, no library.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const scopeLine = frame.segment
    ? `Dancefloor ${formatTimeRange(frame.segment.start, frame.segment.end)}`
    : "Whole set · no distinct dancefloor detected.";

  return (
    <div className="sd-identity dz-shell">
      <span className="dz-dots" aria-hidden="true" />
      <div className="sd-identity-top">
        <p className="sd-eyebrow">
          {formatSetDate(set.started_at)} · {formatSessionLabel(set.external_id)}
        </p>

        <div className="sd-overflow" ref={menuRef}>
          <button
            type="button"
            className="sd-overflow-trigger"
            aria-label="Set actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="sd-overflow-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="sd-overflow-item"
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmingDelete(true);
                }}
              >
                Delete set
              </button>
            </div>
          )}
        </div>
      </div>

      <p className="sd-identity-meta">
        {formatDuration(scopedLength(frame))} · {frame.plays.length}{" "}
        {frame.plays.length === 1 ? "track" : "tracks"}
      </p>

      {isLowConfidence(set) && (
        <p className="sd-confidence-note">Low-confidence session — likely a soundcheck or rehearsal</p>
      )}

      <p className="sd-scope-line">{scopeLine}</p>

      {scopeToggleVisible && (
        <MetalRim radius={14} className="sd-toggle-metal">
          <div className="sd-scope-toggle" role="group" aria-label="Stats scope">
            <button
              type="button"
              className="sd-scope-option"
              aria-pressed={frame.scope === "dancefloor"}
              onClick={() => onScopeChange("dancefloor")}
            >
              Dancefloor
            </button>
            <button
              type="button"
              className="sd-scope-option"
              aria-pressed={frame.scope === "whole"}
              onClick={() => onScopeChange("whole")}
            >
              Whole night
            </button>
          </div>
        </MetalRim>
      )}

      {confirmingDelete && (
        <DeleteModal externalId={set.external_id} onCancel={() => setConfirmingDelete(false)} />
      )}
    </div>
  );
}
