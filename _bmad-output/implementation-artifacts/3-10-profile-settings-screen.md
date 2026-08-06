# Story 3.10: Profile/Settings screen

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a DJ,
I want a single Profile/Settings screen reachable from the floating nav's avatar, where I see and manage my identity, my agent, and my privacy controls,
so that there is one calm, honest home for my account that later features (billing, location) plug into — and so the "phone on file" invariant is finally guaranteed rather than best-effort.

## Context & Authority

**Authoritative design spec:** `_bmad-output/implementation-artifacts/3-10-settings.md` — 19 locked decisions (D-1…D-19), the ASCII anatomy, the states table (§5), the phone-gate mechanism (§4), and the schema deltas (§6). Read it in full before implementing. This story file operationalizes that spec against the real code; **where this file cites a specific file/line, it wins over the spec's prose** (the spec was written against a reading of the code that this story's exhaustive map corrected in a few places — see "Spec-vs-code reconciliations" in Dev Notes).

**Epics source:** `epics.md` §Story 3.10 (lines 754–786) — original AC-1…AC-5 plus the ⚑ RULED phone-gate note and the ⚑ design-session block. The ACs below **extend** those five; they do not merely restate them. The design session added the Agent section, DJ name, sign-out (the product's first), the About section, and the middleware phone gate — none of which are in the original AC list.

**Cross-story closures this story owns (spec §7):**
- `epics.md` Story 2.11 AC-3 amendment (delete-account link CUT) — **already written** (epics.md:573); verify it reads correctly, do not re-add.
- `deferred-work.md`: close the phone-invariant entry (D-9, line 108) and the OAuth-passkey-nudge entry (D-7 resolved-by-relocation, line 88); leave the `LiquidMetalButton` orphan (line 17) **open** with an added note that Settings was considered and declined (D-17).
- `EXPERIENCE.md`: add one Failure Register row — *Settings change failed → "Change not saved — retry."*
- `pre-launch-services-checklist.md`: two new rows — `support@curfew.vip` inbox (does not exist) and Sentry project/DSN (unprovisioned; `web/` has no Sentry at all). Also flag: no privacy-policy/terms page exists anywhere.

**Scope guardrails (carry into every task):**
- `djs.dj_name` grant is **column-scoped** (`grant update (dj_name)`), never blanket `grant update on public.djs` (AD-19).
- `agent_status.agent_version` is **additive only**; `set_agent_status` still derives `dj_id` from `auth.uid()` — never a parameter (AD-20).
- **No `shared/` contract touch** (AD-3). The frozen sync-payload schema and the 6-state wire enum are untouched; `agent_version` is a separate additive heartbeat field, not part of the `sync_state` enum.
- **No WebGL/shader material on this screen** (D-17). The orphaned `LiquidMetalButton` is explicitly declined a home here.

## Acceptance Criteria

Extends epics.md Story 3.10 AC-1…AC-5. Each AC cites its design decision (D-#) and/or source.

### Nav & shell

1. **(extends AC-1)** The floating nav's profile trigger renders the DJ's **real avatar** — circular (`--radius-full`), 1px `outline-variant` border, image only — in place of the current `UserCircle` placeholder, still routing to `/settings` with no other interaction. Source = OAuth provider photo (`user_metadata.avatar_url ?? user_metadata.picture`); when absent, a **monogram** (first letter of DJ name, else email) on a token-colored disc. The nav swap is visual only — `FloatingNav`'s structure, active-state logic, and `/settings` destination are unchanged. *(D-4, UX-DR15/DR2; FloatingNav.tsx:42–50 comment already anticipates this swap.)*
2. **(AC-5 / D-2 / D-18)** The page is a **single centered column (~720px inside the 1100px container), whole-page scroll** (the same break from the dashboard's viewport lock that 3.7 made) — flat "console rows" (label left in `on-surface-variant` body-sm, value/control right in body-md, hairline `outline-variant` rules between rows), **not** the dashboard's card/glass vocabulary. Nav label and page heading are both **"Settings."** Uses only Obsidian tokens (`tokens.css`) and meets **WCAG 2.2 AA**. *(D-2, D-18, UX-DR1/DR21)*
3. **(D-1)** Sections render in order **Profile header → Account → Agent → Privacy → Appearance → About → Sign out**, with a Billing slot reserved between Account and Privacy (renders nothing until Story 7.4 populates it). **A section with nothing true to say does not render** (e.g., About's agent-version row when no beat has ever carried a version). *(D-1; the shell exists independently of 5.7/7.4 per epics AC-3.)*

### Profile header & identity

4. **(D-3)** A new **optional, editable `dj_name`** field exists (label literally "DJ name", ≤40 chars, any characters, no uniqueness check), stored on `public.djs`. It is the **only writable field in the Account section**. **When set, it wins over OAuth `full_name`/`name` in the dashboard greeting**; OAuth metadata is the fallback; nameless if neither. This fixes email-path DJs being permanently nameless. *(D-3; wire into `dashboard/page.tsx` `getFirstName()`.)*
5. **(D-3a)** The Profile header shows avatar (~64px, `--radius-full`, 1px `outline-variant`, image-or-monogram per AC-1) + a name line (DJ name if set, else OAuth name, else email alone) + the email beneath. The header is **not a form** — the editable DJ name lives once, in Account.

### Account section

6. **(D-5)** **Email** renders read-only (it is the cross-provider account-linking key — never edited here).
7. **(D-8)** **Phone** renders masked (`+1 415 ••• ••42`), read-only, with a quiet `verified · locked` affix (a status word, **not** a disabled input — a greyed field reads as broken) and a plain note that changing it needs verification. Rationale: there is no SMS-verification path in the product; an unverified edit would silently break the AR-10 contactability invariant. Phone null (unreachable once the gate ships) renders `Not on file`, never an empty value. *(D-8, State table §5.)*
8. **(D-5, ⚠ scope)** **Password** renders one **"Send reset link"** action that emails the DJ a recovery link. **There is no existing password-reset infrastructure in the codebase** (grep confirms zero `resetPasswordForEmail`/reset route) — this is net-new: a server action calling `supabase.auth.resetPasswordForEmail(email, { redirectTo })` **plus** a landing route where the DJ sets a new password. See Dev Notes "Password reset — hidden scope" for the ruling needed. No in-form old/new password pair either way.
9. **(D-6)** **Sign-in providers** row shows which of Email / Google / Apple / Passkey are attached (read from the authenticated user's `identities` / `app_metadata.providers`), each attached one with a check, each unattached one with a **link** affordance calling `supabase.auth.linkIdentity({ provider })`. **Unlink is deliberately absent** (unlinking your only identity locks you out of your archive). **Apple's link path cannot be exercised on localhost** (Sign In with Apple hard-requires an HTTPS return URL — see login/page.tsx:41–47) — verify it against the Vercel deploy, gated on `NEXT_PUBLIC_APPLE_SIGNIN_AVAILABLE`. *(D-6; `linkIdentity` requires "Manual linking" enabled on the Supabase project — provisioning dependency, see Dev Notes.)*
10. **(D-7)** An **"Add a passkey"** action lives in the provider area, reusing the shipped `supabase.auth.registerPasskey()` (login/page.tsx:291) which adds a credential to the existing session. Hidden (not shown-and-failing) on browsers without WebAuthn support. This **discharges the 2026-07-30 OAuth-passkey-nudge ledger ruling by relocation** (deferred-work.md:88) — Settings is the durable home; chasing one-time nudge state through two server-side redirect flows is disproportionate. *(D-7.)*

    > **⚑ AC-9/AC-10 letter amended (Arjun, 2026-08-05 code review — all four as-built deviations blessed):** (a) unattached **Email** renders attached-or-absent, no link affordance (`linkIdentity` is OAuth-only; a "+ Link" that can't work would lie); (b) **Passkey** attachment reads from the client-side credential list (`passkey.list()`, the login page's own check), not `identities`/`app_metadata.providers`; (c) **Apple** keeps the login page's disabled "Link (coming soon)" treatment until the HTTPS deploy; (d) the post-link return lands on `/auth/callback` → dashboard, not Settings.

### Agent section

11. **(D-10)** The Agent section shows a **status line, an agent version, and a "Link agent" button** routing to `/link-agent` (giving that orphaned route — reachable today only by typing the URL / the agent tray — its first in-app nav path). **No device row, no unlink**: linking is a `curfew-agent://` token handoff with no server-side device record, and the only real revocation (global refresh-token revoke) would also sign the DJ's browser out. *(D-10.)*
12. **(D-10, 3c)** The status line **reuses 3.9's `resolveAgentStatus`** (web/lib/sets/agentStatus.ts) so it can never disagree with the dashboard banner — but unlike the silence-first banner, **this row always speaks**. It supplies its **own exhaustive copy map** covering all six states plus the resolver's `null` (stale/missing/unknown): fresh `Idle` → a calm "up to date"-register line, `DriveNotConnected` → the reconnect line (EXPERIENCE.md scopes this state to "tray + Settings", so Settings is exactly where it surfaces), `null` from a never-seen agent → `No agent linked` + the button, `null` from a stale beat → `Last beat N days ago` in a calm register, **never an alarm color**. `agentStatusLine` (status-copy.ts) returns `null` for Idle/DriveNotConnected, so it **cannot** be reused as-is — build the Settings copy map alongside it. *(D-10, 3.9 resolver reuse; State table §5.)*
13. **(D-11)** The **agent version** row shows the version carried by the heartbeat's new `agent_version` field (see AC-16). Hidden entirely when no beat has ever carried one (pre-D-11 agents, or no agent).

### Privacy / Appearance / About

14. **(D-12)** Privacy renders a **"Request an export"** row (`mailto:support@curfew.vip`, copy noting it's handled manually within a few days) and a **location coming-soon note** (venue suggestion, no control — 5.7 fills the real toggle). **Delete-account is CUT from MVP** — no deletion affordance anywhere on this screen (amends 2.11 AC-3, already noted at epics.md:573). *(D-12, 3d.)*
15. **(D-13, D-14)** **Appearance** renders a single **"Themes coming soon"** text row (no control — Obsidian is dark-only by design; a disabled toggle would invite clicking and lie). **About** renders: **Curfew Web** version + short build hash (`VERCEL_GIT_COMMIT_SHA`), **Agent** version (per AC-13, hidden when unknown), and **Support** (`mailto:support@curfew.vip`). These strings are load-bearing: **Sentry is not provisioned** (agent has the wiring but no DSN; `web/` has no Sentry at all), so they are the only diagnostic a DJ can hand over. *(D-13, D-14, 3e.)*

### Save model & sign out

16. **(AC-4 / D-15)** **Autosave, no Save button**: DJ name saves on a ~600ms debounce while typing, plus on blur/Enter, via a column-scoped `djs` update. Confirmation is **page-level** — a single **"Saved."** on the heading baseline, fading after ~2s (EXPERIENCE.md "Settings saved" state). **Failure is inline and never silently reverts**: the typed value stays and the row shows **"Change not saved — retry."** with a retry affordance (covers network drop, expired session, and RLS rejection identically; offline-while-typing uses the same row, no separate copy). *(D-15, State table §5, new Failure Register entry.)*
17. **(D-16)** A **"Sign out"** action sits at the bottom of the page and opens a **calm confirm dialog** (reusing 3.7's `DeleteModal` treatment — blurred scrim, focus trap, Escape/restore-focus — but **without any destructive language or alarm color**). Copy: *"Sign out?" / "Your sets stay archived. The agent keeps capturing."* → `[Cancel]` `[Sign out]`. On confirm, calls Supabase `signOut()` and redirects to `/login`. **This is the product's first sign-out** — `signOut` exists nowhere today. *(D-16; DeleteModal.tsx pattern.)*
18. **(D-17)** Motion budget is **only** the "Saved." fade, the confirm-dialog scrim, and standard focus/hover transitions — **no WebGL, no shader rim, no morphing numbers**. The `LiquidMetalButton` gets **no** demo home here.

### Data / gate

19. **(D-9 / §4)** The **phone-on-file invariant is enforced by a middleware gate**. In `web/lib/supabase/middleware.ts` (`updateSession`, invoked by `web/proxy.ts`), a **cookie-marked lazy check**: on a protected route, if the `curfew_phone_on_file` cookie is absent, do **one** read of `djs.phone` for the authenticated caller — non-null → set the cookie and continue; null → redirect to `/phone-required`; cookie present → continue with no read. Cost is **one DB read per session**, not per request. Gate applies to the `(authenticated)` routes **and `/link-agent`**; exempts `/phone-required`, `/login`, `/auth/*`, and static assets. The cookie being spoofable is acceptable — AR-10 is a contactability invariant, not a security boundary; the DB stays source of truth (JWT-claim auth hook noted as the airtight upgrade path, not the launch choice). *(D-9, §4; closes deferred-work.md:108.)*
20. **(D-11 / §6.2)** The heartbeat carries **exactly one additive field, `agent_version`** — one nullable `agent_status` column, one added param on `set_agent_status`, one Rust wire field, one `beat()`/`StatusClient` signature change, one call-site change threading `crate::config::AGENT_VERSION`. Nothing else joins the heartbeat (no device name, no OS). `dj_id` stays derived from `auth.uid()` (AD-20); the 6-state wire enum and `shared/` are untouched (AD-3). *(D-11, §6.2.)*

## Tasks / Subtasks

> Suggested order: schema → data-access → page/components → agent Rust → middleware gate → doc writebacks → verification. The migration and the Rust change are the two that touch the frozen-additive discipline — do them carefully and first.

- [ ] **Task 1 — Schema: `djs.dj_name` (column-scoped) + `agent_status.agent_version` + RPC param** (AC: 4, 13, 20)
  - [ ] New migration mirroring `20260727192439_add_djs_phone_column.sql` **exactly**: `alter table public.djs add column dj_name text;` + `grant update (dj_name) on public.djs to authenticated;`. **Do NOT** add a blanket `grant update on public.djs` (AD-19). The existing `djs_update_own_phone` UPDATE policy already governs owner row-updates; confirm whether a distinct policy is wanted or the existing owner policy suffices (column privilege is enforced by the GRANT). Optionally add a `check (char_length(dj_name) <= 40)` to back the ≤40 rule server-side.
  - [ ] New migration: `alter table public.agent_status add column agent_version text;` (nullable, additive). Then **replace** `set_agent_status(sync_state text)` with `set_agent_status(sync_state text default null, agent_version text default null)` — keep `security definer`, `set search_path = ''`, `#variable_conflict use_column`, the `auth.uid()` derivation, the null/allow-list validation, and the `on conflict (dj_id) do update` upsert; add `agent_version` to the insert/update columns. **`dj_id` must never become a parameter** (AD-20). Re-`grant execute` on the new signature; drop the old one.
  - [ ] Extend pgTAP coverage (mirror the existing `agent_status` suite): new signature accepts a version, nullable version still valid, allow-list + `auth.uid()` derivation unchanged, additive-only guard passes.
  - [ ] Bump `web/package.json` `version` off `"0.0.0"` (e.g. `"0.1.0"`, matching the agent's Cargo version) for the About "Curfew Web" row.

- [ ] **Task 2 — Data access: `djs` read/write + dashboard greeting precedence** (AC: 4, 5, 16)
  - [ ] Add a `getSettingsProfile()`-style server read (in `web/lib/sets/index.ts` or a new `web/lib/account/*`) returning `{ dj_name, phone, email, avatarUrl, providers, identities }` from `auth.getUser()` + a `djs` select. RLS owner-SELECT already permits the `djs` read with no `dj_id` filter.
  - [ ] Add a server action `updateDjName(name)` doing the column-scoped `djs` update (`.update({ dj_name })`), returning a discriminated result so the client can render "Saved." vs "Change not saved — retry." Enforce ≤40 chars server-side.
  - [ ] Wire `dashboard/page.tsx` `getFirstName()` (lines 23–39): read `djs.dj_name` **first**; fall back to `user_metadata.full_name` → `.name`; else `null`. Take the first whitespace token as today. Add/adjust the greeting test.

- [ ] **Task 3 — Settings page shell + rows** (AC: 2, 3, 5, 6, 7, 14, 15, 18)
  - [ ] Replace the stub `web/app/(authenticated)/settings/page.tsx` with the real page. Guard it with the `getUser()` → `redirect("/login")` pattern from `link-agent/page.tsx` (the `(authenticated)` group has **no** auth-gating middleware — layout.tsx says so). Server-render the read-only facts (email, masked phone, providers, About strings, agent snapshot) and pass to client sub-components for the interactive bits.
  - [ ] Build the "console row" primitive (label left `on-surface-variant`/body-sm, value/control right/body-md, hairline `outline-variant` rule) and section-label register matching the rest of the product. **No cards/glass.** Single centered ~720px column, whole-page scroll (drop the dashboard's viewport lock).
  - [ ] Render sections in D-1 order with the empty-section rule (a section with nothing true does not render; Billing slot reserved, renders nothing pre-7.4).
  - [ ] Privacy (export mailto + location coming-soon note, no delete affordance), Appearance ("Themes coming soon"), About (web version + short `VERCEL_GIT_COMMIT_SHA`, agent version hidden-when-unknown, support mailto). Read `VERCEL_GIT_COMMIT_SHA` server-side and slice to short; web version from the bumped package.json.

- [ ] **Task 4 — Editable DJ name row: autosave + inline failure** (AC: 4, 16)
  - [ ] Reuse `GhostInput` (components/auth/GhostInput.tsx) as the ghost-text editable row (looks like text until focused). Wire ~600ms debounce + save-on-blur/Enter to `updateDjName`.
  - [ ] Page-level "Saved." on the heading baseline (fade ~2s) — EXPERIENCE.md "Settings saved" register. On failure, keep the typed value, render **"Change not saved — retry."** inline under the row with a retry action; **never revert**. Same row for offline-while-typing.

- [ ] **Task 5 — Avatar in nav + Profile header + monogram fallback + remotePatterns** (AC: 1, 5)
  - [ ] Add `images.remotePatterns` to `web/next.config.ts` for the Google photo CDN (`lh3.googleusercontent.com`, and `lh4/5/6` variants). Apple Sign In typically returns **no** photo — monogram covers it; add an Apple CDN pattern only if a real photo URL is observed.
  - [ ] Build an `Avatar` component (image via `next/image` when a URL exists; monogram — first letter of DJ name else email on a token-colored disc — otherwise), `--radius-full`, 1px `outline-variant`. Use it at ~64px in the header and ~20px in the nav.
  - [ ] Swap `FloatingNav`'s `UserCircle` for the avatar **without restructuring the nav** (the nav is a pure `usePathname()` client component that does **not** fetch the user — decide the cleanest source: fetch avatar data in `(authenticated)/layout.tsx` (server) and pass it to `FloatingNav` as a prop, or a small client read; prefer the server-prop path to keep the nav dumb). Keep active-state logic and `/settings` destination intact.

- [ ] **Task 6 — Agent section (always-speaks status + version + Link agent)** (AC: 11, 12, 13)
  - [ ] Server-read the agent snapshot via the existing `getAgentStatus()` (`web/lib/sets/index.ts`) and pass it in. Reuse `resolveAgentStatus(row, nowMs)`.
  - [ ] Build a **new exhaustive Settings copy map** (do not reuse `agentStatusLine`, which is `null` for Idle/DriveNotConnected): all six states + `null`-from-stale (`Last beat N days ago`) + `null`-from-never-seen (`No agent linked` + `[Link agent]`). Calm register throughout, no alarm color. Optionally adopt the banner's focus/visibility 60s poll pattern (AgentStatusBanner.tsx) if the row should live-update; a server-rendered snapshot is acceptable for a settings screen if simpler.
  - [ ] "Link agent" button routes to `/link-agent`. Agent version row from the snapshot's `agent_version`, hidden when absent.

- [ ] **Task 7 — Sign out (product's first) + confirm dialog** (AC: 17)
  - [ ] Add a `signOut` server action (or client `supabase.auth.signOut()` + redirect) — nothing calls `signOut` today.
  - [ ] Reuse `DeleteModal`'s treatment (components/set-detail/DeleteModal.tsx) — portal-to-body scrim, `role="dialog" aria-modal`, focus-on-open + restore-on-close, Escape, Tab focus-trap — **stripped of destructive language/color**. Copy exactly: *"Sign out?" / "Your sets stay archived. The agent keeps capturing."* `[Cancel]` `[Sign out]`. Confirm → sign out → `/login`.

- [ ] **Task 8 — Providers: see + link + Add a passkey** (AC: 9, 10)
  - [ ] Render attached vs. unattached providers from the user's `identities`/`app_metadata.providers`. Attached → check; unattached → link action calling `supabase.auth.linkIdentity({ provider })`. **No unlink.** Provider-link failure renders inline under the row (Failure Register register), never a banner (State table §5).
  - [ ] Apple link gated on `NEXT_PUBLIC_APPLE_SIGNIN_AVAILABLE` (localhost can't exercise it); verify against the Vercel deploy.
  - [ ] "Add a passkey" reuses `registerPasskey()`; hidden on non-WebAuthn browsers. **Provisioning dependency:** `linkIdentity` requires "Manual linking" enabled on the Supabase project — add a `pre-launch-services-checklist.md` note if not already enabled (see Task 11).

- [ ] **Task 9 — Agent Rust: thread `agent_version` into the single beat** (AC: 20)
  - [ ] `heartbeat.rs`: add `agent_version` to `SetAgentStatusRequest` (field name must match the new RPC param), and add the param to `beat(...)` and `trait StatusClient::set_agent_status(...)`.
  - [ ] `sync_queue.rs`: at the single `beat_status`/`heartbeat::beat` call site (~lines 217–257 / the call at ~225), pass `crate::config::AGENT_VERSION`. **One call site, one param — no new timer/thread/loop** (preserve 3.9's beat-on-idle-drain contract).
  - [ ] Update the heartbeat unit tests / `StatusClient` mocks for the new signature. `cargo fmt`/`clippy`/tests green.

- [ ] **Task 10 — Middleware phone-on-file gate** (AC: 19)
  - [ ] In `web/lib/supabase/middleware.ts` `updateSession`, after the existing `getClaims()` verify: if the caller is authenticated (`claims.sub`) and the request path is **gated** and the `curfew_phone_on_file` cookie is **absent**, do one `djs.phone` read (reuse the `needsPhone`-style logic from `web/lib/supabase/phone-gate.ts`). Non-null → set `curfew_phone_on_file` on the response and continue; null → redirect to `/phone-required`. Cookie present → continue, no read.
  - [ ] Gated = the `(authenticated)` routes **+ `/link-agent`** (note `/link-agent` is a top-level route, not in the group — include it explicitly). Exempt `/phone-required`, `/login`, `/auth/*`, and static assets. Skip the gate entirely for unauthenticated requests (login-gating is out of scope).
  - [ ] Keep it inside the try/catch; a read failure must fail-open (least-blocking), consistent with `phone-gate.ts` swallowing errors → `false`.

- [ ] **Task 11 — Doc writebacks (spec §7)** (AC: context)
  - [ ] `deferred-work.md`: **close** the phone-invariant entry (line ~108, D-9) and the OAuth-passkey-nudge entry (line ~88, D-7 resolved-by-relocation) with dated notes pointing at this story; **leave** the `LiquidMetalButton` orphan (line ~17) open, appending a note that Settings was considered and **declined** a demo home (D-17).
  - [ ] `EXPERIENCE.md` Failure Register: add row *Settings change failed → "Change not saved — retry."*
  - [ ] `pre-launch-services-checklist.md`: add the `support@curfew.vip` inbox row (address currently receives no mail) and the Sentry project/DSN row (`web/` has no Sentry; agent has wiring, no prod DSN). Add the `linkIdentity` "Manual linking" Supabase-project toggle if needed (Task 8). Flag: no privacy-policy/terms page exists anywhere.
  - [ ] Verify epics.md:573 (2.11 AC-3 amendment) already reads correctly — do **not** re-add it.

- [ ] **Task 12 — Verification & gates** (AC: all)
  - [ ] `supabase db reset` + pgTAP (incl. additive-only guard) green; web lint/typecheck/tests green; agent fmt/clippy/tests green.
  - [ ] Real-browser walkthrough (per 3.7/3.8/3.9 precedent, live Supabase, 1440 + 375): edit DJ name → "Saved." fade; force a save failure → "Change not saved — retry." with value preserved; greeting reflects DJ name over OAuth name; avatar in nav + header (photo and monogram paths); Agent row speaks in every state incl. no-agent and stale; sign-out confirm → `/login`; provider see/link (Apple gated); phone gate redirects a phone-less session to `/phone-required` and the cookie skips the second read. Zero console errors; WCAG 2.2 AA (axe) on the new surface.
  - [ ] **One design/motion polish pass at the end** (D-19, [[feedback_polish_at_end]]) — run the CLAUDE.md audit cycle (ui-ux-pro-max / apple-design / web-design-guidelines / writing-guidelines) after functional completion, not during. **Folded in from the 2026-08-05 code review (Arjun's ruling):** re-run axe WCAG 2.2 AA on the redesigned surface (every contrast-bearing color changed post-verification), the 375px walkthrough (mobile width still unverified visually), and resolve the `/reset-password` mixed-material seam (inherits redesigned `st-main` while the addendum claims the auth ghost/Ember treatment).

### Review Findings (bmad-code-review, 2026-08-05 — Blind Hunter + Edge Case Hunter + Acceptance Auditor, diff = 4e8876a + eb47d36)

**Decision-needed:**

- [x] [Review][Decision] `updatePassword` accepts any live session — no recovery-context check (medium) — `web/lib/account/actions.ts:87` guards only session existence before `updateUser({ password })`; the comment claims "the recovery link already proved control of the inbox" but nothing verifies the session's AMR/recovery claim, so a hijacked or left-open session can set a new password without the old one (temporary session theft → durable takeover). Options: require a recovery-class session (check AMR) / accept as-is (standard Supabase pattern; no old-password API exists) / enable Supabase "secure password change" (nonce reauth).
- [x] [Review][Decision] `signOut` swallows failure then redirects with possibly-valid auth cookies (medium) — `web/lib/account/actions.ts:109-120`; on Supabase failure the DJ lands on `/login` believing they signed out while cookies may remain valid (false safety on shared machines), and the modal's "you're still signed in" error state is unreachable since the action never reports failure. The code comment argues for this deliberately. Options: keep as designed / return failure so the modal's error state becomes real.
- [x] [Review][Decision] Deploy-order trap: auto-updated agent vs un-migrated prod DB kills every heartbeat (medium) — `agent/src-tauri/src/heartbeat.rs:55-58` now always serializes `agent_version`; against a DB without migration `20260806090100` the RPC has no matching signature → 404 on every beat → agent reads stale/dead product-wide. The 3.4 auto-updater makes release ordering non-obvious. Options: hard release gate (migrate prod before shipping the agent build; checklist row) / code guard (`skip_serializing_if` + one-arg fallback retry).
- [x] [Review][Decision] AC-9 letter deviations, dev-decided but unruled (low) — `web/app/components/settings/ProvidersRow.tsx`: (a) unattached Email gets no link affordance (AC-9 says every unattached provider gets one); (b) Passkey attachment read from client-side `passkey.list()`, not `identities`/`app_metadata.providers`; (c) Apple renders a disabled "Link (coming soon)" button — matches login-page precedent but tension with D-13's "a disabled control invites clicking and then lies"; (d) post-link return path lands on `/auth/callback` → dashboard, not Settings, so the DJ never sees the updated row. All argued honestly in the Dev Agent Record; none has a ruling. Options per item: bless as dated AC amendment / change.
- [x] [Review][Decision] Redesign shipped without re-running the story's own DoD verification (low) — story addendum records "Mobile width unverified visually" and no axe re-run after eb47d36 retinted every contrast-bearing color (`web/app/settings.css`); the recorded axe/375 pass predates the redesign. Also cosmetic: `/reset-password` inherits the redesigned `st-main` material while the addendum claims it keeps the auth ghost/Ember treatment. Options: verify now / fold into the end-of-batch polish pass (already tracked as "phone-width glance owed").

**Rulings on the five decisions (Arjun, 2026-08-05, all resolved same-session):** (1) recovery-AMR check required → patched (`hasRecentInboxProof`, `web/lib/account/recovery.ts`); (2) sign-out failure surfaced → patched (action returns `{ok:false}`, modal error state now reachable); (3) heartbeat deploy-order → ruled a hard release gate, new `pre-launch-services-checklist.md` row (no permanent fallback code); (4) all four AC-9/AC-10 deviations blessed → dated amendment added at AC-10; (5) redesign re-verification → folded into the end-of-batch polish pass (Task 12), which also absorbs the `/reset-password` material seam.

**Patches (all 19 applied 2026-08-05, same session):**

- [x] [Review][Patch] Phone-gate cookie not user-scoped and survives sign-out — gate bypass for the next account in the same browser (high) [web/lib/supabase/middleware.ts:60-80, web/lib/account/actions.ts:109] — bind the cookie value to the user id (compare in middleware) and delete it in `signOut`.
- [x] [Review][Patch] Unallowlisted avatar host crashes every authenticated page (high) [web/lib/account/profile.ts:51-54, web/app/components/ui/Avatar.tsx:23, web/next.config.ts:14] — `user_metadata` URL (user-writable; Apple/other CDNs unallowlisted) flows raw into `next/image`, which throws server-side in the `(authenticated)` layout → whole shell 500s. Hostname-check against the allowlist, fall back to monogram.
- [x] [Review][Patch] Fail-open DB read error mints the session-long gate-pass cookie (medium) [web/lib/supabase/middleware.ts:62-80] — distinguish read-error from confirmed-phone (tri-state) and skip the `cookies.set` on error; fail-open was ruled per-request, not per-session.
- [x] [Review][Patch] Spec/docs contradict shipped code after the authorized redesign (medium) [_bmad-output/implementation-artifacts/3-10-settings.md D-2/D-17, _bmad-output/planning-artifacts/epics.md:764, deferred-work.md LiquidMetalButton note] — the epics design-session block was committed already-stale in this very diff ("no WebGL/shader material", "flat console rows") and deferred-work's decline-rationale is now false; add dated amendment notes mirroring the addendum's recorded verdict.
- [x] [Review][Patch] `updateDjName` counts UTF-16 units vs the DB's `char_length` (low) [web/lib/account/actions.ts:23] — use code-point length so ≤40-char emoji names aren't wrongly rejected.
- [x] [Review][Patch] Whitespace-only `full_name` blocks the `name` fallback (low) [web/lib/account/greeting.ts:16-22, web/lib/account/profile.ts:47-50] — trim-test metadata fields like `djName` already is.
- [x] [Review][Patch] Monogram breaks on astral-plane first character (low) [web/lib/account/profile.ts:101] — `source[0]` slices a surrogate pair; use code-point access.
- [x] [Review][Patch] Enter during IME composition saves a half-composed DJ name (low) [web/app/components/settings/DjNameRow.tsx:96-98] — guard on `!e.nativeEvent.isComposing`.
- [x] [Review][Patch] Type-back-to-saved early return doesn't invalidate the in-flight save (low) [web/app/components/settings/DjNameRow.tsx:43-46] — bump `seqRef` (and clear `saving`) in the early-return branch.
- [x] [Review][Patch] Overlapping autosaves can commit out of order server-side (low) [web/app/components/settings/DjNameRow.tsx:42-60] — client `seqRef` orders client state only; serialize saves (await/queue) so the DB can't keep the stale value while the UI says "Saved.".
- [x] [Review][Patch] Sign-out focus trap collapses while the action is pending (low) [web/app/components/settings/SignOutRow.tsx:26,64-74] — `FOCUSABLE` matches disabled buttons; append `:not(:disabled)` and contain when the list is empty or focus is on `body`.
- [x] [Review][Patch] Passkey-prompt cancel renders as a generic failure (low) [web/app/components/settings/ProvidersRow.tsx:94-107] — treat WebAuthn `NotAllowedError` (deliberate dismiss) as a no-op, not an error line.
- [x] [Review][Patch] `linkIdentity` success re-enables the button before the redirect lands (low) [web/app/components/settings/ProvidersRow.tsx:85-88] — keep `pending` set on the success path; the page is navigating away.
- [x] [Review][Patch] Version row can coexist with "No agent linked" (low) [web/app/components/settings/AgentSection.tsx:15-31, web/app/(authenticated)/settings/page.tsx About row] — hide version rows when `line.kind === "none"` (clock-skewed beat carries a version while the status claims no agent).
- [x] [Review][Patch] Repeated saves inside the 2s window announced to screen readers only once (low) [web/app/components/settings/SavedIndicator.tsx] — re-trigger the live region when `announce()` fires while already visible.
- [x] [Review][Patch] Failed `djs` read renders phone as "Not on file" (low) [web/lib/account/profile.ts:41-44] — the discarded `maybeSingle` error is indistinguishable from a null phone; surface unknown as "—", reserving §5's "Not on file" for a confirmed-null.
- [x] [Review][Patch] No Rust-side guard for the SQL 32-char `agent_version` cap (low) [agent/src-tauri/src/config.rs:30, agent/src-tauri/src/heartbeat.rs:57] — a long prerelease/build version string would make every heartbeat rejected; assert `AGENT_VERSION.len() <= 32` in the existing config test.
- [x] [Review][Patch] `set_agent_status` keeps default PUBLIC EXECUTE (low, hardening) [supabase/migrations/20260806090100_add_agent_status_agent_version.sql] — add `revoke execute … from public, anon` alongside the existing `grant to authenticated`; today the only defense is the in-function `auth.uid()` null check.
- [x] [Review][Patch] `agent_version` column lacks a CHECK; the 32-char cap lives only in the RPC (low) [supabase/migrations/20260806090100_add_agent_status_agent_version.sql] — `dj_name` got a column CHECK, the column rendered verbatim on Settings/About did not; add `char_length(agent_version) <= 32` for defense depth (migration not yet applied to prod).

**Dismissed as noise (6):** no `revalidatePath` after `updateDjName` (Next 16 dynamic router-cache staleTime 0 makes it moot); attached providers outside {email, google, apple} unrendered (only those are enabled); `support@curfew.vip` dead inbox (already a checklist provisioning row); reset-email resend without cooldown (Supabase rate-limits server-side); stale reset link landing a signed-in DJ on login error copy (deliberate calm-failure reuse, documented); `maskPhone` degenerate 1–4-digit inputs (unreachable via /phone-required validation).

## Dev Notes

### Spec-vs-code reconciliations (READ — the spec assumed a few things the code contradicts)

1. **Password reset infra does NOT exist (D-5).** The spec says "Send reset link" *"reuses the shipped reset infra"* — but grep finds **no** `resetPasswordForEmail`, no `/reset-password` route, no update-password UI. "Send reset link" is net-new and is **more than one button**: `resetPasswordForEmail(email, { redirectTo })` sends Supabase's recovery email, but the DJ then lands somewhere to set a new password, and that page doesn't exist. **See "Password reset — hidden scope" below for the ruling needed.**
2. **Middleware is `web/proxy.ts`, not `web/middleware.ts`** (Next 16 renamed convention), delegating to `updateSession` in `web/lib/supabase/middleware.ts`, which uses **`getClaims()`** (local JWT verify), **not** `getUser()` as the spec §4 states. The gate goes in `updateSession`; get the user id from `claims.sub`. It does **no** redirects today.
3. **No `linkIdentity`/`getUserIdentities` anywhere (D-6).** "Account linking" today is Supabase's automatic same-verified-email linking, configured at project level — there are no client `linkIdentity` calls. "See" is readable from the user object (`identities`/`app_metadata.providers`); "link" is net-new `supabase.auth.linkIdentity(...)` and requires **"Manual linking" enabled on the Supabase project** (provisioning dependency).
4. **`FloatingNav` does not fetch the user.** It's a pure `usePathname()` client nav with a static `UserCircle`. To show the real avatar without restructuring it, pass avatar data down from the server (`(authenticated)/layout.tsx`) as a prop — don't turn the nav into a data-fetcher.
5. **`agentStatusLine` returns `null` for `Idle` and `DriveNotConnected`** (silence-first, status-copy.ts). The Settings row "always speaks", so it needs its **own** copy map — reuse only `resolveAgentStatus`, not `agentStatusLine`.
6. **`resolveAgentStatus` returns `null` for stale/missing/unknown** (agentStatus.ts:92) — a fresh `Idle` returns `{state:"Idle"}`. The Settings row must distinguish resolver-`null` (→ `No agent linked` / `Last beat N days ago`) from a live `Idle`.
7. **`set_agent_status` currently takes only `sync_state text`** — adding `agent_version` is a **signature change** (drop old, create new, re-grant), not just a Rust edit.
8. **`djs.dj_name`, `agent_status.agent_version`, `VERCEL_GIT_COMMIT_SHA` usage, `signOut`** — all absent today (grep-confirmed). All net-new.

### Password reset — build the minimal COMPLETE flow (RULED, Arjun 2026-08-05)

D-5 says "reuses the shipped reset infra" but the codebase has **no** reset flow (grep: zero `resetPasswordForEmail`, no reset route, no set-new-password UI). **Ruling: build the minimal complete flow** — not an email-only button that lands on nothing:
- A server action calling `resetPasswordForEmail(email, { redirectTo: ${origin}/auth/confirm?next=/reset-password })` (mirror the `origin`/`emailRedirectTo` shape in login/actions.ts:34).
- A small landing route (`/reset-password`, or reuse `/auth/confirm`'s recovery type) with a **single new-password field** that actually sets the password via `supabase.auth.updateUser({ password })` and lands the DJ back in the app.
- **Rejected:** email-only with no set-password UI — the "Send reset link" button would lie. Do not ship it.

### Key files (exact paths from the code map)

**Web — build/replace:**
- `web/app/(authenticated)/settings/page.tsx` — the stub to replace (server component, `(authenticated)` group, no `"use client"`).
- `web/app/components/nav/FloatingNav.tsx` — swap `UserCircle` (import line 7; NAV item lines 42–50; rendered separately at ~296–381). Test: `FloatingNav.test.ts`.
- `web/app/(authenticated)/layout.tsx` — renders `{children}` + `<FloatingNav />`; candidate place to fetch avatar and pass it down. Notes it has no auth-gating.
- `web/app/(authenticated)/dashboard/page.tsx` — `getFirstName()` (lines 23–39), greeting precedence wiring.
- `web/next.config.ts` — add `images.remotePatterns` (currently only `transpilePackages`; do **not** add `output:'export'`).
- `web/package.json` — bump `version` off `0.0.0`.

**Web — reuse (do not reinvent):**
- `web/lib/sets/agentStatus.ts` — `resolveAgentStatus`, `AGENT_SYNC_STATES`, `STALE_AFTER_MS`, `AgentStatusSnapshot`.
- `web/app/(authenticated)/dashboard/status-copy.ts` — `agentStatusLine` (reference only — insufficient for the always-speaks row) + the 4-state copy to stay consistent with.
- `web/app/components/dashboard/AgentStatusBanner.tsx` — `POLL_INTERVAL_MS`, focus/visibility poll pattern if live-updating.
- `web/lib/sets/index.ts` — `getAgentStatus()` (lines 77–101); add the `djs`/profile read + `updateDjName` action here or a sibling.
- `web/app/components/auth/GhostInput.tsx` — the ghost editable row (props include `maxLength`, `defaultValue`, `error`).
- `web/app/components/set-detail/DeleteModal.tsx` — the one true confirm-modal (portal, focus-trap, Escape, restore-focus, calm-copy conventions) to reuse for sign-out.
- `web/lib/supabase/phone-gate.ts` — `needsPhone(supabase, userId)` for the middleware read.
- `web/lib/supabase/middleware.ts` (`updateSession`) + `web/proxy.ts` (matcher) — the gate home.
- `web/app/login/page.tsx` — `signInWithOAuth` (117–120), `registerPasskey` (291), passkey list (264), the Apple HTTPS comment + `NEXT_PUBLIC_APPLE_SIGNIN_AVAILABLE` gate (41–47).
- `web/app/login/actions.ts` — `origin` derivation + `emailRedirectTo` shape to mirror for reset (34).
- `web/app/link-agent/page.tsx` — the `getUser()`→`redirect("/login")` guard pattern; `/link-agent` is the "Link agent" destination.

**Tokens/CSS:** `web/app/tokens.css` — `--color-on-surface-variant #c4c8d5`, `--color-outline-variant #434a5a`, `--radius-full 9999px`, surface-container ramp, `--color-primary` (Ember rose, used sparingly). `web/app/globals.css` — `.dz-agent-status`, `.floating-nav-*`, the `sd-modal-*` blur.

**Supabase:** `supabase/migrations/` — mirror `20260727192439_add_djs_phone_column.sql` for `dj_name`; extend `20260805120000_create_agent_status.sql`'s table + RPC for `agent_version`. `create_djs_table.sql` has `djs_select_own` + the `handle_new_dj()` trigger.

**Agent (Rust):** `agent/src-tauri/src/heartbeat.rs` — `beat()` (163), `StatusClient` trait (86), `SetAgentStatusRequest` (49–52). `agent/src-tauri/src/sync_queue.rs` — `beat_status` (217–257), call at ~225, `MAX_INTERVAL` (38). `agent/src-tauri/src/config.rs:30` — `AGENT_VERSION = env!("CARGO_PKG_VERSION")`. `agent/src-tauri/Cargo.toml:3` — `version = "0.1.0"`. `agent/src-tauri/src/tray.rs` — `TrayState::wire_state` (96); **the 6-state enum is untouched by this story** — only the separate `agent_version` field is added.

### Regression-safety (must not break)

- **3.9 heartbeat contract:** one beat per `sync_queue` drain pass, fire-and-forget, never gated on subscription; adding `agent_version` must not add a timer/thread/loop or change beat cadence. The 6-state wire enum stays byte-identical across `tray.rs::wire_state` / the SQL allow-list / `agentStatus.ts::AGENT_SYNC_STATES` (AD-3/AD-20).
- **Dashboard banner** must still resolve identically — you're adding a *new* consumer of `resolveAgentStatus`, not changing it.
- **Phone gate** must not break existing `auth/confirm` / `auth/callback` phone redirects (they stay; the gate is a third, lazy layer for the bypass paths — plain `signIn`, passkey, abandon-and-return). It must fail-open on read error and never gate unauthenticated requests.
- **Additive-only migration guard** (CI) must pass — both new migrations are pure `add column` / signature-add.
- **`(authenticated)` group has no auth-gate** — the new Settings page must self-guard with `getUser()`→`/login`.

### Testing standards

- **Supabase:** pgTAP (`supabase db reset` runs the suite), incl. the additive-only guard. Mirror the `agent_status` and `djs_phone` test shapes.
- **Web:** colocated `*.test.ts(x)` (Vitest-style, per FloatingNav.test.ts / tokens.test.ts). Cover greeting precedence, the resolver→Settings copy mapping (all 6 states + both null cases), autosave success/failure result handling, and the gate predicate (which paths are gated/exempt).
- **Agent:** `cargo test` incl. the `config.rs` version test; update `StatusClient` mocks for the new signature.
- **E2E:** real-browser walkthrough at 1440 + 375 (Playwright, live Supabase) per Task 12 — the project's established DoD for a new screen. axe-core WCAG 2.2 AA on the new surface.

### Project Structure Notes

- Story file lives at `_bmad-output/implementation-artifacts/3-10-profile-settings-screen.md` (this file); the **design working doc** is the separate `3-10-settings.md` — do not conflate. A git worktree already exists at `.claude/worktrees/story-3-10-profile-settings` (branch `story/3-10-profile-settings`) — likely the intended dev workspace.
- New web account code has no established home; `web/lib/account/` or extending `web/lib/sets/index.ts` are both consistent with the repo. Settings UI sub-components under `web/app/components/settings/` mirrors the `dashboard/` and `set-detail/` component grouping.

### References

- [Source: _bmad-output/implementation-artifacts/3-10-settings.md] — full design spec, D-1…D-19, §4 gate mechanism, §5 states, §6 schema deltas, §7 owed writebacks (authoritative).
- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.10 (754–786)] — original AC-1…AC-5 + ⚑ RULED phone-gate + ⚑ design-session block.
- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.11 (560–573)] — AC-3 amended (delete-link CUT), AC-4 still stands (App-Store trigger).
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — phone-invariant entry (~108, closes via D-9), OAuth-passkey-nudge (~88, closes via D-7), LiquidMetalButton orphan (~17, stays open + declined note).
- [Source: .../ux-designs/.../EXPERIENCE.md] — Voice/Failure Register, "Settings saved" + "Phone number required" State Patterns, Avatar Component Pattern, WCAG floor; new Failure Register row owed.
- [Source: .../DESIGN.md] — Obsidian tokens, Ghost input / calm-modal / no-glass-on-a-list conventions.
- [Source: 3-9 shipped work] — `resolveAgentStatus`/`agentStatusLine`/`AgentStatusBanner`; `agent_status` migration + `set_agent_status` RPC; the 3-copy wire-state contract (AD-20).

## Dev Agent Record

### Agent Model Used

Claude Fable 5 (claude-fable-5), Claude Code — dev session 2026-08-05/06.

### Debug Log References

- `supabase db reset` + `supabase test db` — 96 pgTAP tests green (incl. 6 new dj_name cases, 6 new agent_version cases); additive-only guard passes both new migrations.
- Web: `tsc --noEmit` clean, `eslint` clean, `vitest run` 155/155 (incl. new greeting/phone-mask/agent-copy/gate-predicate suites), `next build` clean.
- Agent: `cargo fmt` / `cargo clippy --all-targets` (0 warnings) / `cargo test` 358+ green.
- Live PostgREST check: two-field beat (`sync_state`+`agent_version`) → 204; legacy one-field beat → 204 and honestly nulls the stored version.
- Real-browser walkthrough (Playwright, live local Supabase, 1440 + 375): see Completion Notes.

### Completion Notes List

- **Browser walkthrough verified end-to-end** (1440 + 375, live Supabase): DJ-name autosave → "Saved." appears on the heading baseline and fades ~2s; forced network failure (fetch override) → "Change not saved — retry." inline, typed value preserved, Retry saves; dashboard greeting shows dj_name over OAuth metadata; monogram avatar renders in nav + header (photo path needs a real Google session — verify against the Vercel deploy); Agent row speaks in fresh ("Up to date · moments ago"), stale ("Last beat 4 days ago", calm color, version rows still shown), and never-seen ("No agent linked", version rows hidden incl. About) states; sign-out dialog carries D-16's exact copy, focus-on-open/Escape/restore-focus verified, confirm lands on /login; password reset verified through the REAL email (Mailpit → GoTrue verify → /auth/reset → /reset-password → new password set → sign-in with the new password works); phone gate redirects a phone-less plain-signIn session on /dashboard AND /link-agent, and after /phone-required completes, the httpOnly session cookie is set and gated routes pass. Zero console errors on the new surfaces; axe (WCAG 2.2 AA) → 0 violations on /settings and /reset-password.
- **Password reset (D-5 ruling honored):** built the minimal COMPLETE flow — `sendPasswordReset` server action → recovery email → `/auth/reset` route handler (a route handler, not a page, because the code-exchange must persist session cookies) → `/reset-password` single-field page → `updateUser({ password })` → back to /settings. `${origin}/auth/reset` passes the local allow-list (origin-scoped); prod Dashboard needs the URL added — checklist row filed.
- **Deviations from D-6's letter, for honesty:** Email renders attached-or-absent with NO link affordance when unattached (`linkIdentity` is OAuth-only; a "+ Link" that cannot work would lie). Apple's link button is disabled with "(coming soon)" under the same `NEXT_PUBLIC_APPLE_SIGNIN_AVAILABLE` gate as login. Google/Apple linkIdentity redirects return through `/auth/callback` → dashboard (no settings-return plumbing; acceptable, noted). Passkey attachment is read client-side via `passkey.list()` (same as login), not from `app_metadata`.
- **`linkIdentity` provisioning:** `enable_manual_linking = true` flipped in local config.toml (with comment); prod Dashboard toggle filed in the checklist. The actual Google/Apple link ceremony needs real provider credentials — verify against the Vercel deploy.
- **GhostInput reuse, adapted:** the DJ-name row reuses the ghost-input CSS treatment (`auth-ghost-field-input`) on a raw input labeled by the row's own left label, rather than mounting `GhostInput` (whose stacked label-above layout would fight the console-row grammar).
- **Agent copy map:** new exhaustive `settingsAgentLine` (all 6 states + stale-null + never-null; unrecognized-state fresh beats render as "Last beat moments ago", never the raw string). Failure lines verbatim from status-copy.ts; DriveNotConnected uses EXPERIENCE.md's "Archive unreachable — reconnect drive to resume." Server-rendered snapshot, no polling (story allowed the simpler choice).
- **`set_agent_status` upgrade:** old single-param signature dropped + re-created with defaulted `agent_version` (both call shapes verified live); added a 32-char length cap on the version (same cannot-poison discipline as the state allow-list); `excluded.agent_version` on conflict so a version-less beat clears a stale version. The Rust/SQL/TS contract test now reads the allow-list from the NEW migration file.
- **Migrations:** `dj_name` has a column CHECK (≤40) born with the column; grant stays column-scoped (`grant update (dj_name)`) — no new RLS policy needed (the existing owner UPDATE policy scopes rows; the GRANT scopes columns; pgTAP proves created_at remains un-updatable).
- **Phone gate:** lives in `updateSession` after `getClaims()`, keyed on `claims.sub`; gated = the 5 (authenticated) screens + `/link-agent` (pure `isPhoneGatedPath` predicate + tests); redirect carries refreshed auth cookies; fail-open via `needsPhone`'s own error-swallowing; httpOnly session cookie so each new session re-verifies against the DB.
- **Not in this diff:** `_bmad-output/implementation-artifacts/3-4-format-drift-resilience-backfill.md` acquired uncommitted "Review Findings" content mid-session from something outside this dev session — left untouched, flagged to Arjun.
- **Polish pass (D-19) run at the end:** web-design-guidelines (added: `autocomplete="nickname"`+`name` on the DJ input, `:focus-visible` rings on all settings buttons/links, `overscroll-behavior: contain` on the scrim, `touch-action: manipulation`, reduced-motion instant Saved-toggle, mobile dock clearance) and writing-guidelines (copy passes within the product's locked Failure-Register register; its em-dash voice deliberately overrides the generic no-em-dash rule). ui-ux-pro-max/apple-design were not re-run as ideation — the visual/motion design was locked by the 19 D-# rulings; the build follows them and the existing token/registers throughout.

### File List

**Supabase**
- supabase/migrations/20260806090000_add_djs_dj_name_column.sql (new)
- supabase/migrations/20260806090100_add_agent_status_agent_version.sql (new)
- supabase/tests/djs_isolation_test.sql (+6 cases)
- supabase/tests/agent_status_isolation_test.sql (+6 cases)
- supabase/config.toml (enable_manual_linking = true)

**Web — new**
- web/lib/account/profile.ts, actions.ts, greeting.ts (+test), phone-mask.ts (+test)
- web/lib/supabase/phone-gate.test.ts
- web/app/settings.css
- web/app/components/ui/Avatar.tsx
- web/app/components/settings/{AgentSection.tsx, DjNameRow.tsx, PasswordResetRow.tsx, ProvidersRow.tsx, SavedIndicator.tsx, SignOutRow.tsx, agent-status-copy.ts (+test)}
- web/app/auth/reset/route.ts
- web/app/reset-password/{page.tsx, reset-password-form.tsx}

**Web — modified**
- web/app/(authenticated)/settings/page.tsx (stub → real page)
- web/app/(authenticated)/layout.tsx (fetch NavAvatar, pass to nav)
- web/app/(authenticated)/dashboard/page.tsx (greeting precedence via resolveFirstName)
- web/app/components/nav/FloatingNav.tsx (avatar prop + swap on the settings item)
- web/lib/sets/index.ts (select agent_version), web/lib/sets/agentStatus.ts (row type), web/lib/sets/agentStatusContract.test.ts (allow-list source file)
- web/lib/supabase/middleware.ts (phone gate), web/lib/supabase/phone-gate.ts (cookie const + predicate)
- web/next.config.ts (images.remotePatterns), web/package.json (0.1.0), web/app/globals.css (@import settings.css)

**Agent (Rust)**
- agent/src-tauri/src/heartbeat.rs (agent_version through request/trait/beat + tests)
- agent/src-tauri/src/sync_queue.rs (call site passes config::AGENT_VERSION)

**Docs**
- _bmad-output/implementation-artifacts/deferred-work.md (2 closed, 1 declined-note)
- _bmad-output/implementation-artifacts/pre-launch-services-checklist.md (4 new rows + terms/privacy re-confirm)
- _bmad-output/planning-artifacts/ux-designs/.../EXPERIENCE.md (Failure Register row)
- _bmad-output/implementation-artifacts/sprint-status.yaml (3-10 → review)

---

## Addendum — on-theme visual redesign (Arjun, 2026-08-05)

Arjun's review verdict on the shipped D-2/D-17 "quietest surface" treatment:
off-theme ("barely on theme… doesn't look like a good ui/ux experience").
The flat-console material was replaced the same session; the console-row
GRAMMAR (label left / value right, calm copy, one page-level "Saved.") and
all behavior/a11y survived unchanged.

What changed (visual layer only):
- Ground: Silk backdrop mounted (same `SilkBackdrop`/`.dz-silk` as dashboard
  + set detail — the 3.7 parity ruling now covers all three surfaces).
- Sections: flat hairline groups → `dz-shell` liquid-glass cards at
  set-detail's 28px radius (`.st-card`), with a 55ms-stagger rise-in on the
  liquid ease (reduced-motion: none).
- Voice: Inter/M3 tokens → Hanken Grotesk + abyss text ramp; section labels
  in the sd-eyebrow mono register; page title in the dz-greeting register.
- Accent: Ember → glacial cyan on this surface (focus rings, Saved., ghost-
  input focus, provider ✓, modal confirm) — matching the dashboard's cool
  direction; error stays --color-error.
- Actions: text buttons → shell-fill chips with hover raise + scale(0.97)
  press; DJ-name input decoupled from auth-ghost-field-input into
  `.st-name-input` (abyss retint) + placeholder "Add your DJ name".
- Modal: spotlight material kept; confirm button now accent-filled; panel
  materializes (scale 0.96 + fade, center origin).

Verified: 155/155 vitest (incl. no-hardcoded-colors guard), tsc clean,
live-checked in Chrome at desktop width (rail, cards, focus states, modal).
Mobile width unverified visually (window wouldn't resize) — the <480px
rules carry over the previous wrap behavior; worth one phone-width glance
in the next review pass. Reset-password page untouched (keeps the auth
ghost/Ember treatment).
