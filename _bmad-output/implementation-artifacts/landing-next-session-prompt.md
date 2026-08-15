# Next-session prompt — landing page

Rewritten 2026-08-14 at the end of the mobile pass. Copy the block below into a
fresh session.

---

I want to keep working on the **landing page** (`/`). Here is the state, so you
do not rediscover it.

## Start here: the page's primary CTA does nothing

`LandingActions` in `Beats.tsx` renders
`<MetalButton mode="text" label="Start your archive" />` with **no `href` and no
`onClick`**. `MetalButton` falls back to a plain `<button type="button">` when
there is no href, so the button presses, ripples, runs its shader — and
navigates nowhere. It is live on `curfew.vip` right now, in all three
placements: the hero, the pinned stepper, and the close.

Verified on prod, not inferred: the hit targets render as `BUTTON` with
`href: null`, and clicking leaves the URL on `https://curfew.vip/`.

The fix is one prop, but the destination is a real decision and it is tangled up
with the open question about signup below — the secondary CTA already goes to
`#features`, and `Join` in the nav goes to `/login?intent=join`. Ask me where
"Start your archive" should land before wiring it.

## Where it stands

Shipped and live on `curfew.vip` as of commit `3c8cbf9` (deployment
`dpl_GRSbtNfqHZCCrLMrpYL6JAXSBM75`), pushed to `origin/main`.

An earlier session (`936ae8e`) landed three things:

1. **A drifting WebGL mesh behind the whole page** — `MeshDrift.tsx`, mounted
   once in the marketing layout, `position: fixed`, one context for all beats.
2. **The resting horizon stopped reading as a rule ruled across the page** —
   the ribbon's band now dissolves at its ends and feathers its cross-section
   while flat, both keyed to amplitude so they cost nothing once you scroll.
3. **A nav bar the hero's wordmark flies into** — `LandingNav.tsx`.

**The mobile pass (2026-08-14, deployed).** Three things Arjun called out
looking at the site on a phone, all fixed and all verified in a real browser
against `curfew.vip` itself:

1. **"The ribbon doesn't animate nicely on mobile, it looks 2d and plain."**
   It was not the ribbon — every phone was getting the SVG fallback, which has
   no thickness, no lit cross-section, no rotation and no bead riding a moving
   surface, because a 2D path cannot have them. The width test lived inside
   `useCanRender3D`, which was never a capability question. Phones now run the
   real ribbon; `COMPACT_FIT` in `ArcRibbonCanvas.tsx` refits it to a portrait
   viewport with a scale group under the rotation, and width now decides only
   the arrangement (no POI stems, the `.lp-now` line instead of the 24ch
   column). Scarce memory still falls back to the SVG.
2. **"The videos do not play, they just look like screenshots."** They were
   screenshots: `narrow` fed the same flag as `reduced`, so phones got the
   poster and no `src`. Each film now ships a `-720` cut (660 KB against the
   master's 3.4 MB, `web/scripts/encode-landing-film.sh`), fetched only once the
   beat is within a screenful. Save-Data still gets the poster.
3. **"Make the menu animation when i tap it better."** It had none — the sheet
   toggled `display`, which cannot be transitioned in either direction. It now
   grows from the menu button and collapses back into it, materialising
   (blur + scale together) with the links landing after the surface.

## The files

- Route: `web/app/(marketing)/page.tsx`, layout `(marketing)/layout.tsx`
- `web/app/components/landing/` — `MeshDrift` (575), `ArcRibbonCanvas` (633),
  `ArcRibbon` (443), `Beats` (425), `LandingNav` (209), `arc-curve.ts` (213)
- CSS: `web/app/landing.css` (~1,540 lines), all scoped under `.lp-root`
- Story doc: `_bmad-output/implementation-artifacts/6-1-landing-page-design.md`

## The knobs, so you do not go hunting

| What | Where |
| --- | --- |
| Mesh strength | `--lp-mesh-opacity` on `.lp-root` (currently `0.55`) |
| Mesh look | `UNIFORMS` in `MeshDrift.tsx` — `vignette 0.3`, `brightness -0.02`, `blur 0`, `drift 0.148`, `timeScale -1.373` |
| Mesh colours | `PALETTE_TOKENS` in `MeshDrift.tsx` — reads `--landing-*` from `:root` at runtime |
| How far the logo travels | `DOCK_FRACTION` in `LandingNav.tsx` (`0.32` of viewport height) |
| Resting horizon | the `ends` / `body` falloffs at the end of `BAND_FRAGMENT` in `ArcRibbonCanvas.tsx` |
| Stage length | `.lp-stage { height: 210vh }` — everything scroll-linked reads one normalized progress, so changing this retimes all of it together. 190vh on a phone |
| Phone ribbon fit | `COMPACT_FIT` + `COMPACT_FILL` in `ArcRibbonCanvas.tsx` — height, rest position, pitch/yaw, and the share of the visible width the night gets |
| Phone film weight | `scripts/encode-landing-film.sh` — 720w, 30fps, crf 30. `phoneCut()` in `Beats.tsx` derives the name, so a master without its pair 404s on a phone |
| Menu motion | `.lp-nav-sheet` / `.lp-nav-menu` in `landing.css`; the sheet is never `display: none` at phone widths, it is hidden by state and `inert` |

Two decisions worth not re-litigating. **`--landing-ribbon-crest` is
deliberately NOT in the mesh palette** — it is a near-white, every palette entry
is a blob with its own drifting centre, and one crest blob kept sliding under
the headline. **The mesh's blur is deliberately 0** — any value above zero takes
the shader's 5-tap branch, so every pixel shades five times; measured over
840,000 pixels the difference between the recipe's `0.0072` and `0` is a max of
3/255 and a mean of 0.02. Invisible, for five times the fragment cost.

The hero's radial atmos pool (`.lp-stage-sticky::before`) is **off** while the
mesh is on trial — it painted opaque `--landing-atmos` over the middle 78% of
the hero. The old value is preserved in a comment if the mesh gets cut.

## Getting it on screen — the trap is gone, here is what replaced it

```
cd web && NEXT_PUBLIC_SUPABASE_URL=https://jmitbnrofacxwsbwuxzs.supabase.co \
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_CfphUR54pE8y4RkDWhg2LA_IaWkLWPe \
  pnpm build && pnpm start -p 3033
```

The landing needs no auth and no data, but `NEXT_PUBLIC_*` are inlined at build
time, so they must be present *before* `pnpm build`. Measure against a
production build — `next dev`'s HMR websocket noise makes "zero console errors"
meaningless. Ports 3000/3007/3010/3031/3033 are usually other sessions; never
kill a server you did not start.

**You CAN see the page animate.** The previous version of this section said all
three routes were blocked — Playwright MCP profile-locked, claude-in-chrome
frozen in a background tab, computer-use waiting on macOS permissions. All three
were, and it did not matter: Playwright itself is sitting in the npx cache with
its browsers already downloaded. Drive it directly and every one of those
problems disappears, because a fresh launch owns its own profile and headless
Chromium runs rAF and WebGL normally.

```js
// scratch .mjs, run with plain `node` — nothing to install
import { chromium } from "/Users/arjun/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
const browser = await chromium.launch({
  headless: true,
  // WebGL in headless needs this, or three.js silently gets no context
  args: ["--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  isMobile: true, hasTouch: true,   // hasTouch is what makes .tap() work
});
```

Check the cache path still resolves first (`ls ~/.npm/_npx/*/node_modules/playwright`)
— the hash changes if npx re-resolves. What this buys, all of it used this
session: scroll-linked shaders actually render; `getComputedStyle` read
mid-transition returns real interpolated values, so an animation can be *proved*
rather than argued for; `addInitScript` can fake `navigator.deviceMemory` to
force the SVG fallback; several contexts sweep several viewports in one run.
Write the scripts and screenshots to `$CLAUDE_JOB_DIR/tmp` — screenshots left in
the repo get committed.

Do NOT run `npx prettier` on anything here. It is not a project tool (no config,
not a dependency) and it reformats whole files into diff noise.

## Work owed — nothing outstanding from the desktop pass

All three items that stood here have been observed in a real frame-producing
browser and are settled:

- **The nav travel.** Watched under a real scroll at 1440 and at 390. The mark
  starts at exactly the hero wordmark's rect — `dx=0 dy=0 dw=0` at both widths —
  and docks. The grid change described below did not disturb it.
- **The phone viewport.** No longer inferred: verified at 430×932, 390×844,
  360×640 and 320×568, upright and at the end of the turn.
- **The horizon fix.** Observed. It reads as a line of light arriving from
  somewhere rather than a rule across the page.

## Constraints that will bite

- **Tokens only.** `app/no-hardcoded-colors.test.ts` fails the build on any
  hex/rgb/hsl/named colour outside `tokens.css`, **including inside comments**.
  It reads the "white" in `white-space` as a colour — use `text-wrap: nowrap`,
  and never write a colour word in a comment.
- **Lightning CSS silently rewrites two things** (Next 16 + Tailwind v4):
  `setProperty` on a registered `@property` is ignored — use an unregistered
  custom property driven from rAF, which is exactly what `--lp-dock` is — and
  `translate: none` gets folded into `transform` and deleted.
- **The React compiler is on.** No `setState` inside an effect (lint enforces
  it — write DOM flags to the element instead, as `LandingNav` does with
  `data-travel`), and a hook must not mutate a ref passed in as an argument.
- **`MetalButton` is WebGL-context-limited** (~16/page). The landing spends
  three: hero, stepper, closing. The mesh spends a fourth and the ribbon a
  fifth. The nav's Join is deliberately CSS chrome, not real metal.
- **D-2 gives this page a motion budget the rest of the app does not have.**
  UX-DR16 still holds everywhere behind the login — do not port anything here
  across to a logged-in surface.
- Centre-aligned pills move when their contents change size. `LandingNav`'s
  46px bug was measuring the mark's base rect in the docked state; measure it
  in the collapsed state and the two lerps cancel.
- **`.lp-nav` is a grid, not a centred flex column, and that is load-bearing.**
  The bar and the sheet share one track sized to the bar's content, which is
  what makes the sheet exactly as wide as the pill — and therefore what puts its
  top-right corner on the menu button, which is the whole reason the open reads
  as growing out of the thing you tapped. Give the sheet its own width and the
  anchoring is gone.
- **A world unit is a fixed share of the viewport's HEIGHT, on every device**
  (the camera never moves; the viewport is always 3.30 units tall). That is why
  `BAND`, the bead's radius and the group's resting y need no phone variant. The
  visible WIDTH is the aspect's business — phone aspects run 0.42 to 0.56, a
  third of a viewport apart, so anything sized across the screen has to be
  measured from `size`, never chosen as a constant.

## Open questions I have not ruled on

1. The mesh is a full-screen shader that never leaves the viewport, so unlike
   the ribbon it runs for the whole page. Cutting the blur removed the worst of
   it, and the phone ceiling is now 1.1M pixels rather than 2M — taken because
   the phone runs a second live context in front of it. Still open if it needs
   more: pause it once the hero is past, or skip it on `deviceMemory < 4` the
   way `ArcRibbon` already does. **No real frame trace exists yet, and the phone
   pass was run in headless Chromium on a laptop — nothing here has been
   measured on actual phone silicon.** That is the one claim on this page I
   would not make.
2. Beat 04's step 04 ("The library") plays Style Evolution footage —
   `styleevo1.mp4` never leaves that screen. `library.jpg` is still in
   `public/landing` if it should go back to a still.
3. FAQ is a dimmed, inert label in the nav until an FAQ page exists. When it
   does, it becomes a `<Link>` — one line in `LandingNav.tsx`.
4. Subscription surface. `Join` goes to `/login?intent=join` (signup mode) on
   purpose: pricing belongs on its own surface *after* a DJ has seen one of
   their own nights, not on the signup form. Nothing for it exists yet.
5. Cloudflare proxies `curfew.vip` (orange cloud), so Vercel sees Cloudflare's
   IPs and Analytics/BotID/Firewall are degraded. Unresolved by choice.
6. The phone stage is 190vh, up from 150. 150 was argued from what the phone
   had — no rotation to spend the travel on — and it now has one. 190 is a
   guess at the new right answer, not a measured one.
7. The phone composition is bottom-weighted: caption in the top fifth, arc from
   roughly 29vh to 52vh off the bottom, status line under it. There is a real
   void between the caption and the crest. It reads as atmosphere against the
   mesh, but it has not been ruled on.
8. **Signup is open on a page that is publicly linked.** Raised 2026-08-14:
   Arjun asked to "disconnect the login/signup page — you can see the supabase
   from there," then, on the facts, decided not to. Recording both halves so
   this is not re-litigated from scratch:

   *The Supabase exposure is a non-issue and disconnecting `/login` would not
   have addressed it anyway.* The project URL and key live in a SHARED chunk
   (`3q_eq1q082l6_.js`) that `/` requests too, so they are already visible from
   the landing page. And the key is `sb_publishable_` — the anon key, designed
   to ship to browsers. Security advisors against prod returned no ERROR-level
   findings and no anon-readable tables. The only warnings are four
   `SECURITY DEFINER` functions callable by *signed-in* users (`sync_set`,
   `sync_library_roster`, `sync_library_add_events`, `set_agent_status`) and
   leaked-password protection being off; neither is reachable anonymously.

   *What IS open:* `enable_signup = true` and `/login` is linked from the nav in
   two places, so a stranger who finds `curfew.vip` can create a real row in
   `auth.users` today. Nothing in the DB is at risk — this is a launch-timing
   question, not a security one. **Prod's actual setting was never confirmed**,
   because checking it from the outside means creating an account. Look in the
   Supabase dashboard, and remember prod carries an auth allow-list that
   `supabase config push` would destroy — the local `config.toml` is not
   evidence of what prod does.

   If the answer is "not yet": turning signup off in Supabase closes it however
   someone reaches the page, which unlinking the nav does not. The unlink was
   scoped and not built — nav `Log in` and `Join` still point at `/login`.

## Gates and deploy

From `web/`: `pnpm lint`, `pnpm typecheck`, `pnpm test` (862 tests, ~6s). All
green at `3c8cbf9`. If typecheck reports a missing `app/page.js` or a stale
route, delete `.next/dev` — leftover generated route types, not real errors.

`git` on PATH is 2.15 and too old for `rev-parse --abbrev-ref`-era flags and
`worktree remove` — use `/usr/bin/git` (2.39).

Deploy is **CLI, not git**: `vercel deploy --prod --yes` from the **repo root**
(the link file is at the root; Root Directory is `web`). It uploads the local
working tree, so **commit first** or prod ships code with no matching commit;
then push, so GitHub matches what is running. Never run `supabase config push`
— it would wipe the production auth allow-list.

**What I actually want to do:** _(replace this line — the mobile pass it used to
describe is done and shipped. Start from the CTA at the top unless you have
something else in mind.)_
