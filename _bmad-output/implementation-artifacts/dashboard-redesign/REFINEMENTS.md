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

### Process ruling (Arjun, mid-session)

Review sessions NOTE feedback here; implementation happens in a separate dev
session. Only bugs in already-committed work get fixed live (to keep the page
reviewable). Everything below in "Queued" is agreed direction, NOT built.

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
