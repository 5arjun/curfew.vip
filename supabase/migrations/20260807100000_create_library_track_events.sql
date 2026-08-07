-- Migration: create_library_track_events
-- Story 4.2 — Library-to-setlist correlation trend (AC-5, AC-6, AC-8)
--
-- Closes the data-model gap Story 1.10 flagged as Open Question #1 and
-- explicitly deferred to whichever Epic 4 story implemented FR-10 (this one):
-- the frozen contract only ever synced a track's add-date per-PLAY
-- (SyncPlay.library_added_at), so a track added but never played was invisible
-- to the cloud, and FR-10's "share of recently-added tracks that appear in
-- sets" literally had no denominator. Story 4.3's FR-11 conversion rate has the
-- identical problem; this migration resolves both.
--
-- THIS IS THE SECOND SANCTIONED AGENT WRITE (proposed AD-21), after AD-20's
-- status heartbeat amended AD-8's "the agent's only write is the idempotent set
-- sync". Named and scoped explicitly here and in ARCHITECTURE-SPINE.md rather
-- than landing as a silent bypass -- same treatment AD-20 got.
--
-- Two additive changes, both AR-15/AD-15-clean:
--   1. `library_track_events` -- go-forward record of tracks entering the DJ's
--      library, whether or not they were ever played.
--   2. `plays.track_id` -- the same opaque identity on the play side, so a play
--      joins its add-event by identity instead of fragile title/artist
--      matching. Nullable: every pre-4.2 row has none, and a play whose source
--      carried no portable path never will.
--
-- `track_id` is `fnv1a_hex` of the track's volume-root-relative path
-- (agent/src-tauri/src/capture.rs::track_id) -- the "purpose-built (possibly
-- hashed/opaque) per-track identity field" Story 1.10 anticipated. The raw path
-- never crosses the seam, keeping the same no-local-FS-layout posture that
-- already excludes EnrichedPlay.path from SyncPlay.

-- `dj_id` is denormalized directly onto the row (never join-derived) so RLS
-- stays a direct-column comparison, matching sessions/sets/plays exactly
-- (Story 3.1's own RLS-performance rationale, AD-7).
--
-- `unique (dj_id, track_id)` is the idempotency key: the offline queue is
-- at-least-once (Story 3.3), so a redelivered batch must be a no-op, exactly
-- like a re-PUT set.
--
-- `added_at` is nullable and NEVER defaulted: ~6% of tracks have no reachable
-- database V2 catalogue entry (the Architecture Spine's known coverage gap).
-- Absent is absent, never guessed (AD-11) -- the web excludes those tracks from
-- cohort math and always discloses their count (Story 4.2 D-10).
create table public.library_track_events (
  dj_id       uuid not null references public.djs (id) on delete cascade,
  track_id    text not null,
  added_at    timestamptz,
  created_at  timestamptz not null default now(),
  unique (dj_id, track_id)
);

-- The cohort query is always "this DJ's events, bucketed by add-month", so the
-- unique constraint's own (dj_id, track_id) index does not serve it; this one
-- does. Mirrors 20260806100000_add_sets_plays_dj_id_index.sql's reasoning.
create index library_track_events_dj_id_added_at_idx
  on public.library_track_events (dj_id, added_at);

alter table public.library_track_events enable row level security;

-- RLS only narrows rows; Postgres still requires the base-table GRANT before a
-- role can query it at all. See deferred-work.md:191 (Story 2.1 code review)
-- for the incident this note exists to prevent.
grant select on public.library_track_events to authenticated, anon;

create policy "library_track_events_select_own" on public.library_track_events
  for select using (auth.uid() is not null and auth.uid() = dj_id);

-- Deliberately no DJ-facing INSERT/UPDATE/DELETE policy or grant -- identical
-- posture to sets/plays. The only write path is the SECURITY DEFINER function
-- below (AD-19), which derives dj_id exclusively from auth.uid() and never
-- accepts it as a parameter.

-- Story 4.2 AC-6: the idempotent add-event batch write.
--
-- `on conflict (dj_id, track_id) do nothing` -- NOT `do update`. An add-event
-- records when the library FIRST saw a track; a redelivery must never overwrite
-- a resolved `added_at` with a later scan's `null` (which is exactly what a
-- re-scan with the track's drive unmounted would produce). The agent applies
-- the same first-write-wins rule locally; this makes it true at the DB boundary
-- too, rather than relying on caller discipline.
create function public.sync_library_add_events(events jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_dj_id uuid := auth.uid();
  one_event jsonb;
  inserted int := 0;
begin
  if caller_dj_id is null then
    raise exception 'sync_library_add_events requires an authenticated caller'
      using errcode = '42501';
  end if;

  for one_event in select * from jsonb_array_elements(events)
  loop
    -- A blank/absent track_id is not an identity; skipping it beats writing a
    -- row nothing can ever join to. Mirrors the JSON schema's `minLength: 1`.
    continue when coalesce(one_event ->> 'track_id', '') = '';

    insert into public.library_track_events (dj_id, track_id, added_at)
    values (
      caller_dj_id,
      one_event ->> 'track_id',
      case
        when one_event ->> 'added_at' is null then null
        else to_timestamp((one_event ->> 'added_at')::bigint)
      end
    )
    on conflict (dj_id, track_id) do nothing;

    inserted := inserted + 1;
  end loop;

  return inserted;
end;
$$;

grant execute on function public.sync_library_add_events(jsonb) to authenticated;

-- The play-side half of the identity join (Story 4.2 D-4a). Additive and
-- nullable per AD-15. `sync_set()` is replaced wholesale with the same
-- signature -- same convention as 20260731130000_add_play_subgenre.sql and
-- 20260803190000_add_play_capture_fields.sql.
alter table public.plays add column track_id text;

-- Every cohort join is "this DJ's plays, by track identity" -- the existing
-- (set_id, position) unique index cannot serve it.
create index plays_dj_id_track_id_idx on public.plays (dj_id, track_id);

create or replace function public.sync_set(
  session_identity text,
  started_at bigint,
  ended_at bigint,
  derived jsonb,
  plays jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  caller_dj_id uuid := auth.uid();
  computed_session_id uuid;
  computed_set_id uuid;
  one_play jsonb;
begin
  if caller_dj_id is null then
    raise exception 'sync_set requires an authenticated caller' using errcode = '42501';
  end if;

  computed_session_id := extensions.uuid_generate_v5(caller_dj_id, session_identity);
  computed_set_id := computed_session_id;

  insert into public.sessions (id, dj_id, session_identity)
  values (computed_session_id, caller_dj_id, session_identity)
  on conflict (dj_id, session_identity) do nothing;

  insert into public.sets (id, session_id, dj_id, started_at, ended_at, derived)
  values (
    computed_set_id,
    computed_session_id,
    caller_dj_id,
    to_timestamp(started_at),
    to_timestamp(ended_at),
    derived
  )
  on conflict (id) do update set
    derived = excluded.derived,
    started_at = excluded.started_at,
    ended_at = excluded.ended_at;

  delete from public.plays where set_id = computed_set_id and dj_id = caller_dj_id;

  for one_play in select * from jsonb_array_elements(plays)
  loop
    insert into public.plays (
      set_id, dj_id, position, title, artist, started_at, bpm,
      genre_raw, genre_normalized, subgenre, taxonomy_version, camelot_key, in_library,
      played_ms, library_added_at, track_id
    ) values (
      computed_set_id,
      caller_dj_id,
      (one_play ->> 'position')::int,
      one_play ->> 'title',
      one_play ->> 'artist',
      case
        when one_play ->> 'started_at' is null then null
        else to_timestamp((one_play ->> 'started_at')::bigint)
      end,
      (one_play ->> 'bpm')::real,
      one_play -> 'genre' ->> 'raw',
      one_play -> 'genre' ->> 'normalized',
      one_play -> 'genre' ->> 'subgenre',
      (one_play -> 'genre' ->> 'taxonomy_version')::int,
      one_play ->> 'camelot_key',
      (one_play ->> 'in_library')::boolean,
      (one_play ->> 'played_ms')::bigint,
      case
        when one_play ->> 'library_added_at' is null then null
        else to_timestamp((one_play ->> 'library_added_at')::bigint)
      end,
      one_play ->> 'track_id'
    );
  end loop;

  return computed_set_id;
end;
$$;

grant execute on function public.sync_set(text, bigint, bigint, jsonb, jsonb) to authenticated;
