begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

-- Story 5.2 amendment: `segments.source` is `text not null` with NO DEFAULT
-- (deliberately — every writer must state provenance, see the migration), so
-- EVERY insert in this file now carries it explicitly. Without that, the
-- pre-existing negative cases below would fail with 23502 (not-null violation)
-- instead of the 23514 CHECK violation they are actually asserting, and would
-- still "pass" while proving nothing.

-- Seed two auth users; the AFTER INSERT trigger (handle_new_dj) creates the
-- matching public.djs row for each, same as djs_isolation_test.sql.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'dj-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'dj-b@example.com');

-- Seed one sessions/sets/plays row chain per DJ, then one segments row per
-- DJ referencing their own plays rows. There is no `authenticated` write
-- grant on any of these four tables yet (this story deliberately adds
-- none on `segments` -- see the migration's own trailing comment), so
-- seeding happens as the elevated role the test connection already runs
-- as, exactly like sessions_sets_plays_isolation_test.sql.
insert into public.sessions (id, dj_id, session_identity) values
  ('11111111-aaaa-aaaa-aaaa-111111111111', '11111111-1111-1111-1111-111111111111', 'session-a'),
  ('22222222-aaaa-aaaa-aaaa-222222222222', '22222222-2222-2222-2222-222222222222', 'session-b');

insert into public.sets (id, session_id, dj_id, started_at, ended_at) values
  ('11111111-bbbb-bbbb-bbbb-111111111111', '11111111-aaaa-aaaa-aaaa-111111111111', '11111111-1111-1111-1111-111111111111', now(), now()),
  ('22222222-bbbb-bbbb-bbbb-222222222222', '22222222-aaaa-aaaa-aaaa-222222222222', '22222222-2222-2222-2222-222222222222', now(), now());

insert into public.plays (id, set_id, dj_id, position, in_library) values
  ('11111111-cccc-cccc-cccc-111111111111', '11111111-bbbb-bbbb-bbbb-111111111111', '11111111-1111-1111-1111-111111111111', 1, true),
  ('11111111-cccc-cccc-cccc-222222222222', '11111111-bbbb-bbbb-bbbb-111111111111', '11111111-1111-1111-1111-111111111111', 2, true),
  ('22222222-cccc-cccc-cccc-111111111111', '22222222-bbbb-bbbb-bbbb-222222222222', '22222222-2222-2222-2222-222222222222', 1, true),
  ('22222222-cccc-cccc-cccc-222222222222', '22222222-bbbb-bbbb-bbbb-222222222222', '22222222-2222-2222-2222-222222222222', 2, true);

insert into public.segments (id, set_id, dj_id, type, first_play_id, last_play_id, source) values
  ('11111111-dddd-dddd-dddd-111111111111', '11111111-bbbb-bbbb-bbbb-111111111111', '11111111-1111-1111-1111-111111111111', 'dancefloor', '11111111-cccc-cccc-cccc-111111111111', '11111111-cccc-cccc-cccc-222222222222', 'suggested'),
  ('22222222-dddd-dddd-dddd-222222222222', '22222222-bbbb-bbbb-bbbb-222222222222', '22222222-2222-2222-2222-222222222222', 'dinner', '22222222-cccc-cccc-cccc-111111111111', '22222222-cccc-cccc-cccc-222222222222', 'suggested');

-- Case 1c (AC-2): an out-of-enum type value is rejected by the CHECK
-- constraint.
select throws_ok(
  $$ insert into public.segments (set_id, dj_id, type, first_play_id, last_play_id, source) values ('11111111-bbbb-bbbb-bbbb-111111111111', '11111111-1111-1111-1111-111111111111', 'bogus', '11111111-cccc-cccc-cccc-111111111111', '11111111-cccc-cccc-cccc-222222222222', 'suggested') $$,
  '23514'::char(5),
  NULL,
  'an out-of-enum segments.type value is rejected by the CHECK constraint'
);

-- Case 1d: type='custom' with a null label is rejected by the CHECK
-- constraint (AC-2's "custom requires a label" rule).
select throws_ok(
  $$ insert into public.segments (set_id, dj_id, type, first_play_id, last_play_id, source) values ('11111111-bbbb-bbbb-bbbb-111111111111', '11111111-1111-1111-1111-111111111111', 'custom', '11111111-cccc-cccc-cccc-111111111111', '11111111-cccc-cccc-cccc-222222222222', 'suggested') $$,
  '23514'::char(5),
  NULL,
  'a segments row with type=custom and a null label is rejected by the CHECK constraint'
);

-- Case 1d2 (Review Findings, code review 2026-08-10): type='custom' with an
-- EMPTY STRING label is rejected too, not just a null one -- '' satisfies
-- `is not null` on its own, so the CHECK's `label <> ''` clause is what
-- actually closes this off.
select throws_ok(
  $$ insert into public.segments (set_id, dj_id, type, label, first_play_id, last_play_id, source) values ('11111111-bbbb-bbbb-bbbb-111111111111', '11111111-1111-1111-1111-111111111111', 'custom', '', '11111111-cccc-cccc-cccc-111111111111', '11111111-cccc-cccc-cccc-222222222222', 'suggested') $$,
  '23514'::char(5),
  NULL,
  'a segments row with type=custom and an empty-string label is rejected by the CHECK constraint'
);

-- Case 1e: type='custom' WITH a label is accepted (the CHECK constraint's
-- positive branch actually admits a row, not just rejects the negative
-- one).
insert into public.segments (id, set_id, dj_id, type, label, first_play_id, last_play_id, source) values
  ('11111111-eeee-eeee-eeee-111111111111', '11111111-bbbb-bbbb-bbbb-111111111111', '11111111-1111-1111-1111-111111111111', 'custom', 'Opening 20', '11111111-cccc-cccc-cccc-111111111111', '11111111-cccc-cccc-cccc-222222222222', 'suggested');

select is(
  (select label from public.segments where id = '11111111-eeee-eeee-eeee-111111111111'),
  'Opening 20',
  'a segments row with type=custom and a label is accepted and the label round-trips unchanged'
);

-- Case 1h: `segments.first_play_id` actually enforces referential
-- integrity -- a dangling reference to a nonexistent play is rejected.
select throws_ok(
  $$ insert into public.segments (set_id, dj_id, type, first_play_id, last_play_id, source) values ('11111111-bbbb-bbbb-bbbb-111111111111', '11111111-1111-1111-1111-111111111111', 'dancefloor', '99999999-9999-9999-9999-999999999999', '11111111-cccc-cccc-cccc-222222222222', 'suggested') $$,
  '23503'::char(5),
  NULL,
  'a segments row referencing a nonexistent first_play_id is rejected (FK violation)'
);

-- Case 1i: `segments.last_play_id` actually enforces referential
-- integrity -- a dangling reference to a nonexistent play is rejected.
select throws_ok(
  $$ insert into public.segments (set_id, dj_id, type, first_play_id, last_play_id, source) values ('11111111-bbbb-bbbb-bbbb-111111111111', '11111111-1111-1111-1111-111111111111', 'dancefloor', '11111111-cccc-cccc-cccc-111111111111', '99999999-9999-9999-9999-999999999999', 'suggested') $$,
  '23503'::char(5),
  NULL,
  'a segments row referencing a nonexistent last_play_id is rejected (FK violation)'
);

-- Case 1j (Story 5.2, D-18): an out-of-enum `source` value is rejected by the
-- NAMED `segments_source_check` constraint.
select throws_ok(
  $$ insert into public.segments (set_id, dj_id, type, first_play_id, last_play_id, source) values ('11111111-bbbb-bbbb-bbbb-111111111111', '11111111-1111-1111-1111-111111111111', 'dancefloor', '11111111-cccc-cccc-cccc-111111111111', '11111111-cccc-cccc-cccc-222222222222', 'guessed') $$,
  '23514'::char(5),
  NULL,
  'an out-of-enum segments.source value is rejected by segments_source_check'
);

-- Case 1k (Story 5.2, D-18): the one impossible cell. A `manual` row is
-- confirmed by construction — a DJ drawing their own boundary IS the
-- confirmation — so ('manual', false) is ruled out by
-- `segments_manual_confirmed_check`, the same CHECK move 5.1 used for
-- "type='custom' requires a label".
select throws_ok(
  $$ insert into public.segments (set_id, dj_id, type, first_play_id, last_play_id, source, confirmed) values ('11111111-bbbb-bbbb-bbbb-111111111111', '11111111-1111-1111-1111-111111111111', 'dancefloor', '11111111-cccc-cccc-cccc-111111111111', '11111111-cccc-cccc-cccc-222222222222', 'manual', false) $$,
  '23514'::char(5),
  NULL,
  'a (manual, false) segments row is rejected by segments_manual_confirmed_check'
);

-- Case 1l (Story 5.2): the positive branches actually admit rows — this
-- story's own ('suggested', false) write, and 5.3's future ('manual', true)
-- one. A pair of constraints that only ever rejects is not proof they permit
-- the cells the design depends on.
insert into public.segments (id, set_id, dj_id, type, first_play_id, last_play_id, source, confirmed) values
  ('11111111-ffff-ffff-ffff-111111111111', '11111111-bbbb-bbbb-bbbb-111111111111', '11111111-1111-1111-1111-111111111111', 'dancefloor', '11111111-cccc-cccc-cccc-111111111111', '11111111-cccc-cccc-cccc-222222222222', 'suggested', false),
  ('11111111-ffff-ffff-ffff-222222222222', '11111111-bbbb-bbbb-bbbb-111111111111', '11111111-1111-1111-1111-111111111111', 'dancefloor', '11111111-cccc-cccc-cccc-111111111111', '11111111-cccc-cccc-cccc-222222222222', 'manual', true);

select is(
  (select (source, confirmed)::text from public.segments where id = '11111111-ffff-ffff-ffff-111111111111'),
  '(suggested,f)',
  'a (suggested, false) segments row -- this story''s only write -- is accepted and round-trips'
);

select is(
  (select (source, confirmed)::text from public.segments where id = '11111111-ffff-ffff-ffff-222222222222'),
  '(manual,t)',
  'a (manual, true) segments row -- Story 5.3''s future DJ-drawn boundary -- is accepted'
);

-- Case 2 (AC-1/AC-3): cross-DJ SELECT isolation on segments, both
-- directions.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select results_eq(
  $$ select id from public.segments order by id $$,
  -- The two `ffff` rows are Case 1l's above (Story 5.2's source/confirmed
  -- positive branches); DJ A now owns four rows, DJ B still exactly one.
  $$ values ('11111111-dddd-dddd-dddd-111111111111'::uuid), ('11111111-eeee-eeee-eeee-111111111111'::uuid), ('11111111-ffff-ffff-ffff-111111111111'::uuid), ('11111111-ffff-ffff-ffff-222222222222'::uuid) $$,
  'authenticated DJ A sees only their own segments rows, not DJ B''s'
);

reset role;
reset request.jwt.claims;

set local role authenticated;
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select results_eq(
  $$ select id from public.segments order by id $$,
  $$ values ('22222222-dddd-dddd-dddd-222222222222'::uuid) $$,
  'authenticated DJ B sees only their own segments row, not DJ A''s'
);

reset role;
reset request.jwt.claims;

-- Case 5 (AC-1): this story adds no INSERT/UPDATE/DELETE grant or policy
-- on segments -- prove authenticated has no write access at all, matching
-- Case 5's shape in the 3.1 suite.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select throws_ok(
  $$ insert into public.segments (set_id, dj_id, type, first_play_id, last_play_id, source) values ('11111111-bbbb-bbbb-bbbb-111111111111', '11111111-1111-1111-1111-111111111111', 'dancefloor', '11111111-cccc-cccc-cccc-111111111111', '11111111-cccc-cccc-cccc-222222222222', 'suggested') $$,
  '42501'::char(5),
  NULL,
  'authenticated cannot insert into segments (no insert grant)'
);

select throws_ok(
  $$ update public.segments set label = 'renamed' where id = '11111111-dddd-dddd-dddd-111111111111' $$,
  '42501'::char(5),
  NULL,
  'authenticated cannot update segments (no update grant)'
);

select throws_ok(
  $$ delete from public.segments where id = '11111111-dddd-dddd-dddd-111111111111' $$,
  '42501'::char(5),
  NULL,
  'authenticated cannot delete from segments (no delete grant)'
);

reset role;
reset request.jwt.claims;

-- Case 6: as anon with no JWT, a select on segments returns zero rows --
-- not a permission error (RLS + the base GRANT together).
set local role anon;

select is(
  (select count(*)::int from public.segments),
  0,
  'anon sees zero segments rows'
);

reset role;

-- Case 7a (Task 4.4 / Ruling 1): deleting the referenced auth.users row
-- cascades through djs -> ... -> segments, removing the DJ's segments row
-- too (mirrors the 3.1 suite's Case 7).
insert into auth.users (id, email) values
  ('55555555-5555-5555-5555-555555555555', 'dj-cascade@example.com');

insert into public.sessions (id, dj_id, session_identity) values
  ('55555555-aaaa-aaaa-aaaa-555555555555', '55555555-5555-5555-5555-555555555555', 'session-cascade');

insert into public.sets (id, session_id, dj_id, started_at, ended_at) values
  ('55555555-bbbb-bbbb-bbbb-555555555555', '55555555-aaaa-aaaa-aaaa-555555555555', '55555555-5555-5555-5555-555555555555', now(), now());

insert into public.plays (id, set_id, dj_id, position, in_library) values
  ('55555555-cccc-cccc-cccc-111111111111', '55555555-bbbb-bbbb-bbbb-555555555555', '55555555-5555-5555-5555-555555555555', 1, true),
  ('55555555-cccc-cccc-cccc-222222222222', '55555555-bbbb-bbbb-bbbb-555555555555', '55555555-5555-5555-5555-555555555555', 2, true);

insert into public.segments (id, set_id, dj_id, type, first_play_id, last_play_id, source) values
  ('55555555-dddd-dddd-dddd-555555555555', '55555555-bbbb-bbbb-bbbb-555555555555', '55555555-5555-5555-5555-555555555555', 'dancefloor', '55555555-cccc-cccc-cccc-111111111111', '55555555-cccc-cccc-cccc-222222222222', 'suggested');

delete from auth.users where id = '55555555-5555-5555-5555-555555555555';

select is(
  (select count(*)::int from public.segments where dj_id = '55555555-5555-5555-5555-555555555555'),
  0,
  'deleting the auth.users row cascades and removes the DJ''s segments row'
);

-- Case 7b (Task 4.4 / Ruling 1): deleting the `plays` row a `segments` row
-- points at removes that `segments` row too -- the concrete proof of the
-- `on delete cascade` on `first_play_id`/`last_play_id` (Dev Notes "Why
-- FK-pair boundaries, not timestamp or position columns"). Fresh DJ so
-- this doesn't collide with Case 7a's auth.users delete above.
insert into auth.users (id, email) values
  ('66666666-6666-6666-6666-666666666666', 'dj-play-cascade@example.com');

insert into public.sessions (id, dj_id, session_identity) values
  ('66666666-aaaa-aaaa-aaaa-666666666666', '66666666-6666-6666-6666-666666666666', 'session-play-cascade');

insert into public.sets (id, session_id, dj_id, started_at, ended_at) values
  ('66666666-bbbb-bbbb-bbbb-666666666666', '66666666-aaaa-aaaa-aaaa-666666666666', '66666666-6666-6666-6666-666666666666', now(), now());

insert into public.plays (id, set_id, dj_id, position, in_library) values
  ('66666666-cccc-cccc-cccc-111111111111', '66666666-bbbb-bbbb-bbbb-666666666666', '66666666-6666-6666-6666-666666666666', 1, true),
  ('66666666-cccc-cccc-cccc-222222222222', '66666666-bbbb-bbbb-bbbb-666666666666', '66666666-6666-6666-6666-666666666666', 2, true);

insert into public.segments (id, set_id, dj_id, type, first_play_id, last_play_id, source) values
  ('66666666-dddd-dddd-dddd-666666666666', '66666666-bbbb-bbbb-bbbb-666666666666', '66666666-6666-6666-6666-666666666666', 'dancefloor', '66666666-cccc-cccc-cccc-111111111111', '66666666-cccc-cccc-cccc-222222222222', 'suggested');

delete from public.plays where id = '66666666-cccc-cccc-cccc-111111111111';

select is(
  (select count(*)::int from public.segments where id = '66666666-dddd-dddd-dddd-666666666666'),
  0,
  'deleting the plays row referenced by first_play_id cascades and removes the segments row that pointed at it'
);

-- Case 7c (Review Findings, code review 2026-08-10): the identical proof
-- for `last_play_id` -- Case 7b only ever exercised `first_play_id`'s `on
-- delete cascade`, leaving `last_play_id`'s independently unproven. Fresh
-- DJ so this doesn't collide with Case 7a/7b's deletes above.
insert into auth.users (id, email) values
  ('77777777-7777-7777-7777-777777777777', 'dj-play-cascade-last@example.com');

insert into public.sessions (id, dj_id, session_identity) values
  ('77777777-aaaa-aaaa-aaaa-777777777777', '77777777-7777-7777-7777-777777777777', 'session-play-cascade-last');

insert into public.sets (id, session_id, dj_id, started_at, ended_at) values
  ('77777777-bbbb-bbbb-bbbb-777777777777', '77777777-aaaa-aaaa-aaaa-777777777777', '77777777-7777-7777-7777-777777777777', now(), now());

insert into public.plays (id, set_id, dj_id, position, in_library) values
  ('77777777-cccc-cccc-cccc-111111111111', '77777777-bbbb-bbbb-bbbb-777777777777', '77777777-7777-7777-7777-777777777777', 1, true),
  ('77777777-cccc-cccc-cccc-222222222222', '77777777-bbbb-bbbb-bbbb-777777777777', '77777777-7777-7777-7777-777777777777', 2, true);

insert into public.segments (id, set_id, dj_id, type, first_play_id, last_play_id, source) values
  ('77777777-dddd-dddd-dddd-777777777777', '77777777-bbbb-bbbb-bbbb-777777777777', '77777777-7777-7777-7777-777777777777', 'dancefloor', '77777777-cccc-cccc-cccc-111111111111', '77777777-cccc-cccc-cccc-222222222222', 'suggested');

delete from public.plays where id = '77777777-cccc-cccc-cccc-222222222222';

select is(
  (select count(*)::int from public.segments where id = '77777777-dddd-dddd-dddd-777777777777'),
  0,
  'deleting the plays row referenced by last_play_id cascades and removes the segments row that pointed at it'
);

select * from finish();

rollback;
