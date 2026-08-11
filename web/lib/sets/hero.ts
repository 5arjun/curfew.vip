// Hero selection for the redesigned dashboard (Story 3.6 redesign). Pure +
// deterministic; builds ON the frozen data seam (never mutates it). The feature
// hero is the most recent SUBSTANTIAL set — a one-track soundcheck must never
// take the hero slot just because it was captured last. Everything else falls
// to the archive, order preserved (getRecentSets already sorts newest-first).
import type { SetRecord } from "./types";

// A set needs at least this many tracks to earn the hero — below it there is no
// night to narrate.
//
// This used to be an alias of v0's `MIN_PLAYS_FOR_DETECTION`. Story 5.2 retired
// v0 detection from `web/` entirely (the detector is Rust now), and rather than
// reach across the seam for a number, the coupling is cut: this is a
// hero-*display* threshold and that is a *detection* floor. They happened to
// share a value; they were never the same decision, and either is now free to
// move without dragging the other. The Rust-side constant is
// `stats::segments::MIN_PLAYS_FOR_DETECTION`.
export const HERO_MIN_TRACKS = 6;

function trackCount(set: SetRecord): number {
  return set.derived.track_count ?? set.plays.length;
}

/**
 * Splits sets into the one feature hero + the archive remainder. The hero is
 * the first (newest) set clearing HERO_MIN_TRACKS; if none qualifies (e.g. only
 * soundchecks on file), the newest set heroes anyway so the screen is never
 * heroless when sets exist. Returns `{ hero: null, archive: [] }` for no sets.
 */
export function splitSets(sets: SetRecord[]): { hero: SetRecord | null; archive: SetRecord[] } {
  if (sets.length === 0) return { hero: null, archive: [] };
  const hero = sets.find((s) => trackCount(s) >= HERO_MIN_TRACKS) ?? sets[0];
  const archive = sets.filter((s) => s.external_id !== hero.external_id);
  return { hero, archive };
}
