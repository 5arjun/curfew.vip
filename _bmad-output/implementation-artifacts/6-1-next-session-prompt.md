# Story 6.1 — next-session prompt

Paste the block below into a fresh session. Updated 2026-08-14, after the two
redline passes and the D-4 ruling.

---

Continuing the Curfew Landing page (Story 6.1). Read
`_bmad-output/implementation-artifacts/6-1-landing-page-design.md` first —
storyboard, capture list, ruling log, and a build log that already records what
was tried and rejected. Don't re-derive it, and don't re-litigate §4: **D-4 is
settled, the display face is Bricolage Grotesque**, and §4's "display serif"
recommendation is kept only as the record of a decision that lost.

Live at `/landing`. Run `pnpm dev` in `web/` and LOOK at it in a foreground
window before changing anything. **Browser automation lies about this page** and
the reason is known: the whole page is rAF-driven, and Chrome produces no frames
for a background tab — so `scroll` events never fire (even for a programmatic
`scrollTo`), `position: sticky` stops being re-solved, and the WebGL canvas
holds a stale frame while the DOM around it repaints. To measure anyway: shim
`window.requestAnimationFrame` onto `setTimeout` and dispatch synthetic
`new Event('scroll')` after each `scrollTo`. That revives every DOM layer;
canvas-projected elements (POI markers, the 3D axis) still need a real window.

State: beats 00–02 are the real build (WebGL ribbon + SVG fallback, both with
axis, bead, readout, tracklist). Beats 03–10 are a mockup from two Screen Studio
recordings and three product screenshots in `web/public/landing/`. Beat 06 (the
"never ranked" principle) was cut on 2026-08-14 — the page states that principle
nowhere now. Mobile is fixed and verified. The page is ~8,100px; the stage is
300vh.

What I want changed this session:
- [ ]
- [ ]
- [ ]

Rules: tokens only (`no-hardcoded-colors.test.ts`; marketing values go in
`--landing-*`). `prefers-reduced-motion` must leave the page fully readable.
Landing is the only surface with a motion budget. One flag per question for
capability gates — don't re-conflate "can render 3D" with "should show
furniture". Every display rule reads `--lp-display`; don't hardcode a family.
Deps: `three`, `@react-three/fiber`, `framer-motion` in; Lenis sanctioned but
not installed; nothing else without asking.

Before finishing: `npx tsc --noEmit`, `npx eslint app` (4 known `<img>`
warnings), `npx vitest run` (862 pass), and delete any `.playwright-mcp/`
strays or stray screenshots at the repo root — never `git add -A` after a
browser pass.

Known shortcuts, fix if in scope: `<img>` not `next/image` (4 warnings), no
WebM, and both films carry Screen Studio auto-zoom so they can't be
scroll-scrubbed.

Still owed from Arjun: V1 (arc draw, auto-zoom OFF, 7s, no mouse), V3 (segment
editor drag, auto-zoom OFF), V9 (agent tray), real photography — especially P7,
the empty room with house lights up, which is the closing image. The
AI-generated booth photo is off the page entirely as of 2026-08-13, so P1–P3 no
longer block anything.

Open questions carried forward:
- Beat 03's slate (`Sat, Jul 25 · 11:09 PM → 2:26 AM`) replaced a label Arjun
  disliked. The storyboard's original instruction was "No headline. Let it
  land." — deleting it is still live.
- The footer credit row's small mono "Curfew" is still type, not the wordmark.
- Tuning items 2–4 from the mobile-fix pass are open: the `drift` POI anchors
  where the gap starts rather than where the eye reads the notch; the
  dancefloor window is too subtle to read as a marked region; reduced-motion
  and the low-power SVG fallback have never been visually verified.
