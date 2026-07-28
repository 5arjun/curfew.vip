# Inspiration — Gradient Button (21st.dev)

**Sent by Arjun:** 2026-07-28 · **For:** Epic 3 UI

## Why Arjun liked it (verbatim)
> "I like the colors alot and how it doesn't feel overly complicated or engineered."

## Signal extracted
- **Warm, rich gradient color story** — not the current cool Ice-Cyan palette.
  - default rest: `#000` → `#08012c` (deep blue) → `#4e1e40` (plum) → `#70464e` →
    `#88394c` (wine/rose)
  - default hover: warms to `#c96287` (pink) / `#c66c64` / `#cc7d23` (amber) → black
  - variant: teal/blue `#1f3f6d` → `#469396` → `#f1ffa5` (lime highlight)
- **Restraint in feel** — animated but "not over-engineered." The polish is in the
  smooth `@property`-driven transition of gradient stops, not visual noise.

## Fit against locked DESIGN.md — ⚠️ DIRECT CONFLICT (decision needed)
DESIGN.md Buttons spec + Do's/Don'ts:
- _"Buttons … no gradients, no pill buttons."_ → gradient is explicitly excluded.
- _"Don't introduce drop shadows or bright/saturated colors outside the single
  primary accent (Ice Cyan)."_ → the warm pink/amber/teal palette is outside it.
- Current button: solid `on-surface` fill → inverts to Ice Cyan on hover.

This is the biggest tension in the set Arjun sent. It is **not** a small styling
tweak — it reopens a palette that was deliberately locked (revised 2026-07-26 to Ice
Cyan) and is enforced by `web/app/no-hardcoded-colors.test.ts`.

**Likely resolution (pending Arjun's ruling):** this expressive gradient energy lives
on the **landing / marketing register** (see ../README.md "two registers"), where
useorigin/v7labs-style expressiveness is allowed — NOT in the strict app interior.
Arjun himself flagged "landing page and components factors are different categories."

## Reference: the `@property` transition technique (worth keeping regardless)
The mechanic Arjun likes — smooth animated gradients — uses CSS `@property` typed
custom props so gradient color-stops/positions can be transitioned (normally
un-animatable). This technique is reusable for the landing surface even if these
exact colors aren't:

```css
@property --color-1 { syntax: '<color>'; initial-value: #000; inherits: false; }
/* ...--color-2..5, --pos-x/y, --spread-x/y, --stop-1..5, --border-angle... */

.gradient-button {
  background: radial-gradient(
    var(--spread-x) var(--spread-y) at var(--pos-x) var(--pos-y),
    var(--color-1) var(--stop-1), var(--color-2) var(--stop-2),
    var(--color-3) var(--stop-3), var(--color-4) var(--stop-4),
    var(--color-5) var(--stop-5));
  transition: --pos-x .5s, --pos-y .5s, --color-1 .5s /* ...all stops... */;
}
.gradient-button:hover { /* new --color-* / --pos-* / --stop-* values */ }
```
Deps: `@radix-ui/react-slot`, `class-variance-authority`. Full source preserved in the
original 21st.dev prompt Arjun sent (2026-07-28).
