import { describe, expect, it } from "vitest";
import { isPhoneGatedPath } from "./phone-gate";

// AC-19: which paths the middleware phone gate covers. The gate itself
// (cookie + one lazy read + fail-open) lives in middleware.ts; this predicate
// is the testable scope decision.
describe("isPhoneGatedPath", () => {
  it("gates the (authenticated) group's screens", () => {
    expect(isPhoneGatedPath("/dashboard")).toBe(true);
    expect(isPhoneGatedPath("/style-evolution")).toBe(true);
    expect(isPhoneGatedPath("/library-utilization")).toBe(true);
    expect(isPhoneGatedPath("/settings")).toBe(true);
    expect(isPhoneGatedPath("/set/abc-123")).toBe(true);
    // Story 4.10 (D-35). The bare prefix is unreachable as a page — there is no
    // `/track/page.tsx` — but the gate is asserted on both forms so the day one
    // gets added it is already covered.
    expect(isPhoneGatedPath("/track/8f14e45fceea167a")).toBe(true);
    expect(isPhoneGatedPath("/track")).toBe(true);
  });

  it("gates /link-agent explicitly (a top-level route, not in the group)", () => {
    expect(isPhoneGatedPath("/link-agent")).toBe(true);
  });

  it("exempts /phone-required itself — the gate's own destination", () => {
    expect(isPhoneGatedPath("/phone-required")).toBe(false);
  });

  it("exempts /subscribe — Checkout now runs BEFORE the phone step", () => {
    // Arjun's ruling, 2026-08-16: the corridor is subscribe -> phone -> agent.
    // Phone-gating the Checkout step would invert that order and deadlock a
    // brand-new DJ, who by definition has neither a phone on file nor a
    // subscription: sent to /subscribe by the billing gate, then straight back
    // to /phone-required by this one.
    expect(isPhoneGatedPath("/subscribe")).toBe(false);
    expect(isPhoneGatedPath("/subscribe/return")).toBe(false);
  });

  it("exempts the auth surface and the public landing", () => {
    expect(isPhoneGatedPath("/")).toBe(false);
    expect(isPhoneGatedPath("/login")).toBe(false);
    expect(isPhoneGatedPath("/auth/callback")).toBe(false);
    expect(isPhoneGatedPath("/auth/confirm")).toBe(false);
    expect(isPhoneGatedPath("/auth/reset")).toBe(false);
    expect(isPhoneGatedPath("/reset-password")).toBe(false);
  });

  it("does not gate lookalike prefixes", () => {
    expect(isPhoneGatedPath("/settings-export")).toBe(false);
    expect(isPhoneGatedPath("/setlist")).toBe(false);
    expect(isPhoneGatedPath("/tracking")).toBe(false);
  });
});
