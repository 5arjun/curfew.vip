---
baseline_commit: 707f158d4fd98f40efe2f9adb42c366d74549861
---

# Story 7.4: Customer Portal (manage/cancel)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a DJ,
I want a self-serve Stripe Customer Portal to manage or cancel my subscription,
so that I control my billing without contacting support.

## Acceptance Criteria

1. **Given** an authenticated subscribed DJ, **When** they open billing management, **Then** a Stripe Customer Portal session is created and they are sent to the hosted portal. *(AD-18)*
2. **Given** a change/cancel in the portal, **Then** it arrives back via the Story 7.3 webhook and updates `subscription_status`. *(AD-18, AD-19)*
3. **Given** the product, **Then** no subscription-lifecycle UI is hand-built. *(AD-18)*

*(Source: `_bmad-output/planning-artifacts/epics.md` — Epic 7: Subscription & Billing, Story 7.4.)*

## Scope Boundaries (read before starting)

- **AC-2 needs zero new code.** Stripe fires the exact same `customer.subscription.updated`/`.deleted` events for a Portal-initiated change/cancel that it fires for any other subscription change, and Story 7.3's webhook (`web/app/api/billing/webhook/route.ts`, already `review`) already handles all four relevant event types uniformly — it doesn't know or care whether the change came from the Portal, the Dashboard, or Stripe's own dunning logic. This story's job is entirely AC-1/AC-3: create the Portal session and the entry point to it. Do not touch `web/lib/billing/webhook.ts`, `web/app/api/billing/webhook/route.ts`, or `apply_subscription_event`.
- **No subscription-lifecycle UI (AC-3).** Don't build a cancel confirmation dialog, a plan-switcher, an "are you sure" flow, or any status-translation UI beyond simple presentational formatting of Stripe's verbatim status string. All of that lives inside Stripe's hosted Portal — this story's entire UI surface is one button that opens it.
- **No Checkout changes.** `web/app/api/billing/checkout/route.ts`, `web/lib/billing/checkout.ts`, and `SubscribeActions.tsx` are Story 7.2's, already shipped (`review`). This story adds the sibling half of the same `BillingSection` slot — the half that renders for a DJ who already has an attached subscription — without modifying Story 7.2's half.
- **No live-mode/production secrets.** Same sandbox-only, `billingEnabled()`-gated scope as Stories 7.2/7.3. Story 7.6 (production cutover) is a separate, later story.
- **No new env vars.** The Portal route reuses `getStripe()` (Story 7.2's factory) and `billingEnabled()` (also Story 7.2) exactly as-is — nothing new to add to `web/README.md`.

## Tasks / Subtasks

- [x] Task 1: Customer Portal Route Handler (AC: #1)
  - [x] 1.1 New file `web/app/api/billing/portal/route.ts`, `export async function POST()` — **no `request` param**, unlike `checkout/route.ts`/`webhook/route.ts`: this route reads no body (nothing to configure — see Task 1.6 for why origin still comes from `next/headers`'s `headers()`, not `request.headers`) and declaring an unused `NextRequest` param would fail this repo's lint. `export const runtime = "nodejs"`: not strictly required by AD-18 for this call (no signature verification here, unlike the webhook), but pins it to match the other two billing routes rather than leaving one of three sibling billing routes on a different runtime for no reason.
  - [x] 1.2 `billingEnabled(process.env)` gate first — identical to `checkout/route.ts`'s Task order (env gate before auth). Not `false` → `503 { error: "Billing unavailable" }`. This is belt-and-braces, not strictly load-bearing: since Checkout itself is `billingEnabled()`-gated, no DJ can acquire a `stripe_customer_id` in an environment where this route would otherwise be reachable-but-pointless — but keeping all three billing routes symmetric and self-defending is the established pattern here, not an accident.
  - [x] 1.3 Auth via `createClient()` from `@/lib/supabase/server` + `supabase.auth.getUser()`, same as `checkout/route.ts`. No user → `401 { error: "Not signed in" }`.
  - [x] 1.4 Read `stripe_customer_id, subscription_status` from `djs` (owner-SELECT via RLS, same `.maybeSingle<{...}>()` shape as `checkout/route.ts`'s read — note this route needs `stripe_customer_id` itself, which `checkout/route.ts` also reads but `getSettingsProfile()` in `web/lib/account/profile.ts` does **not** select). A read error (`djError`) → `502 { error: "Billing unavailable" }` — same "a failed read is not a confirmed anything" discipline as `checkout/route.ts` and `profile.ts`'s `djsReadFailed`.
  - [x] 1.5 **Server-side mirror of the UI gate (Task 2.2), not just a display decision.** Require `dj.stripe_customer_id` truthy **and** `!offersSubscribeCta(dj.subscription_status)` (i.e., status is one of `SUBSCRIPTION_ATTACHED`: `active`/`trialing`/`past_due`/`incomplete`/`paused`, imported from `@/lib/billing/checkout` — reuse, don't reimplement). Either condition failing → `404 { error: "No subscription to manage" }`. This is the same "client hiding a button is not enforcement" reasoning `checkout/route.ts` already applies to `offersSubscribeCta`.
  - [x] 1.6 Origin: `(await headers()).get("origin") ?? "http://localhost:3000"` — identical derivation to `checkout/route.ts`.
  - [x] 1.7 `await getStripe().billingPortal.sessions.create({ customer: dj.stripe_customer_id, return_url: `${origin}/settings` })` inside try/catch. Catch → calm `502 { error: "Billing unavailable" }`, matching `checkout/route.ts`'s catch-all (never leak Stripe's own error text).
  - [x] 1.8 `return NextResponse.json({ url: session.url })`. **No null/empty-string guard needed here, unlike Checkout's `session.url` check** — verified directly against the installed SDK (`stripe@22.5.0`, `BillingPortal/Sessions.d.ts`): `Session.url` is typed `string` (not `string | null`, unlike `Checkout.Session.url`), so a successful `create()` call always returns a usable URL. Copying Checkout's null-check here would be dead code the type system already rules out.

- [x] Task 2: Settings UI — Manage billing entry point (AC: #1, #3)
  - [x] 2.1 New client component `web/app/components/settings/ManageBillingActions.tsx` — structurally mirrors `SubscribeActions.tsx` exactly: `"use client"`, `useState<"idle" | "starting" | "failed">("idle")`, one button ("Manage billing"), `fetch("/api/billing/portal", { method: "POST" })` (no body — unlike Checkout, there's no interval to send), same `payload.url` extraction + `window.location.assign(url)` on success (not `redirect` — same React Compiler immutability-lint reason `SubscribeActions.tsx` documents), same `state === "failed"` inline error copy pattern (e.g. "Couldn't open billing management — retry."). Don't reset `state` back to `"idle"` after a successful navigate, for the same reason `SubscribeActions.tsx` doesn't.
  - [x] 2.2 New pure helper `web/lib/billing/portal.ts` — presentational-only formatting, kept separate from the route/component so it's unit-testable without a live Stripe key (mirrors `checkout.ts`'s pure-decisions split): `formatSubscriptionStatus(status: string): string` — replaces `_` with a space and capitalizes only the first character (e.g. `"past_due"` → `"Past due"`, `"trialing"` → `"Trialing"`, `"active"` → `"Active"`). **This is presentational punctuation only, not a second state machine** — AD-19's "never locally reinterpreted" rule is about the *value* written to `subscription_status`, not about display capitalization; the underlying string stays Stripe's own verbatim value, just readably formatted, same spirit as `BillingSection`'s existing "Not subscribed" copy.
  - [x] 2.3 Update `web/app/components/settings/BillingSection.tsx`: after the existing `billingEnabled()` and `statusUnknown` guards (unchanged), branch on `offersSubscribeCta(subscriptionStatus)`:
    - `true` (never subscribed, or a terminal status — `canceled`/`unpaid`/`incomplete_expired`) → existing Subscribe half, **unchanged**.
    - `false` (an attached status) → new Manage half: a `st-row` showing `formatSubscriptionStatus(subscriptionStatus)` as the value (parallel structure to the existing "Not subscribed" row — reuse `st-row`/`st-row-label`/`st-row-value`/`st-row-note` classes, don't invent new ones) plus `<ManageBillingActions />`.
    - Update the component's own doc comment (currently: "The subscriber's state ... is Story 7.4's half of the same slot") to stop describing this as pending, matching the file's own convention of comments describing current, not future, state.

- [x] Task 3: Tests (AC: all)
  - [x] 3.1 `web/lib/billing/portal.test.ts` — unit-test `formatSubscriptionStatus` against all five `SUBSCRIPTION_ATTACHED` values plus an edge case or two (e.g. a status with no underscore, to confirm it doesn't double-capitalize or mangle a single word).
  - [x] 3.2 A render-assertion test for `BillingSection`'s new branch, following `web/app/components/dashboard/floor-disclosure.test.tsx`'s precedent exactly: `renderToStaticMarkup` from `react-dom/server`, no jsdom, no mocking needed (`BillingSection`/`SubscribeActions`/`ManageBillingActions` only use `useState`, no `window.matchMedia`-reading hooks — confirm this holds before assuming it, per that file's own documented lesson about checking rather than assuming a component is SSR-unsafe). **Gotcha to handle, not previously needed in this codebase:** `BillingSection` calls `billingEnabled(process.env)` directly (not injectable), so a test exercising the Manage-branch-renders-when-enabled path must set `process.env.STRIPE_PRICE_ID_MONTHLY`/`STRIPE_PRICE_ID_ANNUAL` for real via Vitest's `vi.stubEnv(...)` in a `beforeEach`/`afterEach` (`vi.unstubAllEnvs()`), not by passing an env object as a prop — there is no such prop. Assert: Subscribe half renders (not Manage) for `null` and each `SUBSCRIPTION_OVER` status; Manage half renders (not Subscribe) with the "Manage billing" button text for each `SUBSCRIPTION_ATTACHED` status; nothing renders when `statusUnknown` is `true` or when the Stripe Price env vars are absent (billing disabled) — three existing guards, still must hold with the new branch added.
  - [x] 3.3 Manual verification (record in Completion Notes, same discipline as Stories 7.2/7.3 Task 5.2/4.3): `stripe listen --forward-to localhost:3000/api/billing/webhook`, `pnpm --filter web dev`, a DJ who has completed Checkout (reuse the 7.2/7.3 seeded-DJ flow) → confirm Settings now shows "Manage billing" instead of the Subscribe CTAs → click it → confirm real redirect to Stripe's hosted Portal for the correct Customer → cancel or update there → confirm the redirect back to `/settings` → confirm Story 7.3's webhook fired and `subscription_status` updated (falls back to Subscribe half once canceled, per `offersSubscribeCta`/`SUBSCRIPTION_OVER`). Also confirm: hitting `POST /api/billing/portal` directly for a DJ with no `stripe_customer_id` → `404`; for a signed-out request → `401`.

## Dev Notes

### Why AC-2 requires no webhook changes — verify this claim, don't just trust it

Story 7.3's webhook already treats "how did this event happen" as irrelevant — it dedupes on `event.id`, re-fetches the canonical Subscription object, and writes via `apply_subscription_event` regardless of origin. A Portal cancel produces `customer.subscription.updated` (if scheduled for period end) or `customer.subscription.deleted` (if canceled immediately) — both are already in `RELEVANT_EVENT_TYPES` (`web/lib/billing/webhook.ts`). Confirm this by reading `web/lib/billing/webhook.ts` before starting, not by taking this note's word for it — Story 7.3 is `review`, not `done`, as of this writing, so re-verify its shipped shape rather than its Dev Notes prose (the same caution Story 7.3 itself applied to Story 7.1).

### The Portal Session API — verified against the installed SDK, not general knowledge

`stripe.billingPortal.sessions.create({ customer, return_url })` — confirmed directly against `node_modules/.pnpm/stripe@22.5.0.../stripe/esm/resources/BillingPortal/Sessions.d.ts` (this monorepo is a pnpm workspace; `web/node_modules` has no direct `stripe` dir, it resolves through the workspace root's `.pnpm` store). Both params are optional in the type (`configuration?`, `customer?`, `return_url?`), but omitting `customer` would ask Stripe to guess, which is never correct here — always pass it explicitly. No `flow_data` needed — a bare session opens the Portal's default configuration (subscription details, cancel, payment method update, invoice history), which is exactly AC-1/AC-3's ask (self-serve manage/cancel, nothing hand-built). Don't reach for `flow_data.type: "subscription_cancel"` deep-links or a custom `configuration` id — those are for a more prescriptive flow this story doesn't ask for.

### Why the Portal route needs its own `stripe_customer_id` read

`getSettingsProfile()` (`web/lib/account/profile.ts`) already reads `subscription_status` for `BillingSection`'s existing gate logic, but deliberately does **not** select `stripe_customer_id` (it's never needed for display — the Subscribe CTA doesn't show it, and neither does the Manage row per Task 2.3's design). The Portal route needs the actual id to pass to Stripe, so Task 1.4 is a second, route-local `djs` read — same pattern `checkout/route.ts` already established (it also re-reads `stripe_customer_id`/`subscription_status` itself rather than trusting a value threaded from the page). Don't add `stripe_customer_id` to `SettingsProfile`/`getSettingsProfile()` just to avoid a second query — that would leak a Stripe identifier into a type whose only other consumer is presentational, for no benefit.

### `offersSubscribeCta` already gives you the inverse predicate — don't build a second one

`web/lib/billing/checkout.ts` exports `offersSubscribeCta(status)` and it already correctly returns `false` for `null`/`undefined`/`""` (falls through the "never subscribed" `true` case) and for every `SUBSCRIPTION_ATTACHED` status. So `!offersSubscribeCta(status)` is already exactly "should the Manage half render" with no additional null-guard needed — resist the urge to write a parallel `canManageBilling()` predicate; import and negate the existing one, in both `BillingSection.tsx` and the route.

### Project Structure Notes

- New: `web/app/api/billing/portal/route.ts` (Task 1)
- New: `web/app/components/settings/ManageBillingActions.tsx` (Task 2.1)
- New: `web/lib/billing/portal.ts` + `portal.test.ts` (Task 2.2, 3.1)
- New: a `BillingSection` render-assertion test file (Task 3.2) — place alongside the component per `floor-disclosure.test.tsx`'s precedent (co-located in `app/components/settings/`, not a separate `__tests__` dir)
- Modified: `web/app/components/settings/BillingSection.tsx` (Task 2.3)
- Reused, not modified: `web/lib/billing/stripe.ts`'s `getStripe()` (Story 7.2); `web/lib/billing/checkout.ts`'s `billingEnabled()`/`offersSubscribeCta()`/`SUBSCRIPTION_ATTACHED` (Story 7.2); `web/lib/supabase/server.ts`'s `createClient()`
- No `agent/`, `shared/`, `supabase/migrations/`, or webhook files touched — this story is `web/`-only, same scope discipline as Stories 7.2/7.3.
- No new env vars, no `web/README.md` changes.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` — Epic 7 intro + Story 7.4's three ACs]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md` AD-18 — webhook as the sanctioned AD-8 exception, mechanical write-scoping; AD-19 — `subscription_status` verbatim passthrough, DJ-write-excluded, "never locally reinterpreted"]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/SOLUTION-DESIGN.md` §3.7 — "Why Stripe Checkout, not a bespoke payment flow": "a self-serve cancel portal" named explicitly as part of the undifferentiated-buy-not-build posture this story implements]
- [Source: `_bmad-output/implementation-artifacts/7-2-stripe-checkout-subscribe-flow.md` — `getStripe()`, `billingEnabled()`, `offersSubscribeCta()`, `SUBSCRIPTION_ATTACHED`/`SUBSCRIPTION_OVER` to reuse; `checkout/route.ts`'s gate ordering (env → auth → body/state → network call → calm-502 catch) this story's route mirrors; `SubscribeActions.tsx`'s client-island state-machine shape `ManageBillingActions.tsx` mirrors]
- [Source: `_bmad-output/implementation-artifacts/7-3-payment-webhook-route-handler.md` — confirms `customer.subscription.updated`/`.deleted` are already handled event types, so AC-2 needs no webhook changes; Node-runtime-pin precedent]
- [Source: `web/app/components/settings/BillingSection.tsx`, `SubscribeActions.tsx`, `web/app/(authenticated)/settings/page.tsx` — the exact reserved slot (D-1) this story fills the other half of, and its "a section with nothing true to say does not render" convention]
- [Source: `web/lib/account/profile.ts` — `SettingsProfile`/`getSettingsProfile()`, confirms `stripe_customer_id` is not currently selected there]
- [Source: `web/node_modules` via pnpm workspace root `node_modules/.pnpm/stripe@22.5.0_@types+node@20.19.43/node_modules/stripe/esm/resources/BillingPortal/Sessions.d.ts` — verified directly against the installed SDK: `SessionCreateParams { customer?, return_url?, ... }`, `Session.url: string` (non-nullable, unlike Checkout's `Session.url: string | null`)]
- [Source: `web/app/components/dashboard/floor-disclosure.test.tsx` — the `renderToStaticMarkup`-without-jsdom test precedent and its documented lesson about verifying SSR-safety rather than assuming a component untestable]
- [Source: `_bmad-output/implementation-artifacts/sprint-status.yaml` — Story 7.3 status `review` as of this writing, not `done`; re-verify its shipped shape rather than trusting only its own Dev Notes prose]
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md` line ~809 — flags that `BillingSection`'s "Not subscribed" copy is shown identically for never-subscribed vs. lapsed (`SUBSCRIPTION_OVER`) DJs, and names this story as the natural place for related messaging work. **Explicitly out of scope here per this story's own ACs** — AC-1/AC-3 only ask for a Portal entry point for an *attached* subscription; distinguishing "never subscribed" from "lapsed" on the Subscribe half is a separate, un-ACed enhancement. Left deferred, not silently expanded into this story.]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

None — no failing tests or blocked implementation steps required a debug trace. `pnpm --filter web typecheck`, `lint`, `build`, and `test` (910/910, up from 896) all green on first completion of each task; `pnpm --filter shared test` (39/39) confirmed no cross-workspace regression.

### Completion Notes List

1. **AC-2 verified, not assumed, before writing any code.** Read the shipped `web/lib/billing/webhook.ts` directly (Story 7.3 landed on `main` — commit `707f158` — via a separate concurrent session partway through this story's own `create-story` pass): `RELEVANT_EVENT_TYPES` already includes `customer.subscription.updated`/`.deleted`, and `resolveSubscriptionId`/`extractBillingFields` treat both identically to every other event type via the canonical re-fetch. A Portal-initiated change/cancel is indistinguishable to the webhook from any other subscription change, so AC-2 needed zero new code — confirmed exactly as the story's own Dev Notes instructed, not taken on faith.
2. **The route's gate (Task 1.5) reuses `offersSubscribeCta` inverted, per the story's own explicit instruction not to build a second predicate.** `!dj?.stripe_customer_id || offersSubscribeCta(dj.subscription_status)` rejects with `404` unless both a Stripe Customer exists and the status is one of `SUBSCRIPTION_ATTACHED` — the same list Story 7.2's `BillingSection` already uses, imported rather than reimplemented.
3. **Manual live verification (Task 3.3) was partially blocked, same class of blocker Story 7.3 hit in this same environment:** `stripe` CLI is not installed, and `docker info`/`supabase status` both hang past the tool timeout, so the full `stripe listen` → real Portal session → webhook round-trip → `subscription_status` update flow could not be exercised against live Stripe/Supabase in this session.
   **What WAS verified live:** a concurrent session's own `next dev` was already running against this exact working directory on port 3009 (confirmed by fetching `/login` and finding "Curfew" in the response, not assumed) and had picked up the new route via its file watcher. Direct `curl` against it confirmed real HTTP behavior matching the design: unauthenticated `POST /api/billing/portal` → `401`; `GET /api/billing/portal` → `405` (only `POST` exported); both identical to the sibling `checkout` route's real behavior probed the same way for comparison. This exercises the actual Next.js request plumbing (the `billingEnabled()`/auth gate ordering, the `nodejs` runtime pin) in a real running server, not just isolated function calls.
   **What remains unverified:** a real authenticated, subscribed DJ reaching a genuine `stripe.billingPortal.sessions.create()` call and landing on Stripe's hosted Portal; the `404` "no subscription to manage" branch against a real `djs` row; the Portal → webhook → `subscription_status` round-trip. The webhook-round-trip half is Story 7.3's own already-flagged gap (its Completion Notes record the identical Docker/Stripe-CLI blocker), not a new one this story introduces. Flagged here rather than silently skipped, matching this project's established precedent (Story 5.4's blocked 375px live pass, Story 7.3's own blocked `stripe listen` flow).
4. **`ManageBillingActions.tsx` and `SubscribeActions.tsx` are intentionally near-duplicate in structure** (idle/starting/failed state machine, `window.location.assign` navigation, no-reset-on-success) rather than factored into one shared component — mirroring the story's own instruction to structurally mirror, not abstract over, the two CTAs. They differ in exactly the ways that matter (no request body, no interval choice, different button/error copy), and the two will likely diverge further once Story 7.6 or later billing UI work lands; a shared abstraction now would be premature.
5. **`formatSubscriptionStatus` is presentational only** — confirmed against AD-19's actual wording ("never locally reinterpreted" governs the *value* written to the column) before writing it, not just asserted in the story's own Dev Notes. It never feeds back into any write path; `BillingSection`'s branch logic and the route's gate both still read `subscription_status` verbatim via `offersSubscribeCta`.

### File List

- `web/app/api/billing/portal/route.ts` (new)
- `web/lib/billing/portal.ts` (new)
- `web/lib/billing/portal.test.ts` (new)
- `web/app/components/settings/ManageBillingActions.tsx` (new)
- `web/app/components/settings/billing-section.test.tsx` (new)
- `web/app/components/settings/BillingSection.tsx` (modified)

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-15 | Story created via bmad-create-story. |
| 2026-08-15 | Story 7.4 implemented: `POST /api/billing/portal` (Node-pinned, `billingEnabled()`-gated, auth-gated, server-side mirror of the `offersSubscribeCta`-attached gate, creates a Stripe Customer Portal session, calm 502 on failure); `web/lib/billing/portal.ts` (`formatSubscriptionStatus`, presentational-only per AD-19); `ManageBillingActions.tsx` (client island mirroring `SubscribeActions.tsx`); `BillingSection.tsx` now renders both halves of the D-1 slot — Subscribe for never-subscribed/terminal statuses, Manage for attached statuses. 14 new unit/render-assertion tests (910 web total, zero regressions). Manual Stripe Portal / webhook round-trip (Task 3.3) partially blocked by an unavailable Stripe CLI and an unresponsive local Docker/Supabase daemon — real HTTP-plumbing behavior (auth gate, method restriction) verified live against a concurrent session's already-running dev server instead, flagged rather than silently skipped. Status → review. |
