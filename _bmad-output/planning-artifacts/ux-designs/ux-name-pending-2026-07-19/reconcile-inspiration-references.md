# Reconcile — imports/inspiration-references.md

Five reference sites (ssscript.app, neko.engineering, flowty.co, saracajner.com, bymonolog.com), each with Arjun's own callout plus an AI-fetched read, and a synthesized direction line.

**Captured, both spines:**
- The synthesized direction (dark-leaning, bold-restrained typography, distinctive menu placement, purposeful scroll-driven motion, one consistent theme) is `DESIGN.md`'s whole aesthetic premise (Brand & Style, Colors, Shapes) and is named explicitly in `EXPERIENCE.md`'s **Inspiration & Anti-patterns** section.
- neko.engineering / flowty.co's "distinctive menu style and placement" → became `{components.nav-floating}`, cited by name in both `DESIGN.md.Components` and `EXPERIENCE.md.Inspiration & Anti-patterns` as the product's signature chrome.
- ssscript.app / saracajner.com / bymonolog.com's scroll motion and restraint ("intention over speed") → carried into `EXPERIENCE.md.Interaction Primitives` (scroll motion scoped to Landing only, logged-in surfaces stay still) and `Inspiration & Anti-patterns`.
- saracajner.com's "bold hero, easy-to-follow scroll" and bymonolog.com's "colors, the flow" → reflected in the dark Obsidian palette and the Landing hero's scroll-driven treatment.

**Not carried over — explicitly flagged, none invented in its place:**
- ssscript.app's specific technical mechanism (GSAP + WebGL, real-time visual feedback) — the *mood* (tech-forward, smooth transitions) was kept, but no WebGL/real-time-feedback pattern was adopted or specified anywhere in `DESIGN.md`/`EXPERIENCE.md`. This looks like a deliberate scope-down (Curfew's Landing motion is described as "restrained," not spectacle-driven) rather than an oversight, but no line in either spine documents that scope-down decision explicitly — worth a one-line callout if this file is revisited.
- saracajner.com's fetched read notes a "smaller elegant serif subhead" pairing with the display type. Curfew's `DESIGN.md.Typography` explicitly rejects a second serif face system-wide (the Set Detail serif appearance was corrected as a font-load glitch, Hanken Grotesk confirmed uniform) — this is a documented, deliberate rejection (memlog entry 21), not a drop.

Nothing else from this file reads as lost — the inspiration set was small (5 sites, one synthesis line) and each site's callout traces to a specific decision in `DESIGN.md` or `EXPERIENCE.md`.
