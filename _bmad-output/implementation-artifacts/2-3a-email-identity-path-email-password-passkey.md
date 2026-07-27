---
baseline_commit: a12d0f658c581e2fdeb6ebb158a3110911f4d1ae
---

# Story 2.3a: Email-identity path (email+password + passkey)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a DJ,
I want to sign up / log in with email+password and optionally enable a passkey,
so that I have a base Curfew identity anchored to my verified email.

## Acceptance Criteria

1. **Given** email+password signup, **When** I verify my email, **Then** one `dj` account exists anchored to that verified email. *(FR-29, AR-10)*
2. **Given** the email path, **When** I add a passkey (WebAuthn), **Then** it attaches as an add-on to that same account — not a separate identity. *(FR-29, AR-10)*
3. **Given** an auth failure, **Then** the calm inline auth-failed copy shows (no modal, no alarm color). *(UX-DR18, UX-DR19)*

[Source: _bmad-output/planning-artifacts/epics.md#Story 2.3a, lines 399-409]

### Scope boundaries (binding — read before writing code)

- **This is the first story to introduce a `supabase-js`/`@supabase/ssr` client anywhere in the monorepo.** `supabase/PROVISIONING.md` (written during Story 2.1) says the first web consumer "arrives around Story 2.10 or Story 3.2" — that line is now stale; this story is earlier. It does **not** need the real cloud project from `PROVISIONING.md` to exist — everything in this story targets the **local** Supabase stack (`supabase start`), exactly like Story 2.1's pgTAP tests did. Whether Arjun has run the cloud runbook is orthogonal to this story.
- **In scope:** email+password signup/login, the email-confirmation flow, passkey (WebAuthn) as an add-on to an existing signed-in account, passkey-based sign-in for returning users, and the calm inline auth-failed copy. **Out of scope:** Google/Apple OAuth and cross-provider account linking (Story 2.3b), the post-OAuth phone-required prompt (Story 2.3c), any visual polish — Ghost-style inputs, the Biometric Anchor's fingerprint badge/radio-indicator chrome, official Google/Apple button lockups (Story 2.4, sequenced directly after this one) — this story ships **functional, token-consuming, unpolished** forms, not the final pixel spec. Also out of scope: any real Dashboard to redirect into (Epic 3) — redirect target is the existing scaffold root page (`/`), explicitly a placeholder.
- **⚠️ Flagged gap — phone/name collection on the email path is not assigned to any story as currently scoped, including this one.** AR-10/FR-29 state "every account has a phone number on file **regardless of signup path**," but Story 2.3c's title, both its ACs, and its EXPERIENCE.md state-pattern entry all scope phone collection strictly to **post-OAuth**. EXPERIENCE.md's Component-Patterns row for the auth form ("manual name, email, phone, and password fields") reads as the pre-split description of the original unified Story 2.3 (see epics.md's sizing note, same 2026-07-20 date) and was not updated after the 2.3a/b/c split. Story 2.1's own scope notes are explicit that **no story before 2.3c adds a DJ-writable column to `djs`** — meaning the `phone` column + its write policy do not exist yet and are not this story's to create. **Net effect: as scoped, an email-only DJ who never touches Google/Apple will never be prompted for a phone number anywhere in 2.3a or 2.3c.** This story does **not** silently expand its own scope to close that gap (that would contradict Story 2.1's explicit column-sequencing note). Flag for Arjun: either broaden 2.3c to "phone required if missing, on any path" or add a phone field here. Do not add a `name` field either, for the same reason — not in this story's ACs, not backed by a writable column.
- **Email confirmation is currently disabled in `supabase/config.toml`** (`[auth.email] enable_confirmations = false`, the Story 1.1 scaffold default). AC-1's "when I verify my email" is meaningless without it — Task 1 flips this to `true`. This is a **local dev config change**, not a cloud one; it takes effect the next `supabase start`/`supabase stop --no-backup && supabase start`.
- **The `djs` row already exists before email confirmation**, structurally. Story 2.1's `handle_new_dj()` trigger fires `AFTER INSERT ON auth.users`, and Supabase creates the `auth.users` row at `signUp()` time — before confirmation, not after. So AC-1's "one dj account exists anchored to that verified email" is already true the instant `signUp()` is called; this story's actual job on AC-1 is making the **confirmation gate real** (no usable session until confirmed) and giving the DJ a working confirm-link flow, not creating new account-provisioning logic. Do not add a second/duplicate account-creation path — the Story 2.1 trigger is the only writer of new `djs` rows.

## Tasks / Subtasks

- [x] **Task 1 — Supabase Auth config for this story (AC: 1, 2)**
  - [x] 1.1 In `supabase/config.toml`, flip `[auth.email] enable_confirmations` from `false` to `true`.
  - [x] 1.2 Uncomment and enable `[auth.passkey]`: `enabled = true`.
  - [x] 1.3 Uncomment and configure `[auth.webauthn]`: `rp_display_name = "Curfew"`, `rp_id = "localhost"`, `rp_origins = ["http://localhost:3000"]`. **Use `localhost`, not `127.0.0.1`** — WebAuthn's spec requires the RP ID to be a registrable domain or the literal string `localhost`, IP literals are rejected (browsers vary, don't rely on them).
  - [x] 1.4 **Reconcile `[auth] site_url`/`additional_redirect_urls` with the `localhost` decision above.** They currently read `site_url = "http://127.0.0.1:3000"` / `additional_redirect_urls = ["https://127.0.0.1:3000"]` (Story 1.1 scaffold default, and already internally inconsistent — http vs. https). Supabase's email-confirmation flow silently falls back to `site_url` (dropping your `/auth/confirm` `emailRedirectTo`) if the redirect target isn't on the allow-list — so testing the confirm-link flow via `http://localhost:3000` (as Task 1.3's WebAuthn origin requires) while `site_url`/`additional_redirect_urls` still only allow `127.0.0.1` will silently misroute the confirmation link. Update `site_url` to `http://localhost:3000` and ensure `additional_redirect_urls` includes `http://localhost:3000` (adjust the scheme too — don't leave the http/https mismatch in place), so both the WebAuthn origin and the auth-confirm redirect agree on one host.
  - [x] 1.5 Restart the local stack (`supabase stop && supabase start`, or equivalent) so config changes take effect before manual testing.

- [x] **Task 2 — Supabase client + SSR session wiring (AC: 1)**
  - [x] 2.1 Add `@supabase/supabase-js` (>= `2.105.0` — the minimum version exposing `registerPasskey`/`signInWithPasskey`) and `@supabase/ssr` (latest) to `web/package.json` dependencies. First `supabase-js`/`@supabase/ssr` usage anywhere in the monorepo — no existing pattern to match, but do match the repo's existing devDependency-pinning style (see `shared/`'s `vitest` version pin, Story 2.2 precedent).
  - [x] 2.2 `web/lib/supabase/client.ts` — `createBrowserClient(url, key, { auth: { experimental: { passkey: true } } })`. The `experimental.passkey` opt-in is **required** by Supabase for `registerPasskey()`/`signInWithPasskey()` to exist on the client at all (feature is in beta as of 2026-05-28); omitting it will make Task 5's calls fail or be undefined.
  - [x] 2.3 `web/lib/supabase/server.ts` — `createServerClient` using `next/headers` `cookies()` for `getAll`/`setAll`, same `experimental.passkey` flag for consistency (passkey ceremonies are client-only in practice, but keep both clients configured identically to avoid a future "why does this only work in the browser" bug).
  - [x] 2.4 `web/lib/supabase/middleware.ts` — an `updateSession(request)` helper that refreshes the auth token and re-issues cookies on both the request and response. **Verify the exact current method name against the live docs before implementing** (`https://supabase.com/docs/guides/auth/server-side/nextjs`) — Supabase's own recommended call here has moved from `getSession()`/`getUser()` to `getClaims()` (JWT-signature-verified, no round-trip) within the last cycle; do not copy stale blog-post code that still calls `getUser()` for this refresh step.
  - [x] 2.5 `web/middleware.ts` (repo root of `web/`) — Next.js middleware invoking `updateSession`, with a `matcher` excluding `_next/static`, `_next/image`, `favicon.ico`, and other static assets (standard Supabase-documented matcher pattern). **Implemented as `web/proxy.ts` exporting `proxy()`, not `middleware.ts`/`middleware()`** — Next.js 16.2.10 deprecated the `middleware` file convention in favor of `proxy` (build emits an explicit deprecation warning); functionally identical, same matcher config.
  - [x] 2.6 `web/.env.local` (gitignored — `web/.gitignore`'s existing `.env*` rule already covers it, verified) populated from `supabase status` output: `NEXT_PUBLIC_SUPABASE_URL` (local API URL, `http://127.0.0.1:54321` per `supabase/config.toml`'s `[api] port = 54321`) and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (current Supabase-docs env var name; `supabase status` may still label the value "anon key" locally — same value, just verify which label your installed CLI version prints). **Do not try to add a tracked `web/.env.example`** — `web/.gitignore`'s `.env*` pattern would silently swallow it too (needs a `!web/.env.example` negation to work, which is out of scope for this story); document the two required var names in `web/README.md` instead (Task 6).

- [x] **Task 3 — Email-confirmation callback route (AC: 1)**
  - [x] 3.1 `web/app/auth/confirm/route.ts` — **Implemented against verified live behavior rather than the spec text below.** Manual end-to-end testing (Task 8.2a) showed Supabase's default local email template links to GoTrue's own hosted `/auth/v1/verify` endpoint, which — for a PKCE-flow `signUp()` (supabase-js's default) — redirects back to this route with a `?code=<uuid>` param, **not** `token_hash`/`type`. The route therefore calls `supabase.auth.exchangeCodeForSession(code)` as the primary path; `verifyOtp({ type, token_hash })` is kept as a fallback for a customized email template that links `token_hash`/`type` straight to the app. Redirects to `/` on success (placeholder — real Dashboard is Epic 3) or to `/login?error=confirmation-failed` on failure. Uses the server client from Task 2.3.
  - [x] 3.2 In the signup Server Action (Task 4), pass `options: { emailRedirectTo: <origin>/auth/confirm }` to `signUp()` so the confirmation email links back here.
  - [x] 3.3 Local dev note for manual verification: confirmation emails are captured by the local stack's mailer (Mailpit under the hood; `supabase/config.toml`'s `[inbucket] port = 54324` section still controls it — already configured, not touched by this story), viewable at `http://127.0.0.1:54324`, not actually delivered to a real inbox.

- [x] **Task 4 — Email+password signup/login form (AC: 1, 3)**
  - [x] 4.1 `web/app/login/page.tsx` — one route hosting both modes (Log in / Sign up) per EXPERIENCE.md's IA table, which lists "Login / Signup" as a single surface, not two. Client Component (needs form interactivity + passkey's browser-only `navigator.credentials` ceremony in Task 5). Plain inputs styled from `tokens.css` custom properties only — **the `no-hardcoded-colors.test.ts` guard from Story 2.2 already runs over all of `web/app/**/*.{ts,tsx,css}`, including new files this story adds; a stray hex literal will fail CI, not just look wrong.** Do not attempt the Ghost-style/Biometric-Anchor visual spec (DESIGN.md) — that's Story 2.4.
  - [x] 4.2 `web/app/login/actions.ts` — Server Actions `signUp(formData)` and `signIn(formData)`, calling the Task 2.3 server client's `auth.signUp({ email, password, options: { emailRedirectTo } })` / `auth.signInWithPassword({ email, password })`.
  - [x] 4.3 On `signUp()` success with `data.session === null` (expected once Task 1.1's confirmation gate is on — Supabase withholds a session until confirmed), render an inline "check your email to confirm your account" state, console-voice register (no exclamation points, matches DESIGN.md's Failure-Register-adjacent tone even though this isn't a failure).
  - [x] 4.4 Map Supabase auth errors to the **exact** Failure Register strings (EXPERIENCE.md, no paraphrasing):
    - Wrong password → `"Credentials not recognized — try again."`
    - Signup with an already-registered email → `"Account already archived — log in instead."`
    - Render inline under the relevant field, never a modal or a red/alarm-colored banner (AC-3, UX-DR18/19).
    - **Verified the exact current error signal for "email already registered" against the installed `@supabase/supabase-js` 2.110.8, and directly against the running local Auth API — this turned out to have *two* distinct signals, not one:** an existing but **unconfirmed** email returns HTTP 200 with a sanitized user (`identities: []`, no `error`, anti-enumeration); an existing and **confirmed** email returns an actual error (HTTP 422, `error_code: "user_already_exists"`, `msg: "User already registered"`). Both are handled (`isAlreadyRegisteredSignUp` / `isAlreadyRegisteredSignUpError` in `auth-copy.ts`) — manual testing (Task 8.2c) initially only hit the generic fallback copy because the first implementation only checked the first signal.

- [x] **Task 5 — Passkey add-on (AC: 2)**
  - [x] 5.1 After a successful `signUp` or `signIn` where the session's user has no registered passkey, render an "Enable Passkey" row (functional only — DESIGN.md's fingerprint-badge/radio-indicator visual spec is Story 2.4's job) that calls `supabase.auth.registerPasskey()` on the **browser** client (Task 2.2) on click. Skippable — never blocking, matching UX-DR20's confirm-or-edit/never-forced pattern used elsewhere in this UX system. "No registered passkey" is checked via `supabase.auth.passkey.list()`.
  - [x] 5.2 On `web/app/login/page.tsx`'s login side, add a "Sign in with Passkey" action calling `supabase.auth.signInWithPasskey()` directly on the browser client — no email field needed first (discoverable credential, per Supabase's docs). This is FR-29/DESIGN.md's "Biometric bypass" for a returning DJ.
  - [x] 5.3 `registerPasskey()` requires an existing session (Supabase's own documented constraint) — this structurally enforces AC-2's "add-on to that same account, not a separate identity," since there is no code path where a passkey can be registered without first being authenticated some other way.
  - [x] 5.4 Note for manual testing: WebAuthn ceremonies need either a real platform authenticator (Touch ID/Windows Hello) or a browser-provided virtual authenticator (e.g. Chrome DevTools → WebAuthn tab) — call this out in the Dev Agent Record rather than assuming a CI-automatable path exists yet. **Confirmed during Task 8.2d**: clicking "Sign in with Passkey" correctly invokes the real browser WebAuthn API (no JS error; a native OS-level credential-picker dialog opens, outside the page's DOM and outside this session's browser-automation tool surface — no CDP WebAuthn-domain control or platform authenticator was available to complete the ceremony end-to-end). See Dev Agent Record for the full note.

- [x] **Task 6 — Docs (AC: 1, 2)**
  - [x] 6.1 `web/README.md` — add the two required `.env.local` var names (Task 2.6) under a new "Environment" section; note that local Supabase must be running (`supabase start`, from repo root) for any auth flow to work.

- [x] **Task 7 — Tests (AC: 1, 2, 3)**
  - [x] 7.1 This is the first auth-flow story in the repo; full signup/login/passkey ceremonies are inherently network- and browser-API-dependent (WebAuthn's `navigator.credentials`), not unit-testable in the style of `shared/`'s pure-function tests. Scope automated coverage to what's realistically pure: a small function mapping a Supabase auth error to its Failure Register copy string (Task 4.4), tested directly against the known error shapes. Do not attempt to mock the full WebAuthn ceremony or Supabase Auth server for this story — that's a bigger testing-infrastructure decision (e.g., introducing Playwright) than this story's scope; flag it as a follow-up rather than deciding it unilaterally here.
  - [x] 7.2 Confirm the new files under `web/app/login/**` and `web/app/auth/confirm/**` pass the existing `no-hardcoded-colors.test.ts` guard (Story 2.2) without modification to the guard itself.

- [x] **Task 8 — Full gate**
  - [x] 8.1 `pnpm --filter web lint`, `pnpm --filter web typecheck`, `pnpm --filter web build`, `pnpm --filter web test`. All pass (12 tests, up from 3).
  - [x] 8.2 Manual verification against the local Supabase stack (`supabase start` from repo root), driven end-to-end through the real browser UI (Chrome, via claude-in-chrome browser automation) plus direct Supabase Auth API/Postgres checks: (a) signed up with a real address, confirmed via the Mailpit-captured email link, verified `auth.users.email_confirmed_at` flipped true and a `djs` row exists — full flow works end-to-end, not just the trigger; (b) wrong-password login shows "Credentials not recognized — try again." inline, no modal/alarm color; (c) signup with an already-registered (confirmed) email shows "Account already archived — log in instead." inline; (d) clicking "Sign in with Passkey" correctly invokes the real WebAuthn API and opens a native OS credential picker — completing the full register/sign-in ceremony end-to-end was not possible in this environment (no real platform authenticator, no CDP WebAuthn-domain control exposed to the browser-automation tool used), consistent with Task 5.4's own anticipation of this limit.
  - [x] 8.3 Repo-root gate: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` — all pass. No regression in `shared/`'s 13 tests or `agent/`; `web/` grew from 3 to 12 tests (9 new, all passing). Actually run on this machine per the standing Epic-2+ rule (sprint-status `action_items` ai-8).

### Review Findings

- [x] [Review][Patch] Unconfirmed-email login shows generic failure copy, not a "confirm your email" message — `mapSignInError` (`web/app/login/auth-copy.ts:18-23`) doesn't recognize Supabase's `email_not_confirmed` error code. Resolved by Arjun (2026-07-27): added a dedicated `emailNotConfirmed` copy string ("Check your email to confirm your account first.", matching the existing check-email state's tone) and mapped `error.code === "email_not_confirmed"` to it, plus a new test. [web/app/login/auth-copy.ts]
- [x] [Review][Patch] Confirmation-link failure produces a bare login form with no visible error — fixed: `page.tsx` now reads the `error` search param (via `useSearchParams`, wrapped in `<Suspense>`) and shows the calm generic Failure Register copy inline when `error=confirmation-failed`. [web/app/auth/confirm/route.ts:35, web/app/login/page.tsx]
- [x] [Review][Patch] Passkey sign-in failure misapplied the wrong-password Failure Register string — fixed: now uses `AUTH_FAILURE_COPY.generic`. [web/app/login/page.tsx:61-63]
- [x] [Review][Patch] Confirm route's exchangeCodeForSession/verifyOtp calls were unguarded — fixed: wrapped in try/catch (redirect() calls kept outside the try block, since redirect() itself throws). [web/app/auth/confirm/route.ts:15-36]
- [x] [Review][Patch] Middleware's getClaims() call and non-null-asserted env vars were unguarded — fixed: middleware now returns the unrefreshed response gracefully on missing env vars and wraps getClaims() in try/catch; client.ts/server.ts now throw a clear, actionable error instead of a bare non-null assertion. [web/lib/supabase/middleware.ts, client.ts, server.ts]
- [x] [Review][Patch] EnablePasskeyPrompt's passkey.list() call had no .catch() — fixed: added .catch()/.finally() so "checking" always resolves regardless of outcome. [web/app/login/page.tsx:159-170]
- [x] [Review][Patch] registerPasskey()/signInWithPasskey() calls weren't wrapped in try/catch — fixed: both now use try/catch/finally so the pending-state flag always resets. [web/app/login/page.tsx:55-66,172-185]

All patches verified: full gate green (`web` lint/typecheck/build/test — 13 tests, up from 12; repo-root `pnpm lint`/`typecheck`/`build`/`test` via turbo — `shared`'s 13 tests and `agent`'s checks unaffected).
- [x] [Review][Defer] Visiting /login while already signed in re-shows the form instead of redirecting away — no session check on mount [web/app/login/page.tsx:44] — deferred, real redirect-target routing pattern belongs with Epic 3's real Dashboard, not this story's placeholder `/`.
- [x] [Review][Defer] Toggling Login/Signup mode doesn't reset the other mode's stale useActionState error [web/app/login/page.tsx:141-147] — deferred, cosmetic, no data-integrity or security impact.
- [x] [Review][Defer] inputStyle hardcodes fontSize: "16px" instead of a tokens.css reference [web/app/login/page.tsx:28] — deferred, Story 2.4 owns this story's explicit visual-polish boundary.
- [x] [Review][Defer] experimental.passkey opt-in duplicated verbatim across three client constructors instead of centralized [web/lib/supabase/client.ts, server.ts, middleware.ts] — deferred, maintainability nit, no functional impact today.
- [x] [Review][Defer] No application-level rate limiting on signIn/signUp Server Actions, relies entirely on Supabase's own untouched [auth.rate_limit] config [web/app/login/actions.ts] — deferred, a larger decision than this story owns.
- [x] [Review][Defer] Task 5.1's "prompt after successful signUp" trigger never fires as written — Task 1.1's confirmation gate means signUp() always returns a null session, so the passkey prompt only appears after a later signIn, not immediately post-signup [web/app/login/actions.ts:49-53, web/app/login/page.tsx:68-69] — deferred, AC-2 still holds (prompt remains session-gated), internal Task-level contradiction only.

## Dev Notes

### Architecture compliance

- **AD-10** (this story's primary governing decision): Supabase Auth, JWT + refresh; email+password and passkey both link to one `dj` account by verified email; `djs` row 1:1 with `auth.users`, creation idempotent (Story 2.1's trigger, unchanged by this story). This story does not touch cross-provider linking (Story 2.3b) or the "distinct verified emails not auto-merged" edge case — single-provider path only.
- **AD-7/AR-4** (RLS): no new RLS policy needed — Story 2.1's `djs_select_own` policy already lets an authenticated DJ read their own row; this story adds no new DJ-writable column (see Scope boundaries).
- **AD-8**: Server Actions calling `supabase-js`/`@supabase/ssr` directly is the sanctioned pattern here — not a bespoke mutation API. Auth itself is a Supabase-managed surface, not something AD-8 governs as a "write path" in the RLS sense, but the *pattern* (thin server glue, no custom backend) is consistent with it.
- **UX-DR3** (auth components) and **UX-DR21** (accessibility/keyboard/focus-ring) are **Story 2.4's** acceptance criteria, not this story's — this story's forms must be operable and not break keyboard flow, but the polished visual spec (Ghost inputs, Biometric Anchor chrome, focus-ring contrast verification) is explicitly out of scope here per Story 2.4's own ACs.
- **UX-DR18/19** (Failure Register, calm auth-failed state) **is** this story's AC-3 — the exact copy strings are quoted in Task 4.4, sourced from EXPERIENCE.md's Failure Register table, not paraphrased.

### Previous story intelligence

- **Story 2.2** (done) is the styling hub: this story is its most immediate consumer, exactly as 2.2's Dev Notes predicted. Consume `tokens.css` custom properties only — the `no-hardcoded-colors.test.ts` guard (hardened twice already, in 2.2's own review and per its own doc comment) will fail CI on any hex/`rgb()`/`hsl()` literal in new `web/app/**` files, comment-aware and path-aware. `web/` currently has **zero** existing form/input/button patterns to reuse — this story establishes the first ones (functionally only; Story 2.4 owns the visual spec).
- **Story 2.1** (done) built the `djs` table, its `handle_new_dj()` trigger, and read-only RLS — all reused as-is by this story, zero migration needed here. Story 2.1's own scope notes explicitly reserved the first DJ-writable `djs` column for Story 2.3c — honor that boundary (see Scope boundaries above); do not add a `phone` or `name` column in this story even though the gap analysis above flags a real product question about where phone-for-email-path gets collected.
- **`supabase/PROVISIONING.md`** (Story 2.1) states "no `supabase-js` client exists in `agent/` or `web/` — the first consumer... arrives around Story 2.10 or 3.2." This story makes that line stale (it's now the first consumer, earlier than anticipated) — not a blocker, since this story only needs the **local** stack, but worth a mental note if that file is read again later; not in this story's scope to edit that file's now-outdated sentence (it's describing what was true as of Story 2.1, a historical record, matching this project's established append-only-log convention for dated Dev Notes/Change Log content — see Story 2.2's review finding on the same question).

### Latest technical specifics (web research, 2026-07-26)

- **Supabase Passkeys is in Beta**, announced 2026-05-28. Requires `@supabase/supabase-js >= 2.105.0`. The client must opt in via `auth: { experimental: { passkey: true } }` at construction — the feature does not exist on the client otherwise. API: `auth.registerPasskey()` (signed-in user only, returns `{ id, friendly_name?, created_at }`) and `auth.signInWithPasskey()` (discoverable credential, returns `{ session, user }`). Supabase's own docs warn: "the API may change without notice" — do not treat method signatures as frozen; re-check `https://supabase.com/docs/guides/auth/passkeys` if anything here doesn't match at implementation time.
- **WebAuthn RP ID constraint**: passkeys are cryptographically bound to the RP ID they were registered against — changing it later invalidates every existing passkey. `localhost` is the one special-cased non-domain value browsers accept; IP literals like `127.0.0.1` are not reliably valid. This is why Task 1.3 pins `rp_id`/`rp_origins` to `localhost`, and Task 1.4 moves `site_url`/`additional_redirect_urls` off their pre-existing `127.0.0.1`-based values to match — leaving them split across two hosts would break either the confirm-link redirect or the passkey ceremony, whichever host you happened to test against.
- **`@supabase/ssr`** (not the older `@supabase/auth-helpers-nextjs`) is the current-recommended package for Next.js App Router SSR auth, with `createBrowserClient`/`createServerClient` and a cookie-refresh middleware. Supabase's own recommended session-refresh call inside that middleware has moved toward `auth.getClaims()` (verifies the JWT signature locally against published keys, no network round-trip) rather than `auth.getUser()`/`auth.getSession()` for that specific refresh step — verify current guidance directly (`https://supabase.com/docs/guides/auth/server-side/nextjs`) before implementing Task 2.4, since this is exactly the kind of detail that shifts between doc revisions.
- **Email+password**: `auth.signUp({ email, password, options: { emailRedirectTo } })` / `auth.signInWithPassword({ email, password })`. PKCE-flow confirmation (the SSR-appropriate flow, vs. the client-only implicit flow) needs a server route exchanging `token_hash`/`type` via `auth.verifyOtp()` — see Task 3.1's exact pattern, sourced from `https://supabase.com/docs/guides/auth/passwords`.

### Project Structure Notes

**New files:**
- `web/lib/supabase/client.ts`, `web/lib/supabase/server.ts`, `web/lib/supabase/middleware.ts` — Supabase client setup (first in the monorepo).
- `web/proxy.ts` — session-refresh proxy (Next.js 16's renamed `middleware.ts` convention — see Task 2.5).
- `web/app/auth/confirm/route.ts` — email-confirmation callback (PKCE `code` exchange, with `token_hash`/`verifyOtp` fallback — see Task 3.1).
- `web/app/login/page.tsx`, `web/app/login/actions.ts` — the combined Login/Signup surface + its Server Actions.
- `web/app/login/auth-state.ts` — shared `AuthActionState` type/initial value, split out of `actions.ts` because a `"use server"` file may only export async functions.
- `web/app/login/auth-copy.ts` (+ `auth-copy.test.ts`) — Failure Register copy + the pure error/response-shape mapping functions (Task 7.1).
- `web/.env.local` (gitignored, not committed).

**Updated files:**
- `supabase/config.toml` — `[auth.email] enable_confirmations`, `[auth.passkey]`, `[auth.webauthn]` (Task 1). Read the surrounding comments before editing; this file is otherwise untouched scaffold from Story 1.1.
- `web/package.json` — two new dependencies (`@supabase/supabase-js`, `@supabase/ssr`).
- `web/README.md` — new Environment section (Task 6).
- `pnpm-lock.yaml` — new dependency resolutions.

**No consumer conflicts:** nothing in Epic 1 (`agent/`, `shared/`) or Story 2.2's files (`tokens.css`, `fonts.ts`, `globals.css`, etc.) needs to change for this story. `web/app/page.tsx` (the existing `@curfew/shared` contract-consumption proof) is untouched — this story adds new routes alongside it, not a replacement.

**Out of scope (do not build here):** Google/Apple OAuth (2.3b), post-OAuth phone prompt (2.3c), Ghost-style/Biometric-Anchor visual polish and official OAuth button lockups (2.4), any real Dashboard (Epic 3 — `/` stays the Story 2.2 scaffold page as the post-auth redirect target), landing-page overlay integration (Epic 6 — this story's `/login` route is a standalone page for now, to be consumed as Landing's overlay later).

### Testing standards summary

No auth-flow test pattern exists yet in this repo — this is the first story to touch it. Match `shared/`'s and `web/`'s existing convention of co-located `*.test.ts` files and pure-function unit tests where the logic is actually pure (Task 4.4's error→copy mapper); do not attempt to unit-test the WebAuthn ceremony or Supabase's server behavior itself, and do not introduce a new test framework (e.g., Playwright) unilaterally — that's a bigger decision than this story owns. Manual verification against the local Supabase stack is required and must be actually run on this machine (standing Epic-2+ rule, sprint-status `action_items` ai-8), documented in the Dev Agent Record.

### References

- [Source: _bmad-output/planning-artifacts/epics.md, lines 371-397 (Story 2.1/2.2 context), 399-409 (Story 2.3a verbatim), 411-433 (Stories 2.3b/2.3c — scope boundary), 84 (AR-10), 103 (UX-DR3), 124 (UX-DR18), 125 (UX-DR19)]
- [Source: _bmad-output/planning-artifacts/prds/prd-name-pending-2026-07-19/prd.md#4.10 Account & Authentication (FR-29), lines 367-380]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md#AD-10 (line 112), #AD-8 (line 100), source tree (line 278-285), capability map (line 294)]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/SOLUTION-DESIGN.md, lines 265 (auth tokens), 294 (stack table auth row)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-name-pending-2026-07-19/DESIGN.md#Ghost Input Fields, #Biometric Anchor, #Google/Apple Sign-In Button (lines 255-264)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-name-pending-2026-07-19/EXPERIENCE.md#Failure Register (lines 46-55), #Component Patterns auth-form row (line 63), #State Patterns auth-failed/phone-required rows (lines 92-93)]
- [Source: _bmad-output/implementation-artifacts/2-1-supabase-cloud-foundation-isolation-baseline.md — `djs` schema/trigger/RLS, scope-boundary note reserving DJ-writable columns for 2.3c]
- [Source: _bmad-output/implementation-artifacts/2-2-obsidian-design-token-system-web-shell.md — token system, `no-hardcoded-colors.test.ts` guard, hub-artifact/consumer note]
- [Source: supabase/config.toml — read directly, current `[auth]`/`[auth.email]`/`[auth.passkey]`/`[auth.webauthn]`/`[api]`/`[inbucket]` state as of baseline]
- [Source: supabase/PROVISIONING.md — "first web consumer" claim, now superseded by this story]
- [Source: web/app/page.tsx, web/app/layout.tsx, web/package.json, web/README.md, web/.gitignore, web/next.config.ts — read directly, current state as of baseline]
- [Source: web — Supabase Passkeys Beta changelog & docs (https://supabase.com/changelog/46458-passkeys-for-supabase-auth-beta, https://supabase.com/docs/guides/auth/passkeys) — fetched 2026-07-26]
- [Source: web — Supabase Auth Next.js SSR guide (https://supabase.com/docs/guides/auth/server-side/nextjs) and email/password guide (https://supabase.com/docs/guides/auth/passwords) — fetched 2026-07-26]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- **Next.js 16 `middleware` → `proxy` rename**: `pnpm --filter web build` emitted an explicit deprecation warning for the `middleware.ts` file convention. Renamed `web/middleware.ts` → `web/proxy.ts`, exported function `middleware` → `proxy` (matcher config unchanged), per Next's own migration doc (`https://nextjs.org/docs/messages/middleware-to-proxy`). Warning gone on rebuild.
- **`"use server"` export restriction**: initial `web/app/login/actions.ts` also exported `AuthActionState` (type) and `INITIAL_AUTH_STATE` (a plain object) alongside the two Server Actions. Next.js rejected this at runtime: `Error: A "use server" file can only export async functions, found object.` Fixed by moving the type + initial-state constant to a new `web/app/login/auth-state.ts`; `actions.ts` now only exports `signUp`/`signIn`.
- **Confirm-route param shape**: Task 3.1's spec (`token_hash`/`type` → `verifyOtp`) doesn't match this project's actual local Auth config. Live end-to-end testing (real signup → Mailpit-captured email → browser navigation of the real link) showed Supabase's default email template routes through GoTrue's own hosted `/auth/v1/verify` endpoint, which — for supabase-js's default PKCE flow — redirects back to `/auth/confirm` with `?code=<uuid>`, not `token_hash`/`type`. Fixed `route.ts` to call `exchangeCodeForSession(code)` as the primary path, keeping `verifyOtp` as a fallback. Verified by completing the full ceremony in-browser: landed on `/`, and `auth.users.email_confirmed_at` flipped to true in Postgres.
- **"Already registered" has two distinct signals, not one**: initial `isAlreadyRegisteredSignUp` only checked the HTTP-200-with-empty-`identities` anti-enumeration response. Manual testing signing up again with an already-**confirmed** email surfaced the generic fallback copy instead of the expected Failure Register string. Direct calls against the local Auth REST API confirmed GoTrue actually returns an HTTP 422 `user_already_exists` **error** for an existing-and-confirmed email (the empty-`identities` 200 response is specific to an existing-but-unconfirmed email). Added `isAlreadyRegisteredSignUpError` to catch the error-shaped case; both paths are now covered and tested.
- **Redirect-URL allow-list is same-origin-permissive, not strictly path-exact**: `supabase/auth`'s `IsRedirectURLValid` (read directly from `internal/utilities/request.go`) allows any path once scheme+hostname(+port, skipped for localhost) match `site_url` — so `additional_redirect_urls = ["http://localhost:3000"]` also covers `http://localhost:3000/auth/confirm` despite the config.toml comment calling these "*exact* URLs." Confirms Task 1.4's fix is sufficient without needing a wildcard pattern.

### Completion Notes List

- Implemented all 8 tasks: local Supabase auth config (email confirmation, passkey/WebAuthn), the first `supabase-js`/`@supabase/ssr` client wiring in the monorepo (browser/server/proxy clients), the email-confirmation callback route, the combined Login/Signup form with Server Actions, passkey add-on + passkey sign-in, README docs, and the pure-function error-copy tests.
- Three implementation details diverged from the story's literal spec text after live verification against the running local stack (see Debug Log References above for each): `middleware.ts` → `proxy.ts` (Next.js 16 convention), the confirm route's `code`/`exchangeCodeForSession` path (GoTrue's actual redirect shape) with `token_hash`/`verifyOtp` kept as a fallback, and a second "already registered" detection path (`user_already_exists` error) alongside the originally-planned empty-`identities` signal.
- Manual verification (Task 8.2) was driven end-to-end through a real Chrome browser (via claude-in-chrome browser automation) against the actual local Supabase stack, not simulated: real signup → real Mailpit-captured confirmation email → real link click → Postgres check confirming `email_confirmed_at` and the `djs` row; real wrong-password and duplicate-email attempts confirming the exact inline Failure Register copy renders with no modal/alarm color.
- Passkey ceremony (Task 5.4/8.2d): confirmed clicking "Sign in with Passkey" correctly invokes the real browser WebAuthn API (`navigator.credentials` under the hood) with no JS error — it opens a native OS-level credential picker dialog outside the page DOM. Completing the full register/sign-in ceremony end-to-end was not possible in this environment: no real platform authenticator (Touch ID/Windows Hello) and no Chrome DevTools Protocol WebAuthn-domain control was exposed through the available browser-automation tooling. This matches Task 5.4's own explicit anticipation that this might not be CI/agent-automatable; flagging for Arjun to complete this specific check manually (register a passkey, sign out, sign back in via passkey only, at `http://localhost:3000`) before treating AC-2 as fully human-verified.
- Full gate green: `web` lint/typecheck/build/test and repo-root `pnpm lint`/`typecheck`/`build`/`test` all pass. `web`'s test count grew from 3 to 12 (9 new tests in `auth-copy.test.ts`), `shared`'s 13 and `agent`'s checks unchanged.

### File List

**New:**
- `web/lib/supabase/client.ts`
- `web/lib/supabase/server.ts`
- `web/lib/supabase/middleware.ts`
- `web/proxy.ts`
- `web/app/auth/confirm/route.ts`
- `web/app/login/page.tsx`
- `web/app/login/actions.ts`
- `web/app/login/auth-state.ts`
- `web/app/login/auth-copy.ts`
- `web/app/login/auth-copy.test.ts`
- `web/.env.local` (gitignored, not committed)

**Modified:**
- `supabase/config.toml`
- `web/package.json`
- `pnpm-lock.yaml`
- `web/README.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

## Change Log

- 2026-07-26: Implemented Story 2.3a end-to-end (email+password signup/login, email confirmation, passkey add-on and passkey sign-in). Diverged from the story's literal spec in three implementation details after live verification against the running local Supabase stack — Next.js 16's `proxy.ts` convention instead of `middleware.ts`, the confirm route's actual `code`/`exchangeCodeForSession` shape (GoTrue's default local email template routes through its own hosted verify endpoint) instead of a bare `token_hash`/`verifyOtp` handler, and a second "already registered" detection path for confirmed existing emails (HTTP 422 `user_already_exists`) alongside the originally-planned empty-`identities` signal for unconfirmed ones. All three are documented in Dev Agent Record → Debug Log References. Full local + repo-root gate green (9 new tests). Passkey ceremony completion (register + sign back in via passkey only) could not be fully automated in this environment and is flagged for Arjun to manually verify.
