begin;

create extension if not exists pgtap with schema extensions;

select plan(31);

-- Seed two auth users; the AFTER INSERT trigger (handle_new_dj) creates the
-- matching public.djs row for each, same as djs_isolation_test.sql.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'dj-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'dj-b@example.com');

-- Seed one sessions/sets/plays row per DJ. There is no `authenticated`
-- write grant on any of these three tables yet (this story deliberately
-- adds none -- see the migration's own trailing comment), so seeding has to
-- happen as the elevated role the test connection already runs as, exactly
-- like djs_isolation_test.sql seeds auth.users directly.
insert into public.sessions (id, dj_id, session_identity) values
  ('11111111-aaaa-aaaa-aaaa-111111111111', '11111111-1111-1111-1111-111111111111', 'session-a'),
  ('22222222-aaaa-aaaa-aaaa-222222222222', '22222222-2222-2222-2222-222222222222', 'session-b');

insert into public.sets (id, session_id, dj_id, started_at, ended_at) values
  ('11111111-bbbb-bbbb-bbbb-111111111111', '11111111-aaaa-aaaa-aaaa-111111111111', '11111111-1111-1111-1111-111111111111', now(), now()),
  ('22222222-bbbb-bbbb-bbbb-222222222222', '22222222-aaaa-aaaa-aaaa-222222222222', '22222222-2222-2222-2222-222222222222', now(), now());

insert into public.plays (set_id, dj_id, position, in_library) values
  ('11111111-bbbb-bbbb-bbbb-111111111111', '11111111-1111-1111-1111-111111111111', 1, true),
  ('22222222-bbbb-bbbb-bbbb-222222222222', '22222222-2222-2222-2222-222222222222', 1, true);

-- Case 1 (AC-2): inserting a `sets` row with no `visibility` value supplied
-- lands as 'private', not null and not some other default.
insert into public.sets (id, session_id, dj_id, started_at, ended_at) values
  ('11111111-cccc-cccc-cccc-111111111111', '11111111-aaaa-aaaa-aaaa-111111111111', '11111111-1111-1111-1111-111111111111', now(), now());

select is(
  (select visibility from public.sets where id = '11111111-cccc-cccc-cccc-111111111111'),
  'private',
  'a sets row created without an explicit visibility defaults to private'
);

-- Case 1b: the CHECK-allowed non-default visibility values are actually
-- accepted and round-trip unchanged (not silently coerced back to private).
insert into public.sets (id, session_id, dj_id, started_at, ended_at, visibility) values
  ('44444444-dddd-dddd-dddd-111111111111', '11111111-aaaa-aaaa-aaaa-111111111111', '11111111-1111-1111-1111-111111111111', now(), now(), 'public');

select is(
  (select visibility from public.sets where id = '44444444-dddd-dddd-dddd-111111111111'),
  'public',
  'a sets row can be created with visibility=public and it round-trips unchanged'
);

insert into public.sets (id, session_id, dj_id, started_at, ended_at, visibility) values
  ('44444444-dddd-dddd-dddd-222222222222', '11111111-aaaa-aaaa-aaaa-111111111111', '11111111-1111-1111-1111-111111111111', now(), now(), 'friends_only');

select is(
  (select visibility from public.sets where id = '44444444-dddd-dddd-dddd-222222222222'),
  'friends_only',
  'a sets row can be created with visibility=friends_only and it round-trips unchanged'
);

-- Case 1c: an out-of-range visibility value is rejected by the CHECK
-- constraint, proving the enum-equivalent restriction actually holds (not
-- just that the default happens to be valid).
select throws_ok(
  $$ insert into public.sets (id, session_id, dj_id, started_at, ended_at, visibility) values ('44444444-eeee-eeee-eeee-111111111111', '11111111-aaaa-aaaa-aaaa-111111111111', '11111111-1111-1111-1111-111111111111', now(), now(), 'bogus') $$,
  '23514'::char(5),
  NULL,
  'an out-of-range visibility value is rejected by the CHECK constraint'
);

-- Case 1d: a set with ended_at before started_at is rejected by the CHECK
-- constraint added in this story's review pass.
select throws_ok(
  $$ insert into public.sets (id, session_id, dj_id, started_at, ended_at) values ('44444444-eeee-eeee-eeee-222222222222', '11111111-aaaa-aaaa-aaaa-111111111111', '11111111-1111-1111-1111-111111111111', now(), now() - interval '1 minute') $$,
  '23514'::char(5),
  NULL,
  'a sets row with ended_at before started_at is rejected by the CHECK constraint'
);

-- Case 1e: `plays.in_library` is genuinely NOT NULL -- omitting it is
-- rejected, not silently defaulted or nulled (AD-11: "never omitted, never
-- guessed").
select throws_ok(
  $$ insert into public.plays (set_id, dj_id, position) values ('11111111-bbbb-bbbb-bbbb-111111111111', '11111111-1111-1111-1111-111111111111', 99) $$,
  '23502'::char(5),
  NULL,
  'a plays row omitting in_library is rejected (NOT NULL violation)'
);

-- Case 1f: `unique (dj_id, session_identity)` on sessions actually rejects a
-- duplicate, not just happens to never receive one.
select throws_ok(
  $$ insert into public.sessions (id, dj_id, session_identity) values ('44444444-ffff-ffff-ffff-111111111111', '11111111-1111-1111-1111-111111111111', 'session-a') $$,
  '23505'::char(5),
  NULL,
  'a duplicate (dj_id, session_identity) on sessions is rejected (UNIQUE violation)'
);

-- Case 1g: `unique (set_id, position)` on plays actually rejects a
-- duplicate.
select throws_ok(
  $$ insert into public.plays (set_id, dj_id, position, in_library) values ('11111111-bbbb-bbbb-bbbb-111111111111', '11111111-1111-1111-1111-111111111111', 1, true) $$,
  '23505'::char(5),
  NULL,
  'a duplicate (set_id, position) on plays is rejected (UNIQUE violation)'
);

-- Case 1h: `sets.session_id` actually enforces referential integrity -- a
-- dangling reference to a nonexistent session is rejected.
select throws_ok(
  $$ insert into public.sets (id, session_id, dj_id, started_at, ended_at) values ('44444444-ffff-ffff-ffff-222222222222', '99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', now(), now()) $$,
  '23503'::char(5),
  NULL,
  'a sets row referencing a nonexistent session_id is rejected (FK violation)'
);

-- Case 1i: `plays.set_id` actually enforces referential integrity -- a
-- dangling reference to a nonexistent set is rejected.
select throws_ok(
  $$ insert into public.plays (set_id, dj_id, position, in_library) values ('99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 1, true) $$,
  '23503'::char(5),
  NULL,
  'a plays row referencing a nonexistent set_id is rejected (FK violation)'
);

-- Case 2: cross-DJ SELECT isolation on sessions, both directions.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select results_eq(
  $$ select id from public.sessions order by id $$,
  $$ values ('11111111-aaaa-aaaa-aaaa-111111111111'::uuid) $$,
  'authenticated DJ A sees only their own sessions row, not DJ B''s'
);

reset role;
reset request.jwt.claims;

set local role authenticated;
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select results_eq(
  $$ select id from public.sessions order by id $$,
  $$ values ('22222222-aaaa-aaaa-aaaa-222222222222'::uuid) $$,
  'authenticated DJ B sees only their own sessions row, not DJ A''s'
);

reset role;
reset request.jwt.claims;

-- Case 3: cross-DJ SELECT isolation on sets, both directions. DJ A now has
-- four sets rows (the seeded one, Case 1's, and Case 1b's two), so all four
-- must come back.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select results_eq(
  $$ select id from public.sets order by id $$,
  $$ values ('11111111-bbbb-bbbb-bbbb-111111111111'::uuid), ('11111111-cccc-cccc-cccc-111111111111'::uuid), ('44444444-dddd-dddd-dddd-111111111111'::uuid), ('44444444-dddd-dddd-dddd-222222222222'::uuid) $$,
  'authenticated DJ A sees only their own sets rows, not DJ B''s'
);

reset role;
reset request.jwt.claims;

set local role authenticated;
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select results_eq(
  $$ select id from public.sets order by id $$,
  $$ values ('22222222-bbbb-bbbb-bbbb-222222222222'::uuid) $$,
  'authenticated DJ B sees only their own sets row, not DJ A''s'
);

reset role;
reset request.jwt.claims;

-- Case 4: cross-DJ SELECT isolation on plays, both directions.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select results_eq(
  $$ select set_id from public.plays order by set_id $$,
  $$ values ('11111111-bbbb-bbbb-bbbb-111111111111'::uuid) $$,
  'authenticated DJ A sees only their own plays row, not DJ B''s'
);

reset role;
reset request.jwt.claims;

set local role authenticated;
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select results_eq(
  $$ select set_id from public.plays order by set_id $$,
  $$ values ('22222222-bbbb-bbbb-bbbb-222222222222'::uuid) $$,
  'authenticated DJ B sees only their own plays row, not DJ A''s'
);

reset role;
reset request.jwt.claims;

-- Case 5 (AC-3): this story adds no INSERT/UPDATE/DELETE grant or policy on
-- any of the three tables -- prove authenticated has no write access at
-- all, on any of them, not just that overlay columns specifically are
-- protected. Right now every column, content and overlay alike, is
-- untouchable, which is the concrete evidence for AC-3's "overlay columns
-- exist but are agent-untouchable."
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select throws_ok(
  $$ insert into public.sessions (id, dj_id, session_identity) values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'session-c') $$,
  '42501'::char(5),
  NULL,
  'authenticated cannot insert into sessions (no insert grant)'
);

select throws_ok(
  $$ update public.sessions set session_identity = 'renamed' where id = '11111111-aaaa-aaaa-aaaa-111111111111' $$,
  '42501'::char(5),
  NULL,
  'authenticated cannot update sessions (no update grant)'
);

select throws_ok(
  $$ delete from public.sessions where id = '11111111-aaaa-aaaa-aaaa-111111111111' $$,
  '42501'::char(5),
  NULL,
  'authenticated cannot delete from sessions (no delete grant)'
);

select throws_ok(
  $$ insert into public.sets (id, session_id, dj_id, started_at, ended_at) values ('33333333-3333-3333-3333-333333333333', '11111111-aaaa-aaaa-aaaa-111111111111', '11111111-1111-1111-1111-111111111111', now(), now()) $$,
  '42501'::char(5),
  NULL,
  'authenticated cannot insert into sets (no insert grant)'
);

select throws_ok(
  $$ update public.sets set visibility = 'public' where id = '11111111-bbbb-bbbb-bbbb-111111111111' $$,
  '42501'::char(5),
  NULL,
  'authenticated cannot update sets (no update grant), including the visibility overlay column'
);

select throws_ok(
  $$ delete from public.sets where id = '11111111-bbbb-bbbb-bbbb-111111111111' $$,
  '42501'::char(5),
  NULL,
  'authenticated cannot delete from sets (no delete grant)'
);

select throws_ok(
  $$ insert into public.plays (set_id, dj_id, position, in_library) values ('11111111-bbbb-bbbb-bbbb-111111111111', '11111111-1111-1111-1111-111111111111', 2, true) $$,
  '42501'::char(5),
  NULL,
  'authenticated cannot insert into plays (no insert grant)'
);

select throws_ok(
  $$ update public.plays set title = 'renamed' where set_id = '11111111-bbbb-bbbb-bbbb-111111111111' $$,
  '42501'::char(5),
  NULL,
  'authenticated cannot update plays (no update grant)'
);

select throws_ok(
  $$ delete from public.plays where set_id = '11111111-bbbb-bbbb-bbbb-111111111111' $$,
  '42501'::char(5),
  NULL,
  'authenticated cannot delete from plays (no delete grant)'
);

reset role;
reset request.jwt.claims;

-- Case 6: as anon with no JWT, a select on each of the three tables returns
-- zero rows -- not a permission error (RLS + the base GRANT together).
set local role anon;

select is(
  (select count(*)::int from public.sessions),
  0,
  'anon sees zero sessions rows'
);

select is(
  (select count(*)::int from public.sets),
  0,
  'anon sees zero sets rows'
);

select is(
  (select count(*)::int from public.plays),
  0,
  'anon sees zero plays rows'
);

reset role;

-- Case 7: deleting a DJ's auth.users row cascades through
-- djs -> sessions -> sets -> plays, all the way down, for real (not just
-- asserted from the DDL) -- the concrete proof this story's Task 4.1 and the
-- Story 2.11 account-deletion forward-hooks depend on.
insert into auth.users (id, email) values
  ('55555555-5555-5555-5555-555555555555', 'dj-cascade@example.com');

insert into public.sessions (id, dj_id, session_identity) values
  ('55555555-aaaa-aaaa-aaaa-555555555555', '55555555-5555-5555-5555-555555555555', 'session-cascade');

insert into public.sets (id, session_id, dj_id, started_at, ended_at) values
  ('55555555-bbbb-bbbb-bbbb-555555555555', '55555555-aaaa-aaaa-aaaa-555555555555', '55555555-5555-5555-5555-555555555555', now(), now());

insert into public.plays (set_id, dj_id, position, in_library) values
  ('55555555-bbbb-bbbb-bbbb-555555555555', '55555555-5555-5555-5555-555555555555', 1, true);

delete from auth.users where id = '55555555-5555-5555-5555-555555555555';

select is(
  (select count(*)::int from public.sessions where dj_id = '55555555-5555-5555-5555-555555555555'),
  0,
  'deleting the auth.users row cascades and removes the DJ''s sessions row'
);

select is(
  (select count(*)::int from public.sets where dj_id = '55555555-5555-5555-5555-555555555555'),
  0,
  'deleting the auth.users row cascades and removes the DJ''s sets row'
);

select is(
  (select count(*)::int from public.plays where dj_id = '55555555-5555-5555-5555-555555555555'),
  0,
  'deleting the auth.users row cascades and removes the DJ''s plays row'
);

select * from finish();

rollback;
