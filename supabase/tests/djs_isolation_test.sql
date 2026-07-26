begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

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

reset role;

select * from finish();

rollback;
