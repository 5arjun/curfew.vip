---
baseline_commit: 561c76cbc3c37a864a116e8e77fb7ef55ff24c08
---

# Story 7.5: Web access-gate on subscription

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a DJ,
I want the web dashboard gated on my subscription while my agent keeps capturing sets regardless,
so that lapsing restricts the website but never loses my data.

## Acceptance Criteria

1. **Given** a web route serving dashboard/stats, **When** accessed, **Then** a route guard allows `active`/`trialing` and restricts otherwise. *(AD-19)*
2. **Given** the agent, **Then** its local capture (parse → local SQLite → sync-queue) and the idempotent `PUT /sets/:set_id` endpoint are never gated by `subscription_status` — billing state is invisible to the agent. *(AD-19 hard invariant)*
3. **Given** a lapsed subscriber, **Then** their agent keeps parsing and queuing sets locally with no data loss. *(AD-19)*
4. **Given** reactivation, **When** the next webhook flips status to active, **Then** already-synced sets appear immediately (no backfill needed). *(AD-19, §3.7)*

*(Source: `_bmad-output/planning-artifacts/epics.md` — Epic 7: Subscription & Billing, Story 7.5.)*

## Scope Boundaries (read before starting)

- **AC-2/AC-3 need zero new code — verify this, don't just trust it.** `PUT /sets/:set_id` is not a Next.js Route Handler at all: AD-19 requires it be implemented Postgres-side (trigger/extension in front of PostgREST), precisely so a web-paywall matcher can never net it by accident. Confirm directly before starting: `web/app/api` currently contains only `billing/{checkout,portal,webhook}` — no `sets` route exists in the Next tree — and the agent's `parse → local SQLite → sync-queue` path (`agent/src-tauri`) has no `subscription_status` read anywhere. This story adds **zero** lines to `agent/`, `shared/`, or any sync-path code. If you find yourself editing anything under `agent/` for this story, stop — that is out of scope by construction, not an oversight.
- **This story is 100% additive to the existing `(authenticated)` route group's middleware gate — it does not touch `agent/` or the sync contract.** The only prior art is Story 3.10's phone-on-file gate (`web/lib/supabase/phone-gate.ts` + `web/lib/supabase/middleware.ts`) — read both fully before writing anything; this story's gate is a sibling to that one, not a replacement.
- **`/settings` and `/link-agent` are deliberately NOT in the gated route list**, even though `/settings` is a phone-gated route today. `/settings` is where `BillingSection` (Story 7.2/7.4) lives — gating it would strand a lapsed DJ with no way to resubscribe. `/link-agent` is onboarding, not "dashboard/stats" (AC-1's literal scope), and AD-19 explicitly forbids gating anything the agent itself touches "for consistency." If you're tempted to add either to the gated list "to be thorough," don't — it's a correctness bug, not a gap.
- **Do not widen `proxy.ts`'s matcher or add a `/api/:path*` matcher for this gate.** AD-19 names this exact mistake explicitly (see Dev Notes) as the failure mode this story must not introduce. The gate belongs in `updateSession()` (`web/lib/supabase/middleware.ts`), scoped by the same kind of prefix allowlist the phone gate already uses — never a broader net.
- **No subscription-lifecycle UI.** The gate's destination page states the fact and links to `/settings` where Story 7.2/7.4's existing Subscribe/Manage CTAs already live. Don't build a second Checkout/Portal entry point on the gate page itself.
- **No changes to `apply_subscription_event`, the webhook, or the `djs` billing columns/migration.** This story only *reads* `subscription_status`; Story 7.1/7.3 already own writing it.

## Tasks / Subtasks

- [x] Task 1: `hasWebAccess` predicate (AC: #1)
  - [x] 1.1 New file `web/lib/billing/access.ts`: `export function hasWebAccess(status: string | null | undefined): boolean` — returns `true` **only** for `"active"` and `"trialing"` (AC-1's literal wording), `false` for everything else including `null`/`undefined`/`""`/`"past_due"`/`"incomplete"`/`"paused"`/`"canceled"`/`"unpaid"`/`"incomplete_expired"` and any future Stripe status this code doesn't know about. **Do not reuse or extend `SUBSCRIPTION_ATTACHED`/`offersSubscribeCta` from `web/lib/billing/checkout.ts`** — those answer a different question ("should Settings offer a CTA," which treats `past_due`/`incomplete`/`paused` as attached-so-stay-quiet) than this predicate answers ("may the DJ use the dashboard right now"). Keep this a new, separate, pure function — same file-separation discipline `web/lib/billing/portal.ts` already established relative to `checkout.ts`.
  - [x] 1.2 Unit test `web/lib/billing/access.test.ts`: assert `true` for `"active"`/`"trialing"`; `false` for `null`, `undefined`, `""`, and every other known Stripe status (`past_due`, `canceled`, `unpaid`, `incomplete`, `incomplete_expired`, `paused`); `false` for an arbitrary unrecognized string (a future Stripe status).

- [x] Task 2: Gated-path predicate (AC: #1, and the `/settings`/`/link-agent` exclusion above)
  - [x] 2.1 New file `web/lib/supabase/subscription-gate.ts`, structurally mirroring `phone-gate.ts`: export `SUBSCRIPTION_GATED_PREFIXES` and `isSubscriptionGatedPath(pathname: string): boolean`. Prefix list: `/dashboard`, `/style-evolution`, `/library-utilization`, `/set`, `/track` — the phone gate's list **minus** `/settings` and `/link-agent` (see Scope Boundaries). Comment the exclusion inline so a future route addition doesn't "helpfully" restore either.
  - [x] 2.2 Unit test `web/lib/supabase/subscription-gate.test.ts`, mirroring `phone-gate.test.ts`'s structure: gates the five prefixes (including a `/set/abc-123` and `/track/<id>` dynamic-segment case); explicitly asserts `isSubscriptionGatedPath("/settings") === false` and `isSubscriptionGatedPath("/link-agent") === false` (the exclusion is the load-bearing behavior here, not an afterthought); exempts `/`, `/login`, `/phone-required`, `/welcome`, `/auth/*`; rejects lookalike prefixes (`/settings-export`, `/setlist`, `/tracking`).

- [x] Task 3: Wire the gate into middleware (AC: #1)
  - [x] 3.1 In `web/lib/supabase/middleware.ts`'s `updateSession()`, add a second gate block **after** the existing phone-on-file block, inside the same `try`, guarded the same way (`userId &&`). **Do not share or modify the phone gate's `djs.phone` read** — issue this gate's own `.select("subscription_status").eq("id", userId).single()` read, same isolation discipline Story 7.4's Dev Notes documented for the Portal route's own `stripe_customer_id` read (each concern owns its read; don't couple unrelated billing/phone reads into one query for a micro-optimization).
  - [x] 3.2 **No session-long cookie cache for this gate — read on every request to a gated path, uncached.** This is a deliberate deviation from the phone gate's `PHONE_ON_FILE_COOKIE` pattern, not an oversight: phone-on-file only ever transitions missing→present within a session (safe to cache "present" for the session's lifetime), but `subscription_status` is bidirectionally mutable *while a session is open* — a webhook can flip a DJ from `active` to `past_due` (dunning) or from `canceled` back to `active` (Portal resubscribe, or Story 7.6-era real billing) at any moment. AC-4 requires reactivation to restore dashboard access "immediately (no backfill needed)" — a cached "no access" cookie surviving until the browser session ends would directly violate that AC by locking a DJ out after they've already paid again. If a caching optimization is wanted later, it needs a short TTL or webhook-driven invalidation, not this story's session-cookie shape — don't copy `phone-gate.ts`'s cookie pattern here even though it's the nearest precedent.
  - [x] 3.3 On `isSubscriptionGatedPath(pathname)` true and `!hasWebAccess(status)` (including a failed/errored read — fail **closed** here, the inverse of the phone gate's fail-open, because AD-19 is a paywall invariant, not a contactability nice-to-have; a transient DB hiccup should not leak free access), redirect to `/subscription-required`, carrying refreshed auth cookies over exactly like the phone-gate redirect does (`supabaseResponse.cookies.getAll().forEach(...)`).
  - [x] 3.4 Order matters: run the phone gate first, subscription gate second — a phone-less DJ should land on `/phone-required` before ever learning about billing, matching this project's existing onboarding sequence (phone → welcome → link-agent, billing is a Settings-initiated action, not a forced onboarding step).

- [x] Task 4: `/subscription-required` destination page (AC: #1)
  - [x] 4.1 New route `web/app/subscription-required/page.tsx` — **top-level, not inside `(onboarding)` or `(authenticated)`**, matching `web/app/reset-password/`'s precedent for a top-level utility route that isn't onboarding and isn't itself gated. Server component: `createClient()` + `supabase.auth.getUser()`; no user → `redirect("/login")` (same doorway pattern `phone-required/page.tsx` uses). If the user *does* have web access (`hasWebAccess` true — e.g. they reactivated and landed here from a stale bookmark/back-navigation), `redirect("/dashboard")`.
  - [x] 4.2 **No UX-DR spec exists for this screen** — confirmed absent from `EXPERIENCE.md` (unlike `/phone-required`, which Story 3.10 built against a named State Patterns row). Reuse the `lp-auth lp-auth--solo` shell `phone-required/page.tsx` already establishes (same landing-shell classes, no new CSS) and write calm, reassuring copy in `EXPERIENCE.md`'s Failure Register register — the core fact to land: subscription is inactive, **nothing has been lost**, the agent kept capturing regardless, and a link to `/settings` is where to fix it. Do not invent a distinct "never subscribed" vs. "lapsed" copy split — `deferred-work.md` already flags that exact distinction as an out-of-scope enhancement for `BillingSection`'s Subscribe half; this page states one generic fact for both cases.
  - [x] 4.3 The page's only interactive element is a link to `/settings` (`<Link href="/settings">`) — not a bespoke Checkout/Portal trigger (Scope Boundaries).

- [x] Task 5: Manual verification (AC: all)
  - [x] 5.1 Record in Completion Notes whether a live pass was possible in this environment (same "say so, don't silently skip" discipline as Stories 7.2/7.3/7.4, which all hit an unavailable Stripe CLI / unresponsive local Docker in this same environment — check whether that's still true before assuming it). If live: seed a DJ with `subscription_status = null`, confirm `/dashboard` redirects to `/subscription-required` and `/settings` does not; flip to `active` directly in the DB, confirm `/dashboard` loads without any cache/cookie needing to clear; flip to `past_due`, confirm the gate restricts again; confirm `/link-agent` is reachable throughout regardless of status.

## Dev Notes

### AD-19's exact rule — read this before touching `middleware.ts`

> **Hard invariant:** the access gate restricts **the web experience only**. The agent's local capture (parse → local SQLite → sync-queue) and the idempotent set-sync endpoint (`PUT /sets/:set_id`, AD-4) are **never** gated by `subscription_status` — billing state is invisible to the agent and to the sync contract. A lapsed subscriber's agent keeps parsing and queuing every set locally and **resumes syncing on reactivation with no data loss**; only web routes serving the dashboard/stats check `subscription_status`. **Sync-endpoint isolation (structural, not just textual):** the cloud-side contract validation AD-3 requires for `PUT /sets/:set_id` on receive must **not** be implemented as a Next.js Route Handler living in the same route tree as the Epic 7 paywall-gated dashboard routes — implement it as a Postgres-side mechanism (trigger/extension) in front of PostgREST instead. This closes the seam where a blanket auth/subscription middleware matcher written for the web paywall (e.g. `matcher: ['/api/:path*']`) could net the sync route by accident, even though no line of Epic 7 code ever mentions "sync."

That last sentence is naming the exact mistake Task 3 must not make. It's already structurally impossible today (`web/app/api` has no `sets` route — Story 4.6/AD-4's sync endpoint lives outside the Next app entirely), but it stays impossible only if this story's gate is added as a **narrow prefix allowlist inside `updateSession()`**, the same shape `phone-gate.ts` already uses — never as a `proxy.ts` matcher change or an `/api/:path*` pattern. `proxy.ts`'s existing matcher (`/((?!_next/static|_next/image|favicon.ico|...).*)`) already covers nearly every route including `/api/*`; this story must not add subscription logic to that matcher or to `updateSession()`'s top-level control flow — only inside the same kind of `isXGatedPath()`-scoped `if` block the phone gate already demonstrates.

### `subscription_status`'s value set (AD-19, `web/lib/billing/checkout.ts`)

Stripe's verbatim statuses, never re-enumerated: `trialing`, `active`, `past_due`, `canceled`, `unpaid`, `paused`, `incomplete`, `incomplete_expired`, and potentially future ones Stripe adds later. `hasWebAccess` (Task 1) allows exactly `active`/`trialing` per AC-1's literal text — this is **narrower** than `checkout.ts`'s existing `SUBSCRIPTION_ATTACHED` (which also includes `past_due`/`incomplete`/`paused` as "don't re-offer Checkout, but don't count as full access either"). That's intentional, not a bug to reconcile: `SUBSCRIPTION_ATTACHED` answers "does Settings show Manage instead of Subscribe," `hasWebAccess` answers "can this DJ use the dashboard today" — a `past_due` DJ correctly sees "Manage billing" in Settings (to fix their card) while correctly being gated out of the dashboard until payment recovers.

### Why the gate must read fresh, not cache (expanded from Task 3.2)

The phone gate's `PHONE_ON_FILE_COOKIE` is safe to cache for a session because `phoneOnFile` only moves one direction (missing → present) within a DJ's lifetime — once true, always true. `subscription_status` has no such monotonicity: Stripe webhooks (Story 7.3) can flip it in either direction at any time, including while a DJ has the dashboard open in another tab. AC-4 is explicit that reactivation must restore access "immediately (no backfill needed)" — that AC is about *data* reappearing once the gate reopens, but it only holds if the gate itself reopens promptly too. A copy-pasted cookie-cache from `phone-gate.ts` would silently break AC-4 for anyone who reactivates without closing their browser. Fail-closed on a read error (Task 3.3) is the other deliberate inversion from the phone gate's fail-open — a DB hiccup should never grant free access to a paywalled product, even though it's fine to let a hiccup skip the (non-monetary) phone nag for one request.

### Project Structure Notes

- New: `web/lib/billing/access.ts` + `access.test.ts` (Task 1)
- New: `web/lib/supabase/subscription-gate.ts` + `subscription-gate.test.ts` (Task 2)
- Modified: `web/lib/supabase/middleware.ts` (Task 3) — additive second gate block, phone gate untouched
- New: `web/app/subscription-required/page.tsx` (Task 4) — top-level route, sibling to `web/app/reset-password/`
- No `agent/`, `shared/`, `supabase/migrations/`, webhook, or `checkout.ts`/`portal.ts` files touched.
- No new env vars.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` — Epic 7 intro + Story 7.5's four ACs]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md` AD-19 — quoted above verbatim; AD-18 for the webhook write path this story only reads from]
- [Source: `web/lib/supabase/phone-gate.ts`, `web/lib/supabase/middleware.ts`, `web/lib/supabase/phone-gate.test.ts` — the direct structural precedent for Tasks 2/3; read fully before writing, not summarized from this story alone]
- [Source: `web/lib/billing/checkout.ts` — `SUBSCRIPTION_ATTACHED`, `offersSubscribeCta`, `billingEnabled` — why `hasWebAccess` is a new, narrower, separate predicate, not a reuse]
- [Source: `web/app/(onboarding)/phone-required/page.tsx` — the server-guarded redirect pattern and `lp-auth--solo` shell Task 4 reuses]
- [Source: `web/app/(authenticated)/layout.tsx` — confirms no group-level auth gate exists yet; each page/the middleware self-guards, consistent with this story's approach]
- [Source: `_bmad-output/implementation-artifacts/7-4-customer-portal-manage-cancel.md` — precedent for "each billing concern issues its own DB read rather than sharing one across stories" (Task 3.1's isolation rule)]
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md` — the already-flagged "never-subscribed vs. lapsed" Settings copy gap, cited in Task 4.2 as the reason this page doesn't attempt that distinction either]
- [Source: `web/proxy.ts` — current matcher, cited in Dev Notes to confirm this story must not touch it]

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (`claude-opus-5`), bmad-dev-story.

### Debug Log References

- **Scope boundaries verified before writing, not assumed** (the story asked for this explicitly): `web/app/api` contains exactly three route files — `billing/{checkout,portal,webhook}/route.ts` — and `find web/app -path '*sets*'` returns nothing, so no `sets` route exists in the Next tree. The only `subscription` matches under `agent/` are three *comments* in `sync_queue.rs` and `heartbeat.rs` asserting nothing there reads `subscription_status` — no code reads it. Confirmed at the end via `git status`: zero files changed under `agent/`, `shared/`, or `supabase/migrations/`.
- **`lp-auth-alt-link` was invented and removed.** The first draft of the destination page used a link class that does not exist in `landing.css`, which would have silently rendered an unstyled link (Task 4.2 requires no new CSS). Replaced with `lp-auth-continue` — the existing full-width card-closing `<Link>` the signed-in login card already ends on. Every class the page uses was then grep-confirmed present in `landing.css`.
- **Two bugs in the live-verification harness, not in the product**, both worth recording because each looked like a product failure for a moment: (1) the `sync_set` payload's `plays[].started_at` was written as an ISO string and rejected with `invalid input syntax for type bigint` — the wire format is epoch-ms (the same epoch-vs-ISO seam Story 3.9's `energy_arc` bug turned on); (2) a hand-written verification set 404'd on `/set/<id>` after reactivation, which was traced to the synthetic payload carrying 2 `derived` keys where a real set carries 10 — the Set Detail page's own requirement, reached *past* the gate (a 404, not a 307). The honest AC-4 subject is a real seeded set, which returns 200 under `active` and 307 under `canceled`.

### Completion Notes List

**A live pass WAS possible this session — the first in Epic 7.** Stories 7.2/7.3/7.4 all recorded an unreachable Docker socket and an absent Stripe CLI; per Task 5.1's instruction that blocker was re-checked rather than assumed, and it has cleared. The local Supabase stack is up (Auth healthy on 54321, Postgres on 54322, containers running), and `next dev` for this working directory is live on port 3009 and hot-reloaded the new route. No Stripe CLI was needed: this story only *reads* `subscription_status`, so the webhook's effect was simulated by writing the column directly in the local DB — exactly what Task 5.1 specifies.

Method: signed in as the seeded dev DJ (`dev@curfew.local`) through the real `@supabase/ssr` client to mint genuine auth cookies, then drove real HTTP requests through the real middleware, flipping `subscription_status` in the local DB between probes. **The same cookie jar was reused across every flip — nothing was cleared between states**, which is the specific thing AC-4 needs proven. Playwright's browsers are not downloaded on this machine and installing them was declined (disk pressure); the gate is a server-side redirect, so HTTP observation exercises the identical code path and no browser was required.

**AC-1 — full status × route matrix, driven live:**

| `subscription_status` | `/dashboard`, `/style-evolution`, `/library-utilization` | `/set/<id>`, `/track/<id>` | `/settings` | `/link-agent` | `/subscription-required` |
| --- | --- | --- | --- | --- | --- |
| `null` | 307 → `/subscription-required` | — | 200 | 200 | 200 |
| `canceled` | 307 → `/subscription-required` | 307 → `/subscription-required` | 200 | 200 | 200 |
| `past_due` | 307 → `/subscription-required` | — | 200 | 200 | 200 |
| `incomplete` | 307 → `/subscription-required` | — | 200 | 200 | 200 |
| `active` | 200 | — | 200 | 200 | 307 → `/dashboard` |
| `trialing` | 200 | — | 200 | 200 | 307 → `/dashboard` |

`/settings` and `/link-agent` returned 200 in **every** state, including `null` — the exclusion that keeps a lapsed DJ able to resubscribe is verified behavior, not just a comment. `past_due` and `incomplete` restricting confirms `hasWebAccess` is genuinely narrower than `checkout.ts`'s `SUBSCRIPTION_ATTACHED`, as intended.

**AC-2/AC-3 — the hard invariant, proven rather than reasoned about.** With `subscription_status = 'canceled'` and every dashboard route returning 307, the *same DJ*, at the *same moment*, with the *same credentials*, successfully synced a brand-new set through the agent's own write path: `POST /rest/v1/rpc/sync_set` → **HTTP 200**, `public.sets` for that DJ went **58 → 59**, and `GET /rest/v1/sets` also returned 200. Billing state is invisible to the sync contract in fact, not just by construction. (Test rows were deleted and the DB restored to its seed baseline afterward — 58 sets / 58 sessions / 2,294 plays, `subscription_status` back to the `canceled` it was found at.)

**AC-4 — reactivation, no backfill.** Flipping `canceled → active` (the webhook's only effect) reopened `/dashboard` (200) on the very next request with **no cache or cookie cleared and no browser restart** — which is precisely the failure the deliberate no-cookie-cache decision (Task 3.2) exists to prevent. Flipping back to `past_due` restricted it again immediately, so the gate is bidirectional in practice. A real seeded set at `/set/<id>` returned 200 under `active` and 307 under `canceled`; nothing needed re-syncing across the transition.

**Interpretations recorded rather than made silently:**

- **Task 3.1's read lives in `subscription-gate.ts` as `readSubscriptionStatus()`**, not inline in `middleware.ts`. This mirrors `phone-gate.ts` exactly (which owns `phoneOnFile()` the same way), keeps the query testable, and still satisfies the isolation rule — it is this gate's own `.select("subscription_status").eq("id", userId).single()`, and the phone gate's read was not touched or shared. It has its own 6 unit tests, including the fail-closed cases and an assertion that it reads *only* `subscription_status` scoped to the caller's own id.
- **Fail-closed is implemented by collapsing errors into `null`** rather than adding a third state like `phoneOnFile`'s `"unknown"`. Because `hasWebAccess(null)` is already `false`, a read error, a thrown client error, and a missing `djs` row all deny access with no extra branch a future edit could forget. The phone gate needs its tri-state because it must tell "confirmed present" apart from "unknown" before minting a cookie; this gate mints nothing.
- **The destination page brings its own `lp-root` shell and imports `../landing.css`.** Task 4.1 (top-level route) and Task 4.2 (reuse `/phone-required`'s `lp-auth--solo` shell) are in mild tension, because those classes live in `landing.css`, which only the `(marketing)` and `(onboarding)` group layouts import, and `lp-auth`'s padding reads `--lp-gutter` from `.lp-root` — without that wrapper the shell silently degrades. Resolved by having the page carry both itself, the same way `/reset-password` (the cited top-level precedent) carries its own shell. It also renders `MeshDrift` with `AUTH_PALETTE` — the existing components behind `/phone-required`'s ember room, used directly rather than through the onboarding-specific `OnboardingMesh` wrapper, since this page is not part of the onboarding corridor. **Zero new CSS**; verified by grep that every class used already exists.
- **No unit test for Task 4's page.** Tasks 1.2 and 2.2 name tests explicitly and Task 4 does not; the page has no mapping logic (its copy is static, unlike `auth-copy.ts`'s error mapping, which is why *that* has a copy test), and both predicates it calls are covered. Its behavior was verified live instead — see the matrix above, where the page's own two guards show up as the `/subscription-required` column.
- **`EXPERIENCE.md` gained a Failure Register row** for this screen (Task 4.2), confirmed genuinely absent beforehand. One generic statement covers never-subscribed and lapsed alike, per the story's instruction not to pre-empt `deferred-work.md`'s already-flagged copy split.

**Design-hook finding, classified not silenced:** the `impeccable` hook flagged `gradient-text` at `app/landing.css:1363`. Left unchanged — it is pre-existing (this story has a zero-line diff on `landing.css`; the file was only *imported*), and the rule's concern is decorative gradient text on headings and metrics, whereas that selector is `.lp-support-logo--traktor`, a vendor brandmark rendered as text where the ink ramp showing through the glyphs is the point.

**Not verified:** nothing in this story's scope was left unverified. The gate was not exercised against a real Stripe webhook flipping the column (no Stripe CLI here, and Story 7.3 owns that path) — the column was written directly, which is what Task 5.1 asks for and is indistinguishable to this story's read-only code.

### File List

- `web/lib/billing/access.ts` (new)
- `web/lib/billing/access.test.ts` (new)
- `web/lib/supabase/subscription-gate.ts` (new)
- `web/lib/supabase/subscription-gate.test.ts` (new)
- `web/app/subscription-required/page.tsx` (new)
- `web/lib/supabase/middleware.ts` (modified — 46 additive lines, zero deletions; the phone gate is untouched)
- `_bmad-output/planning-artifacts/ux-designs/ux-name-pending-2026-07-19/EXPERIENCE.md` (modified — one Failure Register row)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — status transitions)

*(Other files showing as modified in `git status` — `web/app/(marketing)/{terms,privacy}/page.tsx`, `web/app/(onboarding)/phone-required/*`, `pre-launch-services-checklist.md` — belong to a concurrent session and were neither touched nor committed by this one.)*

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-16 | Story created via bmad-create-story. |
| 2026-08-16 | All 5 tasks implemented. New `hasWebAccess` predicate + `subscription-gate.ts` (path predicate and fail-closed uncached read), second gate block in `updateSession()` after the phone gate, and a top-level `/subscription-required` page. 18 new unit tests (web 947 total, zero regressions); lint, typecheck and production build green. Full AC matrix verified live against the local Supabase stack, including a lapsed DJ successfully syncing a new set while every dashboard route restricted. Status → review. |
