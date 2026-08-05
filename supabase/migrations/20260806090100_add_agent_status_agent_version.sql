-- Migration: add_agent_status_agent_version
-- Story 3.10 — Profile/Settings screen (AC-13, AC-20, D-11)
--
-- Exactly one additive field joins the heartbeat: `agent_version`, the
-- version string the agent compiled with (`CARGO_PKG_VERSION`), so the
-- Settings/About screen can show which agent build is actually beating.
-- Nothing else joins it — no device name, no OS (D-11). The frozen `shared/`
-- sync contract is untouched (AD-3); this is the AD-20 RPC, exactly as
-- scoped, and `dj_id` stays derived from `auth.uid()`, never a parameter.
--
-- The column is nullable on purpose: a pre-D-11 agent beats without a
-- version, and the web hides the row entirely when none has ever arrived.

alter table public.agent_status add column agent_version text;

-- Adding a parameter is a SIGNATURE change: `create or replace` on a new
-- signature would create a second overload alongside the old one, and with
-- both parameters defaulted every call would then be ambiguous — so the old
-- signature is dropped and the new one created. Dropping a FUNCTION is not a
-- forbidden form under the additive-only guard (which protects table DDL);
-- the replacement keeps the old call shape working via defaults, so an
-- in-flight pre-D-11 agent POSTing only `sync_state` still lands.
drop function public.set_agent_status(text);

-- Body is the 3.9 function verbatim (see 20260805120000_create_agent_status.sql
-- for the full rationale: security definer, empty search_path, the
-- #variable_conflict pragma, clock_timestamp() as the liveness stamp, the
-- in-function allow-list) plus the one new pass-through parameter.
create function public.set_agent_status(
  sync_state text default null,
  agent_version text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
-- Both parameter names collide with their column names (PostgREST maps JSON
-- body keys to parameters by name, so they cannot be renamed); same
-- resolution as 3.9 — copy each into a distinctly-named local up front and
-- use only those, so the pragma never redirects a read of the caller's
-- argument to the stored column value.
#variable_conflict use_column
declare
  caller_dj_id uuid := auth.uid();
  requested_state text := sync_state;
  requested_version text := agent_version;
begin
  if caller_dj_id is null then
    raise exception 'set_agent_status requires an authenticated caller' using errcode = '42501';
  end if;

  if requested_state is null or requested_state not in (
    'Idle', 'Syncing', 'Failed', 'DriveNotConnected', 'Queued', 'FormatDriftPaused'
  ) then
    raise exception 'set_agent_status: unrecognized sync_state %', requested_state
      using errcode = '22023';
  end if;

  -- The version is a short semver-ish string rendered verbatim on Settings/
  -- About; same "the column cannot be poisoned" discipline as the state
  -- allow-list, but as a length cap since the value set is open-ended.
  if requested_version is not null and char_length(requested_version) > 32 then
    raise exception 'set_agent_status: agent_version too long'
      using errcode = '22023';
  end if;

  -- `excluded.agent_version` on conflict (not coalesce with the stored
  -- value): every beat reports what is true NOW, so a version-less beat from
  -- an older agent honestly clears a stale version rather than freezing it.
  insert into public.agent_status (dj_id, sync_state, agent_version, updated_at)
  values (caller_dj_id, requested_state, requested_version, clock_timestamp())
  on conflict (dj_id) do update set
    sync_state = excluded.sync_state,
    agent_version = excluded.agent_version,
    updated_at = excluded.updated_at;
end;
$$;

-- Grant execute on the NEW signature (the drop above took the old grant with
-- it) — never a table write grant (AD-20).
grant execute on function public.set_agent_status(text, text) to authenticated;
