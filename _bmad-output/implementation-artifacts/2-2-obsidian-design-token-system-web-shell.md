# Story 2.2: Obsidian design-token system + web shell

Status: ready-for-dev

## Story

As a developer,
I want the Obsidian dark token system and a base web shell implemented as the first web surface,
so that every later screen — starting with auth — is styled against real tokens, not placeholders.

## Acceptance Criteria

1. **Given** the token set, **Then** background `#121415`, five surface-container elevation tiers, Electric Lavender primary, and the dusty-rose error family are defined as reusable tokens. *(UX-DR1)*
2. **Given** typography, **Then** Hanken Grotesk (headlines), Inter (body), and Geist mono (`mono-data`/`label-sm`) are wired to the type scale. *(UX-DR1)*
3. **Given** spacing/radius, **Then** a 4px baseline is used **And** `rounded.full` (9999px) is reserved exclusively for floating nav, avatar, and status dots. *(UX-DR1)*
4. **Given** the web shell, **When** rendered, **Then** it consumes only tokens (no hard-coded colors) and core text passes WCAG 2.2 AA. *(UX-DR21)*

[Source: _bmad-output/planning-artifacts/epics.md#Story 2.2, lines 384-397]

## Tasks / Subtasks

- [ ] Task 1: Color tokens (AC: 1)
  - [ ] 1.1 Create `web/app/tokens.css` with the **complete** Obsidian palette as CSS custom properties (`--color-*`) — all ~40 tokens from DESIGN.md's frontmatter, not just the AC-1-named subset. DESIGN.md explicitly treats `secondary`/`tertiary`/`*-fixed`/`inverse-*`/`surface-dim`/`surface-bright`/`surface-variant`/`background`/`on-background` as "reserved scaffolding, not dead weight" — define them too, just unused for now. See exact hex table in Dev Notes.
  - [ ] 1.2 Import `tokens.css` into `web/app/globals.css` (or directly in `layout.tsx`), and **remove** the existing `prefers-color-scheme` light/dark toggle — Obsidian is dark-only by explicit non-negotiable design constraint, there is no light theme.
  - [ ] 1.3 Add a code comment directly above `--color-primary` in `tokens.css` noting it's used sparingly (active nav state, focus glow, one "spark" moment per screen) — restraint is the point, not a hard rule to enforce in code, just a note for future consumers.

- [ ] Task 2: Typography (AC: 2)
  - [ ] 2.1 Create `web/app/fonts.ts` using `next/font/google`: load `Hanken_Grotesk` (weights `["500","600"]`, subsets `["latin"]`), `Inter` (weight `["400"]`, subsets `["latin"]`), `Geist_Mono` (weights `["400","500"]`, subsets `["latin"]`). Export each as a CSS-variable-producing font object (`variable: "--font-hanken-grotesk"` etc.) — confirmed available in the installed `next@16.2.10` Google Fonts metadata with all required weights, so no new dependency is needed.
  - [ ] 2.2 Apply all three font variable classNames to `<body>` (or `<html>`) in `web/app/layout.tsx`.
  - [ ] 2.3 Define the 7 type-scale steps as utility classes in `globals.css` (`.text-display-lg`, `.text-display-lg-mobile`, `.text-headline-md`, `.text-body-lg`, `.text-body-md`, `.text-label-sm`, `.text-mono-data`), each setting `font-family: var(--font-*)`, `font-size`, `font-weight`, `line-height`, `letter-spacing` per the exact table in Dev Notes.
  - [ ] 2.4 Note in a code comment: DESIGN.md's typography table lists `label-sm`/`mono-data` as plain "Geist," but Story 2.2's own AC-2 says "Geist **mono**" for both — treat both as Geist Mono (the AC is the binding acceptance criterion here; there's no separate non-mono "Geist" family needed).

- [ ] Task 3: Spacing & radius tokens (AC: 3)
  - [ ] 3.1 Add spacing tokens to `tokens.css`: `--space-unit: 4px`, `--space-xs: 4px`, `--space-sm: 8px`, `--space-md: 16px`, `--space-lg: 24px`, `--space-xl: 40px`, `--space-xxl: 80px`, `--space-gutter: 24px`, `--container-max: 1100px`.
  - [ ] 3.2 Add radius tokens: `--radius-sm: 0.125rem`, `--radius-lg: 0.25rem`, `--radius-xl: 0.5rem`, `--radius-full: 9999px`. Add a code comment directly on `--radius-full` flagging it's reserved **exclusively** for floating nav (Story 3.5, not built here), avatar, and status dots — do not use it for buttons/inputs/cards (those stay in the `sm`–`xl` range, "soft-industrial," no pill buttons). This mirrors a real bug the source Stitch export had (mis-set `full` to 12px) — verify the value is exactly `9999px`, not a smaller rem value.

- [ ] Task 4: Base web shell (AC: 4)
  - [ ] 4.1 Update `web/app/layout.tsx`: apply `--color-background`/`--color-on-background` (or `surface`/`on-surface`) to `<body>`, apply the three font-variable classNames from Task 2. Keep the existing Server Component (no `"use client"`) convention.
  - [ ] 4.2 Restyle `web/app/page.tsx`: replace every hard-coded inline `style={{...}}` value (hex colors, ad hoc rem/px numbers) with token-driven styling (CSS custom properties via `var(--token-name)`, or a `.module.css` file). **Preserve** the existing `@curfew/shared` contract-consumption code exactly as-is (`CONTRACT_VERSION`, `VISIBILITY`, `SyncPayload` import and usage) — this proves the shared/ contract works and must not regress.
  - [ ] 4.3 Fix the stale line in `web/README.md`: "The contract (`shared/`) is DRAFT and not frozen until Story 1.10 (AR-1)" — Story 1.10 is done and the contract is frozen; update this line to reflect that.
  - [ ] 4.4 Explicitly **out of scope**: the floating pill nav itself (`components.nav-floating`) is Story 3.5's job, not this story's — Task 3.2's `--radius-full` reservation is the only nav-related thing this story touches. Do not build nav markup/components here.

- [ ] Task 5: Tests (AC: 4 enforcement)
  - [ ] 5.1 Add `vitest` to `web/package.json` devDependencies, version-matched to `shared/`'s `^4.1.10` (already an established monorepo pattern — not a new library choice, just extending it to a workspace that didn't need it yet). Add a `"test": "vitest run"` script, matching `shared/`'s convention.
  - [ ] 5.2 Write `web/app/tokens.test.ts`: a small pure WCAG contrast-ratio helper (relative-luminance formula, no dependency needed) asserting the core-text token pairs meet AA (≥4.5:1 normal text): `on-surface` (`#e2e2e3`) vs `surface` (`#121415`) — expect ≈14.27:1; `on-surface-variant` (`#cac4d5`) vs `surface` (`#121415`) — expect ≈10.88:1. Both comfortably pass; this test guards against a future token-value edit silently breaking AA compliance (operationalizes AC-4's "core text passes WCAG 2.2 AA" as a durable, automated check rather than a one-time manual eyeball).
  - [ ] 5.3 Write `web/app/no-hardcoded-colors.test.ts`: a static-analysis guard (mirrors the existing `supabase/scripts/check-additive-only-migrations.sh` pattern of CI-enforced invariants over doc-only convention) that scans `web/app/**/*.{ts,tsx,css}` — excluding `tokens.css` and `fonts.ts` themselves — for hex-color literals (`#[0-9a-fA-F]{3,8}`) or `rgb(`/`hsl(` literals, failing if any are found. This durably enforces AC-4's "consumes only tokens, no hard-coded colors" for every future web/ change, not just this story's files.

- [ ] Task 6: Full gate
  - [ ] 6.1 Run `pnpm --filter web lint`, `pnpm --filter web typecheck`, `pnpm --filter web build`, `pnpm --filter web test` — all green.
  - [ ] 6.2 Run the repo-root gate: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` — confirm no regressions in `shared/` (13 tests) or elsewhere. Per the standing Epic-2+ rule, this must be actually run on this machine, not deferred to CI.

## Dev Notes

**This story is a project-wide "hub artifact."** Per epics.md's cross-cutting dependency-graph note (line 174), the Obsidian token system is one of only two hub artifacts in the entire project's dependency graph (the other is the `shared/` sync contract from Epic 1) — it's produced here and consumed by **every** web surface in Epics 3 through 7. Its most immediate consumer is **Story 2.4 (Auth UI components)**, sequenced directly after this one for that reason. The **one exemption**: Story 2.5 (agent tray UI) is deliberately native OS chrome and does NOT consume these tokens (UX-DR22/UX-DR23). Get the token surface right — downstream stories will build directly on whatever shape is chosen here.

**`web/` today is genuinely scaffold-plus-two-small-edits** — `layout.tsx` (title/description only) and `page.tsx` (a `@curfew/shared` contract-consumption proof, explicitly labeled "web app scaffold" in its own copy) are the only customizations since Story 1.1; `globals.css`/`package.json`/config files are untouched. There is currently **zero design-token system, zero CSS framework, zero component library** in `web/` — this story is greenfield. No architecture doc (ARCHITECTURE-SPINE.md, SOLUTION-DESIGN.md) prescribes an implementation format (Tailwind vs. CSS Modules vs. CSS-in-JS) — that decision is made in this story: **CSS custom properties, zero new styling dependency**, consistent with AR-16 ("no starter template") and EXPERIENCE.md's explicit "no inherited component library... custom token system (Material-3-style naming, not a dependency)."

### Full color token table (source: DESIGN.md frontmatter `colors:` block — this file is the spine/source of truth; if any Stitch import prose diverges, DESIGN.md wins)

| Token | Hex | Token | Hex |
|---|---|---|---|
| background | `#121415` | tertiary | `#c8c6c8` |
| on-background | `#e2e2e3` | on-tertiary | `#303032` |
| surface | `#121415` | tertiary-container | `#989799` |
| surface-dim | `#121415` | on-tertiary-container | `#303032` |
| surface-bright | `#38393a` | tertiary-fixed | `#e4e2e4` |
| surface-container-lowest | `#0c0e0f` | tertiary-fixed-dim | `#c8c6c8` |
| surface-container-low | `#1a1c1d` | on-tertiary-fixed | `#1b1b1d` |
| surface-container | `#1e2021` | on-tertiary-fixed-variant | `#474649` |
| surface-container-high | `#282a2b` | error | `#ffb4ab` |
| surface-container-highest | `#333536` | on-error | `#690005` |
| surface-variant | `#333536` | error-container | `#93000a` |
| surface-tint | `#cbbeff` | on-error-container | `#ffdad6` |
| on-surface | `#e2e2e3` | outline | `#938e9e` |
| on-surface-variant | `#cac4d5` | outline-variant | `#484553` |
| inverse-surface | `#e2e2e3` | primary | `#cbbeff` |
| inverse-on-surface | `#2f3132` | on-primary | `#330b91` |
| secondary | `#c8c6c7` | primary-container | `#9d85ff` |
| on-secondary | `#303031` | on-primary-container | `#330a90` |
| secondary-container | `#49494a` | primary-fixed | `#e7deff` |
| on-secondary-container | `#bab8b9` | primary-fixed-dim | `#cbbeff` |
| secondary-fixed | `#e5e2e3` | on-primary-fixed | `#1e0061` |
| secondary-fixed-dim | `#c8c6c7` | on-primary-fixed-variant | `#4a2ea7` |
| on-secondary-fixed | `#1b1b1c` | inverse-primary | `#6349c0` |
| on-secondary-fixed-variant | `#474647` | | |

The 5 surface-container elevation tiers (AC-1) are: `surface-container-lowest` → `surface-container-low` → `surface-container` → `surface-container-high` → `surface-container-highest`. No drop shadows anywhere in this design — depth comes from tonal layering plus hairline borders in `outline-variant` at ~30% opacity.

### Typography table (source: DESIGN.md frontmatter `typography:` block; font availability verified directly against installed `next@16.2.10`'s Google Fonts metadata — all 3 families and all needed weights confirmed present, zero new dependency)

| Token | Font | Size | Weight | Line-height | Letter-spacing |
|---|---|---|---|---|---|
| display-lg | Hanken Grotesk | 48px | 600 | 1.1 | -0.02em |
| display-lg-mobile | Hanken Grotesk | 32px | 600 | 1.2 | -0.01em |
| headline-md | Hanken Grotesk | 24px | 500 | 1.3 | — |
| body-lg | Inter | 18px | 400 | 1.6 | — |
| body-md | Inter | 16px | 400 | 1.5 | — |
| label-sm | Geist Mono | 12px | 500 | 1.0 | 0.05em |
| mono-data | Geist Mono | 14px | 400 | 1.4 | — |

`[ASSUMPTION]` — no breakpoint pixel value is defined anywhere in DESIGN.md/EXPERIENCE.md for switching `display-lg` → `display-lg-mobile` (only qualitative "fluid tablet/phone" language + the one hard number, `container-max: 1100px`, exist). Use `640px` as the switch point via a media query on `.text-display-lg`. Flag this as an assumption for Arjun to confirm later, same pattern as Story 1.8's threshold flagging — do not treat it as settled.

### Spacing/radius (source: DESIGN.md frontmatter `spacing:`/`rounded:` blocks)

Spacing: `unit 4px, xs 4px, sm 8px, md 16px, lg 24px, xl 40px, xxl 80px, gutter 24px, container-max 1100px`.
Radius: `sm 0.125rem (2px), lg 0.25rem (4px), xl 0.5rem (8px), full 9999px`. Structural elements (buttons/inputs/cards/chips) use `sm`–`xl` only — no pill buttons. `full` is exclusively for floating nav / avatar / status dots (not built in this story except as a reserved token).

### WCAG contrast verification (computed directly, WCAG relative-luminance formula — not sourced from a doc, since EXPERIENCE.md itself flags this as "not yet verified")

- `on-surface` (`#e2e2e3`) vs `surface` (`#121415`): **14.27:1** — passes AA (4.5:1) and AAA (7:1).
- `on-surface-variant` (`#cac4d5`) vs `surface` (`#121415`): **10.88:1** — passes AA.
- `outline` (`#938e9e`) vs `surface` (`#121415`): **5.81:1**.
- **Not required by this story's AC-4, flagged for awareness only:** the lavender focus-ring glow at ~20% opacity is explicitly called out in EXPERIENCE.md as "worth a dedicated check" and is NOT yet verified — that's a focus-state concern for whichever story first builds interactive/focusable components (likely Story 2.4), not this story's shell/text scope.

### Project Structure Notes

**New files:**
- `web/app/tokens.css` — full color/spacing/radius token definitions.
- `web/app/fonts.ts` — `next/font/google` loader instances for the 3 font families.
- `web/app/tokens.test.ts` — WCAG contrast-ratio unit test.
- `web/app/no-hardcoded-colors.test.ts` — static-analysis guard test.

**Updated files (read these completely before editing — current contents captured below):**
- `web/app/layout.tsx` — currently just sets `<title>`/`<meta description>`, no fonts/tokens applied. Add token/font wiring; keep the Server Component shape.
- `web/app/page.tsx` — currently proves `@curfew/shared` consumption via inline `style={{...}}` (hardcoded hex/rem). Must keep the `CONTRACT_VERSION`/`VISIBILITY`/`SyncPayload` usage intact while removing all hardcoded style values.
- `web/app/globals.css` — currently just two ad hoc CSS vars (`--background`/`--foreground`) with a `prefers-color-scheme` toggle, falling back to `Arial, Helvetica, sans-serif`. This whole light/dark toggle is superseded by the dark-only Obsidian tokens.
- `web/README.md` — has one stale line about the contract still being DRAFT; fix it.
- `web/package.json` — add `vitest` devDependency + `test` script.

**No consumer conflicts:** Story 2.1 (just completed) touched only `supabase/` + CI — confirmed zero changes to `web/`, so there's no interference between that story and this one. `agent/` and `shared/` are untouched by this story.

**Out of scope (do not build here):** the floating pill nav component itself (Story 3.5), any auth UI (Stories 2.3a–2.4), any dashboard/landing/marketing pages (Epics 3/6), any Supabase/`supabase-js` wiring in `web/` (still not needed — no web screen calls Supabase yet; that's Story 2.10/3.2 territory).

### Testing standards summary

No frontend test framework existed in `web/` before this story (`vitest` exists only in `shared/`). This story establishes it in `web/`, matching the existing monorepo convention rather than introducing a new one. Tests are co-located next to source (`*.test.ts` beside the file it covers), matching `shared/src/index.test.ts`'s pattern. The "no hardcoded colors" guard follows the same CI-enforced-invariant philosophy already used for `supabase/scripts/check-additive-only-migrations.sh` (Story 2.1) and the schema-parity guard (Story 1.10) — static analysis over doc-only convention.

### References

- [Source: _bmad-output/planning-artifacts/epics.md, lines 384-397 (Story 2.2 verbatim), line 98 (UX-DR1 canonical definition), line 127 (UX-DR21 accessibility floor), line 174 (hub-artifact dependency note), line 191 (Epic 2 FR/AR/UX coverage)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-name-pending-2026-07-19/DESIGN.md#Colors, #Typography, #Layout & Spacing, #Shapes, #Elevation & Depth]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-name-pending-2026-07-19/EXPERIENCE.md#Foundation, #Accessibility Floor, #Responsive & Platform]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md, line 90 (AR-16, no starter template), line 278 (source tree)]
- [Source: _bmad-output/implementation-artifacts/2-1-supabase-cloud-foundation-isolation-baseline.md#Dev Notes, #Project Structure Notes — confirms web/ untouched by 2.1]
- [Source: web/app/page.tsx, web/app/layout.tsx, web/app/globals.css, web/package.json, web/README.md — read directly, current state as of baseline]
- [Source: web/node_modules/next/dist/compiled/@next/font/dist/google/font-data.json — verified directly against installed next@16.2.10: Hanken Grotesk, Inter, Geist Mono all present with weights 400/500/600 available]
- [Source: shared/package.json — vitest ^4.1.10 already an established monorepo devDependency]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
