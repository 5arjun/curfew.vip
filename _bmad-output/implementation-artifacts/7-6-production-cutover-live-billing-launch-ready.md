---
baseline_commit: 5de1be71a57272fd28f6a8ebaf39afe1a29129bd
---

# Story 7.6: Production cutover — live billing, launch-ready

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the business,
I want Curfew's billing wired to a real, activated Stripe account with tax handling explicitly decided and the sandbox fully retired from the production path,
so that Epic 7 is not just code-complete but actually able to safely charge real customers at launch.

## ⚠️ What this story is — read before planning any work

**This is ~85% provisioning and ~15% code.** Most ACs are Stripe Dashboard / Vercel Dashboard actions only Arjun can perform (they require his Stripe login, his identity, and a real payment card). The dev agent's job is to:

1. Ship the one genuine code change (Task 1 — the sell/manage gate split, deferred to this story by name).
2. Do every env/CLI step that *is* automatable (`vercel env add`, `stripe` CLI against the live account once a key exists).
3. **Drive Arjun through the human steps one at a time, and record the resulting ids/decisions in this file's Dev Notes** — AC-1 and AC-2 both say "recorded in this story's Dev Notes," and that recording is the deliverable, not a side effect.
4. **Never fabricate a verification.** Epic 7's whole history is stories that recorded blocked live passes honestly (7.2/7.3/7.4 all did; 7.5 finally got one). Continue that. A "not done, blocked on X" line is a pass; an invented one is the only failure mode that matters here.

**Stop and ask rather than guess** on anything touching real money, a live key, or the production environment. That is the opposite of the usual bias, and it is correct for this story specifically.

---

## 🚨 Live production defect this story inherits (found during story creation)

**Story 7.5's subscription gate is already live on `curfew.vip`, and it currently locks every real production DJ out of the dashboard with no way to fix it.** Verified during story creation, not inferred:

- `web/lib/supabase/middleware.ts:122-126` runs the gate **unconditionally** — there is no `billingEnabled()` check on it, by design (7.5 Task 3.3).
- Production `djs.subscription_status` is `null` for every real account (no live billing has ever existed), and `hasWebAccess(null) === false`.
- `https://curfew.vip/subscription-required` returns `307 → /login` for an anonymous visitor, confirming 7.5's route is deployed to production right now (checked live).
- `/subscription-required`'s only affordance is a link to `/settings` — where `BillingSection` returns `null`, because `billingEnabled(process.env)` is false in production (no `STRIPE_PRICE_ID_*`, no `BILLING_LIVE`).

**Net effect today: a signed-in production DJ is redirected off `/dashboard`, sent to a page that tells them to go to Settings, and finds nothing there.** A closed loop with no exit.

This is not a hypothetical the story creates — it is live. It is also exactly what this story's completion resolves (Prices + `BILLING_LIVE=1` in Production make the Subscribe CTA render). **Flag this to Arjun at the top of the session** and get a ruling on whether to ship an interim mitigation *before* the full cutover — e.g. temporarily reverting/flag-gating the 7.5 gate on production until billing is live. Do not decide this unilaterally; it is a product call about whether curfew.vip is considered "open" today.

---

## Acceptance Criteria

1. **Given** Arjun's separate, pre-existing, already-activated Stripe account (**not** the Vercel Marketplace-provisioned `stripe-bistre-ribbon` sandbox, which has no activation path and can never take live payments — see Story 7.2's Dev Notes correction), **Then** a live-mode "Curfew Pro" Product and both live Prices ($7.99/mo, $83.88/yr) exist in it, with their ids recorded in this story's Dev Notes — they will differ from the sandbox's test-mode ids. *(Human/Dashboard action; verified, not automated)*
2. **Given** that real account, **Then** a live-mode restricted API key (`rk_live_`) is minted, scoped to only the permissions Curfew's code actually calls (Checkout Session create, Customer read, Subscription read, webhook endpoint management) — never a live `sk_` secret key. *(Human/Dashboard action — Stripe has no API for minting restricted keys; code already prefers `STRIPE_RESTRICTED_KEY` per Story 7.2)*
3. **Given** the live key, both live Price ids, and Story 7.3's live-mode webhook signing secret, **Then** all three are added to Vercel **Production only** — Preview and Development stay pointed at the sandbox so test-mode work keeps working unchanged.
4. **Given** Curfew's tax obligations, **Then** a decision is made and recorded: either `automatic_tax` is enabled with an active Stripe Tax registration and a product tax code set on Curfew Pro, or a documented decision not to collect tax yet with the business reasoning — **never left silently unset** (Stripe Tax collects nothing, with no error, until a registration exists). *(Business decision, not a default)*
5. **Given** all of the above, **Then** `BILLING_LIVE=1` is set in Vercel Production, and end-to-end verification confirms: the Settings Billing section renders in production, both interval CTAs reach a live-mode Stripe Checkout page, and a live-mode webhook event round-trips to `subscription_status` — verified without a real charge (Stripe's live-mode dashboard test tooling, or a fully refunded transaction), never left unverified.
6. **Given** the Vercel Marketplace Stripe integration (`stripe-bistre-ribbon`), **Then** it is explicitly disconnected from the `curfew.vip` project, or documented as permanently sandbox/test-only with its env vars scoped away from Production — so a future `vercel env pull`/resync can never silently overwrite the live values set in AC-3.
7. **Given** Story 7.2 left `STRIPE_SECRET_KEY` (`sk_test_`) in place for Preview/Development as a flagged, low-urgency gap, **Then** this story also replaces it there with a scoped `STRIPE_RESTRICTED_KEY` (`rk_test_`), completing the restricted-key pattern in every environment, not just production.

*(Source: `_bmad-output/planning-artifacts/epics.md` — Epic 7: Subscription & Billing, Story 7.6.)*

### Three AC corrections, verified against Stripe/Vercel docs during story creation

These do not reduce scope; they replace a method that does not exist with one that does. **The ACs above are left unedited as the record of what was specified; where they disagree with these, these win.**

**(a) AC-5's "verified without a real charge" is only half-achievable, and the achievable half doesn't prove what AC-5 asks for.**
Stripe's test cards are valid **only in sandboxes** — the Services Agreement explicitly prohibits testing in live mode with test payment details, and live/test objects are mutually inaccessible. Workbench *can* send a synthetic test event to a live endpoint, but that event's subscription id does not exist in the live account, so `web/app/api/billing/webhook/route.ts:73`'s mandatory `subscriptions.retrieve()` re-fetch fails and the handler returns a 500 without ever reaching `apply_subscription_event`. **A synthetic event therefore cannot prove "round-trips to `subscription_status`" — it proves only that signature verification passes.**
**The honest method (Task 7): one real subscription on the $7.99 monthly Price, paid with Arjun's own real card, verified end-to-end, then cancelled and fully refunded in the Dashboard.** AC-5's own parenthetical already permits this ("or a fully refunded transaction"). Budget ~$8 briefly held. Do the monthly, not the annual — an $83.88 refund is the same work for 10× the float.

**(b) AC-6's "disconnected from the `curfew.vip` project" is the destructive branch of its own disjunction — take the other one.**
`vercel integration resource disconnect stripe-bistre-ribbon` detaches the resource from the project, which removes **all four** integration-owned vars (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_MCP_KEY`) from **every** environment — Preview and Development included. That kills the test-mode work AC-3 exists to protect. `remove` is worse: it deletes the sandbox resource itself, and with it the test-mode Product and both test Prices that `STRIPE_PRICE_ID_*` point at in Preview/Development.
**Take AC-6's second branch: keep the resource connected, document it as permanently sandbox/test-only, and rely on name-separation (Task 8).** The live values live under names the integration does not own (`STRIPE_RESTRICTED_KEY`, `STRIPE_PRICE_ID_*`, `STRIPE_WEBHOOK_SECRET`, `BILLING_LIVE`), so a resync structurally cannot overwrite them — which is exactly the risk AC-6 names.

**(c) AC-3's list of three vars is incomplete, and the missing one is the highest-severity gap in this story.**
`SUPABASE_SECRET_KEY` **is not set in any Vercel environment** — verified live via `vercel env ls` across production, preview, and development. `getSupabaseAdmin()` (`web/lib/supabase/service.ts`) throws without it, and it is the **only** path to `apply_subscription_event`. Without it, every live webhook 500s, Stripe retries for ~3 days, `subscription_status` is never written — and because Story 7.5's gate is live, **a DJ who actually paid gets redirected to `/subscription-required`.** Money in, no access. Add it in Task 5.
Same check found `STRIPE_WEBHOOK_SECRET` absent from all three environments too, despite Story 7.3 Task 2.4 specifying it for Preview/Development — so the webhook has **never run in any deployed environment**, only locally.

---

## Scope Boundaries (read before starting)

- **No changes to the billing state machine.** `apply_subscription_event`, the four `djs` billing columns, `RELEVANT_EVENT_TYPES`, `resolveSubscriptionId`, `extractBillingFields`, `hasWebAccess`, `offersSubscribeCta` — all frozen. This story changes *which environment can reach Stripe*, not *what happens when it does*. The only logic change is Task 1's gate split.
- **No new Stripe features.** No trial reinstatement (reversed by Arjun 2026-08-15 — one-line change in `checkout/route.ts` if he ever wants it back, but not here), no proration UI, no `cancel_at_period_end` modelling, no invoice-history surface, no `incomplete`-recovery path. All four are in `deferred-work.md` with owners that are not this story.
- **No `agent/`, `shared/`, or `supabase/migrations/` changes.** AD-19's hard invariant: billing state is invisible to the agent. If you find yourself editing anything under `agent/`, stop.
- **Do not touch the four Marketplace-owned env vars** (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_MCP_KEY`). Editing an integration-owned secret risks a silent revert on resync — Story 7.2's `resolveApiKey` precedence design (`web/lib/billing/stripe.ts:50-65`) exists precisely so you never have to. Override by adding *our* var, never by editing *theirs*.
- **Never run `vercel --prod`.** Project rule (`.claude/CLAUDE.md`) and it is denied in settings. Env-var changes need a redeploy (see Dev Notes) — use the **Vercel Dashboard's Redeploy button** on the current production deployment, which redeploys the same commit. A CLI deploy would upload the dirty working tree instead.
- **`pre-launch-services-checklist.md` is being edited by a concurrent session** (commit `5de1be7` landed on it mid-story-creation). Re-read it immediately before editing, and edit only the Stripe row — do not rewrite neighbouring rows from a stale copy.

---

## Tasks / Subtasks

- [x] **Task 0: Surface the live lockout and get a ruling** — **RESOLVED 2026-08-16, before the cutover** (see the 🚨 section above)
  - [x] 0.1 Surfaced. Arjun's ruling was to mitigate immediately rather than wait for the cutover.
  - [x] 0.2 Ruling: **interim mitigation shipped first.** `web/lib/supabase/middleware.ts`'s gate now runs only when `billingEnabled(process.env)` is true, so an environment with no way to sell cannot restrict. PR #37, merged, live on curfew.vip as commit `05130bd`. Verified signed-in on 2026-08-16: `https://curfew.vip/dashboard` renders the dashboard (empty state, "Good afternoon, Arjun") with no redirect to `/subscription-required`. Note an anonymous check proves nothing here — the gate sits inside `if (userId && …)`, so signed-out requests return 200 either way.
        Consequence for the rest of this story: **the paywall now turns on as a side effect of Task 5.2's `BILLING_LIVE=1`.** From that redeploy onward, production DJs are gated on `subscription_status` for real. That makes Task 7's live pass the thing standing between the flag and a locked-out user, not a formality after it.

- [x] **Task 1: Split the sell gate from the manage gate** (code — the one real code change; closes `deferred-work.md`'s "Split the sell gate from the manage gate", deferred here by Arjun at 7.4's review)
  - [x] 1.1 In `web/lib/billing/checkout.ts`, add a second predicate beside `billingEnabled`:
        `export function billingManageEnabled(env: { STRIPE_RESTRICTED_KEY?: string; STRIPE_SECRET_KEY?: string; [k: string]: string | undefined }): boolean` — returns `Boolean(env.STRIPE_RESTRICTED_KEY || env.STRIPE_SECRET_KEY)`.
        **Why exactly that and nothing more:** the Portal path needs a Stripe API key and a `stripe_customer_id`, and nothing else. It does **not** need Price ids (it sells nothing) and it does **not** need `BILLING_LIVE` (a DJ who already paid is past the "may we sell here" question). Use `||` not `??`, matching `resolveApiKey`'s reasoning about empty-string vars one file over.
        Do **not** rename or change `billingEnabled` — it stays the sell gate, and its two conditions stay exactly as they are.
  - [x] 1.2 `web/app/api/billing/portal/route.ts:38` — swap `billingEnabled(process.env)` for `billingManageEnabled(process.env)`. Replace the `CAUTION (7.4 review, Decision 2 — deferred to Story 7.6)` comment block at lines 27-37 with a short note recording that the split happened here and why the manage gate is key-only. Leave the 401/502/404 gates untouched.
  - [x] 1.3 `web/app/components/settings/BillingSection.tsx` — the current shape (`if (!billingEnabled(...)) return null` at line 34, before the branch) applies the sell gate to both halves. Restructure so the gate follows the branch:
        keep the `statusUnknown` early return as-is; compute `const offersSubscribe = offersSubscribeCta(status)`; then render the Subscribe half only when `billingEnabled(process.env)`, and the Manage half only when `billingManageEnabled(process.env)`; render `null` when the applicable gate is false.
        Careful with ordering: `formatSubscriptionStatus` throws on `null`, and the existing `const status = subscriptionStatus ?? ""` narrowing at line 48 is what prevents that — keep it, and keep its comment.
  - [x] 1.4 Tests, in the two files that already cover these:
        `web/lib/billing/checkout.test.ts` — `billingManageEnabled` is true with only `STRIPE_RESTRICTED_KEY`, true with only `STRIPE_SECRET_KEY`, **true in production with `BILLING_LIVE` unset**, **true with both Price ids absent** (these two are the whole point of the split), false with neither key, false with an empty-string key.
        `web/app/components/settings/billing-section.test.tsx` — the regression this closes: a subscriber with `subscription_status: "active"` in a production-shaped env (`VERCEL_ENV: "production"`, no `BILLING_LIVE`, no Price ids) still renders the Manage row and `ManageBillingActions`; a non-subscriber in that same env still renders nothing. Follow the file's existing `vi.stubEnv` setup (lines ~15-25).
  - [x] 1.5 Update `billingEnabled`'s own doc comment (`checkout.ts:70-91`) — its condition-2 paragraph describes the sandbox situation in the present tense and will be stale the moment Task 5 lands. State what the flag means going forward (an explicit production sales switch), and point at `billingManageEnabled` for why flipping it off no longer strands a subscriber.
  - [x] 1.6 `pnpm lint && pnpm typecheck && pnpm test` in `web/` — green, no regressions. Baseline is 947 web tests (Story 7.5).

- [ ] **Task 2: Restricted key for test mode** (AC: #7) — completes the pattern before anything live exists, so a mistake here costs nothing
  - [ ] 2.1 Arjun mints a **test-mode** restricted key in the `stripe-bistre-ribbon` sandbox's Stripe Dashboard (Developers → API keys → Create restricted key). Permission grid — write implies read, so grant exactly:
        **Write:** Checkout Sessions, Billing Portal Sessions, Webhook Endpoints. **Read:** Customers, Subscriptions, Invoices, Products, Prices. **None:** everything else.
        (Invoices read: `invoice.payment_failed` is one of `RELEVANT_EVENT_TYPES`. Billing Portal Sessions write: `billingPortal.sessions.create` is a POST. Webhook Endpoints write: only if you intend to manage endpoints via API rather than Dashboard — drop it if not.)
  - [ ] 2.2 `vercel env add STRIPE_RESTRICTED_KEY preview --project curfew.vip` and the same for `development`. **Do not delete `STRIPE_SECRET_KEY`** — `resolveApiKey`'s precedence makes it inert, and deleting an integration-owned var invites resync churn (Scope Boundaries).
  - [ ] 2.3 Swap `web/.env.local`'s `STRIPE_SECRET_KEY` for `STRIPE_RESTRICTED_KEY` locally and re-run a local `stripe listen` + `stripe trigger customer.subscription.updated` pass to prove the restricted key's permission grid is actually sufficient. **This is the cheap rehearsal for the live key** — a permission you forgot shows up here for free instead of on a real customer. Record any permission you had to add.
  - [ ] 2.4 Also add the two vars Story 7.3 specified but never set (verified absent from Preview *and* Development): `STRIPE_WEBHOOK_SECRET` (from a **test-mode** Dashboard webhook endpoint — see Task 4's shape, pointed at a preview URL) and `SUPABASE_SECRET_KEY`. Without these the webhook has never run in a deployed environment at all, and Preview is where you would rather discover that.

- [ ] **Task 3: Live Stripe account artifacts** (AC: #1, #2) — Arjun's Dashboard, in his real account
  - [ ] 3.1 **Confirm the account is genuinely activated before creating anything in it.** An unactivated real account and a Marketplace sandbox present identically in the UI — both show `charges_enabled: false` with no obvious difference. Check `Settings → Account details`, or `stripe get /v1/account` with a live key, and confirm **both** `charges_enabled: true` and `payouts_enabled: true`. Record the account id (`acct_…`) in Dev Notes. If it is not activated, that is a multi-day identity/bank-verification wait (pre-launch checklist §3 flagged this lead time) — stop here and report; the rest of the story is blocked.
  - [ ] 3.2 Create the live-mode Product **"Curfew Pro"** and two live Prices — `$7.99` recurring monthly, and `$83.88` recurring **yearly** (one annual charge, marketed as "$6.99/mo billed yearly"; not a $6.99 monthly price). Record `prod_…` and both `price_…` ids in Dev Notes. For contrast, the sandbox's ids (do **not** reuse): Product `prod_V4ypvhvzT1I2Xs`, monthly `price_1U4ozEElER8A0CA2lWlMbQ1n`, annual `price_1U4ozFElER8A0CA2VNb7iYRk`.
  - [ ] 3.3 Mint the **live-mode** restricted key (`rk_live_…`) with the identical grid from Task 2.1, adjusted for anything Task 2.3 proved was missing. Never a live `sk_`.
  - [ ] 3.4 Save the **Customer Portal** configuration in the Dashboard — **in live mode, and in test mode too**. This is not optional polish: `billingPortal.sessions.create()` is called with no `configuration` id, so it opens the default configuration, which **does not exist until someone saves those settings once, per mode**. Until then every Portal call throws and the DJ gets a 502 that retrying never clears. `web/README.md:87-107` documents this as an explicit unticked 7.6 step, and it was never done in *either* mode. Enable at minimum: cancel subscription, update payment method, invoice history — **what you toggle there is literally the feature set of Story 7.4's AC-1/AC-3**; none of it is code in this repo.

- [ ] **Task 4: Live webhook endpoint** (AC: #3)
  - [ ] 4.1 Register a **live-mode** webhook endpoint at `https://curfew.vip/api/billing/webhook`, subscribed to exactly the four types in `RELEVANT_EVENT_TYPES` (`web/lib/billing/webhook.ts`): `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Subscribing to more is harmless (the handler no-ops on unknown types) but muddies the delivery log; subscribing to fewer silently breaks a path.
  - [ ] 4.2 Record its `whsec_…` signing secret for Task 5. Note it is a *persistent Dashboard artifact* here, unlike the session-scoped one `stripe listen` prints locally.

- [ ] **Task 5: Vercel Production env** (AC: #3, #5) — **order matters; `BILLING_LIVE` goes last**
  - [ ] 5.1 Add to **Production only** (`vercel env add <NAME> production --project curfew.vip`), in this order:
        1. `STRIPE_RESTRICTED_KEY` = the `rk_live_` from 3.3
        2. `STRIPE_PRICE_ID_MONTHLY`, `STRIPE_PRICE_ID_ANNUAL` = the live ids from 3.2
        3. `STRIPE_WEBHOOK_SECRET` = the live `whsec_` from 4.2
        4. **`SUPABASE_SECRET_KEY`** = the **prod** Supabase project's secret key (`jmitbnrofacxwsbwuxzs`, Dashboard → Project Settings → API keys). **Not the local one** — the local value in `web/.env.local` is a different project's key and would fail against prod. See correction (c): without this var every live webhook 500s and a paying DJ stays locked out.
        Mark all five **Sensitive**. Note `NEXT_PUBLIC_SUPABASE_URL`/`_PUBLISHABLE_KEY` are Production-only today — Preview has no Supabase vars at all, which is why Task 2.4's preview webhook test may need those added too.
  - [ ] 5.2 Set `BILLING_LIVE=1` in Production **last**, only after 5.1 and Tasks 3–4 are all confirmed. `billingEnabled` needs both the flag *and* both Price ids, so an out-of-order add is inert rather than dangerous — but the flag is the deliberate act, and it should stay the last thing you do.
  - [ ] 5.3 **Redeploy.** Vercel env-var changes apply only to *new* deployments — each deployment is an immutable artifact, so nothing you added above reaches the running site until a redeploy. Use the **Dashboard's Redeploy button** on the current production deployment (same commit, no working-tree upload). Confirm the new deployment is `Ready` and promoted before verifying anything.
  - [ ] 5.4 Re-run `vercel env ls production/preview/development --project curfew.vip` and paste the resulting matrix into Dev Notes. Baseline as of story creation, for the diff: Production had only `SENTRY_AUTH_TOKEN` + the four Marketplace vars + `NEXT_PUBLIC_APPLE_SIGNIN_AVAILABLE` + the two Supabase vars; Preview had `STRIPE_PRICE_ID_*` (sandbox) + `SENTRY_AUTH_TOKEN` + the Marketplace four; Development had `STRIPE_PRICE_ID_*` + the Marketplace four.

- [ ] **Task 6: Tax decision** (AC: #4) — Arjun's call, and it must be *made*, not defaulted
  - [ ] 6.1 Present the mechanic plainly: Stripe only calculates tax where you hold an **active registration**; with no registration the calculation returns **zero tax, silently, with no error**. So "enable `automatic_tax` and move on" and "do nothing" produce an identical customer experience today — which is exactly why AC-4 forbids leaving it unset by accident rather than by decision.
  - [ ] 6.2 Whichever way he rules, record it in Dev Notes **with the reasoning and a revisit trigger** (e.g. a revenue or nexus threshold). If the ruling is "collect": set a product tax code on Curfew Pro (SaaS-appropriate, e.g. the `txcd_10103000`-family general-SaaS code — confirm the current code in the Dashboard's picker rather than trusting this note), register in at least the home jurisdiction, and add `automatic_tax: { enabled: true }` to the Checkout Session in `web/app/api/billing/checkout/route.ts` — that last part is a code change, so it lands with Task 1's diff, not after it.
  - [ ] 6.3 If the ruling is "not yet," say so in the Dev Notes **and** add a line to `pre-launch-services-checklist.md`'s Stripe row so it has an owner outside this story file.

- [ ] **Task 7: End-to-end live verification** (AC: #5) — the honest method, per correction (a)
  - [ ] 7.1 Signed in as Arjun's own production account on `curfew.vip`, confirm `/settings` now renders the Billing section with both interval CTAs. (Before Task 5 it rendered nothing — that delta is itself the proof `billingEnabled` flipped.)
  - [ ] 7.2 Click **both** CTAs and confirm each reaches a live-mode Stripe Checkout page carrying the right amount ($7.99 / $83.88). Back out of the annual one without paying.
  - [ ] 7.3 Complete the **monthly** Checkout with a real card. Then verify, in order: the `checkout.session.completed` delivery shows `200` in the Dashboard's event log; `djs.subscription_status` for that account is `active` in prod Supabase with `stripe_customer_id`, `stripe_subscription_id`, `current_period_end` and `last_subscription_event_at` all populated; and `/dashboard` loads for that DJ (this is the 7.5 gate opening — the whole reason the lockout above resolves).
  - [ ] 7.4 Open the Customer Portal from Settings ("Manage billing") and confirm it loads with cancel + payment-method + invoice history present — this is Story 7.4's AC-1/AC-2, **never once executed end-to-end by 7.3 or 7.4**, and explicitly deferred to this story in `deferred-work.md`. Cancel from inside the Portal.
  - [ ] 7.5 Confirm the cancel round-trips: `customer.subscription.deleted` delivered `200`, `subscription_status` → `canceled`, and `/dashboard` now redirects to `/subscription-required` again. **Then refund the charge in full** from the Dashboard and confirm the refund settled.
  - [ ] 7.6 Record the whole pass in Completion Notes with the same specificity Story 7.5 used (a status × route matrix, actual HTTP codes, actual column values) — not "verified working." If any step is blocked, say which and why.

- [ ] **Task 8: Retire the sandbox from the production path** (AC: #6) — the non-destructive branch, per correction (b)
  - [ ] 8.1 **Do not run `vercel integration resource disconnect` or `remove` on `stripe-bistre-ribbon`.** Both destroy Preview/Development test-mode billing (disconnect strips all four vars from every environment; remove deletes the sandbox and the Prices `STRIPE_PRICE_ID_*` point at). If Arjun explicitly wants the disconnect anyway, self-owned replacements for every one of those four vars must exist in Preview and Development *first*.
  - [ ] 8.2 Instead, document the separation where someone would actually look — a short subsection in `web/README.md`'s Environment section: which vars the integration owns (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_MCP_KEY`, all three environments, all sandbox/test-mode), which vars we own (`STRIPE_RESTRICTED_KEY`, `STRIPE_PRICE_ID_*`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SECRET_KEY`, `BILLING_LIVE`), and the one-line reason a resync cannot cross that line: **different names, plus `resolveApiKey`'s precedence.**
  - [ ] 8.3 Verify the precedence actually holds in production rather than assuming it: after the Task 5.3 redeploy, a successful live Checkout Session (Task 7.2) is itself the proof — a test-mode key cannot create a session against a live Price, so reaching a live Checkout page means `rk_live_` won. Say that explicitly in the notes.
  - [ ] 8.4 Note the one residual exposure and get a ruling: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is a **test-mode `pk_test_`** and, being `NEXT_PUBLIC_`, ships into the production browser bundle. Inert today — nothing in this codebase loads Stripe.js (Story 7.2 chose a plain `session.url` redirect) — but it is a test-mode credential on a live site. Recommend removing it from Production if the integration permits per-environment scoping; otherwise document it as knowingly-present-and-unused.

- [ ] **Task 9: Documentation and ledger closure**
  - [ ] 9.1 `web/README.md`: the live/sandbox var table from 8.2; delete or rewrite the now-false "Both are Preview/Development-only… sandbox keys must never reach Production ahead of `BILLING_LIVE=1`" line (85); mark the Customer Portal note's "unticked Story 7.6 cutover step" as done for both modes.
  - [ ] 9.2 `pre-launch-services-checklist.md` §3's Stripe row → resolved, with the account id, the live Product/Price ids, and the tax ruling. **Re-read the file first** (concurrent session, see Scope Boundaries).
  - [ ] 9.3 Close the two `deferred-work.md` entries that name this story as owner — "Split the sell gate from the manage gate" (Task 1) and "Live Portal verification: AC-1 and AC-2 have never been executed end-to-end" (Task 7.4) — in the file's existing `**[RESOLVED <date> by Story 7.6]**` style, saying how, not just that.
  - [ ] 9.4 A launch-day rollback line in the README: to pause new sales, set `BILLING_LIVE=0` in Production and redeploy. State what that now does and does not do — after Task 1, it hides the Subscribe CTA and 503s Checkout, while existing subscribers keep the Portal and their cancel path. That sentence is the deliverable of the gate split.

---

## Dev Notes

### Ground truth: the exact Vercel env state this story starts from

Verified live via `vercel env ls` during story creation. **The Vercel project is named `curfew.vip`, not `name-pending`** — `--project name-pending` fails with `project_not_found`. **Run every `vercel` command from the repo root**, where `.vercel/project.json` links `prj_UPn4xnT1AcRwrfA6nFWJKnLgYKfR` / `curfew.vip`; from `web/` the CLI reports "codebase isn't linked" and you have to pass `--project curfew.vip` by hand. Root Directory on the Vercel side is `web`, which is why the link lives one level up from the app.

| Var | Production | Preview | Development | Owner |
| --- | --- | --- | --- | --- |
| `STRIPE_SECRET_KEY` (`sk_test_`) | ✅ | ✅ | ✅ | Marketplace integration |
| `STRIPE_PUBLISHABLE_KEY` | ✅ | ✅ | ✅ | Marketplace integration |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_test_`) | ✅ | ✅ | ✅ | Marketplace integration |
| `STRIPE_MCP_KEY` | ✅ | ✅ | ✅ | Marketplace integration |
| `STRIPE_PRICE_ID_MONTHLY` / `_ANNUAL` | ❌ | ✅ (sandbox) | ✅ (sandbox) | ours |
| `STRIPE_RESTRICTED_KEY` | ❌ | ❌ | ❌ | ours (Task 2/5) |
| `STRIPE_WEBHOOK_SECRET` | ❌ | ❌ | ❌ | ours (Task 2.4/5) |
| `SUPABASE_SECRET_KEY` | ❌ | ❌ | ❌ | ours (Task 2.4/5) |
| `BILLING_LIVE` | ❌ | — | — | ours (Task 5.2) |
| `NEXT_PUBLIC_SUPABASE_URL` / `_PUBLISHABLE_KEY` | ✅ | ❌ | ❌ | ours |

Two facts worth reading twice: **`SUPABASE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are absent everywhere** (correction (c)), and **Preview has no Supabase vars at all**, so a preview-deployed webhook cannot reach the database even once its secret exists.

Marketplace resource, confirmed via `vercel integration ls`: `stripe-bistre-ribbon`, status Available, connected to project `curfew.vip`.

### Why the sandbox can never be made live — settled, do not re-litigate

A Vercel Marketplace-provisioned Stripe resource is a **Sandbox**. Claiming it (`vercel integration resource claim`) attaches Stripe-side ownership to a login; it does **not** and cannot produce live keys — the CLI's own help text reads "Claim a **sandbox** marketplace resource." A Sandbox has no activation path at all. This was tried and corrected during Story 7.2 (see its Dev Notes correction, 2026-08-15). The only route to live billing is a **separate real Stripe account**, which is what AC-1 says. If anything in this session suggests otherwise, it is wrong.

### The five moving parts and how they compose

```
BillingSection (server component)
  └─ billingEnabled(process.env)      ← sell gate:  Price ids AND (BILLING_LIVE=1 if prod)
  └─ billingManageEnabled(process.env) ← manage gate: a Stripe key, full stop   [Task 1, new]
POST /api/billing/checkout  → billingEnabled  → getStripe() → Checkout Session
POST /api/billing/portal    → billingManageEnabled → getStripe() → Portal Session   [Task 1]
POST /api/billing/webhook   → NO env gate, self-defends on a missing STRIPE_WEBHOOK_SECRET
                            → getStripe().subscriptions.retrieve()   ← needs the Stripe key
                            → getSupabaseAdmin().rpc("apply_subscription_event")  ← needs SUPABASE_SECRET_KEY
middleware updateSession()  → readSubscriptionStatus → hasWebAccess  ← NO env gate, always on
```

Three consequences the tasks turn on:

1. **The webhook is the only writer of `subscription_status`, and it is deliberately ungated** (`webhook/route.ts:12-16`). So it is also the only thing standing between a real payment and dashboard access. Its two secrets (`STRIPE_WEBHOOK_SECRET`, `SUPABASE_SECRET_KEY`) are the story's highest-severity items even though AC-3 names only one of them.
2. **The middleware gate has no env gate either.** That is correct per AD-19 and 7.5's design, and it is also the mechanism behind the live lockout at the top of this file.
3. **`getStripe()` caches its client at module level** (`stripe.ts:30`, lazily constructed to avoid throwing during `next build`). Combined with Vercel's immutable-deployment model, this means: change a key → redeploy, always. There is no "the new key will pick up eventually."

### `resolveApiKey`'s precedence is the whole cutover mechanism

`web/lib/billing/stripe.ts:50-65` reads `env.STRIPE_RESTRICTED_KEY || env.STRIPE_SECRET_KEY`. That single `||` is why this cutover needs no code change to the key path and no edit to a Marketplace-owned var: adding our `rk_live_` under our own name overrides theirs, and unsetting it falls straight back — a one-action, reversible migration. The `||` (rather than `??`) is deliberate: an env line with no value is the realistic misconfiguration and must fall through rather than count as configured.

Same shape in `resolvePriceId` (`checkout.ts:52-63`): a blank Price id throws a **named** error rather than reaching Stripe as `undefined`. So a half-finished Task 5 fails loudly at the route, not opaquely at Stripe.

### API version pin — check it, don't assume it

`STRIPE_API_VERSION = "2026-07-29.dahlia"` (`stripe.ts:23`), which is the installed `stripe@22.5.0` SDK's own default. It is pinned explicitly so the *account's* default version can never silently change this app's request/response shapes. **A brand-new live account will be created on whatever Stripe's current default is, which may be newer than this pin.** That is fine and is the point of pinning — but if any live call returns a shape the code doesn't expect, this pin is the first thing to check, not the last. Do not bump it as part of this story; that is an SDK-upgrade diff with its own review.

Related shape facts Story 7.3 verified against the installed SDK and flagged as drift-prone — re-confirm if the `stripe` dependency has moved: `Invoice` has **no top-level `subscription`** field (it is `parent.subscription_details.subscription`), and `current_period_end` lives on `SubscriptionItem`, not `Subscription`.

### Why "no real charge" doesn't work, in mechanical terms

`webhook/route.ts` re-fetches the canonical Subscription for **all four** event types (line 73) before extracting anything — AC-3 of Story 7.3, deliberately uniform, no fast path. A Workbench-synthesized test event carries a fabricated subscription id, `subscriptions.retrieve()` 404s in the live account, and the handler returns `500 "Failed to fetch subscription"` having never reached `extractBillingFields` or the RPC. So a synthetic event exercises signature verification and nothing downstream of it. AC-5's third clause ("round-trips to `subscription_status`") is only satisfiable by a real subscription object. Hence Task 7.3's real-card-then-refund.

### What `BILLING_LIVE=0` will mean after Task 1

Today it means: no Subscribe CTA, no Checkout, **and no Portal** — so flipping it off after live subscribers exist would withdraw a paying DJ's only self-serve cancel, under Settings copy that promises "Cancel whenever." That is why 7.4's review deferred the split here, and why Task 1 precedes Task 5 rather than trailing it. After the split, `BILLING_LIVE=0` is a clean "pause new sales" switch and nothing more. Ship Task 1 before flipping the flag on, not after.

### Verification discipline this epic has established

Every Epic 7 story recorded its live-verification status explicitly rather than skipping the note — 7.2/7.3/7.4 all reported an absent Stripe CLI and an unresponsive Docker socket; 7.3 later went back and completed the pass once disk pressure cleared; 7.5 got a full live matrix. Two blockers from those sessions may still apply and are worth checking rather than assuming: the Stripe CLI is installed only as an unpackaged `stripe_1.50.1_mac-os_arm64` binary downloaded from GitHub releases (Homebrew's build failed on outdated Command Line Tools), and local Docker/Supabase has previously wedged on a full system disk. Neither blocks the *live* half of this story, which runs against curfew.vip and real Stripe — but both block the Task 2.3 rehearsal.

### Project Structure Notes

- Modified: `web/lib/billing/checkout.ts` (Task 1.1, 1.5 — new `billingManageEnabled`, `billingEnabled` unchanged in behavior)
- Modified: `web/app/api/billing/portal/route.ts` (Task 1.2 — one predicate swap + comment)
- Modified: `web/app/components/settings/BillingSection.tsx` (Task 1.3 — gate moves inside the branch)
- Modified: `web/lib/billing/checkout.test.ts`, `web/app/components/settings/billing-section.test.tsx` (Task 1.4)
- Modified: `web/app/api/billing/checkout/route.ts` (Task 6.2 **only if** the tax ruling is "collect")
- Modified: `web/README.md` (Tasks 8.2, 9.1, 9.4)
- Modified: `_bmad-output/implementation-artifacts/pre-launch-services-checklist.md` (Task 9.2 — re-read first, concurrent session)
- Modified: `_bmad-output/implementation-artifacts/deferred-work.md` (Task 9.3)
- No `agent/`, `shared/`, or `supabase/migrations/` files. No new dependencies. No new routes, components, or migrations.
- New env vars are Vercel/`.env.local` only — nothing new is committed to the repo.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` — Epic 7 intro (the explicit "7.1–7.5 are sandbox-only; 7.6 is the cutover" sequencing) + Story 7.6's seven ACs]
- [Source: `_bmad-output/planning-artifacts/architecture/.../ARCHITECTURE-SPINE.md` AD-18 (pinned API version, the webhook as the one sanctioned elevated-write exception, `SECURITY DEFINER` scoping), AD-19 (four billing columns, the hard "never gate the agent" invariant), and the Deployment table row naming the Stripe key + webhook secret + elevated DB key as encrypted Vercel env vars]
- [Source: `_bmad-output/implementation-artifacts/7-2-stripe-checkout-subscribe-flow.md` — the sandbox-has-no-activation-path correction, the sandbox Product/Price ids, `billingEnabled`'s rationale, the no-trial ruling, `resolveApiKey`'s two-owner design]
- [Source: `_bmad-output/implementation-artifacts/7-3-payment-webhook-route-handler.md` — `RELEVANT_EVENT_TYPES`, the uniform canonical re-fetch, `SUPABASE_SECRET_KEY`'s naming, the Preview/Development env scope that was specified but never applied, the SDK shape facts]
- [Source: `_bmad-output/implementation-artifacts/7-5-web-access-gate-on-subscription.md` — the unconditional middleware gate, `hasWebAccess`'s narrower-than-`SUBSCRIPTION_ATTACHED` semantics, and the live-verification format Task 7.6 should match]
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md` — the two entries naming Story 7.6 as owner (sell/manage gate split; unexecuted live Portal verification), plus the `incomplete`/`paused` dead end and `cancel_at_period_end` gaps that are explicitly *not* this story's]
- [Source: `web/README.md#Environment` — current env documentation, and the Customer Portal per-mode configuration prerequisite already flagged as an unticked 7.6 step]
- [Source: `web/lib/billing/stripe.ts`, `checkout.ts`, `web/app/api/billing/{checkout,portal,webhook}/route.ts`, `web/app/components/settings/BillingSection.tsx`, `web/lib/supabase/middleware.ts` — read these before editing; the gate composition above is summarized from them, not a substitute for them]
- [Source: `vercel env ls` / `vercel integration ls` against project `curfew.vip`, 2026-08-16 — the env matrix and resource state above are observed, not assumed]
- [Source: [Restricted API keys](https://docs.stripe.com/keys/restricted-api-keys) — `rk_` prefix, per-resource Read/Write/None grid, write-implies-read, GET→read / POST+DELETE→write, and that restricted keys are per-mode (test and live are separate keys with separate grids)]
- [Source: [Set up Stripe Tax](https://docs.stripe.com/tax/set-up), [Product tax codes](https://docs.stripe.com/tax/tax-codes) — tax is calculated only where an active registration exists; without one the calculation returns zero with no error, which is AC-4's whole concern]
- [Source: [Test card numbers](https://docs.stripe.com/testing) — test cards are sandbox-only and the Services Agreement prohibits live-mode testing with test payment details; live and test objects are mutually inaccessible]
- [Source: [Managing environment variables](https://vercel.com/docs/environment-variables/managing-environment-variables) — env changes never apply to existing deployments because each deployment is an immutable artifact; a redeploy is required]
- [Source: `.claude/CLAUDE.md` — push is the deploy; `vercel --prod` is denied and must not be worked around]

---

## Questions for Arjun (raised here rather than assumed)

1. **The live lockout (Task 0).** Real DJs on curfew.vip are gated out of the dashboard right now with no path to subscribe. Ship the cutover as the fix, or mitigate first?
2. **Tax (AC-4).** Collect now with a registration, or a documented "not yet" with a revisit trigger? This is the only AC with no defensible default.
3. **Real-card verification (AC-5).** Confirm you're willing to run one real ~$7.99 charge on your own card and refund it — there is no live-mode test card, and a synthetic event cannot prove the round-trip.
4. **AC-6's disconnect.** Recommendation is to keep `stripe-bistre-ribbon` connected and rely on name separation, because disconnecting strips test-mode billing from Preview and Development. Confirm, or say you want the hard disconnect and accept rebuilding those vars.
5. **`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (Task 8.4).** A test-mode `pk_test_` currently ships in the production browser bundle, unused. Remove from Production, or document as knowingly present?

## Dev Agent Record

### Agent Model Used

claude-opus-5 (Claude Code)

### Debug Log References

### Completion Notes List

**Task 0 — live lockout: RESOLVED 2026-08-16, ahead of the cutover.**
Arjun ruled for an interim mitigation rather than waiting. `web/lib/supabase/middleware.ts`'s gate is now bound to `billingEnabled(process.env)`, so an environment that cannot sell a subscription cannot restrict access either. PR #37, merged, live as `05130bd`. Verified signed-in on production the same day: `/dashboard` renders (empty state, greeting by name), no redirect to `/subscription-required`. An anonymous check is not evidence here — the gate sits inside `if (userId && …)`.
**Carry-forward:** this makes `BILLING_LIVE=1` (Task 5.2) the switch that *arms the paywall* as well as the one that opens sales. Task 7 is therefore load-bearing, not a post-hoc formality.

**Task 1 — sell/manage gate split: DONE, PR #38 (`story/7-6-manage-gate`), awaiting merge.**
`billingManageEnabled(env)` added beside `billingEnabled` in `web/lib/billing/checkout.ts` — `Boolean(env.STRIPE_RESTRICTED_KEY || env.STRIPE_SECRET_KEY)`, `||` not `??` per `resolveApiKey`. Consumed by `POST /api/billing/portal` and `BillingSection`'s Manage branch; the section's env gate moved to *after* the status branch so each half answers to its own gate. `billingEnabled` is behavior-identical and still gates the Subscribe CTA, the Checkout route, and 7.5's paywall; its doc comment was rewritten off the now-obsolete present-tense sandbox framing.
Gates: **962 web tests pass** (baseline 947, +15); `pnpm typecheck` clean; `pnpm lint` fails only on the pre-existing `web/app/global-error.tsx:70` `no-html-link-for-pages` from `103fec0`, untouched here.
Two pre-existing `BillingSection` guards were **rewritten, not deleted**: both asserted "renders nothing" using `subscription_status: "active"`, which is exactly the case that must now still render Manage. They now assert the same fact about the Subscribe half using a non-subscriber status, and a new describe block pins the regression — every `SUBSCRIPTION_ATTACHED` status still renders Manage in a production-shaped env with no `BILLING_LIVE` and no Price ids, while a non-subscriber in that env still renders nothing.
**Ordering constraint restated:** #38 must land *before* Task 5.2. Merged after, and the window between them is a period where pausing sales would withdraw a paying DJ's only cancel path.

**Branch hygiene note (shared checkout).** A concurrent session committed its README work (`931155a`) onto this session's branch mid-task, so `story/7-6-gate-split` carries an unrelated README redesign that conflicts with `main`'s own README rewrite. PR #38 was therefore opened from `story/7-6-manage-gate`, a clean single-commit branch built directly on `origin/main` containing only the five billing files. `story/7-6-gate-split` was left alone rather than rewritten — the other session's commit is not this session's to move.

**Live Stripe artifacts (AC-1/AC-2 require these recorded here):**

- Stripe account id: _(pending — Task 3.1)_
- `charges_enabled` / `payouts_enabled`: _(pending)_
- Live Product id ("Curfew Pro"): _(pending — Task 3.2)_
- Live Price id, $7.99/month: _(pending)_
- Live Price id, $83.88/year: _(pending)_
- Live restricted key permission grid as actually minted: _(pending — Task 3.3)_
- Live webhook endpoint id + subscribed events: _(pending — Task 4.1)_
- Tax ruling + reasoning + revisit trigger: _(pending — Task 6)_

### File List

Task 1 (PR #38, branch `story/7-6-manage-gate`, commit `b0ae964`):

- Modified: `web/lib/billing/checkout.ts` — new `billingManageEnabled`; `billingEnabled` doc comment rewritten, behavior unchanged
- Modified: `web/app/api/billing/portal/route.ts` — predicate swap + the deferred-CAUTION block replaced
- Modified: `web/app/components/settings/BillingSection.tsx` — env gate moved after the status branch
- Modified: `web/lib/billing/checkout.test.ts` — `billingManageEnabled` suite
- Modified: `web/app/components/settings/billing-section.test.tsx` — Stripe-key stub in `beforeEach`; two guards rewritten; new stranded-subscriber regression block

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-16 | Story created via bmad-create-story. |
| 2026-08-16 | Task 0 resolved — paywall bound to `billingEnabled()` (PR #37, `05130bd`), verified signed-in on production. |
| 2026-08-16 | Task 1 done — sell/manage gate split, PR #38 open. 962 web tests green. |
