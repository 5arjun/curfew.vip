# Account deletion + data export runbook

Story 2.11's own text describes this runbook against the **full, eventual**
schema (`sessions`, `sets`, `plays`, `segments`, enrichment overlays, a Stripe
customer). As of Story 7.1, the live schema is `public.djs` (`id`,
`created_at`, `phone`, `dj_name`, plus Epic 7's four billing columns) plus
`sessions`/`sets`/`plays`/`segments` — Story 5.5's Layer 2 enrichment overlay
is still backlog. This runbook is written accurate to **today's** schema,
with an explicit forward-hook section (a clearly marked TODO, not a
fabricated step) for the future stories that will still need to extend it.

**Status as of 2026-08-15:** this is a pure manual/operator runbook — no
self-serve in-app deletion or export exists (MVP scope, AC-3). Today's
deletion procedure cascades automatically once the Stripe customer is
handled first (§2 step 3 below, Story 7.1): deleting the `auth.users` row
cascades through `public.djs` and, as of Story 5.1, transitively through
`sessions`/`sets`/`plays`/`segments` too — confirmed for real against local
Postgres (insert a DJ's full row set, delete their `auth.users` row, all
five tables' rows are gone). The export procedure now joins those four
tables as well, plus the billing columns on `djs` itself. This will grow
again once Story 5.5 lands its enrichment overlay — see the forward-hook
TODO inline below.

## 1. Requesting a deletion or export

There is no support inbox, form, or in-app link yet — no story before Story
3.10 (Profile/Settings) builds a UI surface to host one, and no email
infrastructure exists for this specific purpose (Story 2.3d's Resend wiring
is transactional signup/confirmation email only). At the current DJ count,
the interim channel — for both the DJ's incoming request and delivering an
export back to them — is **admin@curfew.vip**.

**Before acting on any request:** confirm the requester can currently log
into the account named in the request (e.g., ask them to log in and confirm
access, or verify during a live exchange) before deleting anything or
sending an export. This is the identity check for this manual, low-volume
flow — proportionate at current DJ-count/risk level, no new infrastructure
needed.

**If a single request asks for both an export and a deletion:** always
complete the export procedure (§3) before the deletion procedure (§2).
Following this document's section order literally would delete the account
before its data is exported.

**Forward-hook, TODO for Story 3.10:** once Profile/Settings ships its
"delete my account" support link (AC-3), that story should point the link at
whatever request channel exists then (an email address, a form, or this same
direct-contact instruction) and update this section to match — don't leave
this section describing a channel Story 3.10 has since replaced.

## 2. Deletion procedure (today's schema)

1. **Identify the DJ's `auth.users` row.** Match on verified email — same
   identity model as AD-10 (one DJ, one verified email, one row), the same
   assumption Story 2.3b's OAuth account-linking relies on. **If zero rows
   match, or more than one row matches, stop and escalate** — do not guess
   which row was meant, and do not proceed to deletion on an ambiguous match.
2. **Delete the `auth.users` row.** Either:
   - Supabase Dashboard: **Authentication → Users → Delete**, or
   - Admin API: `supabase.auth.admin.deleteUser(id)` (requires the
     service-role key — obtain it from the Supabase Dashboard → Project
     Settings → API; never paste it into chat, commit it, or leave it in
     shell history — never the publishable key).

   Either path cascades automatically through the entire schema, confirmed
   for real against local Postgres (Story 3.1's dev-story: seeded a DJ with
   one row in each of `djs`/`sessions`/`sets`/`plays`, deleted their
   `auth.users` row, confirmed all four tables' rows were gone; Story 5.1's
   dev-story repeated the same check with a `segments` row added to the
   chain, confirmed all five tables' rows were gone):
   - `public.djs.id` is `references auth.users (id) on delete cascade`
     (`supabase/migrations/20260726012050_create_djs_table.sql`).
   - `public.sessions.dj_id`, `public.sets.dj_id`, and `public.plays.dj_id`
     all `references public.djs (id) on delete cascade`
     (`supabase/migrations/20260730204057_create_sessions_sets_plays.sql`) —
     `sessions`/`sets`/`plays` also cascade transitively through their
     parent-row FK (`sets.session_id`, `plays.set_id`), so there is no path
     that leaves an orphaned row in any of them.
   - `public.segments.dj_id` also `references public.djs (id) on delete
     cascade`, and `segments.first_play_id`/`segments.last_play_id` each
     `references public.plays (id) on delete cascade`
     (`supabase/migrations/20260810153813_create_segments.sql`) — so a
     `segments` row is unreachable via two independent cascade paths (its
     own `dj_id`, and transitively through the `plays` row it brackets).

   There is nothing else to delete against today's schema — this is the
   entire cascade. Story 5.5's Layer 2 enrichment overlay table doesn't
   exist yet (still backlog); this step will need to be re-verified once it
   lands.

   **If the delete call errors, times out, or you're unsure whether it
   succeeded:** verify via a direct query (`select count(*) from auth.users
   where id = '<uuid>'`) before retrying — do not assume success or blindly
   retry a call that may have already taken effect.
3. **Stripe customer: run this BEFORE step 2** (the `stripe_customer_id`
   column disappears the moment the cascading `auth.users` delete runs).

   As of Story 7.1, `djs` carries `stripe_customer_id`, but no Stripe API
   call exists in code yet (Story 7.3 is still backlog) — this remains a
   manual step, just now a real one instead of "N/A":

   1. Pull the DJ's Stripe customer id before deleting anything:
      ```sql
      select stripe_customer_id from public.djs where id = '<uuid>';
      ```
   2. If it is non-null, delete or cancel that Stripe customer via the
      Stripe Dashboard or API before proceeding to step 2 below. If it is
      null, the DJ never completed Checkout — nothing to do here.
4. **Local agent SQLite: no automatic purge exists.** The agent has no way
   to learn its account was deleted — there is no sync/auth-check path today
   (Story 3.2/3.3, backlog) and Story 2.10's token-refresh work does not add
   one. Relay this manual instruction to the DJ, **repeated on every machine
   where they've installed the Curfew agent**:
   1. Quit the Curfew agent.
   2. Delete `local.sqlite` from Tauri's per-machine, non-roaming
      `app_local_data_dir()` (`agent/src-tauri/src/store.rs`), bundle
      identifier `app.curfew.agent` (`agent/src-tauri/tauri.conf.json:5`):
      - macOS: `~/Library/Application Support/app.curfew.agent/local.sqlite`
      - Windows: `%LOCALAPPDATA%\app.curfew.agent\local.sqlite`
      - Linux: `~/.local/share/app.curfew.agent/local.sqlite`

   This is an interim, manual process. **Forward-hook, TODO for whichever
   future story adds agent-side deletion-awareness** (likely once Story
   3.2/3.3's sync/auth-check path exists): replace this manual instruction
   with an automatic purge triggered by the agent detecting a revoked
   account, and remove this step once that ships.
5. **`sessions`/`sets`/`plays` (Story 3.1): closed, no manual step needed.**
   Step 2 above already covers them — their cascade was verified for real,
   not assumed from the DDL alone.

   **`segments` (Story 5.1): closed, no manual step needed.** The shipped
   migration (`supabase/migrations/20260810153813_create_segments.sql`)
   matches the design ruling exactly: `segments.dj_id references
   public.djs (id) on delete cascade`. Confirmed for real against local
   Postgres, not assumed from the DDL alone (same discipline as Story 3.1's
   own verification and `segments_isolation_test.sql`'s cascade case):
   seeded a DJ with a full `sessions`/`sets`/`plays`/`segments` row chain,
   deleted their `auth.users` row, confirmed all four tables' rows were
   gone. Step 2 above already covers `segments` too.

## 3. Export procedure (today's schema)

As of Story 7.1, a DJ's derived data is their `public.djs` row (`id`,
`created_at`, `phone`, `dj_name`, `stripe_customer_id`,
`stripe_subscription_id`, `subscription_status`, `current_period_end`) plus
every `sessions`/`sets`/`plays`/`segments` row scoped to their `dj_id`.

1. **Identify the DJ's `uuid`.** Same matching step as §2.1 (match on
   verified email against `auth.users`) — if zero rows or more than one row
   matches, stop and escalate rather than guessing.
2. In the Supabase Dashboard's **SQL Editor**, run each of these in turn —
   one result set per table, since the SQL Editor's export button acts on
   one result set at a time:

   ```sql
   select * from public.djs where id = '<uuid>';
   select * from public.sessions where dj_id = '<uuid>';
   select * from public.sets where dj_id = '<uuid>';
   select * from public.plays where dj_id = '<uuid>';
   select * from public.segments where dj_id = '<uuid>';
   ```

   **If the `djs` query returns zero rows,** confirm the account's current
   status (already deleted? wrong/mistyped `uuid`?) before reporting the
   export as complete — do not send an empty result back to the DJ as if it
   were their data. Zero rows on `sessions`/`sets`/`plays`/`segments` alone
   is expected and not an error — not every DJ has synced a set yet, and
   not every set has a segment.
3. Use the SQL Editor's own export/download button on each result set to
   save it as JSON or CSV — either is a "portable format" per AC-2.
4. **Deliver the exported files to the DJ via the same admin@curfew.vip
   channel** used to receive the request (§1) — the `djs` export contains
   the DJ's `phone` number, so don't route any of these through any other
   channel.

## 4. Future self-serve trigger (AC-4)

This runbook is deliberately manual/operator-run for MVP (AC-3) — Arjun's
ruling (party 2026-07-20) is that CCPA thresholds don't bind a
launch-size business, so a self-serve in-app feature isn't required yet.

**Once Curfew lists on the Apple App Store or Google Play, their in-app
account-deletion guideline requires a self-serve deletion feature** — at
that point this manual runbook is no longer sufficient and must become its
own story (self-serve delete + automated export). No action is needed now;
this section exists so that trigger condition is tracked, not forgotten.

## References

- `supabase/migrations/20260726012050_create_djs_table.sql` — the `djs`
  table shape and the `on delete cascade` FK this runbook's entire "today"
  deletion procedure relies on.
- `supabase/migrations/20260727192439_add_djs_phone_column.sql` — confirms
  `phone` is the only other column on `djs` today.
- `supabase/migrations/20260730204057_create_sessions_sets_plays.sql` — the
  `sessions`/`sets`/`plays` tables and their `on delete cascade` FKs back to
  `djs.id`, confirmed for real against local Postgres in Story 3.1's
  dev-story and now covered by §2/§3 above.
- `supabase/migrations/20260810153813_create_segments.sql` — the `segments`
  overlay table and its two independent `on delete cascade` FK paths
  (`dj_id`, and transitively via `first_play_id`/`last_play_id`),
  confirmed for real against local Postgres in Story 5.1's dev-story and
  now covered by §2/§3 above.
- `agent/src-tauri/src/store.rs` — `local.sqlite` filename and
  `app_local_data_dir()` path, for the manual local-purge instruction.
- `supabase/EMAIL-PROVISIONING.md` — the runbook-doc precedent (structure,
  voice, "status as of DATE" framing) this document mirrors.
- `_bmad-output/implementation-artifacts/2-1-supabase-cloud-foundation-isolation-baseline.md`
  — Story 2.1's own forward note anticipating this runbook by name.
