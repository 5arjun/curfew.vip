/*
 * ============================================================================
 *  DRAFT — NOT FROZEN until Story 1.10 (AR-1).
 * ============================================================================
 *  This is the single agent <-> cloud sync seam (AD-3). The cloud ingests ONLY
 *  this derived, per-set payload; raw library/session data never crosses it.
 *
 *  Everything here is PROVISIONAL. The parser-validation spike (Story 1.2) will
 *  teach us parsing reality and this shape WILL change. Only at Story 1.10 does
 *  the contract freeze; from then on it is ADDITIVE-ONLY, forever (AD-15).
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

/** Bump on every breaking change to the payload shape (post-freeze: additive-only). */
export const CONTRACT_VERSION = 1 as const;
export type ContractVersion = typeof CONTRACT_VERSION;

/* ---- AR-15 fixed enums (live in shared/ by convention) --------------------- */

/** Who can see a set. */
export const VISIBILITY = ["public", "friends_only", "private"] as const;
export type Visibility = (typeof VISIBILITY)[number];

/** Kind of a set segment. */
export const SEGMENT_TYPE = ["dancefloor", "dinner", "performance", "custom"] as const;
export type SegmentType = (typeof SEGMENT_TYPE)[number];

/** Capture source. Only Serato exists today. */
export const SOURCE = ["serato"] as const;
export type Source = (typeof SOURCE)[number];

/* ---- DRAFT per-set derived sync payload (the AD-3 seam shape) --------------- */

/** One derived play within a set. Provisional shape. */
export interface SyncPlayDraft {
  /** Ordinal position within the set, 1-based. */
  position: number;
  /** ISO 8601 timestamp the play started. */
  played_at: string;
  /** Derived confidence this play was really played live (Story 1.8 refines it). */
  confidence: number;
}

/** One derived segment of a set. Provisional shape. */
export interface SyncSegmentDraft {
  type: SegmentType;
  /** ISO 8601. */
  started_at: string;
  /** ISO 8601. */
  ended_at: string;
}

/** The derived, per-set payload the agent sends and the cloud ingests. */
export interface SyncPayloadDraft {
  /** Contract version this payload was produced against. */
  contract_version: ContractVersion;
  /** Semver of the agent that produced the payload (traceability across format drift). */
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
    visibility: Visibility;
    plays: SyncPlayDraft[];
  };
  segments: SyncSegmentDraft[];
}

/**
 * Relative path (from this package root) to the JSON-schema artifact the Rust
 * agent consumes. Kept as a constant so both sides reference one source of truth.
 */
export const SYNC_PAYLOAD_SCHEMA_PATH = "schema/sync-payload.schema.json" as const;
