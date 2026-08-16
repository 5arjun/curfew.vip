// Checkout's pure decisions (Story 7.2), kept out of the Route Handler so
// they're testable without a Stripe key or a Next request. The handler owns
// the network call and the auth read; this file owns the two rules that can
// be wrong in a way a test can catch.
//
// One plan, two billing intervals — $7.99/month or $6.99/month billed yearly
// ($83.88 as a single annual charge). Two Stripe Prices on one Product, which
// is exactly the "billing variants of the same plan" case a shared Product is
// for. Nothing downstream stores which one a DJ picked: `djs` has no
// price/interval column on purpose (Story 7.1's four columns), and Stripe's
// own subscription object is the source of truth if a later story needs to
// say "you're on the annual plan".

/** The wire value the Settings CTA posts. Not display copy — see the note on
 *  `parseInterval` about why "yearly" is deliberately not accepted. */
export type BillingInterval = "monthly" | "annual";

type PriceEnvKey = "STRIPE_PRICE_ID_MONTHLY" | "STRIPE_PRICE_ID_ANNUAL";

/** The two vars this module reads. The index signature is what makes
 *  `process.env` itself assignable — without it TS's weak-type check rejects
 *  `ProcessEnv` for having "no properties in common". */
export type PriceEnv = {
  [key: string]: string | undefined;
} & Partial<Record<PriceEnvKey, string>>;

const PRICE_ENV_KEY: Record<BillingInterval, PriceEnvKey> = {
  monthly: "STRIPE_PRICE_ID_MONTHLY",
  annual: "STRIPE_PRICE_ID_ANNUAL",
};

/**
 * Narrows an untrusted request-body value to a billing interval, or `null`
 * when it isn't one. Exact match only — no trimming, no case-folding. The
 * caller is our own CTA sending a literal, so anything else is either a bug
 * or a probe, and both deserve the same flat 400. Note the copy says
 * "billed yearly" while the wire says `annual`: the display word and the
 * wire value are allowed to differ, and only the wire value is accepted here.
 */
export function parseInterval(value: unknown): BillingInterval | null {
  return value === "monthly" || value === "annual" ? value : null;
}

/**
 * The Stripe Price id for an interval. Throws rather than returning
 * `undefined` on either failure — an unrecognized interval, or an interval
 * whose env var is absent/blank. A blank var is the realistic
 * misconfiguration (an env line with no value), and letting it through would
 * surface as an opaque Stripe error on session creation instead of a named
 * one here.
 */
export function resolvePriceId(interval: unknown, env: PriceEnv): string {
  const parsed = parseInterval(interval);
  if (!parsed) {
    throw new Error(`Unrecognized billing interval: ${JSON.stringify(interval)}`);
  }
  const key = PRICE_ENV_KEY[parsed];
  const priceId = env[key];
  if (!priceId) {
    throw new Error(`Missing ${key} — Stripe Price ids are not configured for this environment`);
  }
  return priceId;
}

export type BillingEnv = PriceEnv & {
  VERCEL_ENV?: string;
  BILLING_LIVE?: string;
};

/**
 * Whether this environment may offer Checkout at all — gates both the Settings
 * CTA and the route handler, so hiding the button and refusing the endpoint
 * can never disagree.
 *
 * Two independent conditions, deliberately:
 *
 * 1. **Prices must be configured.** Without them `resolvePriceId` throws and
 *    the DJ gets a 502 from a button that looked live.
 * 2. **Production needs an explicit opt-in** (`BILLING_LIVE=1`). Curfew's
 *    Stripe resource is still an unclaimed *sandbox* — test-mode keys are
 *    already on the production environment via the Vercel Marketplace
 *    integration. A hosted Checkout backed by those keys looks completely real
 *    and charges nothing, so a visitor to curfew.vip could enter card details
 *    and believe they had subscribed. Silence is the only safe answer until
 *    live keys exist.
 *
 * Condition 2 is not redundant with condition 1. Today production simply has
 * no price ids, so condition 1 alone would hide the CTA — but that is an
 * accident of configuration, and someone adding the ids later would silently
 * ship a fake checkout. The flag makes going live a deliberate act.
 */
export function billingEnabled(env: BillingEnv): boolean {
  if (!env.STRIPE_PRICE_ID_MONTHLY || !env.STRIPE_PRICE_ID_ANNUAL) return false;
  if (env.VERCEL_ENV === "production") return env.BILLING_LIVE === "1";
  return true;
}

/**
 * Statuses that mean a Stripe subscription object is already attached to this
 * DJ — live, in a trial, in dunning, mid-first-payment, or paused. Offering
 * Checkout to any of them would mint a SECOND subscription against the same
 * customer.
 *
 * AC-6 and Task 3.2 name `active`/`trialing`/`past_due`. `incomplete` (first
 * payment not yet confirmed; Stripe holds it ~23h) and `paused` are the same
 * shape of fact and are suppressed for the same reason — flagged in the
 * story's Completion Notes as an interpretation of a boundary the story left
 * open, not a silent extension.
 */
export const SUBSCRIPTION_ATTACHED: readonly string[] = [
  "active",
  "trialing",
  "past_due",
  "incomplete",
  "paused",
];

/** Statuses that mean any prior subscription is terminally over, so
 *  Checkout is the right thing to offer again. */
const SUBSCRIPTION_OVER = new Set(["canceled", "unpaid", "incomplete_expired"]);

/**
 * Whether the Settings Billing slot should offer the Subscribe CTA.
 *
 * `null`/`undefined` — no subscription has ever existed — is the common case
 * and offers Checkout. A terminal status offers it again. Anything else,
 * including a status Stripe ships after this code does, stays silent:
 * `subscription_status` is a verbatim Stripe passthrough (AD-19), so an
 * unrecognized value must not be read as "no subscription". Silence is the
 * recoverable wrong answer; a duplicate subscription is not.
 */
export function offersSubscribeCta(status: string | null | undefined): boolean {
  if (status === null || status === undefined || status === "") return true;
  if (SUBSCRIPTION_OVER.has(status)) return true;
  // Everything else stays silent — SUBSCRIPTION_ATTACHED's five known
  // statuses, and equally any status Stripe ships after this code does.
  return false;
}
