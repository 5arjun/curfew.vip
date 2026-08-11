begin;

create extension if not exists pgtap with schema extensions;

-- Story 5.3 (D-29, D-32) — the boundary-integrity trigger, `segments_validate`.
--
-- A sibling file rather than more cases in `segments_isolation_test.sql`,
-- matching the split `sync_set_isolation_test.sql` already established: that
-- file proves WHOSE rows a role can reach (RLS, grants, cascades); this one
-- proves WHICH rows are structurally legal at all, a rule that applies equally
-- to every DJ and has nothing to do with isolation.
--
-- Every rejection below asserts the SPECIFIC message, not a generic constraint
-- code. That is deliberate and it is a contract, not test pedantry: the web
-- editor has to tell these four failure modes apart to tell the DJ anything
-- useful (`web/lib/sets/segmentWrites.ts` matches on exactly these strings), so
-- a change that kept the rejection but altered the wording would break the UI
-- while a `throws_ok(..., '23514')`-style assertion sailed through.

select plan(15);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'dj-write-a@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'dj-write-b@example.com');

insert into public.sessions (id, dj_id, session_identity) values
  ('aaaaaaaa-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'session-write-a'),
  ('aaaaaaaa-1111-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'session-write-a2'),
  ('bbbbbbbb-1111-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'session-write-b');

-- DJ A owns TWO sets. The second exists purely so the set-consistency case has
-- a play the same DJ can legitimately see but must still not point at -- the
-- cross-DJ version of that test is blocked a step earlier by RLS, so it cannot
-- prove the check itself.
insert into public.sets (id, session_id, dj_id, started_at, ended_at) values
  ('aaaaaaaa-2222-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', now(), now()),
  ('aaaaaaaa-2222-0000-0000-000000000002', 'aaaaaaaa-1111-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', now(), now()),
  ('bbbbbbbb-2222-0000-0000-000000000002', 'bbbbbbbb-1111-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', now(), now());

-- Set 1: six plays, so a segment can be placed, moved, and have room left over
-- for a non-overlapping neighbour.
insert into public.plays (id, set_id, dj_id, position, in_library) values
  ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-2222-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 1, true),
  ('aaaaaaaa-3333-0000-0000-000000000002', 'aaaaaaaa-2222-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 2, true),
  ('aaaaaaaa-3333-0000-0000-000000000003', 'aaaaaaaa-2222-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 3, true),
  ('aaaaaaaa-3333-0000-0000-000000000004', 'aaaaaaaa-2222-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 4, true),
  ('aaaaaaaa-3333-0000-0000-000000000005', 'aaaaaaaa-2222-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 5, true),
  ('aaaaaaaa-3333-0000-0000-000000000006', 'aaaaaaaa-2222-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 6, true),
  -- Set 2, same DJ.
  ('aaaaaaaa-4444-0000-0000-000000000001', 'aaaaaaaa-2222-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 1, true);

set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

-- ── D-29.1: ordering ────────────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.segments (set_id, dj_id, type, first_play_id, last_play_id, source, confirmed) values ('aaaaaaaa-2222-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'dancefloor', 'aaaaaaaa-3333-0000-0000-000000000004', 'aaaaaaaa-3333-0000-0000-000000000002', 'manual', true) $$,
  'P0001',
  'segment boundaries reversed (first position 4 > last position 2)',
  'D-29.1: a segment whose first boundary sits after its last is rejected, naming both positions'
);

-- A single-track segment (first = last) is NOT reversed and must be accepted --
-- the ordering rule is `>`, not `>=`. Worth asserting because it is the shape
-- D-27's clamp collapses to when a re-sync shrinks a set past a whole range,
-- and a stricter rule here would make that path unwritable.
insert into public.segments (id, set_id, dj_id, type, first_play_id, last_play_id, source, confirmed) values
  ('aaaaaaaa-5555-0000-0000-00000000000f', 'aaaaaaaa-2222-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'dancefloor', 'aaaaaaaa-3333-0000-0000-000000000006', 'aaaaaaaa-3333-0000-0000-000000000006', 'manual', true);

select is(
  (select count(*)::int from public.segments where id = 'aaaaaaaa-5555-0000-0000-00000000000f'),
  1,
  'a single-track segment (first position = last position) is accepted -- the ordering rule is strict, not inclusive'
);

delete from public.segments where id = 'aaaaaaaa-5555-0000-0000-00000000000f';

-- ── D-29.2: FK / set consistency ────────────────────────────────────────────
--
-- The gap Story 5.1's review deferred and `deferred-work.md` has carried since.
-- Both plays below EXIST and both belong to this same DJ, so neither the FK nor
-- RLS has anything to object to -- only this check stands between the DJ and a
-- segment whose boundary lives in a different night entirely.
select throws_ok(
  $$ insert into public.segments (set_id, dj_id, type, first_play_id, last_play_id, source, confirmed) values ('aaaaaaaa-2222-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'dancefloor', 'aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-4444-0000-0000-000000000001', 'manual', true) $$,
  'P0001',
  'segment boundary references a play outside its own set',
  'D-29.2: a boundary play belonging to a DIFFERENT set of the same DJ is rejected'
);

-- ── D-29.4 / D-32: the MVP type guard ───────────────────────────────────────
--
-- The schema enum has permitted dinner/performance/custom since Story 5.1; this
-- guard is what makes the DB agree with the narrowed AC #4 (D-33) instead of
-- quietly admitting a type no UI in this story can render or edit.
select throws_ok(
  $$ insert into public.segments (set_id, dj_id, type, first_play_id, last_play_id, source, confirmed) values ('aaaaaaaa-2222-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'dinner', 'aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-3333-0000-0000-000000000002', 'manual', true) $$,
  'P0001',
  'only dancefloor segments can be written (MVP guard, Story 5.3 D-32)',
  'D-32: a non-dancefloor type is rejected by the MVP guard even though the schema enum permits it'
);

select throws_ok(
  $$ insert into public.segments (set_id, dj_id, type, label, first_play_id, last_play_id, source, confirmed) values ('aaaaaaaa-2222-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'custom', 'After hours', 'aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-3333-0000-0000-000000000002', 'manual', true) $$,
  'P0001',
  'only dancefloor segments can be written (MVP guard, Story 5.3 D-32)',
  'D-32: a custom type WITH a valid label is still rejected -- the guard is on type, not on label completeness'
);

-- ── D-29.3: overlap, same type, same set ────────────────────────────────────
insert into public.segments (id, set_id, dj_id, type, first_play_id, last_play_id, source, confirmed) values
  ('aaaaaaaa-5555-0000-0000-000000000001', 'aaaaaaaa-2222-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'dancefloor', 'aaaaaaaa-3333-0000-0000-000000000002', 'aaaaaaaa-3333-0000-0000-000000000004', 'manual', true);

select throws_ok(
  $$ insert into public.segments (set_id, dj_id, type, first_play_id, last_play_id, source, confirmed) values ('aaaaaaaa-2222-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'dancefloor', 'aaaaaaaa-3333-0000-0000-000000000003', 'aaaaaaaa-3333-0000-0000-000000000005', 'manual', true) $$,
  'P0001',
  'segment overlaps an existing dancefloor segment for this set',
  'D-29.3: a second dancefloor segment overlapping the first is rejected'
);

-- Touching at a shared boundary position IS an overlap: position 4 would belong
-- to both segments, and "which floor is this track in" must have one answer.
select throws_ok(
  $$ insert into public.segments (set_id, dj_id, type, first_play_id, last_play_id, source, confirmed) values ('aaaaaaaa-2222-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'dancefloor', 'aaaaaaaa-3333-0000-0000-000000000004', 'aaaaaaaa-3333-0000-0000-000000000006', 'manual', true) $$,
  'P0001',
  'segment overlaps an existing dancefloor segment for this set',
  'D-29.3: two segments sharing a single boundary position overlap -- the comparison is inclusive'
);

-- Adjacent but disjoint is fine: 5..6 begins after 2..4 ends. The overlap rule
-- must not forbid a DJ marking two real floors back to back.
insert into public.segments (id, set_id, dj_id, type, first_play_id, last_play_id, source, confirmed) values
  ('aaaaaaaa-5555-0000-0000-000000000002', 'aaaaaaaa-2222-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'dancefloor', 'aaaaaaaa-3333-0000-0000-000000000005', 'aaaaaaaa-3333-0000-0000-000000000006', 'manual', true);

select is(
  (select count(*)::int from public.segments where set_id = 'aaaaaaaa-2222-0000-0000-000000000001'),
  2,
  'D-29.3: two ADJACENT non-overlapping dancefloor segments on one set are both accepted'
);

-- ── The trigger fires on UPDATE, not only INSERT (D-29, Boundary's finding) ──
--
-- The whole point of Story 5.3 is that a DJ MOVES boundaries, so a rule checked
-- only at creation would be bypassed by every interaction the story ships.
select throws_ok(
  $$ update public.segments set first_play_id = 'aaaaaaaa-3333-0000-0000-000000000005', last_play_id = 'aaaaaaaa-3333-0000-0000-000000000003' where id = 'aaaaaaaa-5555-0000-0000-000000000001' $$,
  'P0001',
  'segment boundaries reversed (first position 5 > last position 3)',
  'D-29.1 on UPDATE: dragging a first boundary past its own last is rejected'
);

select throws_ok(
  $$ update public.segments set last_play_id = 'aaaaaaaa-4444-0000-0000-000000000001' where id = 'aaaaaaaa-5555-0000-0000-000000000001' $$,
  'P0001',
  'segment boundary references a play outside its own set',
  'D-29.2 on UPDATE: repointing a boundary at another of the DJ''s own sets is rejected'
);

select throws_ok(
  $$ update public.segments set last_play_id = 'aaaaaaaa-3333-0000-0000-000000000005' where id = 'aaaaaaaa-5555-0000-0000-000000000001' $$,
  'P0001',
  'segment overlaps an existing dancefloor segment for this set',
  'D-29.3 on UPDATE: extending a segment into its neighbour''s range is rejected'
);

select throws_ok(
  $$ update public.segments set type = 'performance' where id = 'aaaaaaaa-5555-0000-0000-000000000001' $$,
  'P0001',
  'only dancefloor segments can be written (MVP guard, Story 5.3 D-32)',
  'D-32 on UPDATE: retyping an existing dancefloor segment to another type is rejected'
);

-- A row must not be found to overlap ITSELF. Every confirm and every in-place
-- boundary nudge is an UPDATE on a row that already occupies its own range, so
-- an overlap check missing `s.id <> NEW.id` would reject the single most common
-- write in this story while looking perfectly reasonable in review.
update public.segments set confirmed = true
 where id = 'aaaaaaaa-5555-0000-0000-000000000001';

select is(
  (select confirmed from public.segments where id = 'aaaaaaaa-5555-0000-0000-000000000001'),
  true,
  'an UPDATE that leaves a segment''s own range unchanged does not trip the overlap check against itself'
);

-- Shrinking within one's own range is likewise not a self-overlap.
update public.segments set last_play_id = 'aaaaaaaa-3333-0000-0000-000000000003'
 where id = 'aaaaaaaa-5555-0000-0000-000000000001';

select is(
  (select last_play_id from public.segments where id = 'aaaaaaaa-5555-0000-0000-000000000001'),
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid,
  'a boundary nudge INSIDE a segment''s existing range is accepted'
);

reset role;
reset request.jwt.claims;

-- ── The security-definer exemption (the trigger's own header) ────────────────
--
-- `sync_set` is `security definer`, so its writes run as the function owner and
-- are exempt from every check above. Proven directly here rather than only
-- through `sync_set`, because it is the mechanism D-27's rebind depends on: a
-- clamp onto a shrunken set can legitimately produce an overlap, and if the
-- trigger applied there, restoring a DJ's confirmed segment would raise and
-- abort the entire content sync -- the exact "an overlay nicety must not poison
-- a content sync" failure Epic 5's charter forbids.
insert into public.segments (id, set_id, dj_id, type, first_play_id, last_play_id, source, confirmed) values
  ('aaaaaaaa-6666-0000-0000-000000000001', 'aaaaaaaa-2222-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'dancefloor', 'aaaaaaaa-3333-0000-0000-000000000002', 'aaaaaaaa-3333-0000-0000-000000000004', 'suggested', false);

select is(
  (select count(*)::int from public.segments where id = 'aaaaaaaa-6666-0000-0000-000000000001'),
  1,
  'an elevated (security-definer) caller may write a row the DJ-direct rules would reject -- the exemption D-27''s rebind depends on'
);

select * from finish();

rollback;
