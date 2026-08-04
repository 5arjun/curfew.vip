-- Migration: add_play_capture_fields
-- Story 3.7 (§3d capture pass) — additive columns for the two wire-promoted
-- per-play capture fields (AC-41), so the re-synced/backfilled rows survive the
-- RPC write boundary instead of silently dropping them:
--
--   - `played_ms`   — real on-air duration in milliseconds (Serato's own
--                     end_time − start_time, with the agent-side
--                     next-play-start/set-end fallback). bigint: ms values
--                     overflow int4 past ~24 days, and bigint matches the
--                     agent's u64.
--   - `library_added_at` — when the DJ's library first saw the track
--                     (database V2 tadd/uadd, joined by portable path).
--                     Arrives as unix epoch seconds (the wire's timestamp
--                     convention at this boundary, same as `started_at`) and
--                     is cast to timestamptz here via to_timestamp().
--
-- Both nullable (AD-11: absent is absent, never guessed) and additive-only
-- (AR-15/AD-15). `sync_set()` is replaced wholesale with the same signature —
-- same convention as 20260731130000_add_play_subgenre.sql.

alter table public.plays add column played_ms bigint;
alter table public.plays add column library_added_at timestamptz;

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
      played_ms, library_added_at
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
      end
    );
  end loop;

  return computed_set_id;
end;
$$;

grant execute on function public.sync_set(text, bigint, bigint, jsonb, jsonb) to authenticated;
