---
baseline_commit: 29afe0ef446849dc14f06ce7005978a242463143
---

# Story 3.6: Dashboard home (+ the stat-correctness fixes that make it real)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- SCOPE NOTE (Arjun, 2026-08-02): this story was deliberately widened past the epics.md "Dashboard home" line. The dashboard is only worth opening if the stats it shows are *usable and true*, so the agent-side data-correctness fixes that feed it (Camelot key recovery, genre source re-check, local backfill) are folded into THIS story, not split off. Downstream stories (3.7 / 3.8 / 5.1 / 5.2) also had details decided this session; those were written back into epics.md so nothing is lost — see "Downstream decisions recorded" in Dev Notes. -->

## Story

As a DJ,
I want a dashboard that shows my recent sets as cards with **accurate, usable** stats — keys that are actually there, genres read from the right place, and numbers drawn from the part of the night that was the dancefloor, not the warm-up or dinner —
so that the morning after a gig I land somewhere that reflects my night and is worth opening, the way a runner opens Strava (UJ-1, SM-2).

## Acceptance Criteria

### A. Dashboard surface (the epics.md 3.6 ACs, revised)

1. **Set cards.** Each synced set renders as a Card-Reflection card: hairline border, no shadow, **mono date + session-id header**, genre chips, energy-arc thumbnail. Clicking **anywhere** on the card opens Set Detail at `/set/[id]`. *(UX-DR4, UX-DR13, UX-DR17)*
2. **Cold state.** With no sets, the cold dashboard renders — positive-framed, After-Hours Archive console voice, **no error tone**. This is the day-one launch experience for every new user (Decision A: go-forward-only, sparse-first), so it is a first-class state, not a fallback. *(UX-DR19 cold dashboard)*
3. **Passive NEW marker (REVISES the epics.md Add/Skip nudge).** A set that is synced but **not yet opened** shows an inline marker: lavender @20% border, pulsing lavender dot, "NEW SET DETECTED". **There is no Add button** — sets appear automatically (they already auto-sync). Opening the set clears the marker; the "seen" state persists **client-side, per-set**, and never re-prompts. Never a modal, never a push. Deletion (AC 12) is the only removal path. *(revises UX-DR5; keeps UX-DR19/UX-DR20 non-modal/non-push)*
4. **Fixed app-shell scroll.** The dashboard page itself **does not scroll** — it is locked to the viewport (`100dvh`, not `100vh`, so mobile browser chrome never clips the frame). Only the set list scrolls, **inside its own bounded region**. The floating nav and any header stay put. Layout is the fixed centered 1100px grid adapting fluidly to tablet/phone. *(UX-DR22; Arjun 2026-08-02)*
5. **Card depth (exact allocation).** The card face shows ONLY: mono header · energy-arc thumbnail · 2–3 genre chips · **set length** + **track count**. Everything else in the derived blob (most-played tracks/artists, BPM distribution, Camelot mixing stats, full annotated chart, tracklist) is **reserved for Set Detail (3.7)**. The card is the glance; the click earns the depth. *(Arjun 2026-08-02)*

### B. Dancefloor v0 — basic detection from the jump

6. **Suggested dancefloor segment, computed at render from `plays[]`.** A basic detector (global-heuristic v0) buckets the set into ~10-minute windows, scores each on play-density + median BPM, takes the **longest contiguous run** of windows clearing simple floors as the dancefloor, and merges small gaps. It yields **zero, one, or several** candidates and **falls back to the whole set** when nothing qualifies or the qualifying run spans essentially the whole night (never force exactly one). *(AR-13 shape)*
7. **Stats reflect the dancefloor.** The card's length / track-count / genre / and the emphasized region of the arc thumbnail reflect the detected dancefloor segment (recomputed from `plays[]`), so numbers are "not clouded by unrelated tracks" (Arjun). The arc thumbnail still draws the **full night** with the dancefloor window emphasized.
8. **Explicitly interim.** v0 uses **global** density/BPM floors. AR-13 mandates **per-DJ-calibrated** floors ("never a global constant") — that calibrated version is **Story 5.2** and supersedes v0. This story ships the interim knowingly and the code/comment must say so (do not silently ship a global constant as if it were AR-13-final). *(AR-13, tracked interim)*

### C. Stat-correctness fixes (agent / Rust — the data feeding A & B)

9. **Camelot key recovery.** The Serato-4 joiner must read Serato's canonical **`key_value` INTEGER** column (not, or in addition to, the mixed free-text `key`) and map deterministically:
   - `key_value == -1` → no key (`None`)
   - else `number = (key_value % 12) + 1`; `letter = key_value < 12 ? 'A' : 'B'`
   
   This recovers ~94% key coverage (was ~12% on real data — see Dev Notes). The false premise *"key is already Camelot notation at the source (findings §3)"* in `joiner/mod.rs:30` and the `JoinedMetadata.key` doc is retired/corrected. A capture-path test asserts a musically-notated Serato library (`Em`, `Ebm`, `G#m`…) yields populated Camelot keys, not `None`. *(FR-6 harmonic mixing; fixes Story 1.4/1.8 assumption)*
10. **Genre source re-check.** Before trusting the ~50%-untagged genre rate observed in real data, verify we read genre from the **richest available Serato source** (compare `history_entry.genre` vs the library `asset` genre, and the embedded-tag fallback). If a richer source exists, read it; if ~50% is genuinely the ceiling, record that finding so the UI's genre-chip fallback is designed against truth, not a bug. *(FR-8 / AD-12; investigation-then-fix)*
11. **Backfill the already-captured sets.** Re-derive the **491 already-captured local sets** from retained raw (`captured_sessions.raw_ref` → the live Serato `master.sqlite#<session_id>`) through the **fixed** joiner, overwriting `plays_json` / `derived_json` so historical sets carry correct keys/genres. Idempotent, no data loss; uses Story 3.4's retained-raw backfill mechanism. (Nothing is cloud-synced yet — `synced_at` is NULL for all rows — so this is purely local re-derivation.) *(NFR-4, Story 3.4 backfill; AR-2 idempotency)*

### D. Data source + real fixture

12. **Delete a set.** A DJ can delete a set (the removal path that replaces the old "Skip"). For this story the affordance and its calm, non-alarm confirm live on **Set Detail (3.7)**; 3.6 must not block it (the `/set/[id]` route exists) but need not implement the deleted-state re-render beyond removing the row from the local data source. Semantics: hard-delete the local captured row (and, once cloud sync exists, the cloud row) — **not** a visibility flag. *(new requirement, Arjun 2026-08-02)*
13. **Render from real data, not lorem-ipsum.** Extract real set(s) from the agent's `local.sqlite` (`~/Library/Application Support/app.curfew.agent/local.sqlite`, e.g. set **975** = 5.9h / 178 plays / confidence 1.0, plus a 1-play soundcheck like id 17577 to exercise low-confidence + sparse states) and commit them as a **wire-shape JSON fixture** in `web/` (epoch → ISO conversion at build time per the frozen contract). The dashboard reads through a **data-access seam** that later swaps the fixture for the Supabase read path without touching components. *(Decision A sparse-first; SM-1)*

### E. Liquid-metal CTA + voice/a11y

14. **Liquid-metal button component.** Install `@paper-design/shaders`; add the liquid-metal button to `app/components/ui/` (new dir — the shadcn `ui` alias target). Adapt it: `'use client'`, dynamic import with `ssr:false`, **reduced-motion path** (freeze the shader via `setSpeed(0)` and drop the ripple under `prefers-reduced-motion`), move its `document.head` `<style>` injection into `globals.css`, and map its colors to Obsidian tokens (decide: true-chrome vs lavender-tinted — a **new material** in the palette). It is a **designated hero/CTA** component used where a primary CTA exists (Arjun wants it in-product too, not only marketing); it is **WebGL-context-limited (~16/page)** so it is used at 1–2 hero moments, **never** as a general Button variant. *(Arjun 2026-08-02 design direction)*
15. **Voice, motion, a11y.** All copy uses the After-Hours Archive console voice; **no** streak counters / celebratory badges / "crushing it" / exclamations; no scroll-driven or celebratory motion on this logged-in surface; WCAG 2.2 AA holds; the energy-arc thumbnail has a text-equivalent. *(UX-DR18, UX-DR20, UX-DR21 — SM-C2 non-negotiable)*

## Tasks / Subtasks

- [x] **Task 1 — Fix Camelot key capture (agent/Rust)** (AC: 9)
  - [x] Add `key_value` to the `history_entry` SELECT in `agent/src-tauri/src/joiner/serato4.rs:135` and to the test-harness schema/inserts (`serato4.rs:172-196`, and the three ad-hoc schemas at ~392/430/477).
  - [x] Map `key_value` → Camelot on the library-join path: `-1 → None`; else `format!("{}{}", (v % 12) + 1, if v < 12 {'A'} else {'B'})`. Prefer `key_value` as source of truth; keep the free-text `key`/embedded-tag path only as fallback for sources without `key_value`.
  - [x] Correct the false doc premise in `joiner/mod.rs:30` and `JoinedMetadata.key`'s doc comment ("already Camelot notation at the source (findings §3)").
  - [x] Test (capture-path, layer 1): a musically-notated Serato library (`Em`, `Ebm`, `G#m`, plus a `-1`) yields populated, correct Camelot keys and one `None` — asserting the 24/24 mapping, not string round-trips. This is the regression that would have caught the incident.
- [x] **Task 2 — Genre source re-check (agent/Rust)** (AC: 10)
  - [x] Compare genre fill/quality between `history_entry.genre` and the library `asset` genre for real data; document which is richer.
  - [x] If `asset` (or a join to it) is materially richer, read from there; otherwise record the ~50%-untagged rate as a real ceiling in Dev Agent Record so the UI fallback is designed against truth. Respect Story 1.6 normalization (raw + normalized + `taxonomy_version`).
- [x] **Task 3 — Backfill captured sets (agent/Rust)** (AC: 11)
  - [x] Re-derive every `captured_sessions` row from its `raw_ref` through the fixed joiner + stat engine; overwrite `plays_json`/`derived_json`. Idempotent; skip rows whose raw source is unreachable (drive unplugged) rather than corrupting them.
  - [x] Reuse Story 3.4's backfill entry point rather than a new mechanism. Verify on set 975: keys go from 21/178 → ~177/178.
- [x] **Task 4 — Real-data fixture + data-access seam (web)** (AC: 13, 5)
  - [x] After Task 3, export set 975 (+ a 1-play low-confidence set, + optionally a warmup-heavy set to exercise the dancefloor cut) to a committed wire-shape JSON fixture under `web/` (epoch→ISO conversion, `SyncSetDerived`/`SyncPlay` shapes from `shared/`).
  - [x] Add a `getRecentSets()` data-access module the dashboard imports; back it with the fixture now, structured so the Supabase read path swaps in later with zero component change.
- [x] **Task 5 — Dancefloor v0 detector + segment-scoped stats (web)** (AC: 6, 7, 8)
  - [x] Pure function `detectDancefloor(plays)` → `{start, end} | null` (window bucketing, density+BPM floors, longest contiguous run, gap-merge, whole-set fallback). Global constants, **commented as interim / superseded by Story 5.2 AR-13**.
  - [x] Pure function to recompute the card-facing stats (length, track count, genre breakdown) over a segment from `plays[]`; unit-test against set 975 and the whole-set-fallback case.
- [x] **Task 6 — Set card component (web)** (AC: 1, 5)
  - [x] `app/components/ui` or `app/components/dashboard` set card: mono header, genre chips, length + track count, whole-card link to `/set/[id]`. Hairline border, no shadow, Obsidian tokens only.
- [x] **Task 7 — Energy-arc thumbnail (web, reusable)** (AC: 1, 5, 7, 15)
  - [x] Build the mini arc renderer as the **reusable** energy-arc primitive (thumbnail mode now; Story 3.8 adds the full annotated/captioned chart mode over the same core). Lavender 2px stroke, no fill; emphasize the dancefloor window. Provide a text-equivalent (min/max/direction) for a11y.
  - [x] Heed the `@property`/`setProperty` gotcha (memory `ref-property-setproperty-bug`): if any CSS custom prop is animated at runtime, use an **unregistered** var + rAF lerp, not a registered `@property` + `setProperty`.
- [x] **Task 8 — Fixed app-shell + list scroll (web)** (AC: 4)
  - [x] Lock the dashboard to `100dvh`; make the set list the only scroll container (its own `overflow-y:auto`); keep nav/header fixed. Verify no horizontal body scroll and no mobile-chrome clipping at 375px.
- [x] **Task 9 — Cold state + passive NEW marker (web)** (AC: 2, 3)
  - [x] Cold state copy (console voice, sets go-forward expectation calmly). NEW marker as a passive treatment on unopened sets; per-set "seen" in `localStorage`; cleared on open. No buttons, no modal, no push.
- [x] **Task 10 — `/set/[id]` route stub + delete seam (web)** (AC: 1, 12)
  - [x] Create the `/set/[id]` route so card clicks resolve (minimal placeholder; Story 3.7 fills it). Ensure the data-access seam supports a delete that removes the row from the source (full delete UI is 3.7).
- [x] **Task 11 — Liquid-metal CTA component (web)** (AC: 14)
  - [x] `pnpm add @paper-design/shaders`; create `app/components/ui/` and add the adapted liquid-metal button ('use client', dynamic `ssr:false`, reduced-motion freeze + no ripple, tokenized colors, `<style>` moved to `globals.css`). Document the WebGL-context limit in the component so it is never spread across many instances.
  - [x] Wire it as the primary CTA where one exists on this surface; if none is natural on the dashboard itself, land the component + one demo usage and note the marketing/subscribe/login placements for their stories.
- [x] **Task 12 — Voice/motion/a11y pass + gates** (AC: 15)
  - [x] After-Hours Archive copy review (no celebratory/exclamatory strings). Reduced-motion + keyboard + WCAG 2.2 AA check. Run the full repo gate (agent: cargo build/fmt/clippy -D warnings/test; web: pnpm lint/typecheck/test) green, and a real browser walkthrough (the 3-5 retro proved code review alone missed two real bugs).

## Dev Notes

### The real-data findings this story is built on (verified 2026-08-02 against Arjun's machine)

Agent DB: `~/Library/Application Support/app.curfew.agent/local.sqlite`, table `captured_sessions`, **491 captured serato4 sets** (plus 474 `incomplete` legacy twins that are correctly suppressed). Reference gig: **id 975 / session_identity `master.sqlite#488`** — 178 plays, 5.9h, `confidence.value = 1.0`. Many 1-play soundchecks exist (e.g. id 17577) — these are the low-confidence / sparse-state cases the UI must handle.

- **Camelot keys were being thrown away, not absent.** Set 975: **177/178 plays have a key in Serato; only 21 were captured (~12%).** Library-wide ~94% coverage was being dropped.
  - Root cause: `agent/src-tauri/src/joiner/serato4.rs:135` reads the free-text `key` column, which stores **mixed notation — mostly musical** (`Em`, `Ebm`, `Fm`, `Cm`, `G#m`…) with only a few already-Camelot (`9B`). `agent/src-tauri/src/stats/camelot.rs:46` `parse()` accepts **only** `<1-12><A|B>`, so `Em → 'm' → None`. ~88% silently dropped.
  - Fix source of truth: Serato's `key_value` INTEGER (present on both `history_entry` and `asset`; `-1` = no key). **Verified 24/24 mapping** by cross-tabbing `key_value` ↔ `key_norm` across 20k+ rows:
    - `key_value` 0–11 = minor / Camelot **A** ring; 12–23 = major / **B** ring.
    - `number = (key_value % 12) + 1`, `letter = key_value < 12 ? A : B`. Spot checks: `0→1A (g#m)`, `7→8A (am)`, `8→9A (em)`, `16→5B (eb)`, `23→12B (e)`.
  - This is more AD-11-"never guess"-compliant than parsing the messy text column (no enharmonic ambiguity — Serato folds `g#m`/`abm` to one value).
  - **Design consequence:** harmonic/Camelot mixing is a **real ~94%-coverage feature**, reversing the earlier (wrong) call to treat keys as near-empty. It becomes a legitimate headline stat on Set Detail and a candidate for the card. Genre (AC 10) is flagged for the same "are we reading the right column?" scrutiny before we design its fallback.
- **Genre looked ~50% untagged** on set 975 (`no_genre: 82/178`, big `Other: 49`). Suspect after the key bug — verify the source before trusting it (Task 2).
- **Data is messy in reality:** mic/announcement "tracks" (`"Boys Court Dance\n"`), null titles, trailing newlines. The FR-2 unknown fallback + light hygiene apply. Titles filled 157/178, artists 158/178.
- **Storage detail:** `local.sqlite` stores `energy_arc.started_at` as **epoch ints**; the frozen wire contract (`shared/src/index.ts`) carries **ISO 8601 strings** ("converted at payload-build time"). The fixture builder must convert.

### The frozen data ceiling (what any card/detail can render)

Everything renders from `set.derived` (`shared/src/index.ts:114`, `SyncSetDerived`) + `set.{external_id, started_at, ended_at}` + `plays[]` (`SyncPlay`, `shared/src/index.ts:76` — carries `position, title, artist, started_at (ISO), bpm, genre{raw,normalized,taxonomy_version,subgenre?}, camelot_key, in_library`). Because every `SyncPlay` carries per-play timestamp + bpm + genre + key, **segment-scoped stats can be recomputed from `plays[]`** — this is what makes the dancefloor v0 (AC 6/7) and the future pointer editor (Story 5.1) buildable without a schema change. `derived` is the whole-set default/cache; segment stats are recomputed.

`SyncSetDerived` fields: `most_played_tracks`, `most_played_artists`, `genre_breakdown{buckets,no_genre_count}`, `subgenre_breakdown?`, `bpm_distribution{count,min,max,mean,median}`, `camelot_mixing_stats{compatible,incompatible,excluded_no_key}`, `set_length_sec`, `track_count`, `energy_arc[{started_at,bpm}]`, `confidence{value,track_count,long_gap_count}`.

### Files to touch

**Agent (Rust):**
- `agent/src-tauri/src/joiner/serato4.rs` — SELECT + `key_value` mapping (READ fully first; it also owns the id-correlation join contract at ~102-106 — do not break it).
- `agent/src-tauri/src/stats/camelot.rs` — `parse()` stays for the fallback path; the library path uses `key_value`. `mixing_stats`/`compatible` unchanged.
- `agent/src-tauri/src/joiner/mod.rs` — retire the "findings §3 / already Camelot" premise (line ~30 + `JoinedMetadata.key` doc).
- `agent/src-tauri/src/joiner/legacy.rs` — sanity-check the database-V2 key source too (lower priority; Arjun's library is serato4).
- Backfill entry point from Story 3.4 (find it; do not invent a parallel one) + `store.rs` (`captured_sessions`, `raw_ref` format `<db_path>#<session_id>`).

**Web (Next / Tailwind v4 / shadcn base-nova):**
- `web/app/(authenticated)/dashboard/page.tsx` — **currently a throwaway stub** (Story 3.5 Task 5.2); this story replaces it entirely.
- `web/app/(authenticated)/layout.tsx` — the fixed-shell wrapper lives here or in the page; note there is **no auth-gating redirect on this route group yet** (pre-existing gap flagged in 3-5; do not rely on it, do not silently fix it in this story unless needed).
- `web/app/components/nav/FloatingNav.tsx` — already done (3.5); the shell must not fight the fixed `bottom-6` nav.
- New: `web/app/components/ui/` (shadcn `ui` alias target `@/app/components/ui`, per `components.json` — does **not** exist yet), the set card + arc thumbnail + liquid-metal button, `/set/[id]` route, the data-access seam + JSON fixture.
- `web/app/globals.css` / `web/app/tokens.css` — Obsidian tokens only; the liquid-metal `<style>` injection moves here.

### Previous-story intelligence (Story 3.5, 2026-08-01)

- Stack as established: **Tailwind v4 (`tailwindcss`/`@tailwindcss/postcss` 4.3.3)**, **shadcn CLI 4.16.1** with **Base UI + `base-nova` preset** (a newer generation than the classic shadcn/Radix), **`@phosphor-icons/react` 2.1.10** (House/TrendUp/VinylRecord/UserCircle in use). `clsx` / `tailwind-merge` / `class-variance-authority` present; `lucide-react` was **removed** in 3.5 as out-of-scope — the liquid-metal component imports `lucide-react` (`Sparkles`), so it will be **re-added** with `@paper-design/shaders` (acceptable, it is the CTA's own dep).
- **CSS Cascade Layers gotcha (real bug in 3.5):** an *unlayered* rule beats every `@layer` rule regardless of order; a hand-written unlayered reset silently disabled every Tailwind utility. Keep new global CSS layered; don't reintroduce unlayered resets.
- **`@property` + `setProperty` gotcha** (memory `ref-property-setproperty-bug`): Next16/Tailwind v4 silently ignores runtime `setProperty` on **registered** `@property` vars — use **unregistered** vars + rAF lerp for any runtime-animated custom prop (relevant to the arc thumbnail's dancefloor emphasis and any glow).
- **Verify in a real browser, not just code review** — 3.5's two worst bugs (the layers reset; a 524px pill overflowing a 375px viewport) were caught only by an actual Playwright/headless-Chrome walkthrough. Screenshot the cold state, a populated card, the NEW marker, mobile 375px, and keyboard focus.
- Repo gate is expected green across agent/shared/web throughout.

### Downstream decisions recorded (stories we are NOT building now)

Written back into `epics.md` this session so they survive:
- **Story 3.7 (Set Detail):** dancefloor-**filtered** stats (recomputed from `plays[]`); a "we detected dancefloor from X–Y" line with an **edit** affordance; the editor UI = the **tracklist with two draggable pointers** the DJ moves to bracket the segment; that **same surface** hosts second-layer data (tags, pics); **delete-set** lives here (calm confirm); whole-set is the honest fallback until a segment is set.
- **Story 3.8 (Energy arc chart):** the full annotated + captioned chart is the **same reusable renderer** as this story's thumbnail (Task 7), in "full" mode.
- **Story 5.1 (Segments overlay schema):** the cloud-only `segments` table (`type ∈ {dancefloor,dinner,performance,custom}`, AR-15). **Story 5.3 (Segment editor):** the two-pointer editor rendered **over the tracklist** (Arjun's model), unified with **Story 5.5 (Layer-2 enrichment: tags + pics)** on one Set Detail surface. **Story 5.4 (Segment-scoped stats):** the cloud SQL re-aggregation that 3.6's client-side v0 previews.
- **Story 5.2 (Segment detection):** replaces this story's **global-heuristic v0** with **per-DJ-calibrated** floors (AR-13, validated on the 474-session corpus 2026-07-20); stats then filter to the confirmed segment.
- **Liquid-metal CTA placements:** subscribe/paywall CTA (Story 7.x, UX-DR14), login "Initialize Session" primary, marketing/landing hero — in addition to the in-product usage Arjun wants.

### Project Structure Notes

- Route slugs are frozen by Story 3.5 Task 3.2: `/dashboard`, `/style-evolution`, `/library-utilization`, `/settings`. This story adds `/set/[id]`.
- shadcn `ui` alias is `@/app/components/ui` (`web/components.json`), tsconfig `@/*` → `./*`. Registry/primitive components (liquid-metal button) belong under `app/components/ui/`; feature components (set card, arc thumbnail) may live under `app/components/dashboard/` — match the existing `app/components/{auth,nav}` grouping.
- **Scope variance (intentional, Arjun 2026-08-02):** this story spans agent + web, unusual for a "dashboard" story. Rationale in the Scope Note at top: the dashboard's value proposition is *accurate* reflection, so the data-correctness fixes are in-scope, not deferred.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.6: Dashboard home] — base ACs (revised here per Arjun 2026-08-02).
- [Source: _bmad-output/planning-artifacts/epics.md#Decision A] — go-forward-only / sparse-first launch; the empty dashboard IS the launch experience.
- [Source: _bmad-output/planning-artifacts/epics.md#AR-13] — per-DJ-calibrated segment detection (v0 here is the interim).
- [Source: _bmad-output/planning-artifacts/epics.md#AR-15] — entity model; `segments` type enum; `derived` render-cache.
- [Source: shared/src/index.ts:76,114] — frozen `SyncPlay` / `SyncSetDerived` contract.
- [Source: agent/src-tauri/src/joiner/serato4.rs:135] — the SELECT to fix.
- [Source: agent/src-tauri/src/stats/camelot.rs:46] — the parser that dropped musical keys.
- [Source: agent/src-tauri/src/joiner/mod.rs:30] — the false "already Camelot" premise to retire.
- [Source: agent/src-tauri/src/store.rs:32,266] — `local.sqlite` location + `captured_sessions` schema / `raw_ref`.
- [Source: _bmad-output/implementation-artifacts/3-5-floating-pill-nav.md] — stack, CSS-layers gotcha, verify-in-browser discipline.
- [Memory: bug-serato-key-parsing] — the verified fix + blast radius. [Memory: ref-property-setproperty-bug] — runtime CSS-var gotcha. [Memory: feedback_design_taste] — match reference intensity, don't tone down.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (`claude-opus-4-8`) via the bmad-dev-story workflow.

### Debug Log References

- Agent gate: `cargo fmt --check` clean · `cargo clippy --all-targets --all-features -- -D warnings` clean · `cargo test --lib` 331 passed.
- Shared gate: `vitest run` 20 passed (frozen-contract additive-only + schema-parity guards — contract untouched).
- Web gate: `tsc --noEmit` clean · `eslint` clean · `vitest run` 52 passed.
- Real-data verification (read-only, non-destructive): `agent/src-tauri/tests/export_real_fixtures.rs` re-derived set 975 (session 488) through the fixed pipeline → **177/178 Camelot keys recovered** (was ~21), confirming AC-9/AC-11 on the reference gig.
- Browser walkthrough (Playwright, dev server): populated dashboard, NEW markers + pulse + border tint, click→markSeen persistence (`localStorage: ["975"]` after opening 975, 17577 stays new), set-detail stub + liquid-metal CTA, cold state, mobile 375px (no horizontal overflow), keyboard focus ring. Zero console errors throughout. Caught + fixed one real bug code review missed: the "NEW SET DETECTED" badge overlapped the session-id header (both were top-right) — resolved by swapping the header's right slot to show the badge *in place of* the session-id while unopened.

### Completion Notes List

**Agent / data-correctness (Tasks 1–3)**
- ✅ **Camelot key recovery (AC-9).** Root cause was subtler than the story framed: the free-text `"key"` was read in TWO places (`joiner::serato4::join_session` AND `parser::serato4::read_session` → `Play.key`), and `stats::enrich` *prefers* `Play.key`, so fixing only the joiner would have left the broken free-text key shadowing the fix and **failed the required capture-path test**. Fix (Option B, clean + DRY, legacy untouched): the joiner now maps `key_value`→Camelot into `JoinedMetadata.key`, and the serato4 parser **stops reading the free-text key** (`Play.key = None`), so — exactly like BPM already does — key flows from the library join. Legacy's play-log key (`.session` field 51, genuinely Camelot) is unchanged. Three false premises retired: `joiner/mod.rs` module doc, `JoinedMetadata.key` doc, AND `stats::enrich`'s "confirmed Camelot notation at the source for both formats" comment. `key_value`→Camelot only maps the verified `0..=23` range (−1 and out-of-range → `None`, never a fabricated position — AD-11). Regression tests: full 24-value ring mapping, key_value-wins-over-free-text, and a capture-path test through `build_serato4` (`Em`/`Ebm`/`G#m` + a −1 → correct Camelot + one `None`).
- ✅ **Genre source re-check (AC-10) — no code change, finding recorded.** Verified against the real `master.sqlite`: `asset.genre` is nearly empty (523 filled rows library-wide) vs `history_entry.genre` (17,392). Joining to `asset` would *lose* genres, not gain them (only 7 rows library-wide are asset-richer; 2 on set 975). **`history_entry.genre` — what the joiner already reads — is the richest source.** The ~46% untagged rate on set 975 (~25% library-wide) is a **genuine library ceiling, not a reading bug**; the UI genre-chip fallback is designed against that truth (a set with no tagged genres simply shows no chips).
- ✅ **Backfill (AC-11).** New `backfill::backfill_captured_serato4` sweeps every `captured` serato4 row and re-derives it through the fixed pipeline by reusing the Story 3.4 capture entry point (`capture_and_store_serato4` → idempotent `upsert_captured`), wired into the same startup thread as `reprocess_parse_failures`. Purely local, idempotent, skips an unreachable source rather than corrupting rows. Verified: re-derivation recovers 177/178 keys on set 975 and **preserves `synced_at`**.
- ✅ **Cloud re-sync (Arjun ruling 2026-08-02).** The story's "`synced_at` is NULL for all rows" premise was factually wrong — all 491 captured rows already carry a `synced_at` (Stories 3.2/3.3), so the cloud held the *old* keys. Arjun ruled: **all data lives in the cloud so the dashboard reads the same on every device.** So the backfill now clears `synced_at` on any row whose re-derivation actually *changed* (`store::mark_for_resync`); the existing sync-queue drain loop re-pushes it and Story 3.2's `external_id` idempotency updates the existing cloud row (no duplicates). It is **self-terminating** — it compares freshly-derived JSON to what is stored and only writes/re-queues on a real difference, so it does not re-sync every set on every startup. (Note: the real `local.sqlite` backfill has NOT been persisted this session — that mutates real user data; the agent runs the wired startup sweep on next launch. Verification above was read-only re-derivation.)

**Web / dashboard (Tasks 4–12)**
- ✅ **Real-data fixture + seam (AC-13).** Set 975 + the 1-play soundcheck (17577) re-derived from the real `master.sqlite` through the *fixed* Rust pipeline, then `build-fixture.mjs` converts epoch→ISO into the frozen `SyncPayload["set"]` wire shape (`web/lib/sets/recent-sets.fixture.json`). The dashboard reads only through `getRecentSets`/`getSetById`/`deleteSet` (`web/lib/sets/index.ts`); the Supabase read path swaps in there with zero component change.
- ✅ **Dancefloor v0 (AC-6/7/8)** — pure `detectDancefloor` + `segmentStats`, global constants **explicitly commented interim / superseded by Story 5.2 AR-13**. Card stats scope to the detected dancefloor; the arc draws the full night with that window emphasised. (Set 975's mid-set gap makes it detect a real ~1h peak segment rather than the whole 5.9h — so the card reads "1h 6m / 38 tracks", the dancefloor, per AC-7.)
- ✅ **Reusable `EnergyArc`** (thumbnail mode; 3.8 renders the same geometry in "full"), token-driven stroke (`stroke-primary`, no `currentColor`/literals), static (no celebratory motion), degenerate handling (solo dot for 1 play, dashed baseline for none), a11y text-equivalent.
- ✅ **Fixed shell, cold state, passive NEW marker, `/set/[id]` stub + delete seam, liquid-metal CTA** all built and browser-verified. Liquid-metal: `'use client'` + `dynamic(ssr:false)`, reduced-motion freeze (`speed=0`) + ripple dropped, colours **tokenized** (new rose-tinted-chrome material in `tokens.css`, read at runtime since the shader's hex parser can't take a `var()`), the reference's `document.head` `<style>` moved into `globals.css`, WebGL-context limit documented. Landed with ONE in-product demo usage on the set-detail stub; real hero placements (login/subscribe/marketing) noted for their stories.

**Corrections & deviations (flagged, not silent)**
- **"lavender" → Ember rose.** The story's AC-3/Task-7 "lavender @20% border / lavender 2px stroke" predates the 2026-07-28 Ember revision; the live accent is `--color-primary` (rose) and lavender is a commented-out alternate. Used the live token throughout — the same stale-wording correction Stories 2.4/3.5 already made.
- **Session-id moved within the header slot, not removed.** To resolve the NEW-badge overlap, the header's right slot shows the NEW badge while unopened and the session-id once seen (they never coexist). Both still live in the header per AC-1.

**Deferred / out of scope (for later stories)**
- The real `local.sqlite` backfill of all 491 rows persists on next agent launch (wired) — not run this session to avoid mutating real user data. The cloud correction rides along automatically (the changed rows clear `synced_at` and the drain loop re-pushes them).
- Pagination/virtualization: `getRecentSets` returns all sets; at fixture scale (2) that is fine, but the Supabase read path should page/virtualize before rendering hundreds of dancefloor-computing cards.

**NOT part of this story (intentional, untouched)**
- `web/app/components/nav/FloatingNav.tsx` carries nav-padding WIP (6→2px incl. an invalid `p-0.2`, glow radius 52→90px) that **Arjun added via a parallel agent** so this session had up-to-date code — matches the `nav/pill-tighten-padding` worktree. Left untouched and **excluded from this story**; it commits separately (Arjun 2026-08-02). The invalid `p-0.2` (no such Tailwind step — renders no padding) is worth a look in that separate change.
- `_bmad-output/planning-artifacts/epics.md` was already modified before this session (the downstream-decisions write-back) — not touched here.

### File List

**Agent (Rust) — modified**
- `agent/src-tauri/src/joiner/serato4.rs` — `key_value`→Camelot mapping + source-of-truth read; `camelot_from_key_value`; fixtures + regression tests.
- `agent/src-tauri/src/parser/serato4.rs` — stop reading the free-text `"key"` (key now from the join); docs + tests.
- `agent/src-tauri/src/joiner/mod.rs` — retired the false "already Camelot at the source" premise (module doc + `JoinedMetadata.key`).
- `agent/src-tauri/src/stats/mod.rs` — corrected the `enrich` key-policy doc.
- `agent/src-tauri/src/capture.rs` — `key_value` fixtures + capture-path Camelot regression test.
- `agent/src-tauri/src/backfill.rs` — `backfill_captured_serato4` (change-detecting, cloud-re-syncing, self-terminating) + tests; module doc.
- `agent/src-tauri/src/store.rs` — `mark_for_resync` (clears `synced_at` so a corrected row re-syncs).
- `agent/src-tauri/src/lib.rs` — wired the captured-backfill into the startup sweep.
- `agent/src-tauri/src/watcher/mod.rs` — `key_value` column in the test fixture.

**Agent (Rust) — new**
- `agent/src-tauri/tests/export_real_fixtures.rs` — env-gated, read-only real-data exporter (Task 3 verification + Task 4 fixture source).

**Web — new**
- `web/app/(authenticated)/set/[id]/page.tsx` — Set Detail route stub + liquid-metal demo.
- `web/app/components/dashboard/{EnergyArc,SetCard,SetList,ColdState}.tsx`, `useSeenSets.ts`
- `web/app/components/ui/liquid-metal-button.tsx`
- `web/lib/sets/{index,types,dancefloor,energyArc,format}.ts` (+ `dancefloor.test.ts`, `energyArc.test.ts`, `format.test.ts`)
- `web/lib/sets/recent-sets.fixture.json`, `web/lib/sets/build-fixture.mjs`

**Web — modified**
- `web/app/(authenticated)/dashboard/page.tsx` — real dashboard (was a stub).
- `web/app/globals.css` — dashboard shell/card/marker/liquid-metal styles (token-only) + motion + reduced-motion/forced-colors.
- `web/app/tokens.css` — `@theme` additions + the rose-tinted-chrome metal material.
- `web/package.json`, `pnpm-lock.yaml` — `@paper-design/shaders`, `@paper-design/shaders-react`, `lucide-react`.

**Story bookkeeping**
- `_bmad-output/implementation-artifacts/3-6-dashboard-home.md` (this file), `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Change Log

| Date | Change |
|------|--------|
| 2026-08-02 | Story 3.6 implemented across agent + web. Camelot `key_value` recovery (21→177/178 keys on set 975, verified on real data); genre-source re-check (history_entry.genre confirmed richest; ~46% untagged is a real ceiling); captured-set backfill (idempotent, self-terminating); real-data wire-shape fixture + data-access seam; dancefloor v0 detector + segment-scoped stats; Card-Reflection dashboard (cards, reusable energy arc, fixed 100dvh shell, cold state, passive NEW marker, `/set/[id]` stub, liquid-metal CTA). Full repo gate green (agent fmt/clippy/test, shared, web lint/typecheck/test) + browser walkthrough. Status → review. |
| 2026-08-02 | Follow-up (Arjun rulings): backfill now **re-syncs corrected rows to the cloud** (clears `synced_at` on changed rows so the drain loop re-pushes; self-terminating) so the dashboard reads the same on every device — the "`synced_at` is NULL" story premise was wrong (all 491 rows were already synced). FloatingNav nav-padding WIP confirmed intentional (parallel agent) and kept out of this story's scope. Agent gate re-green (332 tests). |
