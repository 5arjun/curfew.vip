begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

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

reset role;

select * from finish();

rollback;
