"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { formatBpm } from "@/lib/sets/format";
import { useMediaQuery, usePrefersReducedMotion } from "@/app/components/ui/metal-hooks";
import {
  bpmHistogram,
  bpmSummary,
  genreRanking,
  mostPlayedArtists,
  parseCamelot,
  subgenreRanking,
  transitions,
} from "@/lib/sets/setDetail";
import type { Focus, OverlayKind, ScopeFrame } from "./model";
import { MetalRim } from "./MetalRim";

// The drill-in veil (spec §3b/§3h, post-review form — Arjun 2026-08-03): a
// fixed right-side panel over the full viewport height. A GRADUAL blur
// (strength ramping toward the right edge — the reactbits gradual-blur
// language, minus the scroll trigger) sits on top of everything beneath, the
// component's details render over it, and the whole veil slides in from the
// right. Back arrow top-left, STAYS open while row clicks highlight the
// tracklist live (DR-2, single-select, active row state); contents are
// scope-reactive. On mobile it presents as a bottom sheet instead (§3i).
//
// Contents: Genre (full ranking + genre⇄subgenre toggle), BPM (client-side
// histogram + band focus), Harmonic (transition list + clashes-only filter —
// the Camelot wheel graphic is 3.8's), Artists (full list).

const TITLES: Record<Exclude<OverlayKind, null>, string> = {
  genre: "Genres",
  bpm: "Tempo",
  harmonic: "Harmonic mixing",
  artists: "Most-played artists",
};

export function OverlayPanel({
  kind,
  frame,
  focus,
  setFocus,
  onBack,
}: {
  kind: Exclude<OverlayKind, null>;
  frame: ScopeFrame;
  focus: Focus | null;
  setFocus: (focus: Focus | null) => void;
  onBack: () => void;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  const reduced = usePrefersReducedMotion();
  const sheet = useMediaQuery("(max-width: 900px)");

  useEffect(() => {
    backRef.current?.focus();
  }, [kind]);

  // Restore focus to whatever opened the veil (a stat button) once it closes.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    return () => previouslyFocused?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onBack]);

  // Slide in from the right (desktop veil) / from the bottom (mobile sheet);
  // reduced motion cuts.
  const offscreen = sheet ? { x: 0, y: "100%" } : { x: "100%", y: 0 };
  const transition = reduced
    ? { duration: 0 }
    : { duration: 0.55, ease: [0.17, 1, 0.33, 1] as const };

  return createPortal(
    <motion.aside
      className="sd-veil"
      role="region"
      aria-label={`${TITLES[kind]} detail`}
      initial={offscreen}
      animate={{ x: 0, y: 0 }}
      exit={offscreen}
      transition={transition}
    >
      {/* The gradual blur: stacked backdrop-filters, each masked to a band so
          the strength ramps toward the right edge (set-detail.css). */}
      <div className="sd-veil-blur" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>

      <div className="sd-veil-content">
        <div className="sd-overlay-head">
          <MetalRim radius={11}>
            <button
              type="button"
              ref={backRef}
              className="sd-overlay-back"
              aria-label="Back to stats"
              onClick={onBack}
            >
              ←
            </button>
          </MetalRim>
          <p className="sd-overlay-title">{TITLES[kind]}</p>
        </div>

        <div className="sd-overlay-body">
          {kind === "genre" && <GenreOverlay frame={frame} focus={focus} setFocus={setFocus} />}
          {kind === "bpm" && <BpmOverlay frame={frame} focus={focus} setFocus={setFocus} />}
          {kind === "harmonic" && (
            <HarmonicOverlay frame={frame} focus={focus} setFocus={setFocus} />
          )}
          {kind === "artists" && <ArtistsOverlay frame={frame} focus={focus} setFocus={setFocus} />}
        </div>
      </div>
    </motion.aside>,
    document.body,
  );
}

/* ── Genre (AC-27) ───────────────────────────────────────────────────── */

function GenreOverlay({
  frame,
  focus,
  setFocus,
}: {
  frame: ScopeFrame;
  focus: Focus | null;
  setFocus: (focus: Focus | null) => void;
}) {
  const [level, setLevel] = useState<"genre" | "subgenre">("genre");
  const ranking = useMemo(
    () => (level === "genre" ? genreRanking(frame.plays) : subgenreRanking(frame.plays)),
    [frame.plays, level],
  );

  if (ranking.buckets.length === 0 && ranking.noGenreCount === 0) {
    return <p className="sd-overlay-empty">No genre data in this scope.</p>;
  }

  return (
    <>
      <MetalRim radius={12} className="sd-veil-toggle">
        <div className="sd-mini-toggle" role="group" aria-label="Ranking level">
          <button type="button" aria-pressed={level === "genre"} onClick={() => setLevel("genre")}>
            Genres
          </button>
          <button
            type="button"
            aria-pressed={level === "subgenre"}
            onClick={() => setLevel("subgenre")}
          >
            Subgenres
          </button>
        </div>
      </MetalRim>

      <ul className="sd-overlay-rows">
        {ranking.buckets.map((b) => {
          const key = `genre:${level}:${b.name}`;
          return (
            <li key={b.name}>
              <button
                type="button"
                className="sd-overlay-row"
                data-active={focus?.key === key || undefined}
                onClick={() => setFocus({ key, label: b.name, positions: b.positions })}
              >
                <span className="sd-overlay-row-name">
                  {b.name}
                  {b.parent && b.parent !== b.name && (
                    <span className="sd-overlay-row-parent"> · {b.parent}</span>
                  )}
                </span>
                <span className="sd-overlay-row-meta">
                  {b.pct}% · {b.count} {b.count === 1 ? "track" : "tracks"}
                </span>
              </button>
            </li>
          );
        })}
        {ranking.noGenreCount > 0 && (
          <li>
            <button
              type="button"
              className="sd-overlay-row sd-overlay-row-muted"
              data-active={focus?.key === `genre:${level}:none` || undefined}
              onClick={() =>
                setFocus({
                  key: `genre:${level}:none`,
                  label: "No genre",
                  positions: ranking.noGenrePositions,
                })
              }
            >
              <span className="sd-overlay-row-name">No genre</span>
              <span className="sd-overlay-row-meta">{ranking.noGenreCount}</span>
            </button>
          </li>
        )}
      </ul>
    </>
  );
}

/* ── BPM (AC-28) ─────────────────────────────────────────────────────── */

function BpmOverlay({
  frame,
  focus,
  setFocus,
}: {
  frame: ScopeFrame;
  focus: Focus | null;
  setFocus: (focus: Focus | null) => void;
}) {
  const bands = useMemo(() => bpmHistogram(frame.plays), [frame.plays]);
  const summary = useMemo(() => bpmSummary(frame.plays), [frame.plays]);
  const maxCount = Math.max(1, ...bands.map((b) => b.count));

  if (summary.count === 0) {
    return <p className="sd-overlay-empty">No tempo data in this scope.</p>;
  }

  return (
    <>
      <p className="sd-overlay-readout">
        {formatBpm(summary.min)}–{formatBpm(summary.max)} · mean {formatBpm(summary.mean)} · median{" "}
        {formatBpm(summary.median)}
      </p>
      <div className="sd-histogram" role="list" aria-label="BPM histogram, 4-BPM bands">
        {bands.map((b) => {
          const key = `bpm:${b.from}`;
          return (
            <button
              key={b.from}
              type="button"
              role="listitem"
              className="sd-histogram-band"
              data-active={focus?.key === key || undefined}
              disabled={b.count === 0}
              aria-label={`${b.from}–${b.to} BPM · ${b.count} tracks`}
              onClick={() =>
                setFocus({ key, label: `${b.from}–${b.to} BPM`, positions: b.positions })
              }
            >
              <span className="sd-histogram-tick">{b.from}</span>
              <span className="sd-histogram-track">
                <span
                  className="sd-histogram-bar"
                  style={{ inlineSize: `${Math.max(2, (b.count / maxCount) * 100)}%` }}
                />
              </span>
              <span className="sd-histogram-count">{b.count > 0 ? b.count : ""}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/* ── Harmonic (AC-29) ────────────────────────────────────────────────── */

/** A Camelot key code tinted with its own --camelot-* token (3.8 review round
 * 1 — the transition list previously rendered keys untinted). Built from the
 * PARSED key, same fallback discipline as the tracklist chips: a malformed
 * value stays neutral instead of referencing a nonexistent custom property. */
function KeyCode({ raw }: { raw: string | null }) {
  const parsed = raw ? parseCamelot(raw) : null;
  return (
    <span
      className="sd-key-code"
      style={
        parsed
          ? ({
              "--sd-key-color": `var(--camelot-${parsed.number}${parsed.letter.toLowerCase()})`,
            } as CSSProperties)
          : undefined
      }
    >
      {raw ?? "—"}
    </span>
  );
}

function HarmonicOverlay({
  frame,
  focus,
  setFocus,
}: {
  frame: ScopeFrame;
  focus: Focus | null;
  setFocus: (focus: Focus | null) => void;
}) {
  const [clashesOnly, setClashesOnly] = useState(false);
  const all = useMemo(() => transitions(frame.plays), [frame.plays]);
  const listed = clashesOnly ? all.filter((t) => t.state === "clash") : all;

  if (all.length === 0) {
    return <p className="sd-overlay-empty">Not enough tracks for transitions.</p>;
  }

  return (
    <>
      <label className="sd-clashes-filter">
        <input
          type="checkbox"
          checked={clashesOnly}
          onChange={(e) => setClashesOnly(e.target.checked)}
        />
        Out-of-key only
      </label>

      <ul className="sd-overlay-rows">
        {listed.length === 0 && (
          <li className="sd-overlay-empty">No out-of-key transitions in this scope.</li>
        )}
        {listed.map((t) => {
          const key = `harmonic:${t.fromPosition}`;
          return (
            <li key={t.fromPosition}>
              <button
                type="button"
                className="sd-overlay-row sd-transition-row"
                data-state={t.state}
                data-active={focus?.key === key || undefined}
                onClick={() =>
                  setFocus({
                    key,
                    label: `${t.fromKey ?? "—"} → ${t.toKey ?? "—"}`,
                    positions: [t.fromPosition, t.toPosition],
                  })
                }
              >
                <span className="sd-overlay-row-name">
                  <KeyCode raw={t.fromKey} /> → <KeyCode raw={t.toKey} />
                </span>
                <span className="sd-overlay-row-meta">
                  {t.state === "smooth" ? "in key" : t.state === "clash" ? "out of key" : "no key"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* ── Artists (AC-30) ─────────────────────────────────────────────────── */

function ArtistsOverlay({
  frame,
  focus,
  setFocus,
}: {
  frame: ScopeFrame;
  focus: Focus | null;
  setFocus: (focus: Focus | null) => void;
}) {
  const artists = useMemo(() => mostPlayedArtists(frame.plays), [frame.plays]);

  if (artists.length === 0) {
    return <p className="sd-overlay-empty">No artist-tagged plays in this scope.</p>;
  }

  return (
    <ul className="sd-overlay-rows">
      {artists.map((a) => {
        const key = `artist:${a.artist}`;
        return (
          <li key={a.artist}>
            <button
              type="button"
              className="sd-overlay-row"
              data-active={focus?.key === key || undefined}
              onClick={() => setFocus({ key, label: a.artist, positions: a.positions })}
            >
              <span className="sd-overlay-row-name">{a.artist}</span>
              <span className="sd-overlay-row-meta">×{a.count}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
