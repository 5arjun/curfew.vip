# Dashboard redesign — inspiration references (from Arjun, 2026-08-03)

Source: `~/Downloads/inspo.docx`. These are MUST-incorporate references. The code
here is verbatim from Arjun's file — follow it, don't loosely adapt. When we
deviate (e.g. tokenizing colors, adapting to `web/` structure), the deviation
gets called out explicitly in PLAN.md, never done silently.

| File | What it is | Role in the redesign |
|---|---|---|
| `silk-background.md` | React Bits `Silk` shader background | Page background |
| `liquid-metal-button.tsx` | `@paper-design/shaders` liquid-metal button (3D layered, ripple, speed-reactive shader) | The liquid-metal material + interaction physics |
| `shiny-button.tsx` | CSS `@property` conic-border glint button (dots mask, shimmer, breathe) | Hover treatment for boxes/sections, possibly composed with liquid metal |
| `progressive-blur-modal.tsx` | Music-player UI: scrollable track list + in-place expanding modal + progressive frosted blur | The left-half set list + set expand interaction + signature frosted-blur effect |
| `apple-spotlight.tsx` | Apple Spotlight search (framer-motion): gooey SVG blob filter merges pill + icon buttons, spring fan-out shortcuts, morphing placeholder, layout-animated results | The spotlight search atop the set list (D6); right-side icons become sort filters (date asc/desc, length, …) |
| `glass-calendar.tsx` | GlassCalendar: frosted `bg-black/20 backdrop-blur-xl` card, horizontal scrolling day strip (hidden scrollbar), animated month name, today-dot under date, gradient selected circle | Right-side calendar (D5); today-dot repurposed as the "day has a set" blip |
| `progressive-blur-modal.css` | The full stylesheet for `progressive-blur-modal.tsx` (received 2026-08-03): 8-layer progressive backdrop-blur, house easing `cubic-bezier(.17,1,.33,1)`, background recede (scale 0.9 + blur 16px), song-modal 2× title expansion | Companion to the set-list ref — the frosted look + expand animation live here |
| `project-showcase.tsx` | Cursor-following hover preview: rAF lerp (factor 0.15) smooth-follow card, scale+fade in/out, 500ms crossfade+unblur between hovered items; rows get animated underline, slide-in arrow, bg highlight | Calendar day-hover preview (D10): floating card follows cursor showing that day's set count |

## Completeness

Reference set COMPLETE as of 2026-08-03 — all components AND the
progressive-blur-modal stylesheet are captured. All refs are from 21st.dev
(per Arjun); the music player's original is CodePen "Progressive Blur Modal"
by kiranpate1 (codepen.io/kiranpate1/pen/wBwbRBq).

Deps status (checked against `web/package.json` 2026-08-03): `@paper-design/shaders`,
`clsx`, `lucide-react`, `tailwind-merge`, `tw-animate-css`, Tailwind v4, shadcn —
all already installed. To add at dev time: the React Bits Silk component,
**framer-motion** (spotlight + calendar), and **date-fns** (calendar).
