// Track detail (Story 4.10, AC-5..AC-12) — everything `/track/[track_id]`
// renders, computed from the two bounded reads `getTrackPlays`/`getMixNeighbours`
// return plus the DJ's roster entry for the track.
//
// Pure and deterministic over already-fetched records, the convention every
// module in this directory follows. `nowMs` is never read here — nothing on
// this page asks a question about *now*, which is the one thing that would
// otherwise make this suite machine-dependent (Story 4.1's review lesson).
//
// **Two rules from the story shape this whole file, and both are easy to
// undo by accident:**
//
// 1. **No formatted clock string is produced here (D-32).** `plays.started_at`
//    is `timestamptz`: the capture-side offset is normalized to UTC and lost,
//    and there is no venue timezone, no DJ timezone on `djs` and no set-level
//    offset anywhere in the system. Rendering an hour server-side renders it in
//    the SERVER's zone — wrong, and a hydration mismatch besides. So the model
//    ships `startedAtMs: number` and the browser formats it, in the viewer's
//    own zone, which is the only zone ever right for "what time of night do I
//    drop this" (the DJ plays where they live). `vitest.config.ts` pins
//    `TZ=UTC`, so a passing test here proves the EPOCH MATH and nothing about
//    the rendered hour — that is verified in the browser pass, not here.
//
// 2. **A missing value is a gap, never a fabricated zero (D-8).** Every model
//    below returns `null`/absent for "not enough data" rather than `0`, and
//    every exclusion is carried as a count that stays stated even when it
//    equals the whole population (Story 4.7 R-2, the single most-repeated
//    defect in this epic).
import { isLowConfidenceSet } from "./listModel";
import { formatSessionLabel } from "./format";
import type { LibraryRosterEntry } from "./libraryRoster";
import type { SetRecord, SyncPlay, SyncSetDerived } from "./types";

/* ═══════════════════════════════════════════════════════════════════════════
   The two read shapes
   ═══════════════════════════════════════════════════════════════════════════ */

/** One play of the track, plus the set it sat in. See `getTrackPlays`. */
export interface TrackPlayRecord {
  /** `sets.id` — the `/set/[id]` route key. */
  setId: string;
  /** Raw `sessions.session_identity` (e.g. `serato4:975`), or `null`. NEVER the uuid. */
  setLabel: string | null;
  setStartedAt: string | null;
  /** The set's render-cache blob — read only through {@link isLowConfidenceSet}. */
  setDerived: SyncSetDerived;
  /** The play itself, in the frozen wire shape (AD-15). */
  play: SyncPlay;
}

/**
 * One candidate neighbour row, in PostgREST's own snake_case — this is the
 * select's shape, not a model, and renaming it here would only hide which
 * columns the query actually asks for.
 */
export interface MixNeighbourRow {
  set_id: string;
  position: number;
  title: string | null;
  artist: string | null;
  track_id: string | null;
}

/** FR-2's convention for an absent tag: named, never blank and never guessed (AD-11). */
export const UNKNOWN = "Unknown";

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * A non-blank string, or `null`.
 *
 * `.trim()` and not merely `!= null` (Non-negotiable 9): `""` passes every
 * `== null` guard in this codebase and has already shipped one phantom-track
 * bug (Story 4.9). `plays.title`/`plays.artist` are bare nullable `text`
 * columns with no CHECK against `''`, so both the empty and the whitespace-only
 * forms are type-legal AND reachable. Measured 0 of each on the committed seed
 * — which makes this guard defensive today, and is exactly why it has to be
 * written rather than inferred from the data.
 */
function present(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** ms since epoch for an ISO timestamp, or `null` if missing/unparsable. */
function msOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/* ═══════════════════════════════════════════════════════════════════════════
   AC-12 — the same exclude-visibly contract as the rest of Epic 4 (D-34)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Rebuilds just enough of a {@link SetRecord} for {@link isLowConfidenceSet}.
 *
 * `plays: []` is safe because that array is read ONLY as the `track_count ??
 * plays.length` fallback, and `SyncSetDerived.confidence.track_count` is a
 * required `number` on the frozen contract (`shared/src/index.ts:205`) — 0 null
 * blobs across the committed seed's 58 sets. The seam has already dropped every
 * row whose `derived` is too incomplete to dereference, so the fallback is
 * unreachable here rather than merely unlikely.
 *
 * Reconstructing a record rather than reading `derived` directly is what keeps
 * this page on `listModel`'s ONE compound predicate (D-34). Three definitions of
 * "low confidence" exist in `web/` and they disagree; `styleEvolution.ts`'s bare
 * `< 1.0` would let a 2-3 track soundcheck through at a clean confidence 1.0,
 * which is precisely the play this page must not silently count.
 */
function asSetRecord(record: TrackPlayRecord): SetRecord {
  return {
    external_id: record.setId,
    started_at: record.setStartedAt as string,
    ended_at: record.setStartedAt as string,
    plays: [],
    derived: record.setDerived,
    session_label: record.setLabel,
  };
}

export interface TrackConfidencePartition {
  /** Plays every figure on the page is computed from, seam order preserved. */
  surviving: TrackPlayRecord[];
  /** Every play the predicate excluded — what the reveal swaps back in. */
  hidden: TrackPlayRecord[];
  /** DISTINCT sets hidden, not plays — the noun the reveal control uses. */
  hiddenSetCount: number;
}

/**
 * Splits a track's plays by the confidence of the set each sat in (AC-12).
 *
 * **`hiddenSetCount` counts SETS, not plays, and that is not interchangeable.**
 * `LibraryUtilizationReveal` renders "N short or low-confidence sets hidden";
 * handing it a play count would state the right number under the wrong noun —
 * the aria/visible drift failure this epic has now paid for five times.
 */
export function partitionTrackPlaysByConfidence(
  plays: TrackPlayRecord[],
): TrackConfidencePartition {
  const surviving: TrackPlayRecord[] = [];
  const hidden: TrackPlayRecord[] = [];
  // One verdict per SET, not per play: a set with four plays of this track must
  // be judged once, and counted once.
  const verdictBySet = new Map<string, boolean>();
  const hiddenSets = new Set<string>();

  for (const record of plays) {
    let low = verdictBySet.get(record.setId);
    if (low === undefined) {
      low = isLowConfidenceSet(asSetRecord(record));
      verdictBySet.set(record.setId, low);
    }
    if (low) {
      hidden.push(record);
      hiddenSets.add(record.setId);
    } else {
      surviving.push(record);
    }
  }

  return { surviving, hidden, hiddenSetCount: hiddenSets.size };
}

/* ═══════════════════════════════════════════════════════════════════════════
   AC-5 / AC-6 — identity and tags
   ═══════════════════════════════════════════════════════════════════════════ */

export interface TrackIdentity {
  /** Always a real string — `"Unknown"` rather than blank (FR-2/AD-11). */
  title: string;
  artist: string;
  /** Rounded whole BPM, or `null` when no play carried one. */
  bpm: number | null;
  camelotKey: string | null;
  /** The normalized genre, or `null`. Never collapsed with `subgenre` (AD-12). */
  genre: string | null;
  subgenre: string | null;
  /**
   * When the track entered the DJ's library, or `null` (AC-6).
   *
   * **Never defaulted to the first play.** "When did I get this" and "when did
   * I first play it" are different questions, and answering the first with the
   * second would be a guess wearing a fact's clothes.
   */
  libraryAddedAtMs: number | null;
  /** True when the DJ still owns the track per `library_roster` (D-38). */
  inRoster: boolean;
}

/**
 * The track's identity and tags (AC-5/AC-6), sourced from the play rows and
 * falling back to the roster entry for a track that has never been played.
 *
 * **Each field is taken from the most recent play that HAS it, independently.**
 * Tags are re-written in Serato over a track's life — a record ripped untagged
 * and genre-tagged later has plays on both sides of that edit — so taking the
 * newest play wholesale would show the newest play's *gaps* as the track's
 * gaps. Per-field is the only reading that answers "what is this track tagged
 * as" rather than "what was the tagging the last time I played it".
 *
 * `plays` must arrive OLDEST-FIRST, which is the order `getTrackPlays` asks the
 * database for. Walking forward and overwriting therefore leaves the newest
 * non-null value of each field standing.
 *
 * **Only these six facts exist in the cloud.** No album, no label, no year, no
 * file path (AD-2 keeps it off the wire permanently), no track duration (only
 * *played* duration), no artwork, no rating. `library_roster` carries no
 * bpm/key/genre at all — Tier B is explicitly parked (Spine :205) — so an
 * owned-but-never-played track has a title, an artist and an add date, and
 * that is the whole honest page.
 */
export function buildTrackIdentity(
  plays: TrackPlayRecord[],
  roster: LibraryRosterEntry | null,
): TrackIdentity {
  let title: string | null = null;
  let artist: string | null = null;
  let bpm: number | null = null;
  let camelotKey: string | null = null;
  let genre: string | null = null;
  let subgenre: string | null = null;
  let libraryAddedAtMs: number | null = null;

  for (const { play } of plays) {
    title = present(play.title) ?? title;
    artist = present(play.artist) ?? artist;
    // `> 0`, not `Number.isFinite`: a BPM of exactly 0 is corrupted data, not a
    // real reading — no track plays at 0 BPM — and treating it as one would
    // render a fabricated "0" where the D-8 convention elsewhere on this page
    // renders Unknown.
    if (typeof play.bpm === "number" && play.bpm > 0) bpm = Math.round(play.bpm);
    camelotKey = present(play.camelot_key) ?? camelotKey;
    // `genre_raw`/`genre_normalized`/`taxonomy_version`/`subgenre` are written
    // as ONE group by `sync_set` and never collapsed (AD-12) — so the genre and
    // its subgenre move together rather than each taking its own newest value,
    // which could pair a genre with a subgenre from a different taxonomy.
    const normalized = present(play.genre?.normalized);
    if (normalized) {
      genre = normalized;
      subgenre = present(play.genre?.subgenre) ?? null;
    }
    libraryAddedAtMs = msOf(play.library_added_at) ?? libraryAddedAtMs;
  }

  return {
    // The roster is the fallback, not the override: a played track's own rows
    // are the more specific answer, and the roster's title/artist are mutable
    // current state that a re-tag moves (`LibraryRosterEntry`'s own note).
    title: title ?? present(roster?.title) ?? UNKNOWN,
    artist: artist ?? present(roster?.artist) ?? UNKNOWN,
    bpm,
    camelotKey,
    genre,
    subgenre,
    libraryAddedAtMs: libraryAddedAtMs ?? msOf(roster?.added_at),
    inRoster: roster != null,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   AC-7 — play history and the sets it appeared in
   ═══════════════════════════════════════════════════════════════════════════ */

export interface TrackSetRow {
  /** `/set/[id]`'s route key. */
  setId: string;
  /** Display label via `formatSessionLabel`, or `"Untitled set"`. NEVER the raw uuid. */
  label: string;
  /** `null` for an undated set — rendered as a gap, never as a guessed date. */
  startedAtMs: number | null;
  /** How many times the track played in THIS set. Two spins in one night is a real answer. */
  playCount: number;
}

export interface TrackHistoryModel {
  /** Total plays in this population. `0` is a real answer for an owned-unplayed track. */
  timesPlayed: number;
  /** Epoch ms, or `null` when no play carried a parseable time (D-8, never `0`). */
  firstPlayedMs: number | null;
  lastPlayedMs: number | null;
  /** Distinct sets, most recent first; undated sets last. */
  sets: TrackSetRow[];
  /**
   * Plays whose set carried no parseable date — absent from first/last, present
   * in `timesPlayed` and in the set rows. Disclosed rather than dropped.
   */
  undatedPlayCount: number;
}

/**
 * AC-7 — times played, first and last play, and the distinct sets it appeared
 * in, as rows linking into `/set/[id]`.
 *
 * **The set rows are keyed on `setId`, never on the label.** Two `"Untitled
 * set"` rows are reachable (a set with no joined session), and keying React on
 * a display string collides them into one row — failure mode 8 on this epic's
 * own list. `setId` is `sets.id`, unique by construction.
 *
 * First/last read the PLAY's own `started_at`, not the set's: a set that
 * straddles midnight has plays on both sides of it, and the set's start is not
 * when this track played.
 */
export function buildTrackHistory(plays: TrackPlayRecord[]): TrackHistoryModel {
  let firstPlayedMs: number | null = null;
  let lastPlayedMs: number | null = null;
  let undatedPlayCount = 0;
  const bySet = new Map<string, TrackSetRow>();

  for (const record of plays) {
    const playedMs = msOf(record.play.started_at);
    if (playedMs === null) undatedPlayCount += 1;
    else {
      firstPlayedMs = firstPlayedMs === null ? playedMs : Math.min(firstPlayedMs, playedMs);
      lastPlayedMs = lastPlayedMs === null ? playedMs : Math.max(lastPlayedMs, playedMs);
    }

    const existing = bySet.get(record.setId);
    if (existing) existing.playCount += 1;
    else {
      bySet.set(record.setId, {
        setId: record.setId,
        // NEVER the raw `external_id`: post-4.6 that is a uuid, and rendering
        // it is the documented `SET 872d5614-…` regression.
        label: record.setLabel ? formatSessionLabel(record.setLabel) : "Untitled set",
        startedAtMs: msOf(record.setStartedAt),
        playCount: 1,
      });
    }
  }

  // Most recent first — the night you last reached for it is the one worth
  // opening. `setId` breaks ties so the order is TOTAL: a comparator returning
  // 0 leaves two identical requests free to render a different order, the same
  // defect `getRecentSets` documents. Undated sets sort last rather than
  // poisoning the comparator with `NaN`.
  const sets = [...bySet.values()].sort(
    (a, b) => (b.startedAtMs ?? -Infinity) - (a.startedAtMs ?? -Infinity) || a.setId.localeCompare(b.setId),
  );

  return { timesPlayed: plays.length, firstPlayedMs, lastPlayedMs, sets, undatedPlayCount };
}

/** AC-7's gate: this population holds at least one play to describe. */
export function hasPlayHistory(model: TrackHistoryModel): boolean {
  return model.timesPlayed > 0;
}

export function trackHistorySummary(model: TrackHistoryModel): string {
  // Branches on `hasPlayHistory`, the SAME predicate the visible state branches
  // on (Non-negotiable 2). A gate-blind summary falls back to naming the region
  // rather than stating a figure the visible UI withheld.
  if (!hasPlayHistory(model)) return "Play history";
  const n = model.timesPlayed;
  const s = model.sets.length;
  return (
    `Played ${n} ${plural(n, "time", "times")} across ${s} ${plural(s, "set", "sets")}.`
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   AC-8 — the clock-time strip (D-32)
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ClockStripModel {
  /**
   * Every play's start, in epoch ms, ascending. **Never a formatted hour**
   * (D-32) — the strip's hour labels and its text equivalent are both generated
   * in the browser from exactly these numbers, so the two cannot drift.
   */
  startedAtMs: number[];
  /** Plays with no parseable time — absent from the strip, disclosed as a count. */
  undatedPlayCount: number;
}

/**
 * AC-8's clock strip: what time of night the DJ drops this track.
 *
 * The model is deliberately almost empty. Everything that makes an hour an
 * *hour* — which day it falls on, which side of midnight, what to call it —
 * depends on a timezone this system does not store anywhere (GAP-3), and the
 * only correct one is the viewer's own. See this file's header for the full
 * argument; the short version is that a server-rendered hour is both wrong and
 * a hydration mismatch, and this epic already carries one unfixed instance.
 */
export function buildClockStrip(plays: TrackPlayRecord[]): ClockStripModel {
  const startedAtMs: number[] = [];
  let undatedPlayCount = 0;
  for (const record of plays) {
    const ms = msOf(record.play.started_at);
    if (ms === null) undatedPlayCount += 1;
    else startedAtMs.push(ms);
  }
  startedAtMs.sort((a, b) => a - b);
  return { startedAtMs, undatedPlayCount };
}

/* ═══════════════════════════════════════════════════════════════════════════
   AC-9 / AC-11 — ride time (D-33)
   ═══════════════════════════════════════════════════════════════════════════ */

export interface RideTimeModel {
  /**
   * The MEDIAN played duration in ms, or `null` when no play carried one —
   * never a fabricated `0` (D-8).
   */
  medianMs: number | null;
  /** How many plays the median was taken over. **Stated every time** (D-33). */
  n: number;
  /**
   * Plays excluded for carrying no `played_ms`. Disclosed as a count, and the
   * count does NOT collapse when every play is missing it — that case is
   * `n === 0` with `excludedCount === plays.length`, which is exactly when the
   * disclosure has the most to say (Story 4.7 R-2).
   */
  excludedCount: number;
}

/**
 * AC-9 — how long the DJ typically rides the track, as a **median with its n
 * stated** (D-33).
 *
 * **Median here, where Story 4.5 ruled mean for time-to-first-play, and the
 * divergence is deliberate.** That metric averages across a wide, skewed
 * population of different tracks, where a mean is the more trustworthy summary
 * of a whole library's behaviour. This one describes ONE track's own spins — a
 * tight distribution where the median describes the typical play and a single
 * 20-second false start does not drag it.
 *
 * **At `n === 1` there is no median**, and the UI must not say "typically" (see
 * {@link rideTimeSummary}): one observation is a fact about one night, not a
 * distribution (AC-11).
 *
 * Non-positive durations are excluded with the missing ones rather than counted
 * as fast spins: `played_ms` is a `bigint` with no CHECK, and a 0 would drag a
 * median toward a value no play actually had.
 */
export function buildRideTime(plays: TrackPlayRecord[]): RideTimeModel {
  const durations: number[] = [];
  let excludedCount = 0;

  for (const { play } of plays) {
    const ms = play.played_ms;
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) excludedCount += 1;
    else durations.push(ms);
  }

  if (durations.length === 0) return { medianMs: null, n: 0, excludedCount };

  durations.sort((a, b) => a - b);
  const mid = Math.floor(durations.length / 2);
  const medianMs =
    durations.length % 2 === 1 ? durations[mid] : Math.round((durations[mid - 1] + durations[mid]) / 2);

  return { medianMs, n: durations.length, excludedCount };
}

/** AC-9's gate: at least one play carried a usable duration. */
export function hasRideTime(model: RideTimeModel): boolean {
  return model.medianMs !== null && model.n > 0;
}

/**
 * A ride time, at the scale a ride time is actually read at — e.g. `"48s"`,
 * `"3m 05s"`, `"1h 04m 05s"`.
 *
 * **Neither `formatDuration` nor `formatElapsed` is right here, and both are
 * the obvious thing to reach for.** `formatDuration` is minutes-and-hours (a
 * whole set's length) and rounds a 3m42s spin to `"4m"`, throwing away the
 * seconds that distinguish a played record from a cut one. `formatElapsed`
 * measures the gap between two events and coarsens hard above a day — Story
 * 4.4 found its tiers made a sorted list read as broken. A ride time is
 * minutes-and-seconds, so it gets its own scale rather than a borrowed one.
 *
 * Seconds are zero-padded above a minute (`3m 05s`, not `3m 5s`) so a column of
 * them stays readable as a column.
 */
export function formatRideTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes === 0) return `${seconds}s`;
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (hours === 0) return `${minutes}m ${pad(seconds)}s`;
  return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
}

export function rideTimeSummary(model: RideTimeModel): string {
  if (!hasRideTime(model)) return "Ride time";
  const value = formatRideTime(model.medianMs as number);
  // AC-11's n=1 form. "Typically" claims a distribution, and one observation is
  // not one — so the word is absent, not merely qualified.
  if (model.n === 1) return `Played once, for ${value}.`;
  return `Typically ridden for ${value}, across ${model.n} plays.`;
}

/**
 * AC-9's excluded-count disclosure. `null` only when nothing was excluded —
 * never `"0 plays"`, and deliberately still stated when EVERY play was
 * excluded, which is the case Story 4.7's R-2 defect silently dropped.
 */
export function rideTimeDisclosure(model: RideTimeModel): string | null {
  const n = model.excludedCount;
  if (n === 0) return null;
  return `${n} ${plural(n, "play", "plays")} ${plural(n, "carries", "carry")} no duration, so ${plural(n, "it is", "they are")} not in this figure.`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   AC-10 — mix neighbours (D-31)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * How many of a track's sets the neighbour read asks about.
 *
 * Lives here rather than in the seam because BOTH sides need it: the seam
 * builds the query from these anchors, and the model has to rebuild the same
 * anchor set to know which returned rows are "before" and which are "after".
 * Two copies of the number would let the model look for pairs the query never
 * asked for.
 *
 * Step 2 of D-31 is a cross product, so S anchor sets yielding up to 2S
 * distinct positions can match up to `S × 2S` rows: at 20 that is at most 800,
 * under PostgREST's `max_rows` of 1000; at 500 it would be 500,000 and the
 * server would silently return the first 1000. The busiest track on the
 * committed seed appears in **10 sets**, so this bites for nobody today — and
 * it is disclosed rather than silent when it does ({@link mixNeighboursDisclosure}).
 */
export const MIX_NEIGHBOUR_SET_LIMIT = 20;

export interface NeighbourAnchor {
  setId: string;
  position: number;
}

/**
 * The `(set_id, position)` pairs the neighbour read is built from — the track's
 * plays, capped at {@link MIX_NEIGHBOUR_SET_LIMIT} distinct sets.
 *
 * **Built from ALL plays, not from the surviving population.** The detail page
 * prerenders both sides of AC-12's reveal, so the read has to cover the wider
 * of the two; `buildMixNeighbours` then narrows the returned rows per
 * population. One query serves both subtrees.
 *
 * Keeps the MOST RECENT sets when the cap bites, and says so — a cap that
 * silently kept an arbitrary end would make "what do I mix this with" an answer
 * about a random slice of the DJ's history.
 */
export function buildNeighbourAnchors(plays: TrackPlayRecord[]): NeighbourAnchor[] {
  // `plays` arrives oldest-first from the seam, so the most recent sets are at
  // the end — walked backwards to keep those when the cap bites.
  const keptSets = new Set<string>();
  const anchors: NeighbourAnchor[] = [];
  for (let i = plays.length - 1; i >= 0; i -= 1) {
    const record = plays[i];
    if (!keptSets.has(record.setId)) {
      if (keptSets.size >= MIX_NEIGHBOUR_SET_LIMIT) continue;
      keptSets.add(record.setId);
    }
    anchors.push({ setId: record.setId, position: record.play.position });
  }
  return anchors;
}

export interface MixNeighbourEntry {
  /** `"Unknown"` when the row carried no title — never blank (AD-11). */
  title: string;
  artist: string;
  /** `/track/[track_id]`, or `null` for a neighbour with no identity (D-26). */
  trackId: string | null;
  /** How many times this track sat on that side of it. The ordering key. */
  count: number;
}

export interface MixNeighboursModel {
  /** Played immediately before, ordered by recurrence. */
  before: MixNeighbourEntry[];
  /** Played immediately after, ordered by recurrence. */
  after: MixNeighbourEntry[];
  /** Distinct sets the neighbours were read from. */
  setCount: number;
  /** Sets left out by {@link MIX_NEIGHBOUR_SET_LIMIT}. Disclosed, never silent. */
  omittedSetCount: number;
}

/**
 * AC-10 — what was played immediately before and after this track, across all
 * its plays, **ordered by recurrence** (D-31).
 *
 * **Ordered by recurrence; never described in ranking words.** `DESIGN.md:199`
 * — *"no 'best,' 'winner,' or ranking language, ever."* The data may rank, the
 * words may not: these render as a plain list with a count, no row numbers, no
 * "top", no "most common".
 *
 * **Never crosses a set boundary.** Adjacency is `position ± 1` within one set,
 * and `plays` carries `unique (set_id, position)` 1-based, so this is a lookup
 * rather than a time comparison. The last track of one night is not the
 * neighbour of the first track of the next.
 *
 * **A neighbour that IS this track is a real answer, not a bug** — a record
 * played twice back to back genuinely follows itself, and filtering it out
 * would silently delete a thing the DJ did.
 *
 * Identity for grouping is `title + artist`, NOT `track_id` — the same reason
 * D-18 keys the play-side metrics that way: `track_id` is null for ~21% of real
 * plays, and grouping on it would silently drop every artist-less neighbour
 * from a list about what the DJ plays. `trackId` still rides along per entry so
 * the ones that HAVE an identity can link (D-26).
 */
export function buildMixNeighbours(
  plays: TrackPlayRecord[],
  rows: MixNeighbourRow[],
  allPlays: TrackPlayRecord[],
): MixNeighboursModel {
  const beforeWanted = new Set<string>();
  const afterWanted = new Set<string>();
  const setIds = new Set<string>();
  for (const record of plays) {
    setIds.add(record.setId);
    const position = record.play.position;
    // A pair can be BOTH — two plays of this track two positions apart in one
    // set make the row between them the "after" of the first and the "before"
    // of the second. Both are true, so both are counted.
    if (position - 1 >= 1) beforeWanted.add(`${record.setId}${position - 1}`);
    afterWanted.add(`${record.setId}${position + 1}`);
  }

  const before = new Map<string, MixNeighbourEntry>();
  const after = new Map<string, MixNeighbourEntry>();

  const add = (into: Map<string, MixNeighbourEntry>, row: MixNeighbourRow) => {
    const title = present(row.title) ?? UNKNOWN;
    const artist = present(row.artist) ?? UNKNOWN;
    // `JSON.stringify` rather than a joined string: a plain `title + " " +
    // artist` collides across a title/artist boundary shift ("Deep
    // Inside"/"Hardrive" vs "Deep"/"Inside Hardrive"), which is both a wrong
    // count and a duplicate React key.
    const key = JSON.stringify([title, artist]);
    const existing = into.get(key);
    if (existing) existing.count += 1;
    else into.set(key, { title, artist, trackId: present(row.track_id), count: 1 });
  };

  for (const row of rows) {
    const pair = `${row.set_id}${row.position}`;
    if (beforeWanted.has(pair)) add(before, row);
    if (afterWanted.has(pair)) add(after, row);
  }

  // Recurrence desc, then title/artist ascending so the order is TOTAL and two
  // identical requests cannot disagree.
  const ordered = (map: Map<string, MixNeighbourEntry>) =>
    [...map.values()].sort(
      (a, b) => b.count - a.count || a.title.localeCompare(b.title) || a.artist.localeCompare(b.artist),
    );

  // Measured against ALL plays, not this population: the cap is a property of
  // the read, which covered both sides of the reveal.
  const allSets = new Set(allPlays.map((record) => record.setId));

  return {
    before: ordered(before),
    after: ordered(after),
    setCount: setIds.size,
    omittedSetCount: Math.max(0, allSets.size - MIX_NEIGHBOUR_SET_LIMIT),
  };
}

/** AC-10's gate: at least one adjacent play was found on either side. */
export function hasMixNeighbours(model: MixNeighboursModel): boolean {
  return model.before.length > 0 || model.after.length > 0;
}

export function mixNeighboursSummary(model: MixNeighboursModel): string {
  if (!hasMixNeighbours(model)) return "Mix neighbours";
  const b = model.before.length;
  const a = model.after.length;
  return (
    `${b} ${plural(b, "track", "tracks")} ${plural(b, "has", "have")} come before it and ` +
    `${a} ${plural(a, "track", "tracks")} after it.`
  );
}

/** The neighbour read's own cap, stated only when it bites (Non-negotiable 5). */
export function mixNeighboursDisclosure(model: MixNeighboursModel): string | null {
  const n = model.omittedSetCount;
  if (n === 0) return null;
  return `Read from the ${MIX_NEIGHBOUR_SET_LIMIT} most recent sets this track appeared in; ${n} older ${plural(n, "set is", "sets are")} not included.`;
}
