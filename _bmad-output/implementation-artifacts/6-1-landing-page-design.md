# Story 6.1 — Landing Page: capture list + scroll storyboard

**Status:** design working doc. Nothing here is built yet.
**Date:** 2026-08-13
**Reference:** verostudio.com (Rodéo studio / plutot.cool — Awwwards SOTD 7.21)
**Scope this pass:** Landing only. Features (6.2) and Pricing (6.3) stay out; the Landing carries a pricing *beat*, not the Pricing page.

---

## 0. Ruling log

| # | Decision | Ruled by |
|---|---|---|
| D-1 | Landing hero object = **the energy arc as a physical ribbon** (WebGL), scroll-scrubbed. | Arjun, 2026-08-13 |
| D-2 | `EXPERIENCE.md`'s "restrained, intention over speed, not spectacle" constraint on Landing motion is **overridden**. The Landing is a spectacle surface. The "logged-in surfaces stay still" half of UX-DR16 **still holds** — this is a Landing-only carve-out, not a licence to animate the dashboard. | Arjun, 2026-08-13 ("ignore the spec if needed") |
| D-3 | Dependencies: add **Lenis** only. Motion built on the installed `framer-motion`; WebGL on the installed `three` + `@react-three/fiber`. No OGL, no anime.js, no GSAP — Vero's exact stack is not adopted. | Arjun, 2026-08-13 |
| D-4 | Typeface: designer's call (see §4). | Arjun, 2026-08-13 |
| D-5 | Demo data comes from a **real account with demo data** Arjun owns, screen-recorded by Arjun. Not fabricated, not prod-empty. | Arjun, 2026-08-13 |

> **⚑ Owed:** D-2 must be reflected back into `EXPERIENCE.md` (Interaction Primitives + Inspiration & Anti-patterns, both of which currently state the opposite) before this story is called done. Amending the spine is part of the story, not a follow-up.

---

## 1. What we are copying from Vero, and what we are not

Verified by pulling the site's 26 JS chunks (2026-08-12):

**Their stack:** anime.js v4 (`createTimeline` / `stagger` / `eases` / `onScroll` / `splitText`), OGL for WebGL, CSS Modules + SCSS, Sanity, custom `SmoothScroll`, self-hosted Louize Display, a gated preloader.

**WebGL is scoped to exactly two components** — `MainHero.webgl` and `DressDiscover.webgl` (+ `DressDiscoverPOI`). Everything else on that site is DOM and CSS. **We hold the same discipline: two WebGL surfaces maximum on this page.**

**What we are copying — the kit.** Vero's page is ~12 reusable editorial blocks, not 12 bespoke sections. Ours, mapped:

| Vero block | Ours |
|---|---|
| `MainHero` (+ webgl) | `LandingHero` + `<ArcRibbon>` |
| `DressDiscover` + `DressDiscoverPOI` | `ArcExplorer` — ribbon with time-of-night hotspots |
| `CoverMedia` | `CoverMedia` — full-bleed scrubbed product video |
| `DiptychMediaEdito` / `TriptychMediaEdito` | same names, same job |
| `FullSizeStepper` | `CapabilityStepper` — the pinned 4-step product walkthrough |
| `LargeQuote` / `LargeTitle` | same |
| `MaskCarousel` / `EditoMediaCarousel` | `MaskCarousel` — horizontal-scrub |
| `Parallax` | `Parallax` primitive |
| `RootLayoutFooter` + `EmailCapture` | same |

**What we are not copying:** their content model. 80% of Vero's award score is commissioned photography, video, and a 3D scan of a luxury object. We cannot borrow that, and grey-boxing it would be worse than not attempting it. Our substitute is **the product's own motion and the DJ's own data as the imagery** — which is why the capture list below is the long pole of this story, not the code.

---

## 2. CAPTURE LIST — what Arjun records

### 2.1 How to record (applies to every video)

- **Browser:** Chrome, **chromeless** — `⌘⇧F` fullscreen, or a fresh window with no bookmarks bar. No tabs, no URL bar, no extensions visible.
- **Window size:** exactly **1440 × 900** at 2× DPR (so the capture is 2880 × 1800). Set with `⌥` + green-button or a window manager, not by eyeballing.
- **Capture tool:** macOS `⌘⇧5` → *Record Selected Portion*, or QuickTime. **Turn off "Show Mouse Clicks."** Whether the cursor is visible is per-shot below.
- **Frame rate:** whatever the tool gives (60fps preferred). **Do not compress, do not trim, do not convert.** Hand me the raw `.mov`. I re-encode to all-keyframe H.264 + VP9 for frame-accurate scrub — a normal 2-second-GOP MP4 scrubs like a slideshow, so this part matters and it's mine to do.
- **Motion discipline:** one continuous, *slow, even* take. No pauses to think, no corrections mid-take. If you fumble, stop and restart the take — I can't cut inside a scrubbed video without the seam showing.
- **Take three of each.** Storage is cheap; a reshoot is a week.
- **Data hygiene:** this is going on a public marketing page. Before recording, confirm every visible track title, venue name, and date is one you're happy to publish. Blur-in-post is possible but ugly.
- **Where to put them:** `_bmad-output/landing-captures/raw/` — filename = the shot ID below (`V2-arc-draw-take1.mov`).

### 2.2 Product video shots

Priority: **P0** = the page does not exist without it. **P1** = a named beat depends on it. **P2** = nice, cuttable.

| ID | Pri | Surface | What to do on screen | Length | Cursor |
|---|---|---|---|---|---|
| **V1** | P0 | Set Detail (`/set/[id]`) | **The arc drawing itself in.** Hard-reload the page and hold completely still while the `DetailArc` draws and the Silk backdrop settles. Nothing else. This is the single most important shot on the page. | 6–8s | hidden |
| **V2** | P0 | Set Detail | **Scrub the tracklist against the arc.** Slowly move the pointer along the arc left→right at a constant speed so the tracklist/arc linkage responds across the whole night. One even sweep, ~8 seconds end to end. | 10s | visible |
| **V3** | P0 | Set Detail — segment editor | **Drag a boundary handle.** Grab a `SegmentBoundaryHandle`, drag it slowly across ~10 tracks, let the rail and the arc's dancefloor band follow, release, then confirm. This is the product's best interaction — give it a generous, slow take. | 12–15s | visible |
| **V4** | P0 | Dashboard | **Cold load.** Hard-reload. Let the Silk backdrop, `HeroBand`, and the `OdometerCard` numbers count up. Hold still until everything has settled, then 2 more seconds. | 8s | hidden |
| **V5** | P1 | Dashboard | **⌘K spotlight.** Press ⌘K, type a track name at a natural pace, let results resolve, arrow down one row, Enter, land on Track Detail. One take, no backspaces. | 10s | hidden |
| **V6** | P1 | Style Evolution | **Genre share stream + granularity toggle.** Load, let the stream animate in, hold 2s, then click the `GranularityToggle` once and let it re-animate. | 10s | visible |
| **V7** | P1 | Style Evolution | **Camelot wheel.** Load, let it draw, then hover 3–4 segments slowly, ~1.5s each. | 8s | visible |
| **V8** | P1 | Library Utilization | **Conversion meter fill + scroll.** Load, let `ConversionRateMeter` fill, then scroll down slowly and evenly through `Workhorses` → `AgingShelf`. One continuous smooth scroll — use a trackpad two-finger drag, not a scroll wheel. | 12s | hidden |
| **V9** | P1 | Agent (Tauri app) | **The capture moment.** The menubar/tray agent idle in its watching state, then a set arriving — the status change. If the real transition is hard to stage, record the two states as two static shots and say so; I'll handle it. | 8s | hidden |
| **V10** | P2 | Track Detail | `ClockStrip` — load and let it render, then hover across it slowly. | 6s | visible |
| **V11** | P2 | Any authenticated page | **Nav rail hover.** Move slowly across the `FloatingNav` rail so the cyan hover-glow tracks the cursor cell to cell. Pure texture shot. | 6s | visible |
| **V12** | P2 | Dashboard → Set Detail | **The transition.** Click into a set from `SetListPanel` and let the page change land. | 6s | visible |

**One more thing I need, and it is not a video:** a **JSON export of one real demo night's arc** — the per-play timestamps + BPM + the detected dancefloor window. Not a recording; the actual numbers. The WebGL ribbon in the hero is *generated from real data*, not a video of a chart, and it needs a real night to be shaped by. One good set is enough. Tell me which set ID and I'll pull it from the demo account myself if that's easier.

### 2.3 Photography shots

Shooting notes that apply to all of them: **shoot dark.** Underexpose. One warm practical light source (booth lamp, exit sign, a bar's backlight) against an otherwise black frame. Desaturate in-camera if you can — the page's only saturated colour should be the cyan accent, so photography that arrives already colourful will fight it and lose. Shoot **16:9 with headroom to crop to 4:5 and 9:16**; every one of these needs a mobile crop. Handheld is fine, grain is fine, motion blur is *good*.

| ID | Pri | Shot | Notes |
|---|---|---|---|
| **P1** | P0 | **Hands on the mixer.** Tight, shallow depth of field, fader or jog wheel in focus, everything else falling off. | The page's texture anchor. Get several. |
| **P2** | P0 | **Booth from behind the DJ**, crowd blurred out beyond. | The "you were there, but you weren't watching yourself" frame. |
| **P3** | P0 | **Laptop in the booth running Serato**, shot at an angle, screen legible but not the subject. | This is the honesty beat — Curfew reads what you already use. |
| **P4** | P1 | **The room, from the booth.** Wide, dark, lights in the frame. | |
| **P5** | P1 | **Portrait of you.** Off-hours, not performing — the founder-quote beat. Dark background, single source, looking slightly off-lens. | Only needed if you want the quote beat (§3, beat 09). Say the word if you don't. |
| **P6** | P1 | **Detail set, 4–6 frames:** a USB stick, coiled cable, a scuffed flight case, a record sleeve, a drink ring on the booth. | These fill the `TriptychMedia` and give the page its craft register. |
| **P7** | P0 | **The end of the night.** Empty room, house lights up, gear still out. | This is the *most on-brand image the product has* — Curfew is the after-hours archive. If you get one photo perfect, make it this one. |

**If a shot is genuinely unavailable, tell me which and I'll redesign around it** rather than reaching for stock. Stock photography would read as false immediately on a page whose whole claim is "this is your real night."

### 2.4 Asset ledger — first delivery, 2026-08-13

| Asset | Verdict | Notes |
|---|---|---|
| `dashboard.mp4` (1920×1080, 60fps, 19.75s) | **Usable as film, not as scrub** | Screen-Studio-style: baked-in auto-zoom camera + animated purple→cyan gradient background. Clean at frame 0, no HUD. Ends on a click into Set Detail. |
| `set detail.mp4` (1920×1080, 60fps, 18.88s) | **Usable as film, not as scrub** | Same treatment. **Trim to 0.25s in** — a `Memory usage: 310 MB` dev HUD is on screen through frame 8 and gone by frame 12. Contains the arc *scrub* (V2), not the arc *draw* (V1) — the arc is already rendered at frame 0. |
| Style Evolution screenshot | **In** — beat 05 step 03, beat 07 | 2696×1418. |
| Genre Diversity / Camelot / Harmonic screenshot | **In** — beat 07 triptych | 2690×1424. The Camelot wheel crop is the best single still we have. |
| Library Utilization + `drake` search screenshot | **In** — beat 05 step 04 | 2824×1408. Doubles as the search story if V5 doesn't get recorded. |
| `Gemini_Generated_Image_...jpeg` | **In, cropped only** | See §2.5. |
| Hero ribbon data | **Done — pulled** | `landing-captures/hero-arc-set-1289.json` (see §2.6). |

#### The one thing that has to change: the video export settings

Both videos have a **camera of their own** — Screen Studio's auto-zoom — plus a saturated purple/cyan gradient background. Two consequences:

1. **They cannot be scroll-scrubbed.** In a scrubbed shot the *scroll* is the camera. With a second camera baked into the footage, a steady scroll produces lurching, compound motion. This is not fixable in post.
2. **The background fights the palette.** I tested a global grade: it does kill the purple, but it also desaturates the UI's own colour — the genre strip goes grey and the rose key chips go neutral, which throws away the most attractive thing on the screen. A **vignette + midtone-curve** treatment works far better (background falls to black, UI colour survives intact) and I've built it, but it's a patch on a problem that shouldn't exist.

**The ask — two Screen Studio export settings, ~2 minutes:**
- **Background: solid `#04060a`** (the app's own `--color-abyss-base`), or transparent if your version supports alpha export. Then no grading is needed at all and the footage composites straight onto the page.
- **For V1 and V2 only: auto-zoom OFF.** Those two are the scrubbed shots and must be camera-free. Every other shot can keep the zoom — it's genuinely good for the "film" treatment.

Re-exported that way, both current recordings become drop-in. Until then, the vignette patch is applied and the two are used as **auto-playing film** in beats 04/05/08, not as scrub.

**Still owed:** V1 (arc draw — not in either file), V3 (segment editor — the most important shot on the list), V9 (agent tray). V5–V8 are covered as stills by the three screenshots, so they drop to P2.

### 2.5 On the AI-generated photograph

The supplied booth photo is Gemini-generated, and it should be treated as a **placeholder that survives only in crop**. At full-bleed it will not hold: the mixer's control labels are gibberish, the CDJ display text is invented, and the gear is a composite of no real product. The audience for this page is DJs — the exact people who will read those tells instantly, on a page whose entire claim is *"this is your real night."* Publishing it wide would undercut the argument the page is making.

**What does work,** verified by crop test: the **booth-POV frame — laptop right, blurred crowd left, forearm entering bottom-right** (`crop=1200:675:900:120` on the original). At that framing the screen text is sub-legible, the invented gear is out of shot, and it reads as a real photograph. Graded down it's a credible stand-in for **P3** and partially **P2**.

**Recommendation:** ship it in that crop if a real photo can't be got before launch, and flag it for replacement. It should never appear as beat 10's full-bleed closing image (**P7**) — that frame is the page's thesis and has to be real.

### 2.6 Hero ribbon data — pulled

`_bmad-output/landing-captures/hero-arc-set-1289.json`, extracted from `demo-catalog/demo-sets.json`.

**Set `serato4:1289`** — labelled in the demo catalog as *"Set detail — peak-time club,"* tier 1. Sat 25 Jul 2026, 23:09 → 02:26, **3h 17m, 44 tracks**, BPM 98.98–130.07 (median 125), detected dancefloor at **positions 11–38** (12:19 AM – 1:48 AM), confidence 1.0, two idle gaps (longest 12.2 min).

**Why this set and not another:** it is the set already on screen in `set detail.mp4`. That makes beat 03's ribbon→interface handoff *literal* — the abstract object the hero spends 300vh shaping is the same night the product then opens. That's a much stronger cut than a generic match, and it costs nothing.

The file carries normalized `t` (0–1) and `bpmNorm` per track for direct consumption by the shader, plus the dancefloor window, idle gaps, and five pre-computed POI moments for beat 02:

| POI | Moment |
|---|---|
| `open` | 11:09 PM — *I Adore You (Clean Extended)* |
| `floor` | 12:19 AM — the floor opens |
| `peak` | 130 BPM — *THE SCOTTS (Clean)* |
| `drift` | the 12.2-minute gap |
| `last` | 2:26 AM — last track |

---

## 3. SCROLL STORYBOARD — shot by shot

Total page ≈ 1,100vh. Lenis smooth-scroll (lerp ~0.1) drives everything; every scroll-linked value reads from a single normalized progress source so nothing drifts.

**All copy below is a draft for redline.** The voice is DESIGN.md's console/archive register — technical, nocturnal, never congratulatory, and never comparative-to-others (the "never best, never ranked" rule is non-negotiable and shapes beat 06 specifically).

---

### Beat 00 — Preloader · 0vh · ~1.4s
Pure `--color-abyss-base` black. Centred: a **1px cyan line, 0 → 240px**, drawing left to right on `--motion-ease-liquid`. Beneath it, mono percentage counting. On complete the line does *not* disappear — it **becomes the hero's flat horizon**, and the black lifts around it.

*Rationale: the first thing you see is a flat line. The entire page is the argument that your night is not a flat line.*

---

### Beat 01 — `LandingHero` · 100vh · WebGL #1
The ribbon at rest: **edge-on, flat, a horizon**. Slow ambient drift only (never scroll-independent oscillation — Apple reduced-motion guidance, same rule the dashboard's hero atmosphere already follows).

Headline, display serif, **split by word, staggered rise 60ms apart** from a clipped baseline:

> ## "It went well."
> ### Compared to what?

Sub, Inter, `--color-abyss-text-72`:
> Curfew reads the sets you already played and gives you the only baseline that means anything — your own.

Bottom: a mono scroll cue, `SCROLL` + a 1px line that breathes.

---

### Beat 02 — `ArcExplorer` · 300vh sticky · WebGL #1 continues
**The centrepiece.** As you scroll, the flat horizon **rotates from edge-on to a 3/4 view and inflates into a real night's energy arc** — built from the real demo-set JSON (§2.2), not a video. Time-of-night ticks fade in along its length. The dancefloor window lights in `--color-abyss-accent` as it passes.

Copy pinned left, swapping at three scroll thresholds (each a splitText fade-through):

1. **Every set has a shape.**
2. **You have never seen yours.**
3. **This is one night. Yours.**

At ~70% progress, POI hotspots resolve along the ribbon — `01:12 · floor peak`, `02:40 · the drift`, `03:05 · last track` — each a small cyan dot with a mono label, staggered in.

*This beat is Vero's `DressDiscover` + `DressDiscoverPOI`, one-for-one. It is also the reason WebGL exists on this page at all.*

---

### Beat 03 — `CoverMedia` · 150vh sticky · **V1**
The ribbon's final frame **mask-wipes into the real product** — a full-bleed, scroll-scrubbed **V1 (the arc drawing on Set Detail)**. The handoff is the trick: the WebGL ribbon's last orientation is matched to the arc's on-screen position in V1, so the abstract object *becomes* the interface.

Overlaid, small, top-left, mono: `SET DETAIL · 04:12 · 71 TRACKS`

No headline. Let it land.

---

### Beat 04 — `DiptychMediaEdito` · 100vh · **P3 + V9**
Two columns, parallaxing at different rates (left 0.9×, right 1.05×).
Left: **P3** — laptop running Serato in the booth.
Right: **V9** — the agent tray catching the set.

> ### You don't do anything.
> A small app on your machine reads Serato's own history the moment you close the laptop. No plugin, no upload, no ritual. Play the way you already play.

---

### Beat 05 — `CapabilityStepper` · 400vh pinned · **V2/V3, V6, V7, V8**
Vero's `FullSizeStepper`: the section pins, and scroll steps through four numbered states. The media pane cross-fades; the numeral is huge, serif, and slides.

| Step | Copy | Media |
|---|---|---|
| **01 — The night** | Every track, in order, against the clock. The set as it actually happened, not as you remember it. | **V2** |
| **02 — The dancefloor** | Curfew guesses where the floor was. You drag the edges until it's right. | **V3** |
| **03 — The drift** | What you played this month against what you played last. Not better. Different — and now visible. | **V6** + **V7** |
| **04 — The library** | The records you own and never reach for, named. | **V8** |

Step 02 is the one that sells the product. Give it the longest scroll dwell.

---

### Beat 06 — `LargeQuote` · 100vh · type only, black
Full stop. No media, no motion but the splitText.

> ## Never best. Never ranked. Never against another DJ.
> ## Only against you, last month.

Small mono beneath, `--color-abyss-text-45`: `PRODUCT PRINCIPLE · NON-NEGOTIABLE`

*This is a real constraint from the PRD, not marketing garnish. Stating it plainly on the landing page is the single most differentiating thing we can say.*

---

### Beat 07 — `TriptychMediaEdito` · 120vh · **P6 + V10 + V11**
Three tall panels at three parallax rates (0.85× / 1.0× / 1.15×) — one detail photo, the clock strip, the nav rail glow. No copy, or one mono line: `THE DETAILS ARE THE POINT`.

---

### Beat 08 — `MaskCarousel` · 200vh · **V3 + V5**
Horizontal scrub driven by vertical scroll — the segment editor and the ⌘K search, presented as two wide plates sliding past a fixed mask. Vero uses this to show craft process; we use it to show the two interactions that feel fastest.

---

### Beat 09 — `LargeQuote` (founder) · 100vh · **P5**
Portrait left, quote right, both parallaxing gently.

> "I wanted to know if the night was good. Not whether the room liked it — whether *I* did something different. Nothing told me that."

Attribution in mono. **Cut this beat entirely if you'd rather not be on the page** — the page works without it, and a reluctant portrait reads worse than none.

---

### Beat 10 — CTA + `RootLayoutFooter` · 150vh · **P7**
**P7 (the empty room, lights up)** full-bleed behind a `--color-hero-scrim` wash. Centred:

> ## Curfew
> ### $6/month. One plan.

`MetalButton` primary CTA → opens the **auth overlay** (Story 6.4 — never a separate page, per UX-DR16). Email capture beneath for the not-yet-ready. Footer: credits, privacy, terms.

*Ending on the empty room closes the loop the preloader's flat line opened, and it is the product's actual thesis image: the work happens after everyone leaves.*

---

## 4. Typeface (D-4 — my call, open to redline)

The page needs a **display serif** that Curfew does not currently own — Hanken Grotesk is correct for the app and wrong for a hero that has to feel authored. Vero's Louize Display is licensed and not cheap.

**Recommendation: `Instrument Serif`** (SIL Open Font, free) for display only — high contrast, slightly condensed, a real editorial voice, and it pairs cleanly against Inter without either one apologising. **Fallback if it reads too fashion-y against the dark ground: `Newsreader`** (also OFL, warmer, more archival — arguably more "after-hours log").

Body stays **Inter**, data stays **Geist Mono**. Hanken Grotesk does **not** appear on the Landing — the marketing surface is deliberately a different register from the app.

---

## 5. Technical notes

- **Video encode is mine, not yours.** Raw `.mov` in, all-keyframe H.264 (`-g 1`) + VP9 out, plus a poster frame per shot. Scrubbed video needs every frame seekable.
- **Mobile:** the WebGL ribbon renders at reduced particle/segment count below 768px and falls back to a **static high-res render** below 480px or on `deviceMemory < 4`. Scrubbed videos become poster stills on mobile — the bandwidth cost of 12 scrub videos on cellular is not defensible.
- **`prefers-reduced-motion`:** ribbon → static render at its most legible orientation; all scrubbed video → poster frame; splitText → a single opacity fade; Lenis → native scroll. The page must still *read* completely with every animation removed. AC-3 requires this and it is the easiest AC to fail late.
- **Colour guard:** `no-hardcoded-colors.test.ts` will flag marketing-only values. Extend `tokens.css` with a `--landing-*` block rather than exempting the directory (Arjun's call, §6 of the prior session).
- **Route:** `web/app/(marketing)/page.tsx` — a new route group so the marketing layout carries Lenis + the display serif and the authenticated layout carries neither. The current placeholder `web/app/page.tsx` is replaced.
- **Budget:** WebGL bundle is dynamically imported and must not block LCP. Target LCP < 2.5s with the hero's first paint being the *headline*, not the canvas.

---

## 5b. Build status — 2026-08-13

**Beats 00–02 are built and running at `/landing`.** Not `/` yet: the Story 1.1 scaffold page keeps `/` until the full page replaces it.

| File | What it is |
|---|---|
| `components/landing/arc-curve.ts` | Curve maths. Resamples the 44 plays to 256 columns piecewise-linearly against real elapsed time (preserving the app's plateaus), softens with three box passes, derives slopes. Also emits the SVG path — so the WebGL ribbon and the fallback are driven by identical numbers and cannot tell different stories. |
| `components/landing/ArcRibbonCanvas.tsx` | The ribbon. Two meshes sharing one uniform shape: a constant-thickness **band** tracing the crest, and the **fill** beneath carrying the DetailArc's own area treatment. |
| `components/landing/ArcRibbon.tsx` | Scroll source, the no-WebGL SVG fallback, and the POI layer. |
| `(marketing)/layout.tsx`, `(marketing)/landing/page.tsx`, `landing.css` | Route group, hero, explorer captions. |
| `tokens.css` `--landing-*` | Five new tokens, ribbon four read by the shader at runtime. |

**What it does now:** opens as a quiet horizon low in the frame under the headline; inflates into the night's real shape as you scroll; rotates into a 3/4 object with a slow fabric drift; drops five POI markers onto the crest, positioned by projecting the actual 3D points to screen space each frame. Per-play ticks along the crest mark all 44 real play starts — not an even spacing, because the gaps are the point.

**Two bugs found and fixed while building, both worth remembering:**
- `uAmp` scaled `position.y`, which held the band's thickness as well as the curve height — so at rest the ribbon flattened to *zero area* and rasterized nothing. Thickness now lives in its own attribute and is applied after the scale. The hero's opening horizon exists only because of that split.
- Reveal was tied to scroll progress, so the ribbon was invisible at progress 0 — exactly where the hero needs it. It is now a mount fade, independent of scroll.

**Dependency added:** `@types/three` (devDependency). `three` 0.180 ships no types and `@react-three/fiber` does not re-export them. Runtime deps still stand at D-3 — Lenis remains the only planned runtime addition, and is not in yet.

**Guard amended:** `no-hardcoded-colors.test.ts` flagged `<shaderMaterial transparent />` because `transparent` is both a CSS color keyword and a three.js material property. Narrowed to skip only the bare JSX boolean form — `color: transparent`, `"transparent"` and `transparent: <hex>` all still trip it. Documented in the test.

**Verified:** `tsc --noEmit` clean, `eslint` clean, `no-hardcoded-colors` + `tokens` suites pass (22 tests), no console errors in-browser.

### Beat 02 furniture — added 2026-08-13 (Arjun picked options 2, 3, 4)

The dead space around the ribbon is now occupied by three things, all real data from the same set. Option 1 (the ghosted median-night baseline) was **not** taken — it stays on the table; the numbers are computed and stand up (median night across 74 sets opens 96 / peaks 127 BPM, against 1289's 120 / 130).

| Element | What it is | How it is anchored |
|---|---|---|
| **Time axis** | Hour boundaries plus both ends — 11:09 PM · 12 AM · 1 AM · 2 AM · 2:26 AM | Projected from the ribbon's own **baseline** in 3D, so the ticks tilt with it. Anchoring to the page would have let the axis and the shape drift apart under rotation. |
| **Genre strip** | The app's own per-play colour band, one column per resampled sample, coloured by `--chart-cat-*` ranked by play count in this set (House, Electronica, Pop, Hip-Hop, Afrobeats — 5 genres, no fold needed) | A third mesh in the canvas with a per-vertex colour attribute. Constant height, does not inflate with the curve — it is a legend, not part of the shape. |
| **Tracklist column** | All 44 real titles with clock times, right side, dimmed, the current one lit | A masked window; the list translates so the active track stays centred with its neighbours either side. A clipped static list would have simply lost the end of the night. |
| **BPM readout** | The BPM under the scroll position, left side | Same scroll-derived index as the tracklist. |

**Performance shape:** none of this re-renders on scroll. The scroll rAF mutates `style.transform` / `textContent` on ref'd nodes directly — 44 tracklist rows going through React at 60fps would be the single easiest way to make this page feel bad.

**Resulting vertical composition** at full progress, measured in-browser (855px viewport): readout 16–22%, crest 31–39%, arc body 39–66%, axis 66–71%, caption 78–88%. No dead band left.

**Note for future browser passes:** the Playwright MCP capture crops roughly 85px off the top of an 855px viewport (`innerHeight` 855, capture 770). Judge layout from measured `getBoundingClientRect` values, not from the screenshots — an earlier pass shrank the arc on the strength of a "clipped crest" that was a capture artefact.

### Depth pass — 2026-08-13 (Arjun)

Four changes, all about establishing that the page has **layers** rather than one flat plane:

1. **The ribbon runs edge to edge and passes under the tracklist** (`OFFSET_X` 0, `WIDTH` 6.4). The column carries a left-fading scrim (`--landing-scrim`, new token) plus a 3px backdrop blur, so the shape dissolves under the text instead of being cut off by a hard edge.
2. **A travelling bead** rides the crest at the scroll position — a lit sphere with a fake key light, a tight specular and a rim, plus an additively-blended halo. It mirrors the vertex shader's own z-drift so it sits *on* the ribbon rather than hovering in front of it once the surface starts moving. It stays in lockstep with the lit tracklist row: both read from the same scroll-derived position.
3. **The BPM readout moved behind the canvas** (`z-index: 0` under `.lp-canvas`'s `1`) and shrank to ~1.5rem in `--color-abyss-text-45`. The ribbon now passes in front of it, which is what makes it read as instrumentation in the background rather than a competing headline.
4. **The `last` POI was dropped.** At `t = 1` it sits under the tracklist column now. No information is lost — the axis labels 2:26 AM at that exact x, and the column header states the night's span.

**One knock-on worth recording:** with the ribbon full-bleed, the axis's right end runs under the column too. Fixed by raising `.lp-axis-layer` above the scrim (`z-index: 4`) and lifting the tracklist window (`top: 44%`, height `40vh`) so the two no longer overlap. Without that the axis appeared to stop at 1:00 AM, which read as broken rather than as an overlap.

**Also fixed on the way:** the bead's halo was first written rim-lit (`pow(1 - dot(N,V))`), which draws a hard bubble outline — the opposite of a glow. A glow is brightest where the surface faces the camera, so it is `pow(dot(N,V))` instead.

### Mockup pass — beats 03–10, 2026-08-13

The whole page now exists end to end (~11,000px) so it can be judged as one thing. `web/app/components/landing/Beats.tsx` + `web/public/landing/` (8 MB). Two tweaks landed with it: the bead is smaller (0.043 core / 0.088 halo) and the ribbon's turn starts earlier — `smoothstep(0.26, 0.96, p)`, overlapping the tail of the inflation so the two read as one move rather than two.

| Beat | Built with | Owed |
|---|---|---|
| 03 Cover | `set detail 2.mp4`, trimmed 0.25s past the dev HUD, full-bleed | **V1** — the arc drawing itself in, camera-free. The mask-wipe from the ribbon needs it. |
| 04 Diptych | Booth photo (AI, cropped per §2.5) + `dashboard2.mp4` | **P1–P3** real photography; **V9** the agent tray |
| 05 Stepper | 4 pinned steps: set-detail film, dashboard film, Style Evolution still, Library Utilization still | **V3** — the segment editor drag, step 02. Still the most important shot outstanding. |
| 06 Principle | Type only, no assets | — |
| 07 Triptych | The three product stills | **P6** detail photography |
| 10 Closing | Type + gradient + CTA | **P7** the empty room. The thesis image; has to be real. |

Video handling: `<video muted loop playsinline preload=metadata>`, played only while in view via IntersectionObserver, and **never played at all under `prefers-reduced-motion`** — the poster stands in. A looping product demo is exactly what that setting exists to stop. In the stepper only the active step's video runs.

**Known shortcuts in this pass, to fix before it ships:** `<img>` rather than `next/image` (5 lint warnings); no WebM alongside the MP4s; the two films carry Screen Studio's auto-zoom, which is fine for beats 03–05 but is why none of them can be scroll-scrubbed yet.

**Verification note:** the final visual pass was done by measuring `getBoundingClientRect`, asset `naturalWidth`/`readyState`, and fetch status — the Playwright screenshot capture became unreliable on this page (returning blank or stale frames, likely racing the WebGL rAF). Geometry, asset loading and all gates check out; judge the *look* in a real browser.

### Mobile audit — 2026-08-14, measured at 390×844

**Verdict: beats 03–10 hold up; beat 02 does not exist on mobile.** Measured, not eyeballed. No horizontal overflow anywhere (`scrollWidth` 390 = `clientWidth`), which is the one thing that would have been fatal.

**P0 — beat 02 is empty.** `useLowPower()` returns true under 640px, so the canvas never mounts, and the axis, genre strip, tracklist, BPM readout, POI markers and bead are **all gated behind `useCanvas`**. Mobile gets a static SVG and three captions — across **2,701px (320vh) of scroll in which nothing changes.** Three-plus screens of pulling past a still image. The fallback was designed as "the same curve, crisper," and that is true of the ribbon alone, but every piece of furniture built since went behind the same gate without anyone re-checking what was left.

**P0 — the SVG collides with the headline.** At rest the SVG occupies 307–594px; the headline sits 346–436 and the sub 460–539, so the arc is drawn straight through both. Two consequences: legibility, and the fact that mobile opens on the *finished arc* — the flat-horizon opening that the whole beat-00→02 reveal is built on never happens.

**P1 — video weight.** 7.5 MB of H.264 (`set-detail.mp4` 3.9, `dashboard.mp4` 3.6), encoded at 1600px and displayed at 348. Four `<video>` elements mount. Fine on desktop, indefensible on cellular. The storyboard (§5) already called for posters-only on mobile; it is not implemented.

**What holds up:** the stepper pins correctly and its stacked layout fits with room (copy 214–409, media 433–630, in an 844px viewport). Diptych, triptych and closing all collapse to one column as intended. Type scales sanely (headline 44px, caption 32px).

### Mobile fix — 2026-08-14 (done)

**The root cause was coupling, not layout.** `useLowPower` answered three unrelated questions with one boolean: *can this device run WebGL?*, *should the ribbon be 3D or SVG?*, *should there be furniture?* Split into `useCanRender3D()` (the first two) with the furniture no longer gated on it at all. **Rule going forward: one flag per question.** This class of bug is not prevented by doing mobile earlier — only by not conflating concerns.

| Fix | Result (measured 390×844) |
|---|---|
| Furniture ungated from the canvas | Axis, BPM readout, bead and a compact "now" line all present on mobile. Only the POI markers stay canvas-only — they are positioned by 3D projection and have no 2D meaning. |
| `layoutFromSvg()` — the 2D counterpart of the canvas projection pass | Positions axis + bead from the SVG's measured box, writing the **same contract** (a px `transform` on the node), so the DOM layer does not know which renderer is behind it. |
| The reveal, in SVG | The path group scales on Y from a flat line to the night's shape (`scaleY(0)` → `scaleY(1)`, origin at the baseline). **The horizon-becomes-your-night reveal now happens on mobile.** It is the page's argument; it could not be allowed to depend on WebGL. |
| Stage 320vh → 180vh | 1,688px, and every pixel of it changes something. |
| SVG to the lower third | At rest: arc 506–750, headline 191–280, sub 304–383. No collision. |
| Posters below 640px | All four `<video>` elements drop their `src` and render the poster. 7.5 MB → 0 on cellular. |
| Compact tracklist | The full 24ch column is replaced by the night's span plus the single track you are standing on. |

Desktop re-verified unchanged after the split: canvas mounts, `data-mode="gl"`, tracklist present, 4 POI markers, no 2D bead, axis live, readout tracking. No horizontal overflow at either width.

**Tuning left, in priority order:**
1. Composition at full progress leaves a large dead band between the arc and the caption — the arc probably wants to sit lower, or the fill to reach further down.
2. The `drift` POI anchors to where the 12-minute gap actually starts, which is not where the eye reads the notch in the curve. Data-honest but visually confusing; needs either a different anchor or a connecting leader line.
3. The dancefloor window's emphasis is too subtle to read as a marked region.
4. Reduced-motion and the low-power SVG fallback are implemented but have not been visually verified.

### Redline pass — 2026-08-13 (Arjun, first look at the whole page)

Seven changes off four screenshots. All measured in-browser afterwards; the
numbers below are `getBoundingClientRect` at 1440×722, not estimates.

| # | Ask | What landed |
|---|---|---|
| 1 | "says CURFEW above 'It went well' — can we have that in the logo?" | `.lp-wordmark` — the same `curfew-wordmark.png`-as-mask treatment the nav rail uses, 137×32 in the hero, filled with a quiet text-72→text-45 ramp rather than the rail's cold chrome (metal at that size above a 94px headline reads as a second headline). Accessible name on the element. |
| 2 | Drop the quotes around *It went well.* | Done. |
| 3 | Em dash → hyphen in the sub | Done. **The mauve box around the dash in your screenshot is not ours** — it does not reproduce here at any zoom, and no other em dash on the page (tracklist header, step 03) shows it. Extension or a scroll-to-text-fragment highlight. |
| 4 | "can I see a different font?" | D-4 is reopened as a live A/B: **Instrument Serif · Newsreader · Fraunces · Bodoni Moda**, chip row bottom-right of `/landing`, choice persisted across reloads. **Development only** — four display families preloading would blow §5's LCP budget. Every serif rule now reads one `--lp-display` var, so committing the winner is a one-line change plus deleting the losers. |
| 5 | "we shouldn't see that '44 tracks' part until we scroll" | The whole column — header, rule and scrim — is gated now, not just the rows. Same gate added to the phone's `.lp-now` line. |
| 6 | "the text once I scroll is appearing too low on the bottom again" | **The captions moved to the top.** Correct diagnosis was bottom-heaviness: arc (39–66%), axis (66–71%), caption (78–88%) and provenance were all queued in the lower third while the top third held one dim BPM number, so the last line finished about a Dock's height from the edge of the screen. Captions now sit at `top: 22vh`, under the readout, over the night's quiet opening hours — the arrangement the phone layout has used since the mobile fix. Measured: caption 22–37%, ending x=458 of 1440, clear of the crest. This also closes tuning item 1 from the previous pass. |
| 7 | Beat 04: drop the DJ photo, bigger film, copy layered over it with shadow | No longer a diptych. One film at 84% width (1089×612 at 1440, was ~630 wide), right-aligned; the copy stands over its left edge by 133px with a soft radial pool of `--landing-scrim` and an 18px ink text-shadow. Centring is flex, not a `-50%` transform, so `prefers-reduced-motion`'s `transform: none` cannot drop the copy half a block down the page. Stacks below 860px with the scrim and shadow removed. **The AI-generated booth photograph is now off the page entirely** (§2.5) — P1–P3 are no longer blocking anything. |

Gates: `tsc` clean, `eslint` clean (4 pre-existing `<img>` warnings, down from 6 — one image left with the photo), 862 tests pass.

#### Why browser verification on this page kept lying — root cause found

The "Playwright screenshots are unreliable here" note in the previous pass has a
cause, and it is not Playwright: **this page is entirely rAF-driven, and Chrome
stops producing frames for a tab that is not visible.** In a background tab the
canvas holds its last frame, `scroll` events never fire at all (they are
dispatched from the frame loop, so even a programmatic `scrollTo` produces
nothing), and `position: sticky` stops being re-solved — which reads as "the
sticky stage broke" if you measure it. Nothing in the page is at fault.

Workaround used here, if a later pass needs it: shim
`window.requestAnimationFrame` onto `setTimeout` and dispatch synthetic
`scroll` events after each `scrollTo`. That revives every DOM-driven layer —
tracklist, readout, captions, the SVG-mode axis and bead. It cannot revive the
canvas-projected layers (POI markers and the 3D axis), because those are
positioned by the r3f render loop, which needs real frames. Judge those in a
foreground window.

**Also fixed, off-story: the dashboard could not be scrolled on a laptop.**
`dashboard.css` released its viewport lock below `max-height: 820px`, which is
every normal laptop window (900px screen − browser chrome − Dock ≈ 720–810), so
the designed D9 layout was the one nobody ever saw. Worse, the released
layout's premise — "the page scrolls normally" — was false: `.dz-list-scroll`
keeps `overscroll-behavior: contain` and covers most of the viewport, so the
wheel never reached the document and the content below the fold was
unreachable from where a pointer naturally sits. Threshold moved to 640px, and
both release blocks now hand the gesture on (`overscroll-behavior: auto`).
Re-measured at 1440×722: page maxScroll 0, nothing clipped, both inner columns
scrolling with their existing edge-fades, nav rail ending 20px inside the
frame. **Record at this size and the frame is whole.**

### Redline pass 2 — 2026-08-14 (Arjun, second scroll-through)

| # | Ask | What landed |
|---|---|---|
| 1 | "I don't like any of these fonts" | Round one was four serifs and all four were rejected, which reads as a rejection of the **direction**, not of four drawings of it. Round two is a spread across registers: **Archivo · Space Grotesk · Syne · Bricolage Grotesque · Big Shoulders**, plus **Hanken (the app's own)** as a control — D-4 assumed the marketing surface must differ from the app and that assumption has never been tested against the hero. Instrument stays as the incumbent. The sans faces take their own size/tracking/weight (a grotesque at 94px is a different animal from a high-contrast serif) and drop the italic on line 2 for weight, because none of them has an italic worth setting a headline in. Worth noting from the first look: **the wordmark is itself a condensed grotesque**, so a sans headline rhymes with the logo in a way the serif never did. |
| 2 | Cut "This is one night. Yours."; hero keeps the two prior; speed the scroll up | Two stages, second at 0.46. Stage **400vh → 300vh** (mobile 180 → 150). Everything scroll-linked here reads one normalized progress, so shortening the stage speeds inflation, rotation, the bead and the tracklist walk together and nothing needed retiming. The provenance line re-gated to stage ≥ 1, or it would have had no stage left to appear on. |
| 3 | "'Set detail · 3h 17m · 44 tracks' seems out of place" | Agreed — it named the screen you are already looking at, in the product's own UI vocabulary, over footage whose job is to speak for itself. Replaced with a **slate**: `Sat, Jul 25 · 11:09 PM → 2:26 AM`, the night's real date and hours from the same set the ribbon is built from. Says nothing about the software. **The storyboard's original instruction was "No headline. Let it land." — deleting the line entirely is still the other right answer** and is a one-line change. |
| 4 | Blur/shadow behind the beat-04 copy | The scrim is now a flat `--landing-scrim` pool **plus a real 16px `backdrop-filter` blur of the film**, both faded out by the same radial mask so the treatment has no edge of its own — a hard-edged plate would read as a card sitting on the video. Neutralised under `prefers-reduced-transparency`. |
| 5 | Parallax: the copy scrolls faster than the film, bottom → top | `useParallax` — the copy translates ±150px against a progress that runs from "section enters the viewport" to "section leaves it", so it travels ~273px relative to the film across the scroll-through while staying inside the film's vertical span. Written straight to `style.transform` on a rAF, never through React state. Off under reduced motion (and it removes its own listeners), off below 861px where the two are stacked and parallax would just be drift. The copy's entrance is now **opacity-only** — a transform transition on the same property would smear the whole travel. |
| 6 | Cut beat 06, the principle | Done, and recorded rather than silently deleted: "Never best. Never ranked." is a PRD constraint, and §3 argued it was the most differentiating sentence the page had. **The page now states the no-comparison principle nowhere** — step 03's "Not better. Different" is the only surviving trace. One component in git history if it should come back. |
| 7 | The closing "Curfew" → the logo | `.lp-wordmark--closing`, 340×80 at 1440, brighter ink than the hero's since it anchors the CTA rather than sitting above a headline. The page now opens and closes on the same object. The tiny mono "Curfew" in the footer credit row **is still type** — that one is 200px below and duplicating the mark there would be one wordmark too many; say the word if that was the one you meant. |

Page is now ~8,100px, down from ~11,000. Gates: `tsc` clean, `eslint` clean (4 `<img>` warnings), 862 tests pass.

Note for whoever commits the font decision: every display rule reads `--lp-display`, so the winner is one line in `.lp-root` plus deleting `FaceSwitcher.tsx`, the `[data-face]` blocks, and the losing families in `fonts.ts`. **None of the challengers may ship** — a rack of display families preloading is exactly the LCP failure §5 warns about.

## 6. What happens next

1. Arjun records §2.2 and shoots §2.3, drops raw files in `_bmad-output/landing-captures/raw/`.
2. Arjun redlines the copy in §3 — every line is a draft.
3. In parallel and not blocked on either: build the `ArcRibbon` WebGL from the real set JSON, and the block kit (§1 table) with placeholder media.
4. Swap placeholders for real captures as they land.

The ribbon and the kit are the long build; the captures are the long lead time. They run concurrently.
