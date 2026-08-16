import Stripe from "stripe";

// The one Stripe client (Story 7.2, AD-18). Mirrors `lib/supabase/server.ts`'s
// discipline — one factory, imported everywhere, never `new Stripe(...)` inline
// at a call site — so the API-version pin and the key read can't drift between
// routes. Story 7.3's webhook imports this same client for signature
// verification.
//
// Server-only, declared the way `lib/account/profile.ts` declares it: by
// convention and comment, not the `server-only` package (not a dependency of
// this repo, and this story doesn't add one). Client components never import
// this module. The lazy read below is also the accidental-import guard —
// `STRIPE_SECRET_KEY` is not a NEXT_PUBLIC_ var, so Next never inlines it into
// a browser bundle, and a client-side call would throw on the missing key
// rather than leak it.

// Pinned, never omitted (AD-18). Omitting it means riding whatever version the
// Stripe *account* is set to, so an unrelated Dashboard change could alter this
// app's request/response shapes with no deploy. This value is the installed
// SDK's own default (`stripe@22.5.0` → `ApiVersion` in the package), which is
// also Stripe's current latest — pinning it explicitly makes the coupling
// visible and makes an SDK bump a reviewable diff instead of a silent change.
const STRIPE_API_VERSION = "2026-07-29.dahlia";

// Lazily constructed: a module-level `new Stripe(...)` would throw at import
// time in any environment without the key, which on Next means at BUILD time —
// the route's module graph is loaded during `next build`. The route is the
// only caller, and it already answers with a calm 502, so failing here on the
// first real request is both later and softer.
let client: Stripe | null = null;

/**
 * The API key, preferring a restricted key when one is configured.
 *
 * Two names, in precedence order, because they have different OWNERS:
 *
 * - `STRIPE_SECRET_KEY` is created and maintained by the **Vercel Marketplace
 *   Stripe integration**. Editing it by hand risks being silently reverted on
 *   an integration resync, and a reverted *secret* is the kind of change that
 *   shows up as a production incident rather than a diff.
 * - `STRIPE_RESTRICTED_KEY` is ours. Adding it alongside the integration's var
 *   overrides the key this app uses without ever touching the var the
 *   integration owns — and unsetting it falls straight back, which makes the
 *   migration reversible in one action instead of a restore-from-memory.
 *
 * Restricted keys are also **per-mode**: the test-mode `rk_` and the live-mode
 * `rk_` are separate keys with separate permission grids, so each Vercel
 * environment gets its own value under the same name.
 */
export function resolveApiKey(env: {
  STRIPE_RESTRICTED_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  [key: string]: string | undefined;
}): string {
  // `||`, not `??`: a var set to the empty string is the realistic
  // misconfiguration (an env line with no value), and it must fall through to
  // the other key rather than being treated as a configured one.
  const key = env.STRIPE_RESTRICTED_KEY || env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "Missing STRIPE_RESTRICTED_KEY / STRIPE_SECRET_KEY — see web/README.md#Environment",
    );
  }
  return key;
}

export function getStripe(): Stripe {
  if (client) return client;

  client = new Stripe(resolveApiKey(process.env), { apiVersion: STRIPE_API_VERSION });
  return client;
}
