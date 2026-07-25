/*
 * ============================================================================
 *  FROZEN — additive-only forever (Story 1.10, AD-15).
 * ============================================================================
 *  This is the single agent <-> cloud sync seam (AD-3). The cloud ingests ONLY
 *  this derived, per-set payload; raw library/session data never crosses it.
 *
 *  This shape was frozen by Story 1.10, after the parser-validation spike
 *  (Story 1.2) and the stat-engine (Story 1.7) / confidence signal (Story 1.8)
 *  it is derived from. From here on every change MUST be additive-only: new
 *  optional/nullable fields only, never a removed, renamed, or re-typed
 *  required field (AD-15). Task 5's `additive-only.test.ts` enforces this in
 *  CI. See README.md's "Adding a field after freeze" section before editing
 *  this file.
 *
 *  Two consumers, one contract:
 *    - web/  (TypeScript) imports these types directly from `@curfew/shared`.
 *    - agent/ (Rust) CANNOT import TS; it consumes the language-neutral
 *      JSON-schema at `@curfew/shared/schema/sync-payload.schema.json`.
 *  The two MUST stay mutually consistent — enforced by tests on both sides.
 *
 *  Do NOT import `agent` or `web` from here. `shared` depends on neither.
 * ============================================================================
 */

/**
 * Contract version this payload shape was frozen at. A version bump is now
 * reserved for a hypothetical future deliberate contract fork, not routine
 * evolution — post-freeze, additive changes (new optional/nullable fields)
 * never require a bump; only they're allowed at all (AD-15).
 */
export const CONTRACT_VERSION = 1 as const;
export type ContractVersion = typeof CONTRACT_VERSION;

/* ---- AR-15 fixed enums (live in shared/ by convention) --------------------- */

/**
 * Who can see a set. Cloud-side only: this enum backs the `sets` table's own
 * visibility column and web-authored overlay UI. It does NOT appear in
 * `SyncPayload` — visibility is a web-authored overlay (AD-6/AD-9), never
 * decided or sent by the agent. See Story 1.10 Task 1.
 */
export const VISIBILITY = ["public", "friends_only", "private"] as const;
export type Visibility = (typeof VISIBILITY)[number];

/**
 * Kind of a set segment. Cloud-side only: this enum backs the future
 * cloud-side `segments` table (Epic 5). It does NOT appear in `SyncPayload` —
 * segment detection is Epic 5's job and segment edits are a web-authored
 * overlay (AD-6/AD-16), never written by the agent. See Story 1.10 Task 1.
 */
export const SEGMENT_TYPE = ["dancefloor", "dinner", "performance", "custom"] as const;
export type SegmentType = (typeof SEGMENT_TYPE)[number];

/** Capture source. Only Serato exists today. */
export const SOURCE = ["serato"] as const;
export type Source = (typeof SOURCE)[number];

/* ---- Frozen per-set derived sync payload (the AD-3 seam shape) -------------- */

/**
 * One derived play within a set, sourced from `agent/src-tauri/src/stats/mod.rs`'s
 * `EnrichedPlay` plus `joiner::JoinedMetadata.in_library` (Story 1.10 Task 2).
 *
 * Every field except `position` and `in_library` is independently nullable,
 * mirroring `EnrichedPlay`'s "every field optional, nothing silently
 * defaulted" discipline (AD-11) — a field that can be unknown on the agent is
 * carried as `null` on the wire, never a fabricated default.
 *
 * Deliberately excludes a raw file `path`: `EnrichedPlay.path` is a local
 * filesystem path and sending it would leak local username/folder structure
 * for no UX payoff Set Detail / Style Evolution need today. See Open
 * Questions #1 in Story 1.10 re: a future purpose-built identity field for
 * Epic 4's FR-10 library-to-setlist correlation.
 */
export interface SyncPlay {
  /** 1-based ordinal position within the set — a stable ordering key independent of `started_at`. */
  position: number;
  /** From `EnrichedPlay.title`. Missing renders as "Unknown" client-side (AD-11); the wire never carries a synthesized string. */
  title: string | null;
  /** From `EnrichedPlay.artist`. Same "Unknown" client-side rule as `title`. */
  artist: string | null;
  /** ISO 8601 (UTC). From `EnrichedPlay.start_time` (a Unix-epoch `u32`), converted at payload-build time. */
  started_at: string | null;
  /** From `EnrichedPlay.bpm`. Already `sane_bpm`-filtered by the joiner (finite, positive). */
  bpm: number | null;
  /** From `EnrichedPlay.genre: Option<NormalizedGenre>`. Raw + normalized + taxonomy version, verbatim (AD-12) — never collapsed to just `normalized`. */
  genre: { raw: string; normalized: string; taxonomy_version: number } | null;
  /** Camelot notation string (e.g. `"8A"`), from `EnrichedPlay.camelot: Option<CamelotKey>`. Encoded as a string, not the two-field Rust struct — it's the source format already and what `web/` wants directly. */
  camelot_key: string | null;
  /** From `JoinedMetadata.in_library` — NOT carried by `EnrichedPlay` itself. Required, never omitted or guessed (Consistency Conventions table). */
  in_library: boolean;
}

/**
 * The `set.derived` render-cache blob (AR-15 Structural Seed: "`sets` carries
 * a denormalized `derived` (jsonb) render-cache so dashboards render without
 * recomputation"). Every field is sourced verbatim from
 * `agent/src-tauri/src/stats/mod.rs` (Story 1.7) and `confidence.rs` (Story
 * 1.8) — see Story 1.10 Task 3 for the field-by-field mapping.
 */
export interface SyncSetDerived {
  /**
   * From `stats::most_played_tracks`, ranked descending, ties broken by
   * first-seen order. Ranked edge-side using the full `TrackIdentity`
   * (path included, for accurate pathless-play dedup) then projected down to
   * `{title, artist, play_count}` for the wire — the wire never carries `path`.
   */
  most_played_tracks: Array<{ title: string | null; artist: string | null; play_count: number }>;
  /**
   * From `stats::most_played_artists`. CAP-5 binding: artist-tagged plays
   * only — no "Unknown" bucket, no untagged-count footnote.
   */
  most_played_artists: Array<{ artist: string; play_count: number }>;
  /** From `stats::genre_breakdown`/`GenreBreakdown`. Unlike `most_played_artists`, `no_genre_count` is always visible here — no CAP-5-style exemption. */
  genre_breakdown: {
    buckets: Array<{ genre: string; play_count: number }>;
    no_genre_count: number;
  };
  /** From `stats::bpm_distribution`/`BpmDistribution`. An empty distribution is `count: 0` with all other fields `0`, never `null`/`NaN`. */
  bpm_distribution: { count: number; min: number; max: number; mean: number; median: number };
  /** From `stats::camelot::mixing_stats`/`CamelotMixingStats`. Three raw counts, not a pre-divided rate — `web/` divides if a ratio is needed. */
  camelot_mixing_stats: {
    compatible_transitions: number;
    incompatible_transitions: number;
    excluded_no_key: number;
  };
  /** From `stats::set_length_sec`. `null` when either endpoint's `start_time` is absent — mirrors the Rust `Option<u32>` exactly. */
  set_length_sec: number | null;
  /** From `stats::track_count`. Total plays, not unique tracks. */
  track_count: number;
  /** From `stats::energy_arc`/`EnergyArcPoint`. Only points with both `start_time` and `bpm` present; chronological order preserved. */
  energy_arc: Array<{ started_at: string; bpm: number }>;
  /**
   * From `confidence::classify`/`SessionConfidence` (Story 1.8, FR-27).
   * Required, not optional — Epic 4 Story 4.1 AC-3 depends on this signal
   * being synced so Style Evolution can exclude low-confidence sessions
   * visibly. Field names mirror `SessionConfidence` exactly, except
   * `confidence` -> `value` to avoid a `derived.confidence.confidence` stutter.
   */
  confidence: { value: number; track_count: number; long_gap_count: number };
}

/** The derived, per-set payload the agent sends and the cloud ingests. Frozen (Story 1.10, AD-15). */
export interface SyncPayload {
  /** Contract version this payload was produced against. */
  contract_version: ContractVersion;
  /**
   * Semver of the agent that produced the payload (traceability across format
   * drift). Contract evolution is additive-only, and the cloud must accept
   * the last N `agent_version`s (AR-1) — N is not yet chosen; no cloud exists
   * yet to enforce a window against. See README.md's "agent_version
   * acceptance policy" section. AD-13's local-retention backfill mechanism is
   * the safety net if an old agent version is ever rejected.
   */
  agent_version: string;
  /** Capture source. */
  source: Source;
  set: {
    /** Stable idempotency key for the set (Story 3.2 relies on this). */
    external_id: string;
    /** ISO 8601. */
    started_at: string;
    /** ISO 8601. */
    ended_at: string;
    plays: SyncPlay[];
    /** Render-cache blob — see `SyncSetDerived`. */
    derived: SyncSetDerived;
  };
}

/**
 * Relative path (from this package root) to the JSON-schema artifact the Rust
 * agent consumes. Kept as a constant so both sides reference one source of truth.
 */
export const SYNC_PAYLOAD_SCHEMA_PATH = "schema/sync-payload.schema.json" as const;
