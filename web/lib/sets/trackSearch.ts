// Track search (Story 4.10, AC-1/AC-2/AC-4/AC-13) — the compact index
// `/library-utilization`'s search field filters over, built once on the server
// from the two arrays that page already loads.
//
// **Search covers PLAYED ∪ OWNED (D-25, ruled 2026-08-10 by Arjun).** The
// epic's own scope boundary for Story 4.10 says this searches played tracks
// only and "the copy must not pretend otherwise" — written before the roster
// existed. Story 4.11 shipped `library_roster` on 2026-08-08 and its AC-9
// assigns the widening to this story explicitly, so the later shipped ruling
// governs. Every result carries which population it came from, because a track
// with no plays for the honest reason (never played) and a track with no plays
// for the dishonest one (played, but untagged) must not look alike.
//
// **Filtering is client-side over this server-built index (D-29).** The house
// pattern is `SetListPanel.tsx:76-90`: a lowercased haystack, every
// whitespace-split token must hit it, filtering in a `useMemo`. A server-side
// `ilike` would be a sequential scan — there is no index on `plays.title`,
// `plays.artist`, `library_roster.title` or `library_roster.artist`, and no
// `pg_trgm`, no `tsvector`, no `unaccent`, no `citext` anywhere in the 18
// migrations (the only extension any of them creates is `uuid-ossp`). Adding a
// GIN index would be a migration this story is scoped out of.
//
// **D-39 — rows are TUPLES, and the haystack is built in the browser. ⚑ RULED
// 2026-08-10 (Arjun).** D-29 as written ships one OBJECT per track carrying a
// precomputed `haystack`, and Task 3's stop-condition measured that at **498.9
// KB** serialized at seed scale (1,644 entries) against a ~150 KB bar. The
// content is only 92.5 KB of title+artist; the rest is per-entry JSON key names
// (~148 KB), the `haystack` duplicating title+artist (~222 KB) and a redundant
// `key`. Tuple rows with the haystack rebuilt client-side measure **157.2 KB**
// raw / 61.8 KB gzipped — with D-29's architecture untouched. The haystack is
// still built ONCE per index rather than per keystroke (it is a `useMemo` keyed
// on the rows array), so the property D-29 asks for holds; only the wire
// encoding changed. Measurements are in the story's Completion Notes.
//
// **AC-12 is why a row carries TWO count pairs, and why 157.2 KB is not 150.8
// KB.** The search results honor the same exclude-visibly contract as the rest
// of the page, so every row needs both its surviving figures and its
// whole-population ones — the reveal is a swap, never a recompute or a second
// read (D-13's discipline, and `LibraryUtilizationReveal`'s own contract). The
// two extra integers cost 6.4 KB across 1,644 rows, which is 4.8% over the
// nominal bar and stated here rather than rounded away. The alternative
// encodings were measured too: 8-tuple 157.2 KB, 6-tuple + a sparse override
// list for the 247 rows that actually differ 153.2 KB. The 4 KB the sparse form
// saves does not pay for a second indirection on every read.
import type { LibraryRosterEntry } from "./libraryRoster";
import type { UtilizationIndex } from "./libraryUtilization";

/**
 * One searchable track, as it crosses the wire.
 *
 * `[trackId, title, artist, playCount, setCount, addedAtMs, allPlayCount,
 * allSetCount]` — a tuple rather than an object, per D-39 above. Read through
 * the named indices below; do not destructure positionally at call sites, which
 * is how a ninth field gets inserted in the middle a year from now.
 */
export type TrackSearchRow = [
  /** `/track/[track_id]`'s identity, or `null` when the track has none (D-26). */
  trackId: string | null,
  title: string,
  /** `"Unknown"` when absent — never blank, never guessed (AD-11/FR-2). */
  artist: string,
  /** Plays in the SURVIVING population — the default view (AC-12). */
  playCount: number,
  /** Distinct surviving sets it appeared in. */
  setCount: number,
  /** When it entered the library, epoch ms, or `null` if unknown. */
  addedAtMs: number | null,
  /** Plays across EVERY set, including short/low-confidence ones — the revealed view. */
  allPlayCount: number,
  /** Distinct sets across every set. */
  allSetCount: number,
];

export const TS_TRACK_ID = 0;
export const TS_TITLE = 1;
export const TS_ARTIST = 2;
export const TS_PLAY_COUNT = 3;
export const TS_SET_COUNT = 4;
export const TS_ADDED_AT_MS = 5;
export const TS_ALL_PLAY_COUNT = 6;
export const TS_ALL_SET_COUNT = 7;

/**
 * Which population a row came from (AC-2), derived rather than carried.
 *
 * Keyed on `allPlayCount`, **never on `playCount`**, and the difference is a
 * bug rather than a preference: a track played only in soundchecks has a
 * surviving `playCount` of 0, and reading state off that field would relabel a
 * track the DJ HAS played as one they merely own — a false statement produced
 * by an exclusion, which is the precise thing AC-12 exists to prevent. Such a
 * row is instead absent from the default view and returns with the reveal
 * (see {@link visibleTrackSearchRows}).
 *
 * `allPlayCount > 0` **iff** the row came from the played half, by
 * construction: the played half is built from `UtilizationIndex.playsByKey`,
 * whose values are play counts and so are ≥1 for every key it holds, and the
 * owned half is only ever appended for roster entries with no played
 * counterpart. The invariant is pinned by a test rather than left to be
 * re-derived by the next reader.
 */
export function isOwned(row: TrackSearchRow): boolean {
  return row[TS_ALL_PLAY_COUNT] === 0;
}

/**
 * The rows a given population may show (AC-12).
 *
 * When `revealed`, everything. Otherwise everything except tracks whose entire
 * play history sits in short or low-confidence sets — those have nothing to say
 * in the surviving population, and rendering them at "0 plays" would be a
 * fabricated zero (D-8) attached to a track that has genuinely been played.
 * `LibraryUtilizationReveal` states the count that is hidden, so this is an
 * exclusion the DJ is told about rather than one they discover.
 */
export function visibleTrackSearchRows(
  rows: TrackSearchRow[],
  revealed: boolean,
): TrackSearchRow[] {
  if (revealed) return rows;
  return rows.filter((row) => isOwned(row) || row[TS_PLAY_COUNT] > 0);
}

/** Visible results before the `<details>` disclosure. */
export const TRACK_SEARCH_VISIBLE_ROWS = 8;

/**
 * The hard cap on rendered results.
 *
 * `EXPERIENCE.md:108` bans infinite scroll on track lists and names
 * "paginate / 'load more'" as the alternative, which `TrackRowList`'s native
 * `<details>` already is. This cap is about payload rather than affordance: a
 * one-character query matches most of a 1,644-track library, and rendering all
 * of it would put thousands of `<li>` in the DOM for a list nobody reads past
 * the top of — failure mode 11 on this epic's own list, where Story 4.9 emitted
 * ~2,360 `<li>` to display 12.
 *
 * **Stated, never silent** (Non-negotiable 5): {@link trackSearchCapDisclosure}
 * names the full match count and which end the shown rows come from.
 */
export const TRACK_SEARCH_MAX_ROWS = 25;

export interface TrackSearchIndex {
  /** Sorted ONCE here, so every consumer caps a list that is already ordered. */
  rows: TrackSearchRow[];
  /** Tracks in the played half. */
  playedCount: number;
  /** Tracks in the owned-but-never-played half. */
  ownedCount: number;
}

/**
 * Builds the search index from the play-side index and the DJ's roster.
 *
 * **Deduped on `track_id` across the two populations.** A track the DJ owns AND
 * has played is ONE result carrying its play count, not two rows saying
 * different things about the same record. The played half wins because it is
 * strictly more informative.
 *
 * The ~21% of played tracks with no `track_id` cannot be deduped against the
 * roster at all — there is no identity to match on — so a played artist-less
 * track and its roster counterpart would both appear if the roster row existed.
 * It cannot: a roster row without both tags is excluded upstream by the agent
 * (`capture::scan_identity_coverage`), which is the same AD-11 rule that left
 * the play without an id in the first place. Same cause, so no double row.
 *
 * **Ordering is fixed here, before any cap** (Non-negotiable 5): played tracks
 * first by play count, then owned tracks alphabetically, with title/artist
 * breaking every tie so the order is TOTAL and two identical requests cannot
 * disagree. Ordered, but never described in ranking words (`DESIGN.md:199`).
 */
export function buildTrackSearchIndex(
  surviving: UtilizationIndex,
  all: UtilizationIndex,
  roster: LibraryRosterEntry[],
): TrackSearchIndex {
  const played: TrackSearchRow[] = [];
  const playedIds = new Set<string>();

  // Walks the ALL index, not the surviving one: a track played only in
  // soundchecks is absent from the surviving index entirely, and iterating that
  // one would drop it from search rather than hide it revealably (AC-12).
  for (const [key, allPlayCount] of all.playsByKey) {
    const display = all.displayByKey.get(key);
    if (!display) continue;
    const trackId = all.trackIdByKey.get(key) ?? null;
    if (trackId) playedIds.add(trackId);
    played.push([
      trackId,
      display.title,
      display.artist,
      surviving.playsByKey.get(key) ?? 0,
      surviving.setsByTrack.get(key)?.size ?? 0,
      null,
      allPlayCount,
      all.setsByTrack.get(key)?.size ?? 0,
    ]);
  }

  const owned: TrackSearchRow[] = [];
  for (const entry of roster) {
    if (playedIds.has(entry.track_id)) continue;
    const title = present(entry.title);
    // A roster row with no title has nothing to search on and nothing to
    // render — the same judgement `buildUtilizationIndex` makes about a play
    // with no title, and for the same reason: inventing one would merge every
    // such row into a single phantom track. Unreachable on real data (the agent
    // excludes untitled rows upstream); guarded rather than assumed.
    if (title === null) continue;
    const addedAtMs = entry.added_at ? new Date(entry.added_at).getTime() : NaN;
    owned.push([
      entry.track_id,
      title,
      present(entry.artist) ?? "Unknown",
      0,
      0,
      Number.isNaN(addedAtMs) ? null : addedAtMs,
      0,
      0,
    ]);
  }

  // Ordered on the WHOLE-population counts so the order does not reshuffle
  // under the reveal — a list that reorders when a disclosure is opened makes
  // the DJ re-find the row they were reading.
  played.sort(
    (a, b) =>
      b[TS_ALL_PLAY_COUNT] - a[TS_ALL_PLAY_COUNT] ||
      b[TS_ALL_SET_COUNT] - a[TS_ALL_SET_COUNT] ||
      a[TS_TITLE].localeCompare(b[TS_TITLE]) ||
      a[TS_ARTIST].localeCompare(b[TS_ARTIST]),
  );
  owned.sort(
    (a, b) => a[TS_TITLE].localeCompare(b[TS_TITLE]) || a[TS_ARTIST].localeCompare(b[TS_ARTIST]),
  );

  return { rows: [...played, ...owned], playedCount: played.length, ownedCount: owned.length };
}

/**
 * A non-blank string, or `null` — `.trim()`, not `!= null` (Non-negotiable 9).
 *
 * `""` passes every `== null` guard in this codebase and has already shipped one
 * phantom-track bug (Story 4.9). Applied at THIS story's call sites rather than
 * inside `trackKey`, which trims nothing and case-folds nothing: changing that
 * function would silently re-partition Story 4.9's five shipped metrics.
 */
function present(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The lowercased haystacks, in row order — built in the browser per D-39, once
 * per index rather than once per keystroke.
 *
 * Exported (rather than inlined in the component) so the token-matching
 * contract is unit-testable without a DOM, which is this repo's whole testing
 * convention: pure functions in `lib/sets/*` carry the logic.
 */
export function trackSearchHaystacks(rows: TrackSearchRow[]): string[] {
  return rows.map((row) => `${row[TS_TITLE]} ${row[TS_ARTIST]}`.toLowerCase());
}

/**
 * Every row whose haystack contains **all** the query's whitespace-split
 * tokens, in the index's own order — mirroring `SetListPanel.tsx:76-90` exactly.
 *
 * An empty or whitespace-only query matches nothing rather than everything: the
 * results list is a response to a question, and rendering the DJ's whole library
 * under an empty field answers one nobody asked.
 */
export function filterTrackSearchRows(
  rows: TrackSearchRow[],
  haystacks: string[],
  query: string,
): TrackSearchRow[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  return rows.filter((_, i) => tokens.every((token) => haystacks[i].includes(token)));
}

/**
 * AC-13's gate: Curfew knows of no track at all, in either population.
 *
 * **The gate and its copy describe the same quantity** — searchable tracks —
 * which is the rule Story 4.5's review produced after a gate counting *adds*
 * shipped beside copy telling the DJ to go *play*. See
 * `TrackSearch.tsx`'s `TRACK_SEARCH_INSUFFICIENT_COPY`.
 */
export function hasSearchableTracks(index: TrackSearchIndex): boolean {
  return index.rows.length > 0;
}

/**
 * The cap disclosure — stated only when the cap actually bites, and naming both
 * the full match count and WHICH END the shown rows come from (Non-negotiable
 * 5). Ordered, but with no ranking vocabulary (`DESIGN.md:199`).
 */
export function trackSearchCapDisclosure(matchCount: number): string | null {
  if (matchCount <= TRACK_SEARCH_MAX_ROWS) return null;
  return `Showing ${TRACK_SEARCH_MAX_ROWS} of ${matchCount} matches — tracks you've played come first, by play count, then the rest of your library.`;
}

/**
 * The status line when a query returns no VISIBLE rows (Non-negotiable 4;
 * Story 4.7's R-2 shape).
 *
 * `matchCount` and `visibleCount` come from the same `(matches, revealed)`
 * pair `SearchResults` already has: `matches` is every haystack hit,
 * `visibleCount` is what survives the page's short/low-confidence reveal.
 * These can diverge — a query can hit a soundcheck-only track that
 * `visibleTrackSearchRows` filters out — and "no match" is a different, false
 * claim from "a match exists but is hidden": the first says Curfew has never
 * seen the track, the second says the DJ's own reveal is closed. Conflating
 * them is exactly the silently-collapsed-to-zero failure Non-negotiable 4
 * exists to prevent. `null` when there IS a visible row — the caller renders
 * the match count instead.
 */
export function trackSearchNoMatchCopy(matchCount: number, visibleCount: number): string | null {
  if (visibleCount > 0) return null;
  if (matchCount === 0) {
    return "No track here matches that — Curfew has no play and no library entry under that name.";
  }
  const noun = matchCount === 1 ? "track matches" : "tracks match";
  const pronoun = matchCount === 1 ? "it" : "them";
  return `${matchCount} ${noun} that, but only in short or low-confidence sets — reveal to see ${pronoun}.`;
}
