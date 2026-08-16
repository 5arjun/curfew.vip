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

Both are Preview/Development-only, matching this repo's Stripe Price id
precedent (Story 7.2) — sandbox keys must never reach Production ahead of
`BILLING_LIVE=1`.

### Customer Portal: a Dashboard prerequisite, not an env var

The Portal route (`/api/billing/portal`, Story 7.4) needs **no new env vars**,
but it does have a setup step that lives entirely outside this repo and is
easy to mistake for a bug:

`billingPortal.sessions.create()` is called without a `configuration` id, so
it opens the Portal's **default configuration** — which does not exist until
someone saves the Customer Portal settings once in the Stripe Dashboard, **per
mode** (test and live are separate). Until that happens, every call throws,
the route returns its ordinary `502 { error: "Billing unavailable" }`, and the
DJ sees "Couldn't open billing management" no matter how often they retry. The
server log line (`[billing/portal] Portal session creation failed`) is the only
way to tell this apart from a Stripe outage.

Configure it at **Dashboard → Settings → Billing → Customer portal**, and note
that what you enable there *is* the feature set of Story 7.4's AC-1/AC-3 —
cancel, payment-method update, and invoice history are Dashboard toggles, not
code in this repo. This was never exercised live during Story 7.4 (no Stripe
CLI available in that session), so treat it as an unticked **Story 7.6 cutover
step** for both test and live mode.

## Notes

- `@curfew/shared` is consumed **from source** via `transpilePackages` — no build of
  `shared/` is required before typechecking or linting `web/`.
- The contract (`shared/`) was frozen in Story 1.10 (AR-1).
