# Auth update draft (FR-29 reconciliation) — for Arjun's reaction

## DESIGN.md — two new Components

### Google Sign-In Button
Uses Google's officially supported **dark/filled** button theme (not the white/light variant) so it sits naturally in Curfew's dark UI — near-black fill matching `{colors.surface-container-high}`, thin light-grey border, Google's full-color "G" logomark, white "Sign in with Google" label. Label font follows Google's own brand spec (a system sans), not Curfew's Inter — this is one of the few places text isn't set in a Curfew type token, deliberately. `{rounded.lg}` corner radius — Google's guidelines permit matching the host app's radius, so this much stays in Curfew's system.
`[ASSUMPTION]` Colors/theme name are from Google's Identity Services branding guidelines as I know them — worth a final check against Google's current published spec before implementation, brand guidelines do get revised.

### Apple Sign-In Button ("Sign in with Apple")
Uses Apple's officially supported **black** button variant (Apple also offers white/outline for light contexts — not used here, matches Curfew's dark theme). Black fill, white Apple logomark + "Sign in with Apple" label, Apple's mandated system font rendering for the label (not Hanken Grotesk/Inter). `{rounded.lg}` corner radius — Apple's spec permits matching host-app radius within their allowed range.
`[ASSUMPTION]` Same caveat as Google — verify against Apple's current Human Interface Guidelines before implementation.

### Do's and Don'ts — new line
**Do** let the Google and Apple buttons use their own mandated colors/logo lockups — the one deliberate exception to Curfew's palette, required for platform compliance, not a design lapse. **Don't** reskin them in `{colors.primary}` or any Curfew brand color, and don't touch the logo lockup.

---

## EXPERIENCE.md — Component Patterns, Auth form row (replaces current text)

**Before:** "First/last name, email, phone, password, plus a passkey/biometric (WebAuthn) option alongside the password path. `[ASSUMPTION — PRD sync owed]`: not yet in `prd.md`, Arjun's stated wish, kept in scope for ergonomics."

**After:** "Four paths, DJ's choice (FR-29): manual email + password + phone + name, Google, Apple, or passkey (WebAuthn). All four resolve to one account, auto-linked by verified email — no account picker, no duplicate-account risk if a DJ mixes methods across devices. Google/Apple sign-ups pull name + email from the provider and skip those manual fields, but still hit the phone-number step below before the account is usable."

## EXPERIENCE.md — new State Patterns row

| State | Surface | Treatment |
|---|---|---|
| Phone number required (post-OAuth) | Login / Signup | One-time follow-up step after Google/Apple sign-up, before the account is usable — name/email already provided by the provider, so this is a single-field ask. Copy: **"Add a phone number."** Same ghost input-field styling as the rest of the form. Not skippable (FR-29: every account has a phone number on file). |

## EXPERIENCE.md — UJ-3 restructured as the full onboarding sequence

Currently UJ-3 starts at the native agent install, as if the DJ already has an account — it never shows web signup at all, even though account creation is the actual first thing a new DJ does. Restructuring UJ-3 to be the complete first-time path, both surfaces, in the order a DJ actually hits them:

**UJ-3 — First-time setup (Devon, signing up and installing the agent for the first time)**

1. Devon lands on curfew.app, signs up via Google (one tap — could equally be Apple, passkey, or email + password).
2. Google skips straight past the manual name/email fields; Devon adds a phone number to finish the account (the one field Google didn't provide).
3. Curfew prompts Devon to download the local agent — the account alone can't do anything yet.
4. Devon runs the installer; agent auto-launches into the tray (idle icon).
5. Agent scans default paths + connected drives, finds a Serato folder, surfaces a one-time confirmation.
6. Devon confirms (or corrects the path via the same prompt / tray settings).
7. Plays their next gig normally — no in-app action.
8. Opens curfew.app the next morning; the set is already on the Dashboard.

**Climax:** unchanged — the set already being there.
**Resolution:** unchanged.
**Edge case:** unchanged (wrong/no path auto-detected).

This makes UJ-3 the canonical answer to "what does a brand-new DJ's first hour with Curfew look like," across both surfaces, instead of splitting it across an undocumented gap.
