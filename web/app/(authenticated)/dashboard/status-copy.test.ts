import { describe, expect, it } from "vitest";
import { AGENT_SYNC_STATES } from "@/lib/sets/agentStatus";
import { AGENT_STATUS_COPY, AGENT_SYNCING_COPY, agentStatusLine } from "./status-copy";

describe("AGENT_STATUS_COPY", () => {
  it("quotes the EXPERIENCE.md Failure Register verbatim", () => {
    // Character-exact, including the curly apostrophe in "you're" —
    // paraphrasing here is the specific thing UX-DR18 forbids. The em dashes
    // the Register originally carried were removed product-wide (2026-08-19,
    // Arjun: no em dash anywhere a DJ can see one); the sentences are
    // otherwise untouched.
    expect(AGENT_STATUS_COPY.Queued).toBe("Queued. Will sync when you're back online.");
    expect(AGENT_STATUS_COPY.Failed).toBe("Sync interrupted. Retrying automatically.");
    expect(AGENT_STATUS_COPY.FormatDriftPaused).toBe(
      "Format change detected. Sync paused until verified.",
    );
  });

  it("quotes the Voice and Tone activity indicator verbatim", () => {
    expect(AGENT_SYNCING_COPY).toBe("Session: Syncing…");
  });

  it("carries no exclamation points anywhere (console voice, never an alarm)", () => {
    for (const line of [...Object.values(AGENT_STATUS_COPY), AGENT_SYNCING_COPY]) {
      expect(line).not.toContain("!");
    }
  });

  it("carries no celebratory language (SM-C2, non-negotiable)", () => {
    const banned = /streak|crushing|awesome|great job|nice work|congrats|milestone|🔥|🎉/i;
    for (const line of [...Object.values(AGENT_STATUS_COPY), AGENT_SYNCING_COPY]) {
      expect(line).not.toMatch(banned);
    }
  });
});

describe("agentStatusLine", () => {
  it("maps the three Failure-Register states to their exact lines", () => {
    expect(agentStatusLine("Queued")).toEqual({
      text: "Queued. Will sync when you're back online.",
      tone: "report",
    });
    expect(agentStatusLine("Failed")).toEqual({
      text: "Sync interrupted. Retrying automatically.",
      tone: "report",
    });
    expect(agentStatusLine("FormatDriftPaused")).toEqual({
      text: "Format change detected. Sync paused until verified.",
      tone: "report",
    });
  });

  it("maps Syncing to the quiet activity indicator, not a failure line", () => {
    expect(agentStatusLine("Syncing")).toEqual({
      text: "Session: Syncing…",
      tone: "activity",
    });
  });

  it("resolves Idle to silence — a healthy agent is not news", () => {
    expect(agentStatusLine("Idle")).toBeNull();
  });

  it("resolves DriveNotConnected to silence — the spec scopes it to tray + Settings", () => {
    // Guard against a well-meaning future change that "completes" the state
    // table by adding a fourth dashboard line. EXPERIENCE.md State Patterns
    // deliberately does not put this one here.
    expect(agentStatusLine("DriveNotConnected")).toBeNull();
  });

  it("handles every known state without throwing", () => {
    for (const state of AGENT_SYNC_STATES) {
      expect(() => agentStatusLine(state)).not.toThrow();
    }
  });

  it("surfaces exactly three states as reports and one as activity", () => {
    const lines = AGENT_SYNC_STATES.map(agentStatusLine);
    expect(lines.filter((l) => l?.tone === "report")).toHaveLength(3);
    expect(lines.filter((l) => l?.tone === "activity")).toHaveLength(1);
    expect(lines.filter((l) => l === null)).toHaveLength(2);
  });
});
