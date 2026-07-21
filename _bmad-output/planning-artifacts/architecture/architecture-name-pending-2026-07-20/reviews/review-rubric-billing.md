---
name: review-rubric-billing
type: reviewer-gate
reviewer-role: rubric judge against the fixed good-spine checklist
scope: AD-18, AD-19, and their edit points only (Stack row, Deployment row, Capability→Architecture Map row, Consistency Conventions edits, front-matter scope/binds)
reviewed-file: _bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md
cross-checked-against: epics.md Epic 7; review-web-currency-billing.md (tech-currency companion review, already on file)
review-date: 2026-07-20
verdict: WEAK-FINDINGS, 6
---

# Rubric Review — Billing Addendum (AD-18, AD-19)

**Scope note:** per instructions, only the newly added billing material was judged — AD-18, AD-19, and the related table edits (Stack, Deployment, Capability→Architecture Map, Consistency Conventions, front-matter scope/binds). AD-1..AD-17 were re-read only to check for contradiction/weakening, not re-judged on their own merits.

**Verdict: WEAK-FINDINGS, 6.** The addendum's core shape is sound — Stripe Checkout/Portal (no bespoke payment UI), webhook-as-sole-writer, additive `djs` columns, explicit agent/sync exemption — and it correctly *reinforces* rather than weakens AD-14 (same Vercel deployment, no second runtime) and AD-15 (additive migration). But it is less rigorous than the rest of the spine at the exact thing this spine is usually excellent at: nailing down the deterministic-identity and idempotency mechanics of a new write path. It also leaves the operational envelope (secrets beyond the two named, monitoring, mid-lapse UX) thinner than AD-13's precedent for the agent side. No finding rises to "the addendum is structurally broken" — hence WEAK-FINDINGS, not INADEQUATE.

---

## Checklist walk

### 1. Fixes the real divergence points for the level below (an Epic-7 story implementer); misses none — **WEAK**

Covers well: hosted Checkout/Portal (no custom payment form to argue about), where the webhook route lives (`web/`, Vercel, not a Supabase Edge Function), what auth it uses (Stripe signature, not JWT), that it's the sole writer of subscription state, that trial length is a Stripe config value not hand-rolled, and the hard agent/sync exemption.

**Misses:**
- **The outbound half of the Stripe integration is never named.** AD-18 only describes the *inbound* webhook. But Checkout Sessions and Customer Portal sessions are created by *calling* Stripe's API server-side with the **Stripe secret API key** — a third credential, distinct from the webhook signing secret and the Supabase service-role key. Neither AD-18 nor the Deployment table's env-var line ("Signing secret + service-role key as encrypted Vercel env vars") names it, nor is there any route named for "start checkout" / "open portal." An Epic-7 implementer has zero architectural guidance on where this code lives or what it's authorized to do — a real divergence point (one implementer might put it in a Server Action, another in a Route Handler; one might reuse the webhook's Supabase client, another might not) left completely open.
- **No rule for how the webhook maps an inbound Stripe event to the correct `djs` row.** AD-18/19 says the write is "scoped only to the billing columns" but never says how it identifies *which row*. Via `client_reference_id` set at Checkout-Session creation? Via `stripe_customer_id` lookup (only works after first association)? Via email match (fragile)? This is exactly the class of problem AD-4/AD-16 solve with real rigor for `set_id`/`session_id` (deterministic, dj-namespaced, collision-proof) — here it's left to implementer discretion entirely.

### 2. Is every AD's Rule enforceable and does it actually prevent its stated divergence — **WEAK**

- AD-18's "no bespoke payment UI," "Route Handler in the existing `web/` deployment," and "Stripe signature not JWT" clauses are all concretely enforceable (a reviewer can check for a custom card form, a second deployment target, a JWT check).
- **"Writes using the Supabase service-role key scoped only to the billing columns" is not actually enforced by anything.** Confirmed against current Supabase docs: a service-role key **always bypasses RLS and has unrestricted access to every table/column** — "scoped … BYPASSRLS attribute, skipping any and all Row Level Security policies." Nothing about the key mechanism itself confines the write to four columns; that's purely an application-code convention that the route's author chooses to honor. The Rule reads as a hard guarantee but is really a description of intent. This is the checklist's "not just describe intent" case, hit directly. (A `SECURITY DEFINER` RPC function with a narrow `GRANT`, or column-level privileges, would be an actually-enforced version of the same intent; the spine doesn't need to mandate that specific fix, but shouldn't phrase the current approach as if it already provides that guarantee.)
- **No idempotency/dedup rule for the webhook**, despite Stripe's own documentation stating webhook delivery is at-least-once and duplicate/out-of-order delivery is expected and common in production. AD-4 treats exactly this shape of problem (retry + at-least-once + a deterministic key to prevent double-processing) as invariant-worthy for the agent↔cloud seam; AD-18/19 doesn't carry the same discipline to the new write path it introduces, even though it explicitly frames itself as "the one sanctioned AD-8 exception." A handler that isn't deduped on `event.id` can process a stale event after a newer one and regress `subscription_status`.

### 3. Does anything newly added contradict or weaken an existing invariant (AD-7, AD-8, AD-14, AD-15) — **WEAK (AD-7 tension)**

- **AD-14, AD-15: no weakening — reinforced.** AD-18 explicitly keeps the webhook in the same Next.js/Vercel deployment rather than a second runtime, citing AD-14 by name. AD-19's four nullable columns are a textbook additive migration per AD-15.
- **AD-8: no weakening — transparently and correctly flagged as the one sanctioned exception**, exactly the way the spine's style handles a deliberate deviation.
- **AD-7 is in tension, and the addendum doesn't say so.** AD-7's whole point is that per-DJ isolation is "enforced at the database layer… **never application-layer filtering**," specifically so a cross-DJ leak can't survive an application bug. The billing write path is the inverse of that: a service-role key bypasses RLS entirely, so the *only* thing preventing a webhook bug (or the unresolved row-mapping question in Finding 1) from writing billing state onto the wrong DJ's row is application code — precisely the failure mode AD-7 was written to close off everywhere else. Other places in the spine flag known compromises explicitly as residual risk (AD-10: "a known limitation, flagged rather than silently merged"). This one isn't flagged at all.

### 4. Is the named tech verified-current rather than assumed — **WEAK (per companion review, corroborated)**

`review-web-currency-billing.md` (already on file, same folder) did the dedicated legwork here and I re-verified its core claims independently: Stripe Checkout `trial_period_days`, Customer Portal naming, and `constructEvent` signature verification are all current. `subscription_status` values (`trialing`/`active`/`past_due`/`canceled`/`unpaid`/`paused`/`incomplete`/`incomplete_expired`) are confirmed current via Stripe's own API reference.

The one finding worth surfacing again here because it bears directly on this addendum's central mechanism: **"Supabase service-role key" sits on top of an active platform migration** — new Supabase projects since **November 1, 2025** no longer receive legacy `anon`/`service_role` keys at all (only the new `sb_publishable_…`/`sb_secret_…` pair), with full legacy removal targeted for late 2026. This directly collides with this same spine's own same-day Deployment decision to stand up "a dedicated Supabase **prod** project." That companion review rates this **High severity** — I concur; it is exactly the kind of fact that reads as recalled from stable pre-2025 training data rather than checked against Supabase's current state. I did not find anything to add or dispute in that review's findings.

One additional, related gap from my own pass: the **Stripe API version is never pinned or named**, despite the spine's own established habit of flagging exactly this kind of dependency-drift risk (see triseratops: "pin an exact git commit — the published crate is stale… upstream warns of breaking API changes"). Stripe's webhook payload shape is tied to an API version; an unpinned integration silently rides Stripe's account-default version, which can change payload shape over time. Lower severity than the Supabase-key finding, but the same category of "verify, don't assume" the spine otherwise models well.

### 5. Is a whole relevant dimension left silent that this addendum's altitude should own — **WEAK**

- **Secrets/env-var coverage is incomplete**, not silent-in-full: the Deployment table does name two of the three billing secrets (webhook signing secret, service-role key) as encrypted Vercel env vars — this is the right instinct and the right place to put it. It just stops one credential short (see Finding 1's outbound Stripe secret key).
- **Monitoring/alerting is genuinely silent.** AD-13 gives the agent side three resilience layers, including "agent-side error reporting tagged with `agent_version`." Nothing analogous exists for billing: no mention of alerting on webhook signature-verification failures, on the handler's own write failures, or on a spike in `past_due`/`unpaid` DJs. The Consistency Conventions table has "Errors (agent)" and "Errors (wire/API)" rows but no "Errors (billing)" row — money and account access are on the line here, arguably higher stakes than a stats-page bug, and the spine's own house style treats observability as architecture-worthy everywhere else.
- **Mid-lapse DJ experience is unspecified**, and not even named as an open question. AD-19 says "only web routes serving the dashboard/stats check `subscription_status`" but never states the gate's shape: hard block/redirect to `/billing`, a read-only view with a banner, or a grace period before the gate engages. `epics.md`'s Epic 7 description doesn't resolve this either ("restricts the web experience" is as specific as it gets). This may legitimately be a product/UX call the architecture correctly defers — but unlike the spine's other deferrals (e.g., reverse-geocoding provider, listed under Deferred with a reason), this one isn't named as deferred anywhere; it's just absent.

### 6. Does the addendum stay appropriately terse (decisions + Binds/Prevents/Rule) — **PASS**

AD-18 and AD-19 match the density of the document's other substantial ADs (comparable to AD-11, AD-13, AD-17) — no solution-design prose, no code, Binds/Prevents/Rule structure intact. One very minor style inconsistency: several other ADs that represent a judgment call beyond what research specified are marked "*(Architect call.)*" (AD-4, AD-5, AD-6, AD-12); AD-18/19 make comparably discretionary calls (e.g., "no separate trial-end column," "Route Handler not Edge Function") under the `[ADOPTED]` tag instead. Cosmetic only, not worth a fix on its own.

---

## Findings (ranked)

1. **No enforced mechanism for mapping a webhook event to the correct `dj_id` row, combined with a service-role key that bypasses RLS entirely** — the single load-bearing gap. AD-18/19's "scoped only to the billing columns" describes intent; the key mechanism itself provides no such scoping, and nothing else in the addendum specifies a safe correlation key (`client_reference_id`, etc.). This is in direct tension with AD-7's "never application-layer filtering" principle and isn't flagged as residual risk the way AD-10 flags its own known limitation.
2. **The outbound Stripe integration (Checkout/Portal session creation) and its credential — the Stripe secret API key — are named nowhere**, not in AD-18, the Stack table, or the Deployment table's env-var line (which names only the webhook signing secret and the Supabase service-role key). Without this, Checkout/Portal — the mechanism AD-18 mandates — can't actually be initiated.
3. **No webhook idempotency/dedup/out-of-order rule**, despite Stripe's documented at-least-once, duplicate-prone delivery, and despite AD-4 treating this exact problem class as invariant-worthy for the sync path one seam over.
4. **Supabase legacy `service_role` key is mid-deprecation** (no longer issued to new projects since Nov 1, 2025; scheduled full removal late 2026) — collides with this spine's own same-day decision to create a new dedicated Supabase prod project. Corroborates and elevates `review-web-currency-billing.md`'s High-severity finding; I found nothing to dispute in that review.
5. **No monitoring/alerting story for billing** (webhook failures, `past_due` spikes) and no "Errors (billing)" convention row, unlike the agent side's three-layer AD-13 resilience story and the two existing error-convention rows.
6. **Mid-lapse DJ experience (gate shape) is unspecified and not even flagged as an open question**, unlike the spine's other genuine deferrals which are named as such.

Minor/supporting (not separately ranked): `subscription_status` column type (text vs. Postgres enum) isn't pinned, leaving room for an implementer to "improve" it into the exact drift-prone enum AD-19 says it's preventing (also flagged by the companion currency review); Stripe API version is never pinned, an unaddressed drift risk of the same shape the spine already flags for `triseratops`.
