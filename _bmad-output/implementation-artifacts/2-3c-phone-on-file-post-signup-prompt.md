---
baseline_commit: 930732336e8f549580d3020200e0bf6d9c132621
---

# Story 2.3c: Phone-on-file (post-signup prompt)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a DJ,
I want a phone number captured after signup, regardless of which path I used,
so that every account has a phone on file as required.

## Acceptance Criteria

1. **Given** any signup path — email+password (after confirmation) or Google/Apple OAuth — **When** it completes without a phone on file, **Then** I am prompted once for a phone number (single-field, required). *(FR-29, AR-10, UX-DR19 phone-required)*
2. **Given** the phone-required state, **Then** it renders as the specified one-field post-signup screen, not a blocking modal wall. *(UX-DR19)*

[Source: _bmad-output/planning-artifacts/epics.md, lines 423-432 — revised 2026-07-27, see Scope resolution below]

### Scope boundaries (binding — read before writing code)

- **In scope:** the `djs.phone` column (the first DJ-writable column on this table, additive-only migration + column-scoped RLS write policy), the one-field `/phone-required` screen, and gating **both** `web/app/auth/callback/route.ts` (OAuth) **and** `web/app/auth/confirm/route.ts` (email+password, post-confirmation) on whether `phone` is on file. **Out of scope:** any phone **verification** (SMS OTP, `auth.sms`/`auth.mfa.phone` stay disabled), official Ghost-input visual polish (Story 2.4, same boundary 2.3a/2.3b already drew — this ships functional/unpolished like every other auth surface so far), any "manage/edit phone later" UI (Profile/Settings, UX-DR17 — not this story), and re-gating an already-signed-in returning DJ on every subsequent login (see Scope resolution below for why this is an accepted limitation, not an oversight).
- **✅ Scope resolved 2026-07-27 (Arjun, direct ruling): every account needs a phone number, regardless of signup path — close the gap, don't carry it further.** This story was originally scoped OAuth-only in epics.md, and the gap — an email+password-only DJ never being prompted anywhere — had been flagged three times without resolution (Story 2.1's migration comment, Story 2.3a's Dev Notes, this story's own first draft). Arjun's ruling closes it. **`epics.md` and `EXPERIENCE.md` have already been updated to match** (AC-1 above, and the State Patterns "Phone number required" row) — this story file was revised in the same pass, so there is no separate correct-course document; this note *is* the record.
  - **How the email path is closed without reopening Story 2.3a (done, shipped):** rather than adding a phone field to the signup form itself (`web/app/login/page.tsx`'s `signUp` action — do **not** touch this), the *same* `/phone-required` follow-up screen this story already builds for OAuth is reused for the email path too, gated at `confirm/route.ts` — the exact point Story 2.3a's own Task 1.1 made "the account becomes usable" (no session exists before email confirmation). This mirrors the OAuth design exactly: one gate, at the one route where a not-yet-phone-having account first becomes usable, per path.
  - **Accepted residual limitation, not a new gap:** a *returning* DJ who logs in via the plain email+password form (`signIn`, not the one-time confirmation link) is not re-checked — same class of limitation already accepted for OAuth (a returning OAuth sign-in *does* re-check, since it always re-hits `callback/route.ts`, but a DJ who abandons `/phone-required` and returns without going back through either route is likewise never re-caught). Given this is pre-launch with no real production accounts yet, gating the two "account becomes usable" transition points is sufficient; do not add a third enforcement layer (e.g. a client-side check on every `signIn` success) speculatively.
- **First DJ-writable column on `djs` — read `AD-19` before writing the migration.** Story 2.1 deliberately shipped `djs` read-only (RLS `SELECT` only, all writes via the `SECURITY DEFINER` trigger) specifically so this story would be the one to add the first write policy. `AD-19` (billing columns, Epic 7, not yet built) already anticipates this exact moment: *"if `djs` later gains any DJ-writable update policy (e.g. display name), that policy's column grant list must explicitly exclude the four billing columns."* Epic 7's billing columns don't exist yet, so there's nothing to explicitly exclude today — but the way you satisfy that guidance **now**, permanently, is by scoping the `GRANT UPDATE` to the `phone` column only (`grant update (phone) on public.djs to authenticated`), never a blanket `grant update on public.djs`. Get this wrong (a table-wide grant) and Epic 7 inherits a live vulnerability the day it ships, silently.
- **Rejected alternative — do not use `auth.users.phone` / `supabase.auth.updateUser({ phone })`.** Supabase Auth's `auth.users` table already has a native `phone` column, normally set via `updateUser({ phone })`. Verified against Supabase's own docs (2026-07-27): that call is coupled to Supabase's native phone-OTP change flow — it requires a follow-up `verifyOtp({ type: "phone_change" })`, which requires a configured SMS provider. This project's `[auth.sms]` is fully disabled (`supabase/config.toml`, Twilio commented out) and AC-1 only asks for the number to be **captured**, never verified. Use `djs.phone` — a plain profile column — exactly as Story 2.1's migration comment anticipated.

## Tasks / Subtasks

- [x] **Task 1 — Additive migration: the first DJ-writable `djs` column (AC: 1)**
  - [x] 1.1 Generate via `supabase migration new add_djs_phone_column` (auto-timestamped, matches the project's existing two migrations' naming convention — do not hand-pick a timestamp).
  - [x] 1.2 `alter table public.djs add column phone text;` — nullable (existing rows, including every email-path account created by 2.3a/2.3b testing, must not break), additive-only per AR-12/AD-15. Do not touch `id`/`created_at`, do not add a `NOT NULL` constraint (that would require a default for existing rows and contradicts "prompted after signup," not "required at the DB level for every row").
  - [x] 1.3 `grant update (phone) on public.djs to authenticated;` — **column-scoped, not a blanket `update` grant** (see AD-19 note in Scope boundaries above — this is the one line in this story most likely to be gotten wrong).
  - [x] 1.4 New policy: `create policy "djs_update_own_phone" on public.djs for update using (auth.uid() is not null and auth.uid() = id) with check (auth.uid() is not null and auth.uid() = id);` — same null-safe `auth.uid() is not null and auth.uid() = id` form as the existing `djs_select_own` policy (house style, not optional — see Story 2.1's migration comment on why null-safety matters here).
  - [x] 1.5 Do not add `INSERT`/`DELETE` grants or policies on `djs` — out of scope, `handle_new_dj()`'s `SECURITY DEFINER` trigger remains the only row creator.

- [x] **Task 2 — pgTAP coverage for the new write path (AC: 1)**
  - [x] 2.1 In `supabase/tests/djs_isolation_test.sql`, bump `select plan(13)` to the new total. Keep the existing Case 3c assertion (`update public.djs set created_at = now() ... throws_ok 42501`) — it must still pass unmodified, since the new grant is scoped to `phone` only, not `created_at`.
  - [x] 2.2 Add: authenticated DJ A can update their own `phone` — perform the update, then `select`/`is()` to confirm the stored value actually changed (don't just assert the `UPDATE` didn't throw).
  - [x] 2.3 Add: authenticated DJ A **cannot** change DJ B's `phone`. This is an RLS `USING`-clause row-scoping failure, **not** a grant-level failure — in Postgres, an `UPDATE` whose `USING` clause matches zero rows silently affects 0 rows, it does **not** raise `42501` the way a missing table/column grant does. Assert via row-count/`results_eq` (e.g. confirm DJ B's `phone` is unchanged after DJ A's attempted update), not `throws_ok`.
  - [x] 2.4 Add: `anon` cannot update `phone` at all — `throws_ok`, `42501` (no grant exists for `anon`, mirrors the existing Case 4b pattern for `created_at`).
  - [x] 2.5 Run for real: `supabase db reset && supabase test db supabase/tests` (per `supabase/README.md`) — must actually execute on this machine, not be assumed green.

- [x] **Task 3 — `/phone-required` screen (AC: 1, 2)**
  - [x] 3.1 New file `web/app/phone-required/page.tsx` — client component, its own page (not a modal/dialog — satisfies AC-2 by construction, nothing to build there). Heading copy verbatim from EXPERIENCE.md's State Patterns row: **"Add a phone number."** Reuse the existing `fieldStyle`/`inputStyle`/`buttonStyle` object-literal constants pattern from `web/app/login/page.tsx` (copy them locally or factor out — your call, but match their values) — functional/unpolished like every prior auth screen; Story 2.4 owns the Ghost-input visual spec.
  - [x] 3.2 On mount (or server-side in the page itself, your call), require an authenticated session — if none, redirect to `/login`. This page has nothing to do for a signed-out visitor.
  - [x] 3.3 Single field: `<input type="tel" name="phone" required>`. No format library, no masking, no E.164 enforcement — AC-1 says "captured (single-field, required)," not "verified" or "formatted." Do not add `libphonenumber`/`libphonenumber-js` or any new dependency.
  - [x] 3.4 No skip/cancel control anywhere on this page — EXPERIENCE.md's State Patterns row is explicit: "Not skippable."

- [x] **Task 4 — Server Action to persist the phone number (AC: 1)**
  - [x] 4.1 New file `web/app/phone-required/actions.ts` (`"use server"`) — `setPhone(prevState, formData)`. Define its own small state type locally (don't force-fit `web/app/login/auth-state.ts`'s `AuthActionState` — its `fieldErrors: { email?, password?, form? }` shape doesn't have a `phone` key and is conceptually the login/signup form's type, not this one's).
  - [x] 4.2 Read `phone` from `formData`, trim it, reject empty with a field error (don't rely on the HTML `required` attribute alone — Server Actions can be invoked with JS disabled/bypassed).
  - [x] 4.3 Get the **server** Supabase client (`web/lib/supabase/server.ts`), call `auth.getUser()` — if no user, return a form error (do not silently `redirect()` from inside the action; let the page-level guard in Task 3.2 own navigation).
  - [x] 4.4 `await supabase.from("djs").update({ phone }).eq("id", user.id)` — this is what Task 1's column-scoped grant + RLS policy exist to allow. On a Supabase/PostgREST error, return `AUTH_FAILURE_COPY.generic` ("Something went sideways — try again.") imported from `web/app/login/auth-copy.ts` — reuse verbatim, don't invent a new copy string (same reuse-generic-for-unregistered-failures precedent 2.3b already established for OAuth errors).
  - [x] 4.5 On success, `redirect("/")` — same placeholder-scaffold-root convention every prior auth story used (Epic 3 owns the real Dashboard).

- [x] **Task 5 — Gate both "account becomes usable" routes on phone-on-file (AC: 1)**
  - [x] 5.1 New small helper — e.g. `web/lib/supabase/phone-gate.ts` exporting `async function needsPhone(supabase, userId: string): Promise<boolean>` — wraps `.from("djs").select("phone").eq("id", userId).single()` and returns `true` when `phone` is null/empty. Catch errors internally and return `false` (fail toward the least-blocking path — see 5.4). Both routes below import this one helper; do not duplicate the query.
  - [x] 5.2 In `web/app/auth/callback/route.ts`, after a successful `exchangeCodeForSession` and **before** the existing `redirect("/")`, call `needsPhone(supabase, data.user.id)` (`data.user` comes directly from `exchangeCodeForSession`'s own return value — no extra `getUser()` round trip needed). If `true`, `redirect("/phone-required")` instead of `/`.
  - [x] 5.3 In `web/app/auth/confirm/route.ts`, apply the identical pattern: after `confirmed` is established (either the `code` or `token_hash` branch succeeded) and **before** the existing `redirect("/")`, get the user via `supabase.auth.getUser()` (this route doesn't already have a `user` object in scope like the callback route does) and call `needsPhone(supabase, user.id)`. If `true`, `redirect("/phone-required")` instead of `/`. This is the email+password path's equivalent of Task 5.2 — the point Story 2.3a's Task 1.1 made "no usable session until confirmed," i.e. the first moment an email-path account is usable.
  - [x] 5.4 Wrap each lookup in the same try/catch discipline already used by both routes (network hiccup → fail toward `redirect("/")`, the least-blocking path, not a raw 500 — same "calm degrade" convention). A DJ who lands on `/` once due to a transient lookup failure gets re-gated next time they hit either route with `phone` still null (OAuth re-checks on every sign-in; email re-checks only don't apply since confirmation is one-time — see Scope resolution's accepted residual limitation above).
  - [x] 5.5 Do **not** add a global/middleware-level gate (`proxy.ts`/`middleware.ts`) — two explicit route-level checks, sharing one helper, is the whole mechanism.

- [x] **Task 6 — Tests (AC: 1, 2)**
  - [x] 6.1 If `setPhone`'s validation stays a bare trim/non-empty check (Task 4.2), there is no new pure logic worth isolating in a `*.test.ts` file — do not force one into existence (same testing philosophy 2.3a/2.3b already established: "do not force a test into existence where there's nothing pure to test"). If you do factor out a pure helper (e.g. a phone-normalizer), unit-test it alongside `web/app/login/auth-copy.test.ts`'s existing convention.
  - [x] 6.2 Confirm `web/app/phone-required/**` passes the existing `no-hardcoded-colors.test.ts` guard unmodified — tokens only, same as every other new page in this repo.

- [x] **Task 7 — Full gate**
  - [x] 7.1 `pnpm --filter web lint`, `pnpm --filter web typecheck`, `pnpm --filter web build`, `pnpm --filter web test` — all green.
  - [x] 7.2 `supabase db reset && supabase test db supabase/tests` — all pgTAP cases green, including Task 2's three new cases.
  - [x] 7.3 Manual verification, both paths:
    - **OAuth:** Google credentials are already live in this environment (Story 2.3b's `supabase/.env`, real Client ID/Secret) — sign in via Google with an account whose `djs.phone` is null, confirm the redirect lands on `/phone-required`, not `/`. Submit a phone number, confirm redirect to `/` and the DB row updated. Sign in again via Google with the same account, confirm it now lands directly on `/` (not re-prompted — phone already on file). Apple stays untestable pending Story 2.3b's Task 1.2 (real Apple credentials still not acquired as of this story's creation) — say so explicitly in the Dev Agent Record if still blocked; do not claim it verified.
    - **Email+password:** sign up fresh via the local Supabase stack (Story 2.3a's flow), confirm via the Mailpit-captured link, confirm the confirmation redirect lands on `/phone-required` (not `/`). Submit a phone number, confirm redirect to `/` and the DB row updated.
  - [x] 7.4 Repo-root gate: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` via turbo — must be actually run on this machine (standing Epic-2+ rule, sprint-status `action_items` ai-8). Confirm no regression in `shared/`'s test count (currently 13).

## Dev Notes

### Architecture compliance

- **AD-10/AR-10** (governing decision): "...a phone number is required on file (prompted after Google/Apple signup)..." — as revised 2026-07-27 (see Scope resolution above), this story now makes AR-10/FR-29's full "regardless of signup path" invariant true for the first time, across all three signup surfaces (email+password, Google, Apple).
- **AD-19** (forward guidance, quoted in full in Scope boundaries): the single most important piece of architecture context for this story. Column-scope the `GRANT UPDATE` to `phone` only — this is what keeps AD-19 satisfied automatically once Epic 7's billing columns land, rather than requiring a follow-up migration to retroactively narrow an over-broad grant.
- **AR-4/AD-7** (null-safe RLS): the new policy's `using`/`with check` must match `djs_select_own`'s existing `auth.uid() is not null and auth.uid() = id` form exactly — this project's established house style for every RLS policy on this table.
- **AD-8**: the one write path this story adds is Supabase/PostgREST + RLS (`.from("djs").update(...)` inside a Server Action) — not a bespoke mutation API, consistent with every other Epic 2 write path.

### Previous story intelligence

- **Story 2.1** (done) shipped `djs` deliberately read-only via RLS, explicitly reserving "the first DJ-writable column" for this story (see its migration's Task 3 comment) — Task 1 above is that reservation being cashed in. No other column on `djs` should become writable in this story.
- **Story 2.3b** (in-progress — Google leg done and live-tested, Apple leg blocked on real Apple Developer credentials, Task 1.2) left a direct, explicit handoff on its own Task 3.3: *"Story 2.3c is responsible for inserting the phone-required gate before this redirect becomes final — not this story's job."* Task 5.2 above is exactly that. 2.3b's in-progress status is **not** a blocker for this story — the Google-path code this story integrates with (`web/app/auth/callback/route.ts`) already exists, is committed, and Arjun has already completed one real end-to-end Google sign-in against it (2.3b's Debug Log) — that same test account (`djs.phone` currently null) is a ready-made fixture for this story's Task 7.3 manual verification.
- **Story 2.3a** (done — email+password/passkey) is the other route this story touches (`confirm/route.ts`, Task 5.3), but its `signUp`/`signIn` Server Actions and `page.tsx` form are **not** touched — the phone-collection UI is entirely the new `/phone-required` screen (Task 3), reused across both paths, not a field added to 2.3a's existing form.
- Reuse everything 2.3a/2.3b already established and proven: `AUTH_FAILURE_COPY.generic` for any failure the Failure Register doesn't specifically name; the "wrap the Supabase call in try/catch, keep `redirect()` outside the try block" discipline (redirect works by throwing — catching it swallows the redirect, a mistake already made and fixed twice in this codebase); the server/browser Supabase client split; the "functional now, Story 2.4 polishes visual chrome" scope boundary.
- `web/app/auth/callback/route.ts` currently redirects unconditionally to `/` on a successful exchange (see Task 3.3 of 2.3b) — the one behavioral change this story makes to that file is inserting the phone check before that redirect decision.
- **This story is the first time `web/` queries the `djs` table at all.** Every prior story (2.1, 2.3a, 2.3b) only ever wrote to `djs` via the `handle_new_dj()` trigger — no `.from("djs")` call exists anywhere in `web/` yet. Relatedly, neither `client.ts` nor `server.ts` passes a `Database` generic to `createBrowserClient`/`createServerClient` (no generated types file exists in this repo yet) — `.from("djs")` will come back loosely typed, same as everything else here today. Do not introduce `supabase gen types`/a generated-types workflow unprompted to "fix" this; it's a bigger, cross-cutting infra decision this story doesn't own, matching this codebase's established restraint (see 2.3a/2.3b's "don't fold in unprompted refactors" precedent).

### Testing standards summary

Same convention as 2.3a/2.3b: co-located `*.test.ts` files, pure-function unit tests only where the logic is genuinely pure, nothing forced into existence for its own sake. This story likely introduces no new pure logic worth a Vitest file (see Task 6.1) — pgTAP is the load-bearing test surface here, since the actual risk in this story is a Postgres grant/RLS mistake (a table-wide `UPDATE` grant instead of a column-scoped one), not application logic. Task 2's three new pgTAP cases are not optional polish; they're what proves Task 1 was implemented correctly. Manual verification against the local Supabase stack is a hard precondition (`action_items` ai-8) and must actually be run.

### Project Structure Notes

**New files:**
- `supabase/migrations/<generated>_add_djs_phone_column.sql`
- `web/app/phone-required/page.tsx`
- `web/app/phone-required/actions.ts`
- `web/lib/supabase/phone-gate.ts` — shared `needsPhone()` helper (Task 5.1), imported by both routes below.

**Updated files:**
- `supabase/tests/djs_isolation_test.sql` — three new pgTAP cases (Task 2).
- `web/app/auth/callback/route.ts` — phone-on-file gate inserted before the success redirect (Task 5.2).
- `web/app/auth/confirm/route.ts` — same gate, email+password path (Task 5.3).

**No consumer conflicts:** `web/app/login/{page.tsx,actions.ts,auth-state.ts}`, `web/lib/supabase/{client,server,middleware}.ts`, `web/proxy.ts` are all read for pattern reuse but not modified by this story. `web/app/login/auth-copy.ts` is imported from (reuse `AUTH_FAILURE_COPY.generic`), not modified.

**Out of scope (do not build here):** any phone format/E.164 validation, masking, or verification (`[auth.sms]`/`[auth.mfa.phone]` stay exactly as disabled as they are today); official Ghost-input visual polish (Story 2.4); a Profile/Settings surface to view/edit the phone later (UX-DR17, not yet built by any story); re-gating a *returning* DJ on every plain `signIn` (see Scope resolution's accepted residual limitation above — not a gap to silently close via a third enforcement layer).

### References

- [Source: _bmad-output/planning-artifacts/epics.md, lines 397 (2.3a/b/c sizing/split note), 411-421 (Story 2.3b, direct predecessor), 423-432 (Story 2.3c verbatim), 434-446 (Story 2.3d, sibling), 50 (FR-29), 84 (AR-10), 125 (UX-DR19), 191 (Epic 2 summary), 704 (Profile/Settings phone display, UX-DR17 — forward context only, not this story)]
- [Source: _bmad-output/planning-artifacts/prds/prd-name-pending-2026-07-19/prd.md, lines 369 (Account & Authentication description), 379 (phone-on-file requirement, verbatim source of AR-10)]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md#AD-10 (lines 112-116), #AD-19 (lines 175-179, forward guidance quoted in Scope boundaries)]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/SOLUTION-DESIGN.md, line 254 (billing-columns additive-column precedent this story's migration mirrors)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-name-pending-2026-07-19/EXPERIENCE.md#Component Patterns auth-form row (line 63, phone-gap origin), #State Patterns phone-required row (line 93, verbatim copy + "not skippable"), Key Flows UJ-3 step 2 (line 150)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-name-pending-2026-07-19/DESIGN.md#Input Fields (lines 254-255, Ghost styling — cited to confirm this story does NOT build it, Story 2.4 does)]
- [Source: supabase/migrations/20260726012050_create_djs_table.sql — current `djs` schema/trigger/RLS, and the Task 3 comment explicitly reserving the first DJ-writable column for this story]
- [Source: supabase/tests/djs_isolation_test.sql — existing pgTAP cases (Case 3c's "authenticated cannot update djs" assertion, which must survive this story unmodified) read directly, current state as of baseline]
- [Source: supabase/config.toml, lines 264-268 (`[auth.sms]` fully disabled), 344-357 (`[auth.external.google]` enabled/live, `[auth.external.apple]` still disabled pending 2.3b Task 1.2) — read directly]
- [Source: web/app/login/page.tsx, actions.ts, auth-copy.ts, auth-state.ts, web/app/auth/callback/route.ts, web/app/auth/confirm/route.ts, web/lib/supabase/{client,server,middleware}.ts, web/proxy.ts, web/package.json — read directly, current state as of baseline_commit]
- [Source: this story's own scope revision, 2026-07-27 — epics.md Story 2.3c (AC-1, heading) and EXPERIENCE.md's "Auth form" (line 63) and "Phone number required" (line 93) rows updated in the same pass to drop OAuth-only framing, per Arjun's direct ruling in-session]
- [Source: _bmad-output/implementation-artifacts/2-1-supabase-cloud-foundation-isolation-baseline.md — DJ-writable-column reservation, first occurrence of the scope-gap flag]
- [Source: _bmad-output/implementation-artifacts/2-3a-email-identity-path-email-password-passkey.md — Dev Notes "Flagged gap" paragraph, second occurrence of the scope-gap flag, verbatim-quoted above]
- [Source: _bmad-output/implementation-artifacts/2-3b-oauth-paths-account-linking-google-apple.md — Task 3.3's direct handoff note to this story; Debug Log's live-verified Google test account]
- [Source: web — Supabase phone-login / phone-change docs (https://supabase.com/docs/guides/auth/phone-login, https://supabase.com/docs/reference/javascript/auth-verifyotp) — fetched 2026-07-27, source for the "rejected alternative" (`updateUser({ phone })` requires SMS-OTP confirmation) note above]

## Dev Agent Record

### Agent Model Used

claude-sonnet-5 (Claude Code)

### Debug Log References

- Additive-only guard (`supabase/scripts/check-additive-only-migrations.sh`) re-run directly against the new migration: `All migrations under supabase/migrations are additive-only.`
- `supabase db reset` applied `20260727192439_add_djs_phone_column.sql` cleanly on top of the two existing migrations.
- `supabase test db supabase/tests`: `Files=1, Tests=16, ... Result: PASS` (bumped from 13; the three new Task 2 cases plus the ten pre-existing ones plus Case 3/3b/4).
- `pnpm --filter web {lint,typecheck,build,test}`: all green; build shows `/phone-required` as a new static route; test count unchanged at 13 (no new pure logic to isolate per Task 6.1).
- Repo-root `pnpm {lint,typecheck,build,test}` via turbo: all green, 3/3 tasks successful across `@curfew/shared`, `agent`, `web`; `shared`'s test count confirmed unchanged at 13 (no regression).
- Manual verification (Task 7.3), both paths, actually run against the local stack:
  - **Email+password:** signed up fresh (`phone-gate-test@example.com`) via the local stack, captured the confirmation link in Mailpit, confirmed the redirect landed on `/phone-required` (not `/`). Submitted a phone number; redirected to `/`; verified via `docker exec supabase_db_name-pending psql` that `public.djs.phone` was actually persisted (`+15555550123`).
  - **Google OAuth:** confirmed the "Sign in with Google" redirect reaches `accounts.google.com` with the correct live `client_id`/`redirect_uri`/`response_type`/`scope` (same class of verification Story 2.3b's Debug Log already established). Completing the actual sign-in requires selecting/authenticating a real Google account — outside what this agent can do (both a standing policy restriction on entering account credentials, and the browser-automation extension itself has no permission to act on `accounts.google.com`). Arjun completed both sign-ins manually at the agent's request, using the account carried over from Story 2.3b's own live test (`arjunpat107@gmail.com`, `djs.phone` null going in): first sign-in landed on `/phone-required` (confirmed via direct DB query afterward — `phone` changed from null to `29374572920`, single row, no duplicate); second sign-in (same account, phone now on file) landed directly on `/`, not re-prompted. Both outcomes verified by this agent via `docker exec ... psql` against `public.djs`, not just observed in the browser.
  - Apple was not tested — Story 2.3b's Task 1.2 (real Apple Developer credentials) is still unresolved as of this story, `[auth.external.apple]` remains disabled, matching the story's own instruction to say so explicitly rather than claim it verified.

### Completion Notes List

- Implemented Story 2.3c exactly per its own pre-resolved scope (Arjun's 2026-07-27 ruling: phone-on-file gate applies to every signup path, not just OAuth). No new scope decisions were needed during implementation — the story file's own Scope boundaries/Scope resolution section already answered every ambiguity a fresh read would normally raise.
- Task 1: first DJ-writable `djs` column, added via `supabase migration new add_djs_phone_column` → `20260727192439_add_djs_phone_column.sql`. Column-scoped `grant update (phone)` (not a blanket grant) + a new null-safe `djs_update_own_phone` RLS policy matching `djs_select_own`'s existing form, per AD-19. Additive-only guard re-verified green against the new migration.
- Task 2: pgTAP suite bumped from 13 to 16 assertions (Case 3d: DJ A updates own phone, value verified; Case 3e: DJ A's attempt to update DJ B's phone is silently blocked by RLS row-scoping — asserted via unchanged value, not `throws_ok`, per the story's own correction that this is a `USING`-clause failure, not a grant failure; Case 4c: `anon` has no update grant on `phone`). All 16 pass against the real local Postgres instance.
- Task 3/4: new `/phone-required` page (client component, heading "Add a phone number.", no skip control) + co-located `actions.ts` Server Action (`setPhone`), reusing `login/page.tsx`'s style-constant pattern and `AUTH_FAILURE_COPY.generic` for any Supabase/PostgREST failure. `setPhone`'s state type is defined locally in each of `actions.ts`/`page.tsx` (structurally identical, not cross-imported) rather than exported from the `"use server"` file, avoiding any ambiguity around what a Server Actions file may export.
- Task 5: new `web/lib/supabase/phone-gate.ts` exporting `needsPhone()`, imported by both `auth/callback/route.ts` (OAuth) and `auth/confirm/route.ts` (email) ahead of their existing success redirect. `needsPhone()` catches its own errors and returns `false` (the least-blocking path), so a transient lookup failure can never demote an already-successful sign-in/confirmation to the `/login?error=confirmation-failed` failure page — it only ever affects whether the redirect target is `/` or `/phone-required`.
- Task 6: no new pure logic was factored out (`setPhone`'s validation stayed a bare trim/non-empty check per Task 6.1's own guidance), so no new `*.test.ts` file was added; confirmed the existing `no-hardcoded-colors.test.ts` guard still passes unmodified against the new `phone-required/**` files.
- Task 7: full local gate (web + repo-root) green, pgTAP green, and both the email+password and Google OAuth paths manually verified end-to-end against real state (Mailpit-captured email link; real Google sign-in performed by Arjun at this agent's request, DB state verified by this agent afterward via direct `psql` queries). Apple remains untestable, unchanged from Story 2.3b's own open blocker (Task 1.2, real Apple Developer credentials not yet acquired).

### File List

**New:**
- `supabase/migrations/20260727192439_add_djs_phone_column.sql`
- `web/app/phone-required/page.tsx`
- `web/app/phone-required/actions.ts`
- `web/lib/supabase/phone-gate.ts`

**Modified:**
- `supabase/tests/djs_isolation_test.sql`
- `web/app/auth/callback/route.ts`
- `web/app/auth/confirm/route.ts`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

## Change Log

- 2026-07-27: Implemented Story 2.3c end-to-end (phone-on-file, both the email+password and OAuth signup paths per the story's own pre-resolved scope broadening). First DJ-writable `djs` column (`phone`, nullable, column-scoped `grant update` + new RLS policy per AD-19); pgTAP suite 13 → 16 assertions; new `/phone-required` screen + Server Action; new shared `needsPhone()` gate wired into both `auth/callback/route.ts` and `auth/confirm/route.ts` ahead of their existing success redirects. Full local + repo-root gate green (web: 13/13 tests unchanged, no new pure logic to test; shared: 13/13 unchanged; pgTAP: 16/16). Both email+password and Google OAuth paths manually verified end-to-end against the real local stack, including a second Google sign-in confirming a DJ with phone already on file is not re-prompted. Apple leg not tested — still blocked on Story 2.3b's Task 1.2 (real Apple Developer credentials), unchanged from that story's own open item.
