begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

-- Story 4.6 code review: proof that a deleted set stays deleted even though the
-- agent keeps re-deriving and re-syncing it. The bug this pins down was
-- reproduced end-to-end before the fix: sync a set, delete it, re-sync the same
-- `session_identity`, and the set plus its plays came back under the identical
-- id, because `sets.id = uuid_generate_v5(dj_id, session_identity)` is
-- deterministic and `sync_set` upserts `on conflict (id) do update`.
--
-- Everything below goes through `sync_set` rather than direct inserts, because
-- the re-ingest path IS the thing under test. Expected ids are re-derived from
-- the v5 formula inline rather than captured from sync_set's return value, so
-- these assertions independently confirm the formula too (and the file stays
-- free of psql meta-commands).

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'dj-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'dj-b@example.com');

-- Case 1: a first sync creates the set and its plays, as always.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select public.sync_set(
  'serato4:975',
  1786000000,
  1786007200,
  '{"track_count": 2}'::jsonb,
  '[{"position": 1, "in_library": true}, {"position": 2, "in_library": false}]'::jsonb
);

reset role;
reset request.jwt.claims;

select is(
  (select count(*)::int from public.sets
   where id = extensions.uuid_generate_v5('11111111-1111-1111-1111-111111111111', 'serato4:975')),
  1,
  'a first sync_set creates the set row'
);

select is(
  (select count(*)::int from public.plays
   where set_id = extensions.uuid_generate_v5('11111111-1111-1111-1111-111111111111', 'serato4:975')),
  2,
  'a first sync_set creates the set''s plays rows'
);

select is(
  (select count(*)::int from public.deleted_sets),
  0,
  'no tombstone exists for a set that has never been deleted'
);

-- Case 2: the DJ deletes it through the real RLS-scoped path, and the trigger
-- records the tombstone atomically with the delete.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

delete from public.sets
where id = extensions.uuid_generate_v5('11111111-1111-1111-1111-111111111111', 'serato4:975');

reset role;
reset request.jwt.claims;

select is(
  (select count(*)::int from public.sets
   where id = extensions.uuid_generate_v5('11111111-1111-1111-1111-111111111111', 'serato4:975')),
  0,
  'the set row is gone after the delete'
);

select is(
  (select count(*)::int from public.deleted_sets
   where dj_id = '11111111-1111-1111-1111-111111111111'
     and set_id = extensions.uuid_generate_v5('11111111-1111-1111-1111-111111111111', 'serato4:975')),
  1,
  'the delete trigger recorded a tombstone for the deleted set'
);

-- Case 3: THE REGRESSION. The agent's next startup sweep re-syncs the very same
-- session. Before the tombstone this restored the set and its plays; now it must
-- be a no-op that still returns the id (so the agent marks it synced and stops
-- retrying forever, rather than error-looping over a set the DJ deleted).
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  public.sync_set(
    'serato4:975',
    1786000000,
    1786007200,
    '{"track_count": 2}'::jsonb,
    '[{"position": 1, "in_library": true}, {"position": 2, "in_library": false}]'::jsonb
  ),
  extensions.uuid_generate_v5('11111111-1111-1111-1111-111111111111', 'serato4:975'),
  'a suppressed re-sync still returns the same deterministic set id (agent marks it synced, stops retrying)'
);

reset role;
reset request.jwt.claims;

select is(
  (select count(*)::int from public.sets
   where id = extensions.uuid_generate_v5('11111111-1111-1111-1111-111111111111', 'serato4:975')),
  0,
  'a deleted set is NOT resurrected by a later sync_set of the same session'
);

select is(
  (select count(*)::int from public.plays
   where set_id = extensions.uuid_generate_v5('11111111-1111-1111-1111-111111111111', 'serato4:975')),
  0,
  'the deleted set''s plays are not resurrected either'
);

-- Case 4: suppression is per-DJ. DJ B syncing their own session with the SAME
-- `session_identity` string must be unaffected -- their set id differs because
-- dj_id is the v5 namespace, so DJ A's tombstone cannot suppress DJ B's set.
set local role authenticated;
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select public.sync_set(
  'serato4:975',
  1786000000,
  1786007200,
  '{"track_count": 1}'::jsonb,
  '[{"position": 1, "in_library": true}]'::jsonb
);

reset role;
reset request.jwt.claims;

select is(
  (select count(*)::int from public.sets
   where id = extensions.uuid_generate_v5('22222222-2222-2222-2222-222222222222', 'serato4:975')),
  1,
  'DJ A''s tombstone does not suppress DJ B''s set sharing the same session_identity'
);

select * from finish();

rollback;
