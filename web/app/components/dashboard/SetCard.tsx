"use client";

import Link from "next/link";
import { useMemo, type CSSProperties } from "react";
import type { SetRecord } from "@/lib/sets";
import { detectDancefloor, segmentStats } from "@/lib/sets/dancefloor";
import { formatDuration, formatSessionLabel, formatSetDate, formatTrackCount, topGenres } from "@/lib/sets/format";
import { EnergyArc } from "./EnergyArc";

// Archive row (Story 3.6 redesign) — the lighter register below the hero. A
// full-width editorial row: mono date + session-id (or the passive NEW marker)
// on the left, the energy-arc thumbnail through the middle, dominant genre +
// dancefloor-scoped length/track count on the right. The whole row links to
// /set/[external_id]; the glance is here, the depth is earned by the click
// (Set Detail, Story 3.7). Stats reflect the DETECTED DANCEFLOOR (AC-7), the
// same numbers the hero narrative uses.
export interface SetCardProps {
  set: SetRecord;
  /** 0-based position, for the staggered entrance delay only. */
  index: number;
  /** Unopened → passive NEW marker (AC-3). */
  isNew: boolean;
  /** Called on open, to clear the NEW marker before navigation. */
  onOpen: (externalId: string) => void;
}

export function SetCard({ set, index, isNew, onOpen }: SetCardProps) {
  const { segment, stats, genres } = useMemo(() => {
    const segment = detectDancefloor(set.plays);
    const stats = segmentStats(set.plays, segment);
    // Drop the catch-all "Other" bucket — it is not a meaningful genre label.
    const genres = topGenres(stats.genre_breakdown, 4).filter((g) => g.toLowerCase() !== "other").slice(0, 2);
    return { segment, stats, genres };
  }, [set]);

  const className = ["set-row", "set-row-enter", isNew ? "set-row--new" : ""].filter(Boolean).join(" ");

  return (
    <Link
      href={`/set/${set.external_id}`}
      className={className}
      style={{ ["--enter-delay"]: `${index * 40}ms` } as CSSProperties}
      onClick={() => onOpen(set.external_id)}
      aria-label={`${formatSessionLabel(set.external_id)}, ${formatSetDate(set.started_at)}${isNew ? ", new" : ""}`}
    >
      <div className="set-row-when">
        <span className="set-row-date text-mono-data">{formatSetDate(set.started_at)}</span>
        {isNew ? (
          <span className="set-row-new text-label-sm">
            <span className="set-row-new-dot" aria-hidden="true" />
            NEW SET DETECTED
          </span>
        ) : (
          <span className="set-row-session text-label-sm">{formatSessionLabel(set.external_id)}</span>
        )}
      </div>

      <div className="set-row-arc">
        <EnergyArc points={set.derived.energy_arc} segment={segment} />
      </div>

      <div className="set-row-genres text-label-sm">
        {genres.map((g) => (
          <span key={g} className="set-row-chip">
            {g}
          </span>
        ))}
      </div>

      <div className="set-row-tail text-mono-data">
        <span className="set-row-stats">
          {formatDuration(stats.set_length_sec)} · {formatTrackCount(stats.track_count)}
        </span>
        <span className="set-row-chevron" aria-hidden="true">
          →
        </span>
      </div>
    </Link>
  );
}
