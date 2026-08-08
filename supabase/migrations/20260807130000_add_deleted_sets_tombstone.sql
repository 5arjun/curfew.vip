-- Migration: add_deleted_sets_tombstone
-- Story 4.6 code review (2026-08-07) — closes the standing ledger item
-- "Permanent delete tombstone / suppress-id — owed by the Supabase
-- sync/read-path story" (deferred-work.md, surfaced by Story 3.7).
--
-- WHY THIS IS NOT OPTIONAL NOW. Story 3.7's delete was honest only against the
-- fixture: it removed an in-memory row and nothing could put it back. Story
-- 4.6 made the delete real (`20260807120000_add_sets_delete_policy.sql`) while
-- the agent still retains raw captures and re-derives them on every startup
-- sweep, so a bare `delete from sets` is undone by the next sync. Reproduced
-- during the 4.6 code review against a live local stack: sync a set, delete it
-- through the real REST path (row gone), re-run `sync_set` with the same
-- `session_identity` -> the set and its plays are back under the identical id.
-- `DeleteModal` tells the DJ "This removes it from Curfew for good — it can't
-- be undone", so this was a correctness gap against a stated product promise
-- (Arjun's 2026-08-03 never-recoverable ruling), not a nice-to-have.
--
-- KEYED ON `set_id`, WHICH *IS* THE STABLE SESSION IDENTITY. The ledger asked
-- for a key on "stable session identity (`session_identity`/`set_id`)" — those
-- are the same fact here: `sets.id = uuid_generate_v5(dj_id, session_identity)`
-- (Story 3.2's formula, computed identically by the agent). Keying on `set_id`
-- makes the suppression check a primary-key lookup with no join, and makes the
-- recording trigger a two-column copy of `OLD` with nothing to resolve.
--
-- RECORDED BY TRIGGER, NOT BY THE CLIENT. `deleteSet` issues one
-- `delete from sets where id = ...` and knows nothing else; a client-side
-- tombstone insert would need its own grant, a second round trip, and would
-- not be atomic with the delete. An `after delete` trigger is atomic by
-- construction and covers every delete path (web client, future admin tooling,
-- psql) rather than just the one the web app happens to use today.

-- NO foreign key on `dj_id`, deliberately. The first version of this migration
-- had `references public.djs (id) on delete cascade` and it broke account
-- deletion outright: deleting a `djs` row cascades to that DJ's `sets`, which
-- fires the AFTER DELETE trigger below, which then tried to INSERT a tombstone
-- referencing the `djs` row already deleted in the same statement — FK
-- violation, whole delete aborted. (Caught by the pre-existing
-- `sessions_sets_plays_isolation_test.sql`, which deletes a DJ to test cascade
-- behavior.) `on delete cascade` cannot help: the failure is on the INSERT, not
-- the delete.
--
-- The right answer is not a cleverer constraint, it is no constraint: a
-- tombstone whose entire purpose is to outlive the row it describes should
-- outlive the DJ too. Orphaned rows after an account deletion are inert — two
-- opaque uuids and a timestamp, no personal data, and `auth.uid()` values are
-- never reissued, so stale suppression can never apply to a future account.
create table public.deleted_sets (
  dj_id uuid not null,
  set_id uuid not null,
  deleted_at timestamptz not null default now(),
  primary key (dj_id, set_id)
);

comment on table public.deleted_sets is
  'Permanent suppress-list: a (dj_id, set_id) here blocks sync_set from ever re-ingesting that set. Rows are written by the trg_sets_record_delete trigger, never by a client. Deliberately NOT cascaded from sets — the whole point is that it outlives the row.';

alter table public.deleted_sets enable row level security;

-- Owner-SELECT-only, matching AD-7 and every existing table's `*_select_own`
-- shape. No INSERT/UPDATE/DELETE grant to any client role: the trigger below is
-- SECURITY DEFINER and writes as the owner, so a DJ can observe their own
-- tombstones but can never forge or clear one (clearing one would resurrect a
-- set on the next sync — exactly what this table exists to prevent).
grant select on public.deleted_sets to authenticated;

create policy "deleted_sets_select_own" on public.deleted_sets
  for select using (auth.uid() is not null and auth.uid() = dj_id);

-- SECURITY DEFINER so the DJ needs no INSERT grant on `deleted_sets`.
-- `on conflict do nothing` keeps re-deletes (a set resurrected by a sync that
-- predates this migration, then deleted again) idempotent rather than erroring.
create function public.record_deleted_set()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.deleted_sets (dj_id, set_id)
  values (old.dj_id, old.id)
  on conflict (dj_id, set_id) do nothing;
  return old;
end;
$$;

create trigger trg_sets_record_delete
  after delete on public.sets
  for each row
  execute function public.record_deleted_set();

-- Re-create `sync_set` with the suppression check as its first act.
--
-- The early return hands back `computed_set_id` exactly as a successful sync
-- would, WITHOUT inserting anything. That is deliberate: the agent treats a
-- returned id as "this session is synced, stop retrying it"
-- (`mark_synced`/`synced_at`), so a suppressed set is quietly and permanently
-- accepted rather than retried on every startup sweep forever. Raising instead
-- would put the agent into a permanent error-report loop over a set the DJ
-- intentionally deleted.
--
-- The check precedes the `sessions` insert too, so a suppressed set does not
-- silently re-create its session anchor either.
--
-- Everything below the check is byte-identical to the CURRENT definition, which
-- lives in `20260807100000_create_library_track_events.sql` — NOT the original
-- `20260731120000_create_sync_set_function.sql`. `sync_set` has been replaced
-- four times (subgenre → played_ms/library_added_at → track_id), and rebuilding
-- it from the original silently reverts those play columns; the pgTAP suite
-- catches it immediately (`sync_set_isolation_test.sql` cases 4-6). Any future
-- migration touching this function must copy the newest body, not the first one.
-- See the original migration for the rationale on `#variable_conflict
-- use_column`, the v5 id formula, the content-column-scoped upsert that keeps
-- `visibility` untouchable, and the delete-and-reinsert of `plays`.
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

  -- Permanent suppression (Story 4.6 code review): a set the DJ deleted stays
  -- deleted, no matter how many times the agent re-derives and re-syncs it.
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
