-- Migration: create_sync_set_function
-- Story 3.2 — Idempotent set sync (AC-1, AC-2, AC-3, AC-4, AC-5)
--
-- The write path Story 3.1 deliberately left undesigned (see that story's
-- trailing comment): a single SECURITY DEFINER function, never raw table
-- grants, per AD-19. `dj_id` is derived exclusively from `auth.uid()` inside
-- the function body -- never accepted as a parameter -- closing the gap
-- Story 3.1's review flagged (nothing at the DB layer guaranteed a
-- client-supplied dj_id actually matched the authenticated caller).
--
-- `sessions.id`/`sets.id` (the same value -- Story 3.1's schema comments) is
-- computed server-side via uuid_generate_v5(auth.uid(), session_identity) --
-- the identical formula the agent computes locally
-- (agent/src-tauri/src/sync.rs::set_id, Uuid::new_v5) -- and is never trusted
-- from the client (AD-4).
--
-- `started_at`/`ended_at` are accepted as bigint (unix epoch seconds)
-- rather than the story sketch's `timestamptz`, matching this codebase's
-- existing timestamp convention on the agent side (store.rs, auth/client.rs
-- both already chose epoch-seconds over pulling in a chrono/ISO-8601 round
-- trip) -- cast to timestamptz here via to_timestamp().
--
-- `#variable_conflict use_column`: the function's own parameter names
-- (session_identity, started_at, ended_at, derived) collide with real column
-- names on sessions/sets -- bare identifiers in the ON CONFLICT target list
-- and SET clause below are genuinely ambiguous between "the parameter" and
-- "the column" without this pragma (plpgsql raises a hard parse error
-- otherwise). Resolving in favor of the column is correct/intended in both
-- spots: the ON CONFLICT target list must name real columns, and the SET
-- clause's left-hand side must assign to the real column (its right-hand
-- side, `excluded.*`, stays qualified and unambiguous either way).

create extension if not exists "uuid-ossp" with schema extensions;

create function public.sync_set(
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

  -- Task 1's identical formula: dj_id as the v5 namespace, session_identity
  -- as the name. sessions.id and sets.id are the SAME value (Story 3.1).
  computed_session_id := extensions.uuid_generate_v5(caller_dj_id, session_identity);
  computed_set_id := computed_session_id;

  -- `sessions` is an immutable anchor -- created once, never updated after
  -- (AC-2: a re-parse/re-run updates content, never re-keys/re-partitions).
  insert into public.sessions (id, dj_id, session_identity)
  values (computed_session_id, caller_dj_id, session_identity)
  on conflict (dj_id, session_identity) do nothing;

  -- Content-column-scoped upsert (AC-3): `visibility` never appears in this
  -- parameter list or this SET clause -- the simplest, strongest way to make
  -- the overlay column mechanically untouchable by a re-sync.
  -- started_at/ended_at are refreshed alongside derived on conflict -- they
  -- are content columns too (session time bounds recomputed from the plays
  -- actually captured), not the overlay column AC-3 protects.
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

  -- `plays` has no overlay columns yet (Dev Notes) -- delete-and-reinsert on
  -- every sync is safe today and simpler/safer than a per-position upsert:
  -- no orphaned trailing rows if a re-parse produces fewer plays than before.
  delete from public.plays where set_id = computed_set_id and dj_id = caller_dj_id;

  for one_play in select * from jsonb_array_elements(plays)
  loop
    insert into public.plays (
      set_id, dj_id, position, title, artist, started_at, bpm,
      genre_raw, genre_normalized, taxonomy_version, camelot_key, in_library
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
      (one_play -> 'genre' ->> 'taxonomy_version')::int,
      one_play ->> 'camelot_key',
      (one_play ->> 'in_library')::boolean
    );
  end loop;

  return computed_set_id;
end;
$$;

-- Grant execute only -- no direct insert/update grant on sessions/sets/plays
-- (unchanged from Story 3.1's SELECT-only grants). The function runs as its
-- owner (SECURITY DEFINER), which already has the table privileges it needs.
grant execute on function public.sync_set(text, bigint, bigint, jsonb, jsonb) to authenticated;
