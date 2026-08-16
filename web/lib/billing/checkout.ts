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

/**
 * Which entry point started this Checkout Session. Two, and adding a third is
 * a deliberate act rather than a query param someone passes through.
 *
 * It exists because Checkout stopped having one caller (Arjun's ruling,
 * 2026-08-16): `/subscribe` now sells to a brand-new DJ mid-setup, alongside
 * Settings selling to a lapsed one. The two need different `success_url`s —
 * Settings returns to Settings, onboarding continues down the corridor — and
 * the safe way to pick between them is a closed set the server maps to URLs,
 * never a return URL the client hands over. A client-supplied `success_url`
 * would be an open redirect wearing a Stripe costume: whatever a caller posts,
 * Stripe sends the browser there after a real payment.
 */
export type CheckoutSource = "settings" | "onboarding";

/**
 * Narrows an untrusted body value to a source. Same exact-match discipline as
 * `parseInterval` one function up, with one difference: `undefined`/`null`
 * resolve to `"settings"` rather than failing. That is back-compatibility with
 * a body shape that shipped without this field — a Settings tab left open
 * across the deploy that adds it still posts `{interval}` alone, and must not
 * meet a 400 on a button that worked a minute ago. A *present but wrong* value
 * is still a flat rejection, because that is a bug or a probe, not an old tab.
 */
export function parseCheckoutSource(value: unknown): CheckoutSource | null {
  if (value === undefined || value === null) return "settings";
  return value === "settings" || value === "onboarding" ? value : null;
}

/**
 * Where Stripe returns the browser, per entry point. Pure, so the mapping is
 * testable without a Stripe key — and it is worth testing, because a wrong
 * `success_url` here is invisible until someone has actually paid.
 *
 * `{CHECKOUT_SESSION_ID}` is Stripe's own template token and must reach Stripe
 * un-encoded; it is substituted server-side by Stripe when it builds the
 * redirect. `/subscribe/return` needs it to ask Stripe directly whether the
 * session completed, which is the only answer available before Story 7.3's
 * webhook lands (see CHECKOUT_PENDING_COOKIE).
 *
 * The onboarding CANCEL url carries no marker: a DJ who backs out of Stripe
 * lands on /subscribe exactly as they left it, with both CTAs live. Nothing to
 * apologize for and nothing to explain — they simply didn't finish.
 */
export function checkoutReturnUrls(
  source: CheckoutSource,
  origin: string,
): { success_url: string; cancel_url: string } {
  if (source === "onboarding") {
    return {
      success_url: `${origin}/subscribe/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/subscribe`,
    };
  }
  return { success_url: `${origin}/settings`, cancel_url: `${origin}/settings` };
}

/**
 * Stable per-entry-point Dashboard labels, so sessions started mid-setup stay
 * distinguishable from sessions started by a lapsed DJ in Settings — which is
 * the comparison the identifier was introduced for. Stable on purpose: a
 * per-request value would make it meaningless.
 */
export const INTEGRATION_IDENTIFIER: Record<CheckoutSource, string> = {
  settings: "curfew-settings-subscribe-hqvbnjxt",
  onboarding: "curfew-onboarding-subscribe-hqvbnjxt",
};

export type BillingEnv = PriceEnv & {
  VERCEL_ENV?: string;
  BILLING_LIVE?: string;
};

/**
 * The SELL gate: whether this environment may offer Checkout at all — gates the
 * Settings Subscribe CTA, the Checkout route handler, and Story 7.5's dashboard
 * paywall, so hiding the button, refusing the endpoint, and restricting the
 * dashboard can never disagree.
 *
 * Its sibling is `billingManageEnabled`, the MANAGE gate. Read that one's note
 * for why the two are separate; the short version is that this predicate
 * answers "may we sell here?", which is not the same question as "may a DJ who
 * already paid cancel?".
 *
 * Two independent conditions, deliberately:
 *
 * 1. **Prices must be configured.** Without them `resolvePriceId` throws and
 *    the DJ gets a 502 from a button that looked live.
 * 2. **Production needs an explicit opt-in** (`BILLING_LIVE=1`) — a deliberate
 *    sales switch, not a configuration side effect. It exists because
 *    production carries the Vercel Marketplace integration's *sandbox*
 *    test-mode keys under `STRIPE_SECRET_KEY` in every environment, and a
 *    hosted Checkout backed by those looks completely real while charging
 *    nothing. Story 7.6's cutover adds live Prices and a live `rk_live_` key to
 *    Production, so after it the flag is what separates "live billing is
 *    configured" from "we are actually selling today".
 *
 * Condition 2 is not redundant with condition 1: someone adding Price ids
 * without the flag would otherwise silently ship a checkout nobody decided to
 * turn on. Going the other way, setting `BILLING_LIVE=0` after live subscribers
 * exist is a clean pause on NEW sales and nothing more — the Portal, and so a
 * paying DJ's cancel path, hangs off `billingManageEnabled` instead.
 */
export function billingEnabled(env: BillingEnv): boolean {
  if (!env.STRIPE_PRICE_ID_MONTHLY || !env.STRIPE_PRICE_ID_ANNUAL) return false;
  if (env.VERCEL_ENV === "production") return env.BILLING_LIVE === "1";
  return true;
}

/**
 * The MANAGE gate: whether a DJ who already has a subscription can reach the
 * Customer Portal to change or cancel it. Gates the Portal route and the
 * Settings Manage row (Story 7.6 Task 1; deferred here at Story 7.4's review).
 *
 * A Stripe API key, full stop. That is genuinely everything the Portal path
 * needs — `billingPortal.sessions.create` takes a `stripe_customer_id` and a
 * return URL, and both come from the caller's own `djs` row, not from the
 * environment. In particular it deliberately does **not** require:
 *
 * - **Price ids.** The Portal sells nothing. Rotating or clearing
 *   `STRIPE_PRICE_ID_*` must not strand an existing subscriber.
 * - **`BILLING_LIVE`.** A DJ who already paid is past the "may we sell here?"
 *   question. Gating cancel on the sales switch meant that pausing sales would
 *   withdraw their only self-serve cancel — under Settings copy that promises
 *   "Cancel whenever." That is the exact failure this split exists to remove.
 *
 * Note the webhook — the only writer of `stripe_customer_id` — is itself
 * ungated, so subscribers can and do exist in states where `billingEnabled` is
 * false. That is what makes this a real gap rather than a theoretical one.
 *
 * `||` not `??`, matching `resolveApiKey` one file over: a var set to the empty
 * string is the realistic misconfiguration and must not count as configured.
 */
export function billingManageEnabled(env: {
  STRIPE_RESTRICTED_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  [key: string]: string | undefined;
}): boolean {
  return Boolean(env.STRIPE_RESTRICTED_KEY || env.STRIPE_SECRET_KEY);
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
