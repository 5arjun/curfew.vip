---
baseline_commit: e8d89b02ba21944186d0094416d0d49fc6163136
---

# Story 2.3d: Production email delivery (SMTP provider wiring)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a DJ,
I want the confirmation email I receive at signup to actually arrive at my real inbox,
so that email+password signup (2.3a) and future auth email (password reset, email change) work outside local development.

## Acceptance Criteria

1. **Given** a production Supabase project, **When** `[auth.email.smtp]` is configured against a real transactional email provider (e.g. Resend), **Then** signup-confirmation email sends successfully to a real inbox. *(FR-29 production completeness)*
2. **Given** the provider's sending domain, **When** SPF/DKIM/DMARC records are verified with the provider, **Then** confirmation email delivers without landing in spam.
3. **Given** local development, **Then** `supabase start`'s `local_smtp` testing inbox is unchanged — this story only adds the production-path configuration, no regression to Story 2.3a's local flow.
4. **Given** provider credentials, **Then** they are stored as an encrypted secret at the Supabase-project level (dashboard/`supabase config push`), never committed to the repo.

[Source: _bmad-output/planning-artifacts/epics.md, lines 434-445]

### Scope boundaries (binding — read before writing anything)

**This is a documentation/runbook story, not a code story — same class as Story 2.1's `PROVISIONING.md`.** There is no `web/` or `agent/` code to write: Story 2.3a's signup-confirmation flow (`web/app/login/actions.ts`'s `signUp`, `web/app/auth/confirm/route.ts`) already works correctly against whatever SMTP transport Supabase Auth is configured to use — it does not need to know or care whether that transport is the local testing inbox or a real provider. **Do not touch any file under `web/app/` or `web/lib/` for this story.**

- **In scope:**
  1. A new runbook document, `supabase/EMAIL-PROVISIONING.md`, mirroring `supabase/PROVISIONING.md`'s structure and tone exactly (numbered steps, an up-front "what this does and doesn't block" framing, a closing "completion bar" note). Covers: Resend account signup, sending-domain verification (SPF/DKIM/DMARC), obtaining SMTP credentials, and wiring them into the **production** Supabase project.
  2. One new bullet in `web/README.md`'s existing Environment section pointing at the new runbook, matching the terse one-line style already used for the Google/Apple OAuth secret bullets.
  3. One row update in `_bmad-output/implementation-artifacts/pre-launch-services-checklist.md`'s §4 ("Real gap — not owned by any story today") — the email-sending-provider row now has an owning story; update its status/notes column, don't restructure the file.
  4. A corrective technical note inside the new runbook (Task 1.6 below) — this is the one piece of real engineering judgment in this story, not paperwork. Read it before writing anything else.
- **Out of scope / genuinely blocked, not this agent's to force:** actually executing the runbook — signing up for Resend, verifying a sending domain, wiring credentials into a real project — is Arjun's own account-level action, and is **structurally blocked today by two upstream gaps this story does not own and cannot resolve**:
  - No production domain name has been chosen yet (`pre-launch-services-checklist.md` §1 — "not started, not mentioned anywhere in PRD/Architecture/epics"). A sending domain needs a real domain to verify SPF/DKIM/DMARC against.
  - No production Supabase project exists yet (`supabase/PROVISIONING.md` — deliberately deferred to Story 2.10 or 3.2, whichever lands first; nothing about this story changes that sequencing).
  - **Do not invent a workaround** (e.g. verifying against a placeholder/test domain, or treating Resend's own shared test sender as "production"). Document the real sequencing (domain → prod Supabase project → this runbook) and stop there, exactly as Story 2.1 stopped at documenting cloud provisioning rather than fabricating a project.
  - **Update, 2026-07-27 (code review):** both blockers cleared same-day, out-of-band of this story's own scope — Arjun purchased `curfew.vip` and provisioned the `prod` Supabase project (`jmitbnrofacxwsbwuxzs`) while setting up Resend, ahead of Story 2.10/3.2's forcing function (see `sprint-change-proposal-2026-07-27-supabase-tier.md`). This section's framing describes the constraints as scoped; see the Dev Agent Record and `supabase/EMAIL-PROVISIONING.md` §4 for the actual resolved state.
- **Completion bar (mirrors Story 2.1's `PROVISIONING.md` exactly):** this story is done when the runbook is accurate and the two doc cross-references (README, checklist) are updated — **not** when a real email has actually been delivered to a real inbox. That live verification happens whenever Arjun actually runs the runbook, after the domain and prod-project gaps close; it is not a blocker to marking this story `done`.

## Tasks / Subtasks

- [x] **Task 1 — Write `supabase/EMAIL-PROVISIONING.md` (AC: 1, 2, 4)**
  - [x] 1.1 New file, structured like `supabase/PROVISIONING.md`: open with why this doesn't block any currently-shippable code (Story 2.3a already works against the local testing inbox; this runbook only extends it to production), then numbered sections, then a closing "Completion bar" section.
  - [x] 1.2 **Resend domain setup section:** sign in / create a Resend account → Domains → "Add Domain" with the production sending domain (depends on the not-yet-chosen production domain, see Scope boundaries) → Resend generates SPF and DKIM TXT records (and typically a DMARC recommendation) → add those records at the DNS provider for that domain → return to Resend and verify. Note explicitly: a domain can only have **one** DMARC record — if the domain registrar/DNS host already has one, add to it, don't create a second.
  - [x] 1.3 **Credential retrieval section:** Resend's SMTP page issues a password-shaped API key (`re_...`) shown once — copy it immediately, it cannot be re-displayed. Document the shape of what's needed: host, port (587/STARTTLS or 465/SSL — confirm the current value on Resend's own SMTP page at execution time, don't hardcode a number here that could drift), username, that one-time password, a default "from" address on the verified domain, and a sender name.
  - [x] 1.4 **Primary wiring path — Supabase Dashboard, not `config.toml`:** document configuring custom SMTP directly on the **production** project via **Authentication → Emails → SMTP Settings** in the Supabase dashboard (or the equivalent Management API call, for later scripting/CI needs — mention both, recommend the dashboard for a one-time setup). This is the primary path this runbook recommends, and satisfies AC-4's "encrypted secret at the Supabase-project level" by construction — the dashboard stores it per-project, server-side, never touching this repo.
  - [x] 1.5 **Why the Dashboard path is recommended over `config.toml` + `supabase config push` (document as a warning, do not build this now):** researched directly against Supabase's CLI docs (2026-07-27) — `supabase start` (local development) reads the **same top-level `[auth.email.smtp]` block** in `supabase/config.toml` that `supabase config push` would push to a linked remote project. Naively uncommenting and filling in that top-level block with Resend production credentials would silently redirect **local dev's** `local_smtp`/Mailpit testing inbox to the real provider too — a direct regression of this story's own AC-3, and exactly the kind of mistake this workflow exists to prevent. If a future story or Arjun prefers the config-as-code route instead of the dashboard, the block must be scoped inside a persistent-branch `[remotes.<name>]` entry keyed to the production project's `project_id` (Supabase CLI v2's "config as code" mechanism) — but confirm the exact current syntax against Supabase's CLI docs at that time; it wasn't fully verifiable during this story's research (see References) and should not be assumed correct without a fresh check. **Do not add an `[auth.email.smtp]` or `[remotes.*]` block to `supabase/config.toml` in this story** — the dashboard path (1.4) needs none of it, and a partially-verified CLI recipe left uncommented-but-wrong in the shared config is worse than not touching the file.
  - [x] 1.6 **Sequencing/blocker section:** state plainly that this runbook cannot be executed today — production domain (pre-launch-services-checklist §1) and production Supabase project (PROVISIONING.md, Story 2.10/3.2) are both prerequisites that don't exist yet. Document the order: domain registered → prod Supabase project created (PROVISIONING.md) → this runbook.
  - [x] 1.7 **Completion bar section:** verbatim-equivalent to `PROVISIONING.md`'s own closing note — this document is done when it's accurate, not when the live send-to-real-inbox test has happened.

- [x] **Task 2 — `web/README.md` Environment section (AC: 4)**
  - [x] 2.1 Add one bullet after the existing Google/Apple OAuth secret bullets, pointing to `supabase/EMAIL-PROVISIONING.md` for production email delivery — same terse one-liner style, not a duplicate explanation.
  - [x] 2.2 Add **no** new environment variable to `web/.env.local` or anywhere in `web/`. This story adds zero application code; the SMTP credential lives at the Supabase-project level (dashboard-stored per Task 1.4), never in this repo or in `web/`'s env files.

- [x] **Task 3 — `pre-launch-services-checklist.md` housekeeping (AC: none directly — keeps the one source of truth accurate)**
  - [x] 3.1 Update §4's "Email sending provider" row: it is no longer an unowned gap — note it's now Story 2.3d, and that the runbook (`supabase/EMAIL-PROVISIONING.md`) exists but is blocked on the domain + prod-project prerequisites (Task 1.6). Don't restructure the rest of the file.

- [x] **Task 4 — Confirm zero regression to local dev (AC: 3)**
  - [x] 4.1 Since Task 1's recommended path never touches `supabase/config.toml`, confirm via `git diff` that this story produces **no** diff to `supabase/config.toml` — if there is one, something went off-script from the Scope boundaries above.
  - [x] 4.2 Run `supabase start` locally and re-confirm Story 2.3a's signup-confirmation email still arrives at the local Mailpit/Inbucket testing inbox exactly as before (same check 2.3a's own manual verification already performed) — a quick regression check, not new functionality, and it should pass trivially given 4.1.

- [x] **Task 5 — Full gate**
  - [x] 5.1 No pgTAP, no Vitest — this story has no pure logic and no schema change to test (same "don't force a test into existence" principle 2.3a/2.3b/2.3c already established, applied here to its logical extreme: there is no code at all). State this explicitly in the Dev Agent Record rather than silently skipping Task 5.
  - [x] 5.2 Repo-root gate still applies as a regression check on everything else: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` via turbo — must actually run green on this machine (standing Epic-2+ rule, sprint-status `action_items` ai-8), confirming this story's doc-only changes broke nothing.

### Review Findings

- [x] [Review][Patch] Story file's own status record contradicts the rest of the diff [_bmad-output/implementation-artifacts/2-3d-production-email-delivery.md:35-39,130-138,152] — Rewrite the Dev Agent Record, Completion Notes, Change Log, and Scope boundaries section to reflect that the domain (`curfew.vip`) and prod Supabase project (`jmitbnrofacxwsbwuxzs`) were actually resolved same-day (2026-07-27), matching `EMAIL-PROVISIONING.md`/checklist/`PROVISIONING.md`. Applied: reconciliation notes added to Scope boundaries and Completion Notes, new dated Change Log entry appended.
- [x] [Review][Patch] AC-1/AC-2 marked "resolved"/"done" without production verification — Applied: explicit caveat added next to the "resolved" status in `EMAIL-PROVISIONING.md` §4 and the checklist's email-provider row.
- [x] [Review][Patch] EMAIL-PROVISIONING.md documents DMARC's one-record rule but not SPF's identical constraint [supabase/EMAIL-PROVISIONING.md:33-38] — Applied: SPF single-record caveat added alongside the existing DMARC one.
- [x] [Review][Patch] No documented verification/revocation step for Resend's native integration [supabase/EMAIL-PROVISIONING.md:68-82] — Applied: added a verification step (check SMTP Settings on the target project) and a revocation procedure (Resend → Integrations → Supabase).
- [x] [Review][Patch] File List omits `supabase/PROVISIONING.md` [_bmad-output/implementation-artifacts/2-3d-production-email-delivery.md:140-148] — Applied: added to Modified files list.
- [x] [Review][Patch] Sprint-change proposal's declared file scope omits SOLUTION-DESIGN.md [_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-27-supabase-tier.md:41-50] — Applied: added as item 7 to §4's file list.
- [x] [Review][Patch] .mcp.json requests an unused 'branching' feature scope [.mcp.json:5] — Applied: removed from the `features` query param.
- [x] [Review][Defer] Free-tier prod project auto-pauses after 7 days idle, no monitoring/keep-alive plan [supabase/PROVISIONING.md, pre-launch-services-checklist.md §3] — deferred, logged as an action item in deferred-work.md rather than resolved now.
- [x] [Review][Defer] Domain purchase has no renewal/expiration/auto-renew tracked [pre-launch-services-checklist.md:16] — deferred; Arjun confirmed renewal date 2027-07-27, $16/yr via Cloudflare, not yet written back into the checklist. Logged in deferred-work.md.

## Dev Notes

### Architecture compliance

- **Architecture Spine Stack table / Deployment table** already carry the "Email delivery | Resend (managed), via Supabase Auth custom SMTP" rows — added by the 2026-07-27 correct-course pass that created this story (commit `0c0cfb2`). No further Architecture Spine edits are needed by this story; it implements what's already documented there.
- **No new Architecture Decision (AD-\*).** The correct-course proposal that spawned this story explicitly classified SMTP wiring as "pure configuration, the same weight class as the Google/Apple OAuth blocks in `config.toml`" — not a sanctioned-exception-level decision like AD-18/19's Stripe webhook.
- **AD-8** (no bespoke write path) is not implicated — this story adds no application code, no API route, nothing that writes anywhere.

### Corrected understanding vs. the originating correct-course proposal

The sprint-change-proposal that created this story (`_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-27.md`) describes the "coding half" as *"uncommenting/filling `[auth.email.smtp]` in `config.toml`... confirming it applies to both local and the eventual cloud project."* That framing undersold a real risk: research performed while context-engineering this story (2026-07-27, see References) found that `supabase start` reads the *same* top-level `[auth.email.smtp]` block that a CLI-based production push would use — so "applies to both local and the eventual cloud project" is true in a way that would actively **break** AC-3, not satisfy it. This story's Task 1 resolves that by routing production configuration through the Supabase **Dashboard** instead (Task 1.4), which is scoped per-project by construction and cannot leak into local dev. This is exactly the kind of gap this create-story workflow exists to catch before a dev agent builds the wrong thing — treat Task 1.5's warning as load-bearing, not a footnote.

### Previous story intelligence

- **Story 2.1** (done) is the direct structural precedent: it hit the same "this needs a real account-level action outside a coding agent's reach" shape (Supabase org/project creation) and resolved it by writing `supabase/PROVISIONING.md` as a runbook, explicitly stating its own completion bar was "this document is accurate," not "the live project exists." This story's Task 1 follows that precedent file-for-file.
- **Story 2.3b** (in-progress) hit a related-but-different shape — it needed real OAuth credentials Arjun could actually obtain and use for live testing (Google Cloud Console is free/self-serve), so 2.3b *did* get live-verified end-to-end. This story is closer to 2.1's shape than 2.3b's: the blockers here (an unregistered domain, an unprovisioned prod project) are not things Arjun can resolve in an afternoon the way "get a Google OAuth client ID" was — don't expect or push for live verification within this story.
- **Story 2.3a** (done) is the functional consumer this story's runbook eventually unblocks — its `signUp` Server Action and `auth/confirm/route.ts` route are correct as built and need **zero changes**. Confirmed by reading both files directly during this story's research: neither references SMTP configuration at all, they only call `supabase.auth.signUp(...)` / handle the confirmation redirect — the SMTP transport is entirely Supabase Auth's own concern, invisible to application code.
- `web/README.md`'s Environment section already establishes the "one line per secret, cite the two upstream provider guides" pattern from 2.3b's Google/Apple bullets — Task 2 extends that same pattern, doesn't invent a new one.

### Testing standards summary

No automated test surface — this story is documentation-only (a first in Epic 2; every prior 2.x story had at least pgTAP or Vitest coverage). Do not force a test file, a migration, or a pgTAP case into existence to make this story "look" more complete; the repo-root gate (Task 5.2) is the only verification that applies, and it's a pure regression check on unrelated code, not new coverage for this story's own content.

### Project Structure Notes

**New files:**
- `supabase/EMAIL-PROVISIONING.md`

**Updated files:**
- `web/README.md` — one new Environment-section bullet.
- `_bmad-output/implementation-artifacts/pre-launch-services-checklist.md` — one row updated in §4.

**Explicitly not touched by this story:** `supabase/config.toml` (see Task 1.5/4.1 — must produce zero diff), anything under `web/app/` or `web/lib/`, `supabase/migrations/`, `supabase/tests/`, the Architecture Spine (already updated by the correct-course pass that created this story).

## References

- [Source: _bmad-output/planning-artifacts/epics.md, lines 190 (Epic List overview, email-delivery mention), 369 (Epic 2 detail intro), 434-446 (Story 2.3d verbatim)]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-07-27.md — full correct-course record that created this story; §3 Impact Analysis for why this is Epic-2-contained with no PRD/UX changes; §4.4 for the Architecture Spine rows already applied]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md, Stack table line 210, Deployment table line 271 (Email delivery rows, already present as of this story's baseline)]
- [Source: _bmad-output/planning-artifacts/prds/prd-name-pending-2026-07-19/prd.md#FR-29 (lines 373-380, "every account has a phone number... regardless of signup path" — the phone half is 2.3c's, the email-transport-production-completeness half is this story's, per epics.md's own "(FR-29 production completeness)" citation)]
- [Source: _bmad-output/implementation-artifacts/pre-launch-services-checklist.md — §1 (production domain, "not started"), §3 (Supabase cloud project, deferred to Story 2.10/3.2), §4 (email provider, "confirmed total gap" — this story's direct origin), and its own closing "Scoping the email-provider work" section which predicted this story's shape]
- [Source: supabase/PROVISIONING.md — structural template for the new `EMAIL-PROVISIONING.md` runbook (numbered steps, non-blocking framing, closing completion-bar note), read in full]
- [Source: supabase/config.toml, lines 226-256 (`[auth.email]` block, `[auth.email.smtp]` currently fully commented out) — read directly, current state as of baseline_commit]
- [Source: web/README.md — current Environment section (Google/Apple OAuth secret bullets), read directly for the one-line-per-secret pattern Task 2 extends]
- [Source: web — Supabase Auth custom SMTP docs (https://supabase.com/docs/guides/auth/auth-smtp) — fetched 2026-07-27: confirms the Dashboard (Authentication → Emails → SMTP Settings) and Management API as the documented configuration paths; does not document config.toml/CLI specifics]
- [Source: web — Supabase CLI config guide (https://supabase.com/docs/guides/local-development/cli/config) and branching configuration guide (https://supabase.com/docs/guides/deployment/branching/configuration) — fetched 2026-07-27: confirms `supabase start` reads the top-level `[auth.email.smtp]` block, and that `[remotes.<name>]` blocks (tied to persistent-branch `project_id`s) are the documented per-environment override mechanism — exact CLI syntax for targeting a named remote with `config push` was not fully confirmable from available documentation and should be re-verified before any future story attempts the CLI route]
- [Source: web — Supabase CLI v2 "Config as Code" announcement (https://supabase.com/blog/cli-v2-config-as-code) — fetched 2026-07-27: `[remotes.*]` is oriented around persistent Git branches, which this project has not yet set up (PROVISIONING.md step 2, not yet run) — another reason Task 1.4 recommends the Dashboard path over the CLI path for this story's runbook]
- [Source: web — Resend's own Supabase configuration guide (https://resend.com/blog/how-to-configure-supabase-to-send-emails-from-your-domain) — fetched 2026-07-27: confirms the domain-verification (SPF/DKIM/DMARC TXT records) and dashboard-SMTP-settings flow documented in Task 1.2-1.4]
- [Source: _bmad-output/implementation-artifacts/2-3c-phone-on-file-post-signup-prompt.md — sibling story, read for file/section conventions this story's file follows]
- [Source: _bmad-output/implementation-artifacts/2-1-supabase-cloud-foundation-isolation-baseline.md — direct structural precedent for a "runbook, not code" story with a documentation-accuracy completion bar]

## Dev Agent Record

### Agent Model Used

claude-sonnet-5 (Claude Code)

### Debug Log References

- `git diff --stat -- supabase/config.toml`: zero output, confirming Task 4.1's no-diff requirement.
- Local regression check (Task 4.2), actually run against the real local stack: `supabase start` (already running; confirmed via `supabase status`) → `POST /auth/v1/signup` against `http://127.0.0.1:54321` for a throwaway address → response showed `confirmation_sent_at` populated → Mailpit's `/api/v1/search` confirmed a "Confirm your email address" message delivered to that address within ~2s, same as Story 2.3a's own manual verification. Test user then deleted via the Auth admin API (`DELETE /auth/v1/admin/users/{id}`) to leave no residue.
- Repo-root `pnpm {lint,typecheck,build,test}` via turbo: all green, 3/3 tasks successful across `@curfew/shared`, `agent`, `web`. `shared` 13/13 tests unchanged, `web` 13/13 tests unchanged (no new pure logic, per Task 5.1) — no regressions from this story's doc-only changes.

### Completion Notes List

- Implemented Story 2.3d exactly per its own scope boundaries: a documentation/runbook story, zero application code. No file under `web/app/` or `web/lib/` was touched.
- Task 1: wrote `supabase/EMAIL-PROVISIONING.md`, mirroring `supabase/PROVISIONING.md`'s structure (intro framing on why it doesn't block shippable code, numbered sections, closing completion-bar note). Documents Resend domain setup (SPF/DKIM/DMARC, including the one-DMARC-record-per-domain caveat), credential retrieval, and the primary Supabase Dashboard wiring path. Carries forward the story's own corrected understanding as a dedicated warning section: `supabase start` reads the same top-level `[auth.email.smtp]` block a CLI-based production push would use, so the Dashboard path is recommended specifically to avoid regressing local dev's Mailpit testing inbox — the `config.toml`/`[remotes.*]` route is documented as a future option only, explicitly not built now, with its exact CLI syntax flagged as unverified. Documents the real blocking sequence (domain → prod Supabase project → this runbook) rather than inventing a workaround.
- Task 2: one bullet added to `web/README.md`'s Environment section, after the existing Google/Apple OAuth secret bullets, pointing to the new runbook. No new environment variable added anywhere in `web/`.
- Task 3: `pre-launch-services-checklist.md` §4's "Email sending provider" row updated — no longer an unowned gap, now attributed to Story 2.3d with the runbook's existence and its blocked status (domain + prod-project prerequisites) noted. Rest of the file left untouched, as scoped.
- Task 4: confirmed via `git diff --stat -- supabase/config.toml` that this story produced zero diff to that file. Then actually exercised the regression path rather than relying on the no-diff proof alone: started the local stack, signed up a throwaway address against the real local Auth API, and confirmed via Mailpit's own search API that the confirmation email arrived exactly as it did before this story — Story 2.3a's local flow is unaffected. Test user removed afterward via the Auth admin API.
- Task 5: no pgTAP or Vitest coverage added — this story has no pure logic and no schema change, consistent with the "don't force a test into existence" principle already established by 2.3a/2.3b/2.3c, taken to its logical conclusion here since there is no code at all. Repo-root gate (lint/typecheck/build/test via turbo) run and green, confirming no regression to anything else in the monorepo.
- **Update, 2026-07-27 (code review):** this note originally said the runbook remained genuinely blocked (no production domain, no production Supabase project) — true when this story was drafted, no longer true by the time it reached review. Same-day, and out-of-band of this story's own scope, Arjun purchased `curfew.vip` and provisioned the `prod` Supabase project (`jmitbnrofacxwsbwuxzs`) while setting up Resend, ahead of Story 2.10/3.2's forcing function (see `sprint-change-proposal-2026-07-27-supabase-tier.md`). Credentials were wired via Resend's native Supabase integration (see `supabase/EMAIL-PROVISIONING.md` §3's "Actual wiring path used" note) — not the manual Dashboard-paste path this story originally scoped, though AC-4's intent (encrypted secret at the project level, never in this repo) holds either way. Production send-to-real-inbox and per-record SPF/DKIM/DMARC verification are still unconfirmed as of this review — flagged as a caveat in `EMAIL-PROVISIONING.md` and the checklist rather than claimed as tested.

### File List

**New:**
- `supabase/EMAIL-PROVISIONING.md`

**Modified:**
- `web/README.md`
- `_bmad-output/implementation-artifacts/pre-launch-services-checklist.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `supabase/PROVISIONING.md` — steps 1-3 marked done with the real prod project's identifiers, once the domain/prod-project gaps closed same-day.

## Change Log

- 2026-07-27: Implemented Story 2.3d end-to-end (production email delivery, SMTP provider wiring) as a documentation/runbook story — zero application code changed, matching Story 2.1's `PROVISIONING.md` precedent. Wrote `supabase/EMAIL-PROVISIONING.md` (Resend domain setup, credential retrieval, primary Supabase Dashboard wiring path, and a load-bearing warning against filling `[auth.email.smtp]` in `config.toml` directly — `supabase start` reads that same top-level block, so doing so would silently redirect local dev's Mailpit testing inbox to the real provider). Added one Environment-section bullet to `web/README.md` and updated `pre-launch-services-checklist.md` §4's email-provider row to reflect the new owning story. Confirmed zero diff to `supabase/config.toml` and re-verified the local Mailpit signup-confirmation flow still works exactly as before via a real signup against the local Auth API. Full repo-root gate green (web 13/13 tests unchanged, shared 13/13 unchanged, no regressions). Runbook itself remains genuinely blocked on two upstream gaps this story doesn't own (no production domain chosen, no production Supabase project provisioned) — per the story's own completion bar, that does not block marking this story done.
- 2026-07-27 (code review): the above entry's "remains genuinely blocked" line was accurate when Task 1-5 were implemented but went stale before review — same-day, Arjun purchased `curfew.vip` and provisioned the `prod` Supabase project (`jmitbnrofacxwsbwuxzs`), out-of-band of this story's own scope, while setting up Resend (see `sprint-change-proposal-2026-07-27-supabase-tier.md`). `supabase/EMAIL-PROVISIONING.md`, `pre-launch-services-checklist.md`, and `supabase/PROVISIONING.md` were updated to record the resolved state; this story's own Scope boundaries and Completion Notes sections annotated to match rather than rewritten, per this repo's established practice of appending reconciliation notes rather than rewriting history (Story 2.1's own AC-1 revision precedent). Production send-to-real-inbox and per-record SPF/DKIM/DMARC verification remain unconfirmed — flagged as an explicit caveat rather than silently claimed. `.mcp.json`'s unused `branching` feature scope dropped; `supabase/PROVISIONING.md` added to this story's File List (it was modified in the same commit but omitted); this proposal's own file-scope list corrected to include `SOLUTION-DESIGN.md`. Free-tier auto-pause monitoring and domain-renewal tracking logged as separate action items in `deferred-work.md`, not resolved here.
- 2026-07-28 (post-review verification): the previous entry's "production send-to-real-inbox... remain unconfirmed" caveat is now closed. A real signup was issued directly against `prod`'s live `/auth/v1/signup` API using a real external Gmail inbox; the confirmation email arrived (not spam) from `team@updates.curfew.vip`, and the raw headers showed SPF, DKIM, and DMARC all independently passing — not just Resend's bundled domain-verified badge. `supabase/EMAIL-PROVISIONING.md` §4 and `pre-launch-services-checklist.md` §4 updated to record this. One separate, unrelated gap surfaced by the same test: the confirmation link redirects to `localhost` and fails, because the `prod` project's Auth Site URL isn't configured — there's nothing to point it at yet, since `web/` has no Vercel deployment (tracked under the checklist's §1 Vercel row, not this story's scope). Also implemented this same session: `.github/workflows/supabase-keepalive.yml`, closing the free-tier-auto-pause item this story's review had deferred to `deferred-work.md` (Arjun's ruling: scheduled keep-alive ping over a tier upgrade); and the domain-renewal date (`curfew.vip`, 2027-07-27, $16/yr) written back into the checklist, previously confirmed verbally but never recorded. DMARC on `curfew.vip` remains intentionally at `p=none` (monitor-only) — tightening to `p=quarantine`/`p=reject` is a deliberate pre-launch action item, not done now, since staging offers no benefit without DMARC reporting configured.
