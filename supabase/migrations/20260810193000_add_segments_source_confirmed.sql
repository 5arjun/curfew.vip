-- Migration: add_segments_source_confirmed
-- Story 5.2 — Segment-detection algorithm (AC-2, AC-4; D-18, D-19, D-20, D-21)
--
-- Two orthogonal columns, not one collapsed `status` enum (D-18). The deciding
-- factor is that **provenance must survive confirmation**: a future
-- active-learning loop (D-17 tier 2) needs to know a confirmed segment
-- originated as an algorithm suggestion rather than as a DJ's own "+" row, and a
-- single enum trying to hold both facts just reinvents two axes inside one
-- column, worse-shaped. The three reachable cells:
--
--   ('suggested', false) — this story's writes: the detector's proposal.
--   ('suggested', true)  — Story 5.3: the DJ confirmed (or dragged) a suggestion.
--   ('manual',    true)  — Story 5.3: the DJ's own boundary, confirmed by
--                          construction.
--
-- The fourth cell, ('manual', false), is impossible by definition and is ruled
-- out by a CHECK — the same move Story 5.1 already used for "type='custom'
-- requires a label".
--
-- `source` gets NO DEFAULT on purpose: every writer must state provenance
-- explicitly, so a future write path cannot inherit "suggested" by accident.
-- `NOT NULL` with no default is only safe because the table is provably empty
-- everywhere — Story 5.1 shipped zero write grants and no write path has ever
-- existed. Confirmed for real against the HOSTED project before this merged
-- (2026-08-10: `select count(*)` returned segments = 0, sets = 0, plays = 0),
-- not assumed — 5.1's own "confirm for real" discipline.
--
-- Constraints are NAMED because the pgTAP suite asserts on constraint names.

alter table public.segments add column source text not null;
alter table public.segments add column confirmed boolean not null default false;

alter table public.segments add constraint segments_source_check
  check (source in ('suggested', 'manual'));

alter table public.segments add constraint segments_manual_confirmed_check
  check (source <> 'manual' or confirmed);

-- ── sync_set: materialize the agent's suggested segments (D-19, AD-23) ───────
--
-- `sync_set()` is immutable once applied, so this replaces it wholesale via
-- `create or replace function` with the SAME 5-arg signature — the convention
-- 20260731130000_add_play_subgenre.sql, 20260803190000_add_play_capture_fields.sql,
-- 20260807100000_create_library_track_events.sql and
-- 20260807130000_add_deleted_sets_tombstone.sql all follow. No new parameter, no
-- new RPC, no new grant.
--
-- Everything outside the two Story 5.2 blocks below is copied from
-- **20260807130000_add_deleted_sets_tombstone.sql**, the newest prior definition
-- — including its `deleted_sets` suppression check. That file's own trailing
-- warning ("any future migration touching this function must copy the newest
-- body, not the first one") is load-bearing: rebuilding from an older copy
-- silently reverts a shipped behavior, and `deleted_sets_tombstone_test.sql`
-- cases 7-8 catch it immediately. They did.
--
-- WHY THE EXISTING RPC RATHER THAN A NEW ONE (AD-23, deviating from AD-8's
-- own-RPC/own-table amendment template): a suggestion FK-references the `plays`
-- rows this same call deletes and reinserts. A separate RPC plus queue item
-- would race its own prerequisite and would need a second position→uuid
-- resolution window; widening the existing transaction removes the race by
-- construction. Detection output is derived agent computation over content,
-- which is exactly what `derived` is for; the overlay property attaches to
-- `confirmed`/`manual` state, which stays web-authored and is never touched
-- here.
--
-- WHAT THIS FUNCTION MAY WRITE ON `segments`, exhaustively: rows with
-- `source = 'suggested' and not confirmed`. It creates no other row and deletes
-- no other row. See D-21 below for the one place that guarantee is currently
-- undermined from outside this function.

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
  one_segment jsonb;
  max_position int;
  first_pos int;
  last_pos int;
  first_id uuid;
  last_id uuid;
begin
  if caller_dj_id is null then
    raise exception 'sync_set requires an authenticated caller' using errcode = '42501';
  end if;

  computed_session_id := extensions.uuid_generate_v5(caller_dj_id, session_identity);
  computed_set_id := computed_session_id;

  -- Permanent suppression (Story 4.6 code review, carried forward from
  -- 20260807130000_add_deleted_sets_tombstone.sql — which is the NEWEST prior
  -- definition of this function and the body this migration was rebuilt from,
  -- exactly as that file's own warning demands): a set the DJ deleted stays
  -- deleted, no matter how many times the agent re-derives and re-syncs it. The
  -- check precedes every insert, including the sessions anchor, and returns the
  -- id a successful sync would so the agent stops retrying rather than looping
  -- forever on a set the DJ intentionally removed.
  if exists (
    select 1 from public.deleted_sets
    where dj_id = caller_dj_id and set_id = computed_set_id
  ) then
    return computed_set_id;
  end if;

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

  -- Story 5.2 (D-21): drop THIS set's previous algorithm suggestions, and only
  -- those. Re-syncing recomputes them, so replacing them is the intended
  -- semantics, and stating it explicitly is the point of this statement.
  --
  -- KNOWN HAZARD, assigned forward to Story 5.3 (deferred-work.md): the
  -- `delete from public.plays` below cascades through
  -- `segments.first_play_id`/`last_play_id`'s `on delete cascade` and removes
  -- EVERY segments row for this set — including the `confirmed = true` and
  -- `source = 'manual'` rows Story 5.3 will create, which no sync path is
  -- allowed to destroy (AD-16). That is harmless today (only unconfirmed
  -- suggestions exist, and they are meant to be recomputed) and becomes a real
  -- data-loss bug the moment 5.3 writes its first confirmed row. Fixing it means
  -- changing how plays are replaced (a stable upsert keyed on
  -- `(set_id, position)`, or capture-and-rebind), which belongs to the story that
  -- creates the at-risk rows. Story 5.1's Dev Notes claimed "plays rows are not
  -- currently deleted by any shipped story" — that premise has been false since
  -- Story 3.2.
  delete from public.segments
   where set_id = computed_set_id
     and dj_id = caller_dj_id
     and source = 'suggested'
     and not confirmed;

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

  -- ── Suggested segments (D-19/D-20) ────────────────────────────────────────
  --
  -- The agent cannot know a `plays.id`: they are minted (and re-minted) right
  -- above, inside this transaction. So the wire carries 1-based positions into
  -- this same payload's `plays[]` and they are resolved here, after the insert.
  --
  -- EVERY invalid entry is warned about and SKIPPED — never raised. An overlay
  -- nicety must not be able to poison a content sync or wedge the agent's retry
  -- queue (Epic 5's charter: "nothing here is ever required for core dashboard
  -- stats"). A payload with no `suggested_segments` key at all — every agent
  -- older than Story 5.2 — inserts zero rows and is not an error.
  select max(position) into max_position
    from public.plays
   where set_id = computed_set_id and dj_id = caller_dj_id;

  for one_segment in
    select * from jsonb_array_elements(coalesce(derived -> 'suggested_segments', '[]'::jsonb))
  loop
    -- Detection only ever claims 'dancefloor' (D-26). Anything else is either a
    -- malformed payload or a future writer that has not been designed yet;
    -- hardcoding the accepted value keeps a stray 'custom' from hitting Story
    -- 5.1's "custom requires a label" CHECK and aborting the whole sync.
    if (one_segment ->> 'type') is distinct from 'dancefloor' then
      raise warning 'sync_set: skipping suggested segment with unsupported type %',
        one_segment ->> 'type';
      continue;
    end if;

    -- Integer-shaped check before the cast: a non-numeric or fractional value
    -- would otherwise raise inside the cast and take the whole call down.
    if jsonb_typeof(one_segment -> 'first_position') is distinct from 'number'
       or jsonb_typeof(one_segment -> 'last_position') is distinct from 'number'
       or (one_segment ->> 'first_position') !~ '^[0-9]+$'
       or (one_segment ->> 'last_position') !~ '^[0-9]+$'
    then
      raise warning 'sync_set: skipping suggested segment with non-integer positions %',
        one_segment;
      continue;
    end if;

    first_pos := (one_segment ->> 'first_position')::int;
    last_pos := (one_segment ->> 'last_position')::int;

    if max_position is null
       or first_pos < 1
       or first_pos > last_pos
       or last_pos > max_position
    then
      raise warning 'sync_set: skipping out-of-range suggested segment %..% (max position %)',
        first_pos, last_pos, max_position;
      continue;
    end if;

    select id into first_id from public.plays
     where set_id = computed_set_id and dj_id = caller_dj_id and position = first_pos;
    select id into last_id from public.plays
     where set_id = computed_set_id and dj_id = caller_dj_id and position = last_pos;

    if first_id is null or last_id is null then
      raise warning 'sync_set: suggested segment %..% did not resolve to plays rows',
        first_pos, last_pos;
      continue;
    end if;

    -- `dj_id` and `set_id` are DERIVED here, never taken from the payload —
    -- discharging, for this write path, Story 5.1's deferred "derive rather than
    -- trust" review item. `first_pos <= last_pos` was checked directly above,
    -- which discharges its "no ordering constraint" item for this path too. The
    -- cross-row ordering trigger and the set_id-consistency constraint 5.1
    -- deferred are still not built — they stay with Story 5.3's write path.
    insert into public.segments (
      set_id, dj_id, type, first_play_id, last_play_id, source, confirmed
    ) values (
      computed_set_id, caller_dj_id, 'dancefloor', first_id, last_id, 'suggested', false
    );
  end loop;

  return computed_set_id;
end;
$$;

grant execute on function public.sync_set(text, bigint, bigint, jsonb, jsonb) to authenticated;

-- No new table, no new grant: `segments` keeps Story 5.1's zero-write-grant
-- state exactly (`grant_matrix_test.sql` is untouched by this migration). The
-- RPC above is `security definer`, so it writes on the caller's behalf without
-- any DJ ever holding INSERT/UPDATE/DELETE on the table — which is what keeps
-- AD-16's "confirmed/manual rows are web-authored overlay" claim enforceable
-- once Story 5.3 designs that write path.
