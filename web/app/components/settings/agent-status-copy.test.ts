import { describe, expect, it } from "vitest";
import { AGENT_SYNC_STATES, STALE_AFTER_MS } from "@/lib/sets/agentStatus";
import {
  NO_AGENT_COPY,
  SETTINGS_AGENT_STATE_COPY,
  relativeBeatAge,
  settingsAgentLine,
} from "./agent-status-copy";

const NOW = Date.parse("2026-08-06T04:00:00Z");

function snapshotAgedMs(ageMs: number, syncState = "Idle", agentVersion?: string) {
  return {
    row: {
      sync_state: syncState,
      updated_at: new Date(NOW - ageMs).toISOString(),
      ...(agentVersion !== undefined ? { agent_version: agentVersion } : {}),
    },
    readAtMs: NOW,
  };
}

// AC-12: the row ALWAYS speaks — every wire state plus both null cases must
// produce a non-empty line, never silence.
describe("settingsAgentLine", () => {
  it("has a line for every wire state (the always-speaks contract)", () => {
    for (const state of AGENT_SYNC_STATES) {
      const line = settingsAgentLine(snapshotAgedMs(120_000, state));
      expect(line.kind).toBe("live");
      expect(line.text).toContain(SETTINGS_AGENT_STATE_COPY[state]);
      expect(line.text.length).toBeGreaterThan(0);
    }
  });

  it("speaks for a fresh Idle — unlike the silence-first dashboard banner", () => {
    expect(settingsAgentLine(snapshotAgedMs(120_000, "Idle")).text).toBe("Up to date · 2 min ago");
  });

  it("speaks DriveNotConnected — EXPERIENCE.md scopes that state to tray + Settings", () => {
    expect(settingsAgentLine(snapshotAgedMs(60_000, "DriveNotConnected")).text).toBe(
      "Archive unreachable. Reconnect drive to resume. · 1 min ago",
    );
  });

  it("renders a stale beat as its age in a calm register", () => {
    const fourDays = 4 * 24 * 60 * 60 * 1000;
    const line = settingsAgentLine(snapshotAgedMs(fourDays, "Idle"));
    expect(line).toEqual({ text: "Last beat 4 days ago", kind: "stale" });
  });

  it("treats a beat just past the staleness window as stale, not live", () => {
    const line = settingsAgentLine(snapshotAgedMs(STALE_AFTER_MS + 1000, "Syncing"));
    expect(line.kind).toBe("stale");
  });

  it("renders never-seen (no row) as No agent linked", () => {
    expect(settingsAgentLine({ row: null, readAtMs: NOW })).toEqual({
      text: NO_AGENT_COPY,
      kind: "none",
    });
  });

  it("falls back to No agent linked for an unparseable timestamp", () => {
    const line = settingsAgentLine({
      row: { sync_state: "Idle", updated_at: "not-a-date" },
      readAtMs: NOW,
    });
    expect(line).toEqual({ text: NO_AGENT_COPY, kind: "none" });
  });

  it("falls back to No agent linked for a future-stamped beat (broken clock)", () => {
    const line = settingsAgentLine(snapshotAgedMs(-60_000, "Idle"));
    expect(line).toEqual({ text: NO_AGENT_COPY, kind: "none" });
  });

  it("renders an unrecognized state as its beat age, never the raw string", () => {
    const line = settingsAgentLine(snapshotAgedMs(30_000, "SomeFutureState"));
    expect(line.text).not.toContain("SomeFutureState");
    expect(line.text).toBe("Last beat moments ago");
  });
});

describe("relativeBeatAge", () => {
  it("rounds to the coarse liveness register", () => {
    expect(relativeBeatAge(10_000)).toBe("moments ago");
    expect(relativeBeatAge(90_000)).toBe("1 min ago");
    expect(relativeBeatAge(3 * 60 * 60 * 1000)).toBe("3 hr ago");
    expect(relativeBeatAge(24 * 60 * 60 * 1000)).toBe("1 day ago");
    expect(relativeBeatAge(9 * 24 * 60 * 60 * 1000)).toBe("9 days ago");
  });
});
