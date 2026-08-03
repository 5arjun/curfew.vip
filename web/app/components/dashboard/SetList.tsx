"use client";

import type { SetRecord } from "@/lib/sets";
import { SetCard } from "./SetCard";
import { useSeenSets } from "./useSeenSets";

// Client boundary that owns the per-set "seen" state (AC-3) for the whole list,
// so localStorage is read once, not once per card. The cards themselves are
// otherwise pure — dancefloor + stats recompute from plays[] inside each.
export function SetList({ sets }: { sets: SetRecord[] }) {
  const { hydrated, isSeen, markSeen } = useSeenSets();

  return (
    <ul className="archive-list" aria-label="Recent sets">
      {sets.map((set, index) => (
        <li key={set.external_id}>
          <SetCard
            set={set}
            index={index}
            // Only mark NEW after hydration, so an already-seen set never flashes
            // the marker on first paint.
            isNew={hydrated && !isSeen(set.external_id)}
            onOpen={markSeen}
          />
        </li>
      ))}
    </ul>
  );
}
