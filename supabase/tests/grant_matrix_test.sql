begin;

create extension if not exists pgtap with schema extensions;

-- 60 = two set-wide blocks of 8 tables (INSERT, DELETE -- 16) + two
-- set-wide blocks of 7 tables (TRUNCATE x2 -- 14, unchanged: the
-- catalog-driven generic TRUNCATE sweep at the bottom of this file already
-- covers any new table automatically, so `segments` was deliberately not
-- added to these two hardcoded arrays) + 6 intended-write assertions
-- + 4 on deleted_sets + 6 function-revoke + 4 agent-write-path
-- + 3 generic SECURITY DEFINER / trigger-function sweeps
-- + 4 billing-column negative-grant (Story 7.1: djs.stripe_customer_id/
-- stripe_subscription_id/subscription_status/current_period_end) + 3
-- apply_subscription_event execute-grant assertions (anon negative,
-- authenticated negative, service_role positive) = 60.
select plan(60);

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
from unnest(array['sessions','sets','plays','library_track_events','library_roster','agent_status','djs','segments']) t;

select ok(not has_table_privilege('anon', 'public.' || t, 'TRUNCATE'), 'anon cannot TRUNCATE ' || t)
from unnest(array['sessions','sets','plays','library_track_events','library_roster','agent_status','djs']) t;

select ok(not has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE'), 'authenticated cannot TRUNCATE ' || t)
from unnest(array['sessions','sets','plays','library_track_events','library_roster','agent_status','djs']) t;

select ok(not has_table_privilege('anon', 'public.' || t, 'DELETE'), 'anon cannot DELETE from ' || t)
from unnest(array['sessions','sets','plays','library_track_events','library_roster','agent_status','djs','segments']) t;

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

-- Story 7.1: the four billing columns land with zero new grants -- every
-- existing UPDATE grant on djs is already column-scoped (phone, dj_name
-- only), so these are unwritable by authenticated by construction. Mirrors
-- lines 55-57's positive pattern, negated, looped via unnest (this file's
-- own idiom for a same-shape assertion repeated per item).
select ok(not has_column_privilege('authenticated', 'public.djs', c, 'UPDATE'), 'authenticated cannot update djs.' || c || ' (Story 7.1 billing column, zero new grants)')
from unnest(array['stripe_customer_id','stripe_subscription_id','subscription_status','current_period_end']) c;

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
select ok(not has_function_privilege('anon', 'public.sync_library_roster(jsonb)', 'EXECUTE'), 'anon cannot execute sync_library_roster');
select ok(not has_function_privilege('anon', 'public.handle_new_dj()', 'EXECUTE'), 'anon cannot execute handle_new_dj');
select ok(not has_function_privilege('authenticated', 'public.handle_new_dj()', 'EXECUTE'), 'authenticated cannot execute handle_new_dj either -- it is a trigger function');
select ok(not has_function_privilege('anon', 'public.apply_subscription_event(uuid, text, text, text, timestamptz, timestamptz)', 'EXECUTE'), 'anon cannot execute apply_subscription_event');

-- The agent's write path must still work: it is EXECUTE on SECURITY DEFINER
-- RPCs, never table grants (AD-19/AD-20).
select ok(has_function_privilege('authenticated', 'public.sync_set(text, bigint, bigint, jsonb, jsonb)', 'EXECUTE'), 'authenticated CAN execute sync_set');
select ok(has_function_privilege('authenticated', 'public.sync_library_add_events(jsonb)', 'EXECUTE'), 'authenticated CAN execute sync_library_add_events');
select ok(has_function_privilege('authenticated', 'public.set_agent_status(text, text)', 'EXECUTE'), 'authenticated CAN execute set_agent_status');
select ok(has_function_privilege('authenticated', 'public.sync_library_roster(jsonb)', 'EXECUTE'), 'authenticated CAN execute sync_library_roster (AD-22 write path)');

-- apply_subscription_event (Story 7.1, AD-18) is the first function in this
-- suite that needs the OPPOSITE of every assertion above: authenticated
-- must NOT be able to execute it (it is called only by the Stripe webhook,
-- authenticating as service_role -- dj_id is a parameter, not derived from
-- auth.uid(), so authenticated access would be a spoofing hole). Don't
-- pattern-match the positive block above blindly for this one.
select ok(not has_function_privilege('authenticated', 'public.apply_subscription_event(uuid, text, text, text, timestamptz, timestamptz)', 'EXECUTE'), 'authenticated cannot execute apply_subscription_event (sole caller is service_role)');

-- The positive half of Story 7.1's deviation: service_role has an explicit,
-- PUBLIC-independent EXECUTE grant, proving the migration's revoke/grant
-- pair actually closed deferred-work.md's "service_role has no CRUD grants
-- on a fresh replay" gap for this one function.
select ok(has_function_privilege('service_role', 'public.apply_subscription_event(uuid, text, text, text, timestamptz, timestamptz)', 'EXECUTE'), 'service_role CAN execute apply_subscription_event');

-- GENERIC SWEEPS. The per-function assertions above only catch functions
-- somebody remembered to list — which is precisely how `record_deleted_set()`
-- shipped anon-executable in 20260807130000 while 20260807140000 was busy
-- revoking EXECUTE on the other three (Supabase's advisor caught it, this
-- suite did not). These three fail for ANY future offender instead.
select is(
  (select count(*)::int from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0,
  'NO SECURITY DEFINER function in public is executable by anon'
);

-- Trigger functions are invoked by their trigger as the table owner. No client
-- role should ever hold EXECUTE on one, whatever it does internally.
select is(
  (select count(*)::int from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prorettype = 'pg_catalog.trigger'::regtype
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
       or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0,
  'NO trigger function in public is executable by anon or authenticated'
);

-- Nothing client-facing may hold TRUNCATE on any table in `public`: RLS does not
-- filter TRUNCATE, so it is the one privilege a policy cannot walk back. Written
-- table-agnostically so a table added by a future migration is covered without
-- anyone remembering to extend the list above.
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and privilege_type = 'TRUNCATE'
     and grantee in ('anon', 'authenticated')),
  0,
  'NO table in public grants TRUNCATE to anon or authenticated (RLS cannot filter it)'
);

select * from finish();

rollback;
