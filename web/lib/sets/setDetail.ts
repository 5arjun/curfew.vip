// Set Detail scope engine + stat computation (Story 3.7 Task 3, AC-4..7,
// 10..15, 19, 20, 26..29).
//
// Everything here is pure and recomputed from `plays[]` — the D1 global scope
// switch works by feeding every consumer the same scoped slice, so the screen
// can never mix two frames. `derived` stays the whole-set default/cache; the
// client recompute must agree with it on the whole set (cross-checked in
// setDetail.test.ts against fixture set 975).
import type { DancefloorSegment } from "./dancefloor";
import type { SyncPlay } from "./types";

/** The D1 scope: the detected dancefloor window, or the whole night. */
export type Scope = "dancefloor" | "whole";

const EPOCH = (iso: string) => new Date(iso).getTime();

/**
 * The single scope filter every stat, the arc, and the tracklist annotations
 * read through (AC-5: one frame at a time). `dancefloor` without a detected
 * segment degrades to the whole set — the AC-36 fallback.
 */
export function scopedPlays(
  plays: SyncPlay[],
  segment: DancefloorSegment | null,
  scope: Scope,
): SyncPlay[] {
  if (scope === "whole" || !segment) return plays;
  const start = EPOCH(segment.start);
  const end = EPOCH(segment.end);
  return plays.filter((p) => {
    if (p.started_at == null) return false;
    const t = EPOCH(p.started_at);
    return t >= start && t <= end;
  });
}

/* ── Camelot rule — mirrors agent/src-tauri/src/stats/camelot.rs EXACTLY ──
   (AC-19: the in-key connectors and the harmonic hero must agree with the
   agent's `derived.camelot_mixing_stats` — same parse, same adjacency.) */

export interface CamelotKey {
  number: number;
  letter: "A" | "B";
}

/** Mirror of `camelot::parse`: `1`–`12` + `A`/`B`, case-insensitive, trimmed. */
export function parseCamelot(raw: string): CamelotKey | null {
  const trimmed = raw.trim();
  if (trimmed.length < 2) return null;
  const letterChar = trimmed[trimmed.length - 1];
  let letter: "A" | "B";
  if (letterChar === "A" || letterChar === "a") letter = "A";
  else if (letterChar === "B" || letterChar === "b") letter = "B";
  else return null;

  const numberPart = trimmed.slice(0, -1);
  // Mirror Rust's `str::parse::<u8>` strictness: digits only, no signs,
  // no whitespace, no decimal point.
  if (!/^[0-9]+$/.test(numberPart)) return null;
  const number = Number(numberPart);
  if (number < 1 || number > 12) return null;
  return { number, letter };
}

/** Mirror of `camelot::compatible`: identical, relative (same number, other
 * letter), or same-letter ±1 with 12↔1 wraparound. */
export function camelotCompatible(a: CamelotKey, b: CamelotKey): boolean {
  if (a.number === b.number && a.letter === b.letter) return true;
  if (a.number === b.number && a.letter !== b.letter) return true;
  if (a.letter === b.letter) {
    const diff = (((a.number - b.number) % 12) + 12) % 12; // rem_euclid
    return diff === 1 || diff === 11;
  }
  return false;
}

/** One consecutive-pair transition state (Q1): smooth / clash / no key. */
export type TransitionState = "smooth" | "clash" | "nokey";

export interface Transition {
  /** `position` of the play the transition leaves from / arrives at. */
  fromPosition: number;
  toPosition: number;
  fromKey: string | null;
  toKey: string | null;
  state: TransitionState;
}

/** Every consecutive-pair transition over `plays`, in play order (AC-29). */
export function transitions(plays: SyncPlay[]): Transition[] {
  const out: Transition[] = [];
  for (let i = 0; i < plays.length - 1; i++) {
    const a = plays[i];
    const b = plays[i + 1];
    const ka = a.camelot_key ? parseCamelot(a.camelot_key) : null;
    const kb = b.camelot_key ? parseCamelot(b.camelot_key) : null;
    const state: TransitionState =
      ka && kb ? (camelotCompatible(ka, kb) ? "smooth" : "clash") : "nokey";
    out.push({
      fromPosition: a.position,
      toPosition: b.position,
      fromKey: a.camelot_key ?? null,
      toKey: b.camelot_key ?? null,
      state,
    });
  }
  return out;
}

/** Mirror of `camelot::mixing_stats` — the three honest counts (AC-37). */
export interface MixingStats {
  compatible_transitions: number;
  incompatible_transitions: number;
  excluded_no_key: number;
}

export function mixingStats(plays: SyncPlay[]): MixingStats {
  const stats: MixingStats = {
    compatible_transitions: 0,
    incompatible_transitions: 0,
    excluded_no_key: 0,
  };
  for (const t of transitions(plays)) {
    if (t.state === "smooth") stats.compatible_transitions += 1;
    else if (t.state === "clash") stats.incompatible_transitions += 1;
    else stats.excluded_no_key += 1;
  }
  return stats;
}

/* ── BPM (AC-11, AC-28) ──────────────────────────────────────────────── */

/** Mirror of `stats::bpm_distribution` — count 0 ⇒ all-zero, never NaN. */
export interface BpmSummary {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
}

export function bpmSummary(plays: SyncPlay[]): BpmSummary {
  const values = plays
    .map((p) => p.bpm)
    .filter((b): b is number => b != null)
    .sort((a, b) => a - b);
  const count = values.length;
  if (count === 0) return { count: 0, min: 0, max: 0, mean: 0, median: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / count;
  const median =
    count % 2 === 1 ? values[(count - 1) / 2] : (values[count / 2 - 1] + values[count / 2]) / 2;
  return { count, min: values[0], max: values[count - 1], mean, median };
}

export interface BpmBand {
  /** Inclusive lower edge, exclusive upper (`from ≤ bpm < to`). */
  from: number;
  to: number;
  count: number;
  positions: number[];
}

/**
 * Client-side histogram (AC-28 — `derived` only carries min/max/mean/median;
 * bins are derived locally). ~4-BPM bands aligned to multiples of the width,
 * empty bands between occupied ones kept so the shape reads honestly.
 */
export function bpmHistogram(plays: SyncPlay[], bandWidth = 4): BpmBand[] {
  const timed = plays.filter((p): p is SyncPlay & { bpm: number } => p.bpm != null);
  if (timed.length === 0) return [];
  const lo = Math.floor(Math.min(...timed.map((p) => p.bpm)) / bandWidth) * bandWidth;
  const hi = Math.floor(Math.max(...timed.map((p) => p.bpm)) / bandWidth) * bandWidth;
  const bands: BpmBand[] = [];
  for (let from = lo; from <= hi; from += bandWidth) {
    bands.push({ from, to: from + bandWidth, count: 0, positions: [] });
  }
  for (const p of timed) {
    const idx = Math.floor((p.bpm - lo) / bandWidth);
    bands[idx].count += 1;
    bands[idx].positions.push(p.position);
  }
  return bands;
}

/* ── Set shape — Longest / Shortest Play (AC-14) ─────────────────────── */

export interface SetShape {
  longest: SyncPlay | null;
  shortest: SyncPlay | null;
  /** Plays with no captured duration — disclosed, never silently dropped. */
  missingDuration: number;
}

/**
 * By the REAL captured `played_ms` only (AC-14) — never the timestamp-diff
 * proxy. Ties resolve to the first-played (stable across renders).
 */
export function setShape(plays: SyncPlay[]): SetShape {
  let longest: SyncPlay | null = null;
  let shortest: SyncPlay | null = null;
  let missingDuration = 0;
  for (const p of plays) {
    const ms = p.played_ms;
    if (ms == null) {
      missingDuration += 1;
      continue;
    }
    if (longest == null || ms > (longest.played_ms as number)) longest = p;
    if (shortest == null || ms < (shortest.played_ms as number)) shortest = p;
  }
  return { longest, shortest, missingDuration };
}

/* ── New tracks played (AC-15, AC-18) ────────────────────────────────── */

export type NewTracksWindow = "week" | "month";

export interface NewTracks {
  /** Unique tracks whose library add-date falls in the window. */
  newCount: number;
  /** All unique tracks in scope — the honest denominator. */
  totalTracks: number;
  /** Unique tracks with no add-date (off-library, or catalogue gap) — disclosed. */
  noDateCount: number;
  /** Play positions of every new track's plays (the DR-2 focus row set). */
  positions: number[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Counts this set's unique tracks whose `library_added_at` falls within 7/30
 * days BEFORE the set date (set-date-relative so it never drifts, AC-15).
 * Track identity = title+artist (the wire carries no path — same identity the
 * agent's pathless ranking uses).
 */
export function newTracks(
  plays: SyncPlay[],
  setStartIso: string | null,
  window: NewTracksWindow,
): NewTracks {
  const empty: NewTracks = { newCount: 0, totalTracks: 0, noDateCount: 0, positions: [] };
  if (!setStartIso) return empty;
  const setStart = EPOCH(setStartIso);
  if (Number.isNaN(setStart)) return empty;
  const windowMs = (window === "week" ? 7 : 30) * DAY_MS;

  interface TrackAgg {
    addedAt: number | null;
    positions: number[];
  }
  const tracks = new Map<string, TrackAgg>();
  for (const p of plays) {
    if (p.title == null && p.artist == null) continue; // no identity to count
    const identity = `${p.title ?? ""} ${p.artist ?? ""}`;
    let agg = tracks.get(identity);
    if (!agg) {
      agg = { addedAt: null, positions: [] };
      tracks.set(identity, agg);
    }
    agg.positions.push(p.position);
    if (p.library_added_at != null && agg.addedAt == null) {
      const t = EPOCH(p.library_added_at);
      if (!Number.isNaN(t)) agg.addedAt = t;
    }
  }

  const out: NewTracks = { newCount: 0, totalTracks: tracks.size, noDateCount: 0, positions: [] };
  for (const agg of tracks.values()) {
    if (agg.addedAt == null) {
      out.noDateCount += 1;
      continue;
    }
    if (agg.addedAt >= setStart - windowMs && agg.addedAt <= setStart) {
      out.newCount += 1;
      out.positions.push(...agg.positions);
    }
  }
  out.positions.sort((a, b) => a - b);
  return out;
}

/* ── Most-played artists + replays (AC-13) ───────────────────────────── */

export interface ArtistCount {
  artist: string;
  count: number;
  positions: number[];
}

/**
 * Ranked artists over artist-tagged plays only (CAP-5: no Unknown bucket, no
 * untagged footnote). Count descending, first-seen tiebreak — mirrors the
 * agent's `most_played_artists` determinism.
 */
export function mostPlayedArtists(plays: SyncPlay[]): ArtistCount[] {
  const order: string[] = [];
  const byArtist = new Map<string, ArtistCount>();
  for (const p of plays) {
    if (p.artist == null) continue;
    let entry = byArtist.get(p.artist);
    if (!entry) {
      entry = { artist: p.artist, count: 0, positions: [] };
      byArtist.set(p.artist, entry);
      order.push(p.artist);
    }
    entry.count += 1;
    entry.positions.push(p.position);
  }
  return order
    .map((a) => byArtist.get(a) as ArtistCount)
    .sort((a, b) => b.count - a.count || order.indexOf(a.artist) - order.indexOf(b.artist));
}

export interface ReplayedTrack {
  title: string | null;
  artist: string | null;
  count: number;
  positions: number[];
}

/** Tracks played more than once (the conditional "Replayed" line, AC-13). */
export function replayedTracks(plays: SyncPlay[]): ReplayedTrack[] {
  const order: string[] = [];
  const byTrack = new Map<string, ReplayedTrack>();
  for (const p of plays) {
    if (p.title == null && p.artist == null) continue; // no identity to count
    const identity = `${p.title ?? ""} ${p.artist ?? ""}`;
    let entry = byTrack.get(identity);
    if (!entry) {
      entry = { title: p.title, artist: p.artist, count: 0, positions: [] };
      byTrack.set(identity, entry);
      order.push(identity);
    }
    entry.count += 1;
    entry.positions.push(p.position);
  }
  return order
    .map((id) => byTrack.get(id) as ReplayedTrack)
    .filter((t) => t.count > 1)
    .sort((a, b) => b.count - a.count);
}

/* ── Genre ranking (AC-12, AC-27) ────────────────────────────────────── */

export interface GenreBucket {
  name: string;
  /** Parent genre — set only on subgenre buckets. */
  parent?: string;
  count: number;
  pct: number;
  positions: number[];
}

export interface GenreRanking {
  buckets: GenreBucket[];
  noGenreCount: number;
  noGenrePositions: number[];
}

function rankBuckets(
  plays: SyncPlay[],
  keyOf: (p: SyncPlay) => { name: string; parent?: string } | null,
): GenreRanking {
  const order: string[] = [];
  const byName = new Map<string, GenreBucket>();
  let noGenreCount = 0;
  const noGenrePositions: number[] = [];
  for (const p of plays) {
    const key = keyOf(p);
    if (!key) {
      noGenreCount += 1;
      noGenrePositions.push(p.position);
      continue;
    }
    let bucket = byName.get(key.name);
    if (!bucket) {
      bucket = { name: key.name, parent: key.parent, count: 0, pct: 0, positions: [] };
      byName.set(key.name, bucket);
      order.push(key.name);
    }
    bucket.count += 1;
    bucket.positions.push(p.position);
  }
  const total = plays.length;
  const buckets = order
    .map((n) => byName.get(n) as GenreBucket)
    .sort((a, b) => b.count - a.count || order.indexOf(a.name) - order.indexOf(b.name));
  for (const b of buckets) b.pct = total > 0 ? Math.round((b.count / total) * 100) : 0;
  return { buckets, noGenreCount, noGenrePositions };
}

/** Ranked normalized-genre buckets with honest `no_genre` (AC-12/AC-27). */
export function genreRanking(plays: SyncPlay[]): GenreRanking {
  return rankBuckets(plays, (p) =>
    p.genre?.normalized ? { name: p.genre.normalized } : null,
  );
}

/** The genre⇄subgenre overlay toggle's finer ranking (AC-27). */
export function subgenreRanking(plays: SyncPlay[]): GenreRanking {
  return rankBuckets(plays, (p) =>
    p.genre?.subgenre
      ? { name: p.genre.subgenre, parent: p.genre.normalized }
      : null,
  );
}

/* ── Arc peak — the ★ PEAK impact node (AC-20) ───────────────────────── */

/** Rolling-median half-window — matches heroArc.ts's smoothing so the peak the
 * tracklist stars is the peak the arc draws. */
const PEAK_HALF_WINDOW = 2;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The play at the energy arc's peak — the highest *sustained*-BPM moment
 * within the given (already-scoped) plays: per-play BPM smoothed by a rolling
 * median (±2 neighbours, same as the hero arc) so one doubled-BPM tag can't
 * steal the star. Ties resolve to the earliest. `null` when fewer than 2
 * BPM-carrying plays (a sparse set has no arc to peak — AC-35).
 */
export function arcPeakPosition(plays: SyncPlay[]): number | null {
  const timed = plays.filter(
    (p): p is SyncPlay & { bpm: number } => p.bpm != null && p.started_at != null,
  );
  if (timed.length < 2) return null;
  let bestIdx = 0;
  let bestValue = -Infinity;
  for (let i = 0; i < timed.length; i++) {
    const from = Math.max(0, i - PEAK_HALF_WINDOW);
    const to = Math.min(timed.length - 1, i + PEAK_HALF_WINDOW);
    const smoothed = median(timed.slice(from, to + 1).map((p) => p.bpm));
    if (smoothed > bestValue) {
      bestValue = smoothed;
      bestIdx = i;
    }
  }
  return timed[bestIdx].position;
}

/* ── Formatting ──────────────────────────────────────────────────────── */

/** Played-length as `m:ss` (or `h:mm:ss` past an hour), e.g. `6:21`. `null` → "—". */
export function formatPlayedLength(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
