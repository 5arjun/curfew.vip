-- Migration: create_agent_status
-- Story 3.9 — Agent-status heartbeat plumbing (AC-1), AD-20.
--
-- The signal channel Stories 3.3 and 3.3b twice deferred for want of any
-- plumbing to expose local agent state to the web dashboard. AD-8 says the
-- agent's ONLY cloud write is the idempotent set sync; AD-20 (adopted
-- 2026-08-04) amends that to admit exactly one more -- this compact status
-- heartbeat -- scoped by a SECURITY DEFINER function to a single per-DJ row,
-- exactly the discipline AD-18/AD-19 already use for the Stripe webhook.
--
-- Deliberately NOT a change to the frozen `shared/` sync-payload contract
-- (AD-3): this is a separate RPC, never a field on `sync_set`. It carries no
-- Serato-derived content (AD-1/AD-2 untouched) and is never gated by
-- `subscription_status` (AD-19 -- a lapsed subscriber's agent still beats).

-- One row per DJ, upserted -- NOT an event log. `dj_id` is the primary key,
-- so a DJ has exactly one status at a time and the table can never grow with
-- heartbeat volume (the agent beats on every drain pass -- see the function
-- comment below).
--
-- `sync_state` is `text`, not a DB enum, following `subscription_status`'s
-- pass-through discipline (AD-19): the agent's `TrayState` is the source of
-- truth for the value set, and a seventh variant added later must not require
-- a type migration to store. The value set is enforced INSIDE the function
-- instead (see `set_agent_status`), which is where a poisoned value would
-- have to come from anyway -- the table takes no direct writes at all.
create table public.agent_status (
  dj_id       uuid primary key references public.djs (id) on delete cascade,
  sync_state  text not null,
  updated_at  timestamptz not null default now()
);

alter table public.agent_status enable row level security;

-- RLS only narrows rows; Postgres still requires the base table GRANT before
-- a role can query it at all. SELECT only -- see the deliberate absence of
-- any write grant below. (Same note as create_sessions_sets_plays.sql: a
-- migration-created table gets no default ACL for anon/authenticated.)
grant select on public.agent_status to authenticated, anon;

-- Owner-SELECT only, null-safe (AD-7) -- the identical shape as every other
-- per-DJ policy in this codebase.
create policy "agent_status_select_own" on public.agent_status
  for select using (auth.uid() is not null and auth.uid() = dj_id);

-- Deliberately NO insert/update/delete grant or policy for `authenticated`
-- (AD-8/AD-20). `set_agent_status` below is the only writer; it runs as this
-- migration's owner under SECURITY DEFINER and so already has the privileges
-- it needs. This is the mechanical arm of AD-20's "column-scoped" promise:
-- the agent cannot reach any other table, or any other column, through it.

-- The heartbeat write path. Mirrors `sync_set`
-- (20260731120000_create_sync_set_function.sql) exactly: `security definer`,
-- `set search_path = ''`, `dj_id` derived from `auth.uid()` and NEVER accepted
-- as a parameter, a 42501 guard when there is no authenticated caller, and
-- `grant execute` only.
--
-- Beat-on-idle contract (Arjun, 2026-08-05): the agent POSTs its CURRENT
-- state on EVERY drain pass of the existing `sync_queue::sync_loop` -- it does
-- not dedupe against last-sent. That is what makes `updated_at` a liveness
-- signal rather than a change log: an idle-but-alive agent keeps refreshing
-- the timestamp, so the dashboard can tell it apart from a dead one. This
-- function must therefore ALWAYS move `updated_at` forward, including when
-- `sync_state` is unchanged.
--
-- `clock_timestamp()`, not `now()`: `now()` is the transaction start time and
-- is constant within a transaction, which would make two beats in one
-- transaction indistinguishable (and is untestable in the single-transaction
-- pgTAP harness). The wall-clock moment of the write is the honest value for
-- a liveness signal.
--
-- The agent is deliberately dumb about staleness -- it never knows what
-- "stale" means. The DASHBOARD owns that definition (STALE_AFTER = 600s, 2x
-- the loop's MAX_INTERVAL, web-side). Nothing here expires or sweeps rows.
create function public.set_agent_status(sync_state text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
-- `#variable_conflict use_column`: the parameter name `sync_state` collides
-- with the real column name, and the ON CONFLICT SET clause's left-hand side
-- MUST resolve to the column (same situation, same resolution, as `sync_set`).
-- The parameter is therefore copied into a distinctly-named local
-- (`requested_state`) up front and only that is used for values/validation, so
-- the pragma never silently redirects a read of the caller's argument to the
-- old stored column value. The parameter itself has to stay named `sync_state`
-- -- PostgREST maps the JSON body key to it by name.
#variable_conflict use_column
declare
  caller_dj_id uuid := auth.uid();
  requested_state text := sync_state;
begin
  if caller_dj_id is null then
    raise exception 'set_agent_status requires an authenticated caller' using errcode = '42501';
  end if;

  -- The six `TrayState` variants (agent/src-tauri/src/tray.rs), validated
  -- here rather than as a column CHECK so that adding a seventh is a function
  -- replacement, not a constraint migration on a live table (AD-15's
  -- additive-only rule). Rejecting loudly is the point: a typo'd or hostile
  -- string must never land in a column the dashboard renders from.
  if requested_state is null or requested_state not in (
    'Idle', 'Syncing', 'Failed', 'DriveNotConnected', 'Queued', 'FormatDriftPaused'
  ) then
    raise exception 'set_agent_status: unrecognized sync_state %', requested_state
      using errcode = '22023';
  end if;

  insert into public.agent_status (dj_id, sync_state, updated_at)
  values (caller_dj_id, requested_state, clock_timestamp())
  on conflict (dj_id) do update set
    sync_state = excluded.sync_state,
    updated_at = excluded.updated_at;
end;
$$;

-- Grant execute only -- never a table write grant (AD-20).
grant execute on function public.set_agent_status(text) to authenticated;
