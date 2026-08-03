# Dashboard Redesign — Refinement Log (post-PLAN.md taste pass)

Running log of changes Arjun and Claude agree on during the live refinement
sessions, so a fresh dev session can pick up without re-deriving anything.
PLAN.md (D1–D14) remains the base law; entries here are Arjun-sanctioned
deviations/extensions layered on top of the built redesign (tip was 21cf5be
when this pass started).

## Session 2026-08-03

### Agreed + implemented

1. **Nav: bottom dock → left vertical rail (desktop).**
   Arjun: the centered bottom dock overlapped dashboard content. At
   `min-width: 900.02px` (mirrors dashboard.css's 900px lock-release) the
   dock re-lays as a fixed full-height rail on the left; below that the
   original bottom dock is untouched. Geometry tokens: `--nav-rail-inset`
   (20px), `--nav-rail-width` (68px), `--nav-rail-radius` (34px) in
   tokens.css. Files: `FloatingNav.tsx`, `globals.css`, `tokens.css`.

2. **Rail wears the liquid-metal material** ("same border animation as Enter
   Set / hero arrow" — Arjun). MetalButton's exact layer sandwich flattened
   to a surface: LiquidMetal shader ring (ref params verbatim, idle 0.6 →
   rail-hover 1.0, reduced-motion 0) under a dark plate inset 2px. This is
   the **third sanctioned placement** of the WebGL material (PLAN.md's
   two-placement rule extended by Arjun's ask); shader mounts only at rail
   widths, so mobile pays no WebGL context. Shared hooks extracted to
   `web/app/components/ui/metal-hooks.ts`.

3. **Branding: CURFEW wordmark on the rail.**
   Source mock `~/Desktop/Curfew Assets/c1.png` (black-on-white) processed to
   a white-on-transparent trimmed mask (`web/public/brand/curfew-wordmark.png`,
   1302×308) and rendered as a chrome book-spine at the rail top: CSS mask +
   cold-chrome gradient fill (`--metal-abyss-*` ramp), rotate(90deg), links
   to /dashboard. Rationale: brand rides every authenticated page via the
   nav; metal fill makes the logo part of the material language.

4. **Rail labels = hover/focus tooltips** floated right of the rail
   (`.nav-tip`); the dock's inline active-label reveal is hidden at rail
   widths. Cursor-tracking glow + active chip behavior unchanged.

5. **Hero/page widening.** With the rail on the left, `.dz` drops the
   centered 1100px `--container-max` at rail widths and spans
   rail-clearance → right gutter (`padding-left: inset + width + gutter`).
   Hero height stays 25vh (Arjun: "height is good").

6. **Real data: dashboard fixture now holds 8 real sets** (was 2). Pulled
   through the fixed pipeline from the DJ's real `master.sqlite`
   (home-library one — the USB's own master.sqlite is a 1-byte stub; Serato
   keeps history on the Mac). Added sessions 489/486/484/482/479/477 with
   their REAL `captured_sessions.id`s from the agent's local store
   (977/971/967/963/957/953) so ids stay faithful to the future Supabase
   read path. `export_real_fixtures.rs` SETS extended; Camelot recovery
   re-verified (177/178 on the Jun 21 reference gig). Fixture rebuilt via
   `build-fixture.mjs`.

### Process ruling (Arjun, mid-session; tightened after his second reminder)

Review sessions NOTE feedback here; implementation happens in a separate dev
session. NO live coding at all — including bug fixes (the 3d8662c rail-inset
fix was done before this ruling landed; nothing after it). If a bug blocks
reviewing, surface it and ask. Everything in "Queued" is agreed direction,
NOT built.

### Queued for next dev session

1. **Shell border glint sweep: slow it down.** Arjun likes the glint but it's
   "a tad bit too fast… ever so slightly distracting" — keep the effect,
   reduce speed. Knob: `animation: dz-glint-spin 3s linear infinite paused`
   on `.dz-shell::before` (dashboard.css, D3 block). Try 4.5–6s; consider
   slowing the companion `::after` shimmer (7.5s) proportionally so they stay
   in ratio. NOTE — the sweep only *runs* on hover/focus-within (rest state
   is a static arc slice). If what reads as "too fast" is motion at REST,
   the actual source is either the rail shader idle (speed 0.6 in
   FloatingNav.tsx) or the Silk backdrop — confirm with Arjun on the live
   page which layer he means before tuning.

2. **Nav rail corners: squarer.** "Less rounded corners so it's not an oval",
   to match the dashboard's component shells. Knob: `--nav-rail-radius`
   (tokens.css, currently 34px = full pill for the 68px rail). Try 20–24px;
   the plate follows automatically at −2px. Check the brand spine and
   top/bottom item clearances still breathe after the change.

3. **Shell border glint: dimmer as well as slower** (Arjun, after seeing it
   live). The sweep/arc colour stops are `--color-abyss-accent` /
   `--dz-glint-shine` on `.dz-shell::before` (dashboard.css D3 block) — dial
   brightness there (e.g. swap the accent stops toward `accent-soft` /
   introduce a dimmer glint-specific token in tokens.css) rather than
   opacity-ing the whole ring, so the hairline base stays.

4. **Nav rail tooltips → the calendar's day-chip treatment, exactly.** Arjun:
   the nav labels should use "the same exact way" the calendar shows
   sets-per-day on hover. That's the `.cal-chip` cursor-follow floating chip
   (GlassCalendar.tsx ~lines 19–35 & 215–230; styles `.cal-chip*` in
   dashboard.css ~1428–1465, project-showcase ref mechanics). Dev session:
   extract the chip into a shared primitive (surface, border, type scale,
   enter animation, cursor-follow) and render nav labels through it,
   replacing the current bespoke `.nav-tip` (globals.css). Note `.nav-tip`
   was a placeholder; delete its styles when swapping.

5. **Hero arc: gap handling** (from Arjun's "is the line graph even
   accurate?"). Finding: the DATA is faithful — e.g. the Jun 26 set (977) has
   71 real BPM points, 70→138 BPM — but the night contains six playback
   gaps of 15–35 min (pauses between 21:57→02:27), and `arcGeometry`
   (web/lib/sets/energyArc.ts) draws ONE continuous polyline across real
   timestamps with no gap awareness, so it manufactures long slopes/plateaus
   that were silence, not music. Continuous club sets (Jun 21 / 975) read
   fine; stop-start nights read as nonsense. Options for the dev session
   (pick with Arjun): break the polyline at gaps > N min (render segments,
   dim or dot the voids); or draw gap segments as faint dashed connectors;
   or clip the hero arc to the dancefloor window only. Also revisit the
   existing "arc rolling-median smoothing" open item together with this —
   same subsystem.

6. **Palette: ever-so-slightly more black, less blue** (Arjun; conditional on
   it still looking right). The Abyss surfaces read blue-heavy; nudge the
   base/raised/shell-glass tokens (`--color-abyss-base`, `--color-abyss-raised`,
   `--color-abyss-shell-glass`, tokens.css) a few points darker and less
   saturated — the silk backdrop and cyan accents keep the identity; the
   TRANSLUCENCY itself is approved as-is, don't touch the alpha. Pairs with
   item 11 (readability): re-check the texts he flagged after the shift.
   Claude's take, for the dev session: agree — a deeper, more neutral ground
   should improve both the "lot of blue" feel and text contrast without
   losing the look.
   > ✅ Landed 2026-08-03 (dev): shown live before commit; Arjun approved
   > ("looks good — commit it"). base #04070c→#04060a, shell #091018→#0a0e13
   > (+ shell-glass RGB tracks it), raised #0f1824→#0e131b — each darker + a
   > lower B:R ratio (less blue), elevation ramp preserved. Alpha FROZEN
   > (shell-glass stays `…e0`, 88%); cyan accents + Silk untouched. Pairs with
   > item 12 (readability re-check against the new ground, next).

7. **Add the shiny-ref dot-matrix layer to the shells.** Arjun overrules the
   polish-checkpoint omission ("lets add the dot matrix. i liked the buttons
   how they were in the reference"). Port the reference's dots pattern onto
   the `.dz-shell` surface (D3 block comment in dashboard.css records what
   was left out and why). Keep the original worry in view — dots over real
   content risked reading as noise — so build it, then review live at a low
   intensity first.
   > ✅ Landed 2026-08-03 (dev): the ref's exact dot tile (0.5px dot / ~5px
   > space, `radius(circle at 2px 2px, text, ink-0)`) rides a decorative
   > `.dz-dots` child on all 6 shells (both shell pseudos were taken by the
   > glint ring + shimmer). A radial fade concentrates the grain toward the
   > shell edges and off the central content (the ref's masked-slice idea, but
   > the button's conic slice looked wrong on wide panels). All token colours
   > (guard-safe). Shown to Arjun; he asked "slightly less visible" — dialled
   > 0.3 → **0.22** (`--dz-dot-opacity` on `.dz-shell`, the single knob).

8. **Search bar: same hover glow as the sort chips beside it.** The two
   filter/sort buttons right of the search field carry the cursor-tracking
   hover glow; `.dz-list-search` should get the identical treatment
   (SetListPanel.tsx, gooey-spotlight D6/D12 block).

9. **Expanded set card (.dz-sheet) is not contained by the panel** (Arjun's
   screenshots, 11:32/11:38): the sheet layers OVER the `.dz-list` shell's
   2px border and rounded corner — visible along the right side; the back
   arrow floats outside the card. Fix direction: clip/inset the sheet inside
   the shell (respect the shell's border inset + radius — e.g. contain
   within .dz-list-body with overflow clipping and `border-radius:
   calc(shell radius − 2px)`), so the card reads as inside the panel, not
   popped in front of it.
   > ✅ Landed 2026-08-03 (dev): the active sheet was `left: 0; width: 100%`
   > (flush to the shell's inner border, 0px gap both sides). Now `left: 8px;
   > width: calc(100% - 16px)` — the shell's border + 50px radius frame it as
   > a contained card (verified: 8px symmetric gap L/R). `.dz-list` already
   > clips at its inner radius, so the corners nest cleanly.

10. **Sheet header alignment + close-button order.** The "22 · 6h" meta in
    `.dz-sheet-end` is misaligned (baseline off vs the ×), and the × close
    currently sits LEFT of the meta (SetListPanel.tsx ~lines 214–228: close
    button renders before .dz-row-meta). Arjun: align the meta properly,
    then put the × to the RIGHT of it (order: `22 · 6h ×`).
    > ✅ Landed 2026-08-03 (dev): swapped the markup so `.dz-row-meta`
    > precedes `.dz-sheet-close` (renders `22 · 6h 11m ×`), and killed the
    > `.dz-sheet-end` `translateX(65px)` that had been shoving the meta past
    > the sheet's clip edge (that's why "6h 11m" was cut off). Verified: meta
    > full + left of ×, vertical centres aligned to 0px, nothing clipped.
    > ↳ SUPERSEDED same session (Arjun live, 2026-08-03): "this is perfect i
    > like it a lot" — he then reworked the whole header. The sheet's own date
    > header row (`.dz-sheet-row`/`-title`/`-end`/`-close`, the 2x date scale +
    > the -495deg close spin) is DELETED; date + `count · duration` now ride
    > inline in the panel action bar between the back arrow and Enter Set
    > (`.dz-actions-lead`/`-title`/`-date`). The close x is gone (back arrow
    > closes). The reclaimed ~88px goes to the tracklist (scroll region 197px
    > -> 285px, ~7 -> 10 rows). Also the pop read "a little laggy" — the 600ms
    > `--motion-duration-liquid-open` easeOutExpo crawled (measured a steady
    > 60fps, so perceptual, not jank); cut `.dz-sheet[data-active]` to 310ms
    > (liquid ease kept) and resynced the header fade (220ms/60ms) to land with
    > it.

11. **Sheet tracklist: fit + full scroll.** Track titles overflow the card's
    right edge mid-word (screenshot: "Flo Ri…", "Cama…" clipped past the
    container) — `.dz-sheet-track/.dz-sheet-artist` need real width
    constraints + ellipsis inside the card's padding. AND: replace the
    5-track "How the night opened" teaser with the full tracklist,
    scrollable WITHIN the tracklist area itself (own overflow-y region,
    hidden scrollbar per ref convention; the sheet/page must not scroll).
    > ✅ Landed 2026-08-03 (dev): listModel now exposes `tracklist` (every
    > play, title+artist, in order — replaces the 5-track `teaser`; heavy
    > wire fields still excluded). Sheet renders the full list in a scrollable
    > `<ol>` (`flex:1 1 auto; min-height:0; overflow-y:auto`, hidden
    > scrollbar) inside a flex-filled `.dz-sheet-info`; the bottom
    > gradient-blur doubles as the scroll-edge fade (96px bottom dead-space so
    > the last track clears it). Title/artist truncate with ellipsis
    > (`text-wrap: nowrap` — NOT `white-space`, which trips the
    > no-hardcoded-colors `\bwhite\b` guard). Verified: 154-track set scrolls
    > within its region, page/sheet do NOT scroll, 54 titles ellipsis-clip at
    > a 512px sheet with zero overflow past the edge.

12. **Text readability audit** (Arjun: "some of the text is a little bit
    hard to read due to the background color"). Likely improved by item 6's
    darker ground — after that lands, sweep the dimmer text tokens (row
    meta, stat labels, teaser artists) against the new surfaces and lift
    contrast where still muddy.
    > ✅ Landed 2026-08-03 (dev): all three flagged texts share one token,
    > `--color-abyss-text-45`. Measured live on the item-6 ground: row meta
    > 4.16:1, hero/stat labels 3.84:1 (worst case = the lighter hero-atmosphere
    > shell) — below AA 4.5 for normal text (the darker ground alone barely
    > moved semi-transparent white, ~+0.05). Lifted 45% → 52% (`#eaf3f873` →
    > `#eaf3f885`): now hero 4.63:1, rows 5.18:1, still the de-emphasized tier
    > below text-72. text-22 left as-is (decorative, not copy).

13. **Calendar hover chip clips at the card edge** (screenshot 11:47). The
    cursor-follow `.cal-chip` sits to the right of the cursor, so days in
    the right-hand columns cut it off mid-text at the shell edge. Arjun:
    "make it popup towards the center or something". Fix direction: clamp
    the chip inside the card bounds and/or flip it to the cursor's left
    (or bias toward card center) when near the right edge. Knobs:
    GlassCalendar.tsx chip positioning (chipRef mousemove writer, ~line
    216) + `.cal-chip` (dashboard.css ~1428).

14. **Right-column quiet-scroll hard-clips the shells** (same screenshot).
    Scrolled down, the calendar's top is a dead-straight cut — the tabs get
    sliced in half — because `.dz-right` (dashboard.css ~109–122) clips with
    no edge treatment. Arjun: "doesn't look natural". Fix direction: top +
    bottom edge-melt fade masks on the scroll region (same language as the
    list panel's bottom edge-fade) so shells dissolve instead of slicing.

15. **Weekly view: 8th day cell overflows the container** (screenshot
    11:48): weekly mode renders a cell ("8") outside the card's right
    border. GlassCalendar weekly layout must fit exactly the 7 visible days
    within the card padding — check the weekly grid's cell count/width math.
    > ✅ Landed 2026-08-03 (dev): `.cal-strip` dropped the `margin: 0 -22px`
    > bleed (it overshot the 18px card padding, pushing the strip's clip box
    > 2px past the shell border); `.cal-strip-day` now `flex: 0 0
    > calc((100% - 6 * var(--space-md)) / 7)` so exactly 7 columns fill the
    > padded content width and the rest scroll, clipped at the padding edge.
    > Verified live: 7 days fully within padding, zero cells past the border.

16. **Weekly↔Monthly switch: hard cut → sheet-pop motion.** The tab switch
    swaps views instantly; Arjun wants it smooth, explicitly "like how a set
    pops up when i click on it" — adopt the expanded-set-card's
    progressive-blur pop transition language for the calendar view change
    (GlassCalendar tabs; reuse the dz-sheet/gblur motion values, honoring
    reduced-motion).

17. **Confidence tile: reword.** Current copy: "100%" / "dancefloor
    detection · latest set" / "Sharpens as you correct the floor's edges."
    Arjun's direction: title along the lines of **"Dancefloor detection
    engine confidence"**, subline **"improves as you correct the sets
    edges"**. Dev session: apply his wording (light microcopy polish
    allowed — e.g. "Improves as you correct set edges" — run through
    writing-guidelines, but keep his phrasing intent; "engine confidence"
    is the point). Knob: ConfidenceTile.tsx.

18. **Equalize the confidence/odometer pair heights** (screenshot 11:56):
    the YOUR ARCHIVE odometer tile is visibly shorter than the confidence
    tile beside it; Arjun wants them the same size. Knob: `.dz-right-pair`
    (dashboard.css) — stretch both tiles to equal height (grid/flex
    stretch), re-balance the odometer's inner spacing so its content
    doesn't float in the extra room.

### Approved as-built (no change needed)

- Wordmark size on the rail spine ("the word mark size is good").
- Hero height at 25vh (confirmed first session); hero span rail→gutter.
- Shell translucency level (~88% glass) — approved 2026-08-03 ("i like the
  translucency the way it is"); item 6's palette shift must not change the
  alpha.
- Most Played card's Week/Month toggle — switch behavior approved as-is
  ("isn't bad. its fine to keep as is"); do NOT give it the calendar's new
  view-switch motion (item 16) unless Arjun asks later.

### Fixed live this session (bugs in committed work, not design changes)

- **Rail rendered flush against the screen edge** (Arjun's report; committed
  intent was a 20px inset). Root cause: Lightning CSS folds a
  `translate: none` override into the transform shorthand and silently
  deletes it (served as `transform: translate3d(0,0,0)`), so Tailwind's
  `-translate-x-1/2` (translate: -50%) kept dragging the 68px rail 34px
  off-screen. Fix: dock positioning moved off the Tailwind utilities into a
  complementary media range (`@media (width < 900.02px)`, served as
  `not (min-width: 900.02px)`) so nothing ever needs cancelling. Same
  silently-rewritten-modern-CSS family as the @property/setProperty bug.
- **Dock mode regression from the rail restructure**: the new
  `.nav-rail-items` wrapper was an unstyled block div below the breakpoint,
  stacking the dock into a broken 2-row blob. Fix: `display: contents` in
  dock mode (wrapper vanishes from layout); the rail block restyles it into
  the centered column.

### Decisions noted, not yet acted on

- **Glint arc terminology**: what Arjun likes on the hero graph is the arc
  spotlight (bright BPM segment). The shells' border glint arc is a separate
  open taste item — discuss during the shell-system pass.
- Ultrawide: `.dz` currently has no max-width cap at rail widths; revisit if
  it ever meets a >2000px viewport.
- Rail on the other authenticated pages (style-evolution etc.): clearance
  padding was only added to the dashboard's `.dz`; placeholder pages get
  theirs when their stories build them.

### Open taste items (carried from build session)

- Rest-state glint arc on shell borders (ref-faithful; may be loud).
- Shiny-ref dots layer omitted on glass shells.
- Arc rolling-median smoothing.
- ~88% shell translucency.
- Right column quiet-scrolls below ~950px-tall viewports (by design).
