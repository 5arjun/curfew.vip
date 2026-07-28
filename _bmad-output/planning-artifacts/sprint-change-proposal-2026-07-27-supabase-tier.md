# Sprint Change Proposal: Supabase free tier at launch (defer PITR + preview branching)

**Date:** 2026-07-27
**Raised by:** Arjun
**Facilitated by:** bmad-correct-course

## 1. Issue Summary

While setting up Resend for production email delivery (Story 2.3d), Arjun asked whether to also create a Supabase account now. That surfaced a standing assumption in the plan: the Architecture Spine, `epics.md` (AR-12), Story 2.1's AC-1, and `supabase/PROVISIONING.md` all assume the Supabase **paid (Pro) tier** is required, specifically for two features — point-in-time-recovery (PITR) backups and per-PR preview branching.

Arjun wants to start the Supabase prod project on the **free tier** instead, deferring the Pro-tier upgrade (and its cost) until later.

**Evidence gathered (2026-07-27, against supabase.com/pricing and Supabase's usage docs):**
- Free tier includes **neither** PITR **nor** branching — both are listed "Not included," not merely more expensive.
- Pro tier ($25/mo base) unlocks both: branching is separately metered (~$0.013/branch-hour), PITR is a further $100/mo add-on (7-day retention).
- A free-tier project **pauses after 7 days of inactivity** and needs a manual unpause — a new operational fact worth knowing, not previously documented anywhere in this repo.
- This confirms (rather than overturns) the existing docs' own paid-tier claim — the change here is a **decision to defer** that requirement, not a correction of a wrong fact.

## 2. Impact Analysis

**Epic impact:** Contained to Epic 2. No epic becomes obsolete, none are added, no resequencing. The single concrete hit is **Story 2.1 (`done`)**, whose AC-1 currently asserts preview branching gets set up as part of that story — no longer true under a free-tier-first plan. Stories 2.10 and 3.2 (the first real cloud consumers) are unaffected either way — a free-tier project still provides a working Postgres/Auth/Realtime backend; those stories never depended on branching or PITR specifically.

**Artifact conflicts:**
- **PRD:** none. No NFR (NFR-1–5) mandates PITR or branching by name; the "Backup/DR" language lives only in the Architecture Spine, not the PRD. MVP is unaffected.
- **Architecture Spine:** the "Deployment & environments" note, the "Backup / DR" note, and Open Question #7 (marked RESOLVED under the old paid-tier assumption) all need rewording to reflect free-tier-first.
- **epics.md:** AR-12's wording and Story 2.1 AC-1's wording both assert preview branching as delivered; both need amending.
- **`supabase/PROVISIONING.md`:** step 1 (billing/tier language) and step 2 (branching setup) need rewriting to a free-tier-first sequence.
- **`pre-launch-services-checklist.md` §3:** the Supabase row's "Paid tier required" line needs updating with the confirmed current pricing facts and the free-tier caveat.
- **`2-1-supabase-cloud-foundation-isolation-baseline.md`:** the already-`done` story file needs a Change Log entry so its AC-1 doesn't read as silently inaccurate.
- **UI/UX:** none.
- **Other (CI, deploy):** none — `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF` were never wired into CI regardless of tier (explicitly deferred in `PROVISIONING.md` §4), and `supabase/EMAIL-PROVISIONING.md` (Story 2.3d)'s Dashboard-based SMTP wiring is identical on either tier.

## 3. Recommended Approach

**Option 1 — Direct Adjustment (recommended and selected).** Amend wording across the six artifacts above to reflect free-tier-first; no code changes, no rollback, no PRD/MVP change. Effort: Low. Risk: Low — this is a documentation/planning correction, not a re-architecture. The actual Story 2.1 code (RLS policies, `djs` table, migration guard) never depended on branching or PITR; only the runbook prose and one AC line did.

**Option 2 — Rollback:** not applicable. Nothing was built against the paid-tier assumption that needs undoing.

**Option 3 — MVP/PRD review:** not applicable. No NFR or MVP scope item is implicated.

## 4. Detailed Change Proposals

*(Full before/after text for each of the six files was presented to and approved by Arjun in conversation prior to this document; summarized here for the record.)*

1. **ARCHITECTURE-SPINE.md** — reword the "Environments & migrations" and "Backup / DR" deployment notes, and Open Question #7, to state free-tier-first with PITR/branching deferred to a future Pro-tier upgrade; note that CI's existing `supabase start` ephemeral-Postgres job is sufficient per-PR verification until then.
2. **epics.md** — reword AR-12 and Story 2.1's AC-1 to describe a free-tier prod project with preview branching deferred, replacing the "gets its own preview branch" assertion.
3. **supabase/PROVISIONING.md** — step 1: free tier, no billing plan needed yet, note the 7-day inactivity pause; step 2: connect GitHub now (free), explicitly skip enabling branching, document re-enabling it after a future Pro upgrade.
4. **pre-launch-services-checklist.md** — update the Supabase row to state free-tier-first with the confirmed current Pro-tier costs (PITR $100/mo add-on, metered branching) and the inactivity-pause caveat.
5. **2-1-supabase-cloud-foundation-isolation-baseline.md** — add a 2026-07-27 Change Log entry recording the AC-1 wording revision; story `Status` remains `done` (not reopened).
6. **supabase/EMAIL-PROVISIONING.md** — no change (confirmed tier-independent).
7. **SOLUTION-DESIGN.md** — reword §7's "Environments" bullet to match ARCHITECTURE-SPINE.md's free-tier-first wording (preview branches + PITR deferred to a future Pro-tier upgrade).

## 5. Implementation Handoff

**Scope classification: Minor.** Documentation-only wording changes across six files, already drafted and approved; no code, no schema, no CI change. Implemented directly in this session (no separate Developer-agent handoff needed).

**Success criteria:** all six files reflect free-tier-first Supabase, PITR/branching explicitly deferred (not silently dropped), and the current Supabase pricing facts are dated so a future reader knows to re-verify before relying on them — consistent with this repo's existing practice of dating vendor-pricing claims.
