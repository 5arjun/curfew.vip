// Right-column data (Story 3.6 v2, D5/D10): calendar day-marks, most-played
// track/artist over week/month windows, latest-set dancefloor confidence, and
// the lifetime archive odometer. Built server-side from the frozen seam into
// serialisable props; formatting follows the DJ's locale/timezone (format.ts).
import { playsInSegment, primaryDancefloorSegment } from "./dancefloor";
import { formatClock, formatDuration } from "./format";
import { isLowConfidenceSet, localDayKey } from "./listModel";
import type { SetRecord } from "./types";

export interface DayMarkSet {
  /** "10:14 PM" — the hover chip's per-set line (D10). */
  start: string;
  /** "2h 12m" */
  duration: string;
}

export interface DayMark {
  count: number;
  sets: DayMarkSet[];
  /** Total seconds across the day's sets — month-summary footer. */
  totalSec: number;
}

/** dayKey ("2026-06-21", local) → that day's sets. */
export type DayMarks = Record<string, DayMark>;

export interface MostPlayedEntry {
  title: string;
  artist: string;
  plays: number;
}

export interface MostPlayedArtistEntry {
  artist: string;
  plays: number;
}

export interface MostPlayedWindow {
  track: MostPlayedEntry | null;
  artist: MostPlayedArtistEntry | null;
  /** How many sets actually went in — `min(requested, sets available)`. The
   *  card labels its tabs from this, so a DJ with 8 sets total sees "8 sets"
   *  rather than a "25 sets" tab that overstates what it read. */
  setCount: number;
}

export interface RightColumnModel {
  marks: DayMarks;
  mostPlayed: { recent: MostPlayedWindow; extended: MostPlayedWindow };
  /** Latest set's dancefloor-detection confidence, 0–100, or null with no sets. */
  confidencePct: number | null;
  odometer: { sets: number; hours: number; tracks: number };
}

/**
 * Most-played counts the last N SETS, not a rolling calendar window.
 *
 * It used to be 7 and 30 days (2026-08-06, Arjun: "why isn't the most played
 * track and artist updating"). A calendar window silently empties out whenever
 * the DJ hasn't gigged lately: on 2026-08-06 the last real gig was 42 days
 * back, so both windows saw only a 4-play warm-up and a 1-play soundcheck —
 * the card crowned a track played exactly once, and adding 2,289 plays of real
 * history could not move it, because all of it fell outside the window. A gap
 * between bookings is normal and says nothing about what the DJ plays.
 * Counting sets means the card always reflects real recent playing.
 *
 * Counting SETS alone was not enough, though (code review 2026-08-06): the
 * window still filled with whatever was most recent, so a soundcheck and a
 * warm-up could hold the top slot just as firmly as a stale calendar window
 * had. Two further filters close it, both reusing rules this app already
 * owns rather than inventing a private definition of "real":
 *   1. the window is drawn from dancefloor sets only (`isLowConfidenceSet`,
 *      the same rule the set list hides by — spec §3g), and
 *   2. within each, only plays inside the dancefloor segment count
 *      (`primaryDancefloorSegment` + `playsInSegment`).
 * A track has to have actually filled a floor to win.
 */
// 10 and 30 (2026-08-06, Arjun). Raised from 5/25 once the dancefloor filters
// landed: scoping to floor time is the right correctness fix, but it also
// shrinks the pool every count is drawn from, and at 5 sets the "recent"
// window was crowning a track with 2 plays. A window has to be wide enough
// that repetition means something.
export const MOST_PLAYED_RECENT_SETS = 10;
export const MOST_PLAYED_EXTENDED_SETS = 30;

/** Sort key: undated sets sort last rather than poisoning the comparator with
 *  NaN (which would leave the order engine-dependent). */
function startMs(set: SetRecord): number {
  const t = set.started_at ? new Date(set.started_at).getTime() : NaN;
  return Number.isNaN(t) ? -Infinity : t;
}

function mostPlayedInRecentSets(newestFirst: SetRecord[], count: number): MostPlayedWindow {
  // Aggregated from raw plays across every set in the window (the per-set
  // derived rankings can't be merged rank-wise). CAP-5 discipline holds for
  // the artist row: artist-tagged plays only, no "Unknown" bucket.
  const trackCounts = new Map<string, MostPlayedEntry>();
  const artistCounts = new Map<string, MostPlayedArtistEntry>();
  const window = newestFirst.slice(0, count);

  for (const set of window) {
    // Only what was played ON THE FLOOR counts (2026-08-06, Arjun's code-review
    // ruling). Switching from a calendar window to a set window stopped the
    // card going stale between bookings, but it did not stop a warm-up or a
    // soundcheck from deciding the answer. Two filters do that: `window` is
    // already restricted to dancefloor sets by the caller, and each set is
    // scoped here to its detected segment, so tracks spun while the room was
    // still empty never enter the tally. A `null` segment is the honest
    // whole-set fallback — this set carries no dancefloor segment at all.
    //
    // Story 5.2: the segment is fetched off the set row now, not recomputed
    // here. When a set has several this still takes the longest — and as of
    // Story 5.4 that is no longer an "interim pick until a picker ships": the
    // picker HAS shipped (Set Detail's chip list), and this call site was left
    // on the single longest floor deliberately, because a cross-set tally has
    // no one per-set stat to disclose plurality beside.
    //
    // That is a narrowing, not a neutral choice, and it is tracked: every play
    // on a non-longest floor is excluded from this tally, so a wedding's
    // cocktail-hour floor never counts toward Most Played. 15 of 58 sample sets
    // carry several floors. Arjun's code-review ruling (2026-08-11) is to union
    // ALL dancefloor segments here; it is held only because it moves numbers on
    // a card already tuned twice and wants a before/after against seeded data.
    // See the story's Review Findings — do not "tidy" this comment away as
    // stale without doing the union.
    const floorPlays = playsInSegment(set.plays, primaryDancefloorSegment(set.segments));
    for (const play of floorPlays) {
      const title = play.title;
      const artist = play.artist;
      if (title != null) {
        const key = JSON.stringify([title, artist ?? ""]);
        const entry = trackCounts.get(key) ?? { title, artist: artist ?? "Unknown", plays: 0 };
        entry.plays += 1;
        trackCounts.set(key, entry);
      }
      if (artist != null) {
        const entry = artistCounts.get(artist) ?? { artist, plays: 0 };
        entry.plays += 1;
        artistCounts.set(artist, entry);
      }
    }
  }

  const top = <T extends { plays: number }>(m: Map<string, T>): T | null =>
    [...m.values()].sort((a, b) => b.plays - a.plays)[0] ?? null;

  return { track: top(trackCounts), artist: top(artistCounts), setCount: window.length };
}

export function buildRightColumn(sets: SetRecord[]): RightColumnModel {
  const marks: DayMarks = {};
  for (const set of sets) {
    const key = localDayKey(set.started_at);
    if (!key) continue;
    const mark = (marks[key] ??= { count: 0, sets: [], totalSec: 0 });
    mark.count += 1;
    mark.sets.push({
      start: formatClock(set.started_at),
      duration: formatDuration(set.derived.set_length_sec),
    });
    mark.totalSec += set.derived.set_length_sec ?? 0;
  }

  // Sorted here rather than trusting the caller's order: `getRecentSets()`
  // does hand us newest-first today, but "the last N sets" is only meaningful
  // against an explicit ordering, and an unsorted caller would otherwise pick
  // the wrong N silently instead of failing.
  // Compared, not subtracted: two undated sets both map to -Infinity, and
  // `-Infinity - (-Infinity)` is NaN — the exact engine-dependent ordering
  // `startMs`'s own doc comment says the sentinel exists to prevent.
  const newestFirst = [...sets].sort((a, b) => {
    const av = startMs(a);
    const bv = startMs(b);
    return av === bv ? 0 : bv > av ? 1 : -1;
  });

  // "The last 5 sets" means the last 5 sets that were actually GIGS — the same
  // `isLowConfidenceSet` rule the set list hides by (spec §3g), so the card and
  // the list beside it can no longer disagree about what counts. Filtering
  // before the slice (rather than dropping sets out of it) is what keeps the
  // window honest: a week of soundchecks used to consume all five slots and
  // leave the card describing rehearsals.
  const dancefloorSets = newestFirst.filter((s) => !isLowConfidenceSet(s));

  const latest = newestFirst[0] ?? null;
  const confidencePct = latest
    ? Math.round(Math.max(0, Math.min(1, latest.derived.confidence.value)) * 100)
    : null;

  const totalSec = sets.reduce((s, x) => s + (x.derived.set_length_sec ?? 0), 0);

  return {
    marks,
    mostPlayed: {
      recent: mostPlayedInRecentSets(dancefloorSets, MOST_PLAYED_RECENT_SETS),
      extended: mostPlayedInRecentSets(dancefloorSets, MOST_PLAYED_EXTENDED_SETS),
    },
    confidencePct,
    odometer: {
      sets: sets.length,
      hours: Math.round(totalSec / 3600),
      tracks: sets.reduce((s, x) => s + (x.derived.track_count ?? x.plays.length), 0),
    },
  };
}
