begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

-- Seed two auth users; the AFTER INSERT trigger (handle_new_dj) creates the
-- matching public.djs row for each, same as sessions_sets_plays_isolation_test.sql.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'dj-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'dj-b@example.com');

insert into public.sessions (id, dj_id, session_identity) values
  ('11111111-aaaa-aaaa-aaaa-111111111111', '11111111-1111-1111-1111-111111111111', 'session-a'),
  ('22222222-aaaa-aaaa-aaaa-222222222222', '22222222-2222-2222-2222-222222222222', 'session-b');

insert into public.sets (id, session_id, dj_id, started_at, ended_at) values
  ('11111111-bbbb-bbbb-bbbb-111111111111', '11111111-aaaa-aaaa-aaaa-111111111111', '11111111-1111-1111-1111-111111111111', now(), now()),
  ('22222222-bbbb-bbbb-bbbb-222222222222', '22222222-aaaa-aaaa-aaaa-222222222222', '22222222-2222-2222-2222-222222222222', now(), now());

insert into public.plays (set_id, dj_id, position, in_library) values
  ('11111111-bbbb-bbbb-bbbb-111111111111', '11111111-1111-1111-1111-111111111111', 1, true),
  ('22222222-bbbb-bbbb-bbbb-222222222222', '22222222-2222-2222-2222-222222222222', 1, true);

-- Case 1 (AC-5): DJ B cannot delete DJ A's set. RLS filters the row out of
-- the DELETE's own scan (no matching row = no-op), not a permission error --
-- same "not found and not mine are indistinguishable" posture the rest of
-- this seam follows.
set local role authenticated;
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

delete from public.sets where id = '11111111-bbbb-bbbb-bbbb-111111111111';

reset role;
reset request.jwt.claims;

select is(
  (select count(*)::int from public.sets where id = '11111111-bbbb-bbbb-bbbb-111111111111'),
  1,
  'DJ B deleting DJ A''s set is a no-op -- DJ A''s set row still exists'
);

select is(
  (select count(*)::int from public.plays where set_id = '11111111-bbbb-bbbb-bbbb-111111111111'),
  1,
  'DJ A''s plays row also survives DJ B''s no-op delete attempt'
);

-- Case 1b: `anon` cannot delete at all -- the new grant is `to authenticated`
-- only, never `to authenticated, anon` (this codebase's more common idiom).
-- This is a real permission error, not the RLS no-op above, because the grant
-- check precedes policy evaluation. Added by Story 4.6's code review: the
-- blanket "authenticated cannot delete from sets" case removed from
-- sessions_sets_plays_isolation_test.sql used to pin the no-role-can-delete
-- property implicitly, so without this a future widening of the grant to
-- `anon` would land untested.
set local role anon;

select throws_ok(
  $$ delete from public.sets where id = '11111111-bbbb-bbbb-bbbb-111111111111' $$,
  '42501'::char(5),
  NULL,
  'anon cannot delete from sets -- the DELETE grant is to authenticated only'
);

reset role;

-- Case 1c: the policy's `auth.uid() is not null` half is load-bearing, not
-- decoration. An authenticated role with no `sub` claim (an expired or
-- malformed session) has a NULL auth.uid(), which must match zero rows rather
-- than every row -- the difference between a no-op and a catastrophe.
set local role authenticated;
set local request.jwt.claims to '{"role":"authenticated"}';

delete from public.sets;

reset role;
reset request.jwt.claims;

-- Scoped to the two DJs this test creates, not a global `count(*) from
-- public.sets` (Story 4.9). That global form asserted the right property by
-- accident: it only held while the database was empty apart from this test,
-- and `supabase/seed.sql` (D-23, local-dev sample data) made it read 60. The
-- property under test is unchanged and still fully pinned -- if the NULL-uid
-- delete had matched every row instead of none, both of these would be 0.
select is(
  (select count(*)::int from public.sets
   where dj_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')),
  2,
  'an unscoped delete with a NULL auth.uid() matches nothing -- both DJs'' sets survive'
);

-- Case 2 (AC-5): DJ A can delete their own set, and the delete cascades to
-- remove its plays row too (plays.set_id references sets(id) on delete
-- cascade) -- the concrete proof deleteSet never leaves an orphaned play
-- behind.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

delete from public.sets where id = '11111111-bbbb-bbbb-bbbb-111111111111';

reset role;
reset request.jwt.claims;

select is(
  (select count(*)::int from public.sets where id = '11111111-bbbb-bbbb-bbbb-111111111111'),
  0,
  'DJ A can delete their own set'
);

select is(
  (select count(*)::int from public.plays where set_id = '11111111-bbbb-bbbb-bbbb-111111111111'),
  0,
  'deleting a set cascades and removes its plays rows too'
);

-- Case 2b: the parent `sessions` row deliberately SURVIVES the set delete.
-- `20260807120000_add_sets_delete_policy.sql` scopes the grant to `sets` only
-- and says so; this pins that decision as tested behavior rather than an
-- untested comment. (It is also what makes the tombstone in
-- `20260807130000_add_deleted_sets_tombstone.sql` necessary: the session anchor
-- is still there for `sync_set` to upsert against.)
select is(
  (select count(*)::int from public.sessions where id = '11111111-aaaa-aaaa-aaaa-111111111111'),
  1,
  'deleting a set leaves its parent sessions row in place -- sets-only scope'
);

-- Case 3: DJ B's own set is untouched by any of the above.
select is(
  (select count(*)::int from public.sets where id = '22222222-bbbb-bbbb-bbbb-222222222222'),
  1,
  'DJ B''s own set is unaffected by DJ A''s delete'
);

select * from finish();

rollback;
