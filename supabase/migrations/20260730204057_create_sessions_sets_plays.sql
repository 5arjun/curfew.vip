-- Migration: create_sessions_sets_plays
-- Story 3.1 — Sessions/sets/plays schema + visibility + content/overlay split
-- (AC-1, AC-2, AC-3, AC-4)
--
-- Lays down the cloud schema Story 3.2 (Idempotent set sync) will PUT parsed
-- sets into. `visibility` and the content/overlay column split land now, on
-- day one, so Phase-2 read-policies (AD-9, AD-15) only ever ADD RLS
-- read-policies later and never need a "make old sets private" backfill --
-- every set is already stored private-equivalent from the moment it's
-- created. This migration is schema-only: no write grants/policies are
-- added here (see the note above the GRANT block below) -- that's Story
-- 3.2's job, once the actual write path (likely a SECURITY DEFINER
-- function, per AD-19's pattern) is designed.

-- `sessions` — the immutable anchor a DJ's plays are recorded under.
-- `session_identity` is the intrinsic pre-hash string `id` is derived from
-- (Story 3.2, AD-16 computes and supplies both); this table just persists
-- them. No default on `id` -- it is agent-supplied, not DB-generated.
create table public.sessions (
  id                uuid primary key,
  dj_id             uuid not null references public.djs (id) on delete cascade,
  session_identity  text not null,
  created_at        timestamptz not null default now(),
  unique (dj_id, session_identity)
);

-- `sets` — one set within a session. `id` IS the `set_id`/`external_id` that
-- `SyncPayload.set.external_id` (shared/src/index.ts, frozen since Story
-- 1.10) and AD-16/AR-2 refer to -- no separate `external_id` column.
--
-- Content vs overlay split (AC-3): `derived` is the agent-written render
-- cache (content); `visibility` is the web-authored, agent-untouchable
-- overlay column. They are deliberately disjoint columns so a future
-- content-column write grant (Story 3.2) can never also grant overlay
-- write access by accident.
create table public.sets (
  id           uuid primary key,
  session_id   uuid not null references public.sessions (id) on delete cascade,
  dj_id        uuid not null references public.djs (id) on delete cascade,
  started_at   timestamptz not null,
  ended_at     timestamptz not null check (ended_at >= started_at),
  derived      jsonb not null default '{}'::jsonb,
  visibility   text not null default 'private'
               check (visibility in ('public', 'friends_only', 'private')),
  created_at   timestamptz not null default now()
);

-- `plays` — one track within a set. Genre is deliberately three columns,
-- never collapsed into one (AD-12): `genre_raw` and `genre_normalized` plus
-- `taxonomy_version` so trends (FR-9) can be recomputed consistently after
-- the taxonomy changes. All three are nullable -- a play can have no genre
-- at all (shared/'s wire type is `genre: {...} | null`).
--
-- `in_library` is never nullable (AD-11: "never omitted, never guessed").
create table public.plays (
  id                 uuid primary key default gen_random_uuid(),
  set_id             uuid not null references public.sets (id) on delete cascade,
  dj_id              uuid not null references public.djs (id) on delete cascade,
  position           int not null,
  title              text,
  artist             text,
  started_at         timestamptz,
  bpm                real,
  genre_raw          text,
  genre_normalized   text,
  taxonomy_version   int,
  camelot_key        text,
  in_library         boolean not null,
  created_at         timestamptz not null default now(),
  unique (set_id, position)
);

-- `dj_id` is denormalized directly onto `sets` and `plays` (not just
-- reachable via a join through `sessions`) so RLS stays a direct-column
-- comparison, matching every existing policy in this codebase (AD-7,
-- `djs_select_own`) instead of a slower/divergent join-based policy.
--
-- Known gap, not this story's to close: nothing at the DB layer guarantees
-- a `sets.dj_id`/`plays.dj_id` actually matches its parent row's `dj_id` --
-- Story 3.2's write path must derive `dj_id` from the parent row being
-- inserted under, never trust a client-supplied value.
alter table public.sessions enable row level security;
alter table public.sets enable row level security;
alter table public.plays enable row level security;

-- RLS only narrows rows; Postgres still requires the base table GRANT
-- before a role can query it at all -- without this, `anon`/`authenticated`
-- get a hard "permission denied" instead of an RLS-filtered result. A table
-- created by a migration (running as `postgres`) gets no default ACL for
-- `anon`/`authenticated`. See implementation-artifacts/deferred-work.md:191
-- (Story 2.1 code review) for the incident this note exists to prevent.
grant select on public.sessions to authenticated, anon;
grant select on public.sets to authenticated, anon;
grant select on public.plays to authenticated, anon;

create policy "sessions_select_own" on public.sessions
  for select using (auth.uid() is not null and auth.uid() = dj_id);
create policy "sets_select_own" on public.sets
  for select using (auth.uid() is not null and auth.uid() = dj_id);
create policy "plays_select_own" on public.plays
  for select using (auth.uid() is not null and auth.uid() = dj_id);

-- Deliberately no INSERT/UPDATE/DELETE grant or policy on any of the three
-- tables in this migration. This story is schema-only (AR-8/AR-9/AR-12/
-- AR-15 -- see the story file's Scope Boundaries): Story 3.2 designs the
-- actual write path. Withholding all write access trivially satisfies
-- AC-3's "overlay columns exist but are agent-untouchable" -- right now
-- every column, content and overlay alike, is untouchable by
-- `authenticated`/`anon`.
