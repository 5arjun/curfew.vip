---
baseline_commit: 0e7b73f2af59e166254f56615130de0dca9631c9
---

# Story 2.11: Account deletion + data export (manual runbook)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a DJ,
I want a way to delete my account and its data, and to get an export of it, on request,
so that handing Curfew my whole library history isn't a one-way trip — even before a self-serve control exists.

## Acceptance Criteria

1. **Given** a deletion request, **Then** a documented, tested runbook cascades a delete of every row owned by `dj_id` across all tables (`sessions`, `sets`, `plays`, `segments`, enrichment overlays, `djs`), deletes the Stripe customer if one exists, and purges the local agent SQLite on next launch. *(NFR-2 / CCPA-level posture; Paige's catch, party 2026-07-20)*
2. **Given** an export request, **Then** the same runbook produces the DJ's derived data in a portable format.
3. **Given** MVP scope, **Then** this is a **manual/operator runbook + a "delete my account" support link** (surfaced from the Profile/Settings screen, Story 3.10) — **not** a self-serve in-app feature; full self-serve deletion + automated portability are backlogged. *(Ruling, party 2026-07-20: CCPA thresholds don't bind a launch-size business)*
4. **Given** Curfew later lists on the Apple App Store or Google Play, **Then** their in-app-account-deletion guideline triggers and this must become a self-serve feature — tracked now, built then. *(Winston / Mary, party 2026-07-20)*

[Source: _bmad-output/planning-artifacts/epics.md#Story 2.11, lines 560-571]

### Resolved before this story was written (read first — binding decisions, not open questions)

The epic text describes the runbook against the **full, eventual** schema (`sessions`, `sets`, `plays`, `segments`, enrichment overlays, Stripe customer). **None of that exists yet.** Repo-wide check confirmed the live schema is exactly three migrations: a no-op (`20260721180917_init.sql`), `public.djs` (`20260726012050_create_djs_table.sql`), and one column (`20260727192439_add_djs_phone_column.sql`). Story 3.1 (`sessions`/`sets`/`plays`/`segments`, backlog) and Epic 7 (`stripe_customer_id` + billing columns, backlog) have not landed. **Arjun ruled on scope during story creation (2026-07-30):**

- **This is a pure documentation/runbook story — zero application code.** Mirrors Story 2.3d's `EMAIL-PROVISIONING.md` precedent exactly: a new `supabase/ACCOUNT-DELETION-EXPORT-RUNBOOK.md`, no `web/`/`agent/` code changes. The completion bar is **doc accuracy against what exists today**, not full execution of a schema that doesn't exist yet.
- **Write the runbook as a living document, accurate to the schema as it stands today, with explicit forward-hook sections (not fabricated steps) for Story 3.1's tables and Epic 7's Stripe columns.** Do **not** write SQL against `sessions`/`sets`/`plays`/`segments`/`stripe_customer_id` as if they exist — they don't, and inventing schema here would violate AD-15 (additive-only migrations owned by their own stories, not this one). Each forward-hook section is a clearly labeled TODO the next relevant story (3.1's own dev-story, or whichever Epic 7 story lands `stripe_customer_id`) must fill in — cross-reference by name so it's discoverable.
- **Today's actual "cascade" is one step:** `public.djs.id` has `on delete cascade` back to `auth.users(id)` (Story 2.1's migration). Deleting the `auth.users` row — via the Supabase Dashboard's Authentication → Users → Delete, or the Admin API's `deleteUser(id)` — removes the matching `djs` row automatically. There is nothing else to cascade today. No Stripe customer can exist yet (no billing integration built) — document that step as explicitly N/A-today, not skip it silently.
- **AC-1's "purges the local agent SQLite on next launch" has no supporting mechanism anywhere in the codebase, and this story does not build one.** No story (this one included) gives the agent any way to learn its account was deleted — there is no sync/auth-check call today (Story 3.2/3.3, the sync path, are backlog; Story 2.10, in-progress, builds token refresh only, never a "was I deleted" check). Writing Rust to poll for account-deletion here would be scope creep with no AC asking for it and no sync endpoint to check against. **Ruling: document the local-purge step as a manual instruction the operator relays to the DJ** (quit the agent, then delete the file at the path `store.rs` already establishes — `app_local_data_dir()/local.sqlite`, i.e. macOS `~/Library/Application Support/<bundle-id>/local.sqlite`) rather than an automated behavior, and flag the automatic version as unbuilt, forward-owned by whichever future story adds agent-side deletion-awareness (likely once Story 3.2/3.3's sync/auth-check path exists).
- **AC-3's "delete my account" support link is Story 3.10's scope, not this story's.** Story 3.10 (Profile/Settings) is backlog — there is no screen to surface a link from yet, and building one here would be inventing a UI surface out of order. This story satisfies AC-3 by producing the runbook only; the runbook's own "Requesting a deletion or export" section documents today's interim channel (direct contact to Arjun — no support inbox exists yet, and none is required at this DJ-count) and flags that Story 3.10's own story-creation pass should wire a link/mailto into this runbook's request channel once that screen exists.
- **AC-4 needs no action now** — record it in the runbook as a tracked trigger condition (App Store/Play Store listing → this becomes a required self-serve feature), not something to build today.

## Tasks / Subtasks

- [ ] Task 1: Read "What actually exists today" (Dev Notes) before writing anything — comprehension gate, no subtasks
  - Confirm for yourself (repo-wide grep, not assumption) that `sessions`/`sets`/`plays`/`segments` tables and any `stripe_customer_id`/billing column genuinely do not exist yet, and that no agent-side deletion-detection code exists. This story's entire value is being accurate about that boundary — do not let the epic's forward-looking phrasing pull you into documenting tables/columns that aren't real.

- [ ] Task 2: Write `supabase/ACCOUNT-DELETION-EXPORT-RUNBOOK.md` (AC: #1, #2, #3, #4)
  - Mirror `supabase/EMAIL-PROVISIONING.md`'s structure and voice (numbered runbook sections, a "sequencing/blockers" style status callout, plain operator-executable steps — no code to write, just Dashboard/SQL/CLI actions to follow).
  - **Section: Requesting a deletion or export.** Document today's interim request channel (direct contact to Arjun; no support inbox/form exists yet — not required at current scale). Explicitly note: once Story 3.10 (Profile/Settings) ships its "delete my account" support link, that story should point here.
  - **Section: Deletion procedure (today's schema).**
    1. Confirm the requesting DJ's `auth.users` row (match on verified email — reuse the same identity-linking mental model as AD-10: one DJ, one email, one row).
    2. Delete via Supabase Dashboard (Authentication → Users → Delete) **or** the Admin API (`supabase.auth.admin.deleteUser(id)`, service-role key required) — either cascades `public.djs` automatically (`on delete cascade`, confirmed in `20260726012050_create_djs_table.sql`).
    3. **Stripe customer:** N/A today — no billing integration exists (Epic 7 backlog). Forward-hook: once `stripe_customer_id` lands on `djs`, add a step here to delete/cancel the Stripe customer via the Stripe Dashboard or API before deleting the `djs` row (must happen first, since the column disappears with the row).
    4. **Local agent SQLite:** no automatic purge mechanism exists (see "Resolved" section above). Document as a manual instruction to relay to the DJ: quit the agent, delete `local.sqlite` at Tauri's `app_local_data_dir()` path (state the real per-OS path from `store.rs`'s doc comment). Flag this as the interim process until a future story wires automatic post-deletion purge.
    5. Forward-hook, clearly labeled TODO: once Story 3.1 lands `sessions`/`sets`/`plays`/`segments`, this section must gain an explicit cascade step for those tables (confirm their eventual FK `ON DELETE CASCADE` behavior back to `djs.id`, or add explicit `DELETE ... WHERE dj_id = ...` statements here if they're not cascade-configured — do not assume cascade without checking that story's actual migration).
  - **Section: Export procedure (today's schema).** A DJ's derived data today is exactly their `public.djs` row (`id`, `created_at`, `phone`). Document the SQL Editor query (`select * from public.djs where id = '<uuid>';`) and how to save the result as portable JSON/CSV via the Dashboard's export button. Forward-hook, clearly labeled TODO: once Story 3.1's tables exist, extend this query to join `sessions`/`sets`/`plays`/`segments`/overlays scoped to the same `dj_id`.
  - **Section: Future self-serve trigger (AC-4).** One paragraph: App Store/Play Store listing requires in-app self-serve account deletion per their guidelines; this is the tracked trigger for building that as its own story. No action needed now.
  - State a "status as of 2026-07-30" line at the top (matching `EMAIL-PROVISIONING.md`'s own framing convention) summarizing exactly what's real today vs. forward-hooked.

- [ ] Task 3: Verify the runbook actually works (AC: #1, #2) — do not mark done on documentation alone
  - Against local Supabase (`supabase start`), create one throwaway test DJ (sign up via the existing local `/login` flow, same pattern Stories 2.3a/2.3c/2.3d used for their own manual verification), optionally set a `phone` value so the export has more than one non-null field to confirm.
  - Run the export query from Task 2 against that test user; confirm it returns the expected row shape.
  - Delete the test user's `auth.users` row via the Dashboard or Admin API; confirm via direct query that the matching `public.djs` row is gone (cascade actually fires, not just documented as if it does).
  - Document exact commands/steps run and their results in Dev Agent Record — this is this story's only "test suite," matching Story 2.3d's own completion bar (doc accuracy + one real local verification, not a unit-test suite, since there's no application code to unit-test).

- [ ] Task 4: Cross-reference housekeeping (no new AC, but prevents future confusion)
  - Add a row (or extend an existing one) in `pre-launch-services-checklist.md` noting: this runbook exists but its Story-3.1/Epic-7 forward-hooks are unfilled until those land, and the AC-4 App-Store/Play-Store self-serve trigger is tracked, not yet actioned.
  - If `deferred-work.md` doesn't already carry an item for "agent has no way to detect its own account was deleted / auto-purge local SQLite," add one now, owned by whichever future story builds the sync/auth-check path (Story 3.2/3.3 territory) — this is a real, user-facing gap this story surfaces but does not fix.
  - `supabase/README.md`'s file-tree listing should gain the new runbook file, matching how it already lists `PROVISIONING.md`.

## Dev Notes

- **What actually exists today (confirmed by direct repo inspection, not the epic's forward-looking phrasing):**
  - Live schema: `public.djs (id uuid PK -> auth.users(id) ON DELETE CASCADE, created_at, phone)`. That's it. [Source: supabase/migrations/20260726012050_create_djs_table.sql, supabase/migrations/20260727192439_add_djs_phone_column.sql]
  - No `sessions`/`sets`/`plays`/`segments`/overlay tables exist (Story 3.1, epic-3, backlog). No billing columns (`stripe_customer_id` etc.) exist (Epic 7, backlog).
  - No sync path exists (`PUT /sets/:set_id` — Story 3.2/3.3, backlog), so the agent has no channel to learn its account was deleted.
  - Story 2.10 (agent secure token storage) is **in-progress** on this branch — it builds token refresh/storage only; it does not build (and this story must not assume) any deletion-detection or revocation-check logic.
  - Story 3.10 (Profile/Settings screen) is backlog — no UI surface exists to host a "delete my account" link.
  - Local agent SQLite path (for the manual-purge instruction): `agent/src-tauri/src/store.rs` — `app_local_data_dir()/local.sqlite`, Tauri's per-machine non-roaming data dir (macOS: `~/Library/Application Support/<bundle-id>/local.sqlite`). [Source: agent/src-tauri/src/store.rs, lines 6-8, 219-225]
  - Story 2.1's own Dev Notes already anticipated this story by name: *"This does not replace Story 2.11's manual deletion runbook (which cascades deletes across sessions/sets/plays/overlays — tables that reference djs.id, not auth.users.id directly); it's a structural safety net one level up."* [Source: _bmad-output/implementation-artifacts/2-1-supabase-cloud-foundation-isolation-baseline.md, line 37]

- **Scope boundaries — do not build these here:**
  - No migration, no new table, no new column. This story writes documentation only.
  - No agent-side (Rust) code — no polling, no deletion-detection, no auto-purge mechanism. That's a real gap (flagged in Task 4), not this story's to close.
  - No `web/` UI — no support-link component, no Profile/Settings work (Story 3.10's scope).
  - No Stripe integration work — Epic 7 owns that entirely; this story's Stripe section is a documented placeholder only.

- **Runbook doc conventions to mirror:** `supabase/EMAIL-PROVISIONING.md` and `supabase/PROVISIONING.md` — numbered sections, a plain-language "what's real as of DATE" status line near the top, operator-executable steps (Dashboard clicks / SQL / CLI), no invented tooling. [Source: supabase/EMAIL-PROVISIONING.md]

- **Testing standard for this story:** there is no application code, so there is no unit-test suite. The bar is Task 3's real local verification (create → export → delete → confirm cascade), documented with actual output, matching the precedent Stories 2.3d/2.3b/2.6 set for runbook/manual-verification stories in this repo — don't substitute a hypothetical "this should work" for an actually-run check.

### Project Structure Notes

- New: `supabase/ACCOUNT-DELETION-EXPORT-RUNBOOK.md`.
- Modified: `_bmad-output/implementation-artifacts/pre-launch-services-checklist.md` (new/extended row), `_bmad-output/implementation-artifacts/deferred-work.md` (new item — agent-side deletion-awareness gap), `supabase/README.md` (file-tree listing).
- Not modified: any file under `agent/src-tauri/src/` or `web/app/` — this story is doc-only. If a diff touches either, that's scope creep — stop and reread the "Resolved before this story was written" section above.
- No `shared/` change — no sync-contract implications (this story predates the tables the contract would even cover).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.11, lines 560-571] — story ACs, canonical text.
- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.1, lines 577-589; #Story 3.10, lines 697-710] — the two backlog stories this story's forward-hooks depend on (schema, and the Profile/Settings support-link surface).
- [Source: _bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md#AD-7, AD-10, AD-15] — per-DJ RLS isolation (AD-7, why deletion must be scoped by `dj_id`/cascade, not a blanket table wipe), one-account-per-verified-email (AD-10, how the operator identifies the right `auth.users` row), additive-only migrations (AD-15, why this story never writes a migration for tables it doesn't own).
- [Source: _bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/SOLUTION-DESIGN.md, lines 238-256, 266] — data model narrative (session/set/plays/overlay relationships this runbook's forward-hooks must eventually cascade across); US-only/CCPA-level posture framing this story implements practically.
- [Source: _bmad-output/planning-artifacts/prds/prd-name-pending-2026-07-19/prd.md, lines 392, 489] — CCPA/GDPR open-question framing this story is the practical (not formal-legal-review) half of.
- [Source: supabase/migrations/20260726012050_create_djs_table.sql] — `djs` table shape, the `on delete cascade` FK this story's entire "today" deletion procedure relies on.
- [Source: supabase/migrations/20260727192439_add_djs_phone_column.sql] — confirms `phone` is the only other column on `djs` today.
- [Source: supabase/EMAIL-PROVISIONING.md] — the runbook-doc precedent (structure, voice, "status as of DATE" framing) this story's new file mirrors.
- [Source: supabase/README.md] — file-tree listing to extend; confirms `djs` is still the only DJ-owned table as of this story's creation.
- [Source: agent/src-tauri/src/store.rs, lines 6-8, 32, 219-225] — `local.sqlite` filename and `app_local_data_dir()` path, needed for the manual local-purge instruction.
- [Source: _bmad-output/implementation-artifacts/2-1-supabase-cloud-foundation-isolation-baseline.md, line 37] — Story 2.1's own forward note anticipating this story by name.
- [Source: _bmad-output/implementation-artifacts/2-10-agent-secure-token-storage.md, line 123] — Story 2.10's own forward note: *"2.11 (backlog) will eventually need this story's token/dj_id plumbing for its deletion runbook, not built here"* — confirms no deletion-detection exists in the in-progress auth code either.
- [Source: _bmad-output/implementation-artifacts/pre-launch-services-checklist.md, lines 47-48] — existing CCPA-review and Terms-of-Service/Privacy-Policy gaps this story is adjacent to but does not close (formal legal review and ToS/Privacy Policy docs remain separately tracked, out of this story's scope).

## Previous Story Intelligence

- **Story 2.10** (in-progress, most recent Epic 2 work): building agent-side auth/token storage (`agent/src-tauri/src/auth/`, `config.rs`) but explicitly does not build any deletion-detection or account-revocation-awareness — confirmed by reading its own task list. This story's local-agent-purge step must therefore be documented as manual, not automated, per the "Resolved before this story was written" ruling above.
- **Story 2.3d** (done): the direct structural precedent — a documentation/runbook-only story (production email delivery) with zero application code, explicit "doc accuracy, not live execution" completion bar, and forward-hooks flagged for gaps it doesn't own (no production domain/Supabase project at the time). This story follows the exact same shape.
- **Story 2.1** (done): built `public.djs` and its `on delete cascade` FK to `auth.users`, and explicitly flagged in its own Dev Notes that this is "a structural safety net one level up," not a replacement for this story's runbook — confirms this story's central "today's cascade is one step" finding was anticipated, not a surprise.
- **Story 2.3c** (done): established the precedent of running a real throwaway local verification (real signup, real DB query, cleanup after) rather than a hypothetical description — Task 3 of this story follows that same discipline.

## Git Intelligence Summary

- Commit convention to match: `Story 2.11: <what changed>` for the initial doc-only implementation (see `909b152`, `0750a2d` for the sibling pattern on other stories, adapted since this story has no code-review-round expected given zero application code — still run `bmad-code-review` per the standard cycle, since a runbook can still have factual/process errors worth a second pass).
- HEAD at story-creation time is `0e7b73f` ("Story 2.9c: Signed auto-updater pipeline, code review round"). The working tree also carries **uncommitted, in-progress Story 2.10 work** (`agent/src-tauri/src/auth/`, `agent/src-tauri/src/config.rs`, `web/app/link-agent/`, all untracked) — this is expected (2.10 is `in-progress` per sprint-status.yaml), not stray state to clean up. This story's own work (a new `supabase/` doc + two checklist edits) does not touch any of those in-progress files, so there is no merge/collision risk between 2.10 and 2.11's work.
- No `supabase/ACCOUNT-DELETION-EXPORT-RUNBOOK.md` or equivalent exists yet — genuinely new file.

## Story Completion Status

Ultimate context engine analysis completed - comprehensive developer guide created.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
