-- Story 4.11 — `library_roster` isolation + current-state mutability (AC-2,
-- AC-3, AC-4, AC-5).
--
-- Mirrors library_track_events_isolation_test.sql's structure (seed two DJs
-- as the elevated role, prove owner-only SELECT in both directions, no
-- write access at all, an anon read of zero rows, a full cascade on account
-- deletion) plus the guarantees SPECIFIC to this table: DO UPDATE
-- current-state semantics (unlike library_track_events' DO NOTHING),
-- added_at/is_baseline staying first-write-wins even though title/artist
-- are mutable, and absent_at's soft-delete round trip.

begin;

create extension if not exists pgtap with schema extensions;

select plan(23);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'dj-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'dj-b@example.com');

insert into public.library_roster (dj_id, track_id, title, artist, added_at, is_baseline) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaaaaaaaaaa', 'Track A', 'Artist A', '2026-03-01T00:00:00Z', false),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbbbbbbbbbb', 'Track B', 'Artist B', '2026-03-02T00:00:00Z', false);

-- Case 1: added_at/title/artist are all genuinely nullable (AD-11, D-10 for
-- added_at; the "None only in pathological cases" note on title/artist).
insert into public.library_roster (dj_id, track_id, is_baseline) values
  ('11111111-1111-1111-1111-111111111111', 'cccccccccccccccc', true);

select is(
  (select added_at from public.library_roster
    where dj_id = '11111111-1111-1111-1111-111111111111' and track_id = 'cccccccccccccccc'),
  NULL,
  'a roster row with no resolvable date stores added_at as NULL, never a guessed date'
);

-- Case 2: the (dj_id, track_id) idempotency key rejects a duplicate INSERT
-- from outside the RPC (the RPC itself upserts; a raw duplicate must not).
select throws_ok(
  $$ insert into public.library_roster (dj_id, track_id) values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaaaaaaaaaa') $$,
  '23505'::char(5),
  NULL,
  'a duplicate (dj_id, track_id) is rejected (UNIQUE violation)'
);

-- Case 2b: the SAME track_id under a DIFFERENT DJ is a different row.
insert into public.library_roster (dj_id, track_id) values
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaaaaaaaaaa');

select is(
  (select count(*)::int from public.library_roster where track_id = 'aaaaaaaaaaaaaaaa'),
  2,
  'the same track_id under two different DJs is two rows, not a collision'
);

-- Case 3: the FK to djs enforces referential integrity.
select throws_ok(
  $$ insert into public.library_roster (dj_id, track_id) values ('99999999-9999-9999-9999-999999999999', 'dddddddddddddddd') $$,
  '23503'::char(5),
  NULL,
  'a roster row referencing a nonexistent dj_id is rejected (FK violation)'
);

-- Case 4: cross-DJ SELECT isolation, both directions.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select results_eq(
  $$ select track_id from public.library_roster order by track_id $$,
  $$ values ('aaaaaaaaaaaaaaaa'::text), ('cccccccccccccccc'::text) $$,
  'authenticated DJ A sees only their own roster rows, not DJ B''s'
);

reset role;
reset request.jwt.claims;

set local role authenticated;
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select results_eq(
  $$ select track_id from public.library_roster order by track_id $$,
  $$ values ('aaaaaaaaaaaaaaaa'::text), ('bbbbbbbbbbbbbbbb'::text) $$,
  'authenticated DJ B sees only their own roster rows, not DJ A''s'
);

reset role;
reset request.jwt.claims;

-- Case 5: no DJ-facing write access of any kind. The ONLY write path is the
-- SECURITY DEFINER function.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select throws_ok(
  $$ insert into public.library_roster (dj_id, track_id) values ('11111111-1111-1111-1111-111111111111', 'eeeeeeeeeeeeeeee') $$,
  '42501'::char(5),
  NULL,
  'authenticated cannot insert into library_roster (no insert grant)'
);

select throws_ok(
  $$ update public.library_roster set title = 'hacked' where track_id = 'aaaaaaaaaaaaaaaa' $$,
  '42501'::char(5),
  NULL,
  'authenticated cannot update library_roster (no update grant)'
);

select throws_ok(
  $$ delete from public.library_roster where track_id = 'aaaaaaaaaaaaaaaa' $$,
  '42501'::char(5),
  NULL,
  'authenticated cannot delete from library_roster (no delete grant)'
);

-- Case 6 (AC-2): the sanctioned write path derives dj_id from auth.uid(),
-- never a client-supplied one.
select is(
  (select public.sync_library_roster('[{"track_id":"ffffffffffffffff","title":"New Track","artist":"New Artist","added_at":1772323200,"is_baseline":false,"absent_at":null}]'::jsonb)),
  1,
  'the RPC accepts a batch and reports how many entries it processed'
);

select is(
  (select dj_id from public.library_roster where track_id = 'ffffffffffffffff'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'the RPC writes the row under the CALLER''s dj_id, never a client-supplied one'
);

select is(
  (select title from public.library_roster where track_id = 'ffffffffffffffff'),
  'New Track',
  'the RPC persists title on first insert'
);

-- Case 7 (AC-4): a re-tag (same track_id, new title/artist) refreshes in
-- place -- the roster's current-state, mutable behavior, UNLIKE
-- library_track_events' first-write-wins.
select public.sync_library_roster('[{"track_id":"ffffffffffffffff","title":"Retagged Track","artist":"Retagged Artist","added_at":1772323200,"is_baseline":false,"absent_at":null}]'::jsonb);

select is(
  (select title from public.library_roster where track_id = 'ffffffffffffffff'),
  'Retagged Track',
  'a re-synced entry refreshes title in place (current-state, AC-4)'
);

select is(
  (select artist from public.library_roster where track_id = 'ffffffffffffffff'),
  'Retagged Artist',
  'a re-synced entry refreshes artist in place (current-state, AC-4)'
);

-- Case 8 (AC-3): added_at/is_baseline must NEVER move on a re-sync, even
-- though title/artist do -- the mechanical enforcement of this story's
-- central invariant. Try to smuggle a different added_at/is_baseline through
-- a "re-tag" batch and confirm neither takes effect.
select public.sync_library_roster('[{"track_id":"ffffffffffffffff","title":"Retagged Again","artist":"Retagged Again","added_at":1600000000,"is_baseline":true,"absent_at":null}]'::jsonb);

select is(
  (select added_at from public.library_roster where track_id = 'ffffffffffffffff'),
  '2026-03-01T00:00:00Z'::timestamptz,
  'added_at never moves on a re-sync, even when the incoming batch carries a different value (AC-3)'
);

select is(
  (select is_baseline from public.library_roster where track_id = 'ffffffffffffffff'),
  false,
  'is_baseline never moves on a re-sync, even when the incoming batch carries a different value (AC-3)'
);

-- Case 9 (AC-5): the absence round trip. Marking absent, then clearing it on
-- reappearance, both via the RPC.
select public.sync_library_roster('[{"track_id":"ffffffffffffffff","title":"Retagged Again","artist":"Retagged Again","added_at":1600000000,"is_baseline":true,"absent_at":1772409600}]'::jsonb);

select isnt(
  (select absent_at from public.library_roster where track_id = 'ffffffffffffffff'),
  NULL,
  'a batch carrying absent_at marks the row absent'
);

select public.sync_library_roster('[{"track_id":"ffffffffffffffff","title":"Retagged Again","artist":"Retagged Again","added_at":1600000000,"is_baseline":true,"absent_at":null}]'::jsonb);

select is(
  (select absent_at from public.library_roster where track_id = 'ffffffffffffffff'),
  NULL,
  'a reappeared track''s absent_at clears back to NULL, unlike title/artist this is a bare overwrite'
);

-- Case 10: a blank track_id is skipped, never written.
select is(
  (select public.sync_library_roster('[{"track_id":"","title":null,"artist":null,"added_at":null,"is_baseline":false,"absent_at":null}]'::jsonb)),
  0,
  'entries with a blank track_id are skipped, never written'
);

reset role;
reset request.jwt.claims;

-- Case 11: an unauthenticated caller cannot use the write path.
--
-- NOTE (Story 4.11 code review): as `anon` this passes on the missing EXECUTE
-- grant -- Postgres raises 42501 before the function body ever runs, so it does
-- NOT exercise the `caller_dj_id is null` guard inside the function. Kept,
-- because "anon cannot call this at all" is worth pinning in its own right, but
-- Case 11b below is what actually covers the guard.
set local role anon;

select throws_ok(
  $$ select public.sync_library_roster('[{"track_id":"99999999aaaaaaaa","title":null,"artist":null,"added_at":null,"is_baseline":false,"absent_at":null}]'::jsonb) $$,
  '42501'::char(5),
  NULL,
  'the RPC refuses an unauthenticated caller (blocked at the EXECUTE grant)'
);

reset role;

-- Case 11b: the function body's OWN authentication guard. A caller who HAS the
-- EXECUTE grant (role `authenticated`) but carries no `sub` claim reaches the
-- function and must be rejected by `caller_dj_id is null` -- the branch Case 11
-- can never reach. Without this, that `raise exception` is dead code in the
-- suite and a regression removing it would go unnoticed.
set local role authenticated;
set local request.jwt.claims to '{"role":"authenticated"}';

select throws_ok(
  $$ select public.sync_library_roster('[{"track_id":"99999999aaaaaaaa","title":null,"artist":null,"added_at":null,"is_baseline":false,"absent_at":null}]'::jsonb) $$,
  '42501'::char(5),
  'sync_library_roster requires an authenticated caller',
  'the RPC''s own guard rejects a granted caller with no auth.uid()'
);

reset role;
reset request.jwt.claims;
set local role anon;

-- Case 12: as anon with no JWT, a select returns zero rows.
select is(
  (select count(*)::int from public.library_roster),
  0,
  'anon sees zero library_roster rows'
);

reset role;

-- Case 13: deleting a DJ's auth.users row cascades through djs into their
-- roster, matching sessions/sets/plays/library_track_events.
insert into auth.users (id, email) values
  ('55555555-5555-5555-5555-555555555555', 'dj-cascade@example.com');

insert into public.library_roster (dj_id, track_id) values
  ('55555555-5555-5555-5555-555555555555', 'cascade000000000');

delete from auth.users where id = '55555555-5555-5555-5555-555555555555';

select is(
  (select count(*)::int from public.library_roster where dj_id = '55555555-5555-5555-5555-555555555555'),
  0,
  'deleting the auth.users row cascades and removes the DJ''s roster rows'
);

select * from finish();

rollback;
