// Settings Agent-section copy (Story 3.10, AC-12 / D-10, spec 3c).
//
// Unlike the dashboard's silence-first banner, THIS ROW ALWAYS SPEAKS — on a
// settings screen "no news" is indistinguishable from "broken." So this map
// is exhaustive: all six wire states when the heartbeat is fresh, plus both
// meanings of the resolver's `null` (a beat that aged out vs. an agent never
// seen at all). `agentStatusLine` (dashboard) deliberately returns null for
// Idle/DriveNotConnected and CANNOT be reused here; the resolver
// (`resolveAgentStatus`) is reused so the two surfaces can never disagree
// about what the agent said — only about whether silence is allowed.
//
// Register: calm console voice throughout. Never an alarm color (that is the
// component's job to honor; this module only hands back text).
import {
  resolveAgentStatus,
  type AgentStatusSnapshot,
  type AgentSyncState,
} from "@/lib/sets/agentStatus";

/**
 * Failure lines stay verbatim from the dashboard's Failure Register copy
 * (status-copy.ts) — one product voice, quoted not paraphrased. The two
 * states the dashboard renders as silence get their own lines here:
 * Idle speaks an "up to date" register (not a celebration), and
 * DriveNotConnected uses EXPERIENCE.md's reconnect line — the State Patterns
 * table scopes that state to "tray + Settings", so this row is exactly where
 * it surfaces.
 */
export const SETTINGS_AGENT_STATE_COPY: Record<AgentSyncState, string> = {
  Idle: "Up to date",
  Syncing: "Syncing…",
  Queued: "Queued — will sync when you're back online.",
  Failed: "Sync interrupted. Retrying automatically.",
  DriveNotConnected: "Archive unreachable — reconnect drive to resume.",
  FormatDriftPaused: "Format change detected — sync paused until verified.",
};

export const NO_AGENT_COPY = "No agent linked";

export type SettingsAgentLine = {
  text: string;
  /**
   * `none` = no agent has ever beaten (render the Link-agent emphasis);
   * `stale`/`live` drive nothing today beyond tests documenting intent.
   */
  kind: "live" | "stale" | "none";
};

/**
 * Compact relative age for the status row ("2 min ago", "3 days ago").
 * Coarse on purpose — a liveness readout, not a stopwatch.
 */
export function relativeBeatAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "moments ago";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/**
 * The line the Settings Agent row shows. Exhaustive by construction:
 * - fresh heartbeat → the state's line, suffixed with the beat's age
 * - resolver-null with a parseable past timestamp → `Last beat N ago`
 * - resolver-null otherwise (never seen, unparseable, future-stamped,
 *   unknown state) → `No agent linked` — the honest floor when nothing
 *   trustworthy was ever said.
 */
export function settingsAgentLine(snapshot: AgentStatusSnapshot): SettingsAgentLine {
  const resolved = resolveAgentStatus(snapshot.row, snapshot.readAtMs);

  if (resolved) {
    const updatedAtMs = Date.parse(snapshot.row!.updated_at);
    const age = relativeBeatAge(snapshot.readAtMs - updatedAtMs);
    return { text: `${SETTINGS_AGENT_STATE_COPY[resolved.state]} · ${age}`, kind: "live" };
  }

  const updatedAtMs = snapshot.row ? Date.parse(snapshot.row.updated_at) : Number.NaN;
  const age = snapshot.readAtMs - updatedAtMs;
  if (!Number.isNaN(updatedAtMs) && age > 0) {
    return { text: `Last beat ${relativeBeatAge(age)}`, kind: "stale" };
  }

  return { text: NO_AGENT_COPY, kind: "none" };
}
