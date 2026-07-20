# Curfew — Stitch Design Brief

Paste everything below into stitch.withgoogle.com. Save whatever it outputs (DESIGN.md, per-screen HTML, images) into `imports/` in this workspace, then come back and we'll reconcile it into DESIGN.md.

---

## Product

Curfew is a Serato-linked reflection platform for club DJs. A lightweight desktop agent silently detects and parses a DJ's Serato session/library data after a gig — no in-the-moment input required. The DJ experiences everything else on Curfew's website: a personal dashboard that frames every stat against their own baseline ("compared to what?"), never coach-graded, never framed as "best" or "winner" — descriptive and comparative to self, not competitive.

This design round is Phase 1 only: the solo reflection layer. No social/feed features yet.

## Audience

Primary: working, gigging club DJs — practicing musicians who care about their evolving craft. Secondary: bedroom/hobbyist DJs building the habit alone, with no scene yet. Mood should read as serious about craft, not gamified or flashy — closer to an artist's practice journal than a fitness-app leaderboard.

## Brand personality / mood

- Dark-leaning as the primary theme — explicitly not white/bright as the base surface
- Bold but restrained: simple, elegant, unique — not maximalist
- One consistent visual theme carried through every single screen, not per-page variation
- Motion/scroll should feel purposeful and considered, not spectacle for its own sake

## Direct references (for feel, not literal copying)

- ssscript.app — the animation and overall theme
- neko.engineering — the menu style and placement
- flowty.co — the menu and scroll animation
- saracajner.com — the bold-but-simple hero on first load, and the easy-to-follow unique scroll
- bymonolog.com — everything, especially the color handling and overall flow

## Screens to generate (Phase 1 scope only)

1. **Landing / marketing homepage** (logged-out) — hero introducing Curfew's "compared to what?" reflection concept
2. **Signup** — first name, last name, email, phone number, password, plus a passkey/biometric (WebAuthn) option
3. **Login** — overlaid on the homepage per product vision, not a separate blank page
4. **Dashboard** (home, logged in) — recent sets list, trend snapshots, a "new set detected" nudge state
5. **Set Detail** — one set's stats: top tracks/artists, genre breakdown, BPM distribution, key/Camelot-wheel mixing stats, and an "energy arc" chart (BPM plotted against time — a pulse/waveform of the set)
6. **Style Evolution** — month-over-month trend charts: BPM range, genre diversity, key usage
7. **Library Utilization** — conversion rate (bought vs. played), aging shelf (untouched 3+ months), time-to-first-play
8. **Profile/Settings** — account info, Instagram handle, privacy controls

## Tone constraints (carry into any UI copy Stitch generates)

No "best," "winner," or ranking/leaderboard language anywhere. Never phrase a stat as a grade. Always frame against the DJ's own past, not against other DJs.

## Deliverables wanted

Design tokens (colors, typography, spacing, corner radii) plus per-screen HTML for the 8 screens above.
