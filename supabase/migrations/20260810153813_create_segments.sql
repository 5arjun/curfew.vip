-- Migration: create_segments
-- Story 5.1 — Segments overlay schema (AC-1, AC-2, AC-3)
--
-- `segments` is a cloud-only, web-authored overlay table: a DJ (or, later,
-- Story 5.2's detection algorithm running cloud-side) marks a contiguous
-- span of a set's `plays` as a labeled segment (dancefloor/dinner/
-- performance/custom). AR-8 forbids the agent ever writing this table, so
-- this migration -- like 3.1's `sessions`/`sets`/`plays` and `sets.
-- visibility` before it -- ships schema-only: RLS SELECT-own-row policy,
-- zero INSERT/UPDATE/DELETE grant or policy. See the story file's Dev Notes
-- ("Why no write grants yet") for why that gap is deliberate, not an
-- oversight, and matches `sets.visibility`'s own precedent exactly.
--
-- `first_play_id`/`last_play_id` reference actual `plays` rows rather than
-- a timestamp or position-range pair -- see the story file's Dev Notes
-- ("Why FK-pair boundaries, not timestamp or position columns") for the
-- full reasoning (5.3's mental model, 5.4's join shape, no derived-value
-- duplication, ties eliminated by construction).
create table public.segments (
  id             uuid primary key default gen_random_uuid(),
  set_id         uuid not null references public.sets (id) on delete cascade,
  dj_id          uuid not null references public.djs (id) on delete cascade,
  type           text not null check (type in ('dancefloor', 'dinner', 'performance', 'custom')),
  label          text,
  first_play_id  uuid not null references public.plays (id) on delete cascade,
  last_play_id   uuid not null references public.plays (id) on delete cascade,
  created_at     timestamptz not null default now(),
  check ((type = 'custom' and label is not null and label <> '') or (type <> 'custom'))
);

-- `dj_id` is denormalized directly onto `segments` (not just reachable via
-- a `set_id` join), matching AD-7 and the exact pattern `sessions`/`sets`/
-- `plays` already established in 3.1 -- RLS stays a fast direct-column
-- comparison, never a join-based policy.
--
-- No `source`/`status`/`confirmed` column: every row this schema can
-- create today is confirmed by construction (nothing writes an unconfirmed
-- row until Story 5.2's detection algorithm exists) -- see the story
-- file's Dev Notes ("Why no suggested/confirmed state yet") for why that
-- shape is deliberately left for 5.2 to add, additive-only, rather than
-- speculated here.
alter table public.segments enable row level security;

-- The hosted auto-expose trap (see `20260807140000_harden_table_and_
-- function_grants.sql` for the incident this guards against): the hosted
-- Supabase project runs the legacy `auto_expose_new_tables` behaviour,
-- which auto-grants the FULL privilege set (DELETE, INSERT, REFERENCES,
-- SELECT, TRIGGER, TRUNCATE, UPDATE) to BOTH `anon` and `authenticated` on
-- every newly created table, silently, regardless of what this migration
-- file itself grants. Local `supabase db reset` does NOT reproduce this
-- (the modern not-auto-exposed default applies locally), so the local
-- pgTAP suite alone cannot catch it. `revoke all` before the intended
-- `grant select` in this SAME migration -- not a later hardening pass --
-- is what keeps `segments` from repeating that incident.
revoke all on public.segments from anon, authenticated;

-- RLS only narrows rows; Postgres still requires the base table GRANT
-- before a role can query it at all -- without this, `anon`/`authenticated`
-- get a hard "permission denied" instead of an RLS-filtered result. `anon`
-- SELECT is intentional (same reasoning as `djs`/`sessions`/`sets`/`plays`):
-- a signed-out request should get an RLS-filtered empty result, not a
-- permission error.
grant select on public.segments to authenticated, anon;

create policy "segments_select_own" on public.segments
  for select using (auth.uid() is not null and auth.uid() = dj_id);

-- Deliberately no INSERT/UPDATE/DELETE grant or policy in this migration.
-- This story is schema-only (see Scope Boundaries in the story file):
-- Story 5.2 (algorithm-written suggestions, cloud-side) and Story 5.3 (DJ
-- drag/keyboard editing) design the actual write paths and their grants
-- when they exist. `sets.visibility` is the precedent this deliberately
-- follows -- web-authored, DJ-direct, RLS-shaped, and still ungranted
-- seven stories after it shipped.
