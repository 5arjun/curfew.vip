-- Story 4.2 — `library_track_events` isolation + idempotency (AC-5, AC-6).
--
-- Mirrors sessions_sets_plays_isolation_test.sql's structure exactly: seed two
-- DJs as the elevated role (there is no authenticated write grant on this table
-- either), then prove owner-only SELECT in both directions, no write access at
-- all, an anon read of zero rows, and a full cascade on account deletion.
--
-- Beyond that shared shape, this file carries the two guarantees specific to
-- this story: the (dj_id, track_id) idempotency key, and the first-write-wins
-- rule that stops a redelivered batch from overwriting a resolved `added_at`
-- with a later scan's null.

begin;

create extension if not exists pgtap with schema extensions;

select plan(23);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'dj-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'dj-b@example.com');

insert into public.library_track_events (dj_id, track_id, added_at) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaaaaaaaaaa', '2026-03-01T00:00:00Z'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbbbbbbbbbb', '2026-03-02T00:00:00Z');

-- Case 1: `added_at` is genuinely nullable — a track with no reachable
-- database V2 catalogue is stored as absent, never defaulted to now() or to
-- some sentinel date (AD-11, D-10).
insert into public.library_track_events (dj_id, track_id) values
  ('11111111-1111-1111-1111-111111111111', 'cccccccccccccccc');

select is(
  (select added_at from public.library_track_events
    where dj_id = '11111111-1111-1111-1111-111111111111' and track_id = 'cccccccccccccccc'),
  NULL,
  'an add-event with no resolvable date stores added_at as NULL, never a guessed date'
);

-- Case 2 (AC-6): the (dj_id, track_id) idempotency key actually rejects a
-- duplicate — the property the at-least-once offline queue depends on.
select throws_ok(
  $$ insert into public.library_track_events (dj_id, track_id) values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaaaaaaaaaa') $$,
  '23505'::char(5),
  NULL,
  'a duplicate (dj_id, track_id) is rejected (UNIQUE violation)'
);

-- Case 2b: the SAME track_id under a DIFFERENT DJ is a different row — the
-- key is scoped per-DJ, not global. Two DJs owning the same file must not
-- collide.
insert into public.library_track_events (dj_id, track_id) values
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaaaaaaaaaa');

select is(
  (select count(*)::int from public.library_track_events where track_id = 'aaaaaaaaaaaaaaaa'),
  2,
  'the same track_id under two different DJs is two rows, not a collision'
);

-- Case 3: the FK to djs actually enforces referential integrity.
select throws_ok(
  $$ insert into public.library_track_events (dj_id, track_id) values ('99999999-9999-9999-9999-999999999999', 'dddddddddddddddd') $$,
  '23503'::char(5),
  NULL,
  'an add-event referencing a nonexistent dj_id is rejected (FK violation)'
);

-- Case 4: cross-DJ SELECT isolation, both directions. DJ A has two rows
-- (the seeded one and Case 1's undated one).
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select results_eq(
  $$ select track_id from public.library_track_events order by track_id $$,
  $$ values ('aaaaaaaaaaaaaaaa'::text), ('cccccccccccccccc'::text) $$,
  'authenticated DJ A sees only their own add-events, not DJ B''s'
);

reset role;
reset request.jwt.claims;

set local role authenticated;
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select results_eq(
  $$ select track_id from public.library_track_events order by track_id $$,
  $$ values ('aaaaaaaaaaaaaaaa'::text), ('bbbbbbbbbbbbbbbb'::text) $$,
  'authenticated DJ B sees only their own add-events, not DJ A''s'
);

reset role;
reset request.jwt.claims;

-- Case 5: no DJ-facing write access of any kind — identical posture to
-- sets/plays. The ONLY write path is the SECURITY DEFINER function.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select throws_ok(
  $$ insert into public.library_track_events (dj_id, track_id) values ('11111111-1111-1111-1111-111111111111', 'eeeeeeeeeeeeeeee') $$,
  '42501'::char(5),
  NULL,
  'authenticated cannot insert into library_track_events (no insert grant)'
);

select throws_ok(
  $$ update public.library_track_events set added_at = now() where track_id = 'aaaaaaaaaaaaaaaa' $$,
  '42501'::char(5),
  NULL,
  'authenticated cannot update library_track_events (no update grant)'
);

select throws_ok(
  $$ delete from public.library_track_events where track_id = 'aaaaaaaaaaaaaaaa' $$,
  '42501'::char(5),
  NULL,
  'authenticated cannot delete from library_track_events (no delete grant)'
);

-- Case 6 (AC-6): the sanctioned write path. `sync_library_add_events` derives
-- dj_id from auth.uid() and never accepts it, so DJ A can only ever write
-- their own rows.
select is(
  (select public.sync_library_add_events('[{"track_id":"ffffffffffffffff","added_at":1772323200}]'::jsonb)),
  1,
  'the RPC accepts a batch and reports how many events it processed'
);

select is(
  (select dj_id from public.library_track_events where track_id = 'ffffffffffffffff'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'the RPC writes the row under the CALLER''s dj_id, never a client-supplied one'
);

select is(
  (select added_at from public.library_track_events where track_id = 'ffffffffffffffff'),
  '2026-03-01T00:00:00Z'::timestamptz,
  'the RPC converts the wire''s unix-epoch added_at to timestamptz'
);

-- Case 6b: a redelivered batch is a no-op, not a duplicate or an error —
-- the at-least-once guarantee the Story 3.3 offline queue relies on.
select lives_ok(
  $$ select public.sync_library_add_events('[{"track_id":"ffffffffffffffff","added_at":1772323200}]'::jsonb) $$,
  'a redelivered batch does not raise — the write is idempotent'
);

select is(
  (select count(*)::int from public.library_track_events where track_id = 'ffffffffffffffff'),
  1,
  'a redelivered batch leaves exactly one row, never a duplicate'
);

-- Case 6c: first-write-wins. A re-scan taken with the track's drive unmounted
-- reports added_at as null; that must never erase the date an earlier scan
-- resolved.
select lives_ok(
  $$ select public.sync_library_add_events('[{"track_id":"ffffffffffffffff","added_at":null}]'::jsonb) $$,
  'a redelivery carrying a null added_at does not raise'
);

select is(
  (select added_at from public.library_track_events where track_id = 'ffffffffffffffff'),
  '2026-03-01T00:00:00Z'::timestamptz,
  'a later null added_at never overwrites a date an earlier scan resolved'
);

-- Case 6d: a blank track_id is not an identity — skipped rather than written
-- as a row nothing can ever join to.
select is(
  (select public.sync_library_add_events('[{"track_id":"","added_at":null},{"track_id":null,"added_at":null}]'::jsonb)),
  0,
  'events with a blank or absent track_id are skipped, never written'
);

reset role;
reset request.jwt.claims;

-- Case 7: an unauthenticated caller cannot use the write path at all.
set local role anon;

select throws_ok(
  $$ select public.sync_library_add_events('[{"track_id":"99999999aaaaaaaa","added_at":null}]'::jsonb) $$,
  '42501'::char(5),
  NULL,
  'the RPC refuses an unauthenticated caller'
);

-- Case 8: as anon with no JWT, a select returns zero rows — not a permission
-- error (RLS + the base GRANT together).
select is(
  (select count(*)::int from public.library_track_events),
  0,
  'anon sees zero library_track_events rows'
);

reset role;

-- Case 9: deleting a DJ's auth.users row cascades through djs into their
-- add-events, for real — the same account-deletion guarantee sessions/sets/
-- plays already carry (Story 2.11's forward-hooks depend on it).
insert into auth.users (id, email) values
  ('55555555-5555-5555-5555-555555555555', 'dj-cascade@example.com');

insert into public.library_track_events (dj_id, track_id) values
  ('55555555-5555-5555-5555-555555555555', 'cascade000000000');

delete from auth.users where id = '55555555-5555-5555-5555-555555555555';

select is(
  (select count(*)::int from public.library_track_events where dj_id = '55555555-5555-5555-5555-555555555555'),
  0,
  'deleting the auth.users row cascades and removes the DJ''s add-events'
);

-- Case 10: the play-side half of the identity join (D-4a) exists, is
-- nullable, and round-trips — without it no cohort can be computed at all.
insert into public.sessions (id, dj_id, session_identity) values
  ('11111111-aaaa-aaaa-aaaa-111111111111', '11111111-1111-1111-1111-111111111111', 'session-a');
insert into public.sets (id, session_id, dj_id, started_at, ended_at) values
  ('11111111-bbbb-bbbb-bbbb-111111111111', '11111111-aaaa-aaaa-aaaa-111111111111', '11111111-1111-1111-1111-111111111111', now(), now());

insert into public.plays (set_id, dj_id, position, in_library, track_id) values
  ('11111111-bbbb-bbbb-bbbb-111111111111', '11111111-1111-1111-1111-111111111111', 1, true, 'aaaaaaaaaaaaaaaa');
insert into public.plays (set_id, dj_id, position, in_library) values
  ('11111111-bbbb-bbbb-bbbb-111111111111', '11111111-1111-1111-1111-111111111111', 2, true);

select is(
  (select track_id from public.plays where set_id = '11111111-bbbb-bbbb-bbbb-111111111111' and position = 1),
  'aaaaaaaaaaaaaaaa',
  'plays.track_id round-trips the opaque identity'
);

select is(
  (select track_id from public.plays where set_id = '11111111-bbbb-bbbb-bbbb-111111111111' and position = 2),
  NULL,
  'plays.track_id is nullable — every pre-4.2 row has none'
);

-- Case 10b: the join the whole story rests on actually resolves.
select is(
  (select count(*)::int
     from public.plays p
     join public.library_track_events e
       on e.dj_id = p.dj_id and e.track_id = p.track_id
    where p.dj_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'a play joins back to its add-event by track identity'
);

select * from finish();

rollback;
