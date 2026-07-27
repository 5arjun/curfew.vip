---
baseline_commit: 930732336e8f549580d3020200e0bf6d9c132621
---

# Story 2.3c: Phone-on-file (post-OAuth prompt)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a DJ,
I want a phone number captured after OAuth signup,
so that every account has a phone on file as required.

## Acceptance Criteria

1. **Given** Google or Apple signup, **When** it completes without a phone on file, **Then** I am prompted once for a phone number (single-field, required). *(FR-29, UX-DR19 phone-required)*
2. **Given** the phone-required state, **Then** it renders as the specified one-field post-OAuth screen, not a blocking modal wall. *(UX-DR19)*

[Source: _bmad-output/planning-artifacts/epics.md, lines 423-432]

### Scope boundaries (binding — read before writing code)

- **In scope:** the `djs.phone` column (the first DJ-writable column on this table, additive-only migration + column-scoped RLS write policy), the one-field `/phone-required` screen, and gating `web/app/auth/callback/route.ts`'s success redirect on whether `phone` is on file. **Out of scope:** phone collection on the email+password path (see "Known, twice-flagged scope gap" below — do not self-expand), any phone **verification** (SMS OTP, `auth.sms`/`auth.mfa.phone` stay disabled), official Ghost-input visual polish (Story 2.4, same boundary 2.3a/2.3b already drew — this ships functional/unpolished like every other auth surface so far), and any "manage/edit phone later" UI (Profile/Settings, UX-DR17 — not this story).
- **⚠️ Known, twice-flagged scope gap — read before assuming this story closes AR-10/FR-29.** AR-10/FR-29 state "every account has a phone number on file **regardless of signup path**." Both Story 2.1's `create_djs_table` migration comment ("no story before 2.3c needs a DJ-writable column on this table") and Story 2.3a's Dev Notes ("Flag for Arjun: either broaden 2.3c... or add a phone field [to 2.3a]... Net effect: as scoped, an email-only DJ who never touches Google/Apple will never be prompted for a phone number anywhere in 2.3a or 2.3c") already logged this. **This is now the third time it's been logged, still unresolved.** This story's own AC-1 text is explicit — "**Given Google or Apple signup**" — not "given any signup." Honor that literal scope; do **not** silently expand this story to add a phone field to the email+password signup form (`web/app/login/page.tsx`'s `signUp` action) — that would be a real product-scope decision this story doesn't own, made without Arjun's sign-off, mirroring exactly why 2.3a declined to self-resolve it. If Arjun wants it closed, the precedent is `bmad-correct-course` (the same mechanism that turned the production-email-delivery gap into Story 2.3d) — surface this gap prominently in your Dev Agent Record / final report rather than quietly coding around it.
- **First DJ-writable column on `djs` — read `AD-19` before writing the migration.** Story 2.1 deliberately shipped `djs` read-only (RLS `SELECT` only, all writes via the `SECURITY DEFINER` trigger) specifically so this story would be the one to add the first write policy. `AD-19` (billing columns, Epic 7, not yet built) already anticipates this exact moment: *"if `djs` later gains any DJ-writable update policy (e.g. display name), that policy's column grant list must explicitly exclude the four billing columns."* Epic 7's billing columns don't exist yet, so there's nothing to explicitly exclude today — but the way you satisfy that guidance **now**, permanently, is by scoping the `GRANT UPDATE` to the `phone` column only (`grant update (phone) on public.djs to authenticated`), never a blanket `grant update on public.djs`. Get this wrong (a table-wide grant) and Epic 7 inherits a live vulnerability the day it ships, silently.
- **Rejected alternative — do not use `auth.users.phone` / `supabase.auth.updateUser({ phone })`.** Supabase Auth's `auth.users` table already has a native `phone` column, normally set via `updateUser({ phone })`. Verified against Supabase's own docs (2026-07-27): that call is coupled to Supabase's native phone-OTP change flow — it requires a follow-up `verifyOtp({ type: "phone_change" })`, which requires a configured SMS provider. This project's `[auth.sms]` is fully disabled (`supabase/config.toml`, Twilio commented out) and AC-1 only asks for the number to be **captured**, never verified. Use `djs.phone` — a plain profile column — exactly as Story 2.1's migration comment anticipated.

## Tasks / Subtasks

- [ ] **Task 1 — Additive migration: the first DJ-writable `djs` column (AC: 1)**
  - [ ] 1.1 Generate via `supabase migration new add_djs_phone_column` (auto-timestamped, matches the project's existing two migrations' naming convention — do not hand-pick a timestamp).
  - [ ] 1.2 `alter table public.djs add column phone text;` — nullable (existing rows, including every email-path account created by 2.3a/2.3b testing, must not break), additive-only per AR-12/AD-15. Do not touch `id`/`created_at`, do not add a `NOT NULL` constraint (that would require a default for existing rows and contradicts "prompted after signup," not "required at the DB level for every row").
  - [ ] 1.3 `grant update (phone) on public.djs to authenticated;` — **column-scoped, not a blanket `update` grant** (see AD-19 note in Scope boundaries above — this is the one line in this story most likely to be gotten wrong).
  - [ ] 1.4 New policy: `create policy "djs_update_own_phone" on public.djs for update using (auth.uid() is not null and auth.uid() = id) with check (auth.uid() is not null and auth.uid() = id);` — same null-safe `auth.uid() is not null and auth.uid() = id` form as the existing `djs_select_own` policy (house style, not optional — see Story 2.1's migration comment on why null-safety matters here).
  - [ ] 1.5 Do not add `INSERT`/`DELETE` grants or policies on `djs` — out of scope, `handle_new_dj()`'s `SECURITY DEFINER` trigger remains the only row creator.

- [ ] **Task 2 — pgTAP coverage for the new write path (AC: 1)**
  - [ ] 2.1 In `supabase/tests/djs_isolation_test.sql`, bump `select plan(13)` to the new total. Keep the existing Case 3c assertion (`update public.djs set created_at = now() ... throws_ok 42501`) — it must still pass unmodified, since the new grant is scoped to `phone` only, not `created_at`.
  - [ ] 2.2 Add: authenticated DJ A can update their own `phone` — perform the update, then `select`/`is()` to confirm the stored value actually changed (don't just assert the `UPDATE` didn't throw).
  - [ ] 2.3 Add: authenticated DJ A **cannot** change DJ B's `phone`. This is an RLS `USING`-clause row-scoping failure, **not** a grant-level failure — in Postgres, an `UPDATE` whose `USING` clause matches zero rows silently affects 0 rows, it does **not** raise `42501` the way a missing table/column grant does. Assert via row-count/`results_eq` (e.g. confirm DJ B's `phone` is unchanged after DJ A's attempted update), not `throws_ok`.
  - [ ] 2.4 Add: `anon` cannot update `phone` at all — `throws_ok`, `42501` (no grant exists for `anon`, mirrors the existing Case 4b pattern for `created_at`).
  - [ ] 2.5 Run for real: `supabase db reset && supabase test db supabase/tests` (per `supabase/README.md`) — must actually execute on this machine, not be assumed green.

- [ ] **Task 3 — `/phone-required` screen (AC: 1, 2)**
  - [ ] 3.1 New file `web/app/phone-required/page.tsx` — client component, its own page (not a modal/dialog — satisfies AC-2 by construction, nothing to build there). Heading copy verbatim from EXPERIENCE.md's State Patterns row: **"Add a phone number."** Reuse the existing `fieldStyle`/`inputStyle`/`buttonStyle` object-literal constants pattern from `web/app/login/page.tsx` (copy them locally or factor out — your call, but match their values) — functional/unpolished like every prior auth screen; Story 2.4 owns the Ghost-input visual spec.
  - [ ] 3.2 On mount (or server-side in the page itself, your call), require an authenticated session — if none, redirect to `/login`. This page has nothing to do for a signed-out visitor.
  - [ ] 3.3 Single field: `<input type="tel" name="phone" required>`. No format library, no masking, no E.164 enforcement — AC-1 says "captured (single-field, required)," not "verified" or "formatted." Do not add `libphonenumber`/`libphonenumber-js` or any new dependency.
  - [ ] 3.4 No skip/cancel control anywhere on this page — EXPERIENCE.md's State Patterns row is explicit: "Not skippable."

- [ ] **Task 4 — Server Action to persist the phone number (AC: 1)**
  - [ ] 4.1 New file `web/app/phone-required/actions.ts` (`"use server"`) — `setPhone(prevState, formData)`. Define its own small state type locally (don't force-fit `web/app/login/auth-state.ts`'s `AuthActionState` — its `fieldErrors: { email?, password?, form? }` shape doesn't have a `phone` key and is conceptually the login/signup form's type, not this one's).
  - [ ] 4.2 Read `phone` from `formData`, trim it, reject empty with a field error (don't rely on the HTML `required` attribute alone — Server Actions can be invoked with JS disabled/bypassed).
  - [ ] 4.3 Get the **server** Supabase client (`web/lib/supabase/server.ts`), call `auth.getUser()` — if no user, return a form error (do not silently `redirect()` from inside the action; let the page-level guard in Task 3.2 own navigation).
  - [ ] 4.4 `await supabase.from("djs").update({ phone }).eq("id", user.id)` — this is what Task 1's column-scoped grant + RLS policy exist to allow. On a Supabase/PostgREST error, return `AUTH_FAILURE_COPY.generic` ("Something went sideways — try again.") imported from `web/app/login/auth-copy.ts` — reuse verbatim, don't invent a new copy string (same reuse-generic-for-unregistered-failures precedent 2.3b already established for OAuth errors).
  - [ ] 4.5 On success, `redirect("/")` — same placeholder-scaffold-root convention every prior auth story used (Epic 3 owns the real Dashboard).

- [ ] **Task 5 — Gate the OAuth callback on phone-on-file (AC: 1)**
  - [ ] 5.1 In `web/app/auth/callback/route.ts`, after a successful `exchangeCodeForSession` and **before** the existing `redirect("/")`, look up the signed-in user's `djs.phone` via the same server client: `.from("djs").select("phone").eq("id", data.user.id).single()`. `data.user` comes directly from `exchangeCodeForSession`'s own return value — no extra `getUser()` round trip needed. If `phone` is null (or empty), `redirect("/phone-required")` instead of `/`.
  - [ ] 5.2 This route is the **one and only** integration point for this story — per Story 2.3b's own Task 3.3 note: *"Story 2.3c is responsible for inserting the phone-required gate before this redirect becomes final — not this story's job."* Do **not** add a global/middleware-level gate (`proxy.ts`/`middleware.ts`). Every request that reaches this route is already a Google/Apple sign-in by construction — this is the OAuth-only callback, structurally distinct from `confirm/route.ts`'s email-OTP path — so checking `phone` here is already correctly scoped to "post-OAuth" (AC-1) without needing to separately detect which provider was used, and without touching the email+password path at all.
  - [ ] 5.3 Wrap the lookup in the same try/catch discipline as the rest of this route (network hiccup → fail toward `redirect("/")`, the least-blocking path, not a raw 500 — same "calm degrade" convention already used by `confirm/route.ts` and `middleware.ts`). A DJ who lands on `/` once due to a transient lookup failure gets re-gated the next time they sign in via OAuth (phone will still be null), so this isn't a permanent gap.

- [ ] **Task 6 — Tests (AC: 1, 2)**
  - [ ] 6.1 If `setPhone`'s validation stays a bare trim/non-empty check (Task 4.2), there is no new pure logic worth isolating in a `*.test.ts` file — do not force one into existence (same testing philosophy 2.3a/2.3b already established: "do not force a test into existence where there's nothing pure to test"). If you do factor out a pure helper (e.g. a phone-normalizer), unit-test it alongside `web/app/login/auth-copy.test.ts`'s existing convention.
  - [ ] 6.2 Confirm `web/app/phone-required/**` passes the existing `no-hardcoded-colors.test.ts` guard unmodified — tokens only, same as every other new page in this repo.

- [ ] **Task 7 — Full gate**
  - [ ] 7.1 `pnpm --filter web lint`, `pnpm --filter web typecheck`, `pnpm --filter web build`, `pnpm --filter web test` — all green.
  - [ ] 7.2 `supabase db reset && supabase test db supabase/tests` — all pgTAP cases green, including Task 2's three new cases.
  - [ ] 7.3 Manual verification: Google credentials are already live in this environment (Story 2.3b's `supabase/.env`, real Client ID/Secret) — sign in via Google with an account whose `djs.phone` is null, confirm the redirect lands on `/phone-required`, not `/`. Submit a phone number, confirm redirect to `/` and the DB row updated. Sign in again via Google with the same account, confirm it now lands directly on `/` (not re-prompted — phone already on file). Apple stays untestable pending Story 2.3b's Task 1.2 (real Apple credentials still not acquired as of this story's creation) — say so explicitly in the Dev Agent Record if still blocked; do not claim it verified.
  - [ ] 7.4 Repo-root gate: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` via turbo — must be actually run on this machine (standing Epic-2+ rule, sprint-status `action_items` ai-8). Confirm no regression in `shared/`'s test count (currently 13).

## Dev Notes

### Architecture compliance

- **AD-10** (governing decision): "...a phone number is required on file (prompted after Google/Apple signup)..." — this story makes that literally true for the two OAuth paths. It does **not** make AR-10/FR-29's broader "regardless of signup path" fully true — see the Known scope gap in Scope boundaries above; do not treat this story as closing that invariant.
- **AD-19** (forward guidance, quoted in full in Scope boundaries): the single most important piece of architecture context for this story. Column-scope the `GRANT UPDATE` to `phone` only — this is what keeps AD-19 satisfied automatically once Epic 7's billing columns land, rather than requiring a follow-up migration to retroactively narrow an over-broad grant.
- **AR-4/AD-7** (null-safe RLS): the new policy's `using`/`with check` must match `djs_select_own`'s existing `auth.uid() is not null and auth.uid() = id` form exactly — this project's established house style for every RLS policy on this table.
- **AD-8**: the one write path this story adds is Supabase/PostgREST + RLS (`.from("djs").update(...)` inside a Server Action) — not a bespoke mutation API, consistent with every other Epic 2 write path.

### Previous story intelligence

- **Story 2.1** (done) shipped `djs` deliberately read-only via RLS, explicitly reserving "the first DJ-writable column" for this story (see its migration's Task 3 comment) — Task 1 above is that reservation being cashed in. No other column on `djs` should become writable in this story.
- **Story 2.3b** (in-progress — Google leg done and live-tested, Apple leg blocked on real Apple Developer credentials, Task 1.2) left a direct, explicit handoff on its own Task 3.3: *"Story 2.3c is responsible for inserting the phone-required gate before this redirect becomes final — not this story's job."* Task 5 above is exactly that. 2.3b's in-progress status is **not** a blocker for this story — the Google-path code this story integrates with (`web/app/auth/callback/route.ts`) already exists, is committed, and Arjun has already completed one real end-to-end Google sign-in against it (2.3b's Debug Log) — that same test account (`djs.phone` currently null) is a ready-made fixture for this story's Task 7.3 manual verification.
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

**Updated files:**
- `supabase/tests/djs_isolation_test.sql` — three new pgTAP cases (Task 2).
- `web/app/auth/callback/route.ts` — phone-on-file gate inserted before the success redirect (Task 5).

**No consumer conflicts:** `web/app/login/**`, `web/app/auth/confirm/route.ts`, `web/lib/supabase/{client,server,middleware}.ts`, `web/proxy.ts` are all read for pattern reuse but not modified by this story.

**Out of scope (do not build here):** phone collection on the email+password signup form (see Known scope gap above — this is a real, unresolved product question, not a forgotten task); any phone format/E.164 validation, masking, or verification (`[auth.sms]`/`[auth.mfa.phone]` stay exactly as disabled as they are today); official Ghost-input visual polish (Story 2.4); a Profile/Settings surface to view/edit the phone later (UX-DR17, not yet built by any story); a persistent/global re-gate for a DJ who abandons `/phone-required` mid-session and returns without going back through the OAuth callback (a real edge case, but the same class of already-accepted, already-deferred gap as this codebase's existing "no existing-session redirect off /login" entry in `deferred-work.md` — log it there if you rediscover it, don't silently build a global gate to close it).

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
- [Source: _bmad-output/implementation-artifacts/2-1-supabase-cloud-foundation-isolation-baseline.md — DJ-writable-column reservation, first occurrence of the scope-gap flag]
- [Source: _bmad-output/implementation-artifacts/2-3a-email-identity-path-email-password-passkey.md — Dev Notes "Flagged gap" paragraph, second occurrence of the scope-gap flag, verbatim-quoted above]
- [Source: _bmad-output/implementation-artifacts/2-3b-oauth-paths-account-linking-google-apple.md — Task 3.3's direct handoff note to this story; Debug Log's live-verified Google test account]
- [Source: web — Supabase phone-login / phone-change docs (https://supabase.com/docs/guides/auth/phone-login, https://supabase.com/docs/reference/javascript/auth-verifyotp) — fetched 2026-07-27, source for the "rejected alternative" (`updateUser({ phone })` requires SMS-OTP confirmation) note above]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
