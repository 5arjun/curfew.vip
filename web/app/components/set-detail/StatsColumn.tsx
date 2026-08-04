"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useMemo, useState } from "react";
import { formatBpm } from "@/lib/sets/format";
import {
  bpmSummary,
  formatPlayedLength,
  genreRanking,
  mixingStats,
  mostPlayedArtists,
  newTracks,
  replayedTracks,
  setShape,
  type NewTracksWindow,
} from "@/lib/sets/setDetail";
import type { SetRecord } from "@/lib/sets/types";
import { CursorChip, useCursorChipTarget } from "@/app/components/ui/CursorChip";
import type { Focus, OverlayKind, ScopeFrame } from "./model";
import { MetalRim } from "./MetalRim";
import { OverlayPanel } from "./Overlays";

// The right stats column (spec §3a-D/E, §3c) — every module is scope-reactive
// (reads `frame.plays`) and clickable (§3b): Genre/BPM/Harmonic/Artists open
// their drill-in overlay over THIS column only; Longest/Shortest and
// New-tracks focus the tracklist directly (AC-30). All disclosures are quiet
// and honest — denominators never silently shrink (AC-37).

/** LED pip count for the harmonic hero (UX-DR11: pips ARE the hero visual). */
const PIP_COUNT = 10;

export function StatsColumn({
  set,
  frame,
  focus,
  setFocus,
  overlay,
  setOverlay,
  newWindow,
  setNewWindow,
}: {
  set: SetRecord;
  frame: ScopeFrame;
  focus: Focus | null;
  setFocus: (focus: Focus | null) => void;
  overlay: OverlayKind;
  setOverlay: (overlay: OverlayKind) => void;
  newWindow: NewTracksWindow;
  setNewWindow: (w: NewTracksWindow) => void;
}) {
  const reduced = useReducedMotion();
  const plays = frame.plays;

  // Genre-row hover: the track count pops up on the shared CursorChip (the
  // calendar/nav treatment — post-review ruling).
  const chipTarget = useCursorChipTarget();
  const [hoverGenre, setHoverGenre] = useState<{ name: string; count: number; pct: number } | null>(
    null,
  );

  const harmonic = useMemo(() => mixingStats(plays), [plays]);
  const bpm = useMemo(() => bpmSummary(plays), [plays]);
  const genres = useMemo(() => genreRanking(plays), [plays]);
  const shape = useMemo(() => setShape(plays), [plays]);
  const fresh = useMemo(
    () => newTracks(plays, set.started_at, newWindow),
    [plays, set.started_at, newWindow],
  );
  const artists = useMemo(() => mostPlayedArtists(plays), [plays]);
  const replays = useMemo(() => replayedTracks(plays), [plays]);

  const keyedTransitions = harmonic.compatible_transitions + harmonic.incompatible_transitions;
  const smoothPct =
    keyedTransitions > 0
      ? Math.round((harmonic.compatible_transitions / keyedTransitions) * 100)
      : null;
  const litPips = smoothPct == null ? 0 : Math.round((smoothPct / 100) * PIP_COUNT);

  // Conditional renders (AC-13, §3f): no concentration → no most-played story;
  // fewer than 2 DISTINCT measured plays → no real longest/shortest
  // comparison to tell (one captured duration can't be both extremes).
  const showArtists = artists.some((a) => a.count >= 2);
  const showShape =
    shape.longest != null && shape.shortest != null && shape.longest.position !== shape.shortest.position;

  const bpmSparkline = useMemo(() => {
    const values = plays
      .map((p) => p.bpm)
      .filter((b): b is number => b != null);
    if (values.length < 2) return null;
    const min = Math.min(...values);
    const span = Math.max(...values) - min || 1;
    const w = 100;
    const h = 24;
    return values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * w;
        const y = h - 3 - ((v - min) / span) * (h - 6);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [plays]);

  return (
    <div className="sd-stats" data-overlay-open={overlay != null || undefined}>
      <div className="sd-stats-stack" aria-hidden={overlay != null} inert={overlay != null || undefined}>
        {/* D — headline module: harmonic hero + BPM, hairline-divided. */}
        <section className="sd-module dz-shell">
          <span className="dz-dots" aria-hidden="true" />
          <button
            type="button"
            className="sd-stat sd-stat-harmonic"
            onClick={() => setOverlay("harmonic")}
            aria-label="Harmonic mixing — open transition detail"
          >
            <p className="sd-stat-label">In key</p>
            {keyedTransitions > 0 ? (
              <>
                <div className="sd-pips" aria-hidden="true">
                  {Array.from({ length: PIP_COUNT }, (_, i) => (
                    <span key={i} className="sd-pip" data-lit={i < litPips || undefined} />
                  ))}
                </div>
                <p className="sd-stat-readout">
                  <span className="sd-stat-value">{smoothPct}%</span> in-key transitions
                </p>
              </>
            ) : plays.length < 2 ? (
              <p className="sd-stat-empty">Not enough tracks</p>
            ) : (
              <p className="sd-stat-empty">No key data</p>
            )}
            {harmonic.excluded_no_key > 0 && (
              <p className="sd-disclosure">{harmonic.excluded_no_key} unanalyzed</p>
            )}
          </button>

          <button
            type="button"
            className="sd-stat sd-stat-bpm"
            onClick={() => setOverlay("bpm")}
            aria-label="Tempo — open BPM histogram"
          >
            <p className="sd-stat-label">Tempo</p>
            {bpm.count > 0 ? (
              <div className="sd-bpm-row">
                <p className="sd-stat-readout">
                  <span className="sd-stat-value">
                    {formatBpm(bpm.min)}–{formatBpm(bpm.max)}
                  </span>{" "}
                  · median {formatBpm(bpm.median)}
                </p>
                {bpmSparkline && (
                  <svg className="sd-bpm-spark" viewBox="0 0 100 24" aria-hidden="true">
                    <polyline points={bpmSparkline} />
                  </svg>
                )}
              </div>
            ) : (
              <p className="sd-stat-empty">No tempo data</p>
            )}
            {bpm.count > 0 && bpm.count < plays.length && (
              <p className="sd-disclosure">{plays.length - bpm.count} unanalyzed</p>
            )}
          </button>
        </section>

        {/* Genre module — top 3, honest no-genre (AC-12). */}
        <section className="sd-module dz-shell">
          <span className="dz-dots" aria-hidden="true" />
          <button
            type="button"
            className="sd-stat sd-stat-genre"
            onClick={() => setOverlay("genre")}
            aria-label="Genres — open full breakdown"
          >
            <p className="sd-stat-label">Genres</p>
            {genres.buckets.length > 0 ? (
              <ul className="sd-genre-rows">
                {genres.buckets.slice(0, 3).map((b) => (
                  // AC-12 + post-review: spring hover, and the track count
                  // pops up on the cursor chip instead of sitting inline.
                  <motion.li
                    key={b.name}
                    className="sd-genre-row"
                    whileHover={reduced ? undefined : { scale: 1.02 }}
                    transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                    onMouseEnter={(e) => {
                      chipTarget.current = { x: e.clientX, y: e.clientY };
                      setHoverGenre({ name: b.name, count: b.count, pct: b.pct });
                    }}
                    onMouseMove={(e) => {
                      chipTarget.current = { x: e.clientX, y: e.clientY };
                    }}
                    onMouseLeave={() => setHoverGenre(null)}
                  >
                    <span className="sd-genre-name">{b.name}</span>
                    <span className="sd-genre-meta">{b.pct}%</span>
                  </motion.li>
                ))}
              </ul>
            ) : (
              <p className="sd-stat-empty">No genre data</p>
            )}
            {genres.noGenreCount > 0 && (
              <p className="sd-disclosure">{genres.noGenreCount} untagged</p>
            )}
          </button>
        </section>

        {/* Set shape — Longest / Shortest Play, real captured durations (AC-14). */}
        {showShape && (
          <section className="sd-module dz-shell">
            <span className="dz-dots" aria-hidden="true" />
            <p className="sd-stat-label sd-module-label">Set shape</p>
            {([
              ["Longest Play", shape.longest],
              ["Shortest Play", shape.shortest],
            ] as const).map(([label, play]) =>
              play ? (
                <button
                  key={label}
                  type="button"
                  className="sd-shape-row"
                  onClick={() =>
                    setFocus({
                      key: `shape:${label}:${play.position}`,
                      label: play.title ?? label,
                      positions: [play.position],
                    })
                  }
                >
                  <span className="sd-shape-label">{label}</span>
                  <span className="sd-shape-track">
                    {play.title ?? "Unknown title"}
                    {play.artist ? ` · ${play.artist}` : ""}
                  </span>
                  <span className="sd-shape-length">{formatPlayedLength(play.played_ms)}</span>
                </button>
              ) : null,
            )}
            {shape.missingDuration > 0 && (
              <p className="sd-disclosure">{shape.missingDuration} without a captured length</p>
            )}
          </section>
        )}

        {/* New tracks played (AC-15) — direct focus, Week/Month on the module. */}
        <section className="sd-module dz-shell">
          <span className="dz-dots" aria-hidden="true" />
          <div className="sd-newtracks">
            <button
              type="button"
              className="sd-newtracks-readout"
              onClick={() =>
                fresh.positions.length > 0 &&
                setFocus({
                  key: `new:${newWindow}`,
                  label: `New this ${newWindow}`,
                  positions: fresh.positions,
                })
              }
            >
              <span className="sd-stat-label">New tracks played</span>
              <span className="sd-stat-readout">
                <span className="sd-stat-value">{fresh.newCount}</span> of {fresh.totalTracks}
              </span>
            </button>
            <MetalRim radius={12}>
              <div className="sd-mini-toggle" role="group" aria-label="New-tracks window">
                <button
                  type="button"
                  aria-pressed={newWindow === "week"}
                  onClick={() => setNewWindow("week")}
                >
                  Week
                </button>
                <button
                  type="button"
                  aria-pressed={newWindow === "month"}
                  onClick={() => setNewWindow("month")}
                >
                  Month
                </button>
              </div>
            </MetalRim>
          </div>
          {fresh.noDateCount > 0 && (
            <p className="sd-disclosure">{fresh.noDateCount} without an add-date</p>
          )}
        </section>

        {/* E — most-played artists, conditional (AC-13); Replayed is its own
            independent condition (any track count > 1) — it can appear with
            no artist concentration at all (e.g. a replay with a null/untagged
            artist), so it isn't gated behind `showArtists`. */}
        {(showArtists || replays.length > 0) && (
          <section className="sd-module dz-shell">
            <span className="dz-dots" aria-hidden="true" />
            {showArtists && (
              <>
                <button
                  type="button"
                  className="sd-module-head"
                  onClick={() => setOverlay("artists")}
                  aria-label="Most-played artists — open full list"
                >
                  <span className="sd-stat-label">Most-played artists</span>
                  <span className="sd-module-more" aria-hidden="true">
                    ›
                  </span>
                </button>
                <ul className="sd-artist-rows">
                  {artists
                    .filter((a) => a.count >= 2)
                    .slice(0, 3)
                    .map((a) => (
                      <li key={a.artist}>
                        <button
                          type="button"
                          className="sd-artist-row"
                          data-active={focus?.key === `artist:${a.artist}` || undefined}
                          onClick={() =>
                            setFocus({
                              key: `artist:${a.artist}`,
                              label: a.artist,
                              positions: a.positions,
                            })
                          }
                        >
                          <span className="sd-artist-name">{a.artist}</span>
                          <span className="sd-artist-count">×{a.count}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              </>
            )}
            {replays.length > 0 && (
              <p className="sd-replayed">
                Replayed: {replays[0].title ?? "Unknown title"} ×{replays[0].count}
              </p>
            )}
          </section>
        )}

        {/* G — reserved for Story 5.5 enrichment (AC-16). */}
        <section className="sd-module sd-module-reserved" aria-hidden="true">
          <p className="sd-reserved-copy">Venue · crowd · notes — coming with enrichment</p>
        </section>
      </div>

      <AnimatePresence>
        {overlay != null && (
          <OverlayPanel
            key={overlay}
            kind={overlay}
            frame={frame}
            focus={focus}
            setFocus={setFocus}
            onBack={() => setOverlay(null)}
          />
        )}
      </AnimatePresence>

      <CursorChip
        target={chipTarget}
        visible={hoverGenre != null}
        contentKey={hoverGenre ? `g-${hoverGenre.name}` : null}
      >
        {hoverGenre && (
          <>
            <p className="cursor-chip-title">{hoverGenre.name}</p>
            <p className="cursor-chip-line">
              {hoverGenre.count} {hoverGenre.count === 1 ? "track" : "tracks"} · {hoverGenre.pct}%
              of scope
            </p>
          </>
        )}
      </CursorChip>
    </div>
  );
}
