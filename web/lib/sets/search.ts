// Search index + fuzzy matcher for the ⌘K spotlight (Story 3.6 redesign). Pure;
// built server-side from the frozen seam into a compact, serialisable shape so
// the client palette never ships all 178 plays per set. Searchable surface: the
// session id, the date, the tagged genres, and the top artists/track titles —
// the things a DJ would type to find a night.
import { formatSessionLabel, formatSetDate, topGenres, formatDuration, formatTrackCount } from "./format";
import type { SetRecord } from "./types";

export interface SearchItem {
  id: string;
  sessionLabel: string;
  dateLabel: string;
  /** Compact meta line for the result row, e.g. "5h 56m · 178 tracks · Hip-Hop". */
  meta: string;
  /** Lowercased haystack the matcher scans. */
  haystack: string;
}

function topArtists(set: SetRecord, max: number): string[] {
  return (set.derived.most_played_artists ?? []).slice(0, max).map((a) => a.artist);
}

function topTitles(set: SetRecord, max: number): string[] {
  return (set.derived.most_played_tracks ?? [])
    .map((t) => t.title)
    .filter((t): t is string => t != null)
    .slice(0, max);
}

/** Builds the compact, serialisable search index for the client palette. */
export function buildSearchItems(sets: SetRecord[]): SearchItem[] {
  return sets.map((set) => {
    const genres = topGenres(
      { buckets: set.derived.genre_breakdown?.buckets ?? [], no_genre_count: 0 },
      3,
    );
    const sessionLabel = formatSessionLabel(set.external_id);
    const dateLabel = formatSetDate(set.started_at);
    const trackCount = set.derived.track_count ?? set.plays.length;
    const len = set.derived.set_length_sec;
    // Drop the catch-all "Other" bucket from the visible meta (still searchable
    // in the haystack below).
    const displayGenre = genres.find((g) => g.toLowerCase() !== "other") ?? null;
    const metaBits = [
      typeof len === "number" ? formatDuration(len) : null,
      formatTrackCount(trackCount),
      displayGenre,
    ].filter(Boolean);
    const artists = topArtists(set, 5);
    const titles = topTitles(set, 5);
    const haystack = [sessionLabel, dateLabel, ...genres, ...artists, ...titles]
      .join(" ")
      .toLowerCase();
    return { id: set.external_id, sessionLabel, dateLabel, meta: metaBits.join(" · "), haystack };
  });
}

/**
 * Filters + ranks items for a query. Empty query returns all (recent order).
 * Every whitespace-separated token must appear somewhere in the haystack (AND
 * semantics); ranking rewards a session-id hit, then a haystack prefix, then
 * earliest match position — enough structure to feel intentional without a
 * dependency.
 */
export function filterItems(items: SearchItem[], query: string): SearchItem[] {
  const q = query.trim().toLowerCase();
  if (q === "") return items;
  const tokens = q.split(/\s+/);

  const scored: { item: SearchItem; score: number }[] = [];
  for (const item of items) {
    let ok = true;
    let score = 0;
    for (const token of tokens) {
      const idx = item.haystack.indexOf(token);
      if (idx === -1) {
        ok = false;
        break;
      }
      if (item.sessionLabel.toLowerCase().includes(token)) score += 100;
      if (item.haystack.startsWith(token)) score += 40;
      score += Math.max(0, 30 - idx);
    }
    if (ok) scored.push({ item, score });
  }

  return scored.sort((a, b) => b.score - a.score).map((s) => s.item);
}
