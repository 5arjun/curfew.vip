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
 * Kind of a set segment. Cloud-side: this enum backs the `segments` table
 * (Story 5.1).
 *
 * **Amended by Story 5.2 (D-19 / AD-23).** The original text here said segments
 * "do NOT appear in `SyncPayload` — segment detection is Epic 5's job and
 * segment edits are a web-authored overlay (AD-6/AD-16), never written by the
 * agent." Half of that still holds and half no longer does:
 *
 * - Segment **edits** (`confirmed = true`, and `source = 'manual'` rows) remain
 *   web-authored overlay, never written by any sync path. Unchanged.
 * - Segment **detection** runs agent-side in the Rust stat engine (D-2), exactly
 *   where AD-17 always said it would, and its output rides
 *   {@link SyncSetDerived.suggested_segments} on the per-set payload. `sync_set`
 *   materializes those as `('suggested', false)` rows.
 *
 * So this enum's values now *do* reach the wire — as the `type` on a suggestion,
 * which is always `"dancefloor"` (D-26; the other three are human labels Story
 * 5.3 owns). See Story 1.10 Task 1 for the original freeze.
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
  /**
   * From `EnrichedPlay.genre: Option<NormalizedGenre>`. Raw + normalized + taxonomy
   * version, verbatim (AD-12) — never collapsed to just `normalized`.
   *
   * `subgenre` was added post-freeze (taxonomy v2) and is therefore optional per
   * AD-15's additive-only rule, even though the agent always populates it alongside
   * `normalized` in practice — see `genre.rs::NormalizedGenre`.
   */
  genre: {
    raw: string;
    normalized: string;
    taxonomy_version: number;
    subgenre?: string;
  } | null;
  /** Camelot notation string (e.g. `"8A"`), from `EnrichedPlay.camelot: Option<CamelotKey>`. Encoded as a string, not the two-field Rust struct — it's the source format already and what `web/` wants directly. */
  camelot_key: string | null;
  /** From `JoinedMetadata.in_library` — NOT carried by `EnrichedPlay` itself. Required, never omitted or guessed (Consistency Conventions table). */
  in_library: boolean;
  /**
   * Real on-air duration in milliseconds, from `EnrichedPlay.played_ms` (Story 3.7
   * §3d): Serato's own per-play `end_time − start_time` (98% populated on real
   * data), with a next-play-start / set-end fallback resolved agent-side for the
   * unset tail. Second-granular at the source; ms so the unit never needs a
   * migration. Powers the per-row played-length and Longest/Shortest Play.
   *
   * Added post-freeze (Story 3.7) and therefore optional per AD-15's
   * additive-only rule; `null` when genuinely unresolvable (never guessed).
   */
  played_ms?: number | null;
  /**
   * ISO 8601 (UTC) — when the DJ's library first saw this track, from
   * `EnrichedPlay.library_added_at` (Story 3.7 §3d: `database V2` `tadd`/`uadd`
   * joined by portable path — NOT the serato4 `asset` join, which only links
   * ~4.6% of real plays). Same epoch→ISO payload-build-time conversion as
   * `started_at`. Powers "New tracks played"; coverage is honestly
   * drive-dependent (~94% ceiling) and the UI discloses the gap.
   *
   * Added post-freeze (Story 3.7), optional per AD-15; `null` when no reachable
   * catalogue covers the track.
   */
  library_added_at?: string | null;
  /**
   * Opaque, portable track identity — `fnv1a_hex` of the track's
   * volume-root-relative path (`agent/src-tauri/src/capture.rs::track_id`,
   * Story 4.2 D-2). **This is the "purpose-built (possibly hashed/opaque)
   * per-track identity field" Story 1.10's Open Question #1 anticipated for
   * exactly this use** (see this interface's own doc comment above) — now
   * resolved by Story 4.2.
   *
   * Lets a play join back to its [`SyncLibraryAddEvent`] by identity rather
   * than by fragile title/artist matching, which is what makes FR-10's
   * library-to-setlist correlation (and FR-11's conversion rate) computable at
   * all. The raw path is still never sent — hashing is what keeps the
   * no-local-FS-layout posture intact while making identity joinable.
   *
   * Added post-freeze (Story 4.2), optional per AD-15; `null` when the source
   * carried no portable path to hash.
   */
  track_id?: string | null;
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
  /**
   * From `stats::subgenre_breakdown`/`SubgenreBreakdown` (added post-freeze,
   * taxonomy v2). Optional per AD-15 — a new field, not present in the frozen
   * baseline. Same per-bucket/`no_genre_count` shape as `genre_breakdown`, one
   * level finer: each bucket also carries its parent `genre` so a client can group
   * back up to `genre_breakdown`'s level without a second lookup.
   */
  subgenre_breakdown?: {
    buckets: Array<{ subgenre: string; genre: string; play_count: number }>;
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
  /**
   * From `stats::energy_arc`/`EnergyArcPoint`. Only points with both
   * `start_time` and `bpm` present; chronological order preserved.
   *
   * **`started_at` is Unix epoch SECONDS, not an ISO string** — the same wire
   * convention `idle_gaps` documents at length below, and the same one
   * `plays[].started_at` crosses `sync_set` with. `CapturedEnergyPoint` in
   * `agent/src-tauri/src/store.rs` declares it `u32` and `sync.rs` forwards
   * `derived_json` **verbatim**, so this has always been an integer on the
   * wire; unlike `plays[]`, nothing ever converted it, because `derived` is
   * stored as jsonb and read back unchanged. The `string` this field used to
   * be typed as was simply wrong, and every web consumer that did
   * `new Date(started_at)` on it read 1970 (`bug-energy-arc-epoch-vs-iso`).
   *
   * The union keeps `string` accepted so a hand-authored fixture or an older
   * stored `derived` blob carrying ISO still parses — read it through
   * `arcEpochMs` in `web/lib/sets/energyArc.ts`, never `new Date(...)`
   * directly. A `u32` can never hold epoch *milliseconds* (they exceed 4.29e9
   * by 2^8), so "number ⇒ seconds" is unambiguous, not a heuristic.
   */
  energy_arc: Array<{ started_at: number | string; bpm: number }>;
  /**
   * From `confidence::classify`/`SessionConfidence` (Story 1.8, FR-27).
   * Required, not optional — Epic 4 Story 4.1 AC-3 depends on this signal
   * being synced so Style Evolution can exclude low-confidence sessions
   * visibly. Field names mirror `SessionConfidence` exactly, except
   * `confidence` -> `value` to avoid a `derived.confidence.confidence` stutter.
   */
  confidence: { value: number; track_count: number; long_gap_count: number };
  /**
   * Dancefloor segments the agent's detector suggested for this set, from
   * `stats::segments::detect` (Story 5.2, AD-17/AR-13/FR-28). Zero, one, or
   * several — **never assume exactly one** (FR-28, D-15).
   *
   * Added post-freeze (Story 5.2), optional per AD-15's additive-only rule:
   * absent on every frozen-baseline payload and on any pre-5.2 agent's.
   *
   * **Positions, not play ids.** The agent can never know a cloud `plays.id` —
   * `sync_set` mints them inside its own transaction, and re-mints them on every
   * re-sync — so a suggestion addresses the same payload's `plays[]` by 1-based
   * `position` and the RPC resolves both ends after its own plays insert (D-20).
   * An entry that does not resolve (`first > last`, out of range, non-integer) is
   * warned about and skipped by the RPC; it never fails the set's content sync.
   *
   * **The web must NEVER read this field.** The `segments` rows are the sole read
   * model (D-19's drift guard). This copy is inert provenance: once Story 5.3
   * lets a DJ confirm or drag a boundary, the rows diverge from what the agent
   * originally suggested and this blob goes stale by design. Reading it would
   * render a suggestion the DJ has already overruled.
   */
  suggested_segments?: Array<{
    type: SegmentType;
    first_position: number;
    last_position: number;
  }>;
  /**
   * Stretches of the night with no plays, labeled (Story 5.2, D-10). Descriptive
   * only — nothing gates on them, and they are deliberately **not** `segments`
   * rows: there is no `idle` value in {@link SEGMENT_TYPE}, on purpose (D-26).
   * Carried for future UI ("idle 11:45–12:05"); no consumer reads them yet.
   *
   * Added post-freeze (Story 5.2), optional per AD-15.
   *
   * **Unix epoch seconds, not ISO strings.** This is deliberate and it is worth
   * knowing why, because the prose elsewhere in this file would suggest
   * otherwise. `agent/src-tauri/src/sync.rs` sends `derived_json` to `sync_set`
   * **verbatim**, so `energy_arc[].started_at` and `plays[].started_at` already
   * cross this seam as epoch integers today (which is why `sync_set` reads plays
   * with `to_timestamp(...)`); the ISO wording on those fields describes the
   * read model, not the wire. The Consistency Conventions table's rule is the
   * binding one — RPC arguments stay epoch, ISO only on read-model render
   * strings — and the agent has no date formatter to produce ISO with. Matching
   * the wire's real convention here rather than its documentation.
   */
  idle_gaps?: Array<{ start: number; end: number }>;
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

/* ---- Library add-events (Story 4.2, AD-21) ---------------------------------- */

/**
 * One go-forward library add-event: a track that entered the DJ's library
 * *after* Curfew first looked at it (Story 4.2, D-4).
 *
 * **Why this is not a field on [`SyncPayload`].** `SyncPayload` is
 * one-`PUT`-per-set (AD-4) and every field on it is set-scoped. An add-event
 * is not tied to a set at all — the whole point is that it records a track
 * that was *acquired*, whether or not it was ever played. Bolting it onto the
 * per-set payload would mean an add-event could only ever reach the cloud on
 * the coincidence of a set being synced, and would silently re-send the same
 * events on every re-sync of that set. So it is a wholly separate payload on a
 * wholly separate path, and `SyncPayload`'s shape and `PUT /sets/:set_id`
 * idempotency contract are untouched.
 *
 * **Go-forward only, never a backfill.** The agent takes a silent local
 * baseline of the existing library on first run and emits nothing for it
 * (D-1) — the same discipline Epic 4's Decision B already set for plays.
 * Nothing here ever reconstructs when a track already in the library was
 * acquired.
 */
export interface SyncLibraryAddEvent {
  /** Opaque `fnv1a_hex` track identity (D-2) — the same value [`SyncPlay.track_id`] carries. Never the raw path. */
  track_id: string;
  /**
   * ISO 8601 (UTC) — when the DJ's library first saw this track, from
   * `database V2`'s `tadd`/`uadd` (the same source and the same ~94%
   * drive-dependent coverage ceiling as [`SyncPlay.library_added_at`]).
   *
   * `null` when no reachable catalogue covers the track — never guessed
   * (AD-11). Such tracks are excluded from cohort math and their count is
   * always disclosed to the DJ rather than silently dropped (D-10).
   */
  added_at: string | null;
}

/**
 * The batch envelope the agent `POST`s. A batch (not one request per track)
 * because a DJ importing a crate adds hundreds of tracks at once, and because
 * the cloud write is idempotent on `(dj_id, track_id)` — so a batch redelivered
 * by the at-least-once offline queue (Story 3.3) is a no-op, exactly like a
 * re-`PUT` set.
 */
export interface SyncLibraryAddEventBatch {
  /** Contract version this batch was produced against. */
  contract_version: ContractVersion;
  /** Semver of the agent that produced the batch — same traceability role as `SyncPayload.agent_version`. */
  agent_version: string;
  events: SyncLibraryAddEvent[];
}

/* ---- Library roster (Story 4.11, AD-22) -------------------------------------- */

/**
 * One current-state library roster entry — Tier A only (title/artist; BPM,
 * key, and genre are Tier B, explicitly parked, see Story 4.11's Context &
 * Authority section). Unlike every other wire artifact in this file, this
 * one describes **mutable current state**, not an immutable as-recorded
 * event: a re-tagged track's title/artist are expected to change across
 * batches for the same `track_id`, and the cloud-side RPC upserts
 * accordingly (current-state `DO UPDATE`, not `SyncLibraryAddEvent`'s
 * first-write-wins `DO NOTHING`). `added_at`/`is_baseline` do NOT share that
 * mutability — they describe how/when a track first entered the roster and
 * must never move on a re-scan (Story 4.11 AC-3's invariant).
 *
 * **Why this is not a field on [`SyncLibraryAddEvent`].** That type is
 * go-forward-only by construction (AD-21 — baseline tracks are structurally
 * excluded from it). This story's whole point is that baseline tracks DO
 * reach the roster (AC-3) while still never reaching cohort math — folding
 * the two together would make that separation impossible to enforce on the
 * wire. `library_track_events` (the cohort denominator, AD-21) and this
 * roster stay two separate tables with two separate purposes on both sides
 * of the contract.
 */
export interface SyncLibraryRosterEntry {
  /** Opaque `fnv1a_hex` track identity (D-2) — same value as `SyncPlay.track_id`/`SyncLibraryAddEvent.track_id`. */
  track_id: string;
  /** Raw, un-normalized song title. `null` only in the pathological case where a fixed test catalogue never populated it — a track missing **either** a resolvable title or a resolvable artist has no `track_id` to report under at all — the identity hash requires both (AD-11, AC-6). */
  title: string | null;
  /** Raw, un-normalized artist. Same absence rule as `title`. */
  artist: string | null;
  /**
   * Unix epoch **seconds** — when the library first saw this track, from
   * `database V2`'s `tadd`/`uadd`. `null` when no reachable catalogue covers
   * the track — never guessed (AD-11). Fixed at first sighting; never updated
   * by a later current-state batch for the same `track_id` (AC-3).
   *
   * Epoch integers, not ISO 8601: the `sync_library_roster` RPC parses these
   * with `to_timestamp(...::bigint)`, matching `sync_set` and
   * `sync_library_add_events`. This is a **wire** type — the web read model
   * (`web/lib/sets/libraryRoster.ts`) uses ISO strings, because PostgREST
   * renders the stored `timestamptz` that way.
   */
  added_at: number | null;
  /**
   * `true` for D-1's silent first-run baseline snapshot. Fixed at first
   * sighting, same as `added_at` — **must never be read for conversion-rate
   * cohort math** (that denominator is `library_track_events`/AD-21, a
   * wholly separate table); this field exists so the roster can name a
   * baseline track, not so anything can compute a cohort from it.
   */
  is_baseline: boolean;
  /**
   * Unix epoch **seconds**, or `null` if the track is currently present in
   * the DJ's library — set when a previously-known track is missing from a
   * scan (Story 4.11 AC-5), cleared if it reappears. A soft-delete marker,
   * never a hard removal: an absent row keeps its identity and history.
   */
  absent_at: number | null;
}

/**
 * The batch envelope the agent `POST`s — same batching rationale as
 * [`SyncLibraryAddEventBatch`] (a crate import adds hundreds of tracks at
 * once; the cloud write is idempotent on `(dj_id, track_id)`), but unlike
 * that batch's first-write-wins semantics, a redelivered roster batch is a
 * **current-state upsert**, not strictly a no-op — redelivering the same
 * batch twice is still safe (identical values in, identical values out).
 */
export interface SyncLibraryRosterBatch {
  /** Contract version this batch was produced against. */
  contract_version: ContractVersion;
  /** Semver of the agent that produced the batch — same traceability role as `SyncPayload.agent_version`. */
  agent_version: string;
  entries: SyncLibraryRosterEntry[];
}

/**
 * Relative path (from this package root) to the JSON-schema artifact the Rust
 * agent consumes. Kept as a constant so both sides reference one source of truth.
 */
export const SYNC_PAYLOAD_SCHEMA_PATH = "schema/sync-payload.schema.json" as const;

/**
 * Same role as [`SYNC_PAYLOAD_SCHEMA_PATH`], for the Story 4.2 add-event batch
 * — a second language-neutral artifact rather than an extension of the first,
 * mirroring the two payloads' deliberate separation above.
 */
export const SYNC_LIBRARY_ADD_EVENTS_SCHEMA_PATH =
  "schema/sync-library-add-events.schema.json" as const;

/**
 * Same role again, for the Story 4.11 roster batch — a third, independent
 * artifact (AD-22), not an extension of either of the above.
 */
export const SYNC_LIBRARY_ROSTER_SCHEMA_PATH = "schema/sync-library-roster.schema.json" as const;
