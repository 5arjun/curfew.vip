---
name: Curfew
colors:
  surface: '#121415'
  surface-dim: '#121415'
  surface-bright: '#38393a'
  surface-container-lowest: '#0c0e0f'
  surface-container-low: '#1a1c1d'
  surface-container: '#1e2021'
  surface-container-high: '#282a2b'
  surface-container-highest: '#333536'
  on-surface: '#e2e2e3'
  on-surface-variant: '#cac4d5'
  inverse-surface: '#e2e2e3'
  inverse-on-surface: '#2f3132'
  outline: '#938e9e'
  outline-variant: '#484553'
  surface-tint: '#cbbeff'
  primary: '#cbbeff'
  on-primary: '#330b91'
  primary-container: '#9d85ff'
  on-primary-container: '#330a90'
  inverse-primary: '#6349c0'
  secondary: '#c8c6c7'
  on-secondary: '#303031'
  secondary-container: '#49494a'
  on-secondary-container: '#bab8b9'
  tertiary: '#c8c6c8'
  on-tertiary: '#303032'
  tertiary-container: '#989799'
  on-tertiary-container: '#303032'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e7deff'
  primary-fixed-dim: '#cbbeff'
  on-primary-fixed: '#1e0061'
  on-primary-fixed-variant: '#4a2ea7'
  secondary-fixed: '#e5e2e3'
  secondary-fixed-dim: '#c8c6c7'
  on-secondary-fixed: '#1b1b1c'
  on-secondary-fixed-variant: '#474647'
  tertiary-fixed: '#e4e2e4'
  tertiary-fixed-dim: '#c8c6c8'
  on-tertiary-fixed: '#1b1b1d'
  on-tertiary-fixed-variant: '#474649'
  background: '#121415'
  on-background: '#e2e2e3'
  surface-variant: '#333536'
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
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  xxl: 80px
  container-max: 1100px
  gutter: 24px
---

## Brand & Style

The design system is built on the narrative of the "After-Hours Archive"—a private, dignified space for DJs to deconstruct their craft away from the noise of the booth. The brand personality is nocturnal, introspective, and meticulously engineered, avoiding the frenetic energy of nightlife in favor of the quiet clarity that follows it.

The visual style is a blend of **Technical Minimalism** and **Editorial Craft**. It draws inspiration from hardware interfaces and architectural blueprints, emphasizing structural integrity and functional elegance. Every element serves as a container for reflection, ensuring the UI never competes with the artist’s thoughts. There is a total absence of competitive social cues; the system is designed for a "dialogue with the self."

## Colors

The palette is rooted in an "Obsidian" ecosystem. The background is not a pure black, but a deep charcoal that retains depth and prevents eye strain during late-night usage. 

- **Primary (Electric Lavender):** A muted, sophisticated purple used sparingly for active states and critical path actions. It represents the "spark" of an idea.
- **Surface Tiers:** `secondary` and `tertiary` define the physical layers of the application, moving from deep matte to slightly lighter greys to denote hierarchy.
- **Typography:** High-contrast off-white (`neutral`) ensures absolute legibility, while secondary text uses mid-range greys to recede into the background.
- **Functional Accents:** Success and error states are de-saturated to maintain the restrained aesthetic, using sage greens and dusty oxides rather than bright signals.

## Typography

The typographic strategy balances raw technicality with premium editorial standards.

- **Headlines:** Use **Hanken Grotesk** for a sharp, contemporary feel. Tight letter-spacing and substantial weight give the "Curfew" identity its authority.
- **Body:** **Inter** provides a neutral, systematic foundation for long-form reflection and set-list notes.
- **Labels & Metadata:** **Geist** (Monospaced) is used for timestamps, BPMs, and technical data. This reinforces the "engineered" feel of the platform, treating data as a modular component.
- **Hierarchy:** Use large scale differences rather than color to denote importance. All headers should be high-contrast white, while body text can lean toward 80% opacity.

## Layout & Spacing

This design system employs a **Fixed Centered Grid** for desktop to evoke the feeling of a physical journal or a dedicated workstation. On smaller viewports, it transitions to a fluid model with generous safe areas.

- **Rhythm:** A strict 4px baseline grid ensures vertical harmony.
- **Whitespace:** Emphasize large "Macro-spacing" (`xl` and `xxl`) between sections to provide breathing room for reflection. Components themselves should remain "Micro-spaced" and compact.
- **Alignment:** Content is primarily left-aligned to mirror the western reading pattern of a diary. Centered layouts are reserved exclusively for the empty states and entry points.

## Elevation & Depth

The system rejects traditional heavy shadows in favor of **Tonal Layering** and **Low-Contrast Outlines**.

- **Surfaces:** Depth is achieved by "lifting" elements with subtle color shifts. A base level is `#121212`, a card is `#1A1A1B`, and a hover state is `#242426`.
- **Borders:** Instead of shadows, use 1px solid borders in a slightly lighter shade than the background (`#2E2E30`). This creates a "blueprint" feel where every module is clearly defined but flat.
- **Focus States:** Only the active element should exhibit a subtle glow (2px blur) using the primary lavender color at low opacity (20%).

## Shapes

The shape language is "Soft-Industrial." We avoid the playfulness of hyper-rounded corners to maintain a professional, high-end hardware aesthetic.

- **Standard Radius:** 4px (`rounded-sm`) for inputs and small cards.
- **Large Radius:** 8px (`rounded-lg`) for main content containers.
- **Interactive:** Buttons use the standard 4px radius. Avoid pill shapes entirely, as they lean too close to consumer social media apps.

## Components

### Buttons
Primary buttons are solid charcoal with white text, using a subtle primary-colored border. Secondary buttons are text-only with a Geist-mono label. No gradients or heavy rounding.

### Input Fields
Inputs are "Ghost" style—transparent backgrounds with a bottom-border only, or a very subtle 4-sided stroke. Labels always use `label-sm` (Geist) and sit above the input area.

### Cards (Reflections)
Cards are the primary vessel for set-list data. They feature a 1px border and no shadow. The header of the card uses the mono font for the date/time of the set.

### Chips (Tags)
Tags represent genres or "moods" of a set. They are rectangular (0px or 2px radius) with a dark fill and mid-grey text. They should feel like labels on a vinyl sleeve.

### Set-List Modules
A specialized component for tracking tracks. It uses a vertical line (the "Timeline") to connect entries, emphasizing the flow and craft of the transition rather than the individual song.

### Progress Indicators
Instead of bars, use incremental "pips" (small squares) to show set completion or energy levels. This mimics hardware LED meters.