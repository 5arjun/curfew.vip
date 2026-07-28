# Production email delivery runbook

Story 2.3a's signup-confirmation flow (`web/app/login/actions.ts`'s `signUp`,
`web/app/auth/confirm/route.ts`) already works correctly today — against the
local Supabase stack's `local_smtp` testing inbox (Mailpit/Inbucket). Neither
of those files references SMTP configuration at all; they only call
`supabase.auth.signUp(...)` and handle the confirmation redirect. The SMTP
transport is entirely Supabase Auth's own concern, invisible to application
code. This document only extends that transport to a real inbox in
production — it does not change any code, and nothing in `web/` depends on
it being run.

Standing up production email delivery needs a real transactional email
provider (this runbook uses [Resend](https://resend.com) as the concrete
example, per the Architecture Spine's Stack/Deployment table rows) with a
verified sending domain, and a real production Supabase project to wire the
resulting credentials into. **As of 2026-07-27, all of this is done**: the
domain (`curfew.vip`, sending from the `updates.curfew.vip` subdomain) is
registered and verified, a Resend account exists, the production Supabase
project (`prod`, `supabase/PROVISIONING.md`) exists, and credentials are
wired — see [Sequencing / blockers](#4-sequencing--blockers) and the
"Actual wiring path" note in step 3 below for how step 3 was actually done.

## 1. Resend domain setup

1. Sign in / create an account at [resend.com](https://resend.com).
2. Go to **Domains → Add Domain** and enter the production sending domain.
   **Actually used: `updates.curfew.vip`**, a subdomain of the registered
   `curfew.vip` — not the root domain. Sending from a subdomain isolates
   the sending reputation from the root domain (and anything else that
   might later live on `curfew.vip`, e.g. a marketing ESP); it's a
   deliberate choice, not a typo.
3. Resend generates SPF and DKIM TXT records (and typically a DMARC
   recommendation) for that domain. Add those records at the DNS provider
   for the domain.
   - **A domain can only have one DMARC record.** If the DNS host already
     has one (e.g. from an existing mail setup), add to / merge with the
     existing record — do not create a second one.
4. Return to Resend and verify the domain once DNS has propagated.

## 2. Credential retrieval

Resend's SMTP page issues a password-shaped API key (`re_...`) that is
**shown once** — copy it immediately, it cannot be re-displayed.

What's needed for the wiring step below:

- **Host** and **port** — confirm the current values on Resend's own SMTP
  page at execution time (587/STARTTLS or 465/SSL); don't assume a number
  from this document, it can drift.
- **Username** and the one-time **password** (the `re_...` API key above).
- A default **from address** on the verified domain.
- A **sender name**.

## 3. Wiring credentials into the production project — done 2026-07-27

**Primary path: Supabase Dashboard, not `config.toml`.** Configure custom
SMTP directly on the **production** project via **Authentication → Emails →
SMTP Settings** in the Supabase dashboard, using the values gathered in step
2. (The equivalent [Management API](https://supabase.com/docs/reference/api)
call also exists, for later scripting/CI needs, but the dashboard is
recommended for this one-time setup.)

This path satisfies AC-4's "encrypted secret at the Supabase-project level"
by construction — the dashboard stores the credential per-project,
server-side, and it never touches this repo.

### Actual wiring path used: Resend's native Supabase integration

In practice, wiring was done through **Resend's dashboard → Integrations →
Supabase** flow instead of manually copying host/port/username/password
into Supabase's Dashboard as described above. That flow: connects your
Resend account to your Supabase organization via OAuth, lets you pick the
target project (`prod`), links the sending domain
(`updates.curfew.vip`), auto-creates a scoped Resend API key named
"Supabase Integration", and pushes the resulting SMTP configuration onto
the chosen project — functionally the same end state as the manual path
(a per-project, server-side SMTP credential that never touches this repo),
just without hand-copying values through Resend's SMTP page. Confirm the
picked project is the real `prod` project (`jmitbnrofacxwsbwuxzs`,
`supabase/PROVISIONING.md`) before finishing the flow — it will happily
wire any project you have access to, prod or not.

### Why not `config.toml` + `supabase config push`

`supabase start` (local development) reads the **same top-level
`[auth.email.smtp]` block** in `supabase/config.toml` that
`supabase config push` would push to a linked remote project (confirmed
against Supabase's CLI docs, 2026-07-27 — see References). Naively
uncommenting and filling in that top-level block with Resend production
credentials would silently redirect **local dev's** `local_smtp`/Mailpit
testing inbox to the real provider too — a direct regression of this
runbook's own local-dev guarantee, and exactly the kind of mistake this
document exists to prevent.

**Do not add an `[auth.email.smtp]` or `[remotes.*]` block to
`supabase/config.toml` as part of running this runbook** — the Dashboard
path above needs none of it.

If a future story or Arjun prefers the config-as-code route instead of the
Dashboard, the block would need to be scoped inside a persistent-branch
`[remotes.<name>]` entry keyed to the production project's `project_id`
(Supabase CLI v2's "config as code" mechanism — see References). The exact
current syntax for that was not fully verifiable as of this document's
writing and should be re-confirmed against Supabase's CLI docs before anyone
attempts it; a partially-verified CLI recipe left uncommented-but-wrong in
the shared config is worse than not touching the file.

## 4. Sequencing / blockers

**All resolved as of 2026-07-27** — nothing below still blocks this runbook.

- **Production domain — resolved 2026-07-27.** `curfew.vip` is registered;
  sending happens from the `updates.curfew.vip` subdomain (step 1).
- **Production Supabase project — resolved 2026-07-27.** The `prod`
  project (`jmitbnrofacxwsbwuxzs`, `supabase/PROVISIONING.md`) exists, with
  migrations pushed.
- **Credentials wired — resolved 2026-07-27.** Done via Resend's native
  Supabase integration (step 3's "Actual wiring path" note above), not the
  originally-planned manual Dashboard paste.

Order actually followed:

1. ~~Register a production domain.~~ Done (`curfew.vip`).
2. ~~Run steps 1–2 of this document~~ Done (domain verified, sending from
   `updates.curfew.vip`, Resend account credentialed).
3. ~~Create the production Supabase project.~~ Done (`prod`,
   `supabase/PROVISIONING.md`).
4. ~~Run step 3 of this document.~~ Done, via Resend's Supabase integration
   rather than the manual Dashboard-paste path originally planned.

## Completion bar for this runbook

This document is done when it's accurate, not when a real email has
actually been delivered to a real inbox. That live verification happens
whenever Arjun actually runs this runbook, after the domain and
prod-project gaps above close — it is not a blocker to this document (or
Story 2.3d) being considered complete.

## References

- [Supabase Auth custom SMTP docs](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase CLI config guide](https://supabase.com/docs/guides/local-development/cli/config)
- [Supabase branching configuration guide](https://supabase.com/docs/guides/deployment/branching/configuration)
- [Supabase CLI v2 "Config as Code" announcement](https://supabase.com/blog/cli-v2-config-as-code)
- [Resend's Supabase configuration guide](https://resend.com/blog/how-to-configure-supabase-to-send-emails-from-your-domain)
- `supabase/PROVISIONING.md` — structural template this document follows
