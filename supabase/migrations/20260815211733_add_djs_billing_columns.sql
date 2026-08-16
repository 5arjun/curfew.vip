-- Migration: add_djs_billing_columns
-- Story 7.1 — Billing columns + write-scoped SECURITY DEFINER function, AD-18/AD-19.
--
-- Four additive, nullable columns on `djs` for subscription state, plus
-- `apply_subscription_event(...)`, their sole writer. Mirrors
-- 20260805120000_create_agent_status.sql's precedent: a table/columns and
-- their sole-writer SECURITY DEFINER function landing together in one file.
--
-- `subscription_status` is `text`, not a DB enum or CHECK-constrained value
-- set (AD-19): it stores Stripe's own status string verbatim, a thin
-- passthrough, never a second state machine. While it is `'trialing'`,
-- `current_period_end` holds the trial end -- no separate trial column.
--
-- `last_subscription_event_at` (code review, 2026-08-15) is a fifth,
-- bookkeeping-only column: it is not part of AD-19's four billing columns
-- and carries no product meaning of its own. It exists solely so
-- `apply_subscription_event` can reject a Stripe event older than (or equal
-- to) the last one it already applied -- see the function below.

alter table public.djs
  add column stripe_customer_id text,
  add column stripe_subscription_id text,
  add column subscription_status text,
  add column current_period_end timestamptz,
  add column last_subscription_event_at timestamptz;

-- No new RLS policy, no new GRANT for reads: `djs_select_own` already returns
-- the full row (including these columns) to its owner -- that alone
-- satisfies AC-3's read half. No new UPDATE grant for any client role
-- either: every existing UPDATE grant on `djs` is already column-scoped
-- (`phone`, `dj_name` only -- 20260727192439, 20260806090000), with no
-- table-wide `UPDATE` grant, so these five new columns are unwritable by
-- `authenticated`/`anon` with zero additional statements. Adding a second
-- RLS UPDATE policy here would not narrow anything further -- RLS scopes
-- rows, not columns; the GRANT layer already does that job.

-- Partial unique indexes (code review, 2026-08-15): nothing else stops the
-- same Stripe customer/subscription id from landing on two different `djs`
-- rows (a caller bug, or a test/live-mode key mixup). Partial (`where ...
-- is not null`) because both columns are nullable pre-Checkout and Postgres
-- unique indexes already treat NULL as distinct from NULL, so an
-- unqualified unique index would work identically for the not-null case --
-- the `where` clause is for clarity, not correctness.
create unique index djs_stripe_customer_id_idx on public.djs (stripe_customer_id)
  where stripe_customer_id is not null;
create unique index djs_stripe_subscription_id_idx on public.djs (stripe_subscription_id)
  where stripe_subscription_id is not null;

-- The write path. `security definer`, `set search_path = ''`, matching
-- every other write-scoped function in this codebase (`sync_set`,
-- `set_agent_status`, `sync_library_add_events`).
--
-- Unlike every sibling RPC, `dj_id` is an explicit parameter rather than
-- derived from `auth.uid()`: this function is called by a Stripe webhook, a
-- server-to-server call with no DJ session and no JWT, so `auth.uid()` would
-- be null. SOLUTION-DESIGN Sec.3.7's sequence diagram has `dj_id` riding in
-- Stripe's own `metadata` (set at Checkout time, Story 7.2). A parameterized
-- `dj_id` is safe here specifically because the function is executable only
-- by `service_role` (see the revoke/grant below) -- it would be a real
-- spoofing hole if `authenticated` could call this function.
--
-- `event_created_at` (code review, 2026-08-15): Stripe does not guarantee
-- webhook delivery order. Every Stripe event carries its own `created`
-- timestamp; the caller (Story 7.3) passes it through here so a stale event
-- arriving after a newer one is a no-op rather than a silent rollback of
-- correct state. The comparison is strict (`>`): an event whose timestamp
-- equals the row's `last_subscription_event_at` is treated as an
-- already-applied duplicate (Stripe's at-least-once delivery can redeliver
-- the identical event) and is also a no-op, not an error -- this is not a
-- second state machine (AD-19 still holds for `subscription_status` itself),
-- it is strictly an ordering/dedupe guard on top of the same passthrough
-- write.
--
-- Local variables (`target_dj_id`, `new_status`, ...) copy every parameter
-- immediately, the same defensive shape `set_agent_status` uses. Three of
-- the five original parameter names (`stripe_customer_id`,
-- `stripe_subscription_id`, `current_period_end`) collide exactly with
-- column names, which would otherwise create the same `SET column = value`
-- ambiguity `set_agent_status`'s `#variable_conflict use_column` pragma
-- resolves. Copying to distinctly-named locals sidesteps the ambiguity
-- entirely rather than relying on a pragma.
--
-- Deliberately NO validation of `status` against an allow-list (unlike
-- `set_agent_status`'s TrayState check): AD-19 is explicit that
-- `subscription_status` is a thin passthrough, never a second state
-- machine -- a Stripe status added later must never break the write. The
-- `btrim(...) = ''` guard (code review, 2026-08-15) only rejects
-- whitespace-only input; it does not validate the value itself.
create function public.apply_subscription_event(
  dj_id uuid,
  status text,
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  event_created_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_dj_id uuid := dj_id;
  new_status text := status;
  new_stripe_customer_id text := stripe_customer_id;
  new_stripe_subscription_id text := stripe_subscription_id;
  new_current_period_end timestamptz := current_period_end;
  new_event_created_at timestamptz := event_created_at;
begin
  if target_dj_id is null then
    raise exception 'apply_subscription_event requires dj_id' using errcode = '22004';
  end if;
  if new_status is null or btrim(new_status) = '' then
    raise exception 'apply_subscription_event requires a non-empty status' using errcode = '22004';
  end if;
  if new_event_created_at is null then
    raise exception 'apply_subscription_event requires event_created_at' using errcode = '22004';
  end if;

  if not exists (select 1 from public.djs where id = target_dj_id) then
    raise exception 'apply_subscription_event: no djs row for dj_id %', target_dj_id
      using errcode = 'P0002';
  end if;

  update public.djs
  set stripe_customer_id = new_stripe_customer_id,
      stripe_subscription_id = new_stripe_subscription_id,
      subscription_status = new_status,
      current_period_end = new_current_period_end,
      last_subscription_event_at = new_event_created_at
  where id = target_dj_id
    and (last_subscription_event_at is null or new_event_created_at > last_subscription_event_at);
end;
$$;

-- The critical deviation from every prior write-scoped RPC in this
-- codebase: `authenticated` never gets EXECUTE. This function is called
-- only by the Stripe webhook's server-side client, authenticating as
-- `service_role` -- never a DJ's own session. Functions are "born with
-- EXECUTE granted to PUBLIC" (20260807140000's phrase), so without this
-- revoke, `apply_subscription_event` would be silently callable by
-- `anon`/`authenticated` too -- letting any authenticated user forge any
-- DJ's subscription state, since `dj_id` here is a parameter, not derived
-- from `auth.uid()`. This closes deferred-work.md's "service_role has no
-- CRUD grants on a fresh replay" gap for this one function: it gives
-- `service_role` an explicit, PUBLIC-independent grant that survives a
-- fresh migration replay regardless of the hosted project's
-- `auto_expose_new_tables` setting.
revoke execute on function public.apply_subscription_event(uuid, text, text, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_subscription_event(uuid, text, text, text, timestamptz, timestamptz)
  to service_role;
