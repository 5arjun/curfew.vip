import { describe, expect, it } from "vitest";
import { RECOVERY_MAX_AGE_MS, hasRecentInboxProof } from "./recovery";

// Review ruling (2026-08-05): updatePassword only honors sessions with a
// recent inbox-proof AMR entry — a password/oauth session (the theft
// surface) must not be able to set a new password.

const NOW = 1_800_000_000_000;
const fresh = Math.floor((NOW - 60_000) / 1000);
const stale = Math.floor((NOW - RECOVERY_MAX_AGE_MS - 60_000) / 1000);

describe("hasRecentInboxProof", () => {
  it("accepts a fresh recovery/otp/magiclink grant", () => {
    for (const method of ["recovery", "otp", "magiclink"]) {
      expect(hasRecentInboxProof([{ method, timestamp: fresh }], NOW)).toBe(true);
    }
  });

  it("rejects password and oauth grants — the session-theft surface", () => {
    expect(hasRecentInboxProof([{ method: "password", timestamp: fresh }], NOW)).toBe(false);
    expect(hasRecentInboxProof([{ method: "oauth", timestamp: fresh }], NOW)).toBe(false);
  });

  it("rejects an aged-out inbox proof", () => {
    expect(hasRecentInboxProof([{ method: "recovery", timestamp: stale }], NOW)).toBe(false);
  });

  it("finds the proof among other grants", () => {
    const amr = [
      { method: "password", timestamp: stale },
      { method: "recovery", timestamp: fresh },
    ];
    expect(hasRecentInboxProof(amr, NOW)).toBe(true);
  });

  it("rejects missing/malformed claims", () => {
    expect(hasRecentInboxProof(undefined, NOW)).toBe(false);
    expect(hasRecentInboxProof(null, NOW)).toBe(false);
    expect(hasRecentInboxProof("recovery", NOW)).toBe(false);
    expect(hasRecentInboxProof([{ method: "recovery" }], NOW)).toBe(false);
    expect(hasRecentInboxProof([{ timestamp: fresh }], NOW)).toBe(false);
  });
});
