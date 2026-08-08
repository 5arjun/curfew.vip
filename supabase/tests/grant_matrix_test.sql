begin;

create extension if not exists pgtap with schema extensions;

-- 42 = four set-wide blocks of 6 tables (24) + 6 intended-write assertions
-- + 4 on deleted_sets + 5 function-revoke + 3 agent-write-path.
select plan(42);

-- Story 4.6 code review (2026-08-07): pins the ACL matrix the migration history
-- has always described in prose but never asserted.
--
-- WHY THIS FILE EXISTS. The hosted project was found granting the full
-- privilege set (including TRUNCATE, which RLS does not filter) to `anon` and
-- `authenticated` on every table, because it runs the legacy
-- `auto_expose_new_tables` behaviour while `config.toml` leaves that off. Every
-- other isolation test here asserts POLICY behaviour, which is why none of them
-- noticed: RLS was doing the containing, and the grants underneath were wrong.
--
-- These assertions are about the GRANT layer specifically, so a future
-- migration that widens a grant fails here instead of relying on a policy to
-- quietly absorb it. This cannot detect drift on a remote project (it runs
-- against local, built from migrations) — its job is to keep the migrations'
-- intent explicit and machine-checked, so remote drift is a comparison against
-- something unambiguous.

-- Nobody client-facing may INSERT, UPDATE, TRUNCATE or DELETE their way around
-- RLS on the read-only tables. TRUNCATE is called out individually because it
-- is the one privilege no policy can restrain.
select ok(not has_table_privilege('anon', 'public.' || t, 'INSERT'), 'anon cannot INSERT into ' || t)
from unnest(array['sessions','sets','plays','library_track_events','agent_status','djs']) t;

select ok(not has_table_privilege('anon', 'public.' || t, 'TRUNCATE'), 'anon cannot TRUNCATE ' || t)
from unnest(array['sessions','sets','plays','library_track_events','agent_status','djs']) t;

select ok(not has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE'), 'authenticated cannot TRUNCATE ' || t)
from unnest(array['sessions','sets','plays','library_track_events','agent_status','djs']) t;

select ok(not has_table_privilege('anon', 'public.' || t, 'DELETE'), 'anon cannot DELETE from ' || t)
from unnest(array['sessions','sets','plays','library_track_events','agent_status','djs']) t;

-- SELECT for both roles IS intended (20260726012050's note: an `anon` SELECT
-- grant is what makes a signed-out read an RLS-filtered empty result rather
-- than a permission error). Asserted so a future "hardening" pass does not
-- remove it and break the signed-out UI.
select ok(has_table_privilege('anon', 'public.sets', 'SELECT'), 'anon KEEPS SELECT on sets (RLS-filtered empty, not a permission error)');
select ok(has_table_privilege('authenticated', 'public.sets', 'SELECT'), 'authenticated has SELECT on sets');

-- The only DJ-facing writes in the whole schema.
select ok(has_table_privilege('authenticated', 'public.sets', 'DELETE'), 'authenticated CAN delete sets (Story 4.6 AC-5)');
select ok(has_column_privilege('authenticated', 'public.djs', 'phone', 'UPDATE'), 'authenticated can update djs.phone (column-scoped, AD-19)');
select ok(has_column_privilege('authenticated', 'public.djs', 'dj_name', 'UPDATE'), 'authenticated can update djs.dj_name (column-scoped, AD-19)');
select ok(not has_table_privilege('authenticated', 'public.djs', 'UPDATE'), 'authenticated has NO table-wide UPDATE on djs -- the grant stays column-scoped');

-- `deleted_sets` tombstones are observable by their owner, never by anon, and
-- never writable by a client (the recording trigger is SECURITY DEFINER).
select ok(has_table_privilege('authenticated', 'public.deleted_sets', 'SELECT'), 'authenticated can read their own tombstones');
select ok(not has_table_privilege('anon', 'public.deleted_sets', 'SELECT'), 'anon cannot read deleted_sets at all');
select ok(not has_table_privilege('authenticated', 'public.deleted_sets', 'DELETE'), 'authenticated cannot delete a tombstone (that would resurrect a set)');
select ok(not has_table_privilege('authenticated', 'public.deleted_sets', 'INSERT'), 'authenticated cannot forge a tombstone');

-- Functions are born with EXECUTE granted to PUBLIC, so every one of these
-- needs an explicit revoke for `anon`'s inability to be a real ACL fact rather
-- than a consequence of the in-function auth.uid() check (20260806090100's
-- reasoning, applied to all four rather than just one).
select ok(not has_function_privilege('anon', 'public.sync_set(text, bigint, bigint, jsonb, jsonb)', 'EXECUTE'), 'anon cannot execute sync_set');
select ok(not has_function_privilege('anon', 'public.sync_library_add_events(jsonb)', 'EXECUTE'), 'anon cannot execute sync_library_add_events');
select ok(not has_function_privilege('anon', 'public.set_agent_status(text, text)', 'EXECUTE'), 'anon cannot execute set_agent_status');
select ok(not has_function_privilege('anon', 'public.handle_new_dj()', 'EXECUTE'), 'anon cannot execute handle_new_dj');
select ok(not has_function_privilege('authenticated', 'public.handle_new_dj()', 'EXECUTE'), 'authenticated cannot execute handle_new_dj either -- it is a trigger function');

-- The agent's write path must still work: it is EXECUTE on SECURITY DEFINER
-- RPCs, never table grants (AD-19/AD-20).
select ok(has_function_privilege('authenticated', 'public.sync_set(text, bigint, bigint, jsonb, jsonb)', 'EXECUTE'), 'authenticated CAN execute sync_set');
select ok(has_function_privilege('authenticated', 'public.sync_library_add_events(jsonb)', 'EXECUTE'), 'authenticated CAN execute sync_library_add_events');
select ok(has_function_privilege('authenticated', 'public.set_agent_status(text, text)', 'EXECUTE'), 'authenticated CAN execute set_agent_status');

select * from finish();

rollback;
