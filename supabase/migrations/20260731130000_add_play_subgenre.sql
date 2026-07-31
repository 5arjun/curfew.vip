-- Migration: add_play_subgenre
-- Adds subgenre tracking (taxonomy v2, agent/src-tauri/src/genre.rs) on top of
-- Story 3.1/3.2's sessions/sets/plays schema + sync_set() write path.
--
-- `subgenre` is a fourth, nullable genre column alongside `genre_raw` /
-- `genre_normalized` / `taxonomy_version` (AD-12's "never collapsed" discipline
-- extends here too) -- a play can have a normalized parent genre with no more
-- specific subgenre distinction, or no genre at all, exactly like the other three.
--
-- `sync_set()` is immutable once applied (Story 3.2's migration already shipped),
-- so this file replaces it wholesale via `create or replace function` with the
-- same signature, rather than editing the earlier migration file.

alter table public.plays add column subgenre text;

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
      genre_raw, genre_normalized, subgenre, taxonomy_version, camelot_key, in_library
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
      (one_play ->> 'in_library')::boolean
    );
  end loop;

  return computed_set_id;
end;
$$;

grant execute on function public.sync_set(text, bigint, bigint, jsonb, jsonb) to authenticated;
