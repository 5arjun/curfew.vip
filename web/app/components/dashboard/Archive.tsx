"use client";

import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { SetRecord } from "@/lib/sets";
import type { SearchItem } from "@/lib/sets/search";
import { CommandPalette } from "./CommandPalette";
import { SetList } from "./SetList";
import { useSeenSets } from "./useSeenSets";

// The archive (Story 3.6 redesign) — the lighter register below the hero: a
// header row (label + collection count + the ⌘K search affordance) over the
// remaining sets. Owns the palette open-state and the global ⌘K shortcut. The
// count spans the WHOLE collection (search covers the hero too); the list shows
// the non-hero remainder.
export interface ArchiveProps {
  /** Every set, for the collection count + unopened tally + search. */
  allSets: SetRecord[];
  /** The non-hero remainder, rendered as cards. */
  sets: SetRecord[];
  searchItems: SearchItem[];
}

export function Archive({ allSets, sets, searchItems }: ArchiveProps) {
  const [open, setOpen] = useState(false);
  const { hydrated, isSeen } = useSeenSets();

  const total = allSets.length;
  const unopened = hydrated ? allSets.filter((s) => !isSeen(s.external_id)).length : 0;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <section className="archive" aria-labelledby="archive-heading">
      <div className="archive-head">
        <div className="archive-head-left">
          <h2 id="archive-heading" className="text-label-sm archive-title">
            THE ARCHIVE
          </h2>
          <p className="archive-count text-label-sm">
            {total} {total === 1 ? "SET" : "SETS"}
            {hydrated && unopened > 0 && <span className="archive-count-new"> · {unopened} UNOPENED</span>}
          </p>
        </div>

        <button type="button" className="archive-search" onClick={() => setOpen(true)}>
          <Search size={15} strokeWidth={1.75} aria-hidden="true" />
          <span>Search</span>
          <kbd className="archive-search-kbd" aria-hidden="true">
            ⌘K
          </kbd>
        </button>
      </div>

      {sets.length > 0 ? (
        <SetList sets={sets} />
      ) : (
        <p className="archive-empty text-body-md">
          This is the only night on file so far — the rest of the archive fills in on its own as you play.
        </p>
      )}

      <CommandPalette open={open} onClose={() => setOpen(false)} items={searchItems} />
    </section>
  );
}
