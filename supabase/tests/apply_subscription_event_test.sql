begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

-- Story 7.1 — apply_subscription_event(...) write path + isolation (AD-18/AD-19).
--
-- Structured like agent_status_isolation_test.sql, but with a `service_role`
-- caller shape rather than an authenticated-DJ one: `dj_id` is an explicit
-- parameter here (Stripe's webhook has no DJ session/JWT to derive it from),
-- so no `request.jwt.claims` setup is needed for the positive-path cases.
--
-- `event_created_at` (code review, 2026-08-15) orders every write: each
-- case below picks a timestamp later than the one before it, except the
-- dedicated stale/duplicate-delivery cases in "Case 1c", which deliberately
-- go backward or repeat to prove those are no-ops.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'dj-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'dj-b@example.com');

-- ---------------------------------------------------------------------------
-- Case 1: service_role can call the function, and it writes all four billing
-- columns for the target dj_id.
-- ---------------------------------------------------------------------------
set local role service_role;

select public.apply_subscription_event(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'active',
  'cus_A111',
  'sub_A111',
  '2026-09-01 00:00:00+00'::timestamptz,
  '2026-08-01 00:00:00+00'::timestamptz
);

reset role;

select is(
  (select subscription_status from public.djs where id = '11111111-1111-1111-1111-111111111111'),
  'active',
  'apply_subscription_event writes subscription_status for the target dj_id'
);
select is(
  (select stripe_customer_id from public.djs where id = '11111111-1111-1111-1111-111111111111'),
  'cus_A111',
  'apply_subscription_event writes stripe_customer_id for the target dj_id'
);
select is(
  (select stripe_subscription_id from public.djs where id = '11111111-1111-1111-1111-111111111111'),
  'sub_A111',
  'apply_subscription_event writes stripe_subscription_id for the target dj_id'
);
select is(
  (select current_period_end from public.djs where id = '11111111-1111-1111-1111-111111111111'),
  '2026-09-01 00:00:00+00'::timestamptz,
  'apply_subscription_event writes current_period_end for the target dj_id'
);

-- ---------------------------------------------------------------------------
-- Case 1b: a second call with a NEWER event_created_at overwrites the same
-- row in place -- there is nothing to append, it's a plain UPDATE, not an
-- event log.
-- ---------------------------------------------------------------------------
set local role service_role;

select public.apply_subscription_event(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'trialing',
  'cus_A111',
  'sub_A222',
  '2026-09-15 00:00:00+00'::timestamptz,
  '2026-08-05 00:00:00+00'::timestamptz
);

reset role;

select is(
  (select subscription_status from public.djs where id = '11111111-1111-1111-1111-111111111111'),
  'trialing',
  'a second, newer call overwrites subscription_status in place'
);
select is(
  (select stripe_subscription_id from public.djs where id = '11111111-1111-1111-1111-111111111111'),
  'sub_A222',
  'a second, newer call overwrites stripe_subscription_id in place'
);
select is(
  (select current_period_end from public.djs where id = '11111111-1111-1111-1111-111111111111'),
  '2026-09-15 00:00:00+00'::timestamptz,
  'a second, newer call overwrites current_period_end in place -- while trialing, this is the trial end, AD-19'
);
select is(
  (select count(*)::int from public.djs where id = '11111111-1111-1111-1111-111111111111'),
  1,
  'the second call never creates a second row -- it is an UPDATE, not an append'
);

-- ---------------------------------------------------------------------------
-- Case 1c: a STALE event (older than or equal to the last applied
-- event_created_at) is a silent no-op, not an error -- proves both
-- out-of-order delivery and exact-duplicate redelivery are safe.
-- ---------------------------------------------------------------------------
set local role service_role;

-- Older than Case 1b's 2026-08-05 -- must not clobber Case 1b's values.
select public.apply_subscription_event(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'past_due',
  'cus_STALE',
  'sub_STALE',
  '2020-01-01 00:00:00+00'::timestamptz,
  '2026-07-01 00:00:00+00'::timestamptz
);

reset role;

select is(
  (select subscription_status from public.djs where id = '11111111-1111-1111-1111-111111111111'),
  'trialing',
  'an older event_created_at is a no-op -- subscription_status is unchanged from Case 1b'
);

set local role service_role;

-- Exactly equal to Case 1b's 2026-08-05 -- an exact-duplicate redelivery,
-- also a no-op (the comparison is strict >, not >=).
select public.apply_subscription_event(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'past_due',
  'cus_DUPLICATE',
  'sub_DUPLICATE',
  '2020-01-01 00:00:00+00'::timestamptz,
  '2026-08-05 00:00:00+00'::timestamptz
);

reset role;

select is(
  (select subscription_status from public.djs where id = '11111111-1111-1111-1111-111111111111'),
  'trialing',
  'an exact-duplicate event_created_at is also a no-op -- subscription_status is still unchanged'
);

-- ---------------------------------------------------------------------------
-- Case 2: authenticated cannot execute the function at all -- no execute
-- grant, the assertion that makes AC-4's "sole caller of the elevated key"
-- true at the ACL layer, not just in prose.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select throws_ok(
  $$ select public.apply_subscription_event('11111111-1111-1111-1111-111111111111'::uuid, 'active', 'cus', 'sub', now(), now()) $$,
  '42501'::char(5),
  NULL,
  'authenticated cannot execute apply_subscription_event (no execute grant)'
);

reset role;
reset request.jwt.claims;

-- ---------------------------------------------------------------------------
-- Case 3: anon cannot execute either.
-- ---------------------------------------------------------------------------
set local role anon;

select throws_ok(
  $$ select public.apply_subscription_event('11111111-1111-1111-1111-111111111111'::uuid, 'active', 'cus', 'sub', now(), now()) $$,
  '42501'::char(5),
  NULL,
  'anon cannot execute apply_subscription_event (no execute grant)'
);

reset role;

-- ---------------------------------------------------------------------------
-- Case 4 (AD-19): an arbitrary/novel subscription_status string -- not in
-- Stripe's currently-known set -- is accepted and stored verbatim,
-- unvalidated. The live proof "never a second state machine" holds.
-- ---------------------------------------------------------------------------
set local role service_role;

select lives_ok(
  $$ select public.apply_subscription_event('11111111-1111-1111-1111-111111111111'::uuid, 'some_future_stripe_status', 'cus_A111', 'sub_A222', '2026-09-15 00:00:00+00'::timestamptz, '2026-08-10 00:00:00+00'::timestamptz) $$,
  'an unrecognized subscription_status string is accepted -- never a second state machine (AD-19)'
);

reset role;

select is(
  (select subscription_status from public.djs where id = '11111111-1111-1111-1111-111111111111'),
  'some_future_stripe_status',
  'the novel subscription_status is stored verbatim, unvalidated'
);

-- ---------------------------------------------------------------------------
-- Case 5: cross-DJ correctness -- calling with DJ A's dj_id never touches
-- DJ B's row.
-- ---------------------------------------------------------------------------
set local role service_role;

select public.apply_subscription_event(
  '22222222-2222-2222-2222-222222222222'::uuid,
  'active',
  'cus_B999',
  'sub_B999',
  '2026-10-01 00:00:00+00'::timestamptz,
  '2026-08-01 00:00:00+00'::timestamptz
);

reset role;

select is(
  (select subscription_status from public.djs where id = '22222222-2222-2222-2222-222222222222'),
  'active',
  'a call for DJ B updates DJ B''s row'
);
select is(
  (select subscription_status from public.djs where id = '11111111-1111-1111-1111-111111111111'),
  'some_future_stripe_status',
  'a call for DJ B does not touch DJ A''s subscription_status'
);
select is(
  (select stripe_customer_id from public.djs where id = '11111111-1111-1111-1111-111111111111'),
  'cus_A111',
  'a call for DJ B does not touch DJ A''s stripe_customer_id'
);

-- ---------------------------------------------------------------------------
-- Case 6: error paths -- a nonexistent dj_id, a null dj_id, a null/empty/
-- whitespace-only status, and a null event_created_at.
-- ---------------------------------------------------------------------------
set local role service_role;

select throws_ok(
  $$ select public.apply_subscription_event('99999999-9999-9999-9999-999999999999'::uuid, 'active', 'cus', 'sub', now(), now()) $$,
  'P0002'::char(5),
  NULL,
  'a nonexistent dj_id raises P0002 (no djs row matched)'
);

select throws_ok(
  $$ select public.apply_subscription_event(null, 'active', 'cus', 'sub', now(), now()) $$,
  '22004'::char(5),
  NULL,
  'a null dj_id raises 22004'
);

select throws_ok(
  $$ select public.apply_subscription_event('11111111-1111-1111-1111-111111111111'::uuid, null, 'cus', 'sub', now(), now()) $$,
  '22004'::char(5),
  NULL,
  'a null status raises 22004'
);

select throws_ok(
  $$ select public.apply_subscription_event('11111111-1111-1111-1111-111111111111'::uuid, '', 'cus', 'sub', now(), now()) $$,
  '22004'::char(5),
  NULL,
  'an empty status raises 22004'
);

select throws_ok(
  $$ select public.apply_subscription_event('11111111-1111-1111-1111-111111111111'::uuid, '   ', 'cus', 'sub', now(), now()) $$,
  '22004'::char(5),
  NULL,
  'a whitespace-only status raises 22004'
);

select throws_ok(
  $$ select public.apply_subscription_event('11111111-1111-1111-1111-111111111111'::uuid, 'active', 'cus', 'sub', now(), null) $$,
  '22004'::char(5),
  NULL,
  'a null event_created_at raises 22004'
);

reset role;

-- ---------------------------------------------------------------------------
-- Case 7: current_period_end is nullable and may legitimately be absent
-- (e.g. a canceled subscription outside its trial window) -- accepted and
-- stored as NULL, not coerced or rejected.
-- ---------------------------------------------------------------------------
set local role service_role;

select lives_ok(
  $$ select public.apply_subscription_event('11111111-1111-1111-1111-111111111111'::uuid, 'canceled', 'cus_A111', 'sub_A222', null, '2026-08-20 00:00:00+00'::timestamptz) $$,
  'a null current_period_end is accepted'
);

reset role;

select is(
  (select current_period_end from public.djs where id = '11111111-1111-1111-1111-111111111111'),
  null,
  'a null current_period_end is stored as NULL, not coerced'
);

select * from finish();

rollback;
