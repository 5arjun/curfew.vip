begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

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
  '[{"position":1,"title":"Track A","artist":"Artist A","started_at":1000,"bpm":120.0,"genre":{"raw":"Deep House","normalized":"House","taxonomy_version":1},"camelot_key":"8A","in_library":true,"played_ms":240000,"library_added_at":1644628114}]'::jsonb
);

select public.sync_set(
  'legacy:abc',
  1000,
  1600,
  '{"track_count":1}'::jsonb,
  '[{"position":1,"title":"Track A","artist":"Artist A","started_at":1000,"bpm":120.0,"genre":{"raw":"Deep House","normalized":"House","taxonomy_version":1},"camelot_key":"8A","in_library":true,"played_ms":240000,"library_added_at":1644628114}]'::jsonb
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

-- Story 3.7 (§3d): the two wire-promoted capture fields survive the RPC write
-- boundary — played_ms verbatim (bigint ms) and library_added_at as a real
-- timestamptz cast from the wire's epoch-seconds convention.
select is(
  (select played_ms::int from public.plays where dj_id = '11111111-1111-1111-1111-111111111111'),
  240000,
  'played_ms survives the sync_set write boundary (Story 3.7 AC-41)'
);

select is(
  (select extract(epoch from library_added_at)::int from public.plays where dj_id = '11111111-1111-1111-1111-111111111111'),
  1644628114,
  'library_added_at survives the sync_set write boundary as timestamptz (Story 3.7 AC-41)'
);

-- Story 3.7 code review: the DB-level CHECK mirrors the JSON schema's own
-- `played_ms minimum: 0` — a negative duration is rejected at the write
-- boundary, not just documented as invalid in the schema.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select throws_ok(
  $$ select public.sync_set(
    'legacy:negative-duration',
    1000,
    1600,
    '{}'::jsonb,
    '[{"position":1,"title":"Bad","artist":null,"started_at":1000,"bpm":null,"genre":null,"camelot_key":null,"in_library":false,"played_ms":-1}]'::jsonb
  ) $$,
  '23514'::char(5),
  NULL,
  'a negative played_ms is rejected by the played_ms >= 0 check constraint'
);

reset role;
reset request.jwt.claims;

-- A pre-3.7 agent's play (neither key present) still syncs, both columns null —
-- the additive-only guarantee at the RPC layer.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select public.sync_set(
  'legacy:old-agent',
  5000,
  5600,
  '{}'::jsonb,
  '[{"position":1,"title":"Old","artist":null,"started_at":5000,"bpm":null,"genre":null,"camelot_key":null,"in_library":false}]'::jsonb
);

reset role;
reset request.jwt.claims;

select is(
  (select (played_ms is null and library_added_at is null) from public.plays pl
   join public.sessions ss on ss.id = pl.set_id
   where ss.session_identity = 'legacy:old-agent'),
  true,
  'a pre-3.7 payload with neither new field still syncs, both columns null (additive-only)'
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

-- ── Story 5.2 (D-19/D-20, AD-23): suggested-segment materialization ────────
--
-- The whole transport, end to end: the agent sends 1-based positions on
-- `derived.suggested_segments`, and the RPC resolves them to the `plays.id`s it
-- just minted. Nothing about this needs a new RPC, a new grant, or a DJ write
-- permission on `segments`.
--
-- A fresh set (not `legacy:abc`, whose plays Case 3 already emptied) with six
-- plays and two suggestions: 1..3 and 5..6.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select public.sync_set(
  'serato4:segments',
  9000,
  9600,
  '{"track_count":6,"suggested_segments":[{"type":"dancefloor","first_position":1,"last_position":3},{"type":"dancefloor","first_position":5,"last_position":6}]}'::jsonb,
  '[{"position":1,"title":"A","artist":null,"started_at":9000,"bpm":128.0,"genre":null,"camelot_key":null,"in_library":true},
    {"position":2,"title":"B","artist":null,"started_at":9100,"bpm":128.0,"genre":null,"camelot_key":null,"in_library":true},
    {"position":3,"title":"C","artist":null,"started_at":9200,"bpm":128.0,"genre":null,"camelot_key":null,"in_library":true},
    {"position":4,"title":"D","artist":null,"started_at":9300,"bpm":128.0,"genre":null,"camelot_key":null,"in_library":true},
    {"position":5,"title":"E","artist":null,"started_at":9400,"bpm":128.0,"genre":null,"camelot_key":null,"in_library":true},
    {"position":6,"title":"F","artist":null,"started_at":9500,"bpm":128.0,"genre":null,"camelot_key":null,"in_library":true}]'::jsonb
);

reset role;
reset request.jwt.claims;

select is(
  (select count(*)::int from public.segments se
   join public.sessions ss on ss.id = se.set_id
   where ss.session_identity = 'serato4:segments'),
  2,
  'a payload carrying two suggested_segments lands exactly two segments rows (D-15: several, not one)'
);

-- The positions actually RESOLVED — a row pointing at the wrong plays would
-- still count as 2 above. Boundary plays are checked by their titles.
select is(
  (select string_agg(fp.title || '..' || lp.title, ',' order by fp.position)
     from public.segments se
     join public.sessions ss on ss.id = se.set_id
     join public.plays fp on fp.id = se.first_play_id
     join public.plays lp on lp.id = se.last_play_id
    where ss.session_identity = 'serato4:segments'),
  'A..C,E..F',
  'first_position/last_position resolve to the correct just-inserted plays rows (D-20)'
);

select is(
  (select bool_and(se.source = 'suggested' and se.confirmed = false)
     from public.segments se
     join public.sessions ss on ss.id = se.set_id
    where ss.session_identity = 'serato4:segments'),
  true,
  'sync_set only ever writes (suggested, false) rows -- never a confirmed or manual one (AD-23)'
);

select is(
  (select bool_and(se.dj_id = '11111111-1111-1111-1111-111111111111' and se.type = 'dancefloor')
     from public.segments se
     join public.sessions ss on ss.id = se.set_id
    where ss.session_identity = 'serato4:segments'),
  true,
  'dj_id is derived from auth.uid(), not the payload, and the type is always dancefloor (D-20/D-26)'
);

-- Only the owning DJ can read them: `segments` carries an owner-only RLS SELECT
-- policy (Story 5.1) and this write path adds no grant that could widen it.
set local role authenticated;
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select count(*)::int from public.segments),
  0,
  'the other DJ cannot see the segments rows sync_set wrote for DJ A'
);

reset role;
reset request.jwt.claims;

-- Re-syncing the same set REPLACES its suggestions rather than accumulating
-- them: the count is stable and the ids are all fresh (the plays they reference
-- were re-minted, so the rows must be too).
create temporary table segment_ids_before as
  select se.id from public.segments se
  join public.sessions ss on ss.id = se.set_id
  where ss.session_identity = 'serato4:segments';

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select public.sync_set(
  'serato4:segments',
  9000,
  9600,
  '{"track_count":6,"suggested_segments":[{"type":"dancefloor","first_position":1,"last_position":3},{"type":"dancefloor","first_position":5,"last_position":6}]}'::jsonb,
  '[{"position":1,"title":"A","artist":null,"started_at":9000,"bpm":128.0,"genre":null,"camelot_key":null,"in_library":true},
    {"position":2,"title":"B","artist":null,"started_at":9100,"bpm":128.0,"genre":null,"camelot_key":null,"in_library":true},
    {"position":3,"title":"C","artist":null,"started_at":9200,"bpm":128.0,"genre":null,"camelot_key":null,"in_library":true},
    {"position":4,"title":"D","artist":null,"started_at":9300,"bpm":128.0,"genre":null,"camelot_key":null,"in_library":true},
    {"position":5,"title":"E","artist":null,"started_at":9400,"bpm":128.0,"genre":null,"camelot_key":null,"in_library":true},
    {"position":6,"title":"F","artist":null,"started_at":9500,"bpm":128.0,"genre":null,"camelot_key":null,"in_library":true}]'::jsonb
);

reset role;
reset request.jwt.claims;

select is(
  (select count(*)::int from public.segments se
   join public.sessions ss on ss.id = se.set_id
   where ss.session_identity = 'serato4:segments'),
  2,
  're-syncing replaces the suggested rows rather than accumulating them (still exactly two)'
);

select is(
  (select count(*)::int from public.segments se
   join public.sessions ss on ss.id = se.set_id
   where ss.session_identity = 'serato4:segments'
     and se.id in (select id from segment_ids_before)),
  0,
  're-syncing mints fresh segments rows -- the plays they referenced were themselves re-minted'
);

-- An out-of-range entry is SKIPPED, not raised: the plays and the valid
-- suggestion both still land. An overlay nicety must never poison a content
-- sync or wedge the agent's retry queue (D-20).
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select public.sync_set(
  'serato4:bad-segment',
  11000,
  11600,
  '{"track_count":3,"suggested_segments":[{"type":"dancefloor","first_position":1,"last_position":99},{"type":"dancefloor","first_position":3,"last_position":2},{"type":"dancefloor","first_position":1,"last_position":2}]}'::jsonb,
  '[{"position":1,"title":"A","artist":null,"started_at":11000,"bpm":128.0,"genre":null,"camelot_key":null,"in_library":true},
    {"position":2,"title":"B","artist":null,"started_at":11100,"bpm":128.0,"genre":null,"camelot_key":null,"in_library":true},
    {"position":3,"title":"C","artist":null,"started_at":11200,"bpm":128.0,"genre":null,"camelot_key":null,"in_library":true}]'::jsonb
);

reset role;
reset request.jwt.claims;

select is(
  (select count(*)::int from public.plays pl
   join public.sessions ss on ss.id = pl.set_id
   where ss.session_identity = 'serato4:bad-segment'),
  3,
  'a malformed suggestion never blocks the content sync -- all three plays still landed'
);

select is(
  (select count(*)::int from public.segments se
   join public.sessions ss on ss.id = se.set_id
   where ss.session_identity = 'serato4:bad-segment'),
  1,
  'the out-of-range and inverted entries are skipped; only the valid one lands'
);

-- Old-agent compatibility (AD-15): a payload with no `suggested_segments` key
-- at all syncs normally and writes zero segments rows.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select public.sync_set(
  'serato4:old-agent-no-segments',
  12000,
  12600,
  '{"track_count":1}'::jsonb,
  '[{"position":1,"title":"A","artist":null,"started_at":12000,"bpm":null,"genre":null,"camelot_key":null,"in_library":true}]'::jsonb
);

reset role;
reset request.jwt.claims;

select is(
  (select count(*)::int from public.segments se
   join public.sessions ss on ss.id = se.set_id
   where ss.session_identity = 'serato4:old-agent-no-segments'),
  0,
  'a pre-5.2 payload with no suggested_segments key inserts zero segments rows and does not error'
);

-- Code review finding (2026-08-10): an all-digit position string that overflows
-- `int4` passed the old `^[0-9]+$`-only guard and then raised on the `::int`
-- cast, aborting the whole transaction -- the exact failure the skip-never-raise
-- design exists to prevent. `first_position` here is 10 digits, past int4's
-- ~2.1 billion ceiling.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select public.sync_set(
  'serato4:oversized-position',
  13000,
  13600,
  '{"track_count":2,"suggested_segments":[{"type":"dancefloor","first_position":9999999999,"last_position":2}]}'::jsonb,
  '[{"position":1,"title":"A","artist":null,"started_at":13000,"bpm":128.0,"genre":null,"camelot_key":null,"in_library":true},
    {"position":2,"title":"B","artist":null,"started_at":13100,"bpm":128.0,"genre":null,"camelot_key":null,"in_library":true}]'::jsonb
);

reset role;
reset request.jwt.claims;

select is(
  (select count(*)::int from public.plays pl
   join public.sessions ss on ss.id = pl.set_id
   where ss.session_identity = 'serato4:oversized-position'),
  2,
  'an int4-overflowing position never blocks the content sync -- both plays still landed'
);

select is(
  (select count(*)::int from public.segments se
   join public.sessions ss on ss.id = se.set_id
   where ss.session_identity = 'serato4:oversized-position'),
  0,
  'the int4-overflowing suggestion is skipped, not raised'
);

-- Code review finding (2026-08-10): `suggested_segments` present but not a JSON
-- array (a bare string here) raised inside `jsonb_array_elements` before the
-- per-entry loop ever ran, aborting the whole transaction the same way.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select public.sync_set(
  'serato4:non-array-suggestions',
  14000,
  14600,
  '{"track_count":1,"suggested_segments":"not-an-array"}'::jsonb,
  '[{"position":1,"title":"A","artist":null,"started_at":14000,"bpm":null,"genre":null,"camelot_key":null,"in_library":true}]'::jsonb
);

reset role;
reset request.jwt.claims;

select is(
  (select count(*)::int from public.plays pl
   join public.sessions ss on ss.id = pl.set_id
   where ss.session_identity = 'serato4:non-array-suggestions'),
  1,
  'a non-array suggested_segments value never blocks the content sync -- the play still landed'
);

select is(
  (select count(*)::int from public.segments se
   join public.sessions ss on ss.id = se.set_id
   where ss.session_identity = 'serato4:non-array-suggestions'),
  0,
  'a non-array suggested_segments value is skipped entirely, not raised'
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
