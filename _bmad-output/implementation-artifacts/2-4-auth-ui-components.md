---
baseline_commit: e9d52ff34e12cb10dc6a4903744b8c189b8640e4
---

# Story 2.4: Auth UI components

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a DJ,
I want polished auth components that match the design system,
so that signing in feels native to Curfew's console voice.

## Acceptance Criteria

1. **Given** the auth form, **Then** ghost-style inputs (transparent, bottom-border, mono values, label-sm labels) render. *(UX-DR3)*
2. **Given** passkey enable, **Then** the Biometric Anchor row (fingerprint badge + radio indicator) renders. *(UX-DR3)*
3. **Given** Google/Apple sign-in, **Then** each uses its official button lockup and mandated colors (the one sanctioned palette exception). *(UX-DR3 — see Dev Notes "Corrected understanding" for the current, superseding word on "no pills or gradients" for the generic Button component.)*
4. **Given** keyboard-only use, **Then** the full auth flow is operable **And** focus rings use the primary-accent glow at AA contrast. *(UX-DR21 — epics.md's literal wording, "the lavender glow," is stale phrasing carried over from the original Electric Lavender palette through the Ice-Cyan revision; the operative requirement is whatever `--color-primary` currently resolves to — see Dev Notes.)*
5. **Given** the auth screen's three sign-in options, **Then** Google/Apple sign-in render as the prominent, top-of-form primary CTAs, **and** the email+password form is collapsed by default behind a "Use email instead" disclosure toggle — fully functional when expanded, just not the default visual path. *(New AC — Arjun ruling, 2026-07-28, this story's creation session: "do we even need those \[email\] buttons now? I feel like sign up with google and/or apple is enough" → resolved to re-ranking visual hierarchy, not removing the path. Story 2.3a's backend/logic is unchanged. Not yet reflected in epics.md prose — doc-sync owed, non-blocking, same pattern as this project's other same-session rulings.)*
6. **Given** this story makes the Biometric Anchor a *functional* passkey-enable control (AC-2), **Then** passkey/WebAuthn is provisioned on the **prod** Supabase project (`[auth.passkey]`/`[auth.webauthn]`, `rp_id` set to a real HTTPS origin — not `localhost`), **and** a real passkey register + sign-in is human-verified against prod. *(DoD prereq pinned in epics.md's Story 2.4 blockquote, owner-assigned 2026-07-28 during 2.3b's 2nd review — see `deferred-work.md` and `pre-launch-services-checklist.md` §4. Closing this requires a real HTTPS origin to set as `rp_id`, which doesn't exist yet — `pre-launch-services-checklist.md` §1 shows Vercel deploy "Not started." Arjun ruling, 2026-07-28, this story's creation session: fold a minimal `vercel link` + deploy into this story rather than defer verification — see Task 3.)*

[Source: _bmad-output/planning-artifacts/epics.md#Story 2.4, lines 447-460]

### Scope boundaries (binding — read before writing code)

- **In scope:** a shared, reusable auth-component library (Ghost Input, Button, Biometric Anchor, Google/Apple Sign-In Button) consumed by the existing `/login` and `/phone-required` routes; the AC-5 hierarchy restructure (OAuth primary/prominent, email secondary/collapsed); the AC-4 keyboard/focus-ring accessibility pass; five pre-flagged visual/UX-polish debt items already assigned to this story by name in `deferred-work.md` (enumerated in Task 5); and the AC-6 passkey-prod-provisioning + minimal Vercel deploy.
- **Out of scope — do not touch:** any auth *logic* (`web/app/login/actions.ts`, `auth-copy.ts`, `auth-state.ts`, `web/app/auth/{callback,confirm}/route.ts`, `web/lib/supabase/*`) — 2.3a/2.3b/2.3c/2.3d's server actions, copy, and state shapes are correct and unchanged; this story only changes how existing handlers are triggered from markup/style. No DB/migration/RLS change (no AD-\*, this is UI-only). No Landing-page overlay integration — Epic 6 Story 6.4 is the story that hosts these components on the logged-out Landing page (epics.md line 924); this story only touches the standalone `/login` and `/phone-required` routes, but **should** build the components in a shared, importable location so 6.4 doesn't rebuild them (see Project Structure Notes). No Tailwind/shadcn introduction — that's flagged as Epic 3 pre-work in the UX inspiration notes, not this story. No `curfew.vip` custom-domain DNS wiring for the Vercel deploy (Task 3) — a bare `*.vercel.app` origin is sufficient for AC-6's `rp_id`; the custom domain is a separate, larger checklist item.
- **Doc-drift note (informational, not blocking):** `web/app/tokens.css` currently sits **uncommitted** (as of `baseline_commit`) with a same-day revision (2026-07-28) from the "Ice Cyan" palette to a new "Ember" warm-rose palette, plus a radial gradient now applied to **all** primary buttons app-wide (per an inline comment: "per Arjun 2026-07-28, promoted from a landing-only CTA") and a new Motion-token layer. `DESIGN.md` and `epics.md`'s AC-3 text ("no pills or gradients") still describe the pre-Ember state. Per `tokens.css`'s own header comment ("Source of truth: ... DESIGN.md" — read as "the token *values* are downstream of DESIGN.md's intent, but where the file has already been hand-revised ahead of the doc, the file wins for implementation," the same precedent Story 2.2's Ice-Cyan revision set), **build against the current `tokens.css` values, not the stale DESIGN.md/epics.md prose.** In practice this mostly doesn't collide with this story's own components: Google/Apple buttons use their own mandated official colors regardless (never Curfew's palette), and the Secondary Button variant (used for the now-de-emphasized email path, AC-5) was always flat/text-only/no-fill in DESIGN.md — it never had a "no gradient" rule to violate. If a generic Primary Button surface is needed anywhere in this story (e.g., a "Continue to Curfew" CTA), source its gradient from the live `--btn-gradient-*` tokens. Do not rewrite DESIGN.md/epics.md prose as part of this story — flag the drift in the Dev Agent Record if it becomes load-bearing, matching how Story 2.2's own palette-prose lag was closed in a later code-review pass, not the original story.
- **Passkey UX scope note:** DESIGN.md's Biometric Anchor spec ("Enable Passkey" / "Biometric bypass" copy) most directly matches the existing post-signin `EnablePasskeyPrompt`'s "Enable Passkey" opt-in flow (AC-2's literal subject). The main login form's separate, pre-existing "Sign in with Passkey" button (an *existing*-passkey login, not an opt-in) has no DESIGN.md-named visual spec of its own. Reuse the Biometric Anchor's visual pattern (bordered row, badge, radio indicator) for both entry points, adapting only the two-line label copy between "Sign in with Passkey" / "use an existing passkey" and "Enable Passkey" / "Biometric bypass" — this is an implementation judgment call this story is making explicit, not a spec ambiguity to escalate further.

## Tasks / Subtasks

- [ ] **Task 1 — Shared auth-component library + brand tokens (AC: 1, 2, 3)**
  - [ ] 1.1 Create `web/app/components/auth/` — no `components/` directory exists yet in this repo; this is a deliberate new shared location (not a per-route co-located file) specifically because Epic 6 Story 6.4 needs to import the same components onto the Landing overlay later (epics.md line 924).
  - [ ] 1.2 `GhostInput.tsx` — transparent background, bottom-border only, `text-label-sm` label positioned above the field, value text in `text-mono-data`. Replaces the ad hoc `fieldStyle`/`inputStyle` constants in `web/app/login/page.tsx` (both email and password fields) and `web/app/phone-required/phone-form.tsx` (both files' own comments already mark this as "Story 2.4's job"). *(DESIGN.md#Input Fields)*
  - [ ] 1.3 `Button.tsx` — Primary and Secondary variants. Secondary: text-only, Geist-mono label, no fill (per DESIGN.md, unaffected by the gradient doc-drift above). Primary: source colors from the live `--btn-gradient-*`/`--color-primary` tokens, small `rounded.lg` radius, no pill shape. Replaces the ad hoc `buttonStyle` constant in both files above.
  - [ ] 1.4 Add the OAuth-brand color custom properties `web/app/tokens.css` is actually missing to `tokens.css` — **required**, not optional: `no-hardcoded-colors.test.ts` bans literal color words (including `black`/`white`) and hex/rgb literals in every `.ts`/`.tsx`/`.css` file except `tokens.css` itself, so even DESIGN.md's "sanctioned palette exception" colors must be tokenized, not inlined in component files. Note DESIGN.md's Google spec already reuses an **existing** token for the fill ("near-black fill matching `{colors.surface-container-high}`") — don't invent a duplicate; only its light-grey border and (per DESIGN.md, literal white, not the slightly-off-white `on-surface`) label likely need new tokens. Apple's spec calls for true black — Curfew's own `surface`/`background` is blue-black (`#101319`), not pure black, so Apple's fill does need a new literal-black token to read as Apple's actual official variant, not a Curfew-tinted one. Additive-only edit to `tokens.css`; do not touch the Ember/gradient/Motion sections above it.
  - [ ] 1.5 `GoogleSignInButton.tsx` — Google's dark/filled theme (not the light variant), full-color "G" logomark, white "Sign in with Google" label, `rounded.lg`. **Verify against Google's current published Identity Services branding guidelines before implementation** — DESIGN.md flags its own spec as `[ASSUMPTION]`, sourced from general knowledge, not the live spec. **Logomark gotcha:** Google's "G" is multi-color (four brand colors) — if implemented as inline JSX SVG with hardcoded `fill="#..."` attributes, it **will** trip `no-hardcoded-colors.test.ts` (which scans raw `.tsx` source for hex/named-color literals with no exemption for SVG markup). Either ship the logomark as a static asset under `web/public/` referenced via `<img>`/`next/image` (no color literals in `.tsx` at all), or tokenize each brand color in `tokens.css` and reference them via CSS `var()` inside the inline SVG — do not silently add the file to the test's `EXCLUDED_FILES` set without flagging that decision in the Dev Agent Record, since that set's existing two entries are narrowly justified (token-definition file, font file) and a third exemption should be a deliberate, documented call, not a quiet workaround.
  - [ ] 1.6 `AppleSignInButton.tsx` — Apple's black button variant, white Apple logomark, "Sign in with Apple" label in Apple's mandated system-font rendering (not Hanken Grotesk/Inter), `rounded.lg`. **Verify against Apple's current Human Interface Guidelines before implementation** — same `[ASSUMPTION]` flag in DESIGN.md. Same logomark gotcha as Task 1.5 applies if inlined as SVG (Apple's mark is single-color/white here, so it's a smaller surface area, but the same hardcoded-color-literal risk still applies).
  - [ ] 1.7 `BiometricAnchor.tsx` — bordered row (`surface-container-low` fill, 1px `outline-variant`-at-30%-opacity border, hover fills to `surface-container-high`), left `rounded.full` badge (`primary`-at-20%-opacity ring, filled fingerprint icon in `primary`), two-line label (`label-sm` primary line + smaller uppercase `outline`-colored secondary line), right circular radio indicator (`outline-variant` ring at rest, fills solid `primary` on hover). Accepts label-copy props so it can render both entry points named in Scope boundaries above without duplicating the component.

- [ ] **Task 2 — Auth-screen hierarchy restructure (AC: 5)**
  - [ ] 2.1 In `web/app/login/page.tsx`, render `GoogleSignInButton`/`AppleSignInButton` (and the passkey-sign-in `BiometricAnchor` entry) as the prominent top-of-form content.
  - [ ] 2.2 Collapse the email+password `<form>` behind a "Use email instead" disclosure toggle (Secondary `Button` or plain text link), collapsed by default. Expanding it reveals the exact same fields wired to the same `signInAction`/`signUpAction` — do not change `actions.ts`, `auth-copy.ts`, or `auth-state.ts`.
  - [ ] 2.3 Apply `GhostInput` to `web/app/phone-required/phone-form.tsx`'s phone field (that file's own comment already defers this to Story 2.4) and restyle its submit button with the shared `Button` component.

- [ ] **Task 3 — Passkey prod provisioning + minimal Vercel deploy (AC: 6)**
  - [ ] 3.1 `vercel link` the `web/` app to a new Vercel project and deploy, producing a real `*.vercel.app` HTTPS origin. **Likely needs Arjun directly** — `vercel login`/`link` typically requires interactive browser OAuth a coding agent cannot complete; check for a `VERCEL_TOKEN` env var enabling non-interactive auth first, and if unavailable, flag this step for Arjun exactly as Story 2.1's `PROVISIONING.md` and 2.3d's runbook precedent flagged their own account-level, agent-unreachable steps — do not claim this step done if it wasn't actually run.
  - [ ] 3.2 Set `NEXT_PUBLIC_APPLE_SIGNIN_AVAILABLE=true` on the new Vercel project's production environment variables — this closes the dependency `pre-launch-services-checklist.md` §1 already flagged ("once this deploy happens") from 2.3b's 2nd review, since this story's deploy is "this deploy."
  - [ ] 3.3 On the **prod** Supabase Dashboard (project `jmitbnrofacxwsbwuxzs`), enable `[auth.passkey]`/`[auth.webauthn]` and set `rp_id` to the new deploy's host (not `localhost`) — mirrors how 2.3b/2.3d provisioned OAuth/email on the same Dashboard. If browser automation has an authenticated Supabase Dashboard session available, drive it directly (2.3b's precedent); otherwise flag for Arjun.
  - [ ] 3.4 Human-verify: a real passkey **register** (via the restyled `EnablePasskeyPrompt`/`BiometricAnchor`) and a real passkey **sign-in**, against prod, at the new deploy's real URL. Record the actual verification steps taken in the Dev Agent Record — do not claim this human-verified if it wasn't actually driven end-to-end (established standing rule, sprint-status `action_items` ai-8).
  - [ ] 3.5 Update `pre-launch-services-checklist.md` §1 (Vercel deploy row) and §4 (passkey row) to reflect the resolved state, and close the corresponding `deferred-work.md` entry.

- [ ] **Task 4 — Accessibility pass (AC: 4)**
  - [ ] 4.1 Full keyboard operability across the restructured flow: the "Use email instead" disclosure toggle, both OAuth buttons, both Ghost Inputs, the Biometric Anchor's radio indicator, and all submit buttons must be reachable and operable via Tab/Shift+Tab/Enter/Space alone.
  - [ ] 4.2 Focus-ring glow at AA contrast: compute the effective color of the primary-accent glow at ~20% opacity (per UX-DR21) composited over both `--color-surface` and `--color-surface-container`, and assert AA contrast (≥4.5:1) for each — add a test that imports/reuses `tokens.test.ts`'s existing `contrastRatio()` helper rather than duplicating the luminance math.
  - [ ] 4.3 Fix the disabled "Sign in with Apple" button's accessibility gap (`deferred-work.md`, flagged in 2.3b's 3rd review): today its only explanation is a `title` attribute, which screen readers expose inconsistently and touch devices (incl. iOS Safari) can't reach at all. Ensure the "(coming soon)" text already in the button's visible label is sufficient on its own, or add explicit `aria-disabled` + visible copy so the reason for disablement doesn't depend on `title`.

- [ ] **Task 5 — Close pre-flagged polish debt (`deferred-work.md`, owned by this story)**
  - [ ] 5.1 The ad hoc `inputStyle`'s hardcoded `fontSize: "16px"` (flagged in 2.3a's review) is superseded by `GhostInput` (Task 1.2) — confirm the new component sources its font size from a `tokens.css` custom property, not a literal.
  - [ ] 5.2 Reset `oauthError` and the stale `signInState`/`signUpState` `useActionState` error when the user toggles Login/Signup mode or submits any form (flagged in 2.3a's and 2.3b's reviews as the same class of cosmetic gap) — a stale failure message from one mode/method must not persist across an unrelated interaction.

- [ ] **Task 6 — Tests + full gate**
  - [ ] 6.1 New pure-logic unit tests only where real pure logic exists (e.g., the AC-4 contrast check, any disclosure-toggle state helper worth factoring out) — do not force a test into existence for markup-only presentational components, matching the testing philosophy every 2.x story to date has held to.
  - [ ] 6.2 Confirm all new/modified files pass `no-hardcoded-colors.test.ts` unmodified (it auto-scans every `.ts`/`.tsx`/`.css` under `web/app`, so new files under `web/app/components/auth/` are covered without editing the test itself).
  - [ ] 6.3 Manual keyboard-only walkthrough of the full restructured flow (login, signup, passkey sign-in, passkey enable, phone-required) — record what was actually exercised in the Dev Agent Record.
  - [ ] 6.4 Repo-root gate: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` — must be actually run on this machine (standing Epic-2+ rule, sprint-status `action_items` ai-8). Confirm no regression in `shared/`'s, `agent/`'s, or `web/`'s existing test counts.

## Dev Notes

### Architecture compliance

- No new Architecture Decision (AD-\*) and no schema/RLS change — this story is UI-only, consuming Story 2.3a/2.3b/2.3c's already-correct auth logic unchanged. AR-10 (one account across providers, secure agent token) is already satisfied by prior stories and not re-touched here.
- Governing UX-DR entries: UX-DR1 (Obsidian token system — this story must consume tokens only, never hardcode), UX-DR3 (the auth components this story exists to build), UX-DR21 (accessibility floor — AC-4).

### Corrected understanding vs. epics.md / DESIGN.md (as of this story's creation, 2026-07-28)

- **Palette/gradient drift:** see Scope boundaries' "Doc-drift note" above — build against the live, uncommitted `tokens.css` (Ember palette, app-wide primary-button gradient, new Motion-token layer), not the still-Ice-Cyan/no-gradient prose in `DESIGN.md`/`epics.md`. This mostly doesn't collide with this story's concrete components (OAuth buttons use their own mandated colors; the Secondary button variant used for the email path was always flat).
- **Hierarchy ruling (AC-5):** originated from a direct question during this story's creation session — Arjun questioned whether the email+password buttons were even needed, given Google/Apple sign-in alone might be enough. Resolved to a visual re-ranking (OAuth prominent, email collapsed-but-functional), **not** a removal of the email+password path — Story 2.3a's backend stays fully intact and reachable. `epics.md` doesn't yet reflect this AC; doc-sync is owed but non-blocking for this story, matching this project's established pattern (e.g., Story 2.3c's AC-1 revision was captured inline in epics.md after the fact, not before).
- **Passkey-prod prereq (AC-6):** epics.md's blockquote (added during 2.3b's 2nd review, 2026-07-28) assumed a real prod web origin would exist to set as `rp_id`. It doesn't yet — `pre-launch-services-checklist.md` §1 shows Vercel deploy "Not started," no dedicated story. Rather than leave AC-6 blocked on an undated future story, Arjun's ruling this session folds a **minimal** `vercel link` + deploy into Task 3 — bare origin only, no custom-domain DNS work (that stays a separate, larger checklist item).

### Previous story intelligence

- **2.3a/2.3b/2.3c/2.3d (all done)** are the direct functional foundation this story restyles — read `web/app/login/page.tsx`, `web/app/phone-required/phone-form.tsx`, `auth-copy.ts`, `auth-state.ts`, `actions.ts` in full before starting; both restyled files already carry an inline comment stating their current styling is deliberately placeholder-grade and that this story owns the visual spec.
- **2.3b's own Scope boundaries (line 27) explicitly deferred** "official Google/Apple button lockups + any visual polish" to this story, and its Project Structure Notes (line 159) list the same deferral under "Out of scope" — confirms this story changes *only* presentation around `handleOAuthSignIn`/`handlePasskeySignIn`, never their logic.
- **`deferred-work.md` has five items pre-assigned to this story by name** (not inferred — read directly): the prod-passkey gap (AC-6), the disabled-Apple-button accessibility gap (Task 4.3), the `oauthError`/mode-toggle stale-error reset (Task 5.2), and the `inputStyle` hardcoded-`fontSize` debt (Task 5.1). All four are captured in this story's Tasks above — do not rediscover them as if new.
- **2.1's `PROVISIONING.md` and 2.3d's `EMAIL-PROVISIONING.md`** establish this project's pattern for account-level actions a coding agent structurally cannot complete alone (org/project creation, DNS, real credential exchange): document the runbook, flag exactly which step needs the human, and set the story's completion bar at "the documented state is accurate," not "every account-level action was personally completed by the agent." Task 3's Vercel deploy and prod Supabase Dashboard toggle likely need the same treatment — attempt via CLI/token or authenticated browser automation first (2.3b's precedent), flag for Arjun if unavailable, and be explicit in the Dev Agent Record about what was and wasn't actually driven.

### Testing standards summary

Co-located `*.test.ts`, pure-function-only — same philosophy every 2.x story has held to. This repo has **no** component/DOM testing library (`web/package.json` lists only `vitest`, no `@testing-library/react`/jsdom setup) — do not introduce one for this story; there is nothing here that requires rendering assertions over what a manual keyboard walkthrough (Task 6.3) and the existing `no-hardcoded-colors.test.ts` guard already cover. The one genuine new pure-logic surface is the AC-4 focus-ring contrast check (Task 4.2) — reuse `tokens.test.ts`'s exported `contrastRatio()` rather than reimplementing the luminance math.

### Project Structure Notes

**New files:**
- `web/app/components/auth/GhostInput.tsx`
- `web/app/components/auth/Button.tsx`
- `web/app/components/auth/BiometricAnchor.tsx`
- `web/app/components/auth/GoogleSignInButton.tsx`
- `web/app/components/auth/AppleSignInButton.tsx`
- A focus-ring contrast test (co-located with the component that renders it, or appended to `tokens.test.ts` — dev agent's call, follow whichever keeps the `contrastRatio()` reuse cleanest)

**Updated files:**
- `web/app/login/page.tsx` — hierarchy restructure (Task 2), component adoption (Task 1), stale-error reset (Task 5.2)
- `web/app/phone-required/phone-form.tsx` — `GhostInput`/`Button` adoption (Task 2.3)
- `web/app/tokens.css` — additive-only: new OAuth-brand color tokens (Task 1.4); do not touch the existing Ember/gradient/Motion sections
- `_bmad-output/implementation-artifacts/pre-launch-services-checklist.md` — §1, §4 (Task 3.5)
- `_bmad-output/implementation-artifacts/deferred-work.md` — close the five items this story owns

**New directory rationale:** `web/app/components/` doesn't exist yet — every prior story co-located its files per-route (`web/app/login/*`, `web/app/phone-required/*`). This story deliberately breaks that pattern for these five components specifically because Epic 6 Story 6.4 needs to import the identical components onto the Landing-page auth overlay (epics.md line 924, "the overlay hosts the Epic 2 auth components/paths") — co-locating them under `login/` would force 6.4 to either duplicate or reach across route boundaries.

**Explicitly not touched:** `web/app/login/actions.ts`, `auth-copy.ts`, `auth-state.ts`, `web/app/auth/{callback,confirm}/route.ts`, `web/lib/supabase/{client,server,middleware}.ts`, `supabase/config.toml`'s local `[auth.passkey]`/`[auth.webauthn]` block (already correct for local dev — only the **prod** Dashboard needs the new config, Task 3.3), any `supabase/migrations/*`.

## References

- [Source: _bmad-output/planning-artifacts/epics.md, lines 447-460 (Story 2.4 verbatim + passkey-prereq blockquote), 411-421 (2.3b, confirms OAuth-button-lockup deferred here), 423-433 (2.3c phone-required, shares the Ghost Input debt), 92-129 (UX-DR1/3/18-23 definitions), 924 (Epic 6 Story 6.4's reuse of these components on Landing)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-name-pending-2026-07-19/DESIGN.md#Components, lines 243-298 (Buttons, Input Fields, Biometric Anchor, Google/Apple Sign-In Button specs, Do's and Don'ts) — read in full]
- [Source: DESIGN.md#Colors/Typography/Shapes, lines 195-242 — read in full for token/type/radius conventions]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-name-pending-2026-07-19/EXPERIENCE.md#Component Patterns line 63 (auth-form behavioral rule, four paths all resolve to one account), #State Patterns lines 92-93 (auth-failed, phone-required copy) — read in full]
- [Source: web/app/tokens.css — read directly; current **uncommitted** state as of `baseline_commit` (Ember palette revision, `--btn-gradient-*`, `--color-spark`, new Motion layer, dated 2026-07-28) — treated as source of truth over DESIGN.md's still-Ice-Cyan/no-gradient prose per the file's own header comment and this project's Story 2.2 precedent]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-name-pending-2026-07-19/inspiration/README.md and prompts/gradient-button.md — read in full; documents the Ember/gradient direction as originally scoped "Epic 3 pre-work, pending Arjun's ruling on landing-only vs. app-wide," now superseded by `tokens.css`'s own comment recording the app-wide ruling]
- [Source: web/app/login/page.tsx, web/app/phone-required/phone-form.tsx, auth-copy.ts, auth-state.ts, actions.ts — read directly, current state as of `baseline_commit`]
- [Source: web/app/no-hardcoded-colors.test.ts, web/app/tokens.test.ts — read directly; establish the token-only-color-literals constraint (Task 1.4) and the reusable `contrastRatio()` helper (Task 4.2)]
- [Source: web/app/globals.css, lines 38-95 (`.text-display-lg`/`.text-headline-md`/`.text-body-lg`/`.text-body-md`/`.text-label-sm`/`.text-mono-data` utility classes) — existing typography convention to reuse, not reinvent]
- [Source: supabase/config.toml, lines 192-203 (`[auth.passkey]`/`[auth.webauthn]`, local `rp_id = "localhost"`) — read directly]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md — "Deferred from: 3rd code review of 2-3b-oauth-paths-account-linking-google-apple" (passkey prod gap + disabled-Apple-button a11y gap, both owner-assigned to Story 2.4), "Deferred from: code review of 2-3a-email-identity-path-email-password-passkey" (`inputStyle` fontSize hardcode, mode-toggle stale error) — all pre-assigned to this story by name, read in full]
- [Source: _bmad-output/implementation-artifacts/pre-launch-services-checklist.md §1 (Vercel deploy "Not started," Apple env var dependency "once this deploy happens"), §4 (passkey row, owner Story 2.4) — read in full]
- [Source: _bmad-output/implementation-artifacts/2-3b-oauth-paths-account-linking-google-apple.md — Scope boundaries line 27, Project Structure Notes line 159 (both confirm official button lockups deferred to this story); Task 7.2 (precedent for browser-automation-driven prod verification)]
- [Source: _bmad-output/implementation-artifacts/2-3d-production-email-delivery.md — Dev Notes structure/format precedent; "runbook + completion-bar" framing for account-level actions outside a coding agent's reach (Task 3)]
- [Source: _bmad-output/implementation-artifacts/2-1-supabase-cloud-foundation-isolation-baseline.md — `PROVISIONING.md` precedent, same framing]
- [Source: web/package.json — read directly; confirms no Tailwind/shadcn/`@testing-library` present today, vanilla CSS-custom-properties + inline style objects is the current, unbroken convention]
- [Decision: Arjun, 2026-07-28, this story's creation session — auth-screen hierarchy (AC-5) and the fold-in-a-minimal-Vercel-deploy resolution for AC-6's passkey-prod-verification prereq — captured here, not yet reflected in epics.md prose]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-07-28: Story drafted (create-story workflow) — exhaustive research across epics.md, DESIGN.md/EXPERIENCE.md, current auth codebase state, tokens.css's uncommitted Ember/gradient revision, deferred-work.md's five pre-assigned debt items, and the pre-launch-services-checklist's Vercel-deploy gap. Two scope decisions escalated to and resolved by Arjun during creation: (1) auth-screen hierarchy — OAuth primary/prominent, email+password collapsed/secondary (AC-5, new); (2) passkey-prod-verification approach — fold a minimal Vercel deploy into this story rather than defer (AC-6, Task 3).
