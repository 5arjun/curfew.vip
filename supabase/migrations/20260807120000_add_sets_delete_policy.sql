-- Migration: add_sets_delete_policy
-- Story 4.6 (AC-5) — the DJ-facing removal path Set Detail's `DeleteModal`
-- needs, replacing the fixture stage's in-memory `store.filter(...)`.
--
-- `20260730204057_create_sessions_sets_plays.sql` deliberately withheld every
-- INSERT/UPDATE/DELETE grant and policy on `sessions`/`sets`/`plays`, noting
-- write access was Story 3.2's (agent sync) job. That story added the
-- `sync_set` SECURITY DEFINER RPC rather than a direct grant, because the
-- agent write needed session/plays fan-out atomicity a plain RLS policy can't
-- express. A DJ-initiated delete has no such need — it is one row, deleted
-- through the authenticated web client, exactly the shape AD-7's existing
-- `*_select_own` policies already cover for reads — so a direct RLS-scoped
-- `DELETE` policy is the simpler and more consistent choice here, not a
-- second RPC.
--
-- Scoped to `sets` only, not `sessions`/`plays`: `deleteSet` only ever issues
-- `delete from sets where id = ...`, and `plays.set_id references
-- public.sets (id) on delete cascade` (same migration as above) already
-- removes the set's `plays` rows as part of that single statement — no
-- separate grant/policy needed on `plays` for the cascade to fire. `sessions`
-- is untouched entirely: multiple sets can share one session, and Story 4.6
-- has no requirement to remove it.
grant delete on public.sets to authenticated;

create policy "sets_delete_own" on public.sets
  for delete using (auth.uid() is not null and auth.uid() = dj_id);
