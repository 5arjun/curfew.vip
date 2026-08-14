# Prompt for the next session

Copy everything below the line into a fresh session.

---

I'm building the Curfew Landing page (Story 6.1, Epic 6) — a scroll-driven marketing page modelled on verostudio.com, on-theme with the app's Abyss palette.

**Read `_bmad-output/implementation-artifacts/6-1-landing-page-design.md` first.** It has the storyboard, the capture list, every ruling, and a build log of what's done and what's known-broken. Do not re-derive any of it.

The page is live at `/landing` (`web/app/(marketing)/landing/page.tsx`). Run `pnpm dev` in `web/` and look at it in a browser before changing anything — the Playwright MCP screenshot capture is unreliable on this page (blank/stale frames, probably racing the WebGL rAF), so verify layout by measuring `getBoundingClientRect` rather than trusting a screenshot.

**What exists:** beats 00–02 are the real build — a WebGL ribbon (`ArcRibbonCanvas.tsx`) driven by one real demo set (`hero-arc.json`, set 1289), with a time axis, genre strip, tracklist column, BPM readout and a bead that rides the crest as you scroll. Beats 03–10 (`Beats.tsx`) are a **mockup pass** built from the two Screen Studio recordings and three product screenshots in `web/public/landing/`.

**What I want this session:** [FILL THIS IN — e.g. "polish beats 03–10 to the same standard as 00–02", or "swap in the new V1/V3 captures", or "make the whole thing work on mobile"].

Constraints that are not up for renegotiation:
- Tokens only. `no-hardcoded-colors.test.ts` is the guard; `tokens.css` is the one file allowed literal hex. Marketing-only values go in the `--landing-*` block.
- `prefers-reduced-motion` must leave the page fully readable — no video autoplay, no scroll-linked motion. The ribbon freezes at its most legible orientation.
- Landing is the ONLY surface with a motion budget. UX-DR16's "logged-in surfaces stay still" still holds.
- Runtime deps: `three` + `@react-three/fiber` + `framer-motion` are in. Lenis is sanctioned but not yet installed. Nothing else without asking.
- Before finishing: `npx tsc --noEmit`, `npx eslint app`, `npx vitest run` (862 tests should pass). Delete any `.playwright-mcp/` screenshot strays — they land in the repo.

Known shortcuts in the mockup pass, fix if they're in scope: `<img>` instead of `next/image`, no WebM alongside the MP4s, and the two films carry Screen Studio's auto-zoom so they can't be scroll-scrubbed.

Still owed from me (Arjun), don't wait on them unless the task needs them:
- **V1** — Set Detail hard-reload, arc drawing itself in, ~7s, auto-zoom OFF, no mouse movement.
- **V3** — the segment editor drag, 12–15s, auto-zoom OFF.
- **V9** — the agent tray catching a set.
- Real photography (P1–P3, P6, and especially **P7**, the empty room with the house lights up — that's the closing image and it can't be the AI placeholder).
