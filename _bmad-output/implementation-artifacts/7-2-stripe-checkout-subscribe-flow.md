---
baseline_commit: 48578027d3e9c1a3a24e184f4c53978bcdd78cdf
---

# Story 7.2: Stripe Checkout subscribe flow

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a DJ,
I want to subscribe via Stripe's hosted Checkout from Settings,
so that I can pay without Curfew ever handling my card.

## ⚠️ Pricing correction (read first)

**epics.md's Story 7.2 acceptance criteria say "$6/mo" — that figure is wrong and must not be used.** The real, live price (already shipped in marketing copy — `web/app/(marketing)/terms/page.tsx:35,90`, `web/app/(marketing)/login/login-client.tsx:277,291,316-318`, `web/app/components/landing/FaqBeats.tsx:172,368`, `web/app/components/landing/Beats.tsx:517-523`) is **one plan, two billing intervals**:

- **$7.99/month**, billed month-to-month
- **$6.99/month, billed yearly** ($83.88/yr as a single annual charge)

This also makes AD-19's Dev Notes claim in Story 7.1 ("Curfew has a single $6/mo plan... no Price selection at Checkout") **stale** — there is now a real Price selection at Checkout (two Stripe Prices, not one). See "Two Prices, one plan" below for why this does **not** require reopening Story 7.1's schema.

**Also stale, not this story's job to fix:** `epics.md` Story 6.3 ("Pricing page") still specs a single-tier `$6/mo` Pricing Card with no plan picker (UX-DR14) — that page hasn't been built yet (`epic-6` is `backlog` in sprint-status.yaml) and this story does not build it. Flag both `epics.md` AC text and UX-DR14's Pricing Card spec for a separate correction pass; do not silently carry the wrong number into any new code or copy this story touches.

## ⚠️ Two post-implementation rulings (Arjun, 2026-08-15) — read with the ACs

Both were decided *after* the ACs below were written and *after* the first
implementation pass. The ACs are left unedited as the record of what was
specified; where they now disagree with the code, these rulings win.

1. **No free trial.** AC-1's `trial_period_days: 14` and AC-5 in full are
   **reversed** — "we're not doing that for now." The Checkout Session sets no
   `trial_period_days`; billing starts at checkout ($7.99 or $83.88 charged
   immediately, verified `amount_total: 799`). `subscription_data` survives for
   its `metadata` alone. Reinstating a trial later is a one-line change.
2. **Production is gated off.** The Settings Billing section and the route are
   both behind `billingEnabled()`, which requires an explicit `BILLING_LIVE=1`
   in production. Curfew's Stripe resource is still an unclaimed **sandbox**,
   and the Vercel Marketplace integration has already put those test-mode keys
   on the production environment — so an ungated push would have put a
   real-looking Checkout on curfew.vip that takes card details and charges
   nothing. AC-6 still describes where the CTA lives; this narrows *where it is
   switched on*.

## Acceptance Criteria

1. **Given** an authenticated DJ starting checkout for either interval, **When** the app creates a Stripe Checkout Session, **Then** the session carries `client_reference_id` / `metadata.dj_id` = that DJ's id and `trial_period_days: 14`. *(AD-18, adapted)*
2. **Given** the DJ picked "month-to-month," **Then** the Checkout Session uses `STRIPE_PRICE_ID_MONTHLY` ($7.99/mo); **given** they picked "billed yearly," **Then** it uses `STRIPE_PRICE_ID_ANNUAL` ($83.88/yr). *(Corrects AD-18's single-price assumption — see "Two Prices, one plan")*
3. **Given** the session, **Then** the DJ is redirected to Stripe's hosted Checkout page — no bespoke payment UI, no card fields rendered in this app. *(AD-18)*
4. **Given** a DJ who already has a `stripe_customer_id` on their `djs` row, **Then** Checkout Session creation reuses it via Stripe's `customer` param instead of minting a new Stripe Customer (prevents a second 14-day trial on a duplicate customer). *(AD-18)*
5. **Given** trial length, **Then** it is set via `trial_period_days` on the Checkout Session (Stripe's native trial), never a hand-rolled trial tracker or a value baked into the Price. *(AD-18)*
6. **Given** the entry point, **Then** it lives in the Settings "Billing slot" (`web/app/(authenticated)/settings/page.tsx:105-108`, reserved by Story 3.10/D-1) and renders only when the DJ has no active/trialing subscription — this story's UI, not Story 7.4's. *(See "Where the CTA lives")*

## Tasks / Subtasks

- [x] Task 1: Add the `stripe` SDK dependency (AC: #1, #3)
  - [x] 1.1 `pnpm add stripe --filter web` — not yet a dependency (`web/package.json` has no `stripe` entry). Pin the API version explicitly at client construction (`new Stripe(key, { apiVersion: '<pinned>' })`) per AD-18's "pin, don't ride the account default" rule — use the version the installed SDK major targets by default, set explicitly rather than omitted.
  - [x] 1.2 Create `web/lib/billing/stripe.ts` exporting a single server-only Stripe client instance, constructed from `process.env.STRIPE_SECRET_KEY`. Mirror `web/lib/supabase/server.ts`'s "one client factory, imported everywhere" shape — do not instantiate `new Stripe(...)` inline in the route handler.
- [x] Task 2: Checkout Session Route Handler (AC: #1, #2, #3, #4, #5)
  - [x] 2.1 New file `web/app/api/billing/checkout/route.ts`, `export async function POST(request: NextRequest)`. Pin `export const runtime = "nodejs"` explicitly (AD-18 — not because streaming needs it here, but because the Stripe SDK's synchronous crypto isn't Edge-safe; match Story 7.3's webhook route which will need the same pin for signature verification).
  - [x] 2.2 Auth-guard first: `const supabase = await createClient(); const { data } = await supabase.auth.getUser();` — 401 (or redirect to `/login`, matching this codebase's existing page-level pattern) if signed out. This is the only auth check; Checkout is unreachable pre-auth by construction (AD-10).
  - [x] 2.3 Read `interval` from the request body (`"monthly" | "annual"`), reject anything else with a 400. Map to `process.env.STRIPE_PRICE_ID_MONTHLY` / `process.env.STRIPE_PRICE_ID_ANNUAL`.
  - [x] 2.4 Look up the caller's `djs.stripe_customer_id`. If present, pass it as `customer` on session creation (AC-4). If absent, omit `customer` and let Stripe create one — do **not** write the resulting `stripe_customer_id` back to `djs` here; that write happens only through `apply_subscription_event` in Story 7.3's webhook (AD-19 — no client-facing code ever writes billing columns).
  - [x] 2.5 Create the session: `mode: "subscription"`, `line_items: [{ price: <selected price id>, quantity: 1 }]`, `client_reference_id: user.id`, `metadata: { dj_id: user.id }`, `subscription_data: { trial_period_days: 14 }`, `success_url`/`cancel_url` back to `/settings` (both, since there's no separate confirmation page yet — keep it simple, this story doesn't build one).
  - [x] 2.6 Return `{ url: session.url }` as JSON (not a redirect — the client-side CTA does `window.location.href = url`, matching a hosted-Checkout SPA-style handoff).
  - [x] 2.7 Wrap the Stripe call in try/catch; on failure return a 502 with a generic message — never leak Stripe error internals to the client (mirrors `auth/callback/route.ts`'s "network hiccup falls through to a calm failure" discipline, Dev Note below).
- [x] Task 3: Settings Billing section — the "Subscribe" state (AC: #6)
  - [x] 3.1 New component `web/app/components/settings/BillingSection.tsx`, styled like `AgentSection.tsx` (`st-card dz-shell` wrapper, `st-section-label` heading "Billing", `st-row`/`st-action` for the CTA row) — copy that file's structure, don't invent a new section shape.
  - [x] 3.2 Server-rendered: read `subscription_status` off the DJ's row (extend `getSettingsProfile()` in `web/lib/account/profile.ts` to select it, or a small new query — check which is less invasive before choosing). Render **nothing** (this story's whole scope) when `subscription_status` is one of `active`/`trialing`/`past_due` — an existing subscriber's state is Story 7.4's job, not this one's. Render the Subscribe CTA only when `subscription_status` is `null` or a terminal state (`canceled`/`unpaid`).
  - [x] 3.3 The CTA is a client island (needs `onClick` → `fetch("/api/billing/checkout", ...)` → redirect): two buttons or a toggle, "Billed yearly — $6.99/mo" and "Month-to-month — $7.99/mo", each posting its `interval` to Task 2's route and redirecting `window.location.href` to the returned `url`. Keep the copy consistent with the login page's framing ("Billed yearly — or $7.99 month to month") rather than inventing new pricing language.
  - [x] 3.4 Update the stale comment at `web/app/(authenticated)/settings/page.tsx:105-106` ("renders nothing until Story 7.4 populates it") — it's now wrong the moment this story lands; the slot renders the Subscribe CTA (7.2) for a non-subscriber and will render the Manage-subscription link (7.4) for a subscriber. Wire `<BillingSection subscriptionStatus={...} />` into the slot, replacing the empty gap between `</section>` (Account) and `<AgentSection />`.
- [x] Task 4: Tests (AC: all)
  - [x] 4.1 No existing Route Handler in this codebase has a colocated test (checked `web/app/auth/*/route.ts` — none). Don't block this story on inventing that pattern from scratch; instead unit-test the **pure logic** you can extract: a small `resolvePriceId(interval, env)` helper (Task 2.3's mapping) gets its own `web/lib/billing/checkout.test.ts`, following this codebase's colocated-`.test.ts` convention (`web/lib/sets/*.test.ts`). Cover: `"monthly"` → monthly id, `"annual"` → annual id, anything else → throws/rejects.
  - [x] 4.2 If a lightweight way to exercise the route handler's auth-guard and interval-validation branches without a live Stripe call exists in this codebase's toolchain (check `vitest.config.ts` for any Next.js route-testing setup already present), add it; otherwise leave route-level testing as a manual verification step (Dev Notes) rather than inventing new test infrastructure mid-story.
  - [x] 4.3 Manual verification (record in Completion Notes): sign in as a seeded DJ with no `stripe_customer_id`, click both interval CTAs, confirm redirect to Stripe test-mode Checkout, confirm the session (visible in the Stripe Dashboard test mode or via `stripe.checkout.sessions.retrieve`) carries the correct price, `metadata.dj_id`, and a 14-day trial.

### Review Findings

- [x] [Review][Patch] No server-side re-check of `subscription_status` before creating a Checkout Session — the route relied entirely on the client (`BillingSection`/`offersSubscribeCta`) hiding the CTA to keep an already-subscribed DJ from starting a second Checkout. A direct `POST /api/billing/checkout` (stale tab, replayed request, or a script with a valid session cookie) bypassed that and could create a second live Stripe subscription for a DJ whose `subscription_status` is already `active`/`trialing`/`past_due`/`incomplete`/`paused` — real double billing, not just a display glitch. **Applied**: the route now reads `subscription_status` alongside `stripe_customer_id` and calls `offersSubscribeCta(status)` before creating the session, returning 409 if it's `false`. [web/app/api/billing/checkout/route.ts]
- [x] [Review][Patch] `djs.stripe_customer_id` lookup silently discarded its query error — `const { data: dj } = await supabase.from("djs").select("stripe_customer_id")...` dropped `error`, unlike `profile.ts`'s explicit `djError` tracking used one file away in this same story. A transient read failure silently degraded to "no known customer" and minted a duplicate Stripe Customer for a DJ who already had one — the exact outcome AC-4 exists to prevent. **Applied**: the query now captures `error` and returns a 502 on failure, matching the "unknown ≠ absent" discipline this story already applies in `profile.ts`. [web/app/api/billing/checkout/route.ts]
- [x] [Review][Patch] Completion Note 7 misreported the `STRIPE_RESTRICTED_KEY` fallback as "not yet implemented" — `web/lib/billing/stripe.ts`'s `resolveApiKey()` already implements exactly the suggested workaround (`env.STRIPE_RESTRICTED_KEY || env.STRIPE_SECRET_KEY`). **Applied**: Completion Note 7 corrected — the code-side fallback is done; only minting an actual `rk_` key value in Stripe's Dashboard remains open. [web/lib/billing/stripe.ts:58]
- [x] [Review][Patch] Completion Note 5 undercounted disclosed deviations — `offersSubscribeCta`'s `SUBSCRIPTION_OVER` set includes `incomplete_expired` in addition to Task 3.2's named `canceled`/`unpaid`, but Completion Note 5 framed the story as having exactly "two additions beyond the literal AC text" and didn't mention this one (behaviorally reasonable, just undisclosed). **Applied**: Completion Note 5 now lists three additions, with `incomplete_expired` added. [web/lib/billing/checkout.ts:120]
- [x] [Review][Defer] `success_url`/`cancel_url` derive from the request's `Origin` header with a hardcoded `localhost:3000` fallback — pre-existing codebase pattern (identical to `web/app/(marketing)/login/actions.ts:61` and `web/lib/account/actions.ts:74`, both with the same rationale comment), not introduced by this story. This is the first call site where it gates a payment redirect rather than an auth redirect; a request that legitimately arrives with no `Origin` header would land a real payer on a dead localhost URL post-charge. Deferred as a cross-cutting hardening item spanning all three call sites, not just this one. [web/app/api/billing/checkout/route.ts:76] — deferred, pre-existing
- [x] [Review][Defer] No idempotency protection against duplicate Checkout Session creation on client retry/double-submit — a rapid double-click before React's `disabled` state commits, or a multi-tab DJ, can create two live sessions before either completes. Needs a product decision on idempotency-key strategy, not this story's call to make unilaterally. Once the server-side re-check patch above lands, this only affects a not-yet-subscribed DJ (the already-subscribed double-subscribe path is closed by that patch). [web/app/api/billing/checkout/route.ts; web/app/components/settings/SubscribeActions.tsx:15-33] — deferred, needs product decision
- [x] [Review][Defer] `success_url` returns to `/settings` before Story 7.3's webhook has necessarily fired — a DJ who just paid can land back on Settings and still see the Subscribe CTA until the webhook updates `subscription_status`. Inherent to the hosted-Checkout + async-webhook architecture (AD-18), not a defect introduced by this story; Story 7.3/7.4 are the natural place for a transient "processing" state. [web/app/api/billing/checkout/route.ts:102-103] — deferred, pre-existing architecture tradeoff
- [x] [Review][Defer] Static "Not subscribed" copy shown identically for a DJ who never subscribed and one whose subscription lapsed (`canceled`/`unpaid`/`incomplete_expired`) — not inaccurate, just imprecise. Full lapsed-subscriber messaging is Story 7.4's territory (Customer Portal / manage state), which this story explicitly doesn't build. [web/app/components/settings/BillingSection.tsx:22-24] — deferred, Story 7.4 scope

**Dismissed as noise/false-positive (8):** `integration_identifier` flagged as an invalid Stripe API parameter (verified against the installed `stripe@22.5.0` SDK's type definitions — it's a real, valid `CreateParams` field); the BotID off-Vercel guard bundled into this diff (already disclosed by the story as a separate "follow-up fix pass," explicitly requested by Arjun mid-session); an unrecognized `subscription_status` hiding the Billing section with no error affordance (intentional, documented fail-closed behavior per AD-19); `billingEnabled()` gating only `VERCEL_ENV === "production"` and not `"preview"` (speculative — Preview carries its own distinct sandbox Price ids per this story, no evidence of the hypothesized shared-ID misconfiguration); no `customer_email` hint for first-time subscribers (plausible future enhancement, not a spec requirement); no rate limiting on the route (consistent with every other route in this codebase); the route handler having no mocked-Stripe unit test (Task 4.2 explicitly permits this, and Completion Notes document a full manual verification pass instead); `SUBSCRIPTION_ATTACHED` flagged as dead code (it's imported and asserted against in `web/lib/billing/checkout.test.ts`).

## Dev Notes

### Two Prices, one plan — why Story 7.1's schema doesn't need to change

Story 7.1's Dev Notes ("Why exactly these four columns, no more") reasoned that a single flat price meant "no product-catalog column to track." That premise is now wrong (two Prices exist), but the conclusion still holds: `djs` does not need a `stripe_price_id` column. Nothing downstream differentiates DJs by which interval they chose — Story 7.5's access gate only checks `subscription_status` (`active`/`trialing` = in), and Stripe's own subscription object (fetchable via `stripe_subscription_id` any time it's needed — e.g. for a future "you're on the annual plan" Settings line) is the source of truth for which Price is attached. **Do not add a price/interval column to `djs` in this story.** If a future story needs to display which plan a DJ is on, it re-fetches from Stripe rather than caching a redundant local copy — same "re-fetch the canonical object, never trust a cached mirror" discipline AD-18 already applies to `subscription_status` itself.

### Where the CTA lives — resolving an epics.md ambiguity

`epics.md` says Story 7.2 starts "from the pricing/entry flow," which reads as Story 6.3's Pricing page → Story 6.4's auth overlay → post-signup subscribe. But `epic-6` (Landing/Features/Pricing/auth-overlay) is entirely `backlog` — no Pricing page, no auth overlay exists in code yet, only pre-auth marketing copy quoting the price (login page, FAQ, footer). Building Story 6.3 is out of scope here and would block this story on unrelated work.

Meanwhile, `web/app/(authenticated)/settings/page.tsx` already has a **reserved, empty slot** between Account and Agent, with an explicit comment: `"Billing slot (D-1): reserved between Account and Privacy; renders nothing until Story 7.4 populates it."` That comment attributes the slot to 7.4 (Customer Portal / manage-cancel) only — reasonable, since an unsubscribed DJ has nothing to "manage." This story's call: **the same slot is also the natural home for the Subscribe CTA**, conditionally rendered — empty for an active/trialing subscriber (nothing to do, or 7.4's portal link once that story lands), the Subscribe CTA for anyone else. This is a **judgment call**, not something epics.md states explicitly — flagged here rather than silently assumed, in case Arjun wants a different entry point (e.g. building a minimal standalone `/subscribe` page instead). Task 3.4 updates the now-inaccurate "until Story 7.4" comment to reflect both stories owning the slot.

### Stripe artifacts already provisioned (test/sandbox mode)

Provisioning already done (Vercel Marketplace → Stripe, sandbox resource `stripe-bistre-ribbon`, connected to the `curfew.vip` Vercel project) — this story does **not** redo it:

- Product `prod_V4ypvhvzT1I2Xs` ("Curfew Pro")
- Price `price_1U4ozEElER8A0CA2lWlMbQ1n` — $7.99/month → `web/.env.local` as `STRIPE_PRICE_ID_MONTHLY`
- Price `price_1U4ozFElER8A0CA2VNb7iYRk` — $83.88/year → `web/.env.local` as `STRIPE_PRICE_ID_ANNUAL`
- `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` also in `web/.env.local` (test-mode `sk_test_...`/`pk_test_...`)
- An earlier, wrong `$6.00/mo` Price (`price_1U4orVElER8A0CA233PkTCUA`) was created against the stale epics.md figure and has been deactivated (`active: false`) — do not resurrect or reference it.
- This is still a **sandbox** resource (test mode only) — it needs `vercel integration resource claim stripe-bistre-ribbon` plus a real Stripe account connect before production/live-mode keys exist. Out of scope for this story; flag before Epic 7 ships to production.

`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is pulled into env but this story's flow (hosted Checkout via `session.url` redirect) never actually needs it client-side — Stripe.js/`redirectToCheckout` isn't used here, a plain redirect is. Don't wire it into a `<script>` tag or `loadStripe()` call unless a later story needs Stripe Elements; AD-18 explicitly rules out bespoke payment UI.

### Route Handler runtime — match the auth routes' shape, not their auth model

`web/app/auth/callback/route.ts` and `confirm/route.ts` are this codebase's only precedent for a Next.js Route Handler doing a server-side external call with calm-failure handling (try/catch around the network call, redirect() kept outside the catch since `redirect()` itself throws). Follow that shape for Task 2.7. But their auth model doesn't apply here — those routes authenticate the *caller* via query params from an OAuth/email provider; this route authenticates via the DJ's existing Supabase session (`supabase.auth.getUser()`), same as every other `(authenticated)` surface in this codebase.

### Env vars — where they actually need to live

`web/.env.local` is the file the Next.js app in `web/` actually reads for local dev. A `.env.local` also exists at the **repo root** (written by `vercel env pull` against the `curfew.vip` project, which is linked at root) — that one is not read by `next dev` run from `web/` and can be ignored for this story. Also found, pre-existing and unrelated: `web/.env.local` carries a stale `VERCEL_OIDC_TOKEN` from a *different*, differently-named Vercel project ("web", expired ~May 2026) — leftover cruft, not touched by this story, not blocking.

### Project Structure Notes

- New: `web/lib/billing/stripe.ts` (Stripe client factory, Task 1.2)
- New: `web/lib/billing/checkout.ts` + `checkout.test.ts` (price-resolution helper, Task 2.3/4.1)
- New: `web/app/api/billing/checkout/route.ts` (Task 2)
- New: `web/app/components/settings/BillingSection.tsx` (Task 3.1-3.3)
- Modified: `web/app/(authenticated)/settings/page.tsx` (Task 3.4 — wire the component in, update the stale comment)
- Modified: `web/lib/account/profile.ts` (Task 3.2, if extending `getSettingsProfile()` is the chosen path)
- Modified: `web/package.json` (Task 1.1 — add `stripe`)
- Modified: `web/.env.local` (already done — `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_ID_MONTHLY`, `STRIPE_PRICE_ID_ANNUAL`; also add these four to Vercel's Preview/Production env before deploy, matching however `NEXT_PUBLIC_SUPABASE_URL` etc. are already configured there)
- No `supabase/`, `agent/`, or `shared/` files touched — this story writes no `djs` columns (Story 7.3's webhook does, via `apply_subscription_event`); it only *reads* `stripe_customer_id`/`subscription_status` via the existing owner-SELECT RLS policy (AD-19), which already permits this with zero new grants.
- **No runtime dependency on Story 7.1 being `done`** (it's currently `in-progress` in sprint-status.yaml): this story never calls `apply_subscription_event` and never writes billing columns, so it isn't blocked by 7.1's completion — only Story 7.3's webhook is. Worth a sanity check that the four `djs` columns exist locally (`supabase migration up`) before manual verification (Task 4.3), since `stripe_customer_id` is read in Task 2.4.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` — Epic 7 intro + Story 7.2 (epics.md's own AC-1..3 text uses the stale `$6/mo` figure; the ACs above are corrected)]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md` AD-18 — Checkout mechanics, Node-runtime pin, `dj_id` metadata linkage, one-customer-per-dj_id reuse rule, API-version pin]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/SOLUTION-DESIGN.md` §3.7 — Checkout sequence diagram (`client_reference_id`/`metadata.dj_id`, `trial_period_days`), "why Stripe Checkout not bespoke"]
- [Source: `_bmad-output/implementation-artifacts/7-1-billing-columns-write-scoped-security-definer-function.md` — `apply_subscription_event` signature/contract this story's Stripe metadata must satisfy for Story 7.3; "single $6/mo plan, no Price selection" Dev Note now superseded by this story's pricing correction]
- [Source: `web/app/(marketing)/login/login-client.tsx:277,291,316-318`, `web/app/(marketing)/terms/page.tsx:35,90`, `web/app/components/landing/FaqBeats.tsx:172,368`, `web/app/components/landing/Beats.tsx:517-523` — the real, shipped $7.99/$6.99 pricing copy this story's Checkout Session amounts must match exactly]
- [Source: `web/app/(authenticated)/settings/page.tsx:74-108` — Account section structure + the reserved Billing slot comment this story's Task 3.4 updates]
- [Source: `web/app/components/settings/AgentSection.tsx` — structural template for `BillingSection.tsx` (`st-card dz-shell`, `st-row`/`st-action` conventions)]
- [Source: `web/app/auth/callback/route.ts` — Route Handler + calm-failure-on-network-error precedent for Task 2.7]
- [Source: `web/lib/supabase/server.ts` — single-client-factory precedent for Task 1.2]
- [Source: `_bmad-output/implementation-artifacts/sprint-status.yaml` — `epic-6: backlog` (Pricing page unbuilt, informs "Where the CTA lives"); `7-1-...: in-progress` (informs "no runtime dependency on 7.1")]

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (`claude-opus-5`), bmad-dev-story, 2026-08-15.

### Debug Log References

Local gate (repo-root turbo): `pnpm lint` ✅ 3/3 · `pnpm typecheck` ✅ 3/3 ·
`pnpm test` ✅ **web 871/871** (862 → 871, +9 new, zero regressions).

Mid-session, one repo-wide run showed a single failure that was **not this
story's**: `no-hardcoded-colors.test.ts` flagged `web/app/landing.css:1357`
(`color: transparent`) — an uncommitted line from a **concurrent session**
editing the landing page (`git show HEAD:web/app/landing.css | grep -c
"color: transparent"` → 0). This story never touches `landing.css`, so it was
left alone rather than fixed, to avoid colliding with that session's in-flight
work. That session has since corrected it, and the final run above is green
across all 38 files. Recorded because it explains a transient red gate, not
because anything here needs action.

`pnpm build` (web) ✅ — `/api/billing/checkout` registered as a dynamic (ƒ)
route. The build passing is itself load-bearing evidence for the lazy Stripe
client (see Completion Note 2).

### Completion Notes List

**What shipped.** Hosted-Checkout subscribe flow, end-to-end: a `stripe` client
factory, a Node-pinned Checkout Session route handler, and the Settings Billing
slot's first live state. No card field is rendered anywhere in this app.

1. **API version pinned to `2026-07-29.dahlia`.** This is simultaneously the
   installed SDK's own default (`stripe@22.5.0`) — which is what Task 1.1 asked
   for — and Stripe's current latest, which is what the `stripe-best-practices`
   skill asks for. The two rules happened to agree; pinned explicitly so an SDK
   bump becomes a reviewable diff rather than a silent behavior change.
2. **The Stripe client is lazy, not module-level.** A top-level
   `new Stripe(process.env.STRIPE_SECRET_KEY!)` throws at **build** time, not
   just request time — `next build` loads the route's module graph. Constructing
   on first call keeps the build green in any environment without the key and
   lets the route answer with its existing calm 502 instead.
3. **`server-only` was NOT added.** The package isn't a dependency of this repo
   and isn't used anywhere in it; adding one is outside this story's approved
   scope. Followed the codebase's actual convention instead — a declared
   server-only seam by comment, exactly as `web/lib/account/profile.ts:1-5`
   does. `STRIPE_SECRET_KEY` is not a `NEXT_PUBLIC_` var, so Next never inlines
   it into a browser bundle regardless.
4. **`window.location.assign(url)` instead of the story's
   `window.location.href = url`.** Functionally identical; the story's form is
   rejected by this repo's React Compiler lint (`react-hooks/immutability`:
   "Modifying a variable defined outside a component or hook is not allowed").
   Task 3.3's intent is unchanged.
5. **Three additions beyond the literal AC text, all flagged rather than silent
   (corrected during code review 2026-08-15 — this was originally reported as
   "two"; the third was real but undisclosed until the review caught it):**
   - **`subscription_data.metadata.dj_id`** is set alongside the session's own
     `client_reference_id`/`metadata.dj_id`. AC-1 only names the session. But
     session metadata exists solely on `checkout.session.*` events;
     `customer.subscription.updated`/`deleted` — the renewal, dunning and
     cancellation events **Story 7.3 must also attribute to a DJ** — carry only
     the *subscription's* metadata. Without this line 7.3 would have to reverse
     the DJ out of `stripe_customer_id` instead. One line, additive, zero risk.
   - **`offersSubscribeCta` suppresses `incomplete` and `paused`** in addition to
     Task 3.2's named `active`/`trialing`/`past_due`. Both mean a Stripe
     subscription object is already attached, so offering Checkout would mint a
     *second* one. It also **fails closed on any unrecognized status** — since
     `subscription_status` is a verbatim Stripe passthrough (AD-19), a status
     Stripe ships after this code does must not read as "no subscription."
     Silence is the recoverable wrong answer; a duplicate subscription is not.
   - **`offersSubscribeCta`'s terminal set includes `incomplete_expired`** in
     addition to Task 3.2's named `canceled`/`unpaid`. Same shape as the two
     above: an expired first-payment window means no subscription object
     survives, so it belongs with the terminal states that offer Checkout
     again, not with the attached ones that suppress it.
6. **`payment_method_types` is deliberately omitted** (Stripe best-practice
   rule). Verified live: Stripe's hosted page offered Card, Cash App Pay,
   Klarna and Bank. Hardcoding `['card']` would have silently dropped three.
7. **`integration_identifier: "curfew-settings-subscribe-hqvbnjxt"`** tags every
   session from this entry point, so a future Pricing-page entry (Story 6.3)
   stays separable in the Dashboard. Stable by design — a per-request value
   would defeat the comparison it exists for.
8. **A failed `djs` read renders nothing, rather than pitching Subscribe.** An
   errored read is not a confirmed "not subscribed"; showing a Subscribe CTA to
   someone who may already be paying is the worse of the two wrong answers. Same
   discipline as the Account section's phone row showing "—" instead of "Not on
   file".
9. **`settings.css` gained a 7th cascade step.** The entrance stagger is
   `:nth-child(N of .st-card)` and only defined delays 2–6; a 7th card would
   have animated at 0ms and broken the sequence. `of .st-card` recounts
   correctly when Billing doesn't render.

**Task 4.2 — resolved by doing better than the fallback.** The story permitted
leaving route-level branches to manual verification. Instead every branch was
exercised against the **real running route** with a real Supabase session
(results below), which is stronger than a mocked harness and invented no new
test infrastructure.

**Task 4.3 — manual verification (performed, not deferred).** Against the local
Supabase stack (billing columns applied) and a production build of `web`, signed
in as the seeded DJ `dev@curfew.local` / `00000000-0000-4000-8000-00000000d15c`,
who has `stripe_customer_id = null` and `subscription_status = null`:

| Check | Result |
| --- | --- |
| Billing section renders for an unsubscribed DJ (AC-6) | ✅ |
| Slot position (D-1) | ✅ Account → **Billing** → Agent → Privacy → Appearance → About |
| CTA labels | ✅ "Billed yearly — $6.99/mo", "Month to month — $7.99/mo" |
| Both CTAs land on Stripe's hosted page (AC-3) | ✅ `checkout.stripe.com` |
| Annual session Price (AC-2) | ✅ `price_1U4ozFElER8A0CA2VNb7iYRk` |
| Monthly session Price (AC-2) | ✅ `price_1U4ozEElER8A0CA2lWlMbQ1n` |
| `client_reference_id` + `metadata.dj_id` (AC-1) | ✅ both = the DJ's uuid |
| `mode` | ✅ `subscription` |
| Trial (AC-1, AC-5) | ⛔️ **Reversed by ruling 1 — no trial.** Originally implemented and verified: Stripe rendered "14 days free" + "Then $83.88 per year starting August 29, 2026" (exactly 14 days out). After the ruling, re-verified as **absent**: Stripe now renders "Subscribe to Curfew Pro / $83.88 per year / $6.99 per month billed annually" and `amount_total: 799` on the monthly session — a real charge, no trial |
| `customer` omitted for a DJ with no `stripe_customer_id` (AC-4) | ✅ `customer: null` on every session |
| `amount_total` | ✅ `799` on the monthly session — billed at checkout, per ruling 1 |
| Production gate: Billing section (`VERCEL_ENV=production`) | ✅ does not render; section order returns to Account → Agent → Privacy → Appearance → About |
| Production gate: route (`VERCEL_ENV=production`) | ✅ `503`, before the auth check |
| Same build without `VERCEL_ENV` | ✅ section renders, route `200` — proving the gate, not a broken build |
| Signed-out POST | ✅ `401` |
| `{"interval":"yearly"}` | ✅ `400` |
| `{"interval":"MONTHLY"}` (no case-folding) | ✅ `400` |
| `{}` / malformed JSON body | ✅ `400` each |
| `{"interval":"monthly"}` / `{"interval":"annual"}` | ✅ `200` with a `url` |
| Console errors on `/settings` | ✅ none |

**Not verified, and why.** The *reuse* half of AC-4 (a DJ who already has a
`stripe_customer_id` gets `customer` passed) is proven by code and by the
`customer: null` control case, but was not exercised against a populated column
— nothing can populate it until Story 7.3's webhook exists, since AD-19 forbids
this story from writing it. Completing a Checkout with a test card to read
`trial_end - trial_start` off the resulting Subscription was attempted and
abandoned: Stripe's hosted page puts card entry in nested cross-origin iframes
that headless automation could not fill. That is Stripe's UI, not ours — AC-3
ends at the redirect — and Stripe's own rendered "14 days free / starting
August 29" is equivalent proof of the trial.

**Flagged, then FIXED in this session (Arjun: "the things worth my attention,
can you fix?"):**

1. ✅ **Local prod-build login was broken on `main` — pre-existing, not this
   story.** Vercel BotID (commit `56775eb`) throws `Must be deployed on Vercel
   to set response headers` on the `/login` POST under `next start`, so every
   local production-build sign-in returned a blank 500. That is precisely the
   mode the repo's own verification recipe calls for, so the breakage was
   invisible under `next dev` and total under the one build used to check work
   before shipping. **Fixed** in `web/app/(marketing)/login/actions.ts`:
   `botRejection()` returns early unless `process.env.VERCEL` is set. Cannot
   weaken production (Vercel always sets `VERCEL=1`); deliberately not a
   try/catch, which would also hide a real BotID misconfiguration in prod.
   Verified by rebuilding and driving a real sign-in against `next start` —
   "You're signed in", zero 5xx.
2. ✅ **`sprint-status.yaml` was not valid YAML, and already wasn't at HEAD.**
   Diagnosed precisely: **not** an unterminated quote (my first guess, wrong)
   but **two stray `]` characters** left after the closing quote of two
   `action_items` entries (`ai-6`, `ai-17`). `js-yaml` died with "bad
   indentation of a mapping entry". **Fixed** — 2 characters removed, nothing
   else touched; the file now parses (79 `development_status` keys, 22
   `action_items`). It stayed invisible only because the BMAD workflows read
   this file as text rather than parsing it.
3. ✅ **Stale `$6/mo` across `epics.md`.** Corrected in the Epic 6 and Epic 7
   summaries, Story 6.3's AC-1, Story 7.2's story statement, and **UX-DR14**,
   which additionally said "no plan picker" — now clarified to mean *no tier
   comparison*, since one plan on two intervals genuinely does need an interval
   choice. Story 7.2's ACs in `epics.md` gained the three criteria discovered
   during implementation (interval→Price mapping, customer reuse, Settings
   entry point) so that file stops disagreeing with the code. The dated
   2026-07-20 billing decision was **annotated, not rewritten** — it is a record
   of what was decided then.
4. ✅ **Story 7.1's "single $6/mo plan … no Price selection" Dev Note**
   annotated in place: the premise is false, the conclusion (no `stripe_price_id`
   column) still holds, and the note now says why.
5. ✅ **Stripe env vars.** `STRIPE_SECRET_KEY` and
   `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` turned out to be **already on all three
   Vercel environments**, placed by the Marketplace integration — but the two
   **Price ids were missing everywhere**, which is what would actually have
   502'd. Added `STRIPE_PRICE_ID_MONTHLY`/`STRIPE_PRICE_ID_ANNUAL` to **Preview
   and Development only**, deliberately not Production (see ruling 2).
6. ✅ ~~`web/app/landing.css:1357` fails the color guard~~ — resolved by the
   concurrent session mid-run; final gate green. Kept only to explain a
   transient red.

**Still open — these need you, not code:**

7. **`STRIPE_SECRET_KEY` is a full secret key (`sk_test_…`).** Stripe's guidance
   is a **restricted key** (`rk_`) scoped to just Checkout Sessions + the
   subscription reads Story 7.3 needs. Not automatable: Stripe has no API for
   minting restricted keys (Dashboard only — "Powering an integration you
   built"), and these vars are owned by the Vercel Marketplace integration, so
   hand-replacing them may be overwritten on resync. **Code-side workaround
   already implemented** (corrected during code review 2026-08-15 — this item
   originally read "not yet implemented," which was stale): `stripe.ts`'s
   `resolveApiKey()` reads `STRIPE_RESTRICTED_KEY || STRIPE_SECRET_KEY`, so the
   integration's var is never edited. What's still genuinely open is minting an
   actual `rk_` key value in Stripe's Dashboard and setting it as
   `STRIPE_RESTRICTED_KEY` — the code has nothing to consume until that exists.

   Note restricted keys are **per-mode** — the test-mode `rk_` and the live-mode
   `rk_` are two separate keys with separate permission grids. Low urgency
   while everything is test-mode: a leaked `sk_test_` cannot move money.

   Also worth fixing when re-adding: Vercel currently marks `STRIPE_SECRET_KEY`
   **Non-sensitive** (readable back via `vercel env pull`) while the public
   `NEXT_PUBLIC_SUPABASE_URL` is marked Sensitive — backwards.
8. **Stripe Tax is not enabled** (`automatic_tax` deliberately not set) — and
   enabling it is **not** just a flag: Stripe calculates and collects **nothing,
   with no error**, until there is an active tax registration. That makes it a
   business decision (where is Curfew registered?), not a code change. If Curfew
   charges US or EU customers this needs settling before live launch; a product
   tax code on the Curfew Pro product is part of the same pass.
9. ✅ **Sandbox claimed** (Arjun, 2026-08-15). `stripe-bistre-ribbon` is now
   `Ownership: Linked`, and the claim **linked the existing account rather than
   migrating to a new one** — so account `acct_1U4k9vElER8A0CA2` and both Price
   ids survived unchanged ($7.99/mo, $83.88/yr, product "Curfew Pro", both
   `active`). Nothing broke; Preview needs no rewiring.

   **But the account is not activated:** `charges_enabled: false`,
   `payouts_enabled: false`, `details_submitted: false`, and both Prices are
   `livemode: false`. Going live is therefore NOT just swapping keys —
   **test and live objects are separate in Stripe**, so "Curfew Pro" and both
   Prices must be **recreated in live mode and will get different ids**. The
   Production price ids will not be the values now in Preview.

   **Correction (Arjun, 2026-08-15):** `stripe-bistre-ribbon` is a Stripe
   **Sandbox**, confirmed by the Dashboard label and independently by Vercel's
   own CLI — `vercel integration resource claim --help` describes the exact
   command already run as "Claim a **sandbox** marketplace resource," not
   provider-specific wording. A Sandbox is a test environment scoped under a
   real Stripe account; it has no activation path and can never take live
   payments, regardless of `charges_enabled`/`details_submitted`. Those fields
   looked the same as an unverified real account and were misread as one.
   "Claimed" only attached Stripe-side ownership of the sandbox to Arjun's
   login — it did not and cannot convert it to a live account.

   Revised go-live sequence: (1) in Arjun's **separate, pre-existing, already
   -activated** Stripe account (same login, not this sandbox), create the
   "Curfew Pro" Product + both Prices in live mode — they will get different
   ids than the sandbox's; (2) mint a **live-mode** restricted key from that
   real account; (3) add it + the live price ids to Vercel Production
   (`STRIPE_RESTRICTED_KEY`, `STRIPE_PRICE_ID_MONTHLY`,
   `STRIPE_PRICE_ID_ANNUAL`); (4) set `BILLING_LIVE=1`. The Vercel Marketplace
   Stripe integration only ever points at the sandbox, so it has no role in
   production and is a liability worth disconnecting once the above is wired
   — otherwise a future `vercel env pull`/resync risks overwriting the
   hand-set live values with sandbox ones.
10. **No shipped copy mentions pricing terms beyond the price itself** — now
    consistent by construction, since ruling 1 removed the trial that the
    marketing surfaces never mentioned. Nothing to reconcile; noted so the
    original flag isn't mistaken for still-open.

### File List

**New**

- `web/lib/billing/stripe.ts`
- `web/lib/billing/checkout.ts`
- `web/lib/billing/checkout.test.ts`
- `web/app/api/billing/checkout/route.ts`
- `web/app/components/settings/BillingSection.tsx`
- `web/app/components/settings/SubscribeActions.tsx`

**Modified**

- `web/app/(authenticated)/settings/page.tsx`
- `web/app/settings.css`
- `web/lib/account/profile.ts`
- `web/package.json`
- `pnpm-lock.yaml`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/7-2-stripe-checkout-subscribe-flow.md`

**Modified in the follow-up fix pass** (Arjun's "can you fix?" — outside this
story's original scope, listed separately so review can treat them separately):

- `web/app/(marketing)/login/actions.ts` — BotID off-Vercel guard (flag 1)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 2 stray `]`
  removed, unrelated to this story's own status edits (flag 2)
- `_bmad-output/planning-artifacts/epics.md` — stale `$6/mo` + UX-DR14 + Story
  7.2 ACs (flag 3)
- `_bmad-output/implementation-artifacts/7-1-billing-columns-write-scoped-security-definer-function.md`
  — annotated stale single-price premise (flag 4)

**Changed outside the repo:** Vercel project `curfew.vip` — added
`STRIPE_PRICE_ID_MONTHLY` and `STRIPE_PRICE_ID_ANNUAL` to **Preview** and
**Development** only.

**Explicitly not touched:** `supabase/`, `agent/`, `shared/`, `web/.env.local`,
Vercel **Production** env, and `web/app/landing.css` + the other
landing/marketing files a concurrent session is editing.

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-15 | Story 7.2 implemented: `stripe@22.5.0` added and pinned to API version `2026-07-29.dahlia`; `web/lib/billing/{stripe,checkout}.ts` seams; `POST /api/billing/checkout` (Node-pinned, auth-guarded, interval-validated, customer-reusing, 14-day trial, calm 502); Settings Billing slot's Subscribe state (`BillingSection` + `SubscribeActions`); `getSettingsProfile()` extended with `subscription_status`; `settings.css` gains `.st-action-pair`/`.st-action-primary` and a 7th cascade step. 9 new unit tests (871 web total). Verified end-to-end against real Stripe test mode. Status → review. |
| 2026-08-15 | **Ruling 1 — trial removed** (Arjun): `trial_period_days` dropped from the Checkout Session; CTA note loses "14 days free". Re-verified against Stripe: `amount_total: 799`, hosted page now reads "Subscribe to Curfew Pro / $83.88 per year". |
| 2026-08-15 | **Ruling 2 — production gated**: new `billingEnabled(env)` requires both Price ids **and** an explicit `BILLING_LIVE=1` when `VERCEL_ENV === "production"`, guarding both the Settings section and the route (503). Verified live: with `VERCEL_ENV=production` the section vanishes and the route 503s; the same build without it renders and returns 200. Price ids added to Vercel Preview + Development only. 4 new tests (875 web total). |
| 2026-08-15 | **Follow-up fix pass** (flags 1–5): BotID off-Vercel guard restores local production-build sign-in; 2 stray `]` removed from `sprint-status.yaml`, which now parses for the first time; stale `$6/mo` corrected across `epics.md` incl. UX-DR14; Story 7.1's single-price Dev Note annotated. |
