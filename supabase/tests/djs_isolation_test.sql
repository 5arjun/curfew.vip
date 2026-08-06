begin;

create extension if not exists pgtap with schema extensions;

select plan(23);

-- Seed two auth users; the AFTER INSERT trigger (handle_new_dj) should create
-- exactly one matching public.djs row for each.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'dj-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'dj-b@example.com');

-- Case 1: inserting an auth.users row produces exactly one matching djs row.
select is(
  (select count(*)::int from public.djs where id = '11111111-1111-1111-1111-111111111111'),
  1,
  'trigger creates exactly one djs row for DJ A'
);

select is(
  (select count(*)::int from public.djs where id = '22222222-2222-2222-2222-222222222222'),
  1,
  'trigger creates exactly one djs row for DJ B'
);

-- Case 2: re-running the trigger's own ON CONFLICT (id) DO NOTHING insert
-- pattern never produces a second djs row for the same auth.users.id.
insert into public.djs (id) values ('11111111-1111-1111-1111-111111111111')
on conflict (id) do nothing;

select is(
  (select count(*)::int from public.djs where id = '11111111-1111-1111-1111-111111111111'),
  1,
  'idempotent re-insert does not create a second djs row for DJ A'
);

-- Case 3: as authenticated DJ A (auth.uid() set via request.jwt.claims), a
-- select on djs returns only DJ A's row -- DJ B's row is unreachable.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select results_eq(
  $$ select id from public.djs order by id $$,
  $$ values ('11111111-1111-1111-1111-111111111111'::uuid) $$,
  'authenticated DJ A sees only their own djs row, not DJ B''s'
);

reset role;
reset request.jwt.claims;

-- Case 3b: the mirror of Case 3 -- as authenticated DJ B, a select on djs
-- returns only DJ B's row, not DJ A's. Isolation must hold in both
-- directions, not just the one checked above.
set local role authenticated;
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select results_eq(
  $$ select id from public.djs order by id $$,
  $$ values ('22222222-2222-2222-2222-222222222222'::uuid) $$,
  'authenticated DJ B sees only their own djs row, not DJ A''s'
);

reset role;
reset request.jwt.claims;

-- Case 3c: the "read-only via RLS, write-only via trigger" design (Task 3)
-- means authenticated has no write grant at all on djs -- prove it, don't
-- just assert it in a comment.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select throws_ok(
  $$ insert into public.djs (id) values ('33333333-3333-3333-3333-333333333333') $$,
  '42501'::char(5),
  NULL,
  'authenticated cannot insert into djs (no insert grant)'
);

select throws_ok(
  $$ update public.djs set created_at = now() where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501'::char(5),
  NULL,
  'authenticated cannot update djs (no update grant)'
);

select throws_ok(
  $$ delete from public.djs where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501'::char(5),
  NULL,
  'authenticated cannot delete from djs (no delete grant)'
);

reset role;
reset request.jwt.claims;

-- Case 3d: Story 2.3c's new column-scoped grant + RLS policy -- as
-- authenticated DJ A, updating their own `phone` succeeds and the stored
-- value actually changes (not just "the UPDATE didn't throw").
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

update public.djs set phone = '+15555550100' where id = '11111111-1111-1111-1111-111111111111';

select is(
  (select phone from public.djs where id = '11111111-1111-1111-1111-111111111111'),
  '+15555550100',
  'authenticated DJ A can update their own phone'
);

-- Case 3e: as authenticated DJ A, attempting to update DJ B's `phone` is an
-- RLS USING-clause row-scoping failure -- the UPDATE silently affects zero
-- rows rather than throwing 42501 (unlike a missing table/column grant).
-- Wrapped in lives_ok (not a bare statement) so a future regression that
-- turns this into a genuine permission error fails this one assertion
-- cleanly instead of aborting the whole file's transaction.
select lives_ok(
  $$ update public.djs set phone = '+15555550199' where id = '22222222-2222-2222-2222-222222222222' $$,
  'authenticated DJ A''s update of DJ B''s phone does not throw (RLS filters the row silently)'
);

reset role;
reset request.jwt.claims;

select is(
  (select phone from public.djs where id = '22222222-2222-2222-2222-222222222222'),
  null::text,
  'authenticated DJ A cannot change DJ B''s phone (RLS blocks the row, not the grant)'
);

-- Case 3f (Story 3.10, D-3/AD-19): the second column-scoped grant, dj_name —
-- same shapes as phone (Cases 3d/3e). The existing Case 3c update of
-- created_at continues to prove the grant never widened to the whole table.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

update public.djs set dj_name = 'Arjun' where id = '11111111-1111-1111-1111-111111111111';

select is(
  (select dj_name from public.djs where id = '11111111-1111-1111-1111-111111111111'),
  'Arjun',
  'authenticated DJ A can update their own dj_name'
);

select throws_ok(
  $$ update public.djs set dj_name = repeat('x', 41) where id = '11111111-1111-1111-1111-111111111111' $$,
  '23514'::char(5),
  NULL,
  'a dj_name over 40 characters is rejected by the column CHECK'
);

-- dj_name is optional (D-3) — clearing it back to null must be a legal write.
update public.djs set dj_name = null where id = '11111111-1111-1111-1111-111111111111';

select is(
  (select dj_name from public.djs where id = '11111111-1111-1111-1111-111111111111'),
  null::text,
  'authenticated DJ A can clear their own dj_name (the field is optional)'
);

select lives_ok(
  $$ update public.djs set dj_name = 'Not Your Name' where id = '22222222-2222-2222-2222-222222222222' $$,
  'authenticated DJ A''s update of DJ B''s dj_name does not throw (RLS filters the row silently)'
);

reset role;
reset request.jwt.claims;

select is(
  (select dj_name from public.djs where id = '22222222-2222-2222-2222-222222222222'),
  null::text,
  'authenticated DJ A cannot change DJ B''s dj_name (RLS blocks the row, not the grant)'
);

-- Case 4: as anon with no JWT (auth.uid() is null), a select on djs returns
-- zero rows -- not a permission error.
set local role anon;

select is(
  (select auth.uid()),
  null::uuid,
  'anon has no auth.uid()'
);

select is(
  (select count(*)::int from public.djs),
  0,
  'anon sees zero djs rows'
);

-- Case 4b: the mirror of Case 3c for anon -- the same read-only-via-RLS,
-- write-only-via-trigger design means anon has no write grant either, not
-- just no rows visible via SELECT.
select throws_ok(
  $$ insert into public.djs (id) values ('44444444-4444-4444-4444-444444444444') $$,
  '42501'::char(5),
  NULL,
  'anon cannot insert into djs (no insert grant)'
);

select throws_ok(
  $$ update public.djs set created_at = now() where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501'::char(5),
  NULL,
  'anon cannot update djs (no update grant)'
);

select throws_ok(
  $$ delete from public.djs where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501'::char(5),
  NULL,
  'anon cannot delete from djs (no delete grant)'
);

-- Case 4c: Story 2.3c's phone grant is scoped to `authenticated` only -- anon
-- has no update grant on `phone` (or any column) at all.
select throws_ok(
  $$ update public.djs set phone = '+15555550100' where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501'::char(5),
  NULL,
  'anon cannot update phone (no grant exists for anon)'
);

-- Case 4d: same for Story 3.10's dj_name grant.
select throws_ok(
  $$ update public.djs set dj_name = 'Anon' where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501'::char(5),
  NULL,
  'anon cannot update dj_name (no grant exists for anon)'
);

reset role;

select * from finish();

rollback;
