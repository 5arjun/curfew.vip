# web — Curfew cloud app (Next.js 16)

The Vercel-deployed cloud surface for Curfew. Renders shared DJ-set reflections and
consumes the versioned sync contract from `@curfew/shared`. This is **not** the
Tauri-hosted agent frontend — it keeps default SSR/ISR output (no `output: 'export'`).

## Develop

From the repo root (pnpm workspace, frozen lockfile):

```bash
pnpm install --frozen-lockfile   # or `pnpm bootstrap` from the root for all workspaces
pnpm --filter web dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

- `pnpm --filter web lint` — ESLint
- `pnpm --filter web typecheck` — `tsc --noEmit`
- `pnpm --filter web build` — production build
- `pnpm --filter web test` — Vitest

## Environment

Auth (`/login`) needs local Supabase running first — `supabase start` from the repo root.
Then create `web/.env.local` (gitignored) with the two vars from `supabase status`:

- `NEXT_PUBLIC_SUPABASE_URL` — local API URL (`http://127.0.0.1:54321`)
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — `supabase status`'s `PUBLISHABLE_KEY`
  (older CLI versions may still label this "anon key" — same value)

Google sign-in additionally requires real provider-side app registration (a
Google Cloud Console OAuth client) and a secret — but that goes in
**`supabase/.env`** (gitignored, repo root), not `web/.env.local`. The
Supabase CLI itself, not the Next.js app, resolves `config.toml`'s `env(...)`
references from its own process environment, so that's where it looks:

- `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET` — Google OAuth Client Secret

**Apple is different — it cannot be configured locally at all.** Sign In with
Apple hard-requires an HTTPS Return URL; the local Auth server
(`http://127.0.0.1:54321`) can never satisfy that, so `[auth.external.apple]`
in `supabase/config.toml` stays permanently disabled. Apple is instead
configured per-environment via each Supabase project's **Dashboard**
(Authentication → Providers → Apple), not this repo — see
`supabase/generate-apple-client-secret.mjs` for generating the required
ES256 client-secret JWT from a downloaded `.p8` key (expires ~180 days,
no auto-refresh; renewal tracked in
`_bmad-output/implementation-artifacts/pre-launch-services-checklist.md`).

Because the backend provider toggle lives outside this repo, the frontend
needs its own signal for whether to show the Apple button as clickable:

- `NEXT_PUBLIC_APPLE_SIGNIN_AVAILABLE` — set to `true` only in environments
  where the target Supabase project's Apple provider is actually enabled
  (prod: yes; local: never — leave unset/`false`). Showing the button as
  live while the backend has it disabled sends users to a raw GoTrue error
  page instead of this app's calm failure copy (2026-07-27 review finding).

See [Supabase's Google guide](https://supabase.com/docs/guides/auth/social-login/auth-google)
and [Apple guide](https://supabase.com/docs/guides/auth/social-login/auth-apple).

Production email delivery (signup confirmation outside local dev) is wired
per-project via the Supabase dashboard, not an env var here — see
`supabase/EMAIL-PROVISIONING.md`.

The Stripe webhook (`/api/billing/webhook`, Story 7.3) needs two more vars,
neither of which is provisioned by the Vercel Marketplace Stripe integration:

- `STRIPE_WEBHOOK_SECRET` — locally, `stripe listen --forward-to
  localhost:3000/api/billing/webhook` prints a fresh `whsec_...` each run
  (session-scoped, not a static Dashboard value — don't treat it as one in
  setup docs). In Preview/Development, it's the signing secret of the
  test-mode webhook endpoint registered in the Stripe Dashboard.
- `SUPABASE_SECRET_KEY` — `supabase status`'s secret/service key (older CLI
  output may still label this differently; use whatever it actually shows).
  **This key bypasses RLS on every table and must never reach a browser
  bundle** — the same weight this file already gives the Google OAuth
  Client Secret above.

### Who owns which Stripe var (read before editing any of them)

Two owners, and the separation is what makes the live cutover safe. Story 7.6
went live on 2026-08-16; the line below that used to say "Preview/Development
only" is gone because Production now carries real live-mode values.

| Var | Owner | Mode | Environments |
| --- | --- | --- | --- |
| `STRIPE_SECRET_KEY` | **Vercel Marketplace integration** | test (sandbox) | all three |
| `STRIPE_PUBLISHABLE_KEY` | **Marketplace** | test | all three |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | **Marketplace** | test | all three |
| `STRIPE_MCP_KEY` | **Marketplace** | test | all three |
| `STRIPE_RESTRICTED_KEY` | **ours** | `rk_live_` in Production, `rk_test_` in Preview/Development | all three |
| `STRIPE_PRICE_ID_MONTHLY` / `_ANNUAL` | **ours** | live in Production, sandbox in Preview/Development | all three |
| `STRIPE_WEBHOOK_SECRET` | **ours** | live in Production | Production |
| `SUPABASE_SECRET_KEY` | **ours** | prod project | **Production only** |
| `BILLING_LIVE` | **ours** | — | Production only |

**Never hand-edit a Marketplace-owned var.** An integration resync can silently
revert it, and a reverted *secret* surfaces as an incident rather than a diff.
You never need to: `resolveApiKey` (`lib/billing/stripe.ts`) reads
`STRIPE_RESTRICTED_KEY || STRIPE_SECRET_KEY`, so adding **our** var overrides
**theirs** without touching it, and unsetting ours falls straight back. That is
also why a resync structurally cannot clobber the live values — **different
names, plus that precedence.** The `stripe-bistre-ribbon` Marketplace resource
stays connected and is permanently **sandbox/test-only**; do not
`disconnect`/`remove` it, as both strip test-mode billing from Preview and
Development (disconnect removes all four vars everywhere; remove deletes the
sandbox Product and the Prices `STRIPE_PRICE_ID_*` point at in those
environments).

Three operational notes:

- **`STRIPE_RESTRICTED_KEY` needs `checkout.sessions:read`**, not only write.
  Added 2026-08-16 with the onboarding Checkout step: `/subscribe/return` asks
  Stripe whether a Checkout Session actually completed, because that is the only
  authoritative answer available before the webhook lands. Check the grid on
  both the live and test restricted keys. If the permission is missing, the
  retrieve throws and the route treats the result as UNKNOWN and continues —
  chosen deliberately so a key-scope gap degrades to a slightly-too-trusting
  onboarding hop rather than re-pitching Checkout to a DJ whose card was already
  charged. Nothing breaks visibly, so nothing will tell you it is missing.
- **Vercel refuses `--sensitive` on Development** (`sensitive_not_allowed_on_development`
  — Sensitive is Production/Preview only). Tolerable for a test-mode key; it is
  why no live value is ever scoped to Development.
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is a **test-mode `pk_test_` that ships
  into the production browser bundle**. Inert — nothing in this codebase loads
  Stripe.js (Story 7.2 chose a plain `session.url` redirect) — but knowingly
  present. It is Marketplace-owned and scoped to all three environments, so
  removing it from Production alone is not available without editing their var.

### Rolling back: pausing sales without stranding subscribers

To stop selling, set `BILLING_LIVE=0` in Production and redeploy.

What that does: hides the Subscribe CTA, and `POST /api/billing/checkout`
returns `503`. What it deliberately does **not** do: touch existing
subscribers. They keep the Customer Portal and therefore their self-serve
cancel path, because the Portal hangs off `billingManageEnabled` (a Stripe key,
nothing more) rather than `billingEnabled`. That split — Story 7.6 Task 1 —
is what makes `BILLING_LIVE=0` a clean pause on *new* sales instead of a
withdrawal of "Cancel whenever" from people who already paid.

Note the same flag also arms Story 7.5's dashboard paywall, so
`BILLING_LIVE=0` reopens `/dashboard` to everyone. That coupling is deliberate:
an environment with no way to sell a subscription must not restrict access to
one.

### Customer Portal: a Dashboard prerequisite, not an env var

The Portal route (`/api/billing/portal`, Story 7.4) needs **no new env vars**,
but it does have a setup step that lives entirely outside this repo and is
easy to mistake for a bug:

`billingPortal.sessions.create()` is called without a `configuration` id, so it
opens the Portal's **default configuration**. What you enable there *is* the
feature set of Story 7.4's AC-1/AC-3 — cancel, payment-method update, and
invoice history are Dashboard toggles at **Settings → Billing → Customer
portal**, not code in this repo.

**Resolved 2026-08-16 (Story 7.6) — verified in both modes:**

| Mode | Default configuration | Verified by |
| --- | --- | --- |
| test (sandbox) | `bpc_1U5AK0ElER8A0CA2xm7k7AA5`, `is_default: true` | Portal session created successfully |
| live | `bpc_1U5C4IDzCRR30f2fnSgpb4cu`, `is_default: true` | Portal session created, then opened for real |

Both have `subscription_cancel`, `payment_method_update` and `invoice_history`
enabled.

**Correction to what this section used to claim.** It said the default
configuration "does not exist until someone saves the Customer Portal settings
once." That was true when written and is **no longer** — Stripe provisioned a
usable default automatically in live mode without anyone saving anything. The
underlying failure mode is still real and still worth knowing: if a default
ever *is* missing, `create()` throws, the route returns its ordinary
`502 { error: "Billing unavailable" }`, the DJ sees "Couldn't open billing
management" no matter how often they retry, and the server log line
(`[billing/portal] Portal session creation failed`) is the only way to tell it
apart from a Stripe outage. Check the configuration before assuming an outage.

**`subscription_cancel.mode` is `at_period_end`**, which has a consequence
worth stating: cancelling from the Portal does **not** delete the subscription
or flip `subscription_status`. It sets `cancel_at`, the status stays `active`
until the period ends, and the DJ keeps dashboard access until then — correct,
since they paid for it. Do not read that as a broken webhook. (Note the live
API returns `cancel_at_period_end: false` alongside a populated `cancel_at` on
the pinned API version, so `cancel_at` is the field to read, not the boolean.)

## Notes

- `@curfew/shared` is consumed **from source** via `transpilePackages` — no build of
  `shared/` is required before typechecking or linting `web/`.
- The contract (`shared/`) was frozen in Story 1.10 (AR-1).
