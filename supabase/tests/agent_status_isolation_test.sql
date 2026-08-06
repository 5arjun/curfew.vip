begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

-- Seed two auth users; the AFTER INSERT trigger (handle_new_dj) creates the
-- matching public.djs row for each, same as djs_isolation_test.sql /
-- sessions_sets_plays_isolation_test.sql.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'dj-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'dj-b@example.com');

-- ---------------------------------------------------------------------------
-- Case 1 (AD-20): the RPC is the only writer, and it upserts under the
-- CALLER's own dj_id -- never a client-supplied one (there is no dj_id
-- parameter to supply).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select public.set_agent_status('Idle');

reset role;
reset request.jwt.claims;

select is(
  (select sync_state from public.agent_status where dj_id = '11111111-1111-1111-1111-111111111111'),
  'Idle',
  'set_agent_status writes the caller''s state under their own dj_id'
);

select is(
  (select count(*)::int from public.agent_status),
  1,
  'one call produces exactly one agent_status row'
);

-- Case 1b: a second call UPSERTS the same row (1:1 per-DJ status row, not an
-- appended event log) and moves `updated_at` forward -- the liveness signal
-- the beat-on-idle ruling (2026-08-05) depends on. `clock_timestamp()` is
-- used by the function rather than `now()` so two calls inside the same
-- transaction produce genuinely different timestamps.
select ok(
  (select updated_at is not null from public.agent_status where dj_id = '11111111-1111-1111-1111-111111111111'),
  'the first heartbeat stamps updated_at'
);

create temporary table first_beat as
  select updated_at from public.agent_status where dj_id = '11111111-1111-1111-1111-111111111111';

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select public.set_agent_status('Queued');

reset role;
reset request.jwt.claims;

select is(
  (select count(*)::int from public.agent_status where dj_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'a second heartbeat upserts the same row -- never appends a second one'
);

select is(
  (select sync_state from public.agent_status where dj_id = '11111111-1111-1111-1111-111111111111'),
  'Queued',
  'a second heartbeat overwrites sync_state in place'
);

select ok(
  (select a.updated_at > f.updated_at
     from public.agent_status a, first_beat f
    where a.dj_id = '11111111-1111-1111-1111-111111111111'),
  'a repeat heartbeat moves updated_at forward (the liveness signal, AD-20)'
);

-- Case 1c: re-POSTing the IDENTICAL state still moves updated_at forward.
-- This is the beat-on-idle contract: the agent does NOT dedupe against
-- last-sent, so an idle-but-alive agent stays distinguishable from a dead one.
create temporary table second_beat as
  select updated_at from public.agent_status where dj_id = '11111111-1111-1111-1111-111111111111';

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select public.set_agent_status('Queued');

reset role;
reset request.jwt.claims;

select ok(
  (select a.updated_at > s.updated_at
     from public.agent_status a, second_beat s
    where a.dj_id = '11111111-1111-1111-1111-111111111111'),
  'an IDENTICAL repeat state still refreshes updated_at (beat-on-idle: no dedup)'
);

-- ---------------------------------------------------------------------------
-- Case 2: every one of the six TrayState variants is accepted verbatim, and
-- an unknown string is rejected -- the column cannot be poisoned (AD-20:
-- validated against the allowed set INSIDE the function, `text` not a DB enum).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok(
  $$ select public.set_agent_status('Idle') $$,
  'Idle is an accepted sync_state'
);
select lives_ok(
  $$ select public.set_agent_status('Syncing') $$,
  'Syncing is an accepted sync_state'
);
select lives_ok(
  $$ select public.set_agent_status('Failed') $$,
  'Failed is an accepted sync_state'
);
select lives_ok(
  $$ select public.set_agent_status('DriveNotConnected') $$,
  'DriveNotConnected is an accepted sync_state'
);
select lives_ok(
  $$ select public.set_agent_status('Queued') $$,
  'Queued is an accepted sync_state'
);
select lives_ok(
  $$ select public.set_agent_status('FormatDriftPaused') $$,
  'FormatDriftPaused is an accepted sync_state'
);

select throws_ok(
  $$ select public.set_agent_status('DefinitelyNotAState') $$,
  '22023'::char(5),
  NULL,
  'an unknown sync_state string is rejected -- the column cannot be poisoned'
);

-- ---------------------------------------------------------------------------
-- Case 2b (Story 3.10, D-11/AD-20): the additive `agent_version` parameter.
-- The signature grew by exactly one defaulted param; the old one-arg call
-- shape must keep working (an in-flight pre-D-11 agent POSTs only
-- `sync_state`), and a version-less beat honestly clears a stored version
-- rather than freezing it.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.set_agent_status('Idle', '0.1.0') $$,
  'the new signature accepts an agent_version'
);

reset role;
reset request.jwt.claims;

select is(
  (select agent_version from public.agent_status where dj_id = '11111111-1111-1111-1111-111111111111'),
  '0.1.0',
  'a versioned beat stores agent_version on the caller''s row'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok(
  $$ select public.set_agent_status('Idle') $$,
  'a version-less beat (the pre-D-11 call shape) is still valid'
);

reset role;
reset request.jwt.claims;

select is(
  (select agent_version from public.agent_status where dj_id = '11111111-1111-1111-1111-111111111111'),
  null::text,
  'a version-less beat clears a previously stored agent_version (every beat reports what is true now)'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select throws_ok(
  $$ select public.set_agent_status('DefinitelyNotAState', '0.1.0') $$,
  '22023'::char(5),
  NULL,
  'the state allow-list still applies when a version is supplied'
);

select throws_ok(
  $$ select public.set_agent_status('Idle', repeat('9', 33)) $$,
  '22023'::char(5),
  NULL,
  'an over-long agent_version is rejected -- the rendered column cannot be poisoned'
);

reset role;
reset request.jwt.claims;

-- ---------------------------------------------------------------------------
-- Case 3: cross-DJ SELECT isolation, both directions (AD-7, null-safe policy).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select public.set_agent_status('Failed');

select results_eq(
  $$ select dj_id from public.agent_status order by dj_id $$,
  $$ values ('22222222-2222-2222-2222-222222222222'::uuid) $$,
  'authenticated DJ B sees only their own agent_status row, not DJ A''s'
);

reset role;
reset request.jwt.claims;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select results_eq(
  $$ select dj_id from public.agent_status order by dj_id $$,
  $$ values ('11111111-1111-1111-1111-111111111111'::uuid) $$,
  'authenticated DJ A sees only their own agent_status row, not DJ B''s'
);

-- Case 3b: DJ A cannot write DJ B's row through the RPC either -- there is no
-- dj_id parameter, so a call made while authenticated as A can only ever land
-- on A's row. Proven by asserting B's state is untouched after A beats.
select public.set_agent_status('Syncing');

reset role;
reset request.jwt.claims;

select is(
  (select sync_state from public.agent_status where dj_id = '22222222-2222-2222-2222-222222222222'),
  'Failed',
  'DJ A''s heartbeat cannot write DJ B''s row (dj_id comes from auth.uid(), not a parameter)'
);

-- ---------------------------------------------------------------------------
-- Case 4 (AD-8/AD-20): `authenticated` has ZERO direct write access to the
-- table -- the RPC is the only writer.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select throws_ok(
  $$ insert into public.agent_status (dj_id, sync_state) values ('11111111-1111-1111-1111-111111111111', 'Idle') $$,
  '42501'::char(5),
  NULL,
  'authenticated cannot insert into agent_status (no insert grant -- the RPC is the only writer)'
);

select throws_ok(
  $$ update public.agent_status set sync_state = 'Idle' where dj_id = '11111111-1111-1111-1111-111111111111' $$,
  '42501'::char(5),
  NULL,
  'authenticated cannot update agent_status (no update grant)'
);

select throws_ok(
  $$ delete from public.agent_status where dj_id = '11111111-1111-1111-1111-111111111111' $$,
  '42501'::char(5),
  NULL,
  'authenticated cannot delete from agent_status (no delete grant)'
);

reset role;
reset request.jwt.claims;

-- ---------------------------------------------------------------------------
-- Case 5: anon sees zero rows (RLS + base GRANT together, not a permission
-- error), and cannot execute the function at all (no execute grant).
-- ---------------------------------------------------------------------------
set local role anon;

select is(
  (select count(*)::int from public.agent_status),
  0,
  'anon sees zero agent_status rows'
);

select throws_ok(
  $$ select public.set_agent_status('Idle') $$,
  '42501'::char(5),
  NULL,
  'anon cannot execute set_agent_status (no execute grant)'
);

reset role;

select * from finish();

rollback;
