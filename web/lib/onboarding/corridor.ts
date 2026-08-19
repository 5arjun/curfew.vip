import type { SupabaseClient } from "@supabase/supabase-js";
import { hasWebAccess } from "@/lib/billing/access";
import type { PhoneOnFile } from "@/lib/supabase/phone-gate";

// ─── The setup corridor's ordering (Arjun's ruling, 2026-08-16) ────────────
//
// Curfew became a paid product at signup, not a free account that meets a
// paywall later. The corridor a brand-new DJ walks is now three steps, and
// **billing is the first of them**:
//
//   sign in  ->  /subscribe  ->  /phone-required  ->  /welcome  ->  /dashboard
//                (Stripe)        (contactability)    (the agent)
//
// That order is the ruling, not an inherited default. Until today billing was
// deliberately NOT in this corridor at all — middleware.ts still carries the
// sentence "billing is a Settings-initiated action, never a forced onboarding
// step" as the reason the phone gate ran first. It is a forced step now, and
// it runs first, so the phone gate's precedence in middleware.ts flipped to
// match. The cost of that flip is recorded rather than glossed: a DJ who
// abandons Stripe leaves no phone number behind, so there is no way to reach
// them. That was the accepted trade for putting the card before the form.
//
// Three modules already answer pieces of "may this DJ be here" — phone-gate.ts
// (contactability), subscription-gate.ts (the dashboard paywall), access.ts
// (the paywall's one predicate). None of them answers "which step of setup is
// this DJ ON", which is a different question with five callers: both auth
// routes, and the three corridor pages' own server guards. That question lives
// here, pure, so the corridor's order is stated once instead of re-derived in
// five redirect chains that can drift apart.

/**
 * Marks "this browser just completed a Stripe Checkout Session that Stripe
 * itself confirmed as `complete`" — set by `/subscribe/return` and read by the
 * corridor's guards.
 *
 * It exists for one race and no other: `subscription_status` is written ONLY
 * by Story 7.3's webhook (AD-19), and the DJ's browser comes back from Stripe
 * over a redirect that can — and in practice sometimes does — beat that
 * webhook. Without this marker, the corridor's own guards would read a still-
 * null status, conclude "never subscribed", and bounce the DJ who just paid
 * back onto /subscribe, where the CTAs would invite them to pay a SECOND time.
 *
 * Spoofable, and acceptably so — the same judgment PHONE_ON_FILE_COOKIE
 * records for itself, but the blast radius here is smaller and worth being
 * precise about. This cookie can only:
 *
 *   - suppress the Subscribe CTAs (it never reveals them), and
 *   - let a DJ read /welcome, whose only payload is AGENT_DOWNLOAD_URL — a
 *     public URL, on a page for an agent that AD-19 says must never be
 *     subscription-gated anyway.
 *
 * What it explicitly canNOT do is open the dashboard. That gate is
 * middleware.ts's, it reads the database and nothing else, and no cookie is
 * consulted there. Forging this cookie buys a spinner and a download link the
 * marketing site would hand over for free.
 */
export const CHECKOUT_PENDING_COOKIE = "curfew_checkout_pending";

/** 30 minutes: long enough that a webhook outage doesn't strand a DJ who paid
 *  mid-corridor, short enough that it can't quietly become a standing exempt-
 *  ion. Once the webhook lands, `hasWebAccess` short-circuits every read of
 *  this cookie anyway, so the TTL only ever governs the failure case. */
export const CHECKOUT_PENDING_MAX_AGE = 60 * 30;

/**
 * The DJ's setup-relevant row, read once. Deliberately ONE query for all three
 * facts, which is the opposite of the discipline subscription-gate.ts keeps
 * for the middleware paywall ("each concern owns its query") — and the
 * difference is the point. There, two gates with two different failure
 * postures (fail-open vs fail-closed) must not share a failure. Here there is
 * one decision with one posture, taken once per page render, so a second
 * round-trip would buy nothing but latency on the hottest path a new DJ walks.
 */
export type SetupState = {
  phone: PhoneOnFile;
  subscriptionStatus: string | null;
  stripeCustomerId: string | null;
  /** True when the `djs` read failed outright — NOT the same as "no
   *  subscription", and the corridor treats it very differently. */
  readFailed: boolean;
};

export async function readSetupState(
  supabase: SupabaseClient,
  userId: string,
): Promise<SetupState> {
  const failed: SetupState = {
    phone: "unknown",
    subscriptionStatus: null,
    stripeCustomerId: null,
    readFailed: true,
  };

  try {
    const { data, error } = await supabase
      .from("djs")
      .select("phone, subscription_status, stripe_customer_id")
      .eq("id", userId)
      .single();

    if (error || !data) return failed;

    return {
      phone: data.phone ? "present" : "missing",
      subscriptionStatus: data.subscription_status ?? null,
      stripeCustomerId: data.stripe_customer_id ?? null,
      readFailed: false,
    };
  } catch {
    return failed;
  }
}

/**
 * Whether a Stripe subscription has EVER been attached to this DJ — which is
 * the question that splits the two "you can't be here" destinations apart:
 *
 *   - never subscribed -> `/subscribe`, the corridor step, which sells.
 *   - subscribed before -> `/subscription-required`, which does not sell and
 *     instead points at Settings, where a lapsed DJ finds both the Subscribe
 *     CTA and the Portal.
 *
 * Before today both audiences landed on `/subscription-required` and read copy
 * written for exactly one of them — "Your archive is intact... nothing was
 * lost... **Reactivate**" shown to someone who signed up ninety seconds ago and
 * has no archive to keep. Splitting the destinations is what makes that copy
 * true again for the audience it was written for.
 *
 * `stripe_customer_id` is checked as well as the status, not instead of it,
 * because the two go null at different times: the customer id is written once
 * and never cleared, while a status can be `canceled` on a row whose id is
 * present. Either one being set means Stripe has met this DJ.
 */
export function everSubscribed(state: {
  subscriptionStatus: string | null;
  stripeCustomerId: string | null;
}): boolean {
  if (state.stripeCustomerId) return true;
  return state.subscriptionStatus !== null && state.subscriptionStatus !== "";
}

export type CorridorInput = {
  /** `billingEnabled(process.env)` — whether this environment may sell at all. */
  sellsSubscriptions: boolean;
  /** Whether CHECKOUT_PENDING_COOKIE matches this user id. */
  checkoutPending: boolean;
  state: SetupState;
};

/**
 * Whether this DJ must clear Checkout before anything else in setup.
 *
 * Four conditions, and the last two are the interesting ones:
 *
 * 1. **The environment can sell.** Bound to `billingEnabled` for the same
 *    reason middleware.ts's paywall is (Story 7.6 Task 0): an environment with
 *    no Price ids that forced DJs onto /subscribe would show them a step with
 *    no buttons on it. A closed loop like that was live on curfew.vip once
 *    already; it does not get rebuilt here.
 * 2. **They don't already have access.** `active`/`trialing` walk straight past.
 * 3. **They have never subscribed** — a lapsed DJ belongs on
 *    `/subscription-required`, not in a corridor they finished months ago.
 * 4. **No Stripe-confirmed checkout is in flight** — the webhook race above.
 *
 * Fails OPEN on a failed read, which is the deliberate inverse of the
 * middleware paywall's fail-closed posture, and the two are not in conflict
 * because they answer different questions. The paywall decides ACCESS, so a
 * transient DB error must never hand out a free dashboard. This predicate
 * decides whether to PITCH, and a read failure is not a confirmed "never
 * subscribed" — pitching a second subscription to someone who may already be
 * paying is the worse of the two wrong answers. It is the same call
 * BillingSection already makes when it renders nothing on `statusUnknown`.
 * A DJ who slips past this on a hiccup still meets the real gate at
 * /dashboard, so the floor never moves.
 */
export function mustSubscribeFirst(input: CorridorInput): boolean {
  const { sellsSubscriptions, checkoutPending, state } = input;
  if (!sellsSubscriptions) return false;
  if (state.readFailed) return false;
  if (hasWebAccess(state.subscriptionStatus)) return false;
  if (everSubscribed(state)) return false;
  return !checkoutPending;
}

/**
 * Where a DJ belongs the moment they finish authenticating — the one place the
 * corridor's order is written down, shared by `/auth/callback` (OAuth) and
 * `/auth/confirm` (email).
 *
 * `/welcome` is never returned here on purpose. It is reached by finishing the
 * phone step (actions.ts redirects there on save), and it is skippable by
 * design — a returning DJ who has already been through setup should land on
 * their dashboard, not be re-shown instructions for an agent they installed
 * months ago. `/dashboard` is therefore the terminal answer, and a lapsed DJ
 * gets it too: middleware's paywall redirects them to /subscription-required
 * from there, which keeps ONE module deciding what "no access" looks like.
 */
export function nextSetupStep(input: CorridorInput): string {
  if (mustSubscribeFirst(input)) return "/subscribe";
  if (input.state.phone === "missing") return "/phone-required";
  return "/dashboard";
}

/**
 * The "Set up — step N of M" eyebrow, computed rather than written into each
 * page, because M is not a constant: an environment that cannot sell
 * (`billingEnabled` false — no Price ids, or production without BILLING_LIVE)
 * skips /subscribe entirely, and a hardcoded "step 2 of 3" would then count a
 * step the DJ is never shown. Preview deploys and local dev are exactly that
 * environment, so the wrong version is the one every developer would see.
 */
export function setupStepLabel(
  step: "subscribe" | "phone" | "agent",
  sellsSubscriptions: boolean,
): string {
  const total = sellsSubscriptions ? 3 : 2;
  const index = step === "subscribe" ? 1 : (step === "phone" ? 2 : 3) - (sellsSubscriptions ? 0 : 1);
  return `Set up · step ${index} of ${total}`;
}
