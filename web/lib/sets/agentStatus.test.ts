import { describe, expect, it } from "vitest";
import {
  AGENT_SYNC_STATES,
  STALE_AFTER_MS,
  isAgentSyncState,
  resolveAgentStatus,
} from "./agentStatus";

const NOW = Date.parse("2026-08-05T22:00:00.000Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("STALE_AFTER_MS", () => {
  it("is exactly 600s — 2x the agent's MAX_INTERVAL backoff, no slack", () => {
    // The agent's sync_loop backs off to MAX_INTERVAL = 300s while failing, and
    // the heartbeat rides that tick (beat-on-idle ruling, 2026-08-05). Anything
    // at or below 300s would call a healthy-but-backed-off agent dead.
    expect(STALE_AFTER_MS).toBe(2 * 300_000);
  });
});

describe("isAgentSyncState", () => {
  it("accepts exactly the six TrayState wire strings", () => {
    // These must stay identical to agent/src-tauri/src/tray.rs::wire_state and
    // to the allow-list inside the set_agent_status RPC.
    expect([...AGENT_SYNC_STATES]).toEqual([
      "Idle",
      "Syncing",
      "Failed",
      "DriveNotConnected",
      "Queued",
      "FormatDriftPaused",
    ]);
    for (const state of AGENT_SYNC_STATES) {
      expect(isAgentSyncState(state)).toBe(true);
    }
  });

  it("rejects anything else, including near-misses", () => {
    expect(isAgentSyncState("idle")).toBe(false);
    expect(isAgentSyncState("Drive_Not_Connected")).toBe(false);
    expect(isAgentSyncState("")).toBe(false);
    expect(isAgentSyncState("SomeStateShippedByANewerAgent")).toBe(false);
  });
});

describe("resolveAgentStatus", () => {
  it("returns null when there is no row at all (no agent has ever beaten)", () => {
    expect(resolveAgentStatus(null, NOW)).toBeNull();
  });

  it("resolves a fresh heartbeat to its state", () => {
    const resolved = resolveAgentStatus({ sync_state: "Queued", updated_at: iso(5_000) }, NOW);
    expect(resolved?.state).toBe("Queued");
  });

  it("reports when the fresh row will age out, so the caller can go quiet on time", () => {
    const updatedAt = iso(5_000);
    const resolved = resolveAgentStatus({ sync_state: "Queued", updated_at: updatedAt }, NOW);
    expect(resolved?.staleAtMs).toBe(Date.parse(updatedAt) + STALE_AFTER_MS);
  });

  it("still resolves a row that is exactly at the staleness boundary", () => {
    // Boundary belongs to "still reporting": the agent that beat exactly
    // STALE_AFTER ago has not yet missed its window.
    const resolved = resolveAgentStatus(
      { sync_state: "Failed", updated_at: iso(STALE_AFTER_MS) },
      NOW,
    );
    expect(resolved?.state).toBe("Failed");
  });

  it("treats a heartbeat older than STALE_AFTER exactly like null — never a live state", () => {
    // AC-2: a stale heartbeat degrades gracefully. It must NOT render as the
    // last-known state, which would be the dashboard confidently reporting on
    // an agent that stopped talking hours ago.
    expect(resolveAgentStatus({ sync_state: "Queued", updated_at: iso(STALE_AFTER_MS + 1) }, NOW))
      .toBeNull();
    expect(
      resolveAgentStatus({ sync_state: "Failed", updated_at: iso(72 * 60 * 60 * 1000) }, NOW),
    ).toBeNull();
  });

  it("never renders a stale heartbeat as a false 'synced'", () => {
    // The specific failure AC-2 names: an Idle beat going stale must resolve to
    // "not reporting", not to the calm all-clear that Idle normally means.
    const stale = resolveAgentStatus(
      { sync_state: "Idle", updated_at: iso(STALE_AFTER_MS + 60_000) },
      NOW,
    );
    expect(stale).toBeNull();
  });

  it("returns null rather than throwing on an unparseable timestamp", () => {
    expect(resolveAgentStatus({ sync_state: "Queued", updated_at: "not a date" }, NOW)).toBeNull();
    expect(resolveAgentStatus({ sync_state: "Queued", updated_at: "" }, NOW)).toBeNull();
  });

  it("returns null rather than throwing on a state string it does not know", () => {
    // Forward-compatibility: a newer agent shipping a seventh TrayState must
    // make the dashboard go quiet, not crash it or render a raw enum name.
    expect(
      resolveAgentStatus({ sync_state: "SomethingNewerAgentsSend", updated_at: iso(1_000) }, NOW),
    ).toBeNull();
  });

  it("returns null for a clock-skewed heartbeat from the future rather than trusting it", () => {
    // A beat stamped in the future is a broken clock somewhere; age would go
    // negative and read as maximally fresh. Refuse it instead.
    expect(
      resolveAgentStatus({ sync_state: "Failed", updated_at: iso(-60 * 60 * 1000) }, NOW),
    ).toBeNull();
  });

  it("resolves every one of the six states when fresh — filtering is the renderer's job", () => {
    // This module answers "is the agent reporting, and what did it say"; which
    // states reach the dashboard (DriveNotConnected does not) is decided in the
    // copy layer, not here.
    for (const state of AGENT_SYNC_STATES) {
      expect(resolveAgentStatus({ sync_state: state, updated_at: iso(1_000) }, NOW)?.state).toBe(
        state,
      );
    }
  });
});
