# Inspiration — Spotlight / Glow Card (21st.dev)

**Sent by Arjun:** 2026-07-28 · **For:** Epic 3 UI

## Why Arjun liked it (verbatim)
> "i like the ominous feel and the transition between components, something i think
> we'll have a lot of when mouse hovers from graph, to chart, to statistic."

## Signal extracted
- **Ominous / nocturnal mood** — aligns with Obsidian's "After-Hours Archive."
- **Cursor-follow spotlight that moves _between_ modules** — the interaction he wants
  as the mouse travels graph → chart → statistic. This is the part to keep.

## Fit against locked DESIGN.md
- ✅ Mood: bullseye for the dark, introspective direction.
- ⚠️ **Color**: the source component hue-shifts across blue/purple/green/red/orange
  (`--hue = base + xp*spread`). DESIGN.md rule: _"Don't introduce … bright/saturated
  colors outside the single primary accent (Ice Cyan)."_ → adopt the interaction,
  recolor to a single Ice Cyan (`--color-primary #a5dcea`) spotlight.
- ⚠️ **Depth**: DESIGN.md gets depth from tonal layering + hairline borders, and says
  _"Only the actively-focused element gets a glow: a soft blur at low opacity (~20%)
  in primary."_ The moving spotlight is a natural **evolution of that focus-glow**,
  scoped to Ice Cyan and kept subtle.

## Reference component (verbatim, for Epic 3 integration)
Target stack assumed by the prompt: shadcn structure + Tailwind + TS. NOTE: `web/`
has TS + Next 16 but **no Tailwind and no shadcn yet** — Epic 3 will add them.

```tsx
// spotlight-card.tsx
import React, { useEffect, useRef, ReactNode } from 'react';

interface GlowCardProps {
  children: ReactNode;
  className?: string;
  glowColor?: 'blue' | 'purple' | 'green' | 'red' | 'orange';
  size?: 'sm' | 'md' | 'lg';
  width?: string | number;
  height?: string | number;
  customSize?: boolean; // When true, ignores size prop and uses width/height or className
}

const glowColorMap = {
  blue: { base: 220, spread: 200 },
  purple: { base: 280, spread: 300 },
  green: { base: 120, spread: 200 },
  red: { base: 0, spread: 200 },
  orange: { base: 30, spread: 200 }
};

const sizeMap = { sm: 'w-48 h-64', md: 'w-64 h-80', lg: 'w-80 h-96' };

// ... pointermove handler sets --x/--xp/--y/--yp on the card; a radial-gradient
// spotlight tracks the cursor, and ::before/::after paint a glowing border via
// mask-composite. Full source preserved in the original 21st.dev prompt Arjun sent
// (2026-07-28). Key mechanic: document-level pointermove → CSS custom props →
// radial-gradient spotlight + masked glowing border.
```

**Curfew adaptation note:** the important mechanic is the document-level
`pointermove` → CSS-custom-prop → radial-gradient spotlight. That single mechanic can
drive the "focus travels between data modules" behavior on the dashboard — recolored
to Ice Cyan, opacity kept low, per DESIGN.md's focus-glow rule.
