# Launch checklist

**Created:** 2026-08-18. Every line below was verified against the live system
that day — the repo, prod Supabase, GitHub Releases, the Vercel project, and
`https://curfew.vip` itself. Nothing here is inherited on trust.

**Why this file exists, and why it is versioned.**
`_bmad-output/implementation-artifacts/pre-launch-services-checklist.md` has
tracked external accounts and services since July. It is still the right place
for provisioning history and it is not superseded — but `_bmad-output/` is
gitignored (`.gitignore:49`), so it lives on one laptop, never appears in a
diff, and cannot be reviewed in a PR. This file is tracked, scoped to *what is
left*, and is the one to read before opening the doors.

**Scope split, so the two files do not drift into contradiction:**

| This file | `pre-launch-services-checklist.md` |
| --- | --- |
| What is still open, and the recurring obligations after launch | How every account/service came to be provisioned, and the traps hit doing it |

---

## 0. Where things actually stand

Epics 1–4 are done. Epic 5 (segments) is the post-validation track — the epic
list marks it "may trail," and it does not gate launch. Epic 6 has one story
open (6.3, pricing page). Epic 7 is done bar bookkeeping.

**Everything external is provisioned.** Domain, Vercel, live Stripe (proven
with one real $7.99 charge, then cancelled and refunded), Resend, prod
Google/Apple OAuth, passkeys, the `support@` inbox, Sentry on both halves, and
all Apple/Tauri signing secrets.

**The agent ships.** `agent-v0.1.1` is published with both platforms —
notarized macOS `.dmg` + `.app.tar.gz`, unsigned Windows `.msi` + `.exe`,
minisign `.sig` for each, and a `latest.json` carrying both. The old
checklist's "no agent release has ever been published — the launch blocker"
row is **stale and closed.**

Prod schema is at **24/24 migration parity** with `supabase/migrations/`
(re-run this diff before any release; it is a point-in-time check).

---

## 1. Blocking — do not open the doors without these

### 1.1 Cut agent 0.1.2 — the published build is two merged commits behind

`agent-v0.1.1` published 2026-08-17 21:24Z. Both `#46` (Story 7.7 local-time
capture) and `#47` (tray icons + settings popover) touch `agent/` and merged
*after* it. A DJ downloading right now gets a binary with **no per-set
timezone capture** — the web half works and falls back to the DJ-level
`djs.timezone`, but the per-set half exists only in source — and the old tray
icon.

**Depends on 1.2.** Do that first, or this release has to be hand-cut again.

### 1.2 `AGENT_RELEASE_TOKEN` does not exist, and PR #48 is unmerged

PR #48 ("Make bumping agent/VERSION the release") makes `agent/VERSION` the
release decision: bump it, merge, and `tag-agent.yml` pushes the `agent-v` tag
that both release workflows trigger on. It is the right mechanism and it
replaces the hand-cut `gh release create` workaround.

It cannot work yet. `gh secret list` returns **9 secrets and no
`AGENT_RELEASE_TOKEN`**:

```
APPLE_API_ISSUER   APPLE_API_KEY      APPLE_API_KEY_CONTENT
APPLE_CERTIFICATE  APPLE_CERTIFICATE_PASSWORD  APPLE_SIGNING_IDENTITY
SENTRY_DSN         SUPABASE_PROD_PUBLISHABLE_KEY  TAURI_SIGNING_PRIVATE_KEY
```

The workflow needs a fine-grained PAT scoped to this repository with
**Contents: read and write** — the default `GITHUB_TOKEN` cannot be used, because
a tag pushed with it does not trigger other workflows (GitHub suppresses that
to prevent recursion). The failure mode is silent and misleading: the tag
appears, no release build ever starts, and it reads as a missing release rather
than a permissions problem.

- [ ] Create the PAT, add it as `AGENT_RELEASE_TOKEN`
- [ ] Merge PR #48
- [ ] Bump `agent/VERSION` to `0.1.2` (plain `X.Y.Z` — WiX rejects non-numeric
      pre-release identifiers; that is what killed `agent-v0.1.0-rc.1`)

Expect the macOS run to be slow. Apple's notary service has held one submission
of this bundle for over two hours; `timeout-minutes: 120` is set for that
reason. Do not kill it.

### 1.3 Per-OS download links

`web/lib/agent-downloads.ts` still points every download affordance at
`/releases/latest`. A DJ who has just paid $7.99 lands on a GitHub page listing
eight assets — `.dmg`, `.app.tar.gz`, two `.sig`s, `.msi`, `.exe`, another
`.sig`, `latest.json` — and has to guess which is theirs. The file's own comment
says to swap this once real filenames exist. They exist now.

This is the screen immediately after payment. Fix it in the same change as 1.1.

### 1.4 Signed-out authenticated routes render instead of redirecting

`/dashboard`, `/set/[id]` and `/track/[track_id]` render a logged-out empty
shell rather than bouncing to `/login`. `web/app/(authenticated)/layout.tsx`
says so in a comment; only Settings self-guards. RLS means nothing leaks, and
the proxy's subscription gate runs `if (sellsSubscriptions && userId && …)`, so
it never fires for a signed-out visitor.

Not a data breach. It is what a curious visitor who deep-links sees, and it
reads as a broken product.

### 1.5 No social/share metadata anywhere

Verified by grep across `web/app`: **zero** occurrences of `openGraph`,
`twitter`, or `metadataBase`. Every link to `curfew.vip` — pasted into a DM,
posted to Instagram or Discord, sent to a DJ friend — currently unfurls as a
bare URL with no image, no title beyond "Curfew", and no description.

For a product whose entire launch motion is DJs sending it to other DJs, this
is the highest-leverage item on this list.

- [ ] `metadataBase: new URL("https://curfew.vip")` in `web/app/layout.tsx` —
      without it, every relative OG image URL resolves wrong and Next warns at
      build time
- [ ] Default `openGraph` + `twitter` (`summary_large_image`) blocks on the
      root layout, overridden per marketing route
- [ ] A real 1200×630 OG image. `web/public/landing/` already holds
      `dashboard-3-poster.jpg`, `set-detail-3-poster.jpg` and
      `style-evolution-poster.jpg` — the art exists, it just needs cropping to
      ratio. Next's file convention (`app/opengraph-image.png`, plus per-route
      overrides) is the least-moving-parts option
- [ ] Fix the root `description`. It currently reads **"DJ reflection
      platform."** — internal shorthand, not customer copy. The marketing
      layout already carries the real line ("Curfew reads the sets you play and
      gives you the only baseline that means anything: your own."). The root
      one is what shows on every non-marketing route
- [ ] `apple-touch-icon` (180×180). Only `favicon-light.png` /
      `favicon-dark.png` are wired today, so an iOS home-screen save gets a
      screenshot instead of a mark

### 1.6 No `sitemap.xml`, and `robots.txt` is not ours

- `https://curfew.vip/sitemap.xml` → **404**. No `app/sitemap.ts` exists.
- `https://curfew.vip/robots.txt` → **200**, but it is **Cloudflare's injected
  content-signals block** (DNS is Cloudflare-proxied), not a file this repo
  controls. There is no `app/robots.ts` and no `public/robots.txt`. What it
  serves is comment lines about AI-training signals and **no crawl directives
  and no `Sitemap:` line at all**.

So there is no statement of what should be indexed, and — more importantly —
nothing keeps crawlers out of `/dashboard`, `/settings`, `/welcome`,
`/subscribe`, `/link-agent` or `/subscription-required`.

- [ ] `app/robots.ts` — allow the marketing surfaces, disallow the
      authenticated and onboarding groups, reference the sitemap. Verify after
      deploy that Next's route wins over Cloudflare's injection; if Cloudflare
      still overrides, the fix is in the Cloudflare dashboard, not the repo
- [ ] `app/sitemap.ts` — `/`, `/features`, `/faq`, `/contact`, `/privacy`,
      `/terms`, `/login` (and `/pricing` if 3.1 lands)
- [ ] Consider `robots: { index: false }` on the authenticated layouts as
      defence in depth — a `robots.txt` rule is a request, a meta tag is not

### 1.7 Pre-launch legal review — ✅ **DONE 2026-08-18**

**Ruled self-review, not paid legal review** (Arjun, 2026-08-18). Conducted the
same day and written up in **`docs/legal-review-2026-08-18.md`** — findings,
what was fixed, what was ruled as accepted risk, and the residual risk of
having an engineer do this rather than a lawyer. That file is the artifact;
this is the summary.

It also closes the **CCPA posture decision** (PRD §11 item 4, Architecture
Spine Open Question #6), both now marked fully resolved rather than
"partially."

**The review's main finding is that CCPA was the wrong worry.** It binds a
business over $25M revenue, or trading the data of 100k+ Californians, or
earning half its revenue from selling data. Curfew is none of those and won't
be for years — the deletion runbook had independently ruled the same thing on
2026-07-20. So the CCPA-level posture is voluntary and prospective: a good
stance that costs nothing, not an obligation. What *does* bind at any size is
CalOPPA, TCPA, CAN-SPAM and the auto-renewal rules, and those went unexamined
while this line said "CCPA."

Fixed in this pass:

- [x] CalOPPA §22575(b)(5)/(6) — the Do Not Track and cross-site-tracking
      disclosures, neither of which existed anywhere in the repo. Both are a
      clean truthful "no" here, which is why they were cheap
- [x] Auto-renewal disclosure next to the plan buttons (CA ARL / ROSCA). The
      annual button read "$83.88 once a year" with no renewal language at all.
      Terms and privacy links added to the same screen
- [x] Named the three missing processors — Stripe, Cloudflare, and Google/Apple
      as sign-in parties
- [x] Narrowed the rights paragraph, which was volunteering GDPR compliance the
      US-only posture had specifically deferred
- [x] One inbox for deletion and export requests. The runbook said `admin@`,
      both published pages said `support@`

**Still open — one fact, then this is fully shut:**

- [ ] **Governing law and venue.** The terms have no choice-of-law clause, so a
      dispute defaults to wherever the customer is. The clause is drafted and
      ready to paste in the review doc's "Ready to paste" section; it needs the
      state, which the repo doesn't contain. No arbitration clause recommended
      — see the review for why

**Gated, not fixed — the one live trap.** `/privacy` and `/terms` both grant
Curfew the right to email *and text* customers marketing, and name a "reply
STOP" and an "unsubscribe link" as the ways out. **No SMS provider exists
anywhere in this repo, no marketing email exists, and neither escape hatch is
built** — Resend carries transactional auth mail only. Worse, the consent was
never asked for: `phone-required` says only that "a person can reach you."

Ruled 2026-08-18: **keep the grant, build the consent before the first send.**
Nothing sends today so nothing is untrue in operation. See §5 for the standing
rule, and finding A of the review for exactly what "build the consent" means.
The gate is repeated as a header comment on `privacy/page.tsx`,
`terms/page.tsx` and `phone-required/page.tsx` — the three files someone would
have to touch on the way to sending.

**One-minute check worth doing before launch:** confirm cancellation is
actually enabled in the Stripe billing portal's dashboard configuration. The
portal is wired (`web/app/api/billing/portal/route.ts:90`, surfaced in
Settings) and that is what satisfies click-to-cancel — but whether its cancel
flow is switched on lives in Stripe, not in this repo, so nothing here can
verify it.

---

## 2. Should be done before real signups, ~an afternoon

### 2.1 No analytics of any kind

Verified two ways: no `@vercel/analytics` or `@vercel/speed-insights` in
`web/package.json`, and the Vercel API returns
`web_analytics_not_enabled` for the project.

Launching means shipping a landing page, a features walkthrough, an FAQ and a
paywall with **zero visibility into whether any of it converts** — no pageviews,
no funnel, no idea whether DJs bounce at the price or at the download.

- [ ] Enable Web Analytics on the Vercel project and add `<Analytics />`
- [ ] Consider `<SpeedInsights />` in the same change — the landing page runs a
      WebGL mesh and ships several MP4s, so real-device numbers are worth having
- [ ] If you want funnel events rather than pageviews (signup → checkout →
      download → first sync), that is a bigger decision than a script tag;
      decide it deliberately rather than by default

### 2.2 Leaked-password protection is off

Confirmed by the live Supabase security advisor today:
`auth_leaked_password_protection` → **WARN, disabled**. Supabase checks new
passwords against HaveIBeenPwned. One dashboard toggle, and the email+password
path is one of four signup routes.

### 2.3 No rate limiting on `signIn` / `signUp`

The Server Actions have no application-level throttle. Supabase's own limits
apply, but nothing app-side.

### 2.4 Drop the pre-signup backup tables

Confirmed present in prod today:

```
backup.presignup_sessions_20260817   backup.presignup_sets_20260817
backup.presignup_plays_20260817      backup.presignup_segments_20260817
```

They hold the 485 sessions / 17,337 plays / 243 segments deleted when the
go-forward rule was enforced. Deliberately in a `backup` schema, not `public` —
a new public table gets auto-granted to `anon` on hosted Supabase. Drop them
once you are satisfied the deletion was right.

### 2.5 `agent/README.md` is stale in two concrete ways

- It describes the agent's UI as "a menu-bar tray icon and a **minimal settings
  panel (UX-DR23)**". PR #47 deliberately superseded UX-DR23 — the panel is now
  an on-brand popover with an account row and a Link button, and the file
  itself records that supersession.
- It links twice into `_bmad-output/…`, which is gitignored. Those are dead
  links for anyone who clones the repo — the exact class of breakage this
  `docs/` file was created to avoid.

(PR #48 rewrites the release section correctly. Fold the rest into the same
merge rather than a separate pass.)

### 2.6 `/pricing` 404s — decide 6.3

Story 6.3 is the only open Epic 6 story, and `https://curfew.vip/pricing`
returns 404. But the price is already on the landing hero, the features page,
the FAQ, the login pitch and `/subscribe`.

Either build the small single-tier card page or close 6.3 by ruling. What is
not acceptable is a dangling link — if anything ever points at `/pricing`, it
is broken today.

---

## 3. Known, accepted, or deliberately deferred

Recorded so nobody reopens them as discoveries.

| Item | Disposition |
| --- | --- |
| **Google consent screen reads `jmitbnrofacxwsbwuxzs.supabase.co`** | **Won't fix**, ruled 2026-08-17. The only reliable fix is a Supabase custom auth domain at $25/mo, declined pre-revenue. Reopen only if it is *measured* to cost signups |
| **Windows ships unsigned** | Ruled 2026-08-16. SmartScreen shows a full-screen block; "More info → Run anyway" clears it. The explanatory copy was written and then **removed at your direction** 2026-08-17 — deliberate, not an oversight |
| **Roster reach high-water never shrinks** | Open, Category A. One drive swap permanently disables absent-marking, so sold or deleted tracks read "owned, never played" |
| **`getRecentSets`' 500-set cap** | Open, Category A. Silently reclassifies older debuts as "never played" in a lifetime metric. Materially de-risked by 0.1.1 — a new DJ now starts at zero sets rather than importing five years of history — but still there |
| **Epic 5 (segments) incomplete** | 5.3/5.4 in progress, 5.5–5.7 backlog. Explicitly the post-validation track; does not gate launch |
| **`SENTRY_AUTH_TOKEN`** | **Not owed.** Verified today: present on **Preview + Production**. Web stack traces de-minify. Still unproven by a real exception — the first genuine production error is the confirmation |
| **Agent Sentry project slug** | Still the platform default `rust` rather than `agent`. Cosmetic |
| **No legal entity behind "Curfew"** | **Accepted risk**, ruled 2026-08-18. Sole proprietor, launching anyway. The terms create an agreement with a name, not a party, and `/terms` §"What Curfew promises" caps liability for someone with no corporate shield — the cap still binds the customer, there is just nothing standing between a judgment and personal assets. Forming an LLC is the fix and it is a business decision, not a checklist item |
| **No physical postal address published** | Follows from the row above, and only actually required once commercial email sends. Gated with the marketing-send rule in §5 |

---

## 4. Bookkeeping

- [ ] `sprint-status.yaml`: story 7-5 reads `review` but shipped and is
      enforcing in prod (`web/lib/supabase/middleware.ts`)
- [ ] `pre-launch-services-checklist.md`: the "First agent release" row still
      reads 🚨 OPEN. It is closed — `agent-v0.1.1`, both platforms
- [ ] Same file, §3 lead paragraph: "there is exactly one thing between this
      repo and customers" is no longer true

---

## 5. Recurring obligations — the calendar, not the launch

Nothing here blocks launch. Everything here breaks the product on a specific
date if it is missed, and no system is currently watching any of them.

| Date | What breaks | Action |
| --- | --- | --- |
| **2027-01-24** | **Sign in with Apple stops working entirely.** The Apple `client_secret` is an ES256 JWT with a ~180-day life and **no auto-refresh** | Regenerate via `supabase/generate-apple-client-secret.mjs --key <.p8> --team-id <id> --key-id <id> --client-id app.curfew.web.signin`, then re-save in the prod Supabase dashboard |
| **2027-07-27** | `curfew.vip` expires — the whole product | Renew, $16/yr via Cloudflare. Not on auto-renew tracking anywhere else |
| **2027-07-28** | Apple Developer Program lapses: no Sign in with Apple, no macOS signing or notarization | Renew, $99/yr |

**These three rows are the source of truth.** They are not tracked in any
calendar, billing system, or monitor — only here and in
`pre-launch-services-checklist.md`. The Apple JWT is the dangerous one: it fails
silently on a random Tuesday, for every Apple user at once, with nothing in CI
to catch it.

Three standing rules, not dated:

- **Before the first marketing message — text or email — build the consent
  first.** `/privacy` and `/terms` already grant Curfew this right and already
  name the ways out; none of it is built, and the send is what arms it. Owed
  before anything goes out: a separate marketing opt-in on
  `(onboarding)/phone-required` (unchecked by default, its own sentence naming
  marketing texts and message rates, never a condition of subscribing), a
  `djs` column recording the consent timestamp and the exact wording shown, an
  unsubscribe link and a physical postal address in every marketing email, and
  A2P 10DLC brand/campaign registration. TCPA damages are $500 a message and
  $1,500 if willful, and unregistered US business SMS is carrier-filtered
  before it arrives — so a blast sent without this would be both unlawful and
  undelivered. `docs/legal-review-2026-08-18.md` finding A has the detail.
  **This is the one rule here that fires on an action rather than a date,
  which is exactly why it is easy to walk past.**

- **Before any release — agent or web — diff `supabase/migrations/` against
  prod's applied list and apply the difference first.** Verified in parity
  (24/24) on 2026-08-18. It goes stale the moment anyone writes a migration.
- **Re-validate the Apple signing credentials after any cert or key rotation**
  — `xcrun notarytool history` for the notarization triple, and decode the
  `APPLE_CERTIFICATE` base64 into a throwaway keychain to confirm it still
  yields exactly one valid codesigning identity.
