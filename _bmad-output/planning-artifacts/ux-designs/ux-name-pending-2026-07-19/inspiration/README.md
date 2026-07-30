# Curfew — Visual Inspiration & Direction (Epic 3 pre-work)

Captured from references Arjun sent 2026-07-28, ahead of building the front end in
Epic 3. Purpose: preserve **not just the links, but the _why_** behind each — the
signal is in what Arjun reacted to, not the artifact itself.

**This is an addendum to the source of truth, not a replacement.** The locked design
system lives in [`../DESIGN.md`](../DESIGN.md) ("Obsidian" / "After-Hours Archive"),
implemented in `web/app/tokens.css` and enforced by `web/app/no-hardcoded-colors.test.ts`.
Where anything here conflicts with DESIGN.md, DESIGN.md wins until Arjun rules otherwise.

## References

| # | Reference | Category | Arjun's "why" (verbatim) |
|---|-----------|----------|--------------------------|
| 1 | 21st.dev **Spotlight / Glow Card** — [`prompts/spotlight-glow-card.md`](prompts/spotlight-glow-card.md) | Component / interaction | "i like the ominous feel and the transition between components … when mouse hovers from graph, to chart, to statistic" |
| 2 | 21st.dev **Gradient Button** — [`prompts/gradient-button.md`](prompts/gradient-button.md) | Component | "I like the colors alot and how it doesn't feel overly complicated or engineered" |
| 3 | **useorigin.com** landing page | Landing | "my favorite out of all the inspiration sites i've sent so far" |
| 4 | **useorigin.com** sign-up page | Landing / auth | "really nice and i'd like to take inspiration from" |
| 5 | **v7labs.com** | Landing / vibe | "the vibe … is also nice" |

## What the whole set is telling us
The **mood** is a clean match for Obsidian: ominous, nocturnal, sophisticated, "not
over-engineered." Every reference reinforces dark-first, restrained, technical-editorial.

But two of the components carry things DESIGN.md has explicitly **excluded**:
- **Gradient Button** → DESIGN.md says buttons have *"no gradients"* and *"no
  bright/saturated colors outside … Ice Cyan."* (see prompt file — direct conflict)
- **Glow Card** → multicolor hue-shift vs. the single-accent + subtle-focus-glow rule.

Arjun himself flagged the resolution: *"landing page and components factors are
different categories."* That points at the model below.

## Proposed model: two registers (PENDING Arjun's ruling)
1. **Marketing / landing register** — the surfaces a logged-out visitor sees (landing,
   pricing, sign-up). Allowed to be expressive: animated gradients, warmth, bigger
   glow, useorigin/v7labs energy. This is where refs 2–5 live.
2. **App interior / console register** — the logged-in product (dashboard, set detail,
   reflections). Stays strict Obsidian: Ice Cyan used scarcely, no gradients, depth
   from tonal layering + hairline borders. Refs' *interactions* (cursor-follow
   spotlight) are welcome here **recolored to Ice Cyan**; their expressive *colors* are not.

If Arjun instead wants to warm/revise Obsidian itself, that's a bigger change — it
reopens the palette locked 2026-07-26 and the token test.

## Known gap this surfaced: motion has no tokens yet
DESIGN.md specifies color, type, spacing, radius, and component anatomy — but almost
**no motion spec** (durations, easings, spring configs). Everything Arjun is reacting
to here is *motion* (spotlight travel, gradient transitions, hover feel). Epic 3
should add a motion-token layer alongside the existing tokens so animation is as
centrally editable as color is.

## Maintainability (Arjun's explicit ask: "easy to change styles/components/animations")
- Single source already exists: `web/app/tokens.css` (CSS custom props) + a test that
  bans hardcoded colors. Keep everything flowing from there.
- When Epic 3 adds Tailwind + shadcn (the 21st.dev prompts assume both; repo has
  neither yet), wire Tailwind's theme to the existing CSS variables so tokens stay the
  one source — don't fork a parallel palette into `tailwind.config`.
- Add motion tokens (see gap above) so timing/easing are swappable in one place.
- Build a **living style-lab route** (`/lab` or Storybook-style) that renders every
  component + state + motion demo from the tokens — decide by seeing and tweaking.
