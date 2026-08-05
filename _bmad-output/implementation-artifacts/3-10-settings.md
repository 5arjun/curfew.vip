# Story 3.10 — Profile/Settings screen (design working doc)

> Living design doc. Captures decisions from the planning session (Arjun, 2026-08-05) as they lock. Feeds back into `epics.md` §Story 3.10 as the authoritative spec. Read this before `bmad-create-story` / dev.
>
> **Source inputs already read:** `epics.md` Story 3.10 block + its ⚑ Decision-needed note (2.3c review, 2026-07-28), Story 2.11 AC-3, Stories 5.7 / 7.4 AC blocks, `EXPERIENCE.md` (IA table, Component Patterns, State Patterns, Voice/Failure Register), `DESIGN.md` (§Avatar, §Components), `deferred-work.md` (phone-invariant entry, OAuth-passkey-nudge ruling, LiquidMetalButton orphan), `pre-launch-services-checklist.md`, and the live code: `app/(authenticated)/settings/page.tsx` (stub), `FloatingNav.tsx`, `link-agent/link-handoff.tsx`, `AgentStatusBanner.tsx`, `dashboard/page.tsx` (greeting name source), `supabase/migrations/*` (djs, agent_status), `agent/src-tauri/src/{config,error_reporting}.rs`.

---

## 0. The dividing line (what 3.10 owns vs. not)

**3.10 = the one home for identity and controls — a list of true facts, not a dashboard.** The screen is deliberately the quietest surface in the product: no shaders, no glass, no cards.

| In 3.10 | Out of 3.10 |
|---|---|
| Profile header — avatar + DJ name + email | **Avatar upload** (no storage bucket exists; own story) |
| **DJ name** — new optional, editable field (D-3) | **Email change** (email is the account-linking key; own story) |
| Email + phone, **read-only** (D-5, D-8) | **Phone change** (needs re-verification infra that doesn't exist — D-8) |
| Password → send-reset-link (D-5) | In-form old/new password pair |
| Linked sign-in providers: **see + link** (D-6) | **Unlink** — last-identity lockout footgun (D-6) |
| **Add a passkey** (D-7) — discharges the 2026-07-30 OAuth-nudge ruling | Re-plumbing `/auth/callback` state for the post-OAuth nudge (D-7) |
| **Phone-on-file gate** — the invariant finally enforced (D-9) | Any change to `/phone-required` itself (shipped, 2.3c) |
| Agent section — status + version + Link-agent entry (D-10) | Device registry / "unlink this Mac" (no server-side device row exists — D-10) |
| One additive heartbeat field: `agent_version` (D-11) | Any other `agent_status` growth; any `shared/` contract touch (AD-3 untouched) |
| Privacy section — export request + location coming-soon note (D-12) | **Delete account — CUT from MVP** (D-12; amends 2.11 AC-3) |
| Location **note only** — 5.7 fills the real control | The location toggle itself (5.7) |
| Appearance — "Themes coming soon" text (D-13) | Any working theme control (Obsidian is dark-only by design) |
| About — web version + build, agent version, support (D-14) | Privacy-policy / terms pages (**neither exists anywhere** — pre-launch gap, §7) |
| **Sign out** — the product's first (D-16) | Sign-out-everywhere / session management |
| Billing **slot** (section renders only when 7.4 populates it) | Any billing UI (7.4) |

---

## 1. Locked decisions (Arjun, 2026-08-05)

- **D-1 — Section inventory + order.** Profile header → Account → Agent → Privacy → Appearance → About → Sign out. Billing slots between Account and Privacy when 7.4 lands. A section with nothing true to say does not render.
- **D-2 — Single centered column, whole-page scroll.** Flat "console rows" (label left, value/control right) separated by hairline rules — **not** the dashboard's card/glass vocabulary, which would read as decoration on a list of facts. Same whole-page-scroll break from the dashboard's viewport lock that 3.7 made. Max width ~720px inside the 1100px container.
- **D-3 — DJ name: new, optional, editable.** Label is **"DJ name"**, not "Name" — it's what it actually is. ≤40 chars, any characters, no uniqueness check (no social layer to collide in). **If set, it wins over OAuth `full_name` in the dashboard greeting**; OAuth metadata is the fallback; nameless if neither. Fixes the standing gap that email-path DJs are permanently nameless.
- **D-4 — Avatar: provider photo, monogram fallback, not editable here.** Source is the OAuth provider's photo URL; email-path DJs get a **monogram** (first letter of DJ name, else email) on a token-colored disc. **The nav swaps `UserCircle` → the real avatar** (AC-1 satisfied) and still routes to `/settings` — same destination, visual change only. Needs a `next/image` remote-pattern allowlist for the Google/Apple photo CDNs.
- **D-5 — Email read-only; password = send-reset-link.** Email is displayed, never edited (it's the cross-provider linking key). Password gets one button that reuses the shipped reset infra — no in-form password pair.
- **D-6 — Providers: see + link, never unlink.** Row shows which of Google / Apple / Passkey / Email are attached, with a link affordance for the ones that aren't. Unlink is deliberately absent: unlinking your only identity locks you out of your own archive.
- **D-7 — "Add a passkey" lives here, and that discharges the OAuth-nudge ruling.** The 2026-07-30 ledger ruling (extend the post-signin passkey nudge to OAuth) is **resolved by relocation**: Settings is the durable home, and chasing one-time nudge state through two server-side redirect flows is disproportionate. Ledger entry gets closed with this rationale, not silently dropped.
- **D-8 — Phone: locked.** Displayed masked (`+1 415 ••• ••42`), read-only, with a plain note that changing it needs verification. Rationale: there is no SMS-verification path in the product, and an unverified phone edit would quietly break the AR-10 contactability invariant it's supposed to serve. Change-phone is its own story (needs OTP + a confirmation email on change).
- **D-9 — The phone-on-file invariant gets its gate here.** See §4 for the mechanism and why. This closes the `deferred-work.md` entry assigned to this story on 2026-07-28.
- **D-10 — Agent section = what's actually true today.** Status line (reusing 3.9's `agentStatusLine` / `resolveAgentStatus`), agent version, and a **Link agent** button routing to `/link-agent` — which today is reachable only by typing the URL. **No device row, no unlink**: linking is a token handoff over `curfew-agent://`, there is no server-side device record to revoke, and the only real revocation available (global refresh-token revoke) would also sign the DJ's browser out — a footgun disguised as a small button.
- **D-11 — Exactly one additive heartbeat field: `agent_version`.** One nullable column on `agent_status`, one parameter on `set_agent_status`, one call-site change in the agent. It's the cheapest way to satisfy About's agent-version row (D-14) and it makes the Agent section honest. Nothing else joins the heartbeat — no device name, no OS. `shared/`'s frozen sync contract is untouched (AD-3); this is the AD-20 RPC, exactly as scoped.
- **D-12 — Delete-account CUT; export stays.** Privacy renders a **"Request an export"** row (`mailto:support@curfew.vip`) and the location coming-soon note. **Deletion is out of MVP** — this contradicts Story 2.11 AC-3 ("a 'delete my account' support link… surfaced from the Profile/Settings screen, Story 3.10"), so 2.11 AC-3 gets a **dated amendment note** in `epics.md` rather than being left to silently disagree with this screen. 2.11 AC-4 (App-Store guideline forces self-serve deletion) is unaffected and still stands.
- **D-13 — Appearance = "Themes coming soon."** A text row, no control. A disabled toggle invites clicking and then lies.
- **D-14 — About: web version + build hash, agent version, support email.** With **no Sentry DSN provisioned and no web-side Sentry at all** (§7), these strings are the only diagnostic a DJ can hand you when something breaks — that's the section's real job, not vanity. Web build hash from `VERCEL_GIT_COMMIT_SHA` (short); `web/package.json` gets bumped off its `0.0.0` placeholder; agent version from D-11's heartbeat field, hidden when no agent has ever beaten.
- **D-15 — Autosave, no Save button.** Debounce ~600ms while typing, plus save on blur/Enter. **Confirmation is page-level** — a single "Saved." on the heading baseline, fading after ~2s. **Failure is inline and never silently reverts**: the typed value stays, and the row shows **"Change not saved — retry."** with a retry affordance. Silent revert is the worst outcome (looks like it worked, then didn't), and autosave *hides* failure rather than removing it — network drop, expired session, and RLS rejection all still exist.
- **D-16 — Sign out: bottom of the page, with a confirm dialog.** Calm register, same blurred-modal treatment as 3.7's delete confirm but without any destructive language. Copy: *"Sign out?" / "Your sets stay archived. The agent keeps capturing."* → `[Cancel]` `[Sign out]`. This is the **first sign-out anywhere in the product** — there is currently no way to log out.
- **D-17 — Deliberately quiet motion.** No WebGL, no shader rim, no morphing numbers. Motion budget: the "Saved." fade, the confirm-dialog scrim, and standard focus/hover transitions. **The orphaned `LiquidMetalButton` does NOT get a demo home here** (the `deferred-work.md` entry floats Settings as a candidate) — a settings page is the wrong place to keep a hero material alive; it stays owned by the login/marketing stories.
- **D-18 — Nav label and page heading are both "Settings."** The IA table's "Profile / Settings" is the concept, not the label.
- **D-19 — Process: same as 3.7/3.8.** This doc → `bmad-create-story` → dev → **one polish pass at the end** ([[feedback_polish_at_end]]).

---

## 2. Anatomy

```
                                                      Saved.
   Settings

   ( ●● )   Arjun
            arjunpat107@gmail.com

 ── Account ────────────────────────────────────────────────
    DJ name         [ Arjun                              ]
    Email           arjunpat107@gmail.com
    Phone           +1 415 ••• ••42          verified · locked
    Password        Send reset link
    Sign-in         Google ✓   Passkey ✓   Apple  + Link
                    + Add a passkey

 ── Agent ──────────────────────────────────────────────────
    Status          Syncing · 2 min ago
    Version         0.1.0
                    [ Link agent ]

 ── Privacy ────────────────────────────────────────────────
    Venue suggestion                            Coming soon
      Will suggest where you played from your device's
      location. You confirm it — nothing saves silently.
    Your data       Request an export

 ── Appearance ─────────────────────────────────────────────
    Themes coming soon

 ── About ──────────────────────────────────────────────────
    Curfew Web      0.1.0 (a5dc8e7)
    Agent           0.1.0
    Support         support@curfew.vip

 ───────────────────────────────────────────────────────────
                        [ Sign out ]
```

Row grammar: label in `{colors.on-surface-variant}` at body-sm, value/control right-aligned at body-md, hairline `{colors.outline-variant}` between rows, section labels in the same mono/eyebrow register the rest of the product uses. Editable rows are ghost inputs (`GhostInput`, reused from auth) that look like text until focused.

---

## 3. Section notes

**3a. Profile header.** Avatar at ~64px (`{components.avatar}` treatment — `rounded.full`, 1px `outline-variant`, image only). Name line = DJ name if set, else OAuth name, else the email alone. Not a form — the editable name lives in Account, so there's exactly one place to change it.

**3b. Account.** `DJ name` is the only writable row. `Phone` carries a quiet `verified · locked` affix rather than a disabled input — a greyed-out text field reads as broken; a plain value with a status word reads as intentional. Provider row renders attached identities with a check and unattached ones with a link action; **Apple cannot be exercised in local dev** (Sign In with Apple hard-requires an HTTPS return URL — see `login/page.tsx`'s existing comment), so its link path is verified against the Vercel deploy, not localhost.

**3c. Agent.** Status text comes straight from 3.9's resolver so the dashboard banner and this row can never disagree. Unlike the dashboard banner — which is silence-first and renders nothing most of the time — **this row always speaks**, because on a settings screen "no news" is indistinguishable from "broken." No agent ever seen → `No agent linked` + the button. Stale heartbeat → `Last beat 4 days ago` in the same calm register, never an alarm color.

**3d. Privacy.** Export copy notes it's processed by hand: *"Request an export — handled manually, usually within a few days."* Honest about the 2.11 runbook rather than implying a download button.

**3e. About.** Agent version row hides entirely when the heartbeat has never carried one (pre-D-11 agents, or no agent). Support row is a `mailto:`.

---

## 4. The phone-on-file gate (D-9) — mechanism and rationale

**The gap, precisely.** `/phone-required` fires only at first email-confirmation (`auth/confirm`) and at OAuth callback (`auth/callback`). Three paths still land an authenticated DJ in the app with `phone = null`: plain password `signIn()` (returns `"signed-in"` with no check), passkey sign-in (same), and abandoning `/phone-required` and returning later. So AR-10/FR-29's *"every account has a phone number on file"* is today really *"prompted once, best-effort."*

**Why the fix lands in middleware, not this form.** D-8 makes phone read-only here, so Settings can no longer be where a phone-less DJ fixes it. The gate is the only remaining lever.

**Chosen mechanism — cookie-marked lazy check.** Middleware (already running `getUser()` on every authenticated request) checks for a `curfew_phone_on_file` cookie. Absent → one read of `djs.phone`; present-and-non-null → set the cookie and continue; null → redirect to `/phone-required`. Cost is **one DB read per session**, not per request.

Alternatives weighed:
- *Per-request DB read* — rejected: middleware runs on every navigation including prefetches; that's a round trip on the product's hottest path for an invariant that changes once per account, ever.
- *Custom access-token auth hook adding a `phone_on_file` JWT claim* — genuinely zero-read and the airtight option, but it's new Supabase infra (a registered auth hook) and the claim goes stale until token refresh (~1h) right after the DJ sets their phone, needing a forced `refreshSession()` to compensate. **Noted as the upgrade path**, not the launch choice.

**On the cookie being spoofable:** it is, and that's acceptable — AR-10 is a *contactability* invariant, not a security boundary. The DB stays the source of truth; the cookie only skips a prompt. The real failure mode being fixed is people closing tabs, not adversaries. If a security need ever attaches to phone-on-file, upgrade to the JWT claim.

**Scope.** Gate applies to `(authenticated)` routes and `/link-agent`; exempts `/phone-required` itself, `/login`, `/auth/*`, and static assets.

---

## 5. States

| State | Treatment |
|---|---|
| Saved | Page-level "Saved." on the heading baseline, fades ~2s (EXPERIENCE.md State Patterns) |
| Save failed | Inline under the row: **"Change not saved — retry."** + retry action; typed value preserved, never reverted |
| Offline while typing | Same failure row — no separate offline copy; retry succeeds when connectivity returns |
| No agent ever linked | `No agent linked` + `[ Link agent ]`; About's agent-version row hidden |
| Stale heartbeat | `Last beat N days ago`, calm register, no alarm color |
| No provider photo | Monogram fallback (D-4), header and nav both |
| Provider link failed | Inline under the provider row, Failure Register register — never a banner |
| Passkey unsupported browser | "Add a passkey" hidden rather than shown-and-failing |
| Phone null (gate bypassed) | Unreachable by construction once D-9 ships; belt-and-braces, the row renders `Not on file` rather than an empty value |

**New Failure Register entry** (owed back to `EXPERIENCE.md`): *Settings change failed → "Change not saved — retry."*

---

## 6. Data / schema deltas

1. **`djs.dj_name text`** — additive column. Grant must stay **column-scoped** (`grant update (phone, dj_name)`), never a blanket `grant update on public.djs`, per AD-19's standing requirement that billing columns stay unreachable. Reuses the existing `djs_update_own_phone` policy shape.
2. **`agent_status.agent_version text`** (nullable) + a parameter on `set_agent_status` + the agent's call site. Additive only; `dj_id` still derived from `auth.uid()`, never a parameter (AD-20 discipline preserved).
3. **`web/package.json` version** off `0.0.0`; build hash read from `VERCEL_GIT_COMMIT_SHA`.
4. **No `shared/` contract change.** (AD-3 untouched.)

---

## 7. Owed / carried out of this story

- **`epics.md` Story 2.11 AC-3 — dated amendment note** recording that the delete-account link is cut from MVP by this session's ruling (D-12), so the two stories don't contradict.
- **`deferred-work.md`** — close the phone-invariant entry (D-9) and the OAuth-passkey-nudge entry (D-7, resolved-by-relocation); leave the `LiquidMetalButton` orphan open with a note that Settings was considered and declined (D-17).
- **`EXPERIENCE.md`** — add the new Failure Register row (§5).
- **`pre-launch-services-checklist.md` — two new rows:**
  - **`support@curfew.vip` inbox** — does not exist. `curfew.vip` is owned and `updates.curfew.vip` is verified for *sending*, but nothing receives mail. The export request in D-12 and the About support row both point at an address that currently goes nowhere.
  - **Sentry project + DSN** — the agent has full wiring (`error_reporting.rs`, `sentry` crate) but `config.rs` documents that no production DSN exists yet; **`web/` has no Sentry at all**. Until both are provisioned, About's version strings are the only diagnostic channel.
- **No privacy policy or terms page exists** anywhere in the app. Not invented here (that's legal copy, not a settings decision) — flagged as a pre-launch gap.
- **Future stories unblocked by this shell:** 5.7 (location toggle drops into Privacy), 7.4 (Billing section slots between Account and Privacy), avatar upload, email/phone change with verification, device registry + real agent unlink.
