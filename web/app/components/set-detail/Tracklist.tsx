"use client";

import { useMemo, useState } from "react";
import { Key } from "lucide-react";
import { formatBpm, formatClock } from "@/lib/sets/format";
import { formatPlayedLength, parseCamelot, transitions, type Transition } from "@/lib/sets/setDetail";
import type { SetRecord } from "@/lib/sets/types";
import { CursorChip, useCursorChipTarget } from "@/app/components/ui/CursorChip";
import type { Focus, ScopeFrame } from "./model";

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
export function Tracklist({
  set,
  frame,
  focus,
  onDismissFocus,
  newTrackRows,
  visibleRows,
  onLoadMore,
}: {
  set: SetRecord;
  frame: ScopeFrame;
  focus: Focus | null;
  onDismissFocus: () => void;
  newTrackRows: Set<number>;
  visibleRows: number;
  onLoadMore: () => void;
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

  // Connector hover detail rides the shared CursorChip (compact) — the same
  // pop-up language as the calendar/nav (post-review ruling).
  const chipTarget = useCursorChipTarget();
  const [hoverTransition, setHoverTransition] = useState<Transition | null>(null);

  return (
    <section className="sd-tracklist dz-shell" aria-label="Tracklist">
      <span className="dz-dots" aria-hidden="true" />
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

          return (
            <li key={play.position} className="sd-row-item">
              <div
                className="sd-row"
                data-position={play.position}
                data-dimmed={dimmed || undefined}
                data-peak={isPeak || undefined}
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
