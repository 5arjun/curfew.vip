---
baseline_commit: 48578027d3e9c1a3a24e184f4c53978bcdd78cdf
---

# Story 7.1: Billing columns + write-scoped `SECURITY DEFINER` function

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want four additive billing columns on `djs` plus a single `SECURITY DEFINER` function that is their only writer,
so that subscription state lives on the account with a database-enforced, minimal write surface.

## Acceptance Criteria

1. **Given** an additive migration, **Then** `djs` gains nullable `stripe_customer_id`, `stripe_subscription_id`, `subscription_status` (text, Stripe's verbatim status), and `current_period_end`. *(AD-19, AR-12)*
2. **Given** `subscription_status`, **Then** it is `text` (not a restrictive DB enum) **And** while `= 'trialing'`, `current_period_end` is the trial end (no separate trial column). *(AD-19)*
3. **Given** RLS, **Then** a DJ can read their own billing columns, but no RLS `UPDATE` policy ever grants a DJ write access to them. *(AD-19)*
4. **Given** `apply_subscription_event(...)`, **Then** it is a `SECURITY DEFINER` function that touches only these four columns and is the sole caller of the elevated key from billing code. *(AD-18)*

*(Source: `_bmad-output/planning-artifacts/epics.md` — Epic 7: Subscription & Billing, Story 7.1. Sits outside FR-1..FR-29 — epics.md's own framing, not an oversight.)*

## Scope Boundaries (read before starting)

This story is **schema + one RPC only**, mirroring Story 5.1's own boundary discipline:

- **No Stripe Checkout session creation.** Story 7.2's job. This story's function signature is fixed by SOLUTION-DESIGN §3.7's sequence diagram so 7.2/7.3 have a stable contract to build against — do not redesign it.
- **No webhook Route Handler, no Stripe SDK, no `web/` code at all.** Story 7.3's job. This story is `supabase/`-only, exactly like Story 5.1.
- **No Customer Portal.** Story 7.4's job.
- **No web access-gate / route guard reading `subscription_status`.** Story 7.5's job.
- **No broader `service_role` table-CRUD hardening across every `public` table.** `deferred-work.md`'s open item is wider than this story (see Dev Notes "The `service_role` gap") — this story closes only the slice that blocks its own AC-4 (this one function's EXECUTE grant), not the general fix.
- **No Stripe status value-set validation inside the function.** AD-19 is explicit that `subscription_status` is a thin passthrough, never a second state machine — see Dev Notes "Do NOT copy `set_agent_status`'s validation pattern."

## Tasks / Subtasks

- [x] Task 1: Migration — the four columns, additive-only, correctly scoped grants (AC: #1, #2, #3)
  - [x] 1.1 `supabase migration new add_djs_billing_columns` → `supabase/migrations/<timestamp>_add_djs_billing_columns.sql`
  - [x] 1.2 `alter table public.djs add column stripe_customer_id text, add column stripe_subscription_id text, add column subscription_status text, add column current_period_end timestamptz;` — all four nullable, no `NOT NULL`, no `CHECK`/enum on `subscription_status` (AC-2, AD-19's thin-passthrough rule)
  - [x] 1.3 Add **no** new RLS policy and **no** new GRANT for these columns. `djs_select_own` (existing SELECT policy) already returns full rows including new columns to their owner — that alone satisfies AC-3's read half. Every existing UPDATE grant on `djs` is already column-scoped (`grant update (phone)`, `grant update (dj_name)` — see 20260727192439 / 20260806090000) with no table-wide `UPDATE` grant, so the four new columns are unwritable by `authenticated` by construction, with zero new statements required. Do **not** add `grant update (subscription_status) ...` or any variant for these columns to any client role — see Dev Notes "Why zero new grants is the correct answer."
- [x] Task 2: Migration (same file) — `apply_subscription_event(...)`, service-role-only (AC: #4)
  - [x] 2.1 Exact signature (fixed by SOLUTION-DESIGN §3.7's sequence diagram — Story 7.3 will call it, do not rename params): `apply_subscription_event(dj_id uuid, status text, stripe_customer_id text, stripe_subscription_id text, current_period_end timestamptz)` — see Dev Notes for the full function body reference
  - [x] 2.2 `security definer`, `set search_path = ''`, `language plpgsql` — matches every other write-scoped function in this codebase (`sync_set`, `set_agent_status`, `sync_library_add_events`)
  - [x] 2.3 **`dj_id` is an explicit parameter, never derived from `auth.uid()`.** This is a deliberate deviation from `set_agent_status`/`sync_library_add_events`'s "never accept dj_id as a parameter" rule — see Dev Notes "Why `dj_id` is a parameter here, unlike every sibling RPC." Guard: raise (`22004`) if `dj_id` or `status` is null/empty.
  - [x] 2.4 Body is a single `UPDATE public.djs SET ... WHERE id = <dj_id>`, touching only the four billing columns; raise (`22023`) if the update matches zero rows (a forged/nonexistent `dj_id`)
  - [x] 2.5 **Grants — the critical deviation from every prior write-scoped RPC in this codebase:** `revoke execute on function public.apply_subscription_event(uuid, text, text, text, timestamptz) from public, anon, authenticated;` then `grant execute ... to service_role;` — **do NOT** `grant execute ... to authenticated` (every prior RPC in this codebase does that; this one must not — see Dev Notes "The `service_role` gap" for why this specific grant is load-bearing, not optional hardening)
- [x] Task 3: New pgTAP test — the write path + isolation (AC: #3, #4)
  - [x] 3.1 Create `supabase/tests/apply_subscription_event_test.sql`, structured like `supabase/tests/agent_status_isolation_test.sql` but with a `service_role`-caller shape (no `request.jwt.claims` needed — `dj_id` is a parameter, not derived from a JWT)
  - [x] 3.2 Cover: `service_role` can call the function and it writes all four columns for the target `dj_id`; a second call with different values overwrites in place (not append — there is nothing to append, it's a plain `UPDATE`)
  - [x] 3.3 Cover: `authenticated` **cannot execute** the function at all (`throws_ok` → `42501`, no execute grant) — this is the assertion that makes AC-4's "sole caller of the elevated key" true at the ACL layer, not just in prose
  - [x] 3.4 Cover: `anon` cannot execute either (`42501`)
  - [x] 3.5 Cover: an arbitrary/novel `subscription_status` string (something not in Stripe's currently-known set, e.g. `'some_future_stripe_status'`) is accepted and stored **verbatim, unvalidated** — the live proof that AD-19's "never a second state machine" rule holds (see Dev Notes)
  - [x] 3.6 Cover: cross-DJ correctness — calling with DJ A's `dj_id` never touches DJ B's row (two DJs seeded, only one row changes)
  - [x] 3.7 Cover: a nonexistent `dj_id` raises (`22023`); a null `dj_id` or null/empty `status` raises (`22004`)
- [x] Task 4: Extend `djs_isolation_test.sql` (AC: #3)
  - [x] 4.1 Add one case (after the existing Case 3c) proving `authenticated` cannot directly `UPDATE` the billing columns — mirror Case 3c's exact style (`throws_ok` → `42501`), e.g. `update public.djs set subscription_status = 'active' where id = '<own-id>'`. One or two representative columns is enough (the missing-grant mechanism protects all four identically); note in the test comment that all four share the same protection.
  - [x] 4.2 Bump `select plan(23)` to reflect the added case(s)
- [x] Task 5: Extend `grant_matrix_test.sql` (AC: #3, #4)
  - [x] 5.1 Add explicit negative column-privilege assertions mirroring lines 55–57's positive pattern: `not has_column_privilege('authenticated', 'public.djs', 'stripe_customer_id', 'UPDATE')` etc. for all four columns (or loop via `unnest`, matching the file's own `unnest(array[...])` idiom used elsewhere in this file)
  - [x] 5.2 Add `apply_subscription_event` to the `anon`-cannot-execute sweep (mirroring line 70–74's pattern)
  - [x] 5.3 Add an explicit **negative** assertion that `authenticated` cannot execute it either — this file's existing function sweep (lines 79–82) only ever asserts the *positive* "authenticated CAN execute" for every other RPC; this is the first function in the suite that needs the opposite assertion, so don't pattern-match the existing block blindly
  - [x] 5.4 Add a **positive** assertion that `service_role` CAN execute it: `has_function_privilege('service_role', 'public.apply_subscription_event(uuid, text, text, text, timestamptz)', 'EXECUTE')` — this is what actually proves Task 2.5's grant closed the `deferred-work.md` gap (see Dev Notes)
  - [x] 5.5 Bump `select plan(53)` (current count) upward by however many new assertions Tasks 5.1–5.4 add, and update the file's leading arithmetic comment to account for them
- [x] Task 6: Close the two `ACCOUNT-DELETION-EXPORT-RUNBOOK.md` forward-hooks this story resolves (AC: #1)
  - [x] 6.1 §2 step 3 currently reads "Stripe customer: N/A today... Forward-hook, TODO for whichever Epic 7 story lands `stripe_customer_id`: add a step here, run **before** step 2 (auth.users delete), to delete or cancel the Stripe customer via the Stripe Dashboard or API." Update this to a real, executable manual step now that the column exists (still manual — no Stripe API call exists in code until Story 7.3) — pull the DJ's `stripe_customer_id` via `select stripe_customer_id from public.djs where id = '<uuid>';` first, since the column disappears the moment the cascading `auth.users` delete runs.
  - [x] 6.2 §3's export-procedure narrative ("a DJ's derived data is their `public.djs` row (`id`, `created_at`, `phone`)") is now stale — update the column list to include all four billing columns (the `select * from public.djs where id = '<uuid>';` query itself needs no change, it already returns new columns)
- [x] Task 7: Update `supabase/README.md`'s migration tree map (AC: #1)
  - [x] 7.1 Add the new migration filename, matching the existing entry format
  - [x] 7.2 Add `apply_subscription_event_test.sql` to the `tests/` block the same way
- [x] Task 8: Verify locally (AC: #1, #2, #3, #4)
  - [x] 8.1 `supabase start` then `supabase migration up` — confirm clean apply
  - [x] 8.2 `supabase/scripts/check-additive-only-migrations.sh supabase/migrations` — confirm it passes
  - [x] 8.3 `supabase test db supabase/tests` — confirm the full suite (including the two extended files and the new one) passes

### Review Findings

- [x] [Review][Patch] Add an event-ordering guard to `apply_subscription_event` — new `event_created_at timestamptz` parameter plus a `djs.last_subscription_event_at` bookkeeping column; an incoming event older than or equal to the row's stored timestamp becomes a no-op instead of clobbering newer state (the strict `>` comparison also makes exact-duplicate redelivery safe as a side effect). **Resolved 2026-08-15 (Arjun): extend scope now** rather than defer to Story 7.3 — the frozen 5-arg signature grows to 6 args before any downstream story depends on it. **Applied**: [supabase/migrations/20260815211733_add_djs_billing_columns.sql], tested by Case 1c in [supabase/tests/apply_subscription_event_test.sql].
- [x] [Review][Patch] Add partial unique indexes on `djs.stripe_customer_id` and `djs.stripe_subscription_id` (`where ... is not null`) — prevents the same Stripe id from ever being written onto two different `djs` rows. **Resolved 2026-08-15 (Arjun): add now.** **Applied**: `djs_stripe_customer_id_idx`/`djs_stripe_subscription_id_idx` in [supabase/migrations/20260815211733_add_djs_billing_columns.sql].
- [x] [Review][Patch] Whitespace-only `subscription_status` bypasses the empty-string guard — `new_status = ''` doesn't catch `'   '`, which would be accepted and stored verbatim. **Applied**: guard now uses `btrim(new_status) = ''` [supabase/migrations/20260815211733_add_djs_billing_columns.sql], tested in [supabase/tests/apply_subscription_event_test.sql].
- [x] [Review][Patch] `errcode = '22023'` (`invalid_parameter_value`) is a semantically odd choice for "no djs row matched" — conflates a missing row with malformed input, the same category already used correctly for null/empty `status`/`dj_id` (`22004`). `P0002` (`no_data_found`) is the idiomatic PL/pgSQL code for this case. **Applied**: existence is now checked before the `UPDATE` and raises `P0002` [supabase/migrations/20260815211733_add_djs_billing_columns.sql], test assertion updated in [supabase/tests/apply_subscription_event_test.sql].
- [x] [Review][Patch] Test gap: `current_period_end` is never exercised as `NULL`, even though the column is nullable and non-`trialing` statuses may legitimately have no period end. **Applied**: Case 7 in [supabase/tests/apply_subscription_event_test.sql].
- [x] [Review][Defer] Blind overwrite can null out previously-set Stripe identifiers — the `UPDATE` writes `stripe_customer_id`/`stripe_subscription_id` from whatever is passed with no `coalesce` fallback; a future caller (Story 7.3, not yet built) passing a partial/null payload would silently destroy a previously-stored value. Not this story's caller to fix. [supabase/migrations/20260815211733_add_djs_billing_columns.sql] — deferred, pre-existing
- [x] [Review][Defer] Stale/spoofed `dj_id` from reused Stripe Checkout metadata is not cross-validated against the target row's existing billing identifiers — accepted tradeoff of the `service_role`-only trust boundary already reasoned about in Dev Notes; correctness depends on Story 7.2/7.3 sourcing `dj_id` correctly at Checkout time. [supabase/migrations/20260815211733_add_djs_billing_columns.sql] — deferred, pre-existing
- [x] [Review][Defer] A permanently unmatchable `dj_id` (e.g. a DJ hard-deletes their account) raises `P0002` on every delivery attempt (errcode changed from `22023` by this review's patch pass) — once wired to a real webhook Route Handler (Story 7.3), Stripe will retry a non-2xx response for up to ~3 days on an event that can never succeed unless the handler special-cases this errcode. [supabase/migrations/20260815211733_add_djs_billing_columns.sql] — deferred, pre-existing

## Dev Notes

### Exact migration reference (columns + function)

```sql
alter table public.djs
  add column stripe_customer_id text,
  add column stripe_subscription_id text,
  add column subscription_status text,
  add column current_period_end timestamptz;

-- No new RLS policy, no new GRANT for reads: djs_select_own already returns
-- the full row (including these columns) to its owner. No new UPDATE grant
-- for any client role: every existing UPDATE grant on djs is already
-- column-scoped (phone, dj_name only), so these four columns are unwritable
-- by `authenticated`/`anon` with zero additional statements.

create function public.apply_subscription_event(
  dj_id uuid,
  status text,
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz
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
  updated_count int;
begin
  if target_dj_id is null then
    raise exception 'apply_subscription_event requires dj_id' using errcode = '22004';
  end if;
  if new_status is null or new_status = '' then
    raise exception 'apply_subscription_event requires a non-empty status' using errcode = '22004';
  end if;

  update public.djs
  set stripe_customer_id = new_stripe_customer_id,
      stripe_subscription_id = new_stripe_subscription_id,
      subscription_status = new_status,
      current_period_end = new_current_period_end
  where id = target_dj_id;

  get diagnostics updated_count = row_count;
  if updated_count = 0 then
    raise exception 'apply_subscription_event: no djs row for dj_id %', target_dj_id
      using errcode = '22023';
  end if;
end;
$$;

revoke execute on function public.apply_subscription_event(uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_subscription_event(uuid, text, text, text, timestamptz)
  to service_role;
```

Local variables (`target_dj_id`, `new_status`, ...) copy every parameter immediately, the same defensive shape `set_agent_status` uses — three of the five parameter names (`stripe_customer_id`, `stripe_subscription_id`, `current_period_end`) collide exactly with column names, which would otherwise create the same `SET column = value` ambiguity `set_agent_status`'s `#variable_conflict use_column` pragma exists to resolve. Copying to distinctly-named locals sidesteps the ambiguity entirely rather than relying on a pragma.

### Why `dj_id` is a parameter here, unlike every sibling RPC

`set_agent_status`, `sync_library_add_events`, and `sync_library_roster` all derive `dj_id` from `auth.uid()` and explicitly document "never accepted as a parameter" — because those are called by the **agent, with its own DJ's JWT**, so `auth.uid()` is trustworthy and a parameter would just be an unnecessary spoofing surface.

`apply_subscription_event` is different: it's called by a **Stripe webhook**, a server-to-server call with no DJ session at all — there is no JWT, so `auth.uid()` would be null. SOLUTION-DESIGN §3.7's sequence diagram is explicit that `dj_id` comes from **Stripe's own `metadata`** (set at Checkout time from the authenticated DJ who started checkout — Story 7.2's job) and is passed to this function as a parameter. This is safe specifically *because* the function is executable only by `service_role` (Task 2.5) — a parameterized `dj_id` would be a real spoofing hole if `authenticated` could call this function, which is exactly why Task 2.5's grant restriction is not optional hardening but the mechanism that makes AC-4 true at all.

### Do NOT copy `set_agent_status`'s validation pattern

`set_agent_status` validates `sync_state` against a hardcoded allow-list of the six `TrayState` variants, rejecting anything else. **Do not do the equivalent for `subscription_status`.** AD-19 is explicit: `subscription_status` stores "Stripe's own status string verbatim... the webhook is a thin passthrough, never a second state machine... a Stripe status added later never breaks the write." An allow-list here would silently break every future Checkout/Portal event the moment Stripe adds a status value this codebase hasn't seen yet — which the architecture calls out as precisely the failure mode `text`-not-enum is chosen to avoid. Task 3.5 exists to prove this by testing that an unrecognized status string still succeeds.

### The `service_role` gap (why Task 2.5's grant is load-bearing, not optional)

`deferred-work.md`'s "Pre-launch hardening — close before Epic 6 ... or Epic 7 (billing) story-creation" section carries this **still-open** entry:

> `service_role` has no CRUD grants on a fresh replay — detonates on Epic 7's Stripe webhook. ... It works on the current hosted project only via the legacy `auto_expose` default ACL... a newly provisioned project gets the modern default, and `service_role` is `rolbypassrls=true` but **not** superuser — RLS bypass is not a GRANT. So every service-key path returns `permission denied` on any new environment while passing on this one.

Functions in this codebase are "born with EXECUTE granted to PUBLIC" (the exact phrase `20260807140000_harden_table_and_function_grants.sql` uses) — so `apply_subscription_event` would be silently callable by `anon`/`authenticated` too if left alone, which is a much worse problem than the deferred-work entry (it would let any authenticated user forge any DJ's subscription state). Task 2.5's `revoke ... from public, anon, authenticated; grant ... to service_role;` closes **both** problems for this one function in a single pair of statements: it removes the implicit PUBLIC access, and it gives `service_role` an **explicit, PUBLIC-independent** grant that survives a fresh migration replay regardless of the hosted project's `auto_expose_new_tables` setting.

This closes the deferred-work risk **only for this function** — the entry's fuller ask ("grant select/insert/update/delete on ALL public tables... plus matching default privileges... and a grant_matrix_test assertion pinning it") is broader than this story's own AC and stays open for whatever story next needs `service_role` to touch a table directly (see Scope Boundaries). Task 5.4's new `grant_matrix_test.sql` assertion is the "pinning" half of the ask, scoped to this one function.

### Why zero new grants is the correct answer for Task 1.3

The naive instinct after reading AC-3 ("no RLS UPDATE policy ever grants a DJ write access") is to write a new restrictive RLS policy or an explicit revoke. Neither is needed. RLS policies scope **rows**, grants scope **columns/tables** — `djs_update_own_phone` (the existing UPDATE policy) is row-scoped only (owner-check), and it already exists; adding a second UPDATE policy would not narrow anything further, because **which columns** an `UPDATE` may touch is entirely the GRANT layer's job, not the policy's. Since `phone`/`dj_name` are the only columns ever granted `UPDATE`, the four new columns are already unwritable by any client role the moment they're added — this is *why* Story 2.3c's migration insisted on column-scoped grants from the very first DJ-writable column, specifically so this moment ("Epic 7's billing columns land") would need zero new enforcement. `deferred-work.md` separately flags that this discipline is "enforced only by a comment, not structurally" — Task 4/5's new test assertions are what make it a machine-checked fact instead of a convention someone could still violate in a later migration.

### Why exactly these four columns, no more

AD-19 names exactly `stripe_customer_id`/`stripe_subscription_id`/`subscription_status`/`current_period_end` and this story's AC-1 locks to that list — do not speculatively add `stripe_price_id`, `cancel_at_period_end`, or similar. Curfew has a single $6/mo plan (no tiers, no Price selection at Checkout), so there's no product-catalog column to track. **[Corrected 2026-08-15, Story 7.2 — the premise is false, the conclusion still holds.** The price is $7.99/mo or $6.99/mo billed yearly, which is **two** Stripe Prices on one Product, so there *is* a Price selection at Checkout. `djs` still needs no `stripe_price_id`: nothing downstream differentiates DJs by interval (Story 7.5's gate reads only `subscription_status`), and Stripe's own subscription object — reachable any time via `stripe_subscription_id` — is the source of truth for which Price is attached. Re-fetch the canonical object rather than caching a redundant mirror, the same discipline AD-18 already applies to `subscription_status` itself.**]** `cancel_at_period_end` was considered and deliberately excluded: a canceled-but-still-active subscription keeps `subscription_status = 'active'` until the period actually ends and Stripe sends the next event, at which point it flips to `'canceled'` — Story 7.5's gate (`active`/`trialing` = allowed) needs nothing more granular than that. If a future story needs it, add it the same way `20260803190000_add_play_capture_fields.sql` and `20260731130000_add_play_subgenre.sql` did: additive, bolted on by the story that actually consumes it — not speculated here (Story 5.1's own "Why no suggested/confirmed state yet" precedent).

### Two different "elevated keys" — don't conflate them (forward note for Story 7.3)

This story's "elevated key" (AD-18/AD-19, Task 2.5) is the **Supabase `service_role`** credential — what lets the webhook's server-side Supabase client call `apply_subscription_event` at all. It is entirely separate from the **Stripe secret API key** the same webhook handler will use to verify the signature and re-fetch the canonical subscription object. Not this story's problem (no Stripe SDK code here), but worth flagging now since both "elevated keys" will live in the same Route Handler in Story 7.3: prefer a Stripe **restricted API key** (`rk_`, least-privilege — this integration only needs webhook/subscription/customer read access, never full `sk_`) over a full secret key, and keep both keys in Vercel's encrypted env vars, never logged or echoed in error messages. (Source: Stripe security best-practices — RAK-over-secret-key is the platform default recommendation, unrelated to and orthogonal to AD-18's own Postgres-level `service_role` scoping this story implements.)

### API-key naming caveat (context, not this story's problem)

AD-18's footnote: Supabase is mid-migration off the legacy `service_role` **API key** to `sb_publishable_…`/`sb_secret_…` keys. That is an API-key-string concern for whichever webhook client Story 7.3 configures — it does **not** affect this story: the Postgres **role** name `service_role` (used in `GRANT ... TO service_role`) is unrelated to which API key string a client presents to authenticate as that role, and is stable regardless of the key-naming migration.

### Project Structure Notes

- Modified: `supabase/migrations/<timestamp>_add_djs_billing_columns.sql` (new — Task 1 + Task 2, one file, mirroring `20260805120000_create_agent_status.sql`'s precedent of a table/columns and their sole writer function landing together).
- New: `supabase/tests/apply_subscription_event_test.sql` (Task 3).
- Modified: `supabase/tests/djs_isolation_test.sql` (Task 4 — one new case, bump `plan(23)`).
- Modified: `supabase/tests/grant_matrix_test.sql` (Task 5 — new column/function assertions, bump `plan(53)`).
- Modified: `supabase/ACCOUNT-DELETION-EXPORT-RUNBOOK.md` (Task 6 — close both forward-hooks).
- Modified: `supabase/README.md` (Task 7 — tree map only).
- No `agent/`, `web/`, or `shared/` files touched — pure `supabase/`-only, matching this story's Scope Boundaries and Story 5.1's identical precedent.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` — Epic 7 intro + Story 7.1, Story 7.2/7.3 (dependents whose contract this story fixes)]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md` AD-18 (webhook = sanctioned AD-8 exception, mechanical write-scoping, elevated-key caveat), AD-19 (additive billing columns, DJ-write-excluded, text-not-enum, hard invariant on the agent)]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/SOLUTION-DESIGN.md` §3.7 — the exact `apply_subscription_event(...)` call shape (sequence diagram), why `dj_id` rides in Stripe metadata]
- [Source: `supabase/migrations/20260726012050_create_djs_table.sql` — reserved this exact moment ("AD-19: ... arrive later as an additive migration in Epic 7. This table's shape does not need to change to accommodate them, only grow")]
- [Source: `supabase/migrations/20260727192439_add_djs_phone_column.sql`, `20260806090000_add_djs_dj_name_column.sql` — the column-scoped-grant precedent this story's Task 1.3 relies on without adding new statements]
- [Source: `supabase/migrations/20260805120000_create_agent_status.sql` — direct structural template for a table/columns + sole-writer `SECURITY DEFINER` function landing in one migration; also the source of the safe-local-variable-copy pattern]
- [Source: `supabase/migrations/20260807140000_harden_table_and_function_grants.sql` — "functions are born with EXECUTE granted to PUBLIC" (the fact Task 2.5's revoke exists to counter), and the "service_role deliberately untouched" precedent]
- [Source: `supabase/tests/agent_status_isolation_test.sql` — structural template for Task 3's new test file]
- [Source: `supabase/tests/grant_matrix_test.sql` — the file Task 5 extends; note its own header on why it exists (hosted-vs-local ACL divergence)]
- [Source: `supabase/tests/djs_isolation_test.sql` Case 3c — the exact assertion style Task 4.1 mirrors]
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md` "Pre-launch hardening" section — the `service_role`-has-no-CRUD-grants entry this story's Task 2.5 closes for `apply_subscription_event`, and the AD-19-enforced-only-by-comment entry Tasks 4/5 close]
- [Source: `supabase/ACCOUNT-DELETION-EXPORT-RUNBOOK.md` §2 step 3, §3 — the two forward-hooks Task 6 closes]
- [Source: `_bmad-output/implementation-artifacts/5-1-segments-overlay-schema.md` — the closest prior story in shape (schema-only, `supabase/`-only, closes its own forward-hooks in the same session); its "hosted auto-expose trap" Dev Notes section is why Task 1.3 explicitly reasons about grants rather than assuming RLS alone is sufficient]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `supabase migration up` — clean apply of `20260815211733_add_djs_billing_columns.sql` against the running local stack.
- `supabase/scripts/check-additive-only-migrations.sh supabase/migrations` — "All migrations under supabase/migrations are additive-only."
- `supabase db reset` — full replay of all 22 migrations from scratch, confirming no ordering/dependency issues.
- `supabase test db supabase/tests` — `Files=12, Tests=302, Result: PASS` (all green after the reset; a first pre-reset run showed one unrelated failure in `agent_status_isolation_test.sql` caused by a stale row left over from prior local manual testing, not by this story's changes — resolved by `supabase db reset` matching CI's ephemeral-Postgres behavior).

### Completion Notes List

- Migration `20260815211733_add_djs_billing_columns.sql` lands the four additive billing columns on `djs` and `apply_subscription_event(...)` together in one file, mirroring `20260805120000_create_agent_status.sql`'s precedent.
- Task 1.3: zero new RLS policy or GRANT statements added for the four columns, per Dev Notes — the existing column-scoped UPDATE grants (`phone`, `dj_name` only) already leave the new columns unwritable by any client role.
- Task 2: `apply_subscription_event` takes `dj_id` as an explicit parameter (the Stripe-webhook exception to the "never accept dj_id as a parameter" rule), validates only for null/empty `dj_id`/`status` (never a Stripe-status allow-list, per AD-19's thin-passthrough rule), and is revoked from `public`/`anon`/`authenticated` with EXECUTE granted only to `service_role` — closing `deferred-work.md`'s `service_role`-has-no-CRUD-grants gap for this one function.
- Task 3: new `apply_subscription_event_test.sql` (19 pgTAP assertions) covers the write path, in-place overwrite, anon/authenticated execute-denial, a novel/unrecognized `subscription_status` string stored verbatim, cross-DJ isolation, and all four error paths (`22023` nonexistent dj_id, `22004` null dj_id / null status / empty status).
- Task 4: `djs_isolation_test.sql` gained Case 3c-bis (authenticated cannot UPDATE `subscription_status`); plan bumped 23 → 24.
- Task 5: `grant_matrix_test.sql` gained 7 new assertions (4 negative column-privilege for the billing columns, anon/authenticated negative execute, service_role positive execute on `apply_subscription_event`); plan bumped 53 → 60, leading arithmetic comment updated to match.
- Task 6: closed both `ACCOUNT-DELETION-EXPORT-RUNBOOK.md` forward-hooks — §2 step 3 is now a real, executable manual Stripe-customer step (pull `stripe_customer_id` before the cascading `auth.users` delete removes it); §3's export column list and the doc's intro now reflect the four landed billing columns (plus the previously-missing `dj_name`, corrected in the same pass since the column list was already being touched).
- Task 7: `supabase/README.md`'s tree map gained the new migration and test filenames, matching the existing entry format.
- Task 8: verified locally end-to-end — `supabase migration up`, the additive-only guard, a full `supabase db reset` replay of all 22 migrations, and the complete pgTAP suite (302/302 assertions across 12 files, including the two extended files and the new one).

### File List

- New: `supabase/migrations/20260815211733_add_djs_billing_columns.sql`
- New: `supabase/tests/apply_subscription_event_test.sql`
- Modified: `supabase/tests/djs_isolation_test.sql`
- Modified: `supabase/tests/grant_matrix_test.sql`
- Modified: `supabase/ACCOUNT-DELETION-EXPORT-RUNBOOK.md`
- Modified: `supabase/README.md`

## Change Log

- 2026-08-15: Implemented the four additive billing columns on `djs` plus `apply_subscription_event(...)` (migration, zero new grants for the columns, `service_role`-only EXECUTE on the function), added `apply_subscription_event_test.sql` (19 assertions), extended `djs_isolation_test.sql` (plan 23 → 24) and `grant_matrix_test.sql` (plan 53 → 60), closed both `ACCOUNT-DELETION-EXPORT-RUNBOOK.md` forward-hooks, and updated `supabase/README.md`'s tree map. Full local verification: clean `supabase db reset` replay of all 22 migrations, additive-only guard clean, pgTAP suite `Files=12, Tests=302, Result: PASS`. Status → review.
