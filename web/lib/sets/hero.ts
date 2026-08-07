// Hero selection for the redesigned dashboard (Story 3.6 redesign). Pure +
// deterministic; builds ON the frozen data seam (never mutates it). The feature
// hero is the most recent SUBSTANTIAL set — a one-track soundcheck must never
// take the hero slot just because it was captured last. Everything else falls
// to the archive, order preserved (getRecentSets already sorts newest-first).
import type { SetRecord } from "./types";
import { MIN_PLAYS_FOR_DETECTION } from "./dancefloor";

// A set needs at least this many tracks to earn the hero. Shares dancefloor
// detection's MIN_PLAYS_FOR_DETECTION — below it there is no night to narrate.
export const HERO_MIN_TRACKS = MIN_PLAYS_FOR_DETECTION;

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
