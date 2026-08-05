---
baseline_commit: d1192bd4949b0101da45d91b3464077d7d63faab
---

# Story 3.9: Console voice, failure register, agent-status states, a11y/responsive pass

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a DJ,
I want consistent console-voice copy, calm failure messaging, a dashboard that shows my agent's live sync state, and a verified accessibility/responsive pass across the logged-in surfaces,
so that the product feels like the "After-Hours Archive" — never celebratory, never alarmist — and tells me the truth about whether my sets are actually making it to the cloud.

## Context & scope discipline (read first)

This story was planned (epics.md §3.9) as a broad "polish pass" over everything built in 3.5–3.8. An audit (2026-08-04) found **most of that polish already happened organically** during 3.6/3.7/3.8. So this story is **NOT a rebuild** — it is:

1. **One genuinely new capability** — an **agent-status heartbeat** (agent → cloud → dashboard) so the dashboard can honestly render the three sync failure/queue states the UX spec (`EXPERIENCE.md`) places on "Dashboard status." This half of UX-DR19 was explicitly deferred in Story 3.3 and again in 3.3b because *no plumbing existed to expose local agent state to the web dashboard*. This story builds that plumbing. **(AC-1, AC-2 — the bulk of the work.)**
2. **A small copy addition** — the sync/format-drift Failure-Register strings, mirroring the already-shipped auth-copy module. **(AC-3.)**
3. **Verification-only passes** — confirm the no-celebration invariant and the already-present state patterns still hold, and run a formal a11y/responsive audit. Write **zero new UI** for these unless the audit surfaces a real defect. **(AC-4, AC-5.)**

> **⚑ Architecture amendment this story makes (Arjun, 2026-08-04).** The heartbeat introduces a **second agent→cloud write path**, which today's **AD-8** ("the agent's *only* write is the idempotent set sync") forbids. Arjun ruled: add it as a **narrow, named, sanctioned exception** — exactly the discipline AD-18/AD-19 already use for the Stripe webhook ("the one sanctioned AD-8 exception, scoped to billing columns only"). **Task 1 amends the spine with a new `AD-20`** before any code is written, so the invariant stays documented, not quietly broken. Do not skip Task 1.

> **⚑ Liveness ruling — beat-on-idle, "ride the loop" (Arjun, 2026-08-05).** The original AC-2 promised a stale heartbeat "degrades gracefully" but never defined *stale*, and a fire-on-change+dedup design makes staleness **undetectable** — an idle-but-alive agent's `updated_at` freezes and can't be told from a dead one. A code read (`agent/src-tauri/src/sync_queue.rs`) found `sync_loop` **already is a poll loop** (wakes every `BASE_INTERVAL` = 30s when idle, backing off to `MAX_INTERVAL` = 300s when failing). Ruling: **the heartbeat rides that existing tick — POST the current state on *every* drain pass, no dedup.** This adds no new timer/thread/dependency (it's *less* code than the dedup plan), and it is the only option where AC-2's "stale degrades gracefully" is actually true: a fresh `updated_at` becomes the liveness signal. **Cost accepted:** because the cadence is backoff-coupled (up to 300s when sync is failing), the staleness threshold is coarse — `STALE_AFTER = 600s` (2× `MAX_INTERVAL`, with margin), owned **web-side** (the agent stays dumb; the dashboard defines "stale"). A crisp sub-minute pulse was rejected: it needs a dedicated heartbeat loop, i.e. the new poll loop AD-20/Task 3 exist to avoid.

**Do NOT** in this story: add a dashboard banner for `drive-not-connected` (UX spec scopes it to **tray + Settings only** — EXPERIENCE.md State Patterns), rebuild any 3.6/3.7/3.8 component, touch the frozen `shared/` sync-payload contract (the heartbeat is a *separate* RPC, not a change to `sync_set`), or gate the heartbeat behind subscription status (AD-19: the agent is never billing-gated).

## Acceptance Criteria

**AC-1 — Agent-status heartbeat plumbing exists end-to-end.**
Given the running agent computes a tray state (`agent/src-tauri/src/tray.rs::TrayState` — one of Idle/Syncing/Failed/DriveNotConnected/Queued/FormatDriftPaused), **on every idle drain pass of the existing `sync_loop`** (not only on state change — 2026-08-05 beat-on-idle ruling above; `updated_at` is the liveness signal), the agent writes its current state to the cloud via a **new column-scoped `SECURITY DEFINER` RPC** (mirroring `sync_set`), the cloud persists it in a new per-DJ **`agent_status`** row (RLS: owner-SELECT only, no DJ write grant), and the web dashboard reads it. `dj_id` is derived from `auth.uid()` inside the function — never client-supplied. The heartbeat is **never gated by `subscription_status`** (AD-19). *(FR-4, FR-5, UX-DR19; AD-20 new)*

**AC-2 — The dashboard renders the three agent-status states in console voice.**
Given a fresh heartbeat, when the reported state is `Queued`, `Failed`, or `FormatDriftPaused`, then the dashboard status region shows the exact Failure-Register / State-Pattern copy — quiet inline, never a red alert, never a toast:
- `Queued` → **"Queued — will sync when you're back online."**
- `Failed` → **"Sync interrupted. Retrying automatically."**
- `FormatDriftPaused` → **"Format change detected — sync paused until verified."**

When the state is `Idle`/`Syncing`, the region is calm/quiet (a "Session: Syncing…" indicator or silence — no banner). `DriveNotConnected` is **not** surfaced on the dashboard (tray+Settings only, per spec). A **stale** heartbeat — `updated_at` older than `STALE_AFTER = 600s` (agent not reporting) — degrades gracefully: render nothing (or the same quiet not-reporting resolution as null), **never a crash, never a false "synced."** *(UX-DR18, UX-DR19)*

**Motion (2026-08-05 ruling — spec the feel, not just the copy):** this status region is the **first live-updating element on any logged-in surface** — every other logged-in surface is static. A state flip must therefore **settle/cross-fade in, never snap or slide in like a toast** — a quiet opacity/position settle under ~200ms; the calm states (Idle/Syncing) resolve to silence without a flash. Hold the same restraint the rest of the After-Hours Archive holds; do **not** reach for a default toast entrance (`transition: all`) that would undo the "never alarms you" invariant. *(UX-DR18, UX-DR20)*

**AC-3 — Failure-Register copy is centralized and verbatim.**
Given the new sync/drift copy, then it lives in a small web copy module mirroring `web/app/login/auth-copy.ts`, quoting `EXPERIENCE.md`'s Failure Register **verbatim** (no exclamation points, calm/technical). The already-shipped auth strings (`login-failed`, `email-already-registered`) are left as-is. `chart-failed` continues to fall through to the chart-summary line (already implemented in `DetailArc`) — confirm, don't rebuild. *(UX-DR18)*

**AC-4 — No-celebration invariant holds (verification).**
Given the product, then it contains no streak counters, celebratory badges, "you're crushing it," milestone confetti, or celebratory micro-interaction on any stat; and no core stat is gated behind an enrichment prompt (SM-C2, non-negotiable). This is a **verify-and-attest** AC — the audit found it already clean; confirm the new status region introduces no celebratory affordance and record the check. *(UX-DR18, UX-DR20)*

**AC-5 — WCAG 2.2 AA + responsive hold across logged-in surfaces (verification).**
Given the dashboard and set-detail surfaces (including the new status region), then: WCAG 2.2 AA holds (run an automated axe/lighthouse pass + manual focus-trap check on the floating nav, set-detail overlays, and the new status region); scroll-driven motion is absent on logged-in surfaces (confirmed absent in audit — re-confirm nothing new was added); and layout is the fixed centered 1100px grid adapting fluidly to tablet/phone (already in place via `--container-max`). Fix only real findings. *(UX-DR20, UX-DR21, UX-DR22)*

## Tasks / Subtasks

- [x] **Task 1 — Amend the architecture spine with AD-20 (do this first).** (AC: #1)
  - [x] In `_bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md`, add `AD-20 — Agent-status heartbeat is the second sanctioned agent write, status-column-scoped` (draft text in Dev Notes below). Cross-reference it from AD-8's rule line ("…except the AD-20 status heartbeat") and from the Consistency Conventions "Cloud mutation" row.
  - [x] Add `agent_status` to the entity-naming row / Capability→Architecture map so the new table is documented, not orphaned.

- [x] **Task 2 — DB: `agent_status` table + status RPC (additive migration).** (AC: #1)
  - [x] New migration `supabase/migrations/<ts>_create_agent_status.sql`: table `public.agent_status` — `dj_id uuid primary key references djs`, `sync_state text not null` (stores the `TrayState` string verbatim, `text` not enum — same pass-through discipline as `subscription_status`, AD-19), `updated_at timestamptz not null default now()`. RLS enabled; **owner-SELECT policy only**, null-safe: `auth.uid() is not null and auth.uid() = dj_id` (AD-7). **No insert/update grant to `authenticated`** (AD-8/AD-20 — the RPC is the only writer).
  - [x] `create function public.set_agent_status(sync_state text) returns void language plpgsql security definer set search_path = ''` — derive `caller := auth.uid()`, raise 42501 if null (copy the guard from `sync_set`), `insert into agent_status (dj_id, sync_state, updated_at) values (caller, sync_state, now()) on conflict (dj_id) do update set sync_state = excluded.sync_state, updated_at = excluded.updated_at`. **Grant execute only** (never a table write grant). Validate `sync_state` against the allowed set inside the function (reject unknown strings) so the column can't be poisoned.
  - [x] pgTAP test `supabase/tests/agent_status_isolation_test.sql` mirroring `sessions_sets_plays_isolation_test.sql`: cross-DJ SELECT isolation both directions; `authenticated` has zero direct write access (throws 42501); anon sees zero rows; the RPC upserts under the caller's own `dj_id` only and cannot write another DJ's row. Verify against local Supabase (`supabase db reset` + additive-only guard).

- [x] **Task 3 — Agent: write the heartbeat on state change.** (AC: #1)
  - [x] **Beat-on-idle, ride the loop (2026-08-05 ruling — no dedup).** In `agent/src-tauri/src/sync_queue.rs`, at the two points where `desired_tray_state()` is written through the coordinator (`handle_pass_outcome` ~L217 and the pass-level `Err` branch ~L170), POST the **current** state to `{SUPABASE_URL}/rest/v1/rpc/set_agent_status` **on every drain pass — do NOT dedupe against last-sent.** The existing `sync_loop` tick (`BASE_INTERVAL` 30s idle → `MAX_INTERVAL` 300s backoff) *is* the heartbeat cadence, so a fresh `updated_at` is the liveness signal the dashboard reads. **No new poll loop / timer / thread** — ride the loop that already runs (this is why the ruling is *less* code than a dedup, not more). Fire-and-forget — a failed heartbeat must **never** block or fail set sync, and must not spin a hot retry (the beat is bounded by the drain cadence, so it can't hot-loop by construction).
  - [x] Reuse the exact auth+POST pattern from `agent/src-tauri/src/sync.rs` (`get_valid_access_token` + `current_dj_id`, headers `apikey: SUPABASE_PUBLISHABLE_KEY` + `Authorization: Bearer <token>`, and the `debug_sync_base_url()` seam for tests). Do NOT invent a new HTTP client config.
  - [x] Map `TrayState` → the wire string via a single serialization point (extend `TrayState`, don't stringify ad hoc). Unit-test that each of the 6 variants serializes to the agreed string. *(No "does not re-POST on identical state" test — the ruling deletes dedup; the contract is now that every pass POSTs.)*

- [x] **Task 4 — Web: read + render the status region.** (AC: #2, #3)
  - [x] Add `getAgentStatus()` to the `@/lib/sets` data-access seam (sibling to `getRecentSets`, reading `agent_status` for the current DJ via `@/lib/supabase/server`). Returns the state + `updated_at`, or null (no agent yet / no row).
  - [x] **Staleness is owned web-side (2026-08-05 ruling).** Define `STALE_AFTER = 600s` (2× `MAX_INTERVAL`, with margin) in the web layer — the agent never knows what "stale" means, it just beats every drain pass. The banner treats a heartbeat whose `updated_at` is older than `STALE_AFTER` exactly like null (render nothing / quiet not-reporting), **never** as a live state and never as "synced." Compute staleness at read + on each Realtime/poll update so a formerly-fresh row goes quiet once it ages out.
  - [x] New copy module `web/app/(authenticated)/dashboard/status-copy.ts` (mirror `web/app/login/auth-copy.ts` exactly — header comment citing EXPERIENCE.md, `as const` map, verbatim strings). Map `Queued`/`Failed`/`FormatDriftPaused` → the three AC-2 strings.
  - [x] New `AgentStatusBanner` component under `web/app/components/dashboard/` — quiet inline region (reuse the new-set-nudge banner's visual register, not a modal/toast), rendered near the top of `dashboard/page.tsx`. Renders nothing for Idle/Syncing (or a quiet "Session: Syncing…" indicator) and nothing for DriveNotConnected/null/stale. Console voice, no color-alarm, no exclamation.
  - [x] **Live updates:** prefer a Supabase **Realtime** subscription on the DJ's `agent_status` row (AD-14 sanctions managed Realtime; avoids a poll loop). If Realtime is deferred for simplicity, a focus/interval poll is acceptable — document the choice. Either way the region updates without a full reload when state flips.

- [x] **Task 5 — Verify no-celebration invariant (AC-4).** (AC: #4)
  - [x] Grep the codebase for streak/badge/confetti/milestone/"crushing"/celebration language and confirm zero hits (audit baseline: zero). Confirm the new status region adds no celebratory affordance. Record the attestation in Completion Notes with the grep evidence.

- [x] **Task 6 — Formal a11y/responsive verification (AC-5).** (AC: #5)
  - [x] Run an automated pass (axe or lighthouse) on `/dashboard` and `/set/[id]` at desktop + 375px. Manually verify focus-trap/restore on the floating nav popover, set-detail drill-in overlays, and the new status region; confirm icon-only controls carry `aria-label`; confirm the primary-glow focus ring meets AA against `surface` and `surface-container` (EXPERIENCE.md flags the ~20% glow for a dedicated check).
  - [x] Confirm no scroll-driven motion exists on logged-in surfaces (grep `IntersectionObserver`/`useScroll`/`scrollYProgress`/parallax — audit baseline: none) and that the 1100px grid still collapses cleanly at the 900/640 breakpoints. Fix only real findings; log the results.

- [x] **Task 7 — Gate + verify.** (AC: all)
  - [x] Full local gate: agent `cargo fmt --check`/`clippy -D warnings`/`test`; workspace `pnpm lint`/`typecheck`/`test`; supabase pgTAP + `db reset` + additive-only guard. Playwright walkthrough of the dashboard with a fixture heartbeat in each of the three states, zero console errors.

## Dev Notes

### The exact copy (verbatim — do not paraphrase)

Source: `_bmad-output/planning-artifacts/ux-designs/ux-name-pending-2026-07-19/EXPERIENCE.md` (Failure Register + State Patterns + Voice and Tone tables).

| State | Dashboard copy | Surface per spec |
|---|---|---|
| Sync offline / `Queued` | `Queued — will sync when you're back online.` | Dashboard status + tray |
| Sync failed / `Failed` | `Sync interrupted. Retrying automatically.` | Dashboard status + tray |
| Format-drift / `FormatDriftPaused` | `Format change detected — sync paused until verified.` | Dashboard status + tray |
| Drive/USB / `DriveNotConnected` | `Archive unreachable — reconnect drive to resume.` | **Tray + Settings ONLY — no dashboard banner** |
| `Idle`/`Syncing` | quiet indicator (`Session: Syncing…`) or silence | Dashboard |
| Chart/data failed | falls through to chart-summary line (already built) | Set Detail / Style Evolution |

Console-voice do/don't (Voice and Tone table): "Initialize Session" / "Archive Insight" / "Session: Syncing…" / "Compared to your last 10 sets" / "Genre gap detected"; **silence when there's nothing to report**. Never: "Get Started!", "Awesome job!", "You're crushing it", streak counters, "🔥 5-day streak!" (SM-C2, non-negotiable). No exclamation points anywhere in the failure branch.

Already shipped (leave as-is): `web/app/login/auth-copy.ts` — `login-failed` → "Credentials not recognized — try again.", `email-already-registered` → "Account already archived — log in instead." (verbatim, unit-tested).

### Draft AD-20 text (for Task 1 — paste into ARCHITECTURE-SPINE.md after AD-19)

> **### AD-20 — Agent-status heartbeat is the second sanctioned agent write, status-column-scoped `[ADOPTED 2026-08-04]`**
> - **Binds:** FR-4, FR-5; UX-DR19's "Dashboard status" half; the agent write path; AD-8 (explicitly amended).
> - **Prevents:** the dashboard silently lying about sync health (no signal channel existed — deferred in Stories 3.3/3.3b); *and* an ad-hoc second agent write growing outside a named, column-scoped, RLS-safe boundary.
> - **Rule:** AD-8's "the agent's only write is the idempotent set sync" is amended to admit **exactly one** additional write: a compact **status heartbeat**. The agent writes its current tray state (Idle/Syncing/Failed/DriveNotConnected/Queued/FormatDriftPaused) through a single `SECURITY DEFINER` RPC (`set_agent_status`) that derives `dj_id` from `auth.uid()` and touches **only** the `agent_status` row's status columns — never `sets`/`plays`/overlays/billing. `agent_status` is per-DJ, owner-SELECT via RLS (AD-7), with **no DJ write grant** (the RPC is the only writer), mirroring AD-18/AD-19's webhook exception. The heartbeat is **fire-and-forget and never blocks or gates set sync**, carries no derived Serato data (AD-1/AD-2 untouched), does **not** change the frozen `shared/` sync-payload contract (AD-3 — it is a separate endpoint), and is **never gated by `subscription_status`** (AD-19 — a lapsed subscriber's agent still heartbeats). `sync_state` stores the tray-state string verbatim (`text`, not a DB enum), validated against the allowed set inside the RPC. The heartbeat **fires on every idle drain pass of the existing `sync_queue::sync_loop` — not only on state change** — so a fresh `updated_at` is the agent's liveness signal; this adds **no new poll loop** (it rides a loop that already runs at `BASE_INTERVAL` 30s → `MAX_INTERVAL` 300s). The agent is deliberately dumb about staleness: the **dashboard** owns the definition, treating a heartbeat older than `600s` (2× `MAX_INTERVAL`) as "not reporting," never as synced.

### The RPC + RLS pattern to mirror (don't reinvent)

`supabase/migrations/20260731120000_create_sync_set_function.sql` is the template: `security definer`, `set search_path = ''`, `caller_dj_id := auth.uid()` with a `42501` guard if null, `dj_id` **never** a parameter, `grant execute` only (no table write grant — the function runs as owner). RLS isolation pattern to copy: `supabase/migrations/20260730204057_create_sessions_sets_plays.sql` + its test `supabase/tests/sessions_sets_plays_isolation_test.sql` (19 pgTAP assertions — cross-DJ SELECT both directions, zero write access via `throws_ok(42501)`, anon sees nothing).

### Agent write path to mirror

`agent/src-tauri/src/sync.rs`: POST to `{SUPABASE_URL}/rest/v1/rpc/<fn>` with `.header("apikey", config::SUPABASE_PUBLISHABLE_KEY)` + `.header("Authorization", format!("Bearer {access_token}"))`; token via `auth::client::get_valid_access_token`, `dj_id` via `current_dj_id`. `debug_sync_base_url()` is the test seam (debug builds override the base URL). The state model already lives in `agent/src-tauri/src/tray.rs` (`TrayState`, 6 variants, `CYCLE`, `label()`) and `agent/src-tauri/src/sync_queue.rs::desired_tray_state()` — the heartbeat fires on the same transition edge that updates the tray icon. Serialize `TrayState` at **one** point (extend the enum), not with scattered `match` stringification.

### Current state of the four "verify" dimensions (audit 2026-08-04)

- **Console voice / no-celebration:** clean across dashboard/set-detail/nav — zero exclamation points, zero streak/badge/confetti hits. The one enrichment-gated element (`StatsColumn.tsx` "Venue · crowd · notes — coming with enrichment") is an `aria-hidden` placeholder for Story 5.5, gating **no current stat** — leave it.
- **State coverage already done (confirm, don't rebuild):** cold dashboard (`dashboard/page.tsx` awaiting-first-set hero), unknown-track ("Unknown track data" in `Tracklist.tsx`), sparse/whole-set fallback + chart-failed (`DetailArc.tsx` `ArcErrorBoundary` swaps in the caption), low-confidence note (`SetHeader.tsx`).
- **a11y/responsive largely done:** `--container-max: 1100px` used in `dashboard.css`/`set-detail.css`/`globals.css` with 900/640 breakpoints; `focus-visible` widespread; icon buttons carry `aria-label`; a 3.7 keyboard-focus bug already fixed (`StatsColumn.tsx` `aria-hidden` + `inert`); **no** IntersectionObserver/parallax anywhere. Missing only: a *formal* automated audit run + focus-trap re-verification (Task 6).

### Data-access + web structure

Dashboard reads through `@/lib/sets` (`getRecentSets`) and `@/lib/supabase/server` (`createClient`). Add `getAgentStatus()` as a sibling in that seam so the fixture/Supabase swap stays in one place (same discipline as Story 3.6's `getRecentSets/getSetById/deleteSet` seam). Dashboard components live in `web/app/components/dashboard/`; the new-set nudge banner is the visual register to match (inline, declinable, calm) — **not** a toast/modal.

### Scope boundaries (hard)

- **Frozen:** `shared/` sync-payload contract (AD-3/AD-15) — the heartbeat is a *separate* RPC, never a field on `sync_set`.
- **Not this story:** the agent tray *UI shell* (Story 2.5, still ready-for-dev) — the tray **state model** already exists and is all this story needs; do not build tray chrome here. Cloud re-sync of corrected keys (deferred). `drive-not-connected` dashboard banner (spec says tray+Settings only). Style Evolution / Library Utilization surfaces (Epic 4).
- **Never:** gate the heartbeat or set sync on `subscription_status` (AD-19); add a poll loop in the agent (use the tray transition edge); introduce any celebratory affordance (SM-C2).

### Project Structure Notes

- New files: one `supabase/migrations/<ts>_create_agent_status.sql`, one `supabase/tests/agent_status_isolation_test.sql`, one `web/app/(authenticated)/dashboard/status-copy.ts`, one `web/app/components/dashboard/AgentStatusBanner.tsx`, plus `getAgentStatus` in the existing `@/lib/sets` seam. Agent changes are additive to `tray.rs`/`sync_queue.rs` (+ a small heartbeat module if cleaner). Spine edit to `ARCHITECTURE-SPINE.md`.
- Migrations are **additive-only** (AD-15) — no drop/rename of a live column; the additive-only guard in CI must stay green.
- `agent_status` naming follows the plural/snake_case entity convention; but it is a **1:1 per-DJ status row** (PK = `dj_id`), not an event log — one row upserted, not appended.

### References

- Story text & ACs: `_bmad-output/planning-artifacts/epics.md#Story 3.9` (lines 739–750).
- Failure Register / State Patterns / Voice: `_bmad-output/planning-artifacts/ux-designs/ux-name-pending-2026-07-19/EXPERIENCE.md` (Voice and Tone, Failure Register, State Patterns, Accessibility Floor, Responsive & Platform tables).
- Architecture invariants: `ARCHITECTURE-SPINE.md` AD-1, AD-2, AD-3, AD-7, AD-8, AD-14, AD-15, AD-18, AD-19 (webhook-exception precedent), + the Consistency Conventions "Errors (agent)" / "Cloud mutation" rows.
- RPC template: `supabase/migrations/20260731120000_create_sync_set_function.sql`. RLS+test template: `supabase/migrations/20260730204057_create_sessions_sets_plays.sql`, `supabase/tests/sessions_sets_plays_isolation_test.sql`.
- Agent write pattern: `agent/src-tauri/src/sync.rs`. State model: `agent/src-tauri/src/tray.rs`, `agent/src-tauri/src/sync_queue.rs`.
- Copy-module pattern: `web/app/login/auth-copy.ts`. Dashboard: `web/app/(authenticated)/dashboard/page.tsx`, `web/app/components/dashboard/`.
- Deferral history this story closes: sprint-status.yaml session notes for Story 3.3 and 3.3b ("no plumbing exists to expose local queue state to a web/ dashboard").

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m] (Amelia / bmad-dev-story)

### Debug Log References

**D-1 — `set_agent_status` needed `#variable_conflict use_column` + a hoisted local.** The RPC's parameter must stay named `sync_state` (PostgREST maps the JSON body key to the argument *by name*), which collides with the real column name. plpgsql then refuses the `ON CONFLICT … DO UPDATE SET sync_state = …` target as ambiguous — the identical situation `sync_set` documents. Resolved the same way (`use_column`), plus the caller's argument is copied into a distinctly-named local (`requested_state`) in the DECLARE block so the pragma can never silently redirect a *read* of the argument to the stored column value. Verified by `supabase db reset` (parses) and a live PostgREST probe.

**D-2 — `clock_timestamp()`, not `now()` (deviation from the story's literal sketch).** `now()` is transaction start time and is constant within a transaction, so two beats inside one transaction would carry an identical `updated_at`. That makes the beat-on-idle contract untestable in the single-transaction pgTAP harness, and — more importantly — `updated_at` is a *liveness* signal, for which the wall-clock moment of the write is the honest value. The pgTAP test asserts an identical repeat state still moves `updated_at` forward, which fails under `now()`.

**D-3 — The beat is emitted once per loop iteration, not at the two coordinator-write sites the task text names.** Both named sites sit inside `if let Some(coordinator) = …` blocks in different branches. One call placed immediately after the `match` (where both branches have already settled the tray) makes "every drain pass beats exactly once" true *by construction* rather than by inspection, cannot drift between the two branches, and cannot double-beat. Same behaviour, one call site, less code — consistent with the ruling's own "less code than the dedup plan" framing.

**D-4 — The heartbeat reports `tray::current_tray_state`, not a re-derived `desired_tray_state`.** `desired_tray_state` deliberately returns `None` when the drive isn't known-connected, so it never overwrites `watch_loop`'s more specific `DriveNotConnected`. Re-deriving from it would therefore report a disconnected drive as whatever the backlog happened to look like. Reading the tray's actual current state is both simpler and the honest answer to "what is your agent doing" — the tray *is* that.

**D-5 — Two React-Compiler lint errors drove a better data shape.** `Date.now()` during a server-component render is an impure render call, and the "hand the client clock over after mount" effect was a synchronous `setState` in an effect. Both dissolved by moving the clock into the data layer: `getAgentStatus()` now returns `AgentStatusSnapshot { row, readAtMs }`, stamped at the read. Hydration then compares provably identical markup (server and client resolve against the same `readAtMs`), and staleness is re-evaluated by re-stamping `readAtMs` from a timer — no clock in render, no setState in an effect body.

**D-6 — `no-hardcoded-colors.test.ts` flags the word "red" inside multi-line comments.** Its comment stripper only handles single-line `/* … */`, so prose inside a block comment is scanned as code. Two comments reworded ("an alarm colour"); no behaviour change. Worth knowing before writing CSS comments in this repo.

**D-7 — Focus restore on set-detail overlays was broken three ways, not one (AC-5 finding, pre-existing Story 3.7).** Instrumented with a temporary console probe rather than guessed at, after the first hypothesis proved wrong. The probe showed: (a) the capture effect was declared *after* the focus-the-back-button effect, so it read `document.activeElement` once focus had already moved into the veil; (b) React StrictMode mounts→unmounts→remounts effects in dev, and the remount re-captured the veil's own back button; (c) — the one that survived fixing (a) and (b) — at cleanup time the stats stack behind the veil still carried `inert`, and `focus()` inside an `inert` subtree is a **silent no-op**. Fixed by capturing once (`??=`), declaring the capture first, and restoring on the next frame with an `isConnected` + `:not([inert])` check. The next-frame check also makes StrictMode's simulated cleanup harmless: the veil is still open then, so the restore correctly declines to yank focus out of it. Verified for all three drill-ins by keyboard and mouse.

### Completion Notes List

**AC-1 — heartbeat plumbing, end to end. Done.** `agent_status` (PK `dj_id`, `sync_state text`, `updated_at timestamptz`), RLS enabled, **owner-SELECT policy only**, null-safe (`auth.uid() is not null and auth.uid() = dj_id`), and **no insert/update/delete grant to `authenticated`** — the `SECURITY DEFINER` `set_agent_status(sync_state text)` RPC is the only writer, deriving `dj_id` from `auth.uid()` (never a parameter) and validating the state against the six-variant allow-list inside the function. Proven live over real PostgREST, not just in-transaction: valid state → `204`, poisoned state → `400 / 22023`, anon read → `[]`. Full chain confirmed in a browser — RPC write → RLS-scoped row → rendered dashboard copy. Nothing in the agent path reads `subscription_status` (AD-19), the `shared/` contract is untouched (separate RPC, AD-3), and no new timer/thread/poll loop was added.

**AC-2 — the three states in console voice. Done, verified in a real browser at 1440 and 375.** Every branch of the state matrix exercised against live data: `Queued`/`Failed`/`FormatDriftPaused` render their verbatim lines; `Syncing` renders the quiet `Session: Syncing…` indicator; `Idle` and `DriveNotConnected` render **nothing** (and "Archive unreachable" appears nowhere on the dashboard — tray+Settings only, per spec); a stale heartbeat renders nothing on both the client-update and server-render paths, with no leak of the last-known state and no false "synced." State flips were confirmed to update **without a reload**. The staleness rule also proved itself unprompted: a heartbeat left sitting during the session aged past 600s on its own and the region went quiet exactly as designed.
*Motion:* a ~180ms opacity settle with 2px of travel, named properties only (never `transition: all`), `AnimatePresence mode="wait"` so a swap cross-dissolves through nothing rather than pushing the viewport-locked layout, reduced-motion hard-cut via `useReducedMotion` + `MotionConfig`. Silence is a true absence — the element leaves the DOM, contributing no height and no flex gap.
*A11y:* `role="status"` (polite). Verified that a state flip while a set-list row held focus left `document.activeElement` **completely unchanged** and still `:focus-visible`, and that the region is not in the tab order.

**AC-3 — copy centralized and verbatim. Done.** `status-copy.ts` mirrors `auth-copy.ts` (header comment citing EXPERIENCE.md, `as const` map, verbatim strings). Character-exact assertions including em dashes and the curly apostrophe, plus tests that no line carries an exclamation point or celebratory language. Auth strings untouched. `chart-failed` confirmed still falling through to `DetailArc`'s chart-summary caption — not rebuilt.

**AC-4 — no-celebration invariant. Verified and attested.** Grep over `web/app`, `web/lib`, `agent/src-tauri/src`, `shared/src` for `streak|confetti|badge|milestone|crushing|awesome|great job|nice work|congrats|well done|keep it up|🔥|🎉|🎊|🏆|⭐|celebrat` returned **7 hits, all confirmed false positives by reading each one**: 3 are comments asserting the invariant itself; `auth-biometric-badge` (×2) is the fingerprint pill on the login screen, a UI affordance not an achievement; `streaks` in `FloatingNav.tsx` describes the LiquidMetal shader's specular highlights. Zero genuine hits. The new status region adds no celebratory affordance — it has no icon, no count, no colour, and its *healthy* state is silence (a working sync is deliberately not news). The `StatsColumn` enrichment placeholder remains `aria-hidden` and gates no current stat.

**AC-5 — WCAG 2.2 AA + responsive. Verified; two real defects found and fixed, one deferred by scope.**
Automated: axe-core 4.12.1, full WCAG 2.0/2.1/2.2 A+AA rulesets, on `/dashboard` and `/set/[id]` at 1440×900 and 375×812 — **zero violations on three of the four runs**, no horizontal overflow at 375 on either surface, zero console errors.
- **Fixed (real finding, 375px):** the hero band's absolutely-positioned circular "open set" arrow **occluded the third stat** — `119` rendered as `11`. Not clipping (`scrollWidth == clientWidth`) but overlap, which is why nothing overflowed and no automated rule caught it. A dashboard whose premise is telling a DJ the truth about their numbers must not eat one. Fixed by reserving the arrow's footprint on `.dz-hero-stats` at ≤640px; measured before/after (stat right edge 263 vs arrow left edge 279, zero overlapping rects) and confirmed desktop is byte-for-byte unaffected (`padding-right: 0px` above the breakpoint).
- **Fixed (real finding, focus management):** set-detail drill-in overlays dropped focus to `<body>` on close instead of returning it to the stat that opened them (WCAG 2.4.3). Root-caused by instrumentation, not assumption — see D-7. All three drill-ins now restore to the exact trigger, still `:focus-visible`, by keyboard and mouse.
- **Deferred, not silently ignored:** `.sd-reserved-copy` ("Venue · crowd · notes — coming with enrichment") measures **1.89:1** against a 4.5:1 requirement at 375px. It is a genuine AA contrast failure on visible text. I did **not** change it: the story's own audit explicitly rules this element out of scope ("an `aria-hidden` placeholder for Story 5.5, gating no current stat — leave it"), and raising it to 4.5:1 would make a "coming later" placeholder as prominent as real data, which fights the design intent. **This wants an explicit ruling from Arjun** — either accept it as decorative or hand it to Story 5.5 with a treatment decision.
Manual: focus-trap/restore verified on set-detail overlays (focus enters the veil, background goes `aria-hidden` + `inert`, Escape closes, focus returns to trigger) and on the new status region (never steals focus, not in tab order). The floating nav is a `<nav aria-label="Primary">` of labelled links with `aria-current="page"` and `aria-hidden` decorative spans — it has **no** popover/dialog, so there is no trap to verify (correct by construction, not a gap). Zero icon-only controls missing an accessible name on either surface. Scroll-driven motion: grep for `IntersectionObserver|useScroll|scrollYProgress|parallax|animation-timeline|scroll-timeline|view-timeline` across `web/app` + `web/lib` returns **zero hits** — baseline holds. The 1100px grid still collapses cleanly at 900/640.
Contrast measured empirically from composited screenshot pixels (axe returns `color-contrast` as *incomplete* across this design — 95 nodes — because the WebGL silk backdrop and glass pseudo-elements make the effective background undeterminable to static analysis): status **report** tone **8.57–9.75:1**, status **activity** tone **4.96–5.43:1** (both ≥ the 4.5:1 AA floor), and the primary-glow focus ring **4.94:1** against `surface-container` / **5.58:1** against `surface` (≥ the 3:1 non-text floor) — closing the dedicated check EXPERIENCE.md flags for the ~20% glow. The indicator carrying that ratio is the 2px solid accent border; the glow is decoration on top.

**Gate (Task 7) — all green.** Agent: `cargo fmt --check` clean, `clippy -D warnings` clean, **358 tests pass** (13 new: 3 tray wire-contract, 5 heartbeat, plus existing). Workspace: `pnpm lint`, `pnpm typecheck`, `pnpm test` — **146 tests pass** (126 web incl. 23 new, 20 shared). Supabase: `db reset` applies cleanly from scratch, **84 pgTAP assertions pass** across 4 files (22 new), additive-only guard passes (32/32 of its own self-tests too). Playwright walkthrough of the dashboard driven through every heartbeat state at both viewports: **zero console errors**.

**Scope discipline held.** No 3.6/3.7/3.8 component was rebuilt — the two AC-5 fixes are a 3-line CSS media query and a ~10-line focus-restore correction, both surgical. `shared/` untouched (verified: no agent/shared contract change, so shared's 20 tests are unaffected). No `drive-not-connected` dashboard banner. No celebratory affordance. The heartbeat is never gated on `subscription_status`.

**One documented design choice.** Live updates use a **focus + visible-tab poll (60s) through a server action**, not Supabase Realtime — the story explicitly permits either. Rationale recorded in `status-actions.ts`: Realtime would mean this codebase's first `postgres_changes` subscription, a publication change, and client session-token plumbing, in exchange for latency the signal cannot use (the agent beats every 30–300s; the staleness window is 600s — a 60s poll is already finer-grained than the thing it observes). Routing through a server action also keeps `getAgentStatus` the single place that touches the table.

### File List

**New**

- `supabase/migrations/20260805120000_create_agent_status.sql` — `agent_status` table (owner-SELECT RLS, no write grant) + `set_agent_status` SECURITY DEFINER RPC
- `supabase/tests/agent_status_isolation_test.sql` — 22 pgTAP assertions (isolation both directions, zero direct write access, anon blind, allow-list, no-dedup liveness)
- `agent/src-tauri/src/heartbeat.rs` — the beat: `StatusClient` trait, `SupabaseStatusClient`, `beat()`, 5 unit tests
- `web/lib/sets/agentStatus.ts` — wire-state list, `STALE_AFTER_MS`, `AgentStatusSnapshot`, pure `resolveAgentStatus`
- `web/lib/sets/agentStatus.test.ts` — 13 tests (staleness boundary, clock skew, unknown state, unparseable time)
- `web/app/(authenticated)/dashboard/status-copy.ts` — verbatim Failure-Register copy + `agentStatusLine`
- `web/app/(authenticated)/dashboard/status-copy.test.ts` — 10 tests (character-exact copy, no exclamations, no celebration, silence mapping)
- `web/app/(authenticated)/dashboard/status-actions.ts` — server action for live re-reads (+ the documented poll-vs-Realtime rationale)
- `web/app/components/dashboard/AgentStatusBanner.tsx` — the quiet inline region

**Modified**

- `_bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md` — AD-20 added; AD-8 rule line, Consistency Conventions "Cloud mutation" + "Entity naming" rows, Capability→Architecture map, data-model paragraph, ER diagram, `updated:` date
- `agent/src-tauri/src/lib.rs` — `pub mod heartbeat`
- `agent/src-tauri/src/tray.rs` — `TrayState::wire_state()` (single serialization point), `current_tray_state()`, 3 tests
- `agent/src-tauri/src/sync.rs` — `debug_sync_base_url()` now `pub(crate)` so the heartbeat shares one notion of "where the cloud is"
- `agent/src-tauri/src/sync_queue.rs` — one `beat_status(&app)` per drain pass + the helper
- `web/lib/sets/index.ts` — `getAgentStatus()` (lazy `next/headers` import, resilient-not-gating)
- `web/app/(authenticated)/dashboard/page.tsx` — reads the snapshot, renders the banner
- `web/app/dashboard.css` — `.dz-agent-status` (+ `--report`), and the AC-5 hero-stats/arrow overlap fix at ≤640px
- `web/app/components/set-detail/Overlays.tsx` — AC-5 focus-restore fix (capture-once + next-frame, inert-aware)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status + session note
- `_bmad-output/implementation-artifacts/3-9-console-voice-failure-register-state-a11y-responsive-pass.md` — this file

### Change Log

- **2026-08-05** — Story 3.9 implemented. AD-20 adopted into the spine *first* (Task 1, load-bearing). Agent-status heartbeat built end to end: additive `agent_status` migration + column-scoped `set_agent_status` RPC (22 pgTAP assertions), beat-on-idle heartbeat riding the existing `sync_queue::sync_loop` with no dedup and no new loop, web-side staleness (`STALE_AFTER = 600s`) and a quiet console-voice status region with sub-200ms settle motion. Failure-Register copy centralized verbatim. AC-4 no-celebration verified (7 grep hits, all confirmed false positives). AC-5 audited with axe-core 4.12.1 at 1440 and 375 on both logged-in surfaces: **two real defects found and fixed** — the hero arrow occluding the third stat at 375px, and set-detail overlays dropping focus to `<body>` on close (WCAG 2.4.3) — and one pre-existing contrast finding (`.sd-reserved-copy`, 1.89:1) deliberately **deferred with a flag for Arjun's ruling**, since the story scopes that element to Story 5.5. Full local gate green.
