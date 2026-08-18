# Launch checklist

**Created:** 2026-08-18. Every line below was verified against the live system
that day — the repo, prod Supabase, GitHub Releases, the Vercel project, and
`https://curfew.vip` itself. Nothing here is inherited on trust.

**Last re-verified:** 2026-08-18, after 1.4, 1.5 and 1.6 closed. Every open
item below was re-checked against a live source rather than carried forward,
and what that meant in this pass: the Supabase security advisor (still five
WARNs, one real), the four `backup.presignup_*` tables (still there), the
applied-migration list (24, matching the repo through
`20260817193455_add_djs_timezone_column`), `sprint-status.yaml` (7-5 still
`review`, 6-3 still `backlog`), all four §4 bookkeeping lines in
`pre-launch-services-checklist.md` (all still un-actioned), and
`agent/README.md`. Two things had gone stale and were corrected: **2.3** (the
BotID sign-in ruling of the same day) and **2.5**'s reference count.
Re-verify the same way before opening the doors; several of these are
point-in-time checks that go stale silently.

**One thing in this pass is NOT verified live, and it is the important one.**
1.4/1.5/1.6 were verified against a production build and a local `next start`
— redirects, emitted tags, `robots.txt` and `sitemap.xml` bodies, parsed
JSON-LD. None of it has been verified against `https://curfew.vip`, because
none of it is deployed yet. The one that can still fail there is **1.6**:
Cloudflare injects its own `robots.txt` when the origin serves none, and
whether our route now wins is a fact about Cloudflare, not about this repo.

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

**The agent ships, and shipping it is now one commit.** `agent-v0.1.2` is
published with both platforms — notarized macOS `.dmg` + `.app.tar.gz`,
unsigned Windows `.msi` + `.exe`, minisign `.sig` for each, and a
`latest.json` carrying both. It was cut by bumping `agent/VERSION` (1.2), not
by hand, and `/welcome`'s two download links resolve to it per OS (1.3). The
old checklist's "no agent release has ever been published — the launch
blocker" row is **stale and closed.**

Prod schema is at **24/24 migration parity** with `supabase/migrations/`
(re-run this diff before any release; it is a point-in-time check). Confirmed
again this pass against the live applied list — same 24, same versions, through
`20260817193455_add_djs_timezone_column`.

**What is actually left to open the doors.** §1 has seven sections and every
one of them is now closed except a single sentence of 1.7. The blocking
remainder is:

| Still blocking | Shape of the work |
| --- | --- |
| **1.7** governing law and venue | One fact — the state. Clause is drafted and ready to paste |

That is the whole list. Two things stand behind it that are not blockers but
are not nothing either: **1.6 needs a live check after the deploy** (does our
`robots.txt` beat Cloudflare's injected one?), and the §5 marketing-send rule
still fires on an action rather than a date.

Nothing in §2 blocks, and 2.1 no longer means launching blind — pageviews and
field vitals are both wired, live from the next production deploy.

---

## 1. Blocking — do not open the doors without these

### 1.1 Cut agent 0.1.2 — ✅ **DONE 2026-08-18**

Was: `agent-v0.1.1` (published 2026-08-17 21:24Z) predated both `#46` (Story
7.7 local-time capture) and `#47` (tray icons + settings popover), so a DJ
downloading got a binary with **no per-set timezone capture** and the old tray
icon.

`agent-v0.1.2` published 2026-08-18 15:43Z, both platforms, cut by the 1.2
mechanism rather than by hand — notarized macOS `.dmg` + `.app.tar.gz`,
unsigned Windows `.msi` + `.exe`, a minisign `.sig` for each, and a
`latest.json` carrying both. This is the release 1.3's links resolve to.

### 1.2 `AGENT_RELEASE_TOKEN` and PR #48 — ✅ **DONE 2026-08-18**

PR #48 ("Make bumping agent/VERSION the release") makes `agent/VERSION` the
release decision: bump it, merge, and `tag-agent.yml` pushes the `agent-v` tag
that both release workflows trigger on. It is the right mechanism and it
replaces the hand-cut `gh release create` workaround.

All three steps are done, and the mechanism is proven end to end: bumping
`agent/VERSION` to `0.1.2` on main pushed `agent-v0.1.2` and both release
workflows ran off it (macOS 14m, Windows 12m, both green). `gh secret list`
now returns 10, including `AGENT_RELEASE_TOKEN`.

- [x] Create the PAT, add it as `AGENT_RELEASE_TOKEN`
- [x] Merge PR #48
- [x] Bump `agent/VERSION` to `0.1.2` (plain `X.Y.Z` — WiX rejects non-numeric
      pre-release identifiers; that is what killed `agent-v0.1.0-rc.1`)

Kept because the *why* still binds every future release. The workflow needs a
fine-grained PAT scoped to this repository with
**Contents: read and write** — the default `GITHUB_TOKEN` cannot be used, because
a tag pushed with it does not trigger other workflows (GitHub suppresses that
to prevent recursion). The failure mode is silent and misleading: the tag
appears, no release build ever starts, and it reads as a missing release rather
than a permissions problem.

Expect the macOS run to be slow. Apple's notary service has held one submission
of this bundle for over two hours; `timeout-minutes: 120` is set for that
reason. Do not kill it.

### 1.3 Per-OS download links — ✅ **DONE 2026-08-18**

Was: `web/lib/agent-downloads.ts` pointed every download affordance at
`/releases/latest`, so a DJ who had just paid $7.99 landed on a GitHub page
listing eight assets — `.dmg`, `.app.tar.gz`, two `.sig`s, `.msi`, `.exe`,
another `.sig`, `latest.json` — and had to guess which was theirs, on the
screen immediately after payment.

`/welcome` now offers macOS and Windows as two blocks and hands over the
installer directly. **The hrefs are not asset URLs**, deliberately: Tauri
stamps the version into every filename, and the version bump *is* the release
(1.2), so a build-time constant would go live during the same push that starts
a macOS notarization run which has taken over two hours — live and wrong for
that whole window, then silently 404ing on every later release nobody
remembered to bump it for.

They point at `/download/mac` and `/download/windows`
(`web/app/download/[platform]/route.ts`), which ask GitHub for the current
release at request time and 302 to the real asset. No bump, no staleness.
Every failure path — unknown platform, GitHub down or rate-limiting us, a
release carrying no installer for that OS — falls back to the releases page,
so the old behaviour is the floor rather than the ceiling.

Verified against the live 0.1.2 release on prod: `/download/mac` → the 17 MB
universal `.dmg`, `/download/windows` → the 5.3 MB x64 setup `.exe`,
`/download/linux` → the releases page. Suffix matching keeps the three
minisign `.sig` files out by construction, which is what
`web/lib/agent-downloads.test.ts` pins — a signature is a download that
"works" and produces a useless file.

Neither platform is emphasized and neither is OS-detected: step 01 says "the
laptop you play from", which is routinely not the device the page is being
read on.

### 1.4 Signed-out authenticated routes render instead of redirecting — ✅ **DONE 2026-08-18**

Was: five of the group's six pages rendered a logged-out empty shell to anyone
who deep-linked them — `/dashboard`, `/set/[id]`, `/track/[track_id]`,
`/library-utilization`, `/style-evolution`. `redirect("/login")` appeared in
exactly one page, `settings/page.tsx`. Not a data breach (RLS), but it read as
a broken product.

Fixed in `web/app/(authenticated)/layout.tsx`, which now login-gates the whole
group. **In the layout, not page-by-page and not in the middleware** — a layout
has no list to keep in sync, so every page added to the group is covered the
day it is added. The middleware was the wrong home for the opposite reason:
route groups are invisible to routing, so a gate there needs a literal prefix
list, which is the same maintenance burden that produced the bug.

Two details worth keeping:

- It uses `getClaims()`, not `getUser()` — the JWT is verified locally, so the
  gate costs no network round-trip per render. Same call, same reason, as
  `lib/supabase/middleware.ts`.
- It **fails open** on a thrown read: the old empty shell is the floor, where
  failing closed would bounce a signed-in DJ to `/login` mid-session. The
  paywall is the only gate in this app that fails closed, because that one
  guards revenue rather than polish.

The comment that made this bug invisible ("each page self-guards") is gone from
the layout, and the two other files that asserted the gap in passing —
`dashboard/page.tsx` and `settings/page.tsx` — were corrected with it.

Verified against a production build on a local `next start`: all six routes,
signed out, return `307 → /login`. `/features` and `/faq` still return 200.

### 1.5 No social/share metadata anywhere — ✅ **DONE 2026-08-18**

Was: **zero** occurrences of `openGraph`, `twitter` or `metadataBase` across
`web/app`. Every link to `curfew.vip` unfurled as a bare URL — no image, no
title beyond "Curfew", no description — for a product whose entire launch
motion is DJs sending it to other DJs.

- [x] `metadataBase: new URL("https://curfew.vip")` on the root layout
- [x] `openGraph` + `twitter` (`summary_large_image`) on the root layout and on
      every marketing route, through `pageMetadata()` in **`web/lib/seo.ts`** —
      the one module page metadata, the sitemap, robots and the JSON-LD all
      read from, so the four cannot drift
- [x] A real 1200×630 card at `web/app/opengraph-image.jpg`. Not a cropped
      screenshot in the end: it is the `booth.jpg` photograph pushed back into
      atmosphere, the wordmark, the landing's own two statements set in Clash
      Display, and the energy arc across the bottom band. Regenerate with
      `python3 web/scripts/og-assets.py` — that script is committed, documents
      every input, and explains why a runtime `ImageResponse` was declined
      (satori cannot read woff2, and Clash Display ships only as woff2, so a
      runtime card would have used a face that is not ours)
- [x] Root `description` fixed. "DJ reflection platform." is gone; the real
      customer line now shows on every non-marketing route
- [x] `apple-touch-icon` (180×180) at `web/app/apple-icon.png` — the record
      glyph on Abyss ground, opaque and full-bleed because iOS composites it
      with its own rounding and no transparency handling
- [x] Also done, unasked but part of the same surface: `/`'s title. It was the
      single word "Curfew" — the weakest possible result line for this site's
      most important query — and is now "Curfew — the DJ set archive that
      builds itself". It lives on the **marketing layout** because
      `(marketing)/page.tsx` is a client component and cannot export metadata
- [x] JSON-LD: `Organization` + `WebSite` + `SoftwareApplication` on every
      marketing route, and `FAQPage` on `/faq` — 18 questions, built from the
      **same array `/faq` renders**. That is why the FAQ content moved to
      `faq-content.ts`: `FaqBeats.tsx` is `"use client"`, and a value imported
      from a client module into a server component arrives as a client
      reference, not as data. Google requires the marked-up answer to be the
      answer on the page; one array is the only way to keep that true
- [x] `sameAs` points at Instagram `@curfew.vip` and X `@curfewvip`, which is
      what tells Google those profiles and this site are one brand. `@curfewvip`
      is also `twitter:site` / `twitter:creator`

**The trap this pass hit, recorded because it will recur.** The plan was to let
Next's file convention wire the card: drop `opengraph-image.jpg` into `app/`
and every route inherits it. The build says otherwise — in
`.next/server/app/`, `_not-found.html` (which overrides nothing) carried all
four `og:image*` tags while `index.html` carried **none**. Any route that
exports an `openGraph` object replaces the resolved parent object, and the
file-convention image goes with it. Same for `icons`: declaring the favicons
dropped the apple-touch-icon. Both are now named explicitly, and `OG_IMAGE` in
`lib/seo.ts` carries the evidence. **This fails silently and looks correct in
the source.**

Verified in the build output for `/`, `/faq`, `/features` and `/privacy`: title,
description, canonical, the full `og:*` and `twitter:*` sets with image
dimensions and alt text, `apple-touch-icon`, and the JSON-LD parsed back as
valid JSON with the right prices and 18 questions.

### 1.6 No `sitemap.xml`, and `robots.txt` is not ours — ✅ **DONE in the repo, one live check owed**

Was: `/sitemap.xml` a 404, and `/robots.txt` a 200 serving **Cloudflare's
injected content-signals block** — comment lines about AI-training signals, no
crawl directives, no `Sitemap:` line. Nothing stated what should be indexed and
nothing kept crawlers out of the authenticated or onboarding surfaces.

- [x] `web/app/robots.ts` — allows the marketing surfaces, disallows all 16
      private prefixes, and points at the sitemap. It also **disallows
      everything on a non-production deployment** (`VERCEL_ENV !==
      "production"`), so previews cannot compete with prod in an index
- [x] `web/app/sitemap.ts` — the seven public routes. `/pricing` is
      deliberately absent while 6.3 is undecided and the route 404s (§2.6); a
      sitemap listing a 404 is worse than one omitting a real page. No
      `lastModified`, because both available values are lies Google ignores —
      the reasoning is on `PUBLIC_ROUTES` in `lib/seo.ts`
- [x] `robots: { index: false, follow: false }` on both group layouts and on
      the two top-level private routes (`/subscription-required`,
      `/reset-password`, which inherit no group layout). This is the stronger
      half: a `robots.txt` rule is a request that only prevents a re-crawl, and
      the meta tag is what removes a page already in an index

Both bodies were read out of the build and are correct, and the sitemap's home
entry deliberately matches the canonical Next emits for `/` (no trailing
slash) — one character of difference there is the cheapest way to look like two
pages.

- [ ] **Live check, owed after the deploy.** Fetch `https://curfew.vip/robots.txt`
      and confirm it is ours — look for the `Sitemap:` line. Cloudflare injects
      its block when the origin serves none; with one present it *should* pass
      through, but "should" is not "does" and the failure is silent. If
      Cloudflare still overrides, the fix is in its dashboard, not this repo.

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

### 2.1 No analytics of any kind — ✅ **DONE 2026-08-18**

Was: no `@vercel/analytics` or `@vercel/speed-insights` in `web/package.json`,
and the Vercel API returning `web_analytics_not_enabled` for the project —
launching a landing page, a features walkthrough, an FAQ and a paywall with
**zero visibility into whether any of it converts**.

- [x] Enable Web Analytics on the Vercel project and add `<Analytics />` —
      enabled on `curfew.vip` (`prj_UPn4…YKfR`) 2026-08-18 via
      `vercel project web-analytics`, and both components mounted in
      `web/app/layout.tsx`. Nothing is collected until the next production
      deploy carries that layout.
- [x] `<SpeedInsights />` — mounted, and the project setting is on. This one
      cost something: Hobby teams get Speed Insights on **one project at a
      time**, and `avorigroup.com` held the slot. Arjun disabled it there
      2026-08-18 so `curfew.vip` could take it — avorigroup keeps its history
      but stops collecting field vitals. Re-enabling it there would silently
      turn this one off, so treat the slot as a shared resource, not a setting.
- [ ] If you want funnel events rather than pageviews (signup → checkout →
      download → first sync), that is a bigger decision than a script tag;
      decide it deliberately rather than by default. **Explicitly not done in
      the 2026-08-18 change** — what shipped is pageviews only.

Both scripts serve from this origin rather than a third-party host, which is
what keeps them working behind Cloudflare's proxy and past an ad blocker —
the same reason `next.config.ts` sets BotID's rewrites and Sentry's
`tunnelRoute`. No CSP exists to widen.

### 2.2 Leaked-password protection is off

Confirmed by the live Supabase security advisor today:
`auth_leaked_password_protection` → **WARN, disabled**. Supabase checks new
passwords against HaveIBeenPwned. One dashboard toggle, and the email+password
path is one of four signup routes.

That advisor run returns **five** WARNs, not one. The other four are
`authenticated_security_definer_function_executable` on `sync_set`,
`sync_library_roster`, `sync_library_add_events` and `set_agent_status` — the
agent's entire write path, `SECURITY DEFINER` by design. They are recorded in §3
so the next person to run the advisor does not read them as four new findings
sitting next to a real one. **This is the only item on the list where "clean the
advisor output" would be the wrong instinct.**

### 2.3 No rate limiting on `signIn` / `signUp` — and BotID no longer blocks sign-in

The Server Actions have no application-level throttle. Supabase's own limits
apply, but nothing app-side.

**Changed 2026-08-18 (`96ce86e`), and it changes what this item means.** BotID
runs on both credential actions, but it now **refuses only signup** —
`botRejection()` in `web/app/(marketing)/login/actions.ts` records the verdict
and returns null for `sign-in`. The ruling is the asymmetry: a false positive
on signup costs an account that was never created, while on sign-in it locks an
already-paying DJ out of an archive they own. This was not hypothetical —
`admin@curfew.vip` could not log in at all, behind the same generic copy a
wrong password produces, and because the check ran *before* the Supabase call
the attempts left no trace in the auth logs either.

So on the sign-in path specifically, **Supabase Auth's per-IP rate limiting on
`/token` is now the only answer to credential stuffing.** That was always the
second layer; the hard block in front of it was shadowing it rather than adding
to it, since a rejected request never reached the limiter to be counted. The
verdict is now logged (`console.warn`, no email), so a recurrence is at least
visible.

This is a reason to weigh an app-side throttle slightly more heavily than the
line above did, not a new blocker.

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
- It points into `_bmad-output/…`, which is gitignored, in **three** places
  (lines 76, 91 and 117) — one a real markdown link, two inline path
  references. Dead for anyone who clones the repo, which is the exact class of
  breakage this `docs/` file was created to avoid. ("Links twice" was this
  line's own count until 2026-08-18; it was wrong.)

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
| **Four `SECURITY DEFINER` advisor WARNs** | **By design, not owed.** `sync_set`, `sync_library_roster`, `sync_library_add_events`, `set_agent_status` — every one is the agent's write path, and `SECURITY DEFINER` executable by `authenticated` is the mechanism, not a leak. The grants were deliberately hardened twice (`20260807140000_harden_table_and_function_grants`, `20260807160000_harden_library_roster_grants`) and `record_deleted_set`'s EXECUTE was revoked outright (`20260807150000`), so this is a considered posture rather than a default. Reopen only if a function's body stops scoping writes to `auth.uid()` |

---

## 4. Bookkeeping

All four confirmed still un-actioned as of this pass.

- [ ] `sprint-status.yaml`: story 7-5 reads `review` (line 1545) but shipped and
      is enforcing in prod (`web/lib/supabase/middleware.ts`). Note the file
      argues for `review` on purpose in a comment above the line — so this is a
      ruling to make, not a typo to fix
- [ ] `pre-launch-services-checklist.md`: the "First agent release" row still
      reads 🚨 OPEN. It is closed — **`agent-v0.1.2`**, both platforms
- [ ] Same file, §3 lead paragraph: "there is exactly one thing between this
      repo and customers, and it is not on this list because it is not a
      service: no agent release has ever been published" is no longer true, and
      is the single most misleading sentence in either checklist
- [ ] Same row, closing paragraph: "after a green run, three code follow-ups
      fall due." **All three are done** and should be struck with it — per-OS
      download URLs (§1.3), `/welcome`'s false "signed, updates itself" line
      (now rewritten, `welcome/page.tsx:139`), and the SmartScreen copy (written
      then removed at your direction, §3)

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
