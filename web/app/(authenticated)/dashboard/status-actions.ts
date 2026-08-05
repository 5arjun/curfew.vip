"use server";

import { getAgentStatus } from "@/lib/sets";
import type { AgentStatusSnapshot } from "@/lib/sets/agentStatus";

/**
 * Re-reads the agent-status heartbeat for the live status region (Story 3.9,
 * Task 4 — AC-2's "updates without a full reload").
 *
 * **Live-update mechanism: focus + visible-tab poll, not Supabase Realtime —
 * documented choice (the story explicitly permits either).** Realtime would
 * mean this codebase's first `postgres_changes` subscription, a publication
 * change on `agent_status`, and client-side session-token plumbing, in
 * exchange for latency the signal cannot actually use: the agent beats every
 * 30s at best and every 300s while backing off, and the dashboard's staleness
 * window is 600s. A ~60s poll is already finer-grained than the thing it
 * observes. Revisit if a crisper pulse ever lands (it would need the dedicated
 * heartbeat loop AD-20 exists to avoid).
 *
 * Routing the refresh through a server action rather than a client-side
 * Supabase query keeps `getAgentStatus` the single place that touches the
 * table, so RLS, the null-on-anything-unknown contract, and the eventual
 * read-path swap all stay in one file.
 */
export async function fetchAgentStatusAction(): Promise<AgentStatusSnapshot> {
  return getAgentStatus();
}
