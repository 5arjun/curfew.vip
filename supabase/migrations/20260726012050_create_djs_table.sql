-- Migration: create_djs_table
-- Story 2.1 — Supabase cloud foundation + isolation baseline (AC-1, AC-2, AC-3, AC-4)
--
-- Adds the `djs` table: the 1:1 identity row for every `auth.users` account and
-- the anchor every future DJ-owned table's `dj_id` FK will reference
-- (sessions.dj_id references public.djs(id), etc. — Story 3.1).
--
-- AD-19: `subscription_status` + 3 sibling billing columns (Stripe customer id,
-- Stripe subscription id, current_period_end) arrive later as an additive
-- migration in Epic 7. This table's shape does not need to change to
-- accommodate them, only grow — no billing columns are added here (AC-4).

create table public.djs (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Task 2 — idempotent-creation trigger (AC-3)
--
-- Standard Supabase pattern: a SECURITY DEFINER function fires on every
-- auth.users insert and creates the matching djs row. Idempotency is
-- ON CONFLICT (id) DO NOTHING on the primary key — this is not an attempt to
-- reimplement "same verified email -> one account" cross-provider identity
-- linking, which is Supabase Auth's own behavior, configured in Story 2.3b.
--
-- set search_path = '' is deliberate hardening for SECURITY DEFINER functions
-- that touch auth.users (prevents search-path hijacking); all references
-- inside the function body are fully qualified as a result.
create function public.handle_new_dj()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.djs (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_dj();

-- Task 3 — null-safe RLS (AC-3, AD-7)
--
-- Read-only via RLS, write-only via the trigger's SECURITY DEFINER context.
-- No INSERT/UPDATE/DELETE policy is added here on purpose — AD-19 states no
-- RLS UPDATE policy on djs should ever grant a DJ write to it, and no story
-- before 2.3c needs a DJ-writable column on this table.
--
-- RLS only narrows rows; Postgres still requires the base table GRANT before
-- a role can query it at all. Without this, `anon`/`authenticated` get a hard
-- "permission denied" error instead of the RLS-filtered result — grant SELECT
-- explicitly so an authenticated DJ can reach their own row and anon's query
-- resolves to zero rows (not an error) once RLS applies.
alter table public.djs enable row level security;

grant select on public.djs to authenticated, anon;

create policy "djs_select_own" on public.djs
  for select
  using (auth.uid() is not null and auth.uid() = id);
