-- Migration: harden_table_and_function_grants
-- Story 4.6 code review (2026-08-07) — reconciles the HOSTED project's actual
-- ACLs with what the migration history has always intended.
--
-- WHAT WAS FOUND. Inspecting the hosted project (jmitbnrofacxwsbwuxzs) during
-- Story 4.6's review turned up every table in `public` granting the full set —
-- DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE — to BOTH
-- `anon` and `authenticated`. No migration in this repo ever granted that; the
-- migrations grant SELECT (plus two column-scoped UPDATEs on `djs` and, since
-- 20260807120000, DELETE on `sets`) and say so explicitly and repeatedly
-- ("Deliberately no INSERT/UPDATE/DELETE grant or policy...").
--
-- The cause is not a hand-edit: the hosted project runs the LEGACY
-- `auto_expose_new_tables` behaviour, which auto-grants everything to the Data
-- API roles as each table is created. `supabase/config.toml` leaves that field
-- commented out, so a local `supabase db reset` gets the modern
-- not-auto-exposed default instead. Local and hosted authorization therefore
-- diverge, and a local-only pgTAP suite cannot see it — notably
-- `sets_delete_policy_isolation_test.sql`'s "anon cannot delete from sets"
-- case, which is true locally and was false on hosted.
--
-- WHY IT MATTERS EVEN THOUGH RLS CONTAINED IT. RLS is enabled on every table
-- and there were no INSERT/UPDATE/DELETE policies, so those grants matched zero
-- rows. Two reasons not to leave it:
--   1. `TRUNCATE` is NOT filtered by RLS. A `TRUNCATE` privilege is not
--      contained by any policy; the only thing standing in front of it was that
--      PostgREST exposes no TRUNCATE verb. That is incidental, not designed.
--   2. It makes RLS the sole line of defence for everything else, so one
--      mis-scoped future policy becomes a data-loss bug instead of a no-op.
--      AD-7's owner-scoped posture should be true at the ACL layer too.
--
-- Applied while the project holds no DJ data (0 sessions/sets/plays/add-events
-- at the time of writing), which is the cheapest possible moment.
--
-- `revoke all` + re-grant rather than revoking named privileges: it is
-- idempotent, and it converges local (narrow) and hosted (wide) onto the same
-- end state instead of assuming either starting point.
--
-- `service_role` is deliberately untouched — it is not exposed to browsers and
-- needs full access.

-- ---------------------------------------------------------------- tables ----

revoke all on public.djs                  from anon, authenticated;
revoke all on public.sessions             from anon, authenticated;
revoke all on public.sets                 from anon, authenticated;
revoke all on public.plays                from anon, authenticated;
revoke all on public.agent_status         from anon, authenticated;
revoke all on public.library_track_events from anon, authenticated;
revoke all on public.deleted_sets         from anon, authenticated;

-- SELECT for BOTH roles is intentional and load-bearing, not an oversight —
-- see 20260726012050_create_djs_table.sql's own note: without an `anon` SELECT
-- grant a signed-out request gets a "permission denied" error instead of the
-- RLS-filtered empty result the UI is written against. RLS still scopes every
-- one of these to `auth.uid() = dj_id`, so `anon` reads nothing.
grant select on public.djs                  to authenticated, anon;
grant select on public.sessions             to authenticated, anon;
grant select on public.sets                 to authenticated, anon;
grant select on public.plays                to authenticated, anon;
grant select on public.agent_status         to authenticated, anon;
grant select on public.library_track_events to authenticated, anon;

-- `deleted_sets` is authenticated-only (20260807130000): a DJ may observe their
-- own tombstones, `anon` has no reason to see even an empty result.
grant select on public.deleted_sets to authenticated;

-- The only DJ-facing writes the migration history has ever intended.
-- Column-scoped on `djs` per AD-19's standing requirement — never a blanket
-- `grant update on public.djs` (20260727192439, 20260806090000).
grant update (phone)   on public.djs to authenticated;
grant update (dj_name) on public.djs to authenticated;

-- The DJ-initiated set removal added by 20260807120000 (Story 4.6 AC-5).
grant delete on public.sets to authenticated;

-- ------------------------------------------------------------- functions ----
--
-- Same treatment 20260806090100 already gave `set_agent_status`, for the reason
-- stated there: "Functions are born with EXECUTE granted to PUBLIC; revoke it
-- so anon's inability to call this is a real ACL fact, not just the in-function
-- auth.uid() check." That fix was never applied to the other three, which is
-- why Supabase's own security advisor flags all three as anon-executable
-- SECURITY DEFINER functions. Each already self-defends by raising when
-- `auth.uid()` is null; this makes the ACL agree with the intent.

revoke execute on function public.sync_set(text, bigint, bigint, jsonb, jsonb) from public, anon;
grant  execute on function public.sync_set(text, bigint, bigint, jsonb, jsonb) to authenticated;

revoke execute on function public.sync_library_add_events(jsonb) from public, anon;
grant  execute on function public.sync_library_add_events(jsonb) to authenticated;

-- `handle_new_dj` is a trigger function: it is invoked BY the trigger on
-- auth.users (as the table owner), never by a client, so no client role needs
-- EXECUTE at all. Calling it over RPC would fail anyway for want of a trigger
-- context — but "fails for an unrelated reason" is not an access control.
revoke execute on function public.handle_new_dj() from public, anon, authenticated;
