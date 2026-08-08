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

/** Named genres that get a categorical hue of their own. Ranks past this
 *  fold into a chart's own "Other genres" band ({@link FOLD_COLOR}). */
export const GENRE_SLOT_COUNT = 6;

/** The fold band ("Other genres") — the muted neutral, deliberately outside
 *  the categorical order so it never impersonates a real genre. */
export const FOLD_COLOR = "var(--chart-cat-other)";

/** The literal `"Other"` genre's own hue — slot 7 (violet), added to
 *  tokens.css by this story so the 6 named slots stay whole. It used to
 *  borrow slot 6, which AC-2 needs for the sixth named genre. */
export const CATCH_ALL_COLOR = "var(--chart-cat-7)";

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
