-- Migration: add_djs_phone_column
-- Story 2.3c — Phone-on-file (post-signup prompt) (AC-1)
--
-- The first DJ-writable column on public.djs (Story 2.1's migration reserved
-- this moment explicitly). AD-19 requires any future update policy on djs to
-- exclude Epic 7's billing columns; since none exist yet, satisfying AD-19
-- permanently means scoping this grant to `phone` only — never a blanket
-- `grant update on public.djs`.

alter table public.djs add column phone text;

grant update (phone) on public.djs to authenticated;

create policy "djs_update_own_phone" on public.djs
  for update
  using (auth.uid() is not null and auth.uid() = id)
  with check (auth.uid() is not null and auth.uid() = id);
