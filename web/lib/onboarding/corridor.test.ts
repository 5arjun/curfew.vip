import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  everSubscribed,
  mustSubscribeFirst,
  nextSetupStep,
  readSetupState,
  setupStepLabel,
  type SetupState,
} from "./corridor";

// The corridor's order, tested where it is actually decided. Five callers
// redirect off these predicates (both auth routes and the three corridor
// pages), and the failure they exist to prevent is not a crash — it is a DJ
// being shown the wrong screen after a real card charge.

const NEW_DJ: SetupState = {
  phone: "missing",
  subscriptionStatus: null,
  stripeCustomerId: null,
  readFailed: false,
};

const PAID: SetupState = {
  phone: "present",
  subscriptionStatus: "active",
  stripeCustomerId: "cus_live",
  readFailed: false,
};

const LAPSED: SetupState = {
  phone: "present",
  subscriptionStatus: "canceled",
  stripeCustomerId: "cus_live",
  readFailed: false,
};

const SELLS = { sellsSubscriptions: true, checkoutPending: false };

describe("everSubscribed", () => {
  it("is false only when Stripe has never met this DJ", () => {
    expect(everSubscribed({ subscriptionStatus: null, stripeCustomerId: null })).toBe(false);
    expect(everSubscribed({ subscriptionStatus: "", stripeCustomerId: null })).toBe(false);
  });

  it("is true on a customer id alone — the id outlives the status", () => {
    // The discriminator that makes /subscribe and /subscription-required
    // separate destinations. `stripe_customer_id` is written once and never
    // cleared, so it is the durable half of "has this DJ paid before".
    expect(everSubscribed({ subscriptionStatus: null, stripeCustomerId: "cus_x" })).toBe(true);
  });

  it("is true on a status alone", () => {
    expect(everSubscribed({ subscriptionStatus: "canceled", stripeCustomerId: null })).toBe(true);
    expect(everSubscribed({ subscriptionStatus: "active", stripeCustomerId: null })).toBe(true);
  });
});

describe("mustSubscribeFirst", () => {
  it("sends a brand-new DJ to Checkout — the whole point of the change", () => {
    expect(mustSubscribeFirst({ ...SELLS, state: NEW_DJ })).toBe(true);
  });

  it("lets an active or trialing subscriber straight past", () => {
    expect(mustSubscribeFirst({ ...SELLS, state: PAID })).toBe(false);
    expect(
      mustSubscribeFirst({ ...SELLS, state: { ...PAID, subscriptionStatus: "trialing" } }),
    ).toBe(false);
  });

  it("does NOT pull a lapsed subscriber into setup", () => {
    // They finished the corridor once. /subscription-required is their page,
    // and it routes to Settings where the Portal also lives.
    expect(mustSubscribeFirst({ ...SELLS, state: LAPSED })).toBe(false);
  });

  it("is inert where the environment cannot sell", () => {
    // Story 7.6 Task 0's lesson, restated for the corridor: forcing a DJ onto
    // a step whose buttons cannot exist is a closed loop. Preview and local
    // dev are exactly that environment.
    expect(
      mustSubscribeFirst({ sellsSubscriptions: false, checkoutPending: false, state: NEW_DJ }),
    ).toBe(false);
  });

  it("stands down while a Stripe-confirmed checkout is still settling", () => {
    // THE double-charge guard. Without it, a DJ returning from Stripe before
    // the webhook lands reads as "never subscribed" and is offered the CTAs
    // again — with a card that has already been charged.
    expect(
      mustSubscribeFirst({ sellsSubscriptions: true, checkoutPending: true, state: NEW_DJ }),
    ).toBe(false);
  });

  it("does not pitch on a failed read", () => {
    // Fails OPEN, deliberately inverse to the middleware paywall's fail-closed
    // posture: this decides whether to SELL, and selling a second subscription
    // to someone already paying is the expensive wrong answer. The paywall
    // still denies the dashboard on the same failed read.
    expect(
      mustSubscribeFirst({ ...SELLS, state: { ...NEW_DJ, readFailed: true } }),
    ).toBe(false);
  });
});

describe("nextSetupStep", () => {
  it("orders the corridor billing -> phone -> dashboard", () => {
    expect(nextSetupStep({ ...SELLS, state: NEW_DJ })).toBe("/subscribe");
    expect(
      nextSetupStep({ ...SELLS, state: { ...PAID, phone: "missing" } }),
    ).toBe("/phone-required");
    expect(nextSetupStep({ ...SELLS, state: PAID })).toBe("/dashboard");
  });

  it("puts billing AHEAD of the phone step (the 2026-08-16 flip)", () => {
    // A phone-less, never-subscribed DJ went to /phone-required until today
    // and goes to /subscribe now. This is the assertion that fails if anyone
    // restores the old precedence.
    expect(nextSetupStep({ ...SELLS, state: NEW_DJ })).toBe("/subscribe");
  });

  it("keeps the old order where billing is switched off", () => {
    expect(
      nextSetupStep({ sellsSubscriptions: false, checkoutPending: false, state: NEW_DJ }),
    ).toBe("/phone-required");
  });

  it("sends a lapsed DJ to the dashboard and lets the paywall place them", () => {
    // Not /subscription-required from here: ONE module decides what "no
    // access" looks like, and it is the middleware gate.
    expect(nextSetupStep({ ...SELLS, state: LAPSED })).toBe("/dashboard");
  });

  it("never returns /welcome — it is reached by finishing the phone step", () => {
    const steps = [NEW_DJ, PAID, LAPSED, { ...PAID, phone: "missing" as const }].map((state) =>
      nextSetupStep({ ...SELLS, state }),
    );
    expect(steps).not.toContain("/welcome");
  });
});

describe("setupStepLabel", () => {
  it("counts three steps where billing is live", () => {
    expect(setupStepLabel("subscribe", true)).toBe("Set up — step 1 of 3");
    expect(setupStepLabel("phone", true)).toBe("Set up — step 2 of 3");
    expect(setupStepLabel("agent", true)).toBe("Set up — step 3 of 3");
  });

  it("counts two where /subscribe is skipped", () => {
    // The version every developer sees locally. A hardcoded "of 3" would
    // count a step that environment never shows.
    expect(setupStepLabel("phone", false)).toBe("Set up — step 1 of 2");
    expect(setupStepLabel("agent", false)).toBe("Set up — step 2 of 2");
  });
});

// A minimal `.from().select().eq().single()` stub — the same shape the other
// gate tests build, kept local so this file needs no Supabase instance.
function stubClient(result: { data?: unknown; error?: unknown }): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe("readSetupState", () => {
  it("reads all three facts from one row", () => {
    return expect(
      readSetupState(
        stubClient({
          data: {
            phone: "+15551234567",
            subscription_status: "active",
            stripe_customer_id: "cus_x",
          },
        }),
        "dj-1",
      ),
    ).resolves.toEqual({
      phone: "present",
      subscriptionStatus: "active",
      stripeCustomerId: "cus_x",
      readFailed: false,
    });
  });

  it("reports a blank phone as missing, not as a read failure", async () => {
    const state = await readSetupState(
      stubClient({ data: { phone: null, subscription_status: null, stripe_customer_id: null } }),
      "dj-1",
    );
    expect(state.phone).toBe("missing");
    expect(state.readFailed).toBe(false);
  });

  it("flags a query error as readFailed rather than guessing", async () => {
    const state = await readSetupState(stubClient({ error: { message: "boom" } }), "dj-1");
    expect(state.readFailed).toBe(true);
    expect(state.phone).toBe("unknown");
  });

  it("flags a missing row as readFailed", async () => {
    const state = await readSetupState(stubClient({ data: null }), "dj-1");
    expect(state.readFailed).toBe(true);
  });

  it("survives a thrown client error", async () => {
    const throwing = {
      from: () => {
        throw new Error("network");
      },
    } as unknown as SupabaseClient;
    await expect(readSetupState(throwing, "dj-1")).resolves.toMatchObject({ readFailed: true });
  });
});
