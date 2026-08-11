-- Migration: add_segments_write_path
-- Story 5.3 — Segment editor (AC-1, AC-3, AC-4; D-27, D-28, D-29, D-32)
--
-- Three things, in one file because they are one change: `segments` becomes a
-- table a DJ can actually write (grants + policies, D-28), every write is
-- validated for boundary integrity (a trigger, D-29 + D-32), and `sync_set`
-- stops destroying the rows those writes create (D-27).
--
-- This is a DJ-DIRECT write path under AD-8's generic "web-side mutations go
-- through Supabase/RLS" clause. It is NOT a fifth agent-write amendment —
-- AD-20..AD-23 are the four cases where the AGENT writes, and nothing here
-- gives the agent any new capability at all. See AD-24.
--
-- Story 5.1 shipped this table with zero write grants and said so explicitly:
-- "Story 5.3 (DJ drag/keyboard editing) designs the actual write paths and
-- their grants when they exist." This is that story.

-- ── D-28: write grants ──────────────────────────────────────────────────────
--
-- INSERT/DELETE are whole-row operations, so a plain grant plus an
-- `auth.uid() = dj_id` policy is the whole story (AD-7's direct-column shape,
-- mirroring `segments_select_own` exactly).
--
-- UPDATE is COLUMN-SCOPED, and that split is the load-bearing part: RLS answers
-- "whose row", the grant answers "which columns of that row". `set_id`,
-- `dj_id`, `source` and `created_at` are absent from the list below, so they
-- are unreachable via UPDATE regardless of row ownership -- a DJ cannot move a
-- segment to another set, reassign it, rewrite its provenance, or backdate it,
-- and no policy has to be written to say so. `source` in particular is never
-- updatable even by its owner: D-18 established that provenance must survive
-- confirmation, which is exactly what a future active-learning loop reads.
grant insert, delete on public.segments to authenticated;
grant update (confirmed, type, label, first_play_id, last_play_id) on public.segments to authenticated;

create policy "segments_insert_own" on public.segments
  for insert with check (auth.uid() is not null and auth.uid() = dj_id);

create policy "segments_update_own" on public.segments
  for update using (auth.uid() is not null and auth.uid() = dj_id)
           with check (auth.uid() is not null and auth.uid() = dj_id);

create policy "segments_delete_own" on public.segments
  for delete using (auth.uid() is not null and auth.uid() = dj_id);

-- ── D-29 + D-32: boundary-integrity trigger ─────────────────────────────────
--
-- Closes, for the one write path a DJ controls directly, the three gaps Story
-- 5.1's code review deferred to this story (boundary ordering, FK/set
-- consistency, overlap policy) plus D-32's MVP type guard. One function, one
-- resolution of both boundaries to `plays.position`, four checks.
--
-- Each violation raises a DESCRIPTIVE exception rather than leaning on a bare
-- constraint code, because the web editor has to tell these four cases apart to
-- say anything useful to the DJ -- see `web/lib/sets/segmentWrites.ts`, which
-- matches on these message texts. Changing the wording below is therefore a
-- change to a contract, not a comment edit.
--
-- `security invoker` (the default) is deliberate, not an oversight: this
-- function only needs the SELECT access the calling DJ already holds on their
-- own `plays`/`segments` rows via RLS. There is no reason to elevate, and
-- elevating would let it read across DJs while deciding whether a write is
-- legal.
--
-- WHY IT SKIPS FOR NON-`authenticated` CALLERS, which is the subtle part:
-- `sync_set` is `security definer`, so inside it `current_user` is the function
-- owner rather than `authenticated`, and every write it makes is exempted here.
-- That is required, not incidental, for three separate reasons:
--
--   1. Epic 5's charter — an overlay nicety must never poison a content sync.
--      `sync_set`'s suggested-segment loop is built to warn-and-skip on every
--      invalid entry and NEVER to raise; a trigger that can abort the whole
--      transaction would silently undo that promise, and a DJ's night of plays
--      would fail to sync because the detector proposed two touching floors.
--   2. D-27's rebind (below) restores DJ-authored rows after a re-sync. A clamp
--      onto a shrunken set can legitimately produce an overlap, and D-27's
--      ruling is explicit that clamping beats deleting -- so the restore must
--      be able to write a row the DJ-facing rule would reject.
--   3. D-32's `dancefloor`-only guard is an MVP restriction on what a DJ may
--      CREATE, not on what already exists. Once a later story ships `dinner`,
--      a re-sync must be able to restore a `dinner` row it captured.
--
-- The check is unforgeable from a client: a DJ cannot make `current_user`
-- anything other than `authenticated`, because reaching it any other way means
-- already holding a privileged role. RLS still constrains every row either way
-- -- this decides which VALIDATIONS apply, never who owns what.
create or replace function public.segments_validate() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_first_pos int;
  v_last_pos  int;
  v_first_set uuid;
  v_last_set  uuid;
begin
  if current_user <> 'authenticated' then
    return NEW;
  end if;

  select position, set_id into v_first_pos, v_first_set
    from public.plays where id = NEW.first_play_id;
  select position, set_id into v_last_pos, v_last_set
    from public.plays where id = NEW.last_play_id;

  -- A boundary that resolves to nothing is a boundary pointing at a play this
  -- DJ cannot see. The FK guarantees the row EXISTS; RLS is what makes it
  -- invisible, and the two together mean "not yours" -- rejected in the same
  -- breath as the cross-set case below, since a DJ must not learn which of the
  -- two it was.
  if v_first_pos is null or v_last_pos is null
     or v_first_set is distinct from NEW.set_id
     or v_last_set is distinct from NEW.set_id then
    raise exception 'segment boundary references a play outside its own set';
  end if;

  if v_first_pos > v_last_pos then
    raise exception 'segment boundaries reversed (first position % > last position %)',
      v_first_pos, v_last_pos;
  end if;

  -- D-32. One line, deletable the day a later story ships `dinner`/
  -- `performance`/`custom` typing (D-33) -- the schema enum has permitted them
  -- since Story 5.1, and this is the only thing currently narrower than it.
  if NEW.type <> 'dancefloor' then
    raise exception 'only dancefloor segments can be written (MVP guard, Story 5.3 D-32)';
  end if;

  -- Overlap is scoped to the same `type` on purpose (D-29.3), not set-wide:
  -- today only `dancefloor` exists so the distinction is a no-op, but it means
  -- a future `dinner` segment sitting inside a `dancefloor` range will not trip
  -- a rule that was never meant to apply across types.
  --
  -- `s.id <> NEW.id` is what makes this correct on UPDATE (a row never overlaps
  -- itself) and harmless on INSERT, where `NEW.id` already holds the column
  -- default -- Postgres applies defaults before BEFORE-row triggers fire, so it
  -- is a real uuid here, matching nothing.
  if exists (
    select 1 from public.segments s
    join public.plays fp on fp.id = s.first_play_id
    join public.plays lp on lp.id = s.last_play_id
    where s.set_id = NEW.set_id
      and s.id <> NEW.id
      and s.type = NEW.type
      and fp.position <= v_last_pos
      and lp.position >= v_first_pos
  ) then
    raise exception 'segment overlaps an existing % segment for this set', NEW.type;
  end if;

  return NEW;
end;
$$;

-- Functions are born with EXECUTE granted to PUBLIC, and a trigger function is
-- invoked by its trigger regardless of who holds EXECUTE -- so this revoke costs
-- nothing and closes a hole that would otherwise let a client call the validator
-- directly. `grant_matrix_test.sql`'s generic trigger-function sweep fails
-- without it; that sweep exists because `record_deleted_set()` shipped
-- anon-executable in 20260807130000 while the migration right after it was busy
-- revoking EXECUTE on the three functions somebody had remembered to list.
revoke execute on function public.segments_validate() from public, anon, authenticated;

create trigger segments_validate_trigger
  before insert or update on public.segments
  for each row execute function public.segments_validate();

-- ── D-27: stop `sync_set` destroying DJ-authored segments ───────────────────
--
-- THE HAZARD, as `20260810193000_add_segments_source_confirmed.sql` recorded it
-- and assigned forward to this story: `delete from public.plays` cascades
-- through `segments.first_play_id`/`last_play_id`'s `on delete cascade` and
-- removes EVERY segments row for the set -- including the `confirmed = true`
-- and `source = 'manual'` rows this story starts creating, which no sync path
-- is allowed to destroy (AD-16). Harmless while only recomputable suggestions
-- existed; real data loss the moment a DJ confirms one.
--
-- CAPTURE-AND-REINSERT, NOT CAPTURE-AND-UPDATE. Story 5.3's own Dev Notes
-- sketched the fix as capturing each boundary's `position` and then running
-- `update public.segments set first_play_id = ...` after the plays reinsert.
-- That cannot work, and would have failed silently: the cascade above has
-- already DELETED those rows by the time the update runs, so it would match
-- zero rows and ship the exact bug it was written to fix, with every gate
-- green. The rows must be captured whole and written back.
--
-- Identity survives anyway, which is the guarantee that actually mattered
-- (D-28): each row is reinserted under its ORIGINAL `id` and `created_at`, so
-- 5.4's future stat-slicing and D-17's future active-learning signal still see
-- one continuous segment rather than a new row minted every re-sync.
--
-- PER BOUNDARY, NEVER PER SEGMENT (D-27's own note): a re-sync can shrink past
-- `last_play_id`'s position while `first_play_id`'s is still perfectly valid.
-- Each boundary is resolved on its own; a segment never succeeds or fails as a
-- unit.
--
-- Everything outside the two Story 5.3 blocks below is copied verbatim from
-- **20260810193000_add_segments_source_confirmed.sql**, the NEWEST prior
-- definition -- including its `deleted_sets` suppression check and its whole
-- suggested-segment materialization block, which this migration does not
-- touch. Story 5.2 learned this the hard way by rebuilding from an older
-- ancestor and silently reverting the tombstone check; `deleted_sets_
-- tombstone_test.sql` cases 7-8 caught it. Any future migration touching this
-- function must copy THIS body, not an earlier one.

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
  -- Story 5.3 (D-27): the DJ-authored segments captured before the plays
  -- delete, and the per-boundary resolution state used to write them back.
  captured_segments jsonb;
  one_capture jsonb;
  captured_first_pos int;
  captured_last_pos int;
  rebound_first_pos int;
  rebound_last_pos int;
begin
  if caller_dj_id is null then
    raise exception 'sync_set requires an authenticated caller' using errcode = '42501';
  end if;

  computed_session_id := extensions.uuid_generate_v5(caller_dj_id, session_identity);
  computed_set_id := computed_session_id;

  -- Permanent suppression (Story 4.6 code review, carried forward from
  -- 20260807130000_add_deleted_sets_tombstone.sql): a set the DJ deleted stays
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
  -- The hazard this statement's comment used to describe -- the cascade below
  -- destroying confirmed/manual rows too -- is FIXED by the capture/reinsert
  -- pair added in Story 5.3 (D-27), immediately below and after the reinsert.
  delete from public.segments
   where set_id = computed_set_id
     and dj_id = caller_dj_id
     and source = 'suggested'
     and not confirmed;

  -- ── Capture DJ-authored segments (Story 5.3, D-27) ────────────────────────
  --
  -- Whole rows, plus each boundary's current `position` -- positions, not uuids,
  -- are the domain's real boundary identity (5.1's own "track, not millisecond"
  -- reasoning), and they are the only part of a boundary that means anything
  -- after the plays below are re-minted.
  --
  -- Only `confirmed` or `source = 'manual'` rows: unconfirmed suggestions were
  -- just deleted above and are about to be recomputed, which is their intended
  -- lifecycle and not something to preserve.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',             s.id,
           'type',           s.type,
           'label',          s.label,
           'source',         s.source,
           'confirmed',      s.confirmed,
           'created_at',     s.created_at,
           'first_position', fp.position,
           'last_position',  lp.position
         )), '[]'::jsonb)
    into captured_segments
    from public.segments s
    join public.plays fp on fp.id = s.first_play_id
    join public.plays lp on lp.id = s.last_play_id
   where s.set_id = computed_set_id
     and s.dj_id = caller_dj_id
     and (s.confirmed or s.source = 'manual');

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

  -- ── Rebind the captured segments (Story 5.3, D-27) ────────────────────────
  --
  -- Runs BEFORE the suggested-segment block below so a restored DJ-authored row
  -- is already present while suggestions are materialized, matching the state
  -- any other ordering would have to reproduce anyway.
  --
  -- Each boundary resolves to the play at its captured position, or -- if that
  -- position no longer exists because the DJ's Serato history genuinely changed
  -- (3.4's whole reason to exist) -- to the NEAREST remaining position, with a
  -- warning. Never a delete: destroying a DJ-authored row on re-sync is the
  -- exact D-21 disaster this block exists to prevent, so it can never be the
  -- fallback. The DJ is not told; that silence is a deliberate, recorded
  -- tradeoff (D-27), given how narrow the triggering condition is.
  for one_capture in select * from jsonb_array_elements(captured_segments)
  loop
    captured_first_pos := (one_capture ->> 'first_position')::int;
    captured_last_pos  := (one_capture ->> 'last_position')::int;

    select id, position into first_id, rebound_first_pos
      from public.plays
     where set_id = computed_set_id and dj_id = caller_dj_id
     order by abs(position - captured_first_pos), position
     limit 1;

    -- The set now has NO plays at all. There is no timeline left to point at,
    -- so the row cannot be written back under any clamp -- the one case where
    -- a DJ-authored segment is genuinely unrecoverable rather than merely
    -- moved. Loud, because it is the only lossy path in this block.
    if first_id is null then
      raise warning 'sync_set: segment % lost -- the re-synced set has no plays to bind to',
        one_capture ->> 'id';
      continue;
    end if;

    -- The last boundary is constrained to sit at or after the first's REBOUND
    -- position, not merely its captured one. Two independent nearest-position
    -- clamps could otherwise cross each other and produce a reversed segment,
    -- which is invalid by D-29.1 -- so ordering is preserved by construction
    -- here rather than checked afterwards. Collapsing to a single-track segment
    -- is the honest floor when the set shrank past the whole range.
    select id, position into last_id, rebound_last_pos
      from public.plays
     where set_id = computed_set_id and dj_id = caller_dj_id
       and position >= rebound_first_pos
     order by abs(position - captured_last_pos), position
     limit 1;

    if last_id is null then
      last_id := first_id;
      rebound_last_pos := rebound_first_pos;
    end if;

    if rebound_first_pos <> captured_first_pos or rebound_last_pos <> captured_last_pos then
      raise warning 'sync_set: segment % clamped from %..% to %..% (positions no longer exist)',
        one_capture ->> 'id', captured_first_pos, captured_last_pos,
        rebound_first_pos, rebound_last_pos;
    end if;

    -- Reinserted, not updated: the cascade already removed this row. The
    -- original `id` and `created_at` are restated so the segment's identity is
    -- continuous across the re-sync -- see this block's header for why that is
    -- the guarantee that matters. `set_id`/`dj_id` are DERIVED from this call,
    -- never read back from the capture, so a captured row can never be restored
    -- onto a set it did not belong to.
    insert into public.segments (
      id, set_id, dj_id, type, label, first_play_id, last_play_id,
      source, confirmed, created_at
    ) values (
      (one_capture ->> 'id')::uuid,
      computed_set_id,
      caller_dj_id,
      one_capture ->> 'type',
      one_capture ->> 'label',
      first_id,
      last_id,
      one_capture ->> 'source',
      (one_capture ->> 'confirmed')::boolean,
      (one_capture ->> 'created_at')::timestamptz
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

  -- `suggested_segments` must itself be a JSON array before `jsonb_array_elements`
  -- can iterate it — a scalar/object value there raises ("cannot extract elements
  -- from a scalar") before the loop body's own per-entry validation ever runs,
  -- which would silently violate the same "never poison a content sync" promise
  -- the loop below is built to keep. Code review finding, 2026-08-10.
  if jsonb_typeof(coalesce(derived -> 'suggested_segments', '[]'::jsonb)) is distinct from 'array'
  then
    raise warning 'sync_set: suggested_segments is not an array, skipping all suggestions: %',
      derived -> 'suggested_segments';
  else
    for one_segment in
      select * from jsonb_array_elements(derived -> 'suggested_segments')
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
      -- would otherwise raise inside the cast and take the whole call down. The
      -- magnitude check matters too — an all-digit string that overflows `int4`
      -- (e.g. "99999999999") passes the regex but still raises "value out of
      -- range for type integer" on the `::int` cast below; comparing as `numeric`
      -- first (unbounded precision, no overflow) catches it before the cast can.
      -- Code review finding, 2026-08-10.
      if jsonb_typeof(one_segment -> 'first_position') is distinct from 'number'
         or jsonb_typeof(one_segment -> 'last_position') is distinct from 'number'
         or (one_segment ->> 'first_position') !~ '^[0-9]+$'
         or (one_segment ->> 'last_position') !~ '^[0-9]+$'
         or (one_segment ->> 'first_position')::numeric > 2147483647
         or (one_segment ->> 'last_position')::numeric > 2147483647
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

      -- Overlap against what is ALREADY on the set -- the DJ-authored rows just
      -- rebound above, and any suggested row this same loop already inserted.
      -- `segments_validate()` (D-29.3) enforces this same rule for the DJ-direct
      -- path, but this security-definer path is deliberately exempt from that
      -- trigger (see its header), so the loop must check it itself or a
      -- confirmed segment plus a re-sync whose detector proposes an overlapping
      -- range would leave an inert, unconfirmable suggestion sitting in the
      -- table with no explanation. Warn-and-skip, matching every other check in
      -- this loop -- an overlay nicety must never poison a content sync. Code
      -- review finding, 2026-08-11.
      if exists (
        select 1 from public.segments s
        join public.plays fp on fp.id = s.first_play_id
        join public.plays lp on lp.id = s.last_play_id
        where s.set_id = computed_set_id
          and s.dj_id = caller_dj_id
          and s.type = 'dancefloor'
          and fp.position <= last_pos
          and lp.position >= first_pos
      ) then
        raise warning 'sync_set: skipping suggested segment %..% -- overlaps an existing dancefloor segment',
          first_pos, last_pos;
        continue;
      end if;

      -- `dj_id` and `set_id` are DERIVED here, never taken from the payload —
      -- discharging, for this write path, Story 5.1's deferred "derive rather than
      -- trust" review item. `first_pos <= last_pos` was checked directly above,
      -- which discharges its "no ordering constraint" item for this path too. The
      -- cross-row ordering and set-consistency checks 5.1 deferred now exist as
      -- `segments_validate()` (Story 5.3, D-29) and cover the DJ-direct path;
      -- this security-definer path is deliberately exempt from them, for the
      -- reasons that function's own header sets out. The overlap check above is
      -- the one exception, applied directly since the trigger cannot.
      insert into public.segments (
        set_id, dj_id, type, first_play_id, last_play_id, source, confirmed
      ) values (
        computed_set_id, caller_dj_id, 'dancefloor', first_id, last_id, 'suggested', false
      );
    end loop;
  end if;

  return computed_set_id;
end;
$$;

grant execute on function public.sync_set(text, bigint, bigint, jsonb, jsonb) to authenticated;
