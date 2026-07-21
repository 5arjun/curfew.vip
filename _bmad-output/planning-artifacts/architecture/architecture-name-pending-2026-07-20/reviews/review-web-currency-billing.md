---
name: review-web-currency-billing
type: reviewer-gate
scope: AD-18, AD-19, and their edit points (Stack row, Deployment row, Capability→Architecture Map row, Consistency Conventions `subscription_status` entries)
reviewed-file: _bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md
review-date: 2026-07-20
method: web search + fetch against current Stripe and Supabase documentation
verdict: STALE-FINDINGS
---

# Web-Currency Review — Billing Addendum (AD-18, AD-19)

Scope note: only the newly added billing material was checked (AD-18, AD-19, the Stripe Stack row, the Billing Deployment row, the billing row in the Capability→Architecture Map, and the `subscription_status` mentions in Consistency Conventions). AD-1 through AD-17 were out of scope per instructions and were not re-reviewed.

## Verdict

**STALE-FINDINGS.** Three of the four mechanics AD-18/AD-19 assert (Checkout trial support + Customer Portal naming, `constructEvent` raw-body verification, and the shape of Stripe's status enum) are current and accurately described. However, one load-bearing term — **"Supabase service-role key"** — sits on top of an active, dated Supabase platform migration that a 2026-07-20 authoring date should have caught: Supabase stopped issuing legacy `anon`/`service_role` keys to **new** projects as of **November 1, 2025**, and is walking all projects toward `sb_publishable_...`/`sb_secret_...` keys ahead of a "late 2026 (TBC)" deletion of the legacy key type. This directly intersects the spine's own same-day decision (Deployment & environments: "a dedicated Supabase **prod** project ... decided 2026-07-20") — a brand-new project created under that decision may not even have a classic `service_role` key to use. This reads as asserted from pretrained knowledge of "how Supabase server-side auth normally works" rather than checked against Supabase's current state, and it is the kind of fact a training cutoff would plausibly miss or under-weight since it is a rolling 2025→2026 migration, not a settled fact.

## Findings

### 1. Stripe Checkout: `trial_period_days` + Customer Portal — CURRENT, no changes needed

- `subscription_data.trial_period_days` (integer, ≥1, max 730 days) is still the current, documented way to attach a trial to a Checkout Session subscription. Alternatively `subscription_data.trial_end` (Unix timestamp) is supported. Both are live in Stripe's docs today. Source: docs.stripe.com/payments/checkout/free-trials, docs.stripe.com/billing/subscriptions/trials.
- **"Customer Portal"** is still the current, official product name for the hosted self-serve manage/cancel surface (docs.stripe.com/customer-management). AD-18's phrase "self-serve Customer Portal for manage/cancel" matches Stripe's own terminology verbatim.
- No finding here — AD-18's description of this mechanism is accurate and does not read as stale.

### 2. Webhook signature verification: `constructEvent` + raw body — CURRENT, with one unstated runtime gotcha

- `stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret)` (or its async sibling, see below) is still Stripe's current, sanctioned way to verify a webhook signature. Verifying against the *raw, unparsed* request body is still required — parsing then re-serializing JSON can change byte-for-byte content and break the signature check.
- In the **App Router**, Route Handlers do not auto-parse the body the way Pages Router API routes did, so the old Pages-Router-era `export const config = { api: { bodyParser: false } }` workaround is obsolete/inapplicable — you just call `await request.text()` to get the raw body natively. AD-18 doesn't mention this, but it also doesn't assert the outdated Pages-Router pattern, so there's no incorrect claim here, just an implementation detail the spine correctly stays silent on.
- **Gotcha AD-18 doesn't mention, worth a one-line footnote:** the Stripe Node SDK's synchronous `constructEvent` depends on Node's `crypto` module. If this Route Handler is ever deployed on the **Vercel Edge Runtime** (`export const runtime = 'edge'`) rather than the Node.js runtime, `constructEvent` will not work correctly and the sanctioned fix is `constructEventAsync` with `Stripe.createSubtleCryptoProvider()` (Web Crypto). Since Next.js Route Handlers default to the Node.js runtime unless a file opts into `edge`, this is not a bug in AD-18 today — but because AD-18 doesn't pin the runtime explicitly, a future contributor "optimizing" this route onto Edge (a very plausible drive-by change on Vercel) would silently break signature verification. Low severity, but cheap to close: add "pin `export const runtime = 'nodejs'` on this route" to AD-18 or the Solution Design.

### 3. Subscription status enum — mostly current, one gap worth flagging

- Confirmed current, official values per `docs.stripe.com/api/subscriptions/object`: `incomplete`, `incomplete_expired`, `trialing`, `active`, `past_due`, `canceled`, `unpaid`, `paused`. AD-19's listed subset (`trialing`/`active`/`past_due`/`canceled`/`unpaid`/…) is a subset of this, and the trailing "…" appears to intentionally leave it open — so AD-19 is not factually wrong, just incomplete in its illustrative list.
- `paused` is a real, current status (a subscription enters it when a trial ends with no payment method on file — a plausible path here since AD-18 doesn't say whether Checkout requires a card upfront for the trial). `incomplete` / `incomplete_expired` are also real and can occur on the very first invoice. None of these are exotic edge cases — a webhook implemented against only the five values named in AD-19's prose (rather than "whatever Stripe sends"), despite the AD's own "thin passthrough" principle, could plausibly miss handling one of these three.
- **Unaddressed architecture question:** AD-19 doesn't say whether the `subscription_status` column is a Postgres `text`/`varchar` (safe: any future Stripe string round-trips) or a restrictive `enum` type (unsafe: a value like `paused` or a status Stripe adds later would fail the write, silently breaking the "thin passthrough" the AD promises). Given the AD's own stated intent — "stores Stripe's own status string verbatim ... never redefined here" — this should be a plain string column, but the spine doesn't say so explicitly, leaving room for an implementer to "improve" it into a Postgres enum that then drifts from Stripe's evolving value set (the exact failure mode AD-19 says it's trying to prevent). Recommend an explicit one-line addition: "implemented as `text`, not a DB-level enum, so new Stripe status values never require a migration."

### 4. Supabase service-role key — terminology is current but incomplete; platform migration in progress (highest-severity finding)

- "Service-role key" bypassing RLS is still correct and still Supabase's own historical name for this mechanism, and the classic JWT-based `service_role` key **still works today** for existing projects — AD-18/AD-19's core claim ("Supabase service-role key scoped only to the billing columns") is not *wrong*.
- However, Supabase has an active, dated migration underway (per Supabase's own changelog, "Upcoming changes to Supabase API Keys"):
  - **June 2025:** new key format (`sb_publishable_...` / `sb_secret_...`) enters preview.
  - **November 1, 2025:** **new Supabase projects no longer receive legacy `anon`/`service_role` keys at all** — only the new publishable/secret pair.
  - **Late 2026 (per Supabase, "TBC"):** legacy keys are deleted/removed entirely, breaking anything still coded against them.
  - Supabase's own current docs state plainly: "The secret key is an improvement over the old JWT-based `service_role` key, and we recommend using it where possible."
- This directly collides with a decision made **in this same spine, on this same date**: the Deployment & environments note commits to "a dedicated Supabase **prod** project" (decided 2026-07-20). Any Supabase project created today (post-November-2025) will be issued `sb_secret_...`, not a classic `service_role` key — so AD-18/AD-19's phrase "Supabase service-role key" may not even correspond to an artifact that exists in the project this spine is about to stand up.
- This is exactly the shape of fact that a model would get wrong from training data alone: "Supabase server-side key = service_role key" was a stable, unambiguous fact for years and is very likely baked into pretrained knowledge, but it started changing in mid-to-late 2025 and is still actively rolling out through 2026. Nothing in AD-18/AD-19 suggests this was checked against Supabase's current state rather than recalled from general knowledge.
- **Recommendation:** update AD-18/AD-19 (or at minimum the Deployment & environments note) to say the billing webhook writes using Supabase's **current secret API key** (`sb_secret_...` under the new key system, functionally the successor to the legacy service-role key), and note that a dedicated prod project created now should be provisioned with the new key type from day one rather than assuming a classic `service_role` key will be available. This also strengthens AD-18's own scoping intent: the new secret-key system is described as supporting per-service key issuance (a key scoped to just this billing write path) plus browser-use detection (401 if a secret key is ever sent from a browser), both of which are a tighter fit for AD-18's "scoped only to the billing columns" wording than the monolithic legacy `service_role` key is.

## Non-findings (checked, no issue)

- Stripe Checkout, subscriptions API, and Customer Portal are all still current product surfaces under their current names — no rebrand or deprecation found.
- `stripe.webhooks.constructEvent` is not deprecated; it remains Stripe's sanctioned verification path (alongside the async/Edge variant noted above).
- Nothing found suggesting Stripe has removed or renamed any of the subscription-status values AD-19 lists.

## Summary table

| # | Claim in spine | Status | Severity if unaddressed |
|---|---|---|---|
| 1 | Checkout `trial_period_days` + Customer Portal naming | Current, accurate | — |
| 2 | `constructEvent` + raw body via `request.text()` | Current, accurate | Low (Edge-runtime footnote worth adding) |
| 3 | Status enum subset (`trialing`/`active`/`past_due`/`canceled`/`unpaid`/…) | Current but illustrative-only; `paused`/`incomplete`/`incomplete_expired` unmentioned | Medium (column-type ambiguity could break "thin passthrough" promise) |
| 4 | "Supabase service-role key" terminology | Functionally still works, but Supabase is actively migrating away from it, and new projects since Nov 2025 don't get one by default | **High** — collides with this spine's own same-day new-prod-project decision |
