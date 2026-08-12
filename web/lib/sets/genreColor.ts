// Deterministic genre → color assignment (Story 4.8, Task 2 — resolves G-1).
//
// AC-3 forbids any assignment that reshuffles when the top-N set changes, and
// that is what `TrendChart` did before this module existed: it ranked genres
// within the CURRENT view and assigned `--chart-cat-{rank}` by rank index, so
// ticking the low-confidence reveal could recolor every genre on the page.
//
// The fix is one assignment, built ONCE per model from a view-independent
// input and shared by every genre visualization in the Genre section (the
// share stream AND the breakdown bars — "techno" must be the same color in
// both, four inches apart). The caller feeds it `month × including`: the
// superset partition, so neither the reveal (a subset of it) nor the
// granularity toggle (a re-partition of the identical dated-set population)
// can change the totals it ranks over. Same data → same colors, across
// buckets, toggles, and reloads.
import type { CategoryTally } from "./styleEvolution";

/** The taxonomy's own literal catch-all genre (genre.rs normalization) — a
 *  real, playable category, distinct from any chart's fold-the-rest band.
 *  The 2026-08-06 review protected that distinction; both keep separate
 *  names AND separate colors everywhere. */
export const CATCH_ALL_GENRE = "Other";

/** Named genres that hold a categorical hue of their own — the COLOR
 *  roster, deliberately one wider than any chart's band cap (the stream
 *  draws 6, the bars draw 5).
 *
 *  Code review 2026-08-08 (D-3) widened this 6 → 7. The roster is ranked
 *  over the superset partition while every chart draws the partition the DJ
 *  selected, so a rostered genre with no plays in THIS view used to leave
 *  its slot empty — the stream showed five bands and pushed the view's own
 *  sixth-biggest genre into the grey. One spare slot lets a chart backfill
 *  that vacancy with a genre that ALSO owns a permanent color, so nothing
 *  ever changes hue to make room (AC-3 is about color, not inclusion). */
export const GENRE_SLOT_COUNT = 7;

/** The fold band ("Other genres") — the muted neutral, deliberately outside
 *  the categorical order so it never impersonates a real genre. */
export const FOLD_COLOR = "var(--chart-cat-other)";

/**
 * The long-tail ramp (Arjun, 2026-08-12) — what a genre gets when the stream's
 * "show every genre" toggle breaks the fold band apart.
 *
 * A LIGHTNESS ramp in the fold neutral's own family, not more categorical
 * hues, and that is the whole design: the 8 slots above are a CVD-validated
 * set whose adjacent-ΔE guarantees do not survive being stretched to an
 * unbounded tail, and a 22nd-ranked genre should not read as loud as the
 * DJ's biggest. The tail is a family, and it looks like one. See the
 * `--chart-tail-*` block in tokens.css for the contrast validation.
 */
export const TAIL_COLORS = [
  "var(--chart-tail-1)",
  "var(--chart-tail-2)",
  "var(--chart-tail-3)",
  "var(--chart-tail-4)",
  "var(--chart-tail-5)",
  "var(--chart-tail-6)",
] as const;

/**
 * A tail genre's shade, by its rank within the tail.
 *
 * Cycles past the last step rather than clamping: with 30 tail genres,
 * clamping would paint 25 of them identically at the dark end, which reads as
 * one enormous band. A cycle at least keeps every NEIGHBOURING pair distinct,
 * which is the only adjacency a stacked stream actually shows — and the
 * legend names each band, so a shade reused six bands away is a shade, not a
 * claim that two genres are the same thing.
 */
export function tailColorFor(tailRank: number): string {
  return TAIL_COLORS[tailRank % TAIL_COLORS.length];
}

/** The literal `"Other"` genre's own hue — slot 8, added to tokens.css by
 *  this story so the named slots stay whole. It used to borrow slot 6, which
 *  AC-2 needs for a named genre; D-3 moved it 7 → 8 when the roster widened.
 *  It keeps a hue of its own because it is a real, playable category, NOT
 *  the fold band — a distinction the 2026-08-06 review protected. */
export const CATCH_ALL_COLOR = "var(--chart-cat-8)";

export interface GenreColorAssignment {
  /** Every named genre in the input (catch-all excluded), ranked by total
   *  play count descending, name ascending on ties — the one ordering every
   *  consumer selects its top-N from, so the stream's 6 and the bars' 5 are
   *  always a prefix of the same list. */
  ranked: string[];
  /** name → `var(--chart-cat-*)` for the top {@link GENRE_SLOT_COUNT} ranked
   *  genres plus the literal catch-all. Anything absent folds
   *  ({@link genreColorFor}). */
  colors: Record<string, string>;
}

/** Builds the assignment from per-bucket genre tallies. Pass the
 *  view-INDEPENDENT series (`model.month.including`, every bucket) — passing
 *  a view-dependent one reintroduces exactly the reshuffle AC-3 forbids. */
export function buildGenreColorAssignment(
  breakdowns: Array<{ breakdown: CategoryTally[] } | null | undefined>,
): GenreColorAssignment {
  const totals = new Map<string, number>();
  for (const b of breakdowns) {
    for (const t of b?.breakdown ?? []) {
      totals.set(t.name, (totals.get(t.name) ?? 0) + t.count);
    }
  }
  const ranked = [...totals.entries()]
    .filter(([name]) => name !== CATCH_ALL_GENRE)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([name]) => name);

  const colors: Record<string, string> = {};
  ranked.slice(0, GENRE_SLOT_COUNT).forEach((name, i) => {
    colors[name] = `var(--chart-cat-${i + 1})`;
  });
  if (totals.has(CATCH_ALL_GENRE)) colors[CATCH_ALL_GENRE] = CATCH_ALL_COLOR;

  return { ranked, colors };
}

/** The color for a genre name — its assigned slot, or the fold neutral for
 *  anything past the named slots (which every chart folds into its "Other
 *  genres" band anyway, so the neutral is what actually renders). */
export function genreColorFor(assignment: GenreColorAssignment, name: string): string {
  return assignment.colors[name] ?? FOLD_COLOR;
}

/**
 * Which rostered genres a chart draws, given what is actually in the view
 * (D-3, code review 2026-08-08). The ONE selection rule — the stream and the
 * bars call it with different caps (6 and 5, deliberately per G-3) but
 * identical logic, so the two charts in the Genre section can never name
 * contradictory sets.
 *
 * Two steps, and the order matters:
 *   1. **Choose** from the roster by count IN THIS VIEW, so a vacancy left by
 *      a rostered genre with no plays here is backfilled by the genre the DJ
 *      is actually looking at rather than silently swallowed by the fold.
 *   2. **Order** the chosen names by their GLOBAL rank, so the stack order is
 *      the same on every toggle and every visit. Selection may vary with the
 *      view; hue and sequence may not.
 *
 * @param viewTotals per-genre play counts within the current view (catch-all
 *   included or not — it is never rostered, so it cannot be selected here).
 */
export function selectGenreBands(
  assignment: GenreColorAssignment,
  viewTotals: Map<string, number>,
  cap: number,
): string[] {
  const roster = assignment.ranked.slice(0, GENRE_SLOT_COUNT);
  const rank = new Map(roster.map((name, i) => [name, i]));
  return roster
    .filter((name) => (viewTotals.get(name) ?? 0) > 0)
    .sort((a, b) => (viewTotals.get(b) ?? 0) - (viewTotals.get(a) ?? 0) || rank.get(a)! - rank.get(b)!)
    .slice(0, cap)
    .sort((a, b) => rank.get(a)! - rank.get(b)!);
}
