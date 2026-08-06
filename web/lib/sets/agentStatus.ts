// Agent-status heartbeat: the web half of AD-20 (Story 3.9, AC-1/AC-2).
//
// The agent POSTs its current tray state to `set_agent_status` on every
// sync-queue drain pass — with no dedup, deliberately — so a fresh
// `updated_at` is its liveness signal (beat-on-idle ruling, 2026-08-05). The
// agent is dumb about staleness: it never knows what "stale" means.
//
// THIS FILE OWNS THAT DEFINITION. Everything about "is the agent still
// talking to us" is decided here, in one pure function, so the rule is
// testable without a database, a clock, or a browser.

/**
 * The six `TrayState` variants, spelled exactly as they cross the wire.
 *
 * This list is one of three copies of the same contract, and all three must
 * move together:
 *   1. `agent/src-tauri/src/tray.rs::TrayState::wire_state` (the writer)
 *   2. the allow-list inside `set_agent_status`
 *      (`supabase/migrations/20260805120000_create_agent_status.sql`)
 *   3. here (the reader)
 * The RPC rejects anything outside its own list with `22023`, so a drift
 * between 1 and 2 fails loudly at the agent; a drift between 2 and 3 fails
 * silently — which is why {@link resolveAgentStatus} treats an unrecognized
 * state as "not reporting" rather than rendering it raw.
 */
export const AGENT_SYNC_STATES = [
  "Idle",
  "Syncing",
  "Failed",
  "DriveNotConnected",
  "Queued",
  "FormatDriftPaused",
] as const;

export type AgentSyncState = (typeof AGENT_SYNC_STATES)[number];

export function isAgentSyncState(value: string): value is AgentSyncState {
  return (AGENT_SYNC_STATES as readonly string[]).includes(value);
}

/** The `agent_status` row as it comes back from Supabase. */
export type AgentStatusRow = {
  sync_state: string;
  updated_at: string;
  /**
   * Version string the beating agent compiled with (Story 3.10, D-11) —
   * additive and optional: pre-D-11 rows and version-less beats are null,
   * and consumers hide their version display entirely then. Not consulted
   * by {@link resolveAgentStatus}; liveness is `sync_state`/`updated_at`'s
   * job alone.
   */
  agent_version?: string | null;
};

/**
 * A row together with the clock reading it was fetched at.
 *
 * Staleness is a function of *two* times, and pairing them at the point of the
 * read is what keeps the answer honest and reproducible. It also keeps
 * `Date.now()` out of component render entirely: the server stamps `readAtMs`
 * inside the data-access call, the client hydrates against that same number
 * (so first paint provably matches), and only a timer or a fresh fetch ever
 * moves it.
 */
export type AgentStatusSnapshot = {
  row: AgentStatusRow | null;
  readAtMs: number;
};

/**
 * How long a heartbeat stays trustworthy: 600s, i.e. exactly 2x the agent's
 * `MAX_INTERVAL` (300s) — no slack held in reserve for scheduling jitter or a
 * slow beat POST (Story 3.9 code review correction).
 *
 * The threshold is coarse because the cadence is: the beat rides
 * `sync_queue::sync_loop`, which backs off from 30s to 300s while sync is
 * failing. A tighter window would mark a healthy-but-backed-off agent dead.
 * A crisper sub-minute pulse was considered and rejected — it needs a
 * dedicated heartbeat loop, which is exactly what AD-20 exists to avoid.
 */
export const STALE_AFTER_MS = 600_000;

export type ResolvedAgentStatus = {
  state: AgentSyncState;
  /** Wall-clock ms at which this heartbeat ages out and must go quiet. */
  staleAtMs: number;
};

/**
 * Decides whether the agent is currently reporting, and what it said.
 *
 * Returns `null` for every "we don't know" case — no row, an unparseable
 * timestamp, a state string this build doesn't recognize, a clock-skewed beat
 * from the future, or a beat older than {@link STALE_AFTER_MS}. AC-2 requires
 * all of them to degrade the same way: render nothing, **never** a live state,
 * **never** a false "synced," and never a crash. Collapsing them to one `null`
 * is what makes that guarantee structural rather than a chain of `if`s at the
 * call site.
 */
export function resolveAgentStatus(
  row: AgentStatusRow | null,
  nowMs: number,
): ResolvedAgentStatus | null {
  if (!row) return null;
  if (!isAgentSyncState(row.sync_state)) return null;

  const updatedAtMs = Date.parse(row.updated_at);
  if (Number.isNaN(updatedAtMs)) return null;

  const age = nowMs - updatedAtMs;
  // Negative age = a beat stamped in the future (broken clock somewhere).
  // Trusting it would read as maximally fresh forever.
  if (age < 0) return null;
  if (age > STALE_AFTER_MS) return null;

  return { state: row.sync_state, staleAtMs: updatedAtMs + STALE_AFTER_MS };
}
