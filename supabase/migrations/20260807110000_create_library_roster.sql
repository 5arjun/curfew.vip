-- Migration: create_library_roster
-- Story 4.11 — Library roster sync: name the tracks the cloud can only count
--
-- Closes the gap found 2026-08-07 while measuring Story 4.4's blockers: the
-- cloud can COUNT an added-but-never-played track (library_track_events,
-- AD-21) but cannot NAME one -- that table carries only { track_id, added_at }.
-- This migration adds a Tier-A-only (title/artist; BPM/key/genre are Tier B,
-- explicitly parked) roster of what the DJ owns, current-state and mutable,
-- unblocking Story 4.3's meter (34% converted but the 66% unnameable),
-- Story 4.4's aging shelf (must render named rows), and Story 4.10's search
-- (played-tracks-only without it).
--
-- THIS IS THE THIRD SANCTIONED AGENT WRITE (proposed AD-22), after AD-20's
-- status heartbeat and AD-21's library add-event batch both amended AD-8's
-- "the agent's only write is the idempotent set sync". Named and scoped
-- explicitly here and in ARCHITECTURE-SPINE.md rather than landing as a
-- silent bypass -- same treatment AD-20/AD-21 got.
--
-- DELIBERATELY A SEPARATE TABLE FROM library_track_events, not an ALTER TABLE
-- on it, and DELIBERATELY NAMED library_roster (not library_tracks) to avoid
-- reading as a third, confusingly-similar name alongside the agent's local
-- SQLite `library_tracks` table and this same migration's own cloud
-- `library_track_events`. The two cloud tables serve two purposes that must
-- never be conflated (Story 4.11 AC-3's central hazard):
--   - library_track_events: go-forward-only, first-write-wins, the cohort
--     denominator for conversion-rate math (AD-21). Baseline tracks (D-1)
--     are STRUCTURALLY EXCLUDED from it.
--   - library_roster (this table): current-state, mutable, carries baseline
--     tracks too (that is this story's whole point) -- but its added_at/
--     is_baseline must NEVER be read for cohort math. A baseline track's
--     real pre-install add-date entering conversion cohorts would
--     retroactively populate old months against a still-go-forward
--     numerator and silently change numbers the DJ has already seen.
--
-- `dj_id` denormalized directly onto the row (never join-derived), matching
-- library_track_events/sessions/sets/plays exactly (Story 3.1's RLS-
-- performance rationale, AD-7). `unique (dj_id, track_id)` is the same
-- idempotency key shape; unlike library_track_events, the write path below
-- upserts current-state fields on conflict rather than doing nothing.
create table public.library_roster (
  dj_id        uuid not null references public.djs (id) on delete cascade,
  track_id     text not null,
  title        text,
  artist       text,
  added_at     timestamptz,
  is_baseline  boolean not null default false,
  absent_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (dj_id, track_id)
);

-- Every roster read is "this DJ's current, present tracks" -- narrows on
-- dj_id and (usually) absent_at is null. Mirrors
-- library_track_events_dj_id_added_at_idx's reasoning.
create index library_roster_dj_id_absent_at_idx
  on public.library_roster (dj_id, absent_at);

alter table public.library_roster enable row level security;

-- RLS only narrows rows; Postgres still requires the base-table GRANT before
-- a role can query it at all. See deferred-work.md:191 (Story 2.1 code
-- review) for the incident this note exists to prevent.
grant select on public.library_roster to authenticated, anon;

create policy "library_roster_select_own" on public.library_roster
  for select using (auth.uid() is not null and auth.uid() = dj_id);

-- Deliberately no DJ-facing INSERT/UPDATE/DELETE policy or grant -- identical
-- posture to library_track_events/sets/plays. The only write path is the
-- SECURITY DEFINER function below, which derives dj_id exclusively from
-- auth.uid() and never accepts it as a parameter.

-- Story 4.11 AC-2/AC-4/AC-7: the idempotent, current-state roster batch
-- write.
--
-- `on conflict (dj_id, track_id) do update` -- UNLIKE
-- sync_library_add_events' `do nothing`. The roster is current-state and
-- mutable (a re-tagged track's title/artist must refresh); a redelivery must
-- still be safe (identical values in, identical values out), which `do
-- update` with the same incoming values already gives for free.
--
-- Only title/artist/absent_at/updated_at are ever touched on conflict.
-- added_at and is_baseline are set ONLY on the initial insert and are
-- NEVER present in the update clause -- this is the mechanical enforcement
-- of AC-3's invariant (a re-scan must never move a track's baseline/
-- go-forward classification or its recorded add-date). Getting this wrong
-- (e.g. `do update set *`) would silently corrupt added_at history.
--
-- title/artist use coalesce(new, old) rather than a bare overwrite: in
-- practice a real entry's title/artist are never null when track_id is
-- present (track_id is itself derived from both fields on the agent side,
-- so an entry reaching this function already had both), but this guards
-- against a degraded/partial batch ever blanking a known value, mirroring
-- library_track_events' own "a later null added_at never overwrites a
-- resolved date" precedent for the analogous hazard. absent_at is NOT
-- coalesced -- going from a timestamp back to null is exactly how a
-- reappeared track clears its absence, a real and expected transition.
create function public.sync_library_roster(entries jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_dj_id uuid := auth.uid();
  one_entry jsonb;
  processed int := 0;
begin
  if caller_dj_id is null then
    raise exception 'sync_library_roster requires an authenticated caller'
      using errcode = '42501';
  end if;

  for one_entry in select * from jsonb_array_elements(entries)
  loop
    -- A blank/absent track_id is not an identity; skipping it beats writing
    -- a row nothing can ever join to. Mirrors sync_library_add_events and
    -- the JSON schema's `minLength: 1`.
    continue when coalesce(one_entry ->> 'track_id', '') = '';

    insert into public.library_roster (
      dj_id, track_id, title, artist, added_at, is_baseline, absent_at
    )
    values (
      caller_dj_id,
      one_entry ->> 'track_id',
      one_entry ->> 'title',
      one_entry ->> 'artist',
      case
        when one_entry ->> 'added_at' is null then null
        else to_timestamp((one_entry ->> 'added_at')::bigint)
      end,
      coalesce((one_entry ->> 'is_baseline')::boolean, false),
      case
        when one_entry ->> 'absent_at' is null then null
        else to_timestamp((one_entry ->> 'absent_at')::bigint)
      end
    )
    on conflict (dj_id, track_id) do update set
      title = coalesce(excluded.title, public.library_roster.title),
      artist = coalesce(excluded.artist, public.library_roster.artist),
      absent_at = excluded.absent_at,
      updated_at = now();

    processed := processed + 1;
  end loop;

  return processed;
end;
$$;

grant execute on function public.sync_library_roster(jsonb) to authenticated;
