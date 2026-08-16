import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSubscriptionGatedPath, readSubscriptionStatus } from "./subscription-gate";

// AC-1: which paths the middleware subscription gate covers. The gate itself
// (the uncached read + fail-closed redirect) lives in middleware.ts; this
// predicate is the testable scope decision — and its EXCLUSIONS are the
// load-bearing half, not an afterthought (see the /settings case below).
describe("isSubscriptionGatedPath", () => {
  it("gates the dashboard/stats screens", () => {
    expect(isSubscriptionGatedPath("/dashboard")).toBe(true);
    expect(isSubscriptionGatedPath("/style-evolution")).toBe(true);
    expect(isSubscriptionGatedPath("/library-utilization")).toBe(true);
    expect(isSubscriptionGatedPath("/set")).toBe(true);
    expect(isSubscriptionGatedPath("/track")).toBe(true);
  });

  it("gates dynamic segments under /set and /track", () => {
    expect(isSubscriptionGatedPath("/set/abc-123")).toBe(true);
    expect(isSubscriptionGatedPath("/track/8f14e45fceea167a")).toBe(true);
  });

  it("does NOT gate /settings — a lapsed DJ must be able to resubscribe", () => {
    // The whole recovery path. BillingSection (Story 7.2/7.4) lives here; gate
    // it and a lapsed DJ is stranded with no way back. Asserted explicitly so
    // a future "be thorough, add the phone gate's full list" edit fails here.
    expect(isSubscriptionGatedPath("/settings")).toBe(false);
    expect(isSubscriptionGatedPath("/settings/anything")).toBe(false);
  });

  it("does NOT gate /link-agent — onboarding, and agent-adjacent (AD-19)", () => {
    expect(isSubscriptionGatedPath("/link-agent")).toBe(false);
  });

  it("exempts /subscription-required itself — the gate's own destination", () => {
    expect(isSubscriptionGatedPath("/subscription-required")).toBe(false);
  });

  it("exempts the auth surface and the public landing", () => {
    expect(isSubscriptionGatedPath("/")).toBe(false);
    expect(isSubscriptionGatedPath("/login")).toBe(false);
    expect(isSubscriptionGatedPath("/phone-required")).toBe(false);
    expect(isSubscriptionGatedPath("/welcome")).toBe(false);
    expect(isSubscriptionGatedPath("/auth/callback")).toBe(false);
    expect(isSubscriptionGatedPath("/auth/confirm")).toBe(false);
    expect(isSubscriptionGatedPath("/auth/reset")).toBe(false);
    expect(isSubscriptionGatedPath("/reset-password")).toBe(false);
  });

  it("does not gate lookalike prefixes", () => {
    expect(isSubscriptionGatedPath("/settings-export")).toBe(false);
    expect(isSubscriptionGatedPath("/setlist")).toBe(false);
    expect(isSubscriptionGatedPath("/tracking")).toBe(false);
    expect(isSubscriptionGatedPath("/dashboards")).toBe(false);
  });

  it("gates nothing under /api — the sync contract is never paywalled (AD-19)", () => {
    // Structural today (no /api/sets route exists in the Next tree at all —
    // AD-4's endpoint is Postgres-side), but asserted so a prefix added here
    // can never widen into the sync path by accident.
    expect(isSubscriptionGatedPath("/api/billing/webhook")).toBe(false);
    expect(isSubscriptionGatedPath("/api/sets/abc-123")).toBe(false);
  });
});

/** Minimal stand-in for the one chained call the reader makes. */
function stubClient(result: {
  data?: { subscription_status: string | null } | null;
  error?: unknown;
  throws?: boolean;
}): SupabaseClient {
  const seen: string[] = [];
  const client = {
    seen,
    from(table: string) {
      seen.push(table);
      return {
        select(columns: string) {
          seen.push(columns);
          return {
            eq(column: string, value: string) {
              seen.push(`${column}=${value}`);
              return {
                async single() {
                  if (result.throws) throw new Error("network");
                  return { data: result.data ?? null, error: result.error ?? null };
                },
              };
            },
          };
        },
      };
    },
  };
  return client as unknown as SupabaseClient;
}

// Task 3.1/3.3: this gate issues its OWN read (never shares the phone gate's)
// and fails CLOSED — the inverse of the phone gate's fail-open, because a
// paywall invariant must not leak access on a transient DB hiccup.
describe("readSubscriptionStatus", () => {
  it("returns the DJ's verbatim Stripe status", async () => {
    const supabase = stubClient({ data: { subscription_status: "active" } });
    expect(await readSubscriptionStatus(supabase, "dj-1")).toBe("active");
  });

  it("reads only subscription_status, scoped to the caller's own id", async () => {
    const supabase = stubClient({ data: { subscription_status: "past_due" } });
    await readSubscriptionStatus(supabase, "dj-1");
    expect((supabase as unknown as { seen: string[] }).seen).toEqual([
      "djs",
      "subscription_status",
      "id=dj-1",
    ]);
  });

  it("returns null for a DJ who never subscribed", async () => {
    const supabase = stubClient({ data: { subscription_status: null } });
    expect(await readSubscriptionStatus(supabase, "dj-1")).toBe(null);
  });

  it("fails closed on a query error", async () => {
    const supabase = stubClient({ error: { message: "boom" } });
    expect(await readSubscriptionStatus(supabase, "dj-1")).toBe(null);
  });

  it("fails closed on a missing djs row", async () => {
    const supabase = stubClient({ data: null });
    expect(await readSubscriptionStatus(supabase, "dj-1")).toBe(null);
  });

  it("fails closed on a thrown error rather than propagating", async () => {
    const supabase = stubClient({ throws: true });
    expect(await readSubscriptionStatus(supabase, "dj-1")).toBe(null);
  });
});
