import { describe, expect, it } from "vitest";
import { resolveApiKey } from "./stripe";

// Which Stripe API key this app uses, and why there are two names for it.
// `STRIPE_SECRET_KEY` is owned by the Vercel Marketplace integration;
// `STRIPE_RESTRICTED_KEY` is ours and wins when present, so hardening to a
// restricted key never means hand-editing a variable the integration may
// resync. The client construction itself isn't tested — that's Stripe's SDK.

describe("resolveApiKey", () => {
  it("prefers our restricted key over the integration's secret key", () => {
    expect(
      resolveApiKey({ STRIPE_RESTRICTED_KEY: "rk_test_ours", STRIPE_SECRET_KEY: "sk_test_theirs" }),
    ).toBe("rk_test_ours");
  });

  it("falls back to the integration's key when no restricted key is set", () => {
    expect(resolveApiKey({ STRIPE_SECRET_KEY: "sk_test_theirs" })).toBe("sk_test_theirs");
  });

  it("treats a blank restricted key as unset rather than as configured", () => {
    // The realistic misconfiguration is an env line with no value. Falling
    // through keeps the app working; honouring "" would send an empty key to
    // Stripe and fail every call with an opaque 401.
    expect(
      resolveApiKey({ STRIPE_RESTRICTED_KEY: "", STRIPE_SECRET_KEY: "sk_test_theirs" }),
    ).toBe("sk_test_theirs");
  });

  it("throws, naming both variables, when neither is configured", () => {
    expect(() => resolveApiKey({})).toThrow(/STRIPE_RESTRICTED_KEY/);
    expect(() => resolveApiKey({})).toThrow(/STRIPE_SECRET_KEY/);
    expect(() => resolveApiKey({ STRIPE_RESTRICTED_KEY: "", STRIPE_SECRET_KEY: "" })).toThrow(
      /Missing/,
    );
  });
});
