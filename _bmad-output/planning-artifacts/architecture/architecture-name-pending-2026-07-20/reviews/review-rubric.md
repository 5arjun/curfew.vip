# Rubric Review — ARCHITECTURE-SPINE.md (Curfew)

**Reviewer role:** rubric judge against the fixed good-spine checklist.
**Target:** `architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md`
**Cross-checked against:** PRD (FR-1..FR-29), addendum.
**Date:** 2026-07-20

**Verdict: ADEQUATE** — strong, well-constructed core seam; three operational-envelope / evolution gaps to close before build. No FAILs.

| # | Item | Rating |
| --- | --- | --- |
| 1 | Fixes real divergence points for the level below, misses none | WEAK |
| 2 | Every AD's Rule enforceable + Prevents↔Rule holds | PASS |
| 3 | Nothing load-bearing hidden under Deferred | WEAK |
| 4 | Named tech verified-current (note only) | PASS (note) |
| 5 | Covers driving spec — every FR has a home | PASS |
| 6 | No whole dimension left silent (esp. operational envelope) | WEAK |
| 7 | Conventions + Stack complete enough that two builders won't drift | WEAK |

---

## Item 1 — Fixes the real divergence points for the level below; misses none. **WEAK**

The seam is genuinely well-fixed: dependency direction (mermaid + Rule), the single versioned `shared/` contract (AD-3), deterministic idempotent `set_id` (AD-4), store ownership (AD-5), one-way content flow (AD-6), and one-account auth (AD-10) each nail a concrete way the two units could diverge. Monorepo-to-prevent-contract-fork is the right lever.

**Gap:** the spine versions the sync contract but never states how the **cloud accepts payloads from a heterogeneous agent fleet**. AD-13's own backfill story and the signed auto-updater imply older `agent_version`s keep running in the wild and keep syncing. AD-3 says "single versioned schema… `agent_version` on every set" but gives no forward/backward-compatibility rule — so two builders could legitimately disagree on whether the cloud rejects, coerces, or dual-reads an older payload shape during a rollout. This is a real divergence point one level below (agent fleet ↔ cloud endpoint), left open.

**Fix:** add a one-line rule to AD-3 — contract evolves additive-only and the cloud accepts the last N schema versions (mirrors the taxonomy_version pattern already in AD-12).

## Item 2 — Every AD's Rule is enforceable and prevents its stated divergence. **PASS**

Walked all 15. Each Prevents↔Rule link holds:

- AD-1 (edge computes) — the cross-DJ scene-aggregate exception is explicitly carved, so the "no server recompute" rule doesn't accidentally forbid FR-24/25. Good.
- AD-2/AD-3/AD-4 — mechanically enforceable (fs capability scoping, contract tests both sides, idempotent PUT on deterministic key). Strongest links in the doc.
- AD-5/AD-6 — store-of-record and one-way-flow rules directly close the two-owner and bidirectional-conflict holes they name.
- AD-7/AD-8/AD-9 — RLS null-safe predicate, "no custom mutation server," and play-inherits-set-visibility each prevent their stated leak at the DB layer, not the UI.
- AD-10/AD-11/AD-12/AD-13/AD-14 — all enforceable, with AD-11 (two-path parser, both DB formats, Unknown fallback) and AD-13 (three layers + backfill) especially tight.
- AD-1 and AD-15 lean on discipline more than a mechanism, but both are concretely backed (paradigm + schema-shape constraints), so they clear the bar.

## Item 3 — Nothing under Deferred could let two units diverge. **WEAK**

Most deferrals are safely isolated (live mode, pg_graphql, microservice seams, self-hosting, message queue, Rekordbox, reverse-geocoding provider) — none of those governs the seam.

**Finding:** **"Dev/staging/prod topology + DB migration strategy"** sits in Deferred (`[ASSUMPTION]`) and Open Questions #7, but the **DB migration strategy is load-bearing for AD-15** — AD-15's entire invariant is "Phase 2 *adds* fields / RLS policies… never restructures." That promise is only real if there's an agreed additive-migration mechanism; without one, two builders can diverge on how a schema change actually ships (and whether it stays additive). It is surfaced honestly rather than hidden, which keeps this WEAK not FAIL — but a spine that makes "additive-only" an invariant shouldn't defer the mechanism that enforces it.

**Fix:** promote a minimal migration convention (e.g. forward-only additive migrations, one tool, versioned) into the spine body as the enforcement arm of AD-15.

## Item 4 — Named tech is verified-current (note only). **PASS (note)**

Deferring depth to the version reviewer. Notes: Next.js **16** and Supabase/Tauri 2 are plausible for 2026-07; several rows read "current" / "stable" rather than pinned (React/TypeScript, id3 crate, Supabase) — acceptable for a seed stack, but the version reviewer should confirm Next.js 16 is real/stable and that `triseratops` MPL-2.0 + pin guidance still holds. The doc already flags code-signing pricing as unverified, which is the right instinct.

## Item 5 — Covers the driving spec's capabilities; every FR has a home. **PASS**

Cross-checked the Capability→Architecture Map against FR-1..FR-29 exhaustively. **All 29 map to a home**, no orphans:

- FR-1–FR-5, FR-27 → agent (parsing/sync)
- FR-6–FR-13, FR-15 → agent compute → web render
- FR-14, FR-16–FR-18, FR-28 → agent suggest + web overlays
- FR-19–FR-21, FR-26 → web + Realtime
- FR-22, FR-23 → Supabase RLS + web
- FR-24, FR-25 → in-cloud SQL (correctly routed through AD-1's scene-aggregate exception)
- FR-29 → web + Supabase Auth

The map even carries phase tags consistent with PRD §9. Clean.

## Item 6 — No whole dimension left silent; operational/environmental envelope. **WEAK**

Most of the envelope is present: deployment table (agent/web/backend/CI), provider strategy (Supabase+Vercel+GitHub, self-host deferred), security (RLS AD-7/8, auth AD-10, HTTPS, capability scoping), data-integrity (AD-4 idempotency, AD-12 taxonomy versioning, AD-13 golden-file + backfill, Unknown convention), and cost (near-zero marginal + signing fixed cost). Environment separation + migration are deferred **but surfaced** (`[ASSUMPTION]` + Open Question), which counts as addressed, not silent.

**Genuinely silent sub-dimensions:**

1. **Abuse / rate-limiting on public write surfaces.** The idempotent `PUT /sets/:id` and all Phase 2 social writes are internet-facing, and AD-8 deliberately forbids a custom mutation server — so every abuse control leans on Supabase/PostgREST defaults. The spine never says so. For a platform-altitude spine, "how the public sync endpoint and social writes are protected from flooding/abuse" is a legitimate dimension, left blank.
2. **Cloud backup / disaster recovery.** Postgres is the cross-device system of record (AD-5), yet DR/backup ownership is unstated. Supabase-managed likely covers it, but "the system of record's durability is the provider's default" should be an explicit decision, not an inference.

**Fix:** add a line each — abuse/rate-limit posture (even "rely on Supabase defaults + PostgREST row limits, revisit at scale") and backup/DR ownership.

## Item 7 — Conventions + Stack complete enough to prevent naming/id/date/error/auth drift. **WEAK**

Strong on the axes the checklist names: entity naming (plural snake_case, Session vs Set disambiguated), IDs (UUID, deterministic set_id, dj_id = auth.uid()), dates (UTC ISO-8601, played_at sourced from file), auth/tokens (JWT + Tauri secure storage), Unknown-data rendering. Two builders will not drift on those.

**Gaps on the error and enum axes:**

- **Errors** — the convention covers only *agent-side* error reporting (tagged `agent_version`, calm copy). The **wire/API error contract** — what the sync endpoint and PostgREST writes return on failure, and how the web client interprets it — is unspecified. "Errors" is explicitly a checklist axis; only half of it is conventionalized.
- **Enum value sets** — visibility tiers (`public`/`friends-only`/`private`) and segment types (`dancefloor`/`dinner`/`performance`) appear in prose but aren't fixed as canonical stored values, inviting drift between the agent/DB/UI on exact strings.

**Fix:** add a cloud/API error-response convention row and pin the canonical enum values for visibility tiers and segment types.

---

## Summary of findings (actionable)

1. **[Item 1/7]** AD-3: state additive-only contract evolution + cloud accepts last-N `agent_version`s (heterogeneous fleet from AD-13 backfill).
2. **[Item 3/6]** Promote a minimal additive DB-migration mechanism into the spine as AD-15's enforcement arm; currently deferred though load-bearing.
3. **[Item 6]** Name the abuse/rate-limit posture on the public sync + social write paths, and backup/DR ownership for the cloud system of record.
4. **[Item 7]** Add a wire/API error-response convention (only agent errors are conventionalized) and pin canonical enum values (visibility tiers, segment types).

No FAILs. The seam, the ADs, and FR coverage are strong; the open edges are the operational envelope (abuse, DR) and evolution mechanics (contract versioning, migrations) — exactly the dimensions a build-substrate spine should close before code starts.
