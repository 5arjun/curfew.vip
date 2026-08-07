---
name: Curfew
status: final
sources:
  - "{planning_artifacts}/prds/prd-name-pending-2026-07-19/prd.md"
  - "{planning_artifacts}/briefs/brief-name-pending-2026-07-19/brief.md"
updated: 2026-07-20
---

## Foundation

Two surfaces. The primary experience is a responsive website (desktop/laptop-first — DJs review over coffee, per UJ-1 — readable down to phone width, no dedicated mobile app). The secondary surface is the local agent (Tauri/Rust, macOS + Windows): a menu-bar/tray icon plus one settings panel, never a full app window (FR-5). No inherited component library — `DESIGN.md` defines a custom token system (Material-3-style naming, not a dependency) both surfaces draw from, though the tray deliberately stays OS-native chrome rather than skinned to match. Scope is Phase 1 only (solo reflection layer) — Phase 2 surfaces (feed, profile, comparisons) are out of this pass, per PRD §9 gating.

## Information Architecture

| Surface | Reached from | Purpose | Composition reference |
|---|---|---|---|
| Landing (logged out) | curfew.app | Marketing homepage — "compared to what?" hook, entry to signup/login | `curfew_landing_page_sticky_nav/` |
| Features (logged out) | Landing nav | Marketing/informational page — product capability walkthrough, no auth required | — (not rendered in Stitch this pass) |
| Pricing (logged out) | Landing nav | Marketing/informational page — single $6/mo subscription tier (PRD §7) | — (not rendered in Stitch this pass) |
| Login / Signup | Landing (overlay) | Auth, overlaid on the homepage per product vision — never a separate blank page | `curfew_login_sticky_nav/` |
| Dashboard (home) | Nav / post-login default | Recent sets, trend snapshots, new-set-detected nudge | `curfew_dashboard_sticky_nav/` |
| Set Detail | Dashboard → click a set | One set's stats, energy arc, segments, Layer 2 enrichment | `curfew_set_detail_sticky_nav/` |
| Style Evolution | Nav | Month-over-month trend view | `curfew_style_evolution_sticky_nav/` |
| Library Utilization | Nav | Conversion rate, aging shelf, time-to-first-play | `curfew_library_utilization_sticky_nav/` |
| Profile / Settings | Nav (avatar) | Account info, privacy, location opt-in | — (not rendered in Stitch this pass) |
| Agent tray (native) | OS menu bar / tray icon | Sync state, Serato path override — the agent's only UI | — (native chrome, out of Stitch scope) |

The floating bottom pill nav (`{components.nav-floating}`) is persistent across every logged-in website screen.

→ Composition reference base path: `imports/stitch_curfew_dj_reflection_platform/`. `curfew_set_detail/` (left-sidebar nav) was rejected in favor of `curfew_set_detail_sticky_nav/` above; `curfew_dj_archive_flow/` is a byte-identical duplicate of the landing-page render, not a separate reference. DESIGN.md and EXPERIENCE.md (the spine) win on conflict with any mock/import.

## Voice and Tone

Microcopy. Brand voice lives in `DESIGN.md.Brand & Style` (After-Hours Archive / console persona).

| Do | Don't |
|---|---|
| "Initialize Session" / "Archive Insight" | "Get Started!" / "Awesome job!" |
| "Compared to your last 10 sets" | "You're crushing it" |
| "Genre gap detected" | "You're the best in EDM" |
| "Session: Syncing…" | Generic "Loading…" |
| Quiet, declinable nudge: "New set detected. Add details?" | Push-style urgency: "Don't forget to log your set!" |
| Silence when there's nothing to report | Streak counters, "🔥 5-day streak!" badges (SM-C2 — non-negotiable) |

**Failure Register.** Same console vocabulary, failure branch — calm and technical, never alarmed, no exclamation points.

| Situation | Copy |
|---|---|
| Sync failed, retrying | "Sync interrupted. Retrying automatically." |
| Drive/USB disconnected | "Archive unreachable — reconnect drive to resume." |
| Format-drift, parse paused (FR-1 NFR) | "Format change detected — sync paused until verified." |
| Login failed, wrong password | "Credentials not recognized — try again." |
| Signup blocked, email already registered | "Account already archived — log in instead." |
| Settings change failed | "Change not saved — retry." *(Story 3.10, D-15: inline under the row, typed value preserved, never a silent revert.)* |
| Chart/data failed to render | Falls through to `{components.chart-summary}` — never a bare broken-chart icon. |

## Component Patterns

Behavioral. Visual specs live in `DESIGN.md.Components`.

| Component | Use | Behavioral rules |
|---|---|---|
| Auth form (Login/Signup) | Login / Signup, overlaid on Landing | Four paths, DJ's choice (FR-29): manual email and password fields, Google, Apple, or passkey (WebAuthn) — *(revised 2026-07-27: dropped "name"/"phone" from this row's manual-field list; neither is collected inline on this form by any shipped story — a name field was never assigned to any story, and phone is now a separate one-time follow-up screen for every path, not an inline field here — see the Phone number required row below and Story 2.3c)*. All four resolve to one account, auto-linked by verified email — no account picker, no duplicate-account risk if a DJ mixes methods across devices. Every path still hits the phone-number follow-up step (see State Patterns) before the account is usable. |
| Avatar (`{components.avatar}`) | Floating nav → Profile/Settings | Click opens the Profile/Settings surface — the IA table's only avatar-triggered nav item; no other interaction. |
| Set card (`card-reflection`) | Dashboard recent-sets list | Click anywhere opens Set Detail. Shows date/session-id (mono), genre chips, energy-arc thumbnail. |
| New-set nudge | Dashboard, on new sync | Inline banner, not modal — "New set detected. Add details?" [Add / Skip]. Skip persists per-set, never re-prompts (FR-16 is never required). |
| Energy arc chart | Set Detail | BPM-vs-time line. Hover/tap a point shows BPM + timestamp + track. No zoom/pan in v1. |
| Tracklist (`{components.set-list-module}`) | Set Detail | Per-track timeline rows — title, artist, timestamp. The set's top "impact" track carries a highlighted node plus a peak-metric annotation; other tracks render plain. Missing metadata falls back to the existing "Unknown track data" state (FR-2, see State Patterns) — not redefined here. "View Full Tracklist" expands past the inline top-tracks summary shown on Set Detail to the complete set's tracklist. |
| Segment editor | Set Detail | Suggested boundaries (FR-28) render as draggable dividers over the energy arc; drag to adjust or tap "+" for a manual one (FR-14 fallback). Confirm commits; editable anytime after. |
| Layer 2 form | Set Detail | Inline expandable form (venue, crowd size, event type, notes) below the stats — never modal, never blocking. |
| Location suggestion | Layer 2 form | Off by default. When on: suggested venue appears as an editable pre-filled field, never silently saved (FR-18). |
| Trend chart | Style Evolution | Month-over-month chart per metric (BPM range, genre diversity, key usage, **library conversion**). Chip toggle switches metric; one chart visible at a time, not stacked small-multiples. |
| Library-conversion trend | Style Evolution | The fourth chip (FR-10, Story 4.2 — confirmed with Arjun 2026-08-07 to live here, with FR-9, matching the PRD's own §4.3 grouping, rather than on Library Utilization where the nav label suggests). Shares the chart component and the chip row but **not the x-axis**: this one buckets by the month a track was *added*, the other three by the month a set was *played* — safe only because one metric is ever on screen at a time. Y-axis is a fixed 0–100%, never auto-fitted. A cohort is plotted only once it has had its full 90 days (matching FR-11's already-locked window); recent months are absent on purpose and said so in the disclosure line, alongside the count of tracks with no known add date. Month-only: the week/month toggle and the low-confidence reveal are hidden for this metric — an add-event is not a set, so neither has anything to act on. |
| Chart summary (`chart-summary`) | Energy arc, Trend charts | Auto-generated plain-language line under every chart — min/max/direction templated into a sentence ("BPM ranged 122–128, climbing through the back half"). One shared utility, not bespoke per screen. Renders even when the chart itself fails to load, doubling as the render-failure fallback. |
| Conversion-rate meter | Library Utilization | *(Story 4.3, shipped 2026-08-07 — corrects this row: `{components.progress-pip}` below was never built and predates the Abyss glass redesign.)* Rendered as filled/empty LED pips, not a bare percentage — reuses Set Detail's shipped harmonic-hero pattern verbatim (`LedPips`, extracted from `StatsColumn`'s `.sd-pips`/`.sd-pip[data-lit]`), not the `progress-pip` token. A **live, current-90-day-window** stat — % of tracks added in the trailing window that have been played at least once — deliberately a different computation from the Trend Chart row's library-conversion cohort model above (which structurally excludes exactly the tracks still inside their own window). The window is stated in the visible readout, never implicit. Below `LOW_CONFIDENCE_COHORT_SIZE` added tracks, an "early read" disclosure appears alongside the pips rather than a misleadingly precise percentage; tracks with no resolvable add-date are excluded and disclosed by count, same discipline as the Trend Chart row. |
| Time-to-first-play | Library Utilization | *(Story 4.5, shipped 2026-08-07 — no prior wireframe existed for this component.)* A module alongside the conversion-rate meter reusing its generic `.lu-stat-*` typography rather than a new visual language. Shows the **average** elapsed time from add to a qualifying track's first play, phrased at whatever scale the value lands on — minutes and hours as readily as days, weeks or months, because on real data most debuts happen the same evening and a day-floored formatter said nothing. *(Mean, not median, by Arjun's ruling 2026-08-07, with the trade recorded: the distribution is heavily right-skewed — median ~51 min vs. mean ~14 days on real data, with 84% of debuts faster than the mean — so the average is the less representative statistic but the more believable-looking number. A figure a DJ refuses to trust is worse than one that is slightly unrepresentative.)* Tracks never played are disclosed as a distinct count carrying the average time that population has been waiting, never folded into the average as zero; a track whose only plays predate its add date is a third state again, counted as neither. Population is scoped to tracks Curfew observed being added go-forward (Story 4.2's D-1 baseline) — a proxy for the re-spec's literal "since subscription start," since no persisted subscription-start timestamp exists yet (Epic 7 is still `backlog`), and one that holds for *dated* add-events only. **Two gates, not one:** below `MIN_TIME_TO_FIRST_PLAY_TRACKS` qualifying tracks the shared insufficient-history state renders with its own copy; above it but below `MIN_TIME_TO_FIRST_PLAY_DEBUTS` *debuted* tracks, the module reports the waiting population instead of an average — a population-size gate alone cannot keep an average from being drawn from a handful of points, because never-played tracks pass it and contribute nothing to it. The undated-add-date disclosure renders once at page level, shared with the conversion-rate meter, rather than once per module. |
| Aging-shelf list | Library Utilization | Sortable by days-unplayed; each row has an explicit "add to prep crate" action (UJ-6) — the one place the product nudges toward an action, not just a report. |
| Agent tray icon | Native tray | Four states — idle / syncing / failed / drive-not-connected (FR-5); click opens the single settings panel (path override only). |
| Pricing card (`{components.pricing-card}`) | Pricing page | Single-tier display — $6/mo, no comparison table or plan picker (one plan only in V1, nothing to compare against). CTA routes to Signup/Login. No discount badges or "most popular" ribbon — those imply a choice between tiers that doesn't exist here. |

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| Cold dashboard (no sets yet) | Dashboard | Empty state after signup/agent-install, before first gig syncs. "Play your next gig — Curfew does the rest." No fake-data CTA. |
| New set detected | Dashboard | Quiet banner, declinable (FR-16) — never a push notification. |
| Unknown track data | Set Detail, any track list | Renders literally as "Unknown" (FR-2) — never guessed, never hidden. |
| Sync offline / queued | Dashboard status + tray icon | "Queued — will sync when you're back online" (FR-4); tray shows a distinct queued glyph. |
| Drive not connected | Tray icon + Settings | FR-5 icon state; settings panel shows last-known path with manual override. |
| First-run path confirmation | Agent first-run (native) | Agent surfaces auto-detected path; DJ confirms or corrects (UJ-3) — one-time gate. |
| Aging-shelf empty | Library Utilization | Positive-framed, still not gamified: "Everything you've bought is getting played." |
| Insufficient history (<1 month synced) | Style Evolution | "Two more sets and Style Evolution has something to show you." — reuses the cold-dashboard row's register above (console-voice, not apologetic); UJ-5's trend view depends on at least a month of synced sets to have anything to show. |
| Settings saved | Profile / Settings | Brief inline confirmation — "Saved." — no toast/modal escalation, same quiet console register as the rest of the system. |
| Auth failed (wrong password / email already registered) | Login / Signup | Failure Register copy ("Credentials not recognized — try again." / "Account already archived — log in instead.") — inline under the field, same calm register as every other failure state, never a red alert banner. |
| Phone number required (post-signup, any path) | Login / Signup | One-time follow-up step after signup completes — Google/Apple sign-in, or email+password after confirmation — before the account is usable, so this is a single-field ask regardless of path. *(Revised 2026-07-27 from OAuth-only: the email+password path was never assigned a phone-collection step by any story, so it's folded into this same follow-up screen instead of a separate inline form field, closing the gap without reopening Story 2.3a's signup form — see Story 2.3c.)* Copy: "Add a phone number." Same ghost input-field styling as the rest of the form. Not skippable (FR-29: every account has a phone number on file, regardless of signup path — AR-10). |
| [ASSUMPTION — PRD sync owed] Recently-downloaded-not-yet-played nudge | Dashboard | PRD (UJ-1 note) flags this as possibly worth a direct nudge, explicitly "not committed." Threshold: **30 days** since download, not yet played — long enough that a same-day download doesn't nag, short enough to read as distinct from the 3-month aging shelf. Quiet secondary nudge, same banner pattern as "new set detected." |
| Sync failed, retrying | Dashboard status + tray icon | "Sync interrupted. Retrying automatically." (Failure Register) — tray icon shows the failed-state glyph until it clears. |
| Format-drift, parse paused | Dashboard status + tray icon | "Format change detected — sync paused until verified." (Failure Register, FR-1 NFR) — rare, only fires on an actual Serato format change caught by golden-file regression tests. |
| Chart/data failed to render | Set Detail, Style Evolution | Falls through to `{components.chart-summary}`'s plain-language line instead of a broken-chart icon. |

## Interaction Primitives

- Floating bottom pill nav — hover (desktop) / tap (touch) opens an upward popover for secondary items; active item fills solid in `{colors.primary}`.
- Purposeful scroll-driven motion — **Landing only** (per the ssscript.app / saracajner.com / bymonolog.com references, see Inspiration & Anti-patterns). Logged-in dashboard surfaces stay still/functional — data shouldn't compete with its own charts.
- Drag-to-adjust segment boundaries (mouse/touch), with a keyboard equivalent: Tab to a boundary, arrow keys nudge it, Enter confirms.
- Confirm-or-edit, never silent-auto-fill — governs venue suggestion (FR-18) and first-run path detection (FR-1/UJ-3) alike: system proposes, DJ confirms or edits, nothing commits without an explicit action.
- **Banned:** gating any core stat behind an enrichment prompt (Layer 2 always skippable inline); infinite scroll on track lists (paginate / "load more"); any celebratory micro-interaction on stat milestones (confetti, bouncing checkmarks) — ties to SM-C2.

## Accessibility Floor

Behavioral. Visual contrast lives in `DESIGN.md`.

- WCAG 2.2 AA floor across the website (consumer-stakes product).
- Every chart (energy arc, trend view) ships a text-equivalent via `{components.chart-summary}` (see Component Patterns) — the UJ-1 "genre gap" climax has to be reachable without seeing the chart; it's the product's core value moment, not decoration.
- Segment-boundary dragging has a full keyboard path (see Interaction Primitives) — dragging is never the only way to do it.
- Tray icon states (FR-5) carry a text label/tooltip, not color/glyph alone.
- Focus rings use the `{colors.primary}` glow per DESIGN.md — confirm AA contrast against both `{colors.surface}` and `{colors.surface-container}` before shipping (the glow is specified at ~20% opacity, worth a dedicated check).

## Responsive & Platform

| Surface / Breakpoint | Behavior |
|---|---|
| Desktop/laptop (primary — UJ-1's "laptop over breakfast") | Full layout, fixed centered grid (`{spacing.container-max}`, 1100px). |
| Tablet/phone (secondary — read + light edit) | Fluid layout, nav stays bottom-anchored (thumb reach); segment dragging becomes touch-drag; energy arc drops hover states in favor of tap. |
| Native agent (tray/menu-bar) | macOS menu-bar / Windows tray icon only, one settings panel — never a full app window, never mirrors website UI (FR-5). |

## Inspiration & Anti-patterns

- **Lifted from ssscript.app / saracajner.com / bymonolog.com:** restrained, purposeful scroll motion for the Landing hero only — "intention over speed," not spectacle.
- **Lifted from neko.engineering / flowty.co:** the distinctive floating menu placement — became `{components.nav-floating}` in DESIGN.md, the product's signature chrome.
- **Rejected — leaderboard/ranking visual language** anywhere (vs.-others bars, badges, medals) — contradicts PRD §6.2/Vision's self-baseline-only framing, even with no social layer to rank against yet.
- **Rejected — streak counters / gamified-habit visuals** — SM-C2 explicitly counter-metrics this; reflection engagement has to read as genuine.
- **Rejected — fitness-app celebratory animations** on stat improvement — mood target is "artist's practice journal," not "workout complete!"

## Key Flows

### UJ-1 — Morning after (Mara, club DJ, the morning after a gig)

1. Mara opens Curfew on her laptop over coffee, already logged in.
2. Dashboard shows a quiet "New set detected — add details?" banner; she taps Skip.
3. She clicks into last night's set.
4. Reviews the stat block — top tracks, BPM distribution, Camelot mixing, energy arc.
5. Back on Dashboard, notices a forgotten-download nudge for a track she meant to play.
6. Returns to the set's genre breakdown — EDM is under-represented for that venue.

**Climax:** the genre chart's gap reads as a concrete "do differently" note, not a report card — the one moment worth the single lavender highlight per screen.
**Resolution:** leaves with two actionable notes — a forgotten track, a genre-mix adjustment — no further in-app action required.

### UJ-3 — First-time setup (Devon, signing up and installing the agent for the first time)

1. Devon lands on curfew.app, signs up via Google (one tap — could equally be Apple, passkey, or email + password).
2. Google skips straight past the manual name/email fields; Devon adds a phone number to finish the account (the one field Google didn't provide).
3. Curfew prompts Devon to download the local agent — the account alone can't do anything yet.
4. Devon runs the installer; agent auto-launches into the tray (idle icon).
5. Agent scans default paths + connected drives, finds a Serato folder, surfaces a one-time confirmation.
6. Devon confirms (or corrects the path via the same prompt / tray settings).
7. Plays their next gig normally — no in-app action.
8. Opens curfew.app the next morning; the set is already on the Dashboard.

**Climax:** the set already being there — zero-setup proving itself on the first real use.
**Resolution:** trust that the tool works invisibly going forward; tray icon settles to idle/synced.
**Edge case:** wrong/no path auto-detected — Devon corrects manually via tray Settings; the manual-path field needs to be one click from the tray icon, since this is the one real early-friction point.

### UJ-5 — Bedroom DJ, solo (Kai, hobbyist, no scene yet)

1. Opens Dashboard after a practice session — synced like any set.
2. Navigates to Style Evolution via the floating nav.
3. Sees BPM range widened over the past month.

**Climax:** the trend line is proof of progress with zero audience — the moment that tests "personal value stands alone" directly.
**Resolution:** motivated to keep syncing sets on their own terms.

### UJ-6 — Library accountability (Theo, prepping for an upcoming gig)

1. Opens Library Utilization ahead of a gig via the floating nav.
2. Checks the aging-shelf list, sorted by days-unplayed.
3. Sees several 3+-month untouched tracks.
4. Uses the row-level "add to prep crate" action on a few, specifically to break the streak.

**Climax:** the list directly changes what Theo digs for before the gig — behavior change, not just a report.
**Resolution:** higher utilization of their own purchased library, visible next time the conversion-rate meter updates.

---

UJ-7 (wedding client-request mismatch) has no flow above — a deliberate scope-down, not an oversight: it only realizes FR-6 and FR-16, both already exercised by UJ-1's flow and the generic `Layer 2 form` Component Pattern row, and it introduces no new screen, component, or interaction worth a dedicated walkthrough.
