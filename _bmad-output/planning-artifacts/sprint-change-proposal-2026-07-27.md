# Sprint Change Proposal — 2026-07-27

**Trigger:** pre-launch/production-services audit (not a story implementation failure)
**Workflow:** bmad-correct-course
**Scope classification:** Minor

## 1. Issue Summary

Curfew has no way to send real transactional email in production. `supabase/config.toml`'s `[auth.email.smtp]` block is fully commented out; only the local `local_smtp` testing inbox is active. Story 2.3a (email-identity path, done) built the signup-confirmation email flow, but explicitly scoped itself to the local Supabase stack only — it has no path to sending a real email once a real Supabase cloud project and real users exist.

This wasn't discovered inside any story's own implementation. It surfaced during a standalone pre-launch services audit that consolidated scattered provisioning concerns (`supabase/PROVISIONING.md`, PRD §11, Architecture Spine Open Questions) into one checklist (`_bmad-output/implementation-artifacts/pre-launch-services-checklist.md`). A grep across the entire PRD, `epics.md`, and the Architecture Spine turned up zero mentions of an email-sending provider anywhere outside that one commented-out config stub — confirming this is a genuine coverage gap in original planning, not a misunderstanding or a technical wall hit during coding.

## 2. Impact Analysis

**Epic impact:** Contained entirely within Epic 2 (Account & Agent Onboarding), which already owns the Supabase Auth configuration surface (Story 2.1's DB/RLS foundation, 2.3a's local email confirmation, 2.3b's OAuth config). No existing Epic 2 story (done or backlog) requires modification. No ripple into Epics 3–7 — checked all five; none depend on Supabase Auth's email transport (Epic 7's Stripe receipts are sent by Stripe directly, not through this path).

**Story impact:** One new story required: **2.3d — Production email delivery (SMTP provider wiring)**, inserted as a sibling of the 2.3 cluster (2.3a/b/c), matching the precedent set when Story 1.3b was inserted next to 1.3 for the same reason (mid-epic scope gap, not a renumbering of anything existing).

**Artifact conflicts:**
- **PRD:** none. This is infrastructure/plumbing for FR-29, not a functional requirement change — same treatment as Supabase's own cloud provisioning, which also never appears in the PRD.
- **Architecture Spine:** one addition — an "Email delivery" row in both the Stack table and the Deployment & environments table, matching how Vercel/Stripe are represented. No new Architecture Decision (AD-*) needed; wiring SMTP into Supabase Auth is pure configuration, the same weight class as the Google/Apple OAuth blocks in `config.toml` (AR-10), not a sanctioned-exception-level decision like Stripe's webhook (AD-18/19).
- **UX specs:** none. No UI/flow/wireframe/accessibility changes. (Optional, non-blocking: the email's own template currently defaults to Supabase's stock template; branding it to the Obsidian voice is discretionary polish, not required.)
- **Other artifacts:** no CI/CD impact (production SMTP is a Supabase-project-level setting, not a GitHub Actions or Vercel secret); `web/README.md`'s Environment section gets one more entry, same pattern 2.3a/2.3b already established; testing philosophy unchanged (no mocking the real transport, consistent with 2.3a).

**Technical impact:** Low. No rollback of any completed story required — 2.3a is correct as built (deliberately local-only scoped at the time).

## 3. Recommended Approach

**Option 1 — Direct Adjustment**, selected over rollback (not applicable — nothing to revert) and PRD/MVP review (not needed — MVP unaffected). Effort: Low. Risk: Low. Add one new story to the existing Epic 2 backlog; no resequencing, no impact to Story 2.3b (already ready-for-dev, proceeds unaffected).

## 4. Detailed Change Proposals

### 4.1 — `epics.md`: new story (insert between Story 2.3c, line 433, and Story 2.4, line 434)

```
### Story 2.3d: Production email delivery (SMTP provider wiring)

As a DJ,
I want the confirmation email I receive at signup to actually arrive at my real inbox,
So that email+password signup (2.3a) and future auth email (password reset, email change) work outside local development.

**Acceptance Criteria:**

1. **Given** a production Supabase project, **When** `[auth.email.smtp]` is configured against a real transactional email provider (e.g. Resend), **Then** signup-confirmation email sends successfully to a real inbox. *(FR-29 production completeness)*
2. **Given** the provider's sending domain, **When** SPF/DKIM/DMARC records are verified with the provider, **Then** confirmation email delivers without landing in spam.
3. **Given** local development, **Then** `supabase start`'s `local_smtp` testing inbox is unchanged — this story only adds the production-path configuration, no regression to Story 2.3a's local flow.
4. **Given** provider credentials, **Then** they are stored as an encrypted secret at the Supabase-project level (dashboard/`supabase config push`), never committed to the repo.
```

### 4.2 — `epics.md`: Epic 2 summary paragraph updates (two locations)

**Line 190 (Epic List overview):**
```diff
- Establishes the cloud foundation (Supabase + null-safe RLS + additive-only migrations + prod/preview environments), the signed-build/auto-updater pipeline, and the agent's tray UI. *(UJ-3)*
+ Establishes the cloud foundation (Supabase + null-safe RLS + additive-only migrations + prod/preview environments), production email delivery for auth, the signed-build/auto-updater pipeline, and the agent's tray UI. *(UJ-3)*
```

**Line 369 (Epic 2 detailed section intro):**
```diff
- Establishes the cloud foundation (Supabase + null-safe RLS + additive migrations + prod/preview), the Obsidian token system as the first web surface, the signed-build/auto-updater pipeline, and the tray UI. *(UJ-3)*
+ Establishes the cloud foundation (Supabase + null-safe RLS + additive migrations + prod/preview), production email delivery for auth, the Obsidian token system as the first web surface, the signed-build/auto-updater pipeline, and the tray UI. *(UJ-3)*
```

### 4.3 — `sprint-status.yaml`

**New story entry** (insert after `2-3c-phone-on-file-post-oauth-prompt: backlog`):
```diff
    2-3c-phone-on-file-post-oauth-prompt: backlog
+   2-3d-production-email-delivery: backlog
    2-4-auth-ui-components: backlog
```

**New changelog entry** (newest line, right after `last_updated: 2026-07-27`):
```
# 2026-07-27: production email-sending gap (pre-launch services audit, not tied to any single story) resolved via bmad-correct-course as new story 2-3d (production email delivery: SMTP provider wiring), inserted as a sibling of 2-3a/b/c in epics.md; Epic 2 summary paragraphs (Epic List overview + Epic 2 detail intro) updated to list production email delivery among what Epic 2 establishes; Architecture Spine Stack/Deployment tables updated with an Email-delivery row (Resend or equivalent — no new AD, pure config, same weight class as the OAuth config blocks in config.toml). No PRD change — infra-only, same precedent as Supabase cloud provisioning never appearing in the PRD.
```

### 4.4 — `ARCHITECTURE-SPINE.md`

**Stack table** (insert after the `Supabase` row):
```diff
  | Supabase | Postgres + Auth + Realtime + Storage |
+ | Email delivery | Resend (or equivalent transactional email API) — configured via Supabase Auth's custom SMTP |
  | Stripe | Checkout + Customer Portal + Webhooks (subscriptions API); **pinned API version** (not account-default, AD-18) |
```

**Deployment & environments table** (insert after the `Backend` row):
```diff
  | Backend | Supabase (managed) | Postgres + Auth + Realtime + Storage; self-hostable later (no lock-in) — not v1. |
+ | Email delivery | Resend (managed), via Supabase Auth custom SMTP | Transactional auth email (signup confirmation, password reset); provider API key/SMTP credentials stored as an encrypted secret at the Supabase-project level (dashboard/`supabase config push`), never CI. |
  | CI/CD | GitHub Actions (`tauri-action`) | Cross-platform signed builds + auto-generated updater JSON/`.sig`; signing certs + updater key as encrypted CI secrets. |
```

## 5. Implementation Handoff

**Scope classification: Minor** — directly implementable, no PO/architect replan needed.

- **Planning-artifact edits (this proposal's §4.1–4.4):** applied directly as part of this workflow run upon approval below.
- **Story 2.3d itself:** sits in Epic 2's backlog at `ready-for-dev`-adjacent status (`backlog`, matching every other not-yet-started Epic 2 story); becomes the next candidate for `bmad-create-story` whenever Arjun chooses to sequence it — likely alongside or shortly after Story 2.3b/2.3c, since it's the last piece needed before Epic 2's auth surface is fully production-ready.
- **Manual provisioning half** (Resend account signup, sending-domain verification, SPF/DKIM/DMARC records): Arjun's own action, same pattern as `supabase/PROVISIONING.md` — the story's dev-context (once created via `bmad-create-story`) should document this as a runbook rather than something the coding agent can do unattended.
