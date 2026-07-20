# Curfew — Experience Draft (for Arjun's reaction, not yet EXPERIENCE.md)

> Discovery-phase draft. Grounded in PRD (Phase 1 scope, UJ-1/3/5/6), DESIGN.md (finalized token set + component list), and memlog decisions. [ASSUMPTION] tags mark calls I made without a direct source — flag any to cut or change. Nothing here is written into EXPERIENCE.md until you've reacted; it's frontmatter-only on disk right now.
>
> **Flagged for PRD sync** (UX-layer decisions that exceed current `prd.md` scope — not blocking, reconcile next time the PRD is touched): the WebAuthn/passkey signup option, and the 30-day downloaded-not-played nudge threshold.

## Foundation

Two surfaces. The primary experience is a responsive website (desktop/laptop-first — DJs review over coffee, per UJ-1 — readable down to phone width, no dedicated mobile app). The secondary surface is the local agent (Tauri/Rust, macOS + Windows): a menu-bar/tray icon plus one settings panel, never a full app window (FR-5). No inherited component library — `DESIGN.md` defines a custom token system (Material-3-style naming, not a dependency) both surfaces draw from, though the tray deliberately stays OS-native chrome rather than skinned to match. Scope is Phase 1 only (solo reflection layer) — Phase 2 surfaces (feed, profile, comparisons) are out of this pass, per PRD §9 gating.

## Information Architecture

| Surface | Reached from | Purpose |
|---|---|---|
| Landing (logged out) | curfew.app | Marketing homepage — "compared to what?" hook, entry to signup/login |
| Login / Signup | Landing (overlay) | Auth, overlaid on the homepage per product vision — never a separate blank page |
| Dashboard (home) | Nav / post-login default | Recent sets, trend snapshots, new-set-detected nudge |
| Set Detail | Dashboard → click a set | One set's stats, energy arc, segments, Layer 2 enrichment |
| Style Evolution | Nav | Month-over-month trend view |
| Library Utilization | Nav | Conversion rate, aging shelf, time-to-first-play |
| Profile / Settings | Nav (avatar) | Account info, privacy, location opt-in |
| Agent tray (native) | OS menu bar / tray icon | Sync state, Serato path override — the agent's only UI |

The floating bottom pill nav (`{components.nav-floating}`) is persistent across every logged-in website screen.

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
| Chart/data failed to render | Falls through to `{components.chart-summary}` — never a bare broken-chart icon. |

## Component Patterns

Behavioral. Visual specs live in `DESIGN.md.Components`.

| Component | Use | Behavioral rules |
|---|---|---|
| Auth form (Login/Signup) | Login / Signup, overlaid on Landing | First/last name, email, phone, password, plus a passkey/biometric (WebAuthn) option alongside the password path. `[ASSUMPTION — PRD sync owed]`: not yet in `prd.md`, Arjun's stated wish, kept in scope for ergonomics (fastest login for a DJ setting up half-awake post-gig). |
| Set card (`card-reflection`) | Dashboard recent-sets list | Click anywhere opens Set Detail. Shows date/session-id (mono), genre chips, energy-arc thumbnail. |
| New-set nudge | Dashboard, on new sync | Inline banner, not modal — "New set detected. Add details?" [Add / Skip]. Skip persists per-set, never re-prompts (FR-16 is never required). |
| Energy arc chart | Set Detail | BPM-vs-time line. Hover/tap a point shows BPM + timestamp + track. No zoom/pan in v1. |
| Segment editor | Set Detail | Suggested boundaries (FR-28) render as draggable dividers over the energy arc; drag to adjust or tap "+" for a manual one (FR-14 fallback). Confirm commits; editable anytime after. |
| Layer 2 form | Set Detail | Inline expandable form (venue, crowd size, event type, notes) below the stats — never modal, never blocking. |
| Location suggestion | Layer 2 form | Off by default. When on: suggested venue appears as an editable pre-filled field, never silently saved (FR-18). |
| Trend chart | Style Evolution | Month-over-month chart per metric (BPM range, genre diversity, key usage). Chip toggle switches metric; one chart visible at a time, not stacked small-multiples. |
| Chart summary (`chart-summary`) | Energy arc, Trend charts | Auto-generated plain-language line under every chart — min/max/direction templated into a sentence ("BPM ranged 122–128, climbing through the back half"). One shared utility, not bespoke per screen. Renders even when the chart itself fails to load, doubling as the render-failure fallback. |
| Conversion-rate meter | Library Utilization | Rendered as `{components.progress-pip}` blocks, not a bare percentage — a "how full is the meter" read. |
| Aging-shelf list | Library Utilization | Sortable by days-unplayed; each row has an explicit "add to prep crate" action (UJ-6) — the one place the product nudges toward an action, not just a report. |
| Agent tray icon | Native tray | Four states — idle / syncing / failed / drive-not-connected (FR-5); click opens the single settings panel (path override only). |

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
| [ASSUMPTION — PRD sync owed] Recently-downloaded-not-yet-played nudge | Dashboard | PRD (UJ-1 note) flags this as possibly worth a direct nudge, explicitly "not committed." Threshold: **30 days** since download, not yet played — long enough that a same-day download doesn't nag, short enough to read as distinct from the 3-month aging shelf. Quiet secondary nudge, same banner pattern as "new set detected." |
| Sync failed, retrying | Dashboard status + tray icon | "Sync interrupted. Retrying automatically." (Failure Register) — tray icon shows the failed-state glyph until it clears. |
| Format-drift, parse paused | Dashboard status + tray icon | "Format change detected — sync paused until verified." (Failure Register, FR-1 NFR) — rare, only fires on an actual Serato format change caught by golden-file regression tests. |
| Chart/data failed to render | Set Detail, Style Evolution | Falls through to `{components.chart-summary}`'s plain-language line instead of a broken-chart icon. |

## Interaction Primitives

- Floating bottom pill nav — hover (desktop) / tap (touch) opens an upward popover for secondary items; active item fills solid in `{colors.primary}`.
- Purposeful scroll-driven motion — **Landing only** (per your ssscript.app / saracajner.com / bymonolog.com picks). Logged-in dashboard surfaces stay still/functional — data shouldn't compete with its own charts.
- Drag-to-adjust segment boundaries (mouse/touch), with a keyboard equivalent: Tab to a boundary, arrow keys nudge it, Enter confirms.
- Confirm-or-edit, never silent-auto-fill — governs venue suggestion (FR-18) and first-run path detection (FR-1/UJ-3) alike: system proposes, DJ confirms or edits, nothing commits without an explicit action.
- **Banned:** gating any core stat behind an enrichment prompt (Layer 2 always skippable inline); infinite scroll on track lists (paginate / "load more"); any celebratory micro-interaction on stat milestones (confetti, bouncing checkmarks) — ties to SM-C2.

## Accessibility Floor

Behavioral. Visual contrast lives in `DESIGN.md`.

- WCAG 2.2 AA floor across the website (consumer-stakes product).
- Every chart (energy arc, trend view) ships a text-equivalent via `{components.chart-summary}` (see Component Patterns) — the UJ-1 "genre gap" climax has to be reachable without seeing the chart; it's the product's core value moment, not decoration.
- Segment-boundary dragging has a full keyboard path (see Interaction Primitives) — dragging is never the only way to do it.
- Tray icon states (FR-5) carry a text label/tooltip, not color/glyph alone.
- Focus rings use the `{colors.primary}` glow per DESIGN.md — confirm AA contrast against both `{colors.surface}` and `{colors.surface-container}` before ship (the glow is specified at ~20% opacity, worth a dedicated check).

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

### UJ-3 — First-time setup (Devon, installing the agent for the first time)

1. Devon runs the installer; agent auto-launches into the tray (idle icon).
2. Agent scans default paths + connected drives, finds a Serato folder, surfaces a one-time confirmation.
3. Devon confirms (or corrects the path via the same prompt / tray settings).
4. Plays their next gig normally — no in-app action.
5. Opens curfew.app the next morning; the set is already on the Dashboard.

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
