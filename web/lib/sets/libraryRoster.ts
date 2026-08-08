// Library roster (Story 4.11, AD-22) — names the tracks
// `library_track_events`/`buildLibraryConversion` can only count. Tier A
// only (title/artist); BPM/key/genre are Tier B, explicitly parked (see the
// story's Context & Authority section).
//
// Pure and deterministic over already-fetched records, same convention as
// every other module in this directory (`libraryConversion`, `hero`,
// `listModel`, `dancefloor`, `styleEvolution`).
//
// No consumer reads `entries` as a page yet (Story 4.10's search and Story
// 4.4's aging shelf are still `backlog`) — `getLibraryRoster` exists so
// those stories don't need their own agent/shared/cloud work when they
// land. `excludedNoIdentityCount` DOES have a consumer today: Story 4.3's
// conversion-rate meter, via `unidentifiableTracksDisclosure` below.

/**
 * One current-state library roster entry — mirrors `SyncLibraryRosterEntry`
 * in `@curfew/shared`. Unlike `LibraryAddEvent` (`libraryConversion.ts`),
 * this describes mutable current state: a re-tagged track's title/artist
 * are expected to change across reads for the same `track_id`.
 * `added_at`/`is_baseline` do not share that mutability — see AC-3.
 */
export interface LibraryRosterEntry {
  /** Opaque `fnv1a_hex` track identity (D-2) — joins to `SyncPlay.track_id`/`LibraryAddEvent.track_id`. */
  track_id: string;
  /** Raw, un-normalized song title. `null` only in a pathological fixture case — a real entry always has one (AD-11). */
  title: string | null;
  /** Raw, un-normalized artist. Same absence rule as `title`. */
  artist: string | null;
  /** ISO 8601, or `null` when no reachable catalogue covered the track (D-10). Fixed at first sighting — never moves on a re-tag (AC-3). */
  added_at: string | null;
  /** `true` for D-1's silent first-run baseline snapshot. MUST NEVER be read for conversion-rate cohort math — see `libraryConversion.ts`'s own denominator (`LibraryAddEvent`/`buildLibraryConversion`), a wholly separate concept. */
  is_baseline: boolean;
  /** ISO 8601, or `null` if the track is currently present in the DJ's library (Story 4.11 AC-5). A soft-delete marker, never a hard removal. */
  absent_at: string | null;
}

/**
 * Every synced roster entry for this DJ, plus the count of catalogue rows
 * this story's own AC-6 requires disclosing: tracks with no resolvable
 * title *or* artist at all, and therefore no identity to record under —
 * silently excluded from the roster (and, before this story, silently
 * shrinking Story 4.3's conversion-rate denominator with no disclosed
 * count). Measured against Arjun's real library (2026-08-07): 252 of 910
 * audio catalogue rows (27.7%; 20 video files excluded from both) — comfortably above the 5% materiality bar below, so this is surfaced, not silent.
 *
 * `excludedNoIdentityCount` is fixture-sourced today (see
 * `build-library-roster-fixture.mjs`'s own header for why), the same
 * fixture-backed-today convention every other stat in this directory
 * follows pending Story 4.6's Supabase read-path swap — but unlike
 * `entries`, this scalar does not yet have a designed cloud-sync carrier:
 * `library_roster` is a per-track table (wrong shape for a scan-level
 * aggregate) and `agent_status`'s heartbeat (AD-20) is explicitly
 * documented as carrying no derived Serato data. Reaching a live value
 * requires a deliberate, named decision (extend AD-22's RPC with an
 * optional scan-level scalar column, or a new dedicated small table+RPC),
 * not a default assumed here — flagged, not silently worked around.
 */
export interface LibraryRosterSnapshot {
  entries: LibraryRosterEntry[];
  excludedNoIdentityCount: number;
  /** Total catalogue rows the scan that produced `excludedNoIdentityCount` actually saw (before dedup/exclusion) — the denominator {@link unidentifiableTracksDisclosure} rates the exclusion count against. */
  totalCatalogueRows: number;
}

/**
 * The **rate** (not a count) at or above which an exclusion is worth
 * disclosing. Below it, a handful of rows in a large library is not
 * manufactured into a caveat nobody needed.
 *
 * 5% is a **new product threshold set here**, not one inherited from Story 4.3
 * — that story's review treated one observed value (~21% of real plays losing
 * `track_id`) as material, which establishes that 21% clears the bar, not where
 * the bar sits. Corrected in Story 4.11's code review, which found this
 * docstring, `EXPERIENCE.md`, and this module's header each implying a
 * different number.
 */
const MATERIAL_EXCLUSION_THRESHOLD = 0.05;

/**
 * The unidentifiable-tracks disclosure (Story 4.11 AC-6) — surfaced wherever a
 * conversion/roster number appears, per AC-6's own text.  Returns `null` when
 * there is genuinely nothing to disclose, or when the rate is below the
 * materiality bar, matching `undatedDisclosure`'s own "never manufacture a
 * caveat that isn't earned" discipline.
 *
 * **Scope is stated explicitly in the copy (Story 4.11 code review).** This
 * count is whole-library, but it renders beneath a *windowed* conversion meter
 * whose denominator is far smaller (38 at the 60-day default, 0 at 30 days on
 * real fixture data). The previous phrasing — "N **more** tracks … aren't
 * counted here at all" — read as an addition to that window's figure and
 * over-claimed by roughly an order of magnitude, worst of all at 30 days where
 * it followed "No tracks added in the last 30 days." with a large number.
 * Saying "across your whole library" makes the sentence true at every window
 * setting, and it no longer changes meaning when the window selector moves.
 *
 * `totalCatalogueRows` is the scan's audio-row count BEFORE exclusion
 * (`excludedNoIdentityCount` is a subset of it) — needed to compute a rate, not
 * just a raw count, since "252 tracks" reads very differently against a
 * 910-track library than a 20,000-track one. Video files are excluded from both
 * numbers upstream (`capture::is_audio_path`): they are not tracks and could
 * never convert.
 */
export function unidentifiableTracksDisclosure(
  excludedNoIdentityCount: number,
  totalCatalogueRows: number,
): string | null {
  if (excludedNoIdentityCount <= 0 || totalCatalogueRows <= 0) return null;
  const rate = excludedNoIdentityCount / totalCatalogueRows;
  if (rate < MATERIAL_EXCLUSION_THRESHOLD) return null;
  const one = excludedNoIdentityCount === 1;
  return `Across your whole library, ${excludedNoIdentityCount} ${
    one ? "track is" : "tracks are"
  } missing a title or artist tag — without both, ${
    one ? "it can't" : "they can't"
  } be identified, so ${one ? "it isn't" : "they aren't"} counted in any of these figures.`;
}
