// Failure Register / State Patterns strings for the dashboard's agent-status
// region (EXPERIENCE.md, "Sync offline" / "Sync failed" / "Format-drift" rows
// plus the Voice and Tone table) — quoted verbatim, not paraphrased
// (UX-DR18/UX-DR19), same discipline as `web/app/login/auth-copy.ts`.
//
// Console voice: calm, technical, no exclamation points anywhere in the
// failure branch, and **silence when there is nothing to report**.
import type { AgentSyncState } from "@/lib/sets/agentStatus";

/**
 * The three states the spec places on "Dashboard status". Every other state is
 * deliberately absent — see {@link agentStatusLine} for what that absence means.
 */
export const AGENT_STATUS_COPY = {
  Queued: "Queued. Will sync when you're back online.",
  Failed: "Sync interrupted. Retrying automatically.",
  FormatDriftPaused: "Format change detected. Sync paused until verified.",
} as const;

/**
 * The quiet activity indicator, straight from EXPERIENCE.md's Voice and Tone
 * table. Not a failure line and not styled like one — it is the console
 * narrating itself while something is actually happening.
 */
export const AGENT_SYNCING_COPY = "Session: Syncing…";

export type AgentStatusLine = {
  text: string;
  /**
   * `report` = one of the three Failure-Register lines. `activity` = the quiet
   * "Session: Syncing…" indicator. Drives register/emphasis only — neither is
   * an alarm, and neither ever takes an alarm colour.
   */
  tone: "report" | "activity";
};

/**
 * Maps a *fresh* agent state to the line the dashboard shows, or `null` for
 * silence.
 *
 * Two states resolve to silence on purpose, for different reasons:
 * - `Idle` — nothing is happening; the console says nothing rather than
 *   announcing an all-clear. This is the no-celebration invariant (SM-C2)
 *   applied to status: "synced fine" is not news.
 * - `DriveNotConnected` — real, but the UX spec scopes it to **tray +
 *   Settings only** (EXPERIENCE.md State Patterns). The dashboard deliberately
 *   does not duplicate it, so this must not be "fixed" by adding a fourth line.
 *
 * A stale or missing heartbeat never reaches this function at all — it is
 * resolved to `null` upstream by `resolveAgentStatus`, so "not reporting" and
 * "nothing to report" render identically: as nothing.
 */
export function agentStatusLine(state: AgentSyncState): AgentStatusLine | null {
  switch (state) {
    case "Queued":
    case "Failed":
    case "FormatDriftPaused":
      return { text: AGENT_STATUS_COPY[state], tone: "report" };
    case "Syncing":
      return { text: AGENT_SYNCING_COPY, tone: "activity" };
    case "Idle":
    case "DriveNotConnected":
      return null;
  }
}
