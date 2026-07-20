---
name: Curfew
description: After-hours reflection archive for club DJs — dark, technical-editorial, a private console for reviewing your own craft.
status: final
sources:
  - "{planning_artifacts}/prds/prd-name-pending-2026-07-19/prd.md"
  - "{planning_artifacts}/briefs/brief-name-pending-2026-07-19/brief.md"
  - "imports/stitch_curfew_dj_reflection_platform/ (Google Stitch design handoff, 6 of 8 Phase-1 screens rendered + generated DESIGN.md)"
updated: 2026-07-20
colors:
  background: '#121415'
  on-background: '#e2e2e3'
  surface: '#121415'
  surface-dim: '#121415'
  surface-bright: '#38393a'
  surface-container-lowest: '#0c0e0f'
  surface-container-low: '#1a1c1d'
  surface-container: '#1e2021'
  surface-container-high: '#282a2b'
  surface-container-highest: '#333536'
  surface-variant: '#333536'
  surface-tint: '#cbbeff'
  on-surface: '#e2e2e3'
  on-surface-variant: '#cac4d5'
  inverse-surface: '#e2e2e3'
  inverse-on-surface: '#2f3132'
  outline: '#938e9e'
  outline-variant: '#484553'
  primary: '#cbbeff'
  on-primary: '#330b91'
  primary-container: '#9d85ff'
  on-primary-container: '#330a90'
  primary-fixed: '#e7deff'
  primary-fixed-dim: '#cbbeff'
  on-primary-fixed: '#1e0061'
  on-primary-fixed-variant: '#4a2ea7'
  inverse-primary: '#6349c0'
  secondary: '#c8c6c7'
  on-secondary: '#303031'
  secondary-container: '#49494a'
  on-secondary-container: '#bab8b9'
  secondary-fixed: '#e5e2e3'
  secondary-fixed-dim: '#c8c6c7'
  on-secondary-fixed: '#1b1b1c'
  on-secondary-fixed-variant: '#474647'
  tertiary: '#c8c6c8'
  on-tertiary: '#303032'
  tertiary-container: '#989799'
  on-tertiary-container: '#303032'
  tertiary-fixed: '#e4e2e4'
  tertiary-fixed-dim: '#c8c6c8'
  on-tertiary-fixed: '#1b1b1d'
  on-tertiary-fixed-variant: '#474649'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
typography:
  display-lg:
    fontFamily: Hanken Grotesk
    fontSize: 48px
    fontWeight: '600'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '500'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  label-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.0'
    letterSpacing: 0.05em
  mono-data:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.4'
rounded:
  sm: 0.125rem
  lg: 0.25rem
  xl: 0.5rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  xxl: 80px
  gutter: 24px
  container-max: 1100px
components:
  nav-floating:
    shape: '{rounded.full}'
    surface: '{colors.surface-container}'
    opacity: 0.9
    border: '1px solid {colors.outline-variant}'
    blur: backdrop-blur-xl
    padding: '{spacing.sm} {spacing.lg}'
    active-item-bg: '{colors.primary}'
    active-item-text: '{colors.on-primary-container}'
  button-primary:
    shape: '{rounded.lg}'
    bg: '{colors.on-surface}'
    text: '{colors.surface}'
    border: '1px solid {colors.primary}/20'
    hover-bg: '{colors.primary}'
    hover-text: '{colors.on-primary-container}'
    label-font: '{typography.label-sm}'
  button-secondary:
    shape: '{rounded.lg}'
    bg: transparent
    text: '{colors.outline}'
    hover-text: '{colors.on-surface}'
    label-font: '{typography.mono-data}'
  input-field:
    style: ghost — transparent fill, bottom-border only
    border: '1px solid {colors.outline-variant}'
    focus-border: '{colors.primary}'
    label-font: '{typography.label-sm}'
    value-font: '{typography.mono-data}'
  card-reflection:
    shape: '{rounded.lg}'
    border: '1px solid {colors.outline-variant}'
    bg: '{colors.surface-container}'
    shadow: none
    header-font: '{typography.mono-data}'
  chip:
    shape: '{rounded.sm}'
    bg: '{colors.surface-container-high}'
    text: '{colors.on-surface-variant}'
    font: '{typography.label-sm}'
  set-list-module:
    connector: 1px vertical line in '{colors.outline-variant}', active node '{colors.primary}'
    timestamp-font: '{typography.mono-data}'
  progress-pip:
    shape: small square, '{rounded.sm}'
    filled: '{colors.primary}'
    empty: '{colors.surface-container-high}'
  avatar:
    shape: '{rounded.full}'
    border: '1px solid {colors.outline-variant}'
  energy-arc-chart:
    line: '{colors.primary}', 2px stroke, no fill
    baseline: dashed '{colors.outline-variant}', 1px stroke
    annotation-label: '{typography.label-sm}' in '{colors.primary}', uppercase
    annotation-detail: '{typography.mono-data}' in '{colors.outline}', italic
  chart-summary:
    shape: none — plain text row, no border/bg
    text: '{colors.on-surface-variant}'
    font: '{typography.body-md}'
  google-signin-button:
    shape: '{rounded.lg}'
    fill: near-black, matching '{colors.surface-container-high}'
    border: 1px light-grey (Google spec, not a Curfew token)
    text: white "Sign in with Google", Google-mandated system sans (not Inter)
    logo: Google's official full-color "G" logomark
  apple-signin-button:
    shape: '{rounded.lg}'
    fill: black (Apple spec, not a Curfew token)
    text: white "Sign in with Apple", Apple-mandated system font (not Hanken Grotesk/Inter)
    logo: Apple's official white Apple logomark
  pricing-card:
    shape: '{rounded.lg}'
    border: '1px solid {colors.outline-variant}'
    bg: '{colors.surface-container}'
    price-font: '{typography.display-lg}'
    price-unit-font: '{typography.mono-data}'
    cta: '{components.button-primary}'
---

## Brand & Style

Curfew's design system is built on the narrative of the **After-Hours Archive** — a private, dignified space for DJs to deconstruct their own craft away from the noise of the booth. The personality is nocturnal, introspective, and meticulously engineered: it deliberately avoids the frenetic energy of nightlife in favor of the quiet clarity that follows it. Copy leans into this directly — "Initialize Session," "Archive Insight," "Session: Initializing" — a technical/console voice, not a diary voice. This is a conscious choice (confirmed over a warmer alternative): Curfew reads like reviewing a private studio log, not journaling.

The visual style blends **Technical Minimalism** with **Editorial Craft**, drawing on hardware interfaces and architectural blueprints — structural integrity, functional elegance. Every element is a container for reflection; the UI never competes with the DJ's own thoughts. There is a total absence of competitive social cues — no "best," "winner," or ranking language, ever (carried from PRD §6.2) — the system is built for a dialogue with the self, not a performance for an audience.

## Colors

The palette is a dark **"Obsidian"** ecosystem, structured as a Material Design 3 tonal system (hence the `surface`/`on-surface`/`-container` naming — inherited convention, not a UI-library dependency). Background is deep charcoal (`{colors.background}`, `#121415`) rather than true black, retaining depth and reducing eye strain during late-night use — this was an explicit, non-negotiable starting constraint (never white/bright as the base surface).

- **Primary — Electric Lavender** (`{colors.primary}`, `#cbbeff`, with `{colors.primary-container}` `#9d85ff` for stronger fills): used sparingly, for active nav states, focus glows, and the one or two "spark of an idea" moments per screen. It is not a decorative color — restraint is the point.
- **Surface tiers** (`surface-container-lowest` → `surface-container-highest`): five steps of tonal elevation used to denote hierarchy through subtle value shifts rather than shadow.
- **Typography colors**: `{colors.on-surface}` (near-white, `#e2e2e3`) for primary text, `{colors.on-surface-variant}` and `{colors.outline}` for secondary/receding text.
- **Functional accents**: `{colors.error}` / `{colors.error-container}` are desaturated dusty-rose tones, not alarm-red — errors stay in register with the restrained palette rather than breaking it.
- **Inherited, not yet in active use**: the `secondary`/`tertiary` families, most `*-fixed`/`*-fixed-dim` variants, `inverse-*`, `surface-dim`/`surface-bright`/`surface-variant`, and `background`/`on-background` are carried over wholesale from the Stitch M3 export scaffolding — not referenced in this prose or any Components row today. Left in frontmatter as available scaffolding rather than pruned; treat as reserved-for-later, not dead weight.

Where a Stitch import render states a raw value (e.g. a literal hex) that diverges from a token defined here, **this file wins** — the imports are reference renders, not the source of truth.

## Typography

- **Headlines** — `{typography.display-lg}` / `{typography.headline-md}`, set in **Hanken Grotesk**. Tight letter-spacing (`-0.02em` at display scale) and substantial weight (600) give the CURFEW wordmark and section headers their authority. Applies to set titles too (e.g. a set name like "Warehouse Reflex [002]") — an early Stitch render showed this falling back to a system serif due to a font-load race in that specific capture; the intended and correct spec is Hanken Grotesk everywhere headlines appear, no separate serif face.
- **Body** — `{typography.body-lg}` / `{typography.body-md}`, **Inter**. Neutral, systematic, for longer reflection text and set notes.
- **Labels & data** — `{typography.label-sm}` / `{typography.mono-data}`, **Geist** (monospaced for the data role). Used for timestamps, BPM values, session IDs, stat codes (`CR-01`, `AS-04`) — reinforces the "engineered" feel by treating data as a modular, technical component distinct from prose.
- **Hierarchy** is carried by scale and weight, not color. Headers are always high-contrast `{colors.on-surface}`; body text may recede to ~80% opacity.

## Layout & Spacing

A **fixed centered grid** on desktop (`{spacing.container-max}`, 1100px) evokes a dedicated workstation rather than an infinite feed; fluid with generous safe-areas on smaller viewports.

- **Rhythm**: strict 4px baseline (`{spacing.unit}`).
- **Whitespace**: macro-spacing (`{spacing.xl}`, `{spacing.xxl}`) separates sections generously — room to sit with one stat before the next. Components themselves stay tightly, "micro"-spaced.
- **Alignment**: left-aligned by default (mirrors a reading pattern, not a centered/social-feed pattern). Centered layouts are reserved for empty states and entry points (login/signup) only.

## Elevation & Depth

No heavy drop shadows. Depth comes from **tonal layering** plus **low-contrast hairline borders**.

- Base surface is `{colors.surface}`; a raised card is `{colors.surface-container}`; a hover/highest state is `{colors.surface-container-high}` or `{colors.surface-container-highest}`.
- Borders use `{colors.outline-variant}` at roughly 30% opacity — a shade barely lighter than the surface behind it, giving every module a defined-but-flat "blueprint" quality rather than a floating-card quality.
- Only the actively-focused element gets a glow: a soft blur at low opacity (~20%) in `{colors.primary}`.

## Shapes

**Soft-Industrial.** Two distinct radius behaviors, used deliberately, not interchangeably:

- **Structural elements** (buttons, inputs, cards, chips) use the small scale — `{rounded.sm}` through `{rounded.xl}` (2px–8px). No pill buttons: rounding stays tight and professional, closer to hardware UI than a consumer social app.
- **`{rounded.full}`** (true 9999px stadium/circle) is reserved exclusively for the **floating nav** and **circular elements** (avatar, small status dots). This is the one deliberately "soft" shape in the system, and it's load-bearing for the product's identity — it's the distinctive menu treatment the visual direction was built around. Don't dilute it by using full-round anywhere else, and don't under-round it either — the exported Stitch tokens briefly mis-set `full` to 12px, which would make the nav read as a rounded rectangle instead of a true pill; the spec value above (9999px) is the corrected, intended one.

## Components

### Floating Nav (`{components.nav-floating}`)
The signature navigation pattern — a pill-shaped bar (`{rounded.full}`), fixed to the bottom center of the viewport, glassy (`backdrop-blur-xl` over `{colors.surface-container}` at 90% opacity, hairline `{colors.outline-variant}` border). Contains a menu trigger (opens an upward popover on hover/tap), primary section links, and the active-state item filled solid in `{colors.primary}`. This is the "distinctive menu placement" the whole visual direction was anchored on — treat it as the product's signature chrome, not a generic tab bar.

### Avatar (`{components.avatar}`)
`{rounded.full}` circular treatment, 1px `{colors.outline-variant}` border — one of the deliberate uses of full-round shape in the system (alongside the floating nav and small status dots, see `Shapes`). Used as the Profile/Settings nav trigger; no fill or background beyond the image itself.

### Buttons
Primary: solid `{colors.on-surface}` fill, `{colors.surface}` text, subtle `{colors.primary}`-tinted border; inverts to `{colors.primary}` fill on hover. Secondary: text-only, Geist-mono label, no fill. Small `{rounded.lg}` radius throughout — no gradients, no pill buttons.

### Input Fields
"Ghost" style — transparent background, bottom-border only (or a very subtle full stroke for denser forms). Labels always `{typography.label-sm}` (Geist), positioned above the field. Values render in `{typography.mono-data}` — inputs read like data entry, not a generic web form.

### Biometric Anchor
The WebAuthn/passkey option on the auth form (Login/Signup), sourced from `imports/stitch_curfew_dj_reflection_platform/curfew_signup_dark_theme/code.html` (lines 147–161). A bordered row — `{colors.surface-container-low}` fill, 1px `{colors.outline-variant}`-at-30%-opacity border, hover fills to `{colors.surface-container-high}`. Left: a `{rounded.full}` badge (`{colors.primary}`-at-20%-opacity ring) holding a filled fingerprint icon in `{colors.primary}`. Two-line label: "Enable Passkey" in `{typography.label-sm}` / `{colors.on-surface}`, "Biometric bypass" beneath it, smaller, uppercase, in `{colors.outline}`. Right: a small circular radio indicator — `{colors.outline-variant}` ring at rest, fills solid `{colors.primary}` on hover.

### Google Sign-In Button (`{components.google-signin-button}`)
Alternate sign-in method alongside Biometric Anchor, above. Google's officially supported **dark/filled** button theme, not the white/light variant — sits naturally in Curfew's dark UI without introducing a jarring bright rectangle. Near-black fill matching `{colors.surface-container-high}`, thin light-grey border, Google's full-color "G" logomark, white "Sign in with Google" label. `{rounded.lg}` corner radius — Google's guidelines permit matching the host app's radius, so shape stays in Curfew's system even though color/logo don't. `[ASSUMPTION]` sourced from Google's Identity Services branding guidelines as generally known — verify against Google's current published spec before implementation, brand guidelines get revised.

### Apple Sign-In Button (`{components.apple-signin-button}`)
Alternate sign-in method alongside Biometric Anchor and the Google button, above. Apple's officially supported **black** button variant (Apple also offers white/outline for light contexts — not used here, matches Curfew's dark theme). Black fill, white Apple logomark, "Sign in with Apple" label in Apple's mandated system font rendering, not Hanken Grotesk/Inter. `{rounded.lg}` corner radius — Apple's spec permits matching host-app radius within their allowed range. `[ASSUMPTION]` verify against Apple's current Human Interface Guidelines before implementation.

### Cards (Reflections)
The primary vessel for set data. 1px `{colors.outline-variant}` border, no shadow, `{rounded.lg}` corners. Card header (date/session ID) always in `{typography.mono-data}`.

### New-Set Nudge
The Dashboard's "New set detected" banner, sourced from `imports/stitch_curfew_dj_reflection_platform/curfew_dashboard_sticky_nav/code.html` (lines 99–120). Surface is `{components.card-reflection}`-tier: `{colors.surface-container-low}` fill, but with a `{colors.primary}`-at-20%-opacity border in place of the standard `{colors.outline-variant}` hairline, marking it as active/live rather than a static card. A small pulsing `{colors.primary}` status dot plus a `{typography.label-sm}` "NEW SET DETECTED" label (uppercase, `{colors.primary}`) carry the emphasis — explicitly **no** `{colors.error}` or any alarm-family color anywhere in this treatment, per `Voice and Tone`'s "quiet, declinable" requirement; this must never read as a warning or a push-style alert. Buttons: accept action is `{colors.primary}`-filled with `{colors.on-primary-fixed}` text; dismiss/skip is bordered `{colors.outline-variant}` with `{colors.outline}` text, no fill — same size and visual weight, so neither button pressures the other.

### Chips (Tags)
Genre/mood tags. Small radius (`{rounded.sm}`, near-rectangular — "label on a vinyl sleeve," not a rounded consumer-app pill), dark fill (`{colors.surface-container-high}`), mid-grey text.

### Set-List Module
Tracks connected by a vertical timeline line (`{colors.outline-variant}`, active node in `{colors.primary}`) — emphasizes flow/sequence over any single track.

### Progress Indicators
Small filled/empty squares ("pips," hardware-LED-meter style) rather than progress bars — used for conversion rate, harmonic alignment, etc.

### Energy Arc / Trend Chart (`{components.energy-arc-chart}`)
Shared line-chart treatment for the energy arc (Set Detail) and the trend chart (Style Evolution) — same rendering language per `{components.chart-summary}`'s "one shared utility, not bespoke per screen" precedent. Sourced from the Set Detail energy-arc render (`imports/stitch_curfew_dj_reflection_platform/curfew_set_detail_sticky_nav/code.html`, lines 186–198). Line: `{colors.primary}`, 2px stroke, no fill under the curve. Baseline/comparison reference: dashed `{colors.outline-variant}`, 1px stroke, flat behind the line. Point annotation (hover/tap): a vertical `{colors.primary}`-at-40%-opacity divider marks the point; label line in `{typography.label-sm}`, `{colors.primary}`, uppercase (e.g. "Energy peak at 02:15"); detail line beneath it in `{typography.mono-data}`, `{colors.outline}`, italic (e.g. "Higher than typical peak."). Falls through to `{components.chart-summary}` on render failure, per the existing fallback rule.

### Chart Summary (`{components.chart-summary}`)
A plain-language caption line rendered directly beneath a chart (energy arc, trend view) — no border, no fill, no card treatment, just text sitting flush under the chart. Set in `{typography.body-md}`, colored `{colors.on-surface-variant}` to stay secondary to the chart itself rather than compete with it. Same treatment doubles as the render-failure fallback: when a chart fails to load, this line stands alone in its place.

### Pricing Card (`{components.pricing-card}`)
The Pricing page's single vessel — one card, not a multi-tier comparison grid, since V1 ships one plan (PRD §7, $6/mo). Same construction as `{components.card-reflection}`: `{colors.surface-container}` fill, 1px `{colors.outline-variant}` border, `{rounded.lg}` corners, no shadow — the system's standard "module" treatment, not a special promotional skin. Price renders large in `{typography.display-lg}` (`{colors.on-surface}`); the "/month" unit sits beside it in `{typography.mono-data}` at reduced opacity, consistent with how the system already treats data (timestamps, BPM, stat codes) as distinct from prose. CTA button is `{components.button-primary}` — no bespoke pricing-page button style. No ribbon, no badge, no strikethrough "was $X" framing — restraint carries over from the rest of the system; a single honest number, not a sales page.

## Do's and Don'ts

- **Do** reserve `{rounded.full}` for the floating nav and circular elements only. **Don't** apply full/pill rounding to buttons or cards — that's the one shape rule the whole system hangs on.
- **Do** keep the archive/console voice in UI copy (Initialize, Archive, Session). **Don't** let it drift into anything that reads as competitive, graded, or ranked — "compared to your own baseline" only, never "best" or "winner" (PRD §6.2, non-negotiable across both phases).
- **Do** use tonal surface shifts and hairline borders for hierarchy. **Don't** introduce drop shadows or bright/saturated colors outside the single lavender accent.
- **Do** keep data (BPM, timestamps, session IDs, stat codes) in `{typography.mono-data}`. **Don't** set prose or headlines in the mono face — it's a data signal, and loses meaning if overused.
- **Do** treat `{colors.primary}` as scarce — active states, focus glow, key data highlights. **Don't** use it as a general decorative or brand-wash color.
- **Do** let the Google and Apple sign-in buttons use their own mandated colors/logo lockups — the one deliberate exception to Curfew's palette, required for platform compliance, not a design lapse. **Don't** reskin them in `{colors.primary}` or any Curfew brand color, and don't touch the logo lockup.
