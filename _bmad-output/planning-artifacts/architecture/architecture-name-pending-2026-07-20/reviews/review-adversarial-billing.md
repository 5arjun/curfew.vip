---
name: review-adversarial-billing
type: adversarial-review
target: ARCHITECTURE-SPINE.md (AD-18, AD-19, and their seams with AD-4, AD-7, AD-9, AD-10, AD-15, AD-16)
reviewer: adversarial-reviewer (BMad spine gate)
date: 2026-07-20
verdict: HOLES-FOUND, 7
---

# Adversarial Review — Billing Addendum (AD-18, AD-19) Seams

## Method

The spine's 17 pre-existing ADs are treated as already load-bearing and correct. This review attacks only the two new invariants (AD-18, AD-19) at their seams with the existing ones, by constructing pairs of implementers — each obeying every AD they're bound by, to the letter — who nonetheless produce an incompatible, insecure, or inconsistent system. A finding only counts if (a) both implementers can point to spine text that justifies what they built, and (b) the spine does not currently contain a rule that would force them into agreement. Each finding proposes the tightened rule that would close it.

---

## Finding 1 — CRITICAL: nothing revokes the DJ's own write access to the four billing columns

**The seam:** AD-7's RLS invariant is `auth.uid() IS NOT NULL AND auth.uid() = dj_id` — a **row**-level policy. AD-19 says: "Existing per-DJ RLS (AD-7) already covers a DJ reading their own new columns; no new **read** policy is needed — only the webhook's **write** needs AD-18's exception." That sentence is airtight about reads and silent about writes.

**The trap:** Postgres RLS is row-scoped, not column-scoped, by default. If `djs` has (now, or once Phase 2 profile-editing — display name, avatar, bio, all clearly implied by FR-19–21's profile features — lands) any DJ-writable policy of the ordinary shape used everywhere else in this spine (`FOR UPDATE USING (auth.uid() = dj_id) WITH CHECK (auth.uid() = dj_id)`), that policy grants the DJ's own `supabase-js` client UPDATE on **every** column in their row — including `stripe_customer_id`, `stripe_subscription_id`, `subscription_status`, and `current_period_end` — unless something explicitly carves those four columns out (column-level `GRANT`/`REVOKE`, a `BEFORE UPDATE` trigger comparing `OLD`/`NEW` on the protected columns, or splitting billing into its own table with no DJ-write policy at all).

**Why both implementers are individually compliant:** The Epic 2/3 implementer built `djs` RLS before billing existed, following AD-7 exactly as written (`auth.uid() = dj_id`, row-level, no column carve-outs mentioned anywhere in AD-7). The Epic 7 implementer read AD-19, saw "no new read policy is needed," reasonably concluded the read/write story is already handled, and never touched RLS at all — because AD-19 only tells them to write the webhook, not to audit or restrict any *other* write path into `djs`.

**Result:** A DJ opens dev tools and calls `supabase.from('djs').update({ subscription_status: 'active', current_period_end: '2099-01-01' }).eq('dj_id', <self>)` — a full paywall bypass, for free, using nothing but the credentials they're issued at normal login. This is not a hypothetical implementation bug; it's the *default* behavior of the exact RLS pattern this spine uses everywhere, applied to a table that now also holds billing state.

**Fix:** Add an explicit Rule to AD-19: the four billing columns are excluded from any DJ-writable policy or column grant on `djs` (e.g., via `REVOKE UPDATE (stripe_customer_id, stripe_subscription_id, subscription_status, current_period_end) ON djs FROM authenticated`, or a dedicated `dj_billing` table with no DJ-facing write policy at all). State this now, before Phase 2 profile-editing forces a first DJ-write policy onto `djs`.

---

## Finding 2 — CRITICAL: no `dj_id` linkage spec for Checkout → webhook, especially pre-verification

**The seam:** AD-18 describes *what* Stripe primitive to use; AD-19 describes *which columns* the webhook writes. Neither specifies **how the webhook resolves a given Stripe event back to a specific `djs.dj_id`** — and AD-10 governs a completely different identity race (multiple *auth* providers converging on one verified email), not the billing-identity race.

**The trap:** A `checkout.session.completed` event carries a `customer` id and whatever `client_reference_id`/`customer_email` the Checkout Session was created with. Nothing in the spine states:
- whether Checkout can only be launched from *within* the authenticated app (so `client_reference_id = dj_id` is always available), or whether a pre-signup/marketing-page "Start your trial" entry point is allowed (a very common SaaS pattern) — in which case no `dj_id` exists yet at Checkout-creation time;
- what the webhook does if the paying email doesn't match any verified `djs.email`, or matches an *unverified* one — does it create a `djs` row itself (bypassing AD-10's Auth-flow-owned, idempotent-on-verified-email creation entirely, since the webhook runs on the service-role key, not through GoTrue), silently wait, or drop the event?

**Why both implementers are individually compliant:** The Epic 7 implementer builds Checkout Session creation exactly as AD-18 describes ("hosted checkout page... trial support") and picks the natural, common pattern of a public pricing-page CTA collecting an email and going straight to Stripe — nothing in AD-18 forbids this. The Epic 2/3 implementer built account creation exactly per AD-10 ("idempotent on verified email... a second provider with the same verified email always links to the existing row") — a rule that has nothing to say about a Stripe Customer arriving *before* any `djs` row exists.

**Result:** Either (a) a customer pays and Stripe's webhook has no `djs` row to attach billing columns to — money charged, no access granted, silent failure or a crash-and-retry loop against a foreign-key that doesn't resolve; or (b) the webhook mints its own `djs` row via service-role to "make it work," creating a second, unverified account that never merges with the DJ's real (later-created) verified-email row — a paying ghost account, permanently orphaned, exactly the failure mode AD-10 was written to prevent for auth providers but left unaddressed for billing.

**Fix:** Add a Rule to AD-18/19 stating Checkout may only be initiated from an authenticated session (`client_reference_id = dj_id` always set at Session-creation time), and that the webhook must no-op (queue/alert, never silently create a `djs` row) if it cannot resolve an existing `dj_id`.

---

## Finding 3 — HIGH: "scoped only to billing columns" has no mechanical enforcement

**The seam:** AD-16 mechanically enforces the agent's content-only write scope: "column-scoped to content columns... the mechanical enforcement of AD-6, **contract-tested in `shared/`**." AD-18 makes the parallel-sounding claim for the webhook — "writes using the Supabase service-role key **scoped only to the billing columns**" — but no contract test, restricted role, narrower key, or RPC-based write surface is named anywhere for it.

**The trap:** The service-role key is a single global credential that bypasses RLS across **every** table, not just `djs`. "Scoped to billing columns" is a sentence of intent enforced only by code review discipline — there is no structural reason a future PR ("while I'm in the handler, let's also backfill the DJ's display name from Stripe's customer name" or "let's mark the set as archived when a subscription lapses") can't reach into overlay or content columns on `sets`/`plays`/`segments`, since the same key that legitimately writes `subscription_status` can write anything.

**Why both implementers are individually compliant:** The webhook implementer wrote exactly what AD-18 asked for — a working Route Handler that authenticates via Stripe signature and writes billing state — and AD-18 never told them to scope the *credential*, only to scope their own code's intent.

**Fix:** Either (a) require the webhook to write through a `SECURITY DEFINER` Postgres function/RPC that only accepts and only sets the four billing columns (so even a buggy handler literally cannot write elsewhere), or (b) explicitly require a contract test in `shared/` (or an equivalent CI check) asserting the webhook's Supabase client calls touch only `djs.{stripe_customer_id, stripe_subscription_id, subscription_status, current_period_end}` — the same rigor AD-16 already applies to the agent.

---

## Finding 4 — HIGH: no idempotency/ordering guarantee for the webhook itself

**The seam:** AD-4 is explicit and careful about sync idempotency: deterministic `set_id`, "at-least-once + idempotent = no dupes." AD-18/19 describe the webhook as "a thin passthrough, never a second state machine" but never state an equivalent guarantee for **event** idempotency or **ordering**.

**The trap:** Stripe delivers webhooks at-least-once and does **not** guarantee delivery order. Two concrete failure modes follow directly from "thin passthrough, just overwrite the columns":
1. **Duplicate delivery** of the same event is harmless (same values written twice) — fine.
2. **Out-of-order delivery of different events** is not: if a `customer.subscription.updated → active` event is retried/delayed and lands *after* a chronologically later `→ canceled` event, the passthrough overwrites `subscription_status` back to `active`, silently reviving access for a subscriber who genuinely canceled — with no data corruption signal, because both writes are individually "valid" Stripe states.

**Why both implementers are individually compliant:** AD-19 literally instructs "thin passthrough, never a second state machine" — an implementer who does exactly that, unconditionally overwriting on every event, is following the letter of the rule while re-introducing the exact class of bug AD-4 was written to prevent on the sync side.

**Fix:** Add a Rule requiring writes to be conditioned on event recency (e.g., only apply if the incoming Stripe `event.created`/`event.id` is newer than the last one processed for that subscription — a `last_stripe_event_id`/`last_event_created_at` column, or Stripe's own object-version ordering guard), and/or a dedupe table keyed on `event.id` so replayed events are no-ops.

---

## Finding 5 — MEDIUM/HIGH (contingent): the sync endpoint's runtime location is unspecified, and AD-19's "never gate sync" invariant currently relies on assumed physical separation

**The seam:** The topology diagram shows the agent's `PUT /sets/:set_id` going straight to `sb` (Supabase), not through `nextjs` — suggesting the sync endpoint and the paywalled dashboard routes live on physically separate runtimes, which would make "accidentally sharing a subscription check" structurally impossible. But AD-3 requires the payload be "validated on... the cloud on receive by contract tests" against the `shared/` JSON-schema — and raw PostgREST cannot execute arbitrary JSON-schema validation without either a Postgres extension/trigger or a thin server-side layer in front of it. The spine never says which.

**The trap:** If that receive-side validation is implemented as a Next.js Route Handler (the same, natural choice AD-18 just set a precedent for with the Stripe webhook), the sync endpoint now lives in the **same** `web/` Vercel deployment as the paywall-gated dashboard routes — exactly the shared-middleware-chain risk this review was asked to test for. A blanket auth/subscription-check middleware matcher (e.g. `matcher: ['/api/:path*']` or "all authenticated routes") written by whoever builds the Epic 7 paywall could net the sync route without anyone intending it, in direct violation of AD-19's hard invariant — while that implementer's PR reviews clean against AD-19's text, because they never touched anything called "sync."

**Why both implementers are individually compliant:** The AD-3 implementer chose the ordinary way to run schema validation server-side (a Route Handler) — nothing in AD-3 forbids it. The Epic 7 implementer wrote a middleware-level paywall gate over "the web app's authenticated routes" — nothing in AD-19 tells them the sync endpoint might be sitting inside that same route tree.

**Fix:** State explicitly where AD-3's receive-side contract validation executes (Postgres trigger/`pg_jsonschema` vs. Next.js layer), and if it is a Next.js layer, add a Rule that the sync route handler is structurally exempted from any shared auth/subscription middleware (e.g., placed outside the middleware matcher, or the middleware explicitly allow-lists it) rather than relying on prose alone.

---

## Finding 6 — MEDIUM: AD-19's "web-only" gate has no symmetric rule for Phase 2 social read routes

**The seam:** AD-19's hard invariant is written narrowly: "only web routes serving **the dashboard/stats** check `subscription_status`." AD-9 governs visibility (public/friends/private) independently, and AD-19 says no new RLS read policy is needed — i.e., the DB layer is unaffected by billing either way. But nothing states whether Phase 2 social routes (feed, other DJs' profiles, comparisons — FR-19–26) are inside or outside "the dashboard/stats" for gating purposes.

**The trap:** Two equally literal readings diverge: (a) a paywall implementer treats "dashboard/stats" as shorthand for "everything behind login" and blanket-gates the social feed too, silently making a lapsed or non-subscribing DJ unable to view *other* DJs' public content that RLS says they're perfectly entitled to read; or (b) conversely, a feed-query implementer, seeing a `subscription_status` column sitting right there on `djs`, adds `WHERE subscription_status = 'active'` to "only show real paying members" in the public feed — quietly making a lapsed subscriber's previously-public sets disappear from other people's feeds, which AD-9 never sanctioned and AD-19 never explicitly forbade (it only forbids gating *sync* and *the agent*, not gating *other people's view of a DJ's public content*).

**Why both implementers are individually compliant:** Neither action contradicts a single word of AD-19 as written — it only speaks to sync/agent, not to social read routes.

**Fix:** Extend AD-19's hard invariant to explicitly state that `subscription_status` never appears in any Phase 2 social read-policy or feed query — visibility is governed exclusively by AD-9's tiers, full stop — closing the same class of gap AD-19 already closed for sync, but for social reads.

---

## Finding 7 — MEDIUM/LOW: no "one Stripe customer per `dj_id`" invariant, interacting with AD-10's known email-merge limitation

**The seam:** AD-18 sources trial length from Stripe's native `trial_period_days` to avoid a second source of trial truth — reasonable on its own. But nothing states that Checkout Session creation must **reuse** an existing `stripe_customer_id` for a given `dj_id` if one is already on file, rather than minting a fresh Stripe Customer each time.

**The trap:** Combined with AD-10's own documented limitation — "accounts with distinct verified emails across providers are not auto-merged in v1" — a single human DJ can already, by design, end up owning two `djs` rows. Each row, subscribing independently, is a "new customer" to Stripe and gets its own fresh 14-day trial. Nothing in the architecture treats this as a concern to close (it's arguably a product/business decision, not architecture) — but because AD-18 explicitly discusses trial-abuse-adjacent territory ("avoids a second source of trial-state truth") without closing this specific door, it reads as an oversight rather than a deliberate call.

**Why both implementers are individually compliant:** The Epic 7 implementer's Checkout code creates a Stripe Customer the straightforward way; AD-10's limitation was accepted and flagged (not silently merged) as a *known* v1 gap for an unrelated reason (auth linking), not billing.

**Fix:** Either explicitly accept this as an out-of-scope business risk (mirroring AD-10's own "flagged rather than silently merged" framing), or add a Rule that Checkout Session creation always looks up and reuses `djs.stripe_customer_id` before falling back to creating a new Stripe Customer, scoped by `dj_id`.

---

## Summary Table

| # | Finding | Severity |
| --- | --- | --- |
| 1 | No revocation of DJ's own write access to billing columns on `djs` (RLS is row-, not column-, scoped) | CRITICAL |
| 2 | No `dj_id` linkage spec for Checkout↔webhook; pre-verification/pre-signup race can orphan payment or create a ghost account | CRITICAL |
| 3 | "Scoped to billing columns" for the service-role webhook write has no mechanical enforcement (unlike AD-16's contract-tested content-only scoping) | HIGH |
| 4 | No idempotency/ordering guarantee for the webhook itself; out-of-order Stripe events can revive a canceled subscription | HIGH |
| 5 | Sync endpoint's runtime (PostgREST-direct vs. Next.js layer for AD-3 validation) is unspecified; AD-19's "never gate sync" currently rests on assumed, unstated physical separation | MEDIUM (HIGH if sync turns out to be Next.js-hosted) |
| 6 | No symmetric rule barring `subscription_status` from Phase 2 social read routes/feed queries | MEDIUM |
| 7 | No "one Stripe customer per `dj_id`" invariant; interacts with AD-10's known multi-account limitation to enable repeat free trials | MEDIUM/LOW |

## Verdict

**HOLES-FOUND, 7.** The two new ADs are well-written at the level of *what* gets built (Stripe Checkout, a Route Handler webhook, four additive columns, a web-only gate) but under-specify the *mechanical enforcement* that the rest of the spine reliably provides for equivalent seams elsewhere (AD-16's contract-tested column-scoping, AD-4's idempotency guarantee, AD-10's identity-linkage care). Every finding above is a case where two implementers, each fully compliant with the letter of AD-18/AD-19, can still produce a paywall bypass, an orphaned payment, a corrupted subscription state, or an inconsistent social-visibility outcome. All seven should be closed with tightened Rule text before Epic 7 implementation starts, not discovered in code review.
