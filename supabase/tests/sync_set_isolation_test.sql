begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

-- Seed two auth users; the AFTER INSERT trigger (handle_new_dj) creates the
-- matching public.djs row for each, same as djs_isolation_test.sql /
-- sessions_sets_plays_isolation_test.sql.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'dj-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'dj-b@example.com');

-- Case 1 (AC-2): calling sync_set twice with identical arguments as the same
-- authenticated user produces exactly one sessions row, one sets row, and
-- (AC-2: content updates in place, never accumulates) exactly one plays row.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select public.sync_set(
  'legacy:abc',
  1000,
  1600,
  '{"track_count":1}'::jsonb,
  '[{"position":1,"title":"Track A","artist":"Artist A","started_at":1000,"bpm":120.0,"genre":{"raw":"Deep House","normalized":"House","taxonomy_version":1},"camelot_key":"8A","in_library":true}]'::jsonb
);

select public.sync_set(
  'legacy:abc',
  1000,
  1600,
  '{"track_count":1}'::jsonb,
  '[{"position":1,"title":"Track A","artist":"Artist A","started_at":1000,"bpm":120.0,"genre":{"raw":"Deep House","normalized":"House","taxonomy_version":1},"camelot_key":"8A","in_library":true}]'::jsonb
);

reset role;
reset request.jwt.claims;

select is(
  (select count(*)::int from public.sessions where dj_id = '11111111-1111-1111-1111-111111111111' and session_identity = 'legacy:abc'),
  1,
  'calling sync_set twice with identical args produces exactly one sessions row'
);

select is(
  (select count(*)::int from public.sets where dj_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'calling sync_set twice with identical args produces exactly one sets row (idempotent, AC-2)'
);

select is(
  (select count(*)::int from public.plays where dj_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'plays are replaced (delete + reinsert), not accumulated, on re-sync -- still exactly one row'
);

-- Case 2 (AC-4): two different authenticated users calling with the SAME
-- session_identity string produce two distinct set_ids, each owned by its
-- own dj_id -- the shared-USB-library non-collision guarantee.
set local role authenticated;
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select public.sync_set(
  'legacy:abc',
  2000,
  2600,
  '{}'::jsonb,
  '[]'::jsonb
);

reset role;
reset request.jwt.claims;

select isnt(
  (select id from public.sets where dj_id = '11111111-1111-1111-1111-111111111111' limit 1),
  (select id from public.sets where dj_id = '22222222-2222-2222-2222-222222222222' limit 1),
  'two DJs sharing the same session_identity string never collide on set_id (AC-4)'
);

select is(
  (select count(*)::int from public.sessions where session_identity = 'legacy:abc'),
  2,
  'two distinct DJs syncing the same session_identity produces two distinct sessions rows'
);

-- Case 3 (AC-3): a manual visibility overlay change survives a re-sync
-- untouched, while the content (derived, ended_at) column DOES update.
update public.sets set visibility = 'public'
  where id = (
    select se.id from public.sets se
    join public.sessions ss on ss.id = se.session_id
    where ss.dj_id = '11111111-1111-1111-1111-111111111111' and ss.session_identity = 'legacy:abc'
  );

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select public.sync_set(
  'legacy:abc',
  1000,
  1700,
  '{"track_count":2}'::jsonb,
  '[]'::jsonb
);

reset role;
reset request.jwt.claims;

select is(
  (select se.visibility::text from public.sets se
   join public.sessions ss on ss.id = se.session_id
   where ss.dj_id = '11111111-1111-1111-1111-111111111111' and ss.session_identity = 'legacy:abc'),
  'public',
  're-syncing an existing set does not touch a manually-set visibility overlay column (AC-3)'
);

select is(
  (select se.derived ->> 'track_count' from public.sets se
   join public.sessions ss on ss.id = se.session_id
   where ss.dj_id = '11111111-1111-1111-1111-111111111111' and ss.session_identity = 'legacy:abc'),
  '2',
  're-syncing an existing set DOES update the content derived column'
);

select is(
  (select extract(epoch from se.ended_at)::int from public.sets se
   join public.sessions ss on ss.id = se.session_id
   where ss.dj_id = '11111111-1111-1111-1111-111111111111' and ss.session_identity = 'legacy:abc'),
  1700,
  're-syncing an existing set DOES update the content ended_at column'
);

-- Case 3 re-synced with plays => '[]'::jsonb (down from Case 1's 1 play row)
-- -- exactly the "re-parse produces fewer plays" scenario the
-- delete-and-reinsert design (migration Task 2) exists to handle safely.
-- Assert no orphaned trailing rows survive the shrink.
select is(
  (select count(*)::int from public.plays pl
   join public.sets se on se.id = pl.set_id
   join public.sessions ss on ss.id = se.session_id
   where ss.dj_id = '11111111-1111-1111-1111-111111111111' and ss.session_identity = 'legacy:abc'),
  0,
  're-syncing with fewer plays deletes the old rows -- no orphaned trailing plays survive a shrinking re-sync'
);

-- Case 4: anon cannot execute the function at all (no execute grant).
set local role anon;

select throws_ok(
  $$ select public.sync_set('legacy:xyz', 1000, 1600, '{}'::jsonb, '[]'::jsonb) $$,
  '42501'::char(5),
  NULL,
  'anon cannot execute sync_set (no execute grant)'
);

reset role;

select * from finish();

rollback;
