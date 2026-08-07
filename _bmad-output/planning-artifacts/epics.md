---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
scopeDecision: "Phase 1 is the MVP — epics/stories are being detailed for Phase 1 now; Phase 2 (social) is captured in the requirements inventory but its epics/stories are deferred to a later pass (Arjun, 2026-07-20)."
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-name-pending-2026-07-19/prd.md
  - _bmad-output/planning-artifacts/prds/prd-name-pending-2026-07-19/addendum.md
  - _bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/SOLUTION-DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-name-pending-2026-07-19/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-name-pending-2026-07-19/EXPERIENCE.md
---

# Curfew - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Curfew, decomposing the requirements from the PRD, UX Design, and Architecture into implementable stories. Curfew is a Serato-linked DJ reflection platform: a local Tauri/Rust agent parses Serato sessions on the DJ's machine and syncs only derived data to a thin Supabase/Next.js cloud. **Phase 1 (Launch)** is the personal reflection layer; **Phase 2 (Fast-Follow)** adds the social layer, gated on Phase 1 clearing success metrics SM-1 (parsing correctness) and SM-2 (personal value stands alone) — a product decision, not a calendar date.

> **⚑ Decision A — Launch ingestion is GO-FORWARD ONLY (Arjun, 2026-07-25; propagation owed to PRD/Spine, tracked in sprint-status `action_items` ai-6).** At launch the agent captures/analyzes **only sessions completed after the DJ subscribes** — no bulk-import of the existing `History/Sessions/` folder or `master.sqlite` history, no historical backfill. The **library metadata DB is still read live** (BPM/key/genre enrichment + add-dates); we are blind only to *"was this track played before we were watching."* Consequences: **the empty/sparse dashboard IS the launch experience** — Epic 3 UX must be designed **sparse-first**, with copy that matures as data accrues (never ship the "six-months-in" dashboard to a day-one user). Coding against Arjun's full real library today is a **dev fixture** for what a populated dashboard looks like, not launch behavior. Structurally this is the retention moat: no backfill means a cancellation leaves a **permanent, unfillable gap** in the DJ's own evolution timeline. Full rationale: `implementation-artifacts/epic-1-review-decisions-2026-07-25.md`.

## Requirements Inventory

### Functional Requirements

**Phase 1 — Launch (personal reflection)**

- **FR-1** *(P1)*: Background set detection — the local agent detects a completed Serato session with no DJ action. Auto-discovers the Serato data directory at OS defaults (`~/Music/_Serato_/` on macOS, Windows equivalent) and scans connected removable/USB volumes; manual path override via tray if none found; auto-detects reconnection of removable media and resumes watching.
- **FR-2** *(P1)*: Track-level enrichment via library join — resolve BPM/key/genre per track. In-library tracks pull from the Serato library DB; off-library tracks fall back to embedded file tags (Serato Autotags GEOB for BPM, ID3 `TKEY`/`TCON` or Vorbis for key/genre); if neither source has data, display "Unknown" (never omitted, never guessed). *Out of scope: local audio DSP/key-finding.*
- **FR-3** *(P1)*: Local-only raw data boundary — the agent never transmits raw `.session` files or the raw library DB off-machine. Only derived/structured data leaves, over HTTPS. Filesystem access scoped to the configured Serato path only.
- **FR-4** *(P1)*: Auto-sync to backend after each set — completed sets upload automatically. Sync is idempotent (no duplicate on re-run); offline at set-completion queues locally and syncs on reconnect.
- **FR-5** *(P1)*: Menu-bar/tray presence — the agent's only UI is a menu-bar (macOS) / system-tray (Windows) icon plus a minimal settings panel. Icon reflects sync state (idle / syncing / failed / drive-not-connected); settings panel exposes only the Serato folder path override.
- **FR-6** *(P1)*: Per-set summary — for any synced set: most played tracks/artists, genre breakdown, BPM distribution, key/Camelot-wheel mixing stats, set length, track count. *(Most-played-artists ranks artist-tagged plays only; no "Unknown" bucket and no untagged footnote — CAP-5.)*
- **FR-7** *(P1)*: Energy arc — BPM plotted against timestamp within a set, rendered as a visual "pulse of the room."
- **FR-8** *(P1)*: Genre normalization — raw Serato genre tags mapped to a normalized taxonomy before display, using a fixed Curfew-maintained table (not DJ-editable in V1).
- **FR-9** *(P1)*: Style Evolution trend view — BPM range, genre diversity, and key-usage patterns month-over-month across synced set history.
- **FR-10** *(P1)*: Library-to-setlist correlation — whether recently-added library tracks are making it into sets, as a trend line over time.
- **FR-11** *(P1)*: Conversion rate — % of tracks added to the library that have been played ≥1 time in a set, over a rolling window.
- **FR-12** *(P1)*: Aging shelf — library tracks unplayed for 3+ months (from add date or last play).
- **FR-13** *(P1)*: Time-to-first-play — elapsed time between a track being added to the library and its first play in a set.
- **FR-14** *(P1)*: Segment marking — mark one or more time-range segments within a set, each typed (dancefloor / dinner / performance) or custom-labeled.
- **FR-15** *(P1)*: Segment-scoped stats — per-set stats (FR-6, FR-7) filterable/sliceable by segment.
- **FR-16** *(P1)*: Manual enrichment (Layer 2) — add venue, crowd size, event type, free-text notes to any synced set from the website, after the fact. Never required for core dashboard value.
- **FR-17** *(P1)*: Enrichment unlocks richer comparisons — Layer 2 tags enable comparisons (e.g. BPM-in-club vs BPM-in-radio) without being required for core stats.
- **FR-18** *(P1)*: Location-based venue suggestion — opt-in (off by default). Agent captures approximate device location at set-completion; website reverse-geocodes to a suggested venue name; DJ confirms or edits before save (never silent auto-fill).
- **FR-27** *(P1 compute / P2 behavior)*: Confidence-gated live/practice confirmation — classification confidence computed from Phase 1 onward; the confirmation prompt is dormant until Phase 2 (nothing to protect until feed/comparisons exist). Low-confidence sessions trigger a one-tap "was this a real set?" before becoming visible to others; the DJ's own dashboard is never gated. *Out of scope: reliably distinguishing home rehearsal from live gig by data alone.*
- **FR-28** *(P1)*: Algorithmic segment suggestion — uses inter-track timestamp gaps and session patterns to auto-suggest segment boundaries; DJ confirms/adjusts (FR-14 remains manual fallback). *Out of scope: fully-automatic flow-aware labeling.*
- **FR-29** *(P1)*: Multi-provider authentication — sign up / log in via email+password, Google OAuth, Sign in with Apple, or passkey (WebAuthn). All four link to one account by verified email; every account has a phone number on file (prompted after Google/Apple signup); passkey is an add-on to the email path, not a separate flow.

**Phase 2 — Fast-Follow (social; gated on SM-1 + SM-2)**

- **FR-19** *(P2)*: Follow — a DJ can follow other DJs in the network.
- **FR-20** *(P2)*: Feed — followed DJs' sets shown as energy-arc thumbnails; clicking opens the full set view.
- **FR-21** *(P2)*: Profile — each DJ has a profile showing recent sets and self-selected visible aggregate stats.
- **FR-22** *(P2)*: Per-track hide — mark individual tracks in a set as hidden; renders as a visible redacted placeholder (never silently omitted).
- **FR-23** *(P2)*: Set visibility tiers — public / friends-only (mutual follows) / private (owner-only). Default on sync is public; private is a one-action whole-set toggle.
- **FR-24** *(P2)*: Network-wide leaderboards — aggregate comparisons (widest BPM range, genre diversity) framed descriptively, never as "best"/"winner."
- **FR-25** *(P2)*: Circle-scoped comparison — the same comparison stats scoped to DJs a user follows, independent of the network-wide view.
- **FR-26** *(P2)*: Set comments — comment on a set (respecting its visibility tier); public/friends-only viewers can read and add, private sets have no comment surface.

### NonFunctional Requirements

- **NFR-1 (Performance)**: Local parsing/sync of a typical library (~5,000 tracks) completes without noticeable resource usage on the DJ's machine; stats computation is arithmetic-only, no ML/inference.
- **NFR-2 (Privacy)**: Raw Serato session files and the raw library DB never leave the machine (FR-3); per-DJ data isolation enforced server-side (unreachable across DJs even with an API-layer bug); location data (FR-18) requires explicit, off-by-default opt-in. US-only at launch → CCPA-level posture sufficient at v1; formal CCPA review is a pre-launch checklist item.
- **NFR-3 (Cost)**: No paid AI/ML API required anywhere in the core product; all stats derived arithmetically, keeping marginal per-DJ cost near zero.
- **NFR-4 (Reliability)**: Format-drift resilience — a Serato format change is caught by CI (golden-file regression tests) before it silently corrupts synced data; fixes ship via a signed auto-updater.
- **NFR-5 (Format-drift, feature-level for FR-1/FR-27)**: Golden-file regression tests against known-good `.session`/DB fixtures catch a Serato format change before synced data is corrupted.

### Additional Requirements

*Technical/implementation requirements from the Architecture Spine (AD-1…AD-17), stack, and deployment posture that shape epics and stories.*

- **AR-1 — Monorepo + versioned sync contract (AD-3, AD-15)**: One monorepo with `agent/`, `web/`, `shared/`. `shared/` owns the single versioned sync-payload schema (TS types + JSON-schema), validated on **both** agent (before send) and cloud (on receive) via contract tests. Contract evolution is additive-only; every payload carries `agent_version`; cloud accepts the last N agent versions.
- **AR-2 — Idempotent, deterministic sync key (AD-4, AD-16)**: Sync is an idempotent `PUT /sets/:set_id`. `set_id`/`session_id` are deterministic and namespaced: `hash(dj_id, session_identity)` — never a fresh UUID (would duplicate on backfill), never session-identity alone (shared-USB collision). Re-parse updates content, never re-partitions/re-keys a synced session.
- **AR-3 — Two stores, one owner per class (AD-5)**: Cloud Postgres is the cross-device system of record; local SQLite is a durable parse + offline cache + raw retention (for backfill), authoritative for a set only until it syncs.
- **AR-4 — DB-layer isolation, no custom mutation server (AD-7, AD-8)**: Per-DJ isolation via null-safe RLS (`auth.uid() IS NOT NULL AND auth.uid() = dj_id`), never app-layer filtering. All web mutations go through Supabase/PostgREST + RLS; the agent's only write is the idempotent set sync. No bespoke write-API at v1.
- **AR-5 — Tauri/Rust agent, two-path parser (AD-11)**: Agent is Tauri 2 (Rust core). Parsing = clean-room Rust `.session` parser + `triseratops` (MPL-2.0, **pin an exact git commit** — crates.io `0.0.3` is stale) + `id3` crate. Must handle **both** legacy `database V2` and Serato 4+ `master.sqlite`. Join resolves relative-vs-absolute paths against the library root; off-library → embedded tags → visible "Unknown."
- **AR-6 — Edge genre normalization, store raw+normalized+version (AD-12)**: Normalize genres on the agent against the fixed table (FR-8), but store raw string **and** normalized value **and** a `taxonomy_version` per play, so trends recompute consistently after the table evolves across a heterogeneous fleet.
- **AR-7 — Format-drift = 3 layers + backfill (AD-13)**: (1) golden-file CI tests, (2) agent-side error reporting tagged `agent_version`, (3) signed static-JSON Tauri auto-updater; affected sets backfilled from raw data retained in local SQLite. All three layers required.
- **AR-8 — Content one-way, overlays cloud-only, content-scoped upsert (AD-1, AD-6, AD-16)**: Set content (plays, timestamps, derived stats) flows agent→cloud only. Overlays (Layer 2 enrichment, segments, per-track hide, visibility tier) are web-authored, cloud-only, never written back to the agent. Agent's upsert is column-scoped to content columns; overlay columns are disjoint and never touched (contract-tested in `shared/`). Edge owns raw-Serato derivation; cloud may run SQL re-aggregation over synced `plays` (FR-15 segment stats, FR-24/25 scene aggregates, taxonomy re-normalization).
- **AR-9 — Visibility tiers + redaction via RLS; no retroactive exposure (AD-9)**: Three tiers enforced by RLS read policies; per-track hide = redacted placeholder; a `play` inherits its set's tier. Default-on-sync public applies only to sets synced after a DJ joins the social layer; Phase 1 sets are stored private-equivalent and are never retroactively exposed when Phase 2 read-policies ship.
- **AR-10 — One account across providers; secure agent token (AD-10)**: Supabase Auth (JWT + refresh). Four sign-in paths link to one `dj` account by verified email; `djs` row 1:1 with `auth.users`; phone required on file; `djs`-row creation idempotent on verified email; distinct verified emails not auto-merged in v1. Agent persists its refresh token via Tauri secure storage, not browser storage.
- **AR-11 — Modular-monolith cloud (AD-14)**: One Next.js deployment over Supabase. Read/serve API auto-generated by PostgREST; Phase 2 scene feed rides Supabase Realtime (managed WebSockets), not a self-operated socket server.
- **AR-12 — Additive-only migrations + environments (AD-15)**: Schema changes ship as additive-only Supabase-CLI migration files committed in the monorepo. Dedicated Supabase **prod** project, starting on the **free tier** — preview branches for dev/PRs deferred until the Pro tier is enabled (see `pre-launch-services-checklist.md`). A migration that drops/renames a live column or breaks the sync contract is forbidden.
- **AR-13 — Segment-detection algorithm (AD-17)**: Agent buckets a session into fixed time windows; per-window play density, median BPM, and consecutive-pair BPM-delta smoothness. Dancefloor candidate only if density + BPM clear floors **calibrated per-DJ from that DJ's own history** (never a global constant); adjacent candidates merge; a segment is confirmed only if transition-smoothness clears its own floor (confirming gate, not primary signal); long no-play stretches → idle/gap marker. A session yields **zero, one, or several** dancefloor segments — never assume exactly one.
- **AR-14 — Signed builds & release pipeline (Stack / Deployment)**: Code-signing is a fixed-cost ship gate — Apple Developer ID + notarization (macOS) and a Windows OV/EV cert. Signed Tauri auto-updater uses a separate mandatory update-signing keypair. `tauri-action` (GitHub Actions) produces cross-platform signed builds + auto-generated updater JSON/`.sig`; certs + updater key are encrypted CI secrets.
- **AR-15 — Core entity model (Structural Seed)**: Entities `djs`, `sessions`, `sets`, `plays`, `segments`, `follows` (plural, snake_case). Session is the immutable anchor; `sets` carries a denormalized `derived` (jsonb) render-cache; `plays` carry `in_library`, raw + normalized genre, `taxonomy_version`. Enums fixed in `shared/`: `visibility` ∈ {public, friends_only, private}; segment `type` ∈ {dancefloor, dinner, performance, custom}; `source` = serato.
- **AR-16 — No named starter template**: Architecture specifies no external greenfield boilerplate. Epic 1 Story 1 is a from-scratch monorepo scaffold (Tauri 2 agent + Next.js 16 web + shared contract package), not adoption of a named starter.

### UX Design Requirements

*Extracted from DESIGN.md (visual identity + components) and EXPERIENCE.md (IA, states, interactions, a11y). EXPERIENCE.md scope is Phase 1 only; Phase 2 social surfaces (feed, profile, comparisons) are not yet UX-specced.*

**Design system & foundations**

- **UX-DR1 — "Obsidian" design-token system**: Implement the dark M3-tonal-named token set — background `#101319` (blue-black, revised 2026-07-26 from the original `#121415`; never true black/white), five surface-container elevation tiers, Ice Cyan primary (`#a5dcea` / container `#6ec8e0`, used scarcely; revised 2026-07-26 from the original Electric Lavender `#cbbeff` / container `#9d85ff`, retained as a sanctioned alternate in `web/app/tokens.css`), desaturated dusty-rose error family. Typography scale: Hanken Grotesk (headlines), Inter (body), Geist mono (`mono-data`/`label-sm` for timestamps, BPM, session IDs, stat codes). 4px spacing baseline; soft-industrial radius where `rounded.full` (9999px) is reserved **exclusively** for floating nav, avatar, status dots.

**Components (from DESIGN.md.Components + EXPERIENCE.md.Component Patterns)**

- **UX-DR2 — Floating Nav (`nav-floating`)**: The signature pill nav — bottom-center, glassy (`backdrop-blur-xl` over `surface-container` @90%, hairline border), active item solid-lavender, menu trigger opening an upward popover (hover desktop / tap touch) for secondary items. Persistent across every logged-in screen; keyboard-navigable.
- **UX-DR3 — Auth components**: Ghost-style Input Fields (transparent, bottom-border, mono values, label-sm labels); Biometric Anchor (passkey enable row with fingerprint badge + radio indicator); Google Sign-In Button (official dark/filled theme, own logo lockup, host-radius); Apple Sign-In Button (official black variant, own lockup); primary/secondary Buttons (no pills, no gradients). *Google/Apple lockups keep their mandated colors/logos — the one deliberate palette exception.*
- **UX-DR4 — Card-Reflection + Set card**: The primary set-data vessel — hairline `outline-variant` border, no shadow, `rounded.lg`, mono header (date/session-id). Dashboard set card shows date/session-id + genre chips + energy-arc thumbnail; click anywhere opens Set Detail.
- **UX-DR5 — New-Set Nudge**: Declinable inline banner (never modal, never push) with lavender-@20%-active border, pulsing lavender status dot, "NEW SET DETECTED" label — **no alarm/error colors**. Equal-weight Add / Skip buttons; Skip persists per-set and never re-prompts.
- **UX-DR6 — Energy Arc / Trend Chart (`energy-arc-chart`)**: One shared line-chart utility (Set Detail energy arc + Style Evolution trend) — lavender 2px stroke, no fill, dashed baseline reference, hover/tap point annotation (uppercase label-sm + mono detail). Falls through to Chart Summary on render failure. No zoom/pan in v1.
- **UX-DR7 — Chart Summary (`chart-summary`)**: Auto-generated plain-language caption beneath every chart (templated min/max/direction, e.g. "BPM ranged 122–128, climbing through the back half"). Doubles as the render-failure fallback **and** the accessibility text-equivalent — the UJ-1 "genre gap" climax must be reachable without seeing the chart.
- **UX-DR8 — Set-List Module / Tracklist**: Per-track timeline rows (title, artist, timestamp) with a vertical connector; the top "impact" track gets a highlighted node + peak-metric annotation, others plain. "Unknown track data" fallback per FR-2. "View Full Tracklist" expands from the inline top-tracks summary.
- **UX-DR9 — Segment editor**: FR-28 suggested boundaries render as draggable dividers over the energy arc; tap "+" adds a manual boundary (FR-14 fallback); full keyboard path (Tab to boundary, arrows nudge, Enter confirm). Confirm commits; editable anytime.
- **UX-DR10 — Layer 2 form + Location suggestion**: Inline expandable form (venue, crowd size, event type, notes) beneath stats — never modal, never blocking, always skippable. Location suggestion off by default; when on, suggested venue appears as an editable pre-filled field, never silently saved (FR-18).
- **UX-DR11 — Progress pips / Conversion-rate meter**: Conversion rate, harmonic alignment, etc. render as filled/empty square "pips" (hardware-LED-meter style), not bars or a bare percentage.
- **UX-DR12 — Aging-shelf list**: Sortable by days-unplayed; each row carries an explicit "add to prep crate" action (UJ-6) — the one place the product nudges toward action rather than reporting.
- **UX-DR13 — Chips (Tags)**: Genre/mood tags — near-rectangular `rounded.sm` ("label on a vinyl sleeve"), dark `surface-container-high` fill, mid-grey text.
- **UX-DR14 — Pricing Card**: Single-tier display ($6/mo), no comparison table, plan picker, ribbon, or discount badge (one plan, nothing to compare). Large `display-lg` price + mono "/month" unit; primary-button CTA to Signup/Login.
- **UX-DR15 — Avatar**: Circular (`rounded.full`), hairline border, image only; the floating nav's Profile/Settings trigger — no other interaction.

**Information architecture & screens**

- **UX-DR16 — Marketing surfaces (logged out)**: Landing (marketing homepage, "compared to what?" hook, scroll-driven motion hero — Landing only), Features, Pricing; Login/Signup rendered as an **overlay on Landing**, never a separate blank page.
- **UX-DR17 — Authenticated screens (Phase 1)**: Dashboard (home; recent sets, trend snapshots, new-set nudge), Set Detail (stats, energy arc, segments, Layer 2), Style Evolution (month-over-month trend), Library Utilization (conversion meter, aging shelf, time-to-first-play), Profile/Settings (account, privacy, location opt-in). Floating pill nav persistent across all.

**Behavior, states, motion, accessibility**

- **UX-DR18 — Console voice + Failure Register microcopy**: "After-Hours Archive" console voice ("Initialize Session," "Archive Insight," "Session: Syncing…"); calm/technical failure copy with no exclamations (specified strings for sync-failed, drive-disconnected, format-drift-paused, login-failed, email-already-registered, chart-failed). **Banned**: streak counters, celebratory badges, "you're crushing it" (SM-C2, non-negotiable).
- **UX-DR19 — State patterns (17)**: Implement each specified state — cold dashboard (no sets), new-set-detected banner, unknown track data, sync offline/queued (+ tray glyph), drive-not-connected, first-run path confirmation, aging-shelf empty (positive-framed), insufficient history (<1 month), settings-saved inline confirm, auth-failed inline, phone-required post-signup (one-field, any path — revised 2026-07-27 from OAuth-only, see Story 2.3c), recently-downloaded-not-yet-played nudge (30-day threshold — *[ASSUMPTION], PRD-sync owed*), sync-failed/retrying, format-drift paused, chart-failed-to-render fallback.
- **UX-DR20 — Interaction primitives**: Floating-nav popover; scroll-driven motion **Landing only** (logged-in surfaces stay still); drag-to-adjust segment boundaries with keyboard equivalent; confirm-or-edit-never-silent-autofill (governs venue suggestion + first-run path). **Banned**: gating any core stat behind an enrichment prompt, infinite scroll on track lists (paginate/"load more"), celebratory micro-interactions on stat milestones.
- **UX-DR21 — Accessibility floor**: WCAG 2.2 AA across the website; every chart ships a text-equivalent via Chart Summary; segment dragging has a full keyboard path; tray icon states carry text label/tooltip (not color/glyph alone); focus rings use the lavender glow — verify AA contrast against both `surface` and `surface-container` (glow specified at ~20% opacity).
- **UX-DR22 — Responsive & platform**: Desktop/laptop-first fixed centered 1100px grid; fluid tablet/phone (nav stays bottom-anchored, segment dragging → touch-drag, energy arc drops hover for tap); native agent tray is icon + one settings panel only, never a full window, never mirrors website UI.
- **UX-DR23 — Agent tray UI**: Four icon states (idle / syncing / failed / drive-not-connected, FR-5); click opens the single settings panel (Serato path override only); native OS chrome, not skinned to the website token system.

### FR Coverage Map

**Phase 1 (MVP — this pass)**

- **FR-1** → Epic 2 — Serato folder auto-detection (OS defaults + USB scan) + manual override + reconnect-resume
- **FR-2** → Epic 1 — track enrichment via library join + off-library embedded-tag fallback + "Unknown"
- **FR-3** → Epic 2 — local-only raw-data boundary + capability-scoped filesystem access *(reinforced in Epic 3's derived-only sync payload)*
- **FR-4** → Epic 3 — idempotent auto-sync after each set + offline queue
- **FR-5** → Epic 2 — menu-bar/tray presence + sync-state icon + path-override settings panel
- **FR-6** → Epic 3 — per-set summary *(stat computation foundation built in Epic 1)*
- **FR-7** → Epic 3 — energy arc *(BPM-vs-time computation foundation in Epic 1)*
- **FR-8** → Epic 1 — genre normalization on the edge, taxonomy-versioned
- **FR-9** → Epic 4 — Style Evolution month-over-month trend view
- **FR-10** → Epic 4 — library-to-setlist correlation trend
- **FR-11** → Epic 4 — conversion rate (rolling window)
- **FR-12** → Epic 4 — aging shelf (3+ months unplayed)
- **FR-13** → Epic 4 — time-to-first-play
- **FR-14** → Epic 5 — manual segment marking
- **FR-15** → Epic 5 — segment-scoped stats (cloud SQL slice)
- **FR-16** → Epic 5 — Layer 2 manual enrichment
- **FR-17** → Epic 5 — enrichment-driven richer comparisons
- **FR-18** → Epic 5 — opt-in location-based venue suggestion
- **FR-27** → Epic 1 — classification signal computed from Phase 1 onward; confirmation-prompt behavior dormant until Phase 2
- **FR-28** → Epic 5 — algorithmic segment suggestion *(detection algorithm AR-13, computed in the agent stat-engine)*
- **FR-29** → Epic 2 — multi-provider authentication (one account, phone on file)

**Phase 2 (deferred — captured in inventory, epics not yet designed)**

- **FR-19** (Follow), **FR-20** (Feed), **FR-21** (Profile), **FR-22** (Per-track hide), **FR-23** (Visibility tiers), **FR-24** (Network leaderboards), **FR-25** (Circle comparison), **FR-26** (Set comments) → **Phase 2**, gated on SM-1 + SM-2. *Phase-1 groundwork exists (Epic 3 stores Phase-1 sets private-equivalent per AR-9, so Phase-2 read-policies never retroactively expose them).*

**NFR coverage**

- **NFR-1** (performance) → Epic 1 (arithmetic-only parse/stat engine)
- **NFR-2** (privacy) → Epic 2 (fs scoping + RLS isolation), Epic 3 (raw-data boundary on sync), Epic 5 (location opt-in)
- **NFR-3** (cost / no paid AI) → cross-cutting, all epics
- **NFR-4** (reliability / format-drift) → Epic 1 (golden-file CI), Epic 3 (agent error reporting + auto-updater + backfill)
- **NFR-5** (golden-file regression, FR-1/FR-27) → Epic 1

## Epic List

> **Cross-cutting notes & sequencing** *(surfaced via advanced elicitation, 2026-07-20)*
>
> - **Critical path for validation:** **E1 → E2 → E3 → E4** is what tests the Phase-1 gates SM-1 (parsing correctness) and SM-2 (personal value stands alone). **E5 and E6 may trail** — they don't move the validation needle.
> - **Dependency graph (DAG, no cycles):** two **hub artifacts** carry the most coupling and deserve the most care — the **`shared/` derived contract** (produced in E1; consumed by E2/E3, with E4/E5 stats computed over it) and the **Obsidian token system** (produced in E2; consumed by every web surface E3–E7). Post-E3 the plan splits into a **validation track (E4/E5 — do first)** and a **commercialization track (E6/E7)**. The one runtime back-edge is E7's access-gate wrapping E3/E4/E5 — additive, not a restructure.
> - **Code-signing is a day-zero procurement action, not an Epic-2 coding task** (AR-14). Apple Developer Program enrollment and (especially) a Windows **EV** certificate's identity verification can take **1–3 weeks of wall-clock time** with no code involved. Start it in parallel with Epic 1 so the Epic-2 installer story isn't blocked waiting on a cert.
> - **The `shared/` derived contract is frozen-forever (additive-only, AR-1/AR-15) yet designed in Epic 1, before Epic 3 renders it.** Epic 1's contract stories must take the **Set Detail + Style Evolution UX specs as explicit inputs**; this contract is the one artifact to over-invest in getting right.
> - **FR-27's classification signal is computed in Epic 1 but has no Phase-1 consumer** unless **Epic 4** uses it to exclude likely-rehearsal sessions from Style Evolution trends (a Phase-1 data-quality concern the PRD leaves open). **Open design decision** — carry into Epic 4 story design.
> - **✅ RESOLVED — billing scope (Arjun, 2026-07-20): paid launch.** Phase 1 charges $6/mo from launch, so **Epic 7: Subscription & Billing** is added below. Two follow-ups: (a) billing sits **outside the current architecture spine's FR-1..29 scope** — the payment-provider integration + webhook handler likely warrants a brief **architecture addendum**, and is the one sanctioned exception to AD-8's "no bespoke write path" (scoped to billing events, user-visible subscription state still RLS-guarded); (b) consider a **free-trial window** so SM-2 ("personal value stands alone") can still be observed before the paywall converts.
>
> - **✅ Doc-sync debt CLEARED (2026-07-21, implementation-readiness pass):** decisions made in *this* epics doc that were owed back to their source specs are now synced — **(a)** FR-27 "exclude-**visibly**" from Style Evolution (Stories 1.8, 4.1) → synced to **PRD** FR-9/FR-27; **(b)** `session_identity` must be a stable intrinsic session property, not file mtime/name (Story 3.2 AC-6) → synced to **Architecture Spine AD-16**; **(c)** the 30-day recently-downloaded-nudge threshold (Story 4.4) → synced to **PRD** UJ-1 note; **(d)** FR-11's 90-day conversion-rate window (Story 4.3, confirmed 2026-07-21) → synced to **PRD** FR-11/Glossary. NFR-1 stat-engine targets (Story 1.7) are synced to **PRD** §5.1 as a still-**pending** `[ASSUMPTION]` (proposed targets, not yet confirmed by Arjun) — the numbers themselves remain open, only the tracking is now in one place. Also newly added to the PRD in this pass, not previously tracked as debt: an accessibility NFR (§5.5, from UX-DR21) and the production-side format-drift-monitoring half of NFR-4 (§5.4, from AD-13/Story 3.4).

### Epic 1: Foundation & Proven Parsing

Stand up the monorepo (`agent/` · `web/` · `shared/`) and the `shared/` versioned sync contract, then build and **prove** the local parsing + stat engine against real multi-track Serato sessions — clean-room `.session` parser plus a `master.sqlite` play-log reader for Serato 4+ installs (two play-log sources, one `Play` contract), library join (both legacy `database V2` and Serato 4+ `master.sqlite`), off-library embedded-tag fallback with visible "Unknown," edge genre normalization (raw + normalized + `taxonomy_version`), and the core per-set stat math — all golden-file tested offline, closing the **SM-1** parsing-correctness gate before any cloud or code-signing spend. This is the risk-boundary-first foundation everything else builds on; its outcome is concretely demonstrable (point the engine at a real Serato folder → accurate normalized per-set stats).
**FRs covered:** FR-2, FR-8, FR-27 *(signal only; prompt dormant until Phase 2)* — plus the stat-computation foundation for FR-6/FR-7. **ARs:** AR-1, AR-5, AR-6, AR-15, AR-16. **NFRs:** NFR-1, NFR-5.
*Design notes:* (a) the epic **leads with a parser-validation spike** against real sessions before the full pipeline is committed — the algorithm is validated, the clean-room Rust implementation is not; **scope the spike to the riskiest real session types** (multi-track wedding, USB-hosted library, WAV-heavy library); (b) the `shared/` derived-payload/stat-output shape is designed against the **Set Detail + Style Evolution UX** (its frozen, additive-only consumer), not blind; (c) **freeze the `shared/` contract only *after* the spike** — freezing it before parsing reality is known risks additive-only "contract debt" that ripples to E2–E5.

### Epic 2: Account & Agent Onboarding

A DJ creates one Curfew account via any of four paths (email+password, Google, Apple, passkey — auto-linked by verified email, phone number on file), downloads and installs the signed local agent, and the agent auto-detects and asks them to confirm their Serato data folder (including on a USB drive), then quietly watches and captures completed sets into local SQLite using the Epic 1 engine. Establishes the cloud foundation (Supabase + null-safe RLS + additive-only migrations + prod/preview environments), production email delivery for auth, the signed-build/auto-updater pipeline, and the agent's tray UI. *(UJ-3)*
**FRs covered:** FR-1, FR-3, FR-5, FR-29. **ARs:** AR-3, AR-4, AR-10, AR-11, AR-12, AR-14. **UX:** UX-DR1 (Obsidian token system — established here as the first web surface, so auth screens aren't styled against tokens that don't exist yet), UX-DR3 (auth components), UX-DR23 (tray UI), UX-DR19 (first-run path confirm + phone-required states).
*Design notes:* (a) **code-signing (`SIGN`) blocks release/distribution, not local development** — the agent self-tests unsigned; only shipping an installer to a real DJ needs the certs, so parallel procurement (see cross-cutting notes) keeps it off the critical coding path; **fallback: macOS-first launch** if the Windows EV cert's identity verification drags; (b) the `djs` account schema should **anticipate a `subscription_status` concept** even though Epic 7 implements the billing flow — the E7 access-gate is cross-cutting (additive column later is possible, but knowing it's coming shapes the account model).

### Epic 3: Post-Set Sync & Personal Dashboard  ⭐ core value moment

The completed set syncs automatically to the cloud (idempotent `PUT` on a deterministic `set_id`, offline-queued and drained on reconnect, content-column-scoped so overlays are never clobbered), and appears on the DJ's web dashboard the next morning — where they open it and see the per-set summary (top tracks/artists, genre breakdown, BPM distribution, Camelot mixing, length, track count) and the energy arc. Establishes the Obsidian web token system and the signature floating nav as the first authenticated surfaces, plus format-drift resilience and backfill. This is the product's core morning-after reflection moment. *(UJ-1)*
**FRs covered:** FR-4, FR-6, FR-7. **ARs:** AR-2, AR-7, AR-8, AR-9 *(create the `visibility` column + private-equivalent default now — additive-only Phase-2 groundwork, so Phase-2 read-policies never retroactively expose Phase-1 sets)*. **NFRs:** NFR-4. *Design note:* the sync seam is the system's single load-bearing integration — **`shared/` contract tests for idempotency (deterministic `set_id`, no backfill dupes, shared-USB non-collision) and content/overlay column-disjointness are first-class acceptance criteria**, not afterthoughts. **UX:** *(builds on the token system from Epic 2)* UX-DR2 (floating nav — first authenticated surface), UX-DR4 (set card), UX-DR5 (new-set nudge), UX-DR6 (energy-arc chart), UX-DR7 (chart summary), UX-DR8 (tracklist), UX-DR13 (chips), UX-DR15 (avatar), UX-DR17 (dashboard + set detail + profile/settings), UX-DR18 (voice/failure register), UX-DR19–22 (states, primitives, a11y, responsive).

### Epic 4: Style Evolution & Library Utilization

A DJ can see how their playing style trends over time — BPM range, genre diversity, key usage month-over-month, and whether recently-added tracks make it into sets — and hold their library accountable: conversion rate (LED-pip meter), an aging shelf sortable by days-unplayed with a row-level "add to prep crate" action, and time-to-first-play. Reuses the shared trend-chart utility. *(UJ-5, UJ-6)*
**FRs covered:** FR-9, FR-10, FR-11, FR-12, FR-13. **UX:** UX-DR6 (trend chart), UX-DR11 (progress pips), UX-DR12 (aging-shelf list), UX-DR19 (insufficient-history, aging-shelf-empty, recently-downloaded-nudge states).

### Epic 5: Set Segments & Layer 2 Enrichment

A DJ can add meaning on top of an immutable as-played set — split it into labeled time-range segments (algorithm-suggested boundaries they confirm/adjust via drag or keyboard, or add manually), slice per-set stats by segment, and enrich a set with venue / crowd size / event type / free-text notes (with an optional, off-by-default location-based venue suggestion they confirm or edit). All overlays are web-authored and cloud-only; nothing here is ever required for core dashboard stats. *(UJ-7, UJ-4-lite)*
**FRs covered:** FR-14, FR-15, FR-16, FR-17, FR-18, FR-28. **ARs:** AR-8 (overlays cloud-only), AR-13 (segment-detection algorithm). **UX:** UX-DR9 (segment editor), UX-DR10 (Layer 2 form + location), UX-DR20 (drag + keyboard primitives).

### Epic 6: Marketing & Entry Surfaces

A prospective DJ can discover Curfew through a public marketing Landing page (the "compared to what?" hook, with restrained scroll-driven motion used on the Landing only), read a Features walkthrough and a single-tier Pricing page ($6/mo, no comparison grid), and enter the signup/login flow. Launch-facing; sequenced last since SM-1/SM-2 can be validated on the builder's own use before it exists.
**FRs covered:** — *(authentication is FR-29, delivered in Epic 2)*. **UX:** UX-DR14 (pricing card), UX-DR16 (landing / features / pricing + login-signup overlay).

### Epic 7: Subscription & Billing

A DJ can subscribe to Curfew ($6/mo) from the Pricing/entry flow via a payment provider (e.g. Stripe Checkout), manage or cancel through a provider-hosted customer portal, and the product gates the authenticated experience on subscription status — a lapsed/inactive subscription restricts the web experience while the **local agent keeps capturing sets locally** (nothing is lost; data resumes syncing on reactivation). Subscription state lives on the `djs` account as **additive columns** (AR-12); the payment webhook is handled by a Next.js Route Handler pinned to the Node.js runtime (not Edge) — the one sanctioned exception to AD-8's "no bespoke write path," scoped to billing events only. Launch-gating: **must ship before public paid launch, but is not required to validate SM-1/SM-2** on the builder's own use.
**FRs covered:** — *(no numbered FR; realizes PRD §7 monetization + the UX-DR14 pricing CTA)*. **Consideration:** a free-trial window so SM-2 can be observed before the paywall. **🔒 Hard invariant:** the subscription gate restricts the **web experience only — never the local agent's capture**; a lapsed subscriber keeps parsing sets into local SQLite, and they resume syncing on reactivation, so the "nothing is lost" promise holds. **✅ Architecture resolved (2026-07-20):** the billing addendum is now in the Architecture Spine (**AD-18** Stripe Checkout + Node-runtime webhook Route Handler as the one sanctioned AD-8 exception, writing via a single `SECURITY DEFINER` `apply_subscription_event(...)` scoped to four columns; **AD-19** additive `djs` billing columns, `subscription_status` = Stripe's verbatim text, DJ-write-excluded, web-only access gate) and SOLUTION-DESIGN §3.7. Story creation for this epic proceeds against AD-18/AD-19.

---

## Epic 1: Foundation & Proven Parsing

Stand up the monorepo (`agent/` · `web/` · `shared/`) and the versioned sync contract, then build and **prove** the local parse/enrich/stat engine against real Serato sessions — closing the **SM-1** parsing-correctness gate offline, before any cloud or code-signing spend. Ordered so the parser-validation spike (1.2) precedes committing the pipeline, and the `shared/` contract is frozen last (1.10), after parsing reality is known.

### Story 1.1: Monorepo scaffold with three workspaces

As a developer,
I want a from-scratch monorepo with `agent/` (Tauri 2 + Rust), `web/` (Next.js 16), and `shared/` (versioned contract package) wired into one CI pipeline,
So that every later story builds on a consistent, reproducible foundation with no external starter to fight.

**Acceptance Criteria:**

1. **Given** a clean checkout, **When** I run the documented bootstrap command, **Then** all three workspaces install and build, **And** the CI skeleton runs lint + build on each workspace. *(AR-16, AR-1)*
2. **Given** the `shared/` package, **When** it is imported by `agent/` and `web/`, **Then** it exposes a provisional (draft, not yet frozen) sync-payload TS type + JSON-schema stub both can consume. *(AR-1)*
3. **Given** the repository, **When** inspected, **Then** there is no adopted external greenfield boilerplate — the scaffold is first-party. *(AR-16)*
4. **Given** a `supabase/migrations/` folder is seeded, **When** CI runs, **Then** the additive-only migration structure is in place (empty/initial migration applies cleanly). *(AR-12)*

### Story 1.2: Parser-validation spike against real sessions

As a product owner,
I want a throwaway spike that runs the candidate `.session` parsing approach against the riskiest real Serato session types before we commit the full pipeline,
So that the clean-room implementation is validated against reality and the frozen contract is de-risked (SM-1).

**Acceptance Criteria:**

1. **Given** at least one real multi-track wedding session, one USB-hosted-library session, and one WAV-heavy-library session, **When** the spike runs, **Then** it emits parsed play counts + track identities per session and a written go/no-go with observed format quirks. *(Design note a, NFR-5)*
2. **Given** the spike output, **When** compared against ground truth (Serato's own display or the DJ's recollection), **Then** every discrepancy is enumerated and classed as parser-fixable or format-limitation.
3. **Given** the spike concludes, **Then** its learnings are recorded as explicit inputs to the `shared/` contract shape (Story 1.10) — the contract is not frozen before this. *(Design note c)*
4. **Given** the spike concludes, **Then** its code is explicitly **throwaway** — Stories 1.3–1.7 build the production parser fresh; the spike is never extended into production. *(Winston, party 2026-07-20)*

### Story 1.3: Clean-room `.session` parser

As a developer,
I want a clean-room Rust parser that reads a Serato `.session` file into an ordered list of plays (track ref + timestamps),
So that the raw as-played sequence is available on-device for enrichment and stats.

**Acceptance Criteria:**

1. **Given** a valid `.session` file, **When** parsed, **Then** an ordered list of plays with per-play timestamp and track reference is produced. *(AR-5)*
2. **Given** the pinned `triseratops` git commit + `id3` crate, **When** the parser uses them, **Then** it depends on the exact pinned commit (not the stale crates.io `0.0.3`). *(AR-5)*
3. **Given** a malformed or truncated `.session`, **When** parsed, **Then** it fails safely with a diagnostic (never a panic that crashes the agent) **And** the raw file is retained for backfill. *(AR-5, AR-7)*
4. **Given** the same file, **When** parsed twice, **Then** output is deterministic (identical ordered plays).

### Story 1.3b: `master.sqlite` play-log reader

As a developer,
I want a reader that produces the same ordered `Vec<Play>` contract as Story 1.3, sourced from Serato 4+'s `master.sqlite` (`history_session`/`history_entry` tables) instead of a legacy `.session` file,
So that DJs on Serato 4+ — whose legacy `~/Music/_Serato_/History/Sessions/` folder no longer changes — still produce plays for the watcher/capture pipeline.

**Acceptance Criteria:**

1. **Given** a Serato 4+ `master.sqlite`, **When** its `history_session`/`history_entry` tables are read for a given session, **Then** an ordered list of plays is produced in the same shape Story 1.3's `Play` uses (track ref + timestamps), via direct SQL reads — no binary envelope decoding. *(AR-5)*
2. **Given** the same session data, **When** read twice, **Then** output is deterministic (identical ordered plays), matching Story 1.3 AC-4's guarantee.
3. **Given** a session with a malformed or unreadable row, **Then** it fails safely with a diagnostic — never a panic — consistent with Story 1.3 AC-3's failure contract.
4. **Given** Story 2.6 (folder/library auto-detection) and Story 2.8 (set capture), **Then** this reader is the play-log source selected for DJs on a Serato 4+ install, while Story 1.3's `.session` parser remains the source for legacy `database V2` installs — the watcher never has to choose blind. *(closes the scope gap flagged in Story 1.3's Review Findings / Open Questions #1)*

> **Design note:** this story exists because Story 1.2's findings (§6) found the legacy `.session` folder frozen as of 2025-12-11 on real hardware, while `master.sqlite` holds that DJ's entire live play history with no binary decoding needed. Story 1.4 ("Library join") stays scoped to **metadata enrichment only** (BPM/key/genre lookup) for both legacy and Serato-4+ libraries — it must not also become the play-log ingestion path; that would conflate two different concerns (metadata join vs. play-log source) under one story. Kept as a sibling to 1.3 rather than folded into 1.4.

### Story 1.4: Library join for in-library enrichment

As a DJ,
I want each played in-library track resolved to its BPM/key/genre from the Serato library DB,
So that my per-set stats reflect real track metadata.

**Acceptance Criteria:**

1. **Given** a legacy `database V2` library, **When** a played track is in-library, **Then** BPM/key/genre resolve from it. *(FR-2, AR-5)*
2. **Given** a Serato 4+ `master.sqlite` library, **When** a played track is in-library, **Then** BPM/key/genre resolve from it. *(FR-2, AR-5)*
3. **Given** tracks referenced by relative vs absolute paths, **When** joined, **Then** paths resolve against the configured library root correctly. *(AR-5)*
4. **Given** an in-library track missing a metadata field, **Then** that field routes to the embedded-tag fallback (Story 1.5), never a guess.

### Story 1.5: Off-library embedded-tag fallback with visible "Unknown"

As a DJ,
I want tracks not in my Serato library to still get BPM/key/genre from their embedded file tags, and to show "Unknown" when truly absent,
So that off-library plays are never silently dropped or fabricated.

**Acceptance Criteria:**

1. **Given** an off-library track, **When** enriched, **Then** BPM comes from the Serato Autotags GEOB, key from ID3 `TKEY` (or Vorbis), genre from ID3 `TCON` (or Vorbis). *(FR-2)*
2. **Given** neither library nor embedded source has a value, **When** displayed, **Then** the field shows "Unknown" — never omitted, never guessed. *(FR-2)*
3. **Given** local audio DSP / key-finding, **Then** it is out of scope — no DSP is invoked. *(FR-2 scope)*

### Story 1.6: Edge genre normalization, versioned

As a DJ,
I want raw Serato genre tags normalized to a fixed Curfew taxonomy on the agent, storing raw + normalized + `taxonomy_version` per play,
So that genre stats are consistent and trends recompute cleanly after the table evolves.

**Acceptance Criteria:**

1. **Given** a raw genre string, **When** normalized against the fixed table, **Then** a normalized value + the current `taxonomy_version` are stored alongside the raw string. *(FR-8, AR-6)*
2. **Given** a raw genre absent from the table, **When** normalized, **Then** it maps to the table's defined default bucket deterministically (never dropped).
3. **Given** V1, **Then** the taxonomy is not DJ-editable — no edit UI exists. *(FR-8)*

### Story 1.7: Core per-set stat engine

As a DJ,
I want the agent to compute per-set stats arithmetically from the enriched plays,
So that accurate summaries and the energy arc render with no ML or cloud round-trip.

**Acceptance Criteria:**

1. **Given** an enriched set, **When** stats compute, **Then** it produces most-played tracks; most-played artists (**artist-tagged plays only** — no "Unknown" bucket, no untagged footnote); genre breakdown; BPM distribution; key/Camelot mixing stats; set length; track count. *(FR-6 foundation, CAP-5)*
2. **Given** the same set, **When** the energy-arc series computes, **Then** BPM-vs-timestamp points are produced. *(FR-7 foundation)*
3. **Given** any stat, **When** computed, **Then** it is arithmetic-only — no ML/inference is invoked. *(NFR-1, NFR-3)*
4. **Given** a ~5,000-track library and a typical set, **When** the full parse→enrich→stat pipeline runs, **Then** it meets concrete targets: a single set's stat computation ≤ 500 ms, a full-library pass ≤ 10 s (p95), agent idle CPU ≈ 0, and no UI-perceptible lag. *[TARGETS — confirm with Arjun]* *(NFR-1; Amelia's "no number = not a test", party 2026-07-20)*

### Story 1.8: Live/practice confidence signal

As the system,
I want a live-vs-practice classification confidence computed per session from Phase 1 onward, with no user-facing prompt,
So that the signal exists for later use (Phase 2 confirmation; Epic 4 trend exclusion) without gating anything now.

**Acceptance Criteria:**

1. **Given** a parsed session, **When** classified, **Then** a confidence value is computed and stored. *(FR-27)*
2. **Given** Phase 1, **Then** no confirmation prompt is shown **And** the DJ's own dashboard is never gated by this signal. *(FR-27)*
3. **Given** the Epic 4 decision to exclude low-confidence sessions from Style Evolution **visibly** (a reveal, never a silent erase), **Then** the signal is exposed in a form Epic 4 can both filter on **And** surface an "N sessions hidden — show them?" affordance from. *(Resolved 2026-07-20: exclude-**visibly**; PRD-sync owed)*
4. **Given** distinguishing home rehearsal from a live gig by data alone, **Then** it is out of scope — the signal is a heuristic confidence, not ground truth. *(FR-27 scope)*

### Story 1.9: Golden-file regression harness

As a developer,
I want CI golden-file regression tests over known-good `.session`/library fixtures,
So that a Serato format change is caught before it silently corrupts synced data.

**Acceptance Criteria:**

1. **Given** golden `.session` + `database V2` + `master.sqlite` fixtures with expected parsed output, **When** CI runs, **Then** any deviation fails the build. *(NFR-4, NFR-5, AR-7 layer 1)*
2. **Given** a newly discovered format quirk, **When** a fixture is added, **Then** it becomes a permanent regression guard.
3. **Given** the fixture set, **Then** it covers both legacy and Serato 4+ library formats. *(AR-5)*

### Story 1.10: Freeze the `shared/` sync contract

As a developer,
I want the `shared/` versioned sync-payload / stat-output contract frozen (TS types + JSON-schema) after the spike, validated on both agent and cloud, additive-only, carrying `agent_version`,
So that the one frozen-forever hub artifact reflects parsing reality and its Set Detail + Style Evolution consumers.

**Acceptance Criteria:**

1. **Given** the spike + stat-engine outputs and the Set Detail + Style Evolution UX specs as inputs, **When** the contract is authored, **Then** its shape covers everything those consumers render. *(AR-1, AR-15, Design note b)*
2. **Given** the contract, **When** a payload is built on the agent and received on the cloud, **Then** both validate against the same schema via contract tests in `shared/`. *(AR-1)*
3. **Given** a proposed contract change, **When** CI runs, **Then** only additive changes pass; every payload carries `agent_version`; the cloud accepts the last N agent versions. *(AR-1)*
4. **Given** sequencing, **Then** the contract is frozen only after Story 1.2's spike — never before. *(Design note c)*

## Epic 2: Account & Agent Onboarding

A DJ creates one Curfew account via any of four paths, installs the signed local agent, confirms their Serato data folder (including on USB), and the agent quietly captures completed sets into local SQLite. Establishes the cloud foundation (Supabase + null-safe RLS + additive migrations + prod/preview), production email delivery for auth, the Obsidian token system as the first web surface, the signed-build/auto-updater pipeline, and the tray UI. *(UJ-3)*

### Story 2.1: Supabase cloud foundation + isolation baseline

As a developer,
I want a Supabase prod project with preview branches, an additive-only migration pipeline, a `djs` table 1:1 with `auth.users`, and null-safe per-DJ RLS,
So that all cloud data is per-DJ isolated at the DB layer from the very first row.

**Acceptance Criteria:**

1. **Given** the Supabase setup, **Then** prod is a single dedicated project on the **free tier** at launch; preview branches (a Pro-tier feature) are deferred until the tier upgrades — until then, CI's existing `supabase start` ephemeral-local-Postgres job is the per-PR verification. *(AR-12, revised 2026-07-27)*
2. **Given** a schema change, **When** shipped, **Then** it is an additive-only Supabase-CLI migration committed in the monorepo; a drop/rename of a live column is rejected. *(AR-12)*
3. **Given** a `djs` row, **Then** it is 1:1 with `auth.users`, created idempotently on verified email, **And** RLS enforces `auth.uid() IS NOT NULL AND auth.uid() = dj_id` (unreachable across DJs even with an API-layer bug). *(AR-4, AR-10, NFR-2)*
4. **Given** the account model, **Then** it anticipates an additive `subscription_status` concept for Epic 7 (no billing logic added yet). *(Epic 2 design note b)*

### Story 2.2: Obsidian design-token system + web shell

As a developer,
I want the Obsidian dark token system and a base web shell implemented as the first web surface,
So that every later screen — starting with auth — is styled against real tokens, not placeholders.

**Acceptance Criteria:**

1. **Given** the token set, **Then** background `#101319` (blue-black, revised 2026-07-26 from the original `#121415`), five surface-container elevation tiers, Ice Cyan primary (revised 2026-07-26 from the original Electric Lavender — retained as a sanctioned alternate), and the dusty-rose error family are defined as reusable tokens. *(UX-DR1)*
2. **Given** typography, **Then** Hanken Grotesk (headlines), Inter (body), and Geist mono (`mono-data`/`label-sm`) are wired to the type scale. *(UX-DR1)*
3. **Given** spacing/radius, **Then** a 4px baseline is used **And** `rounded.full` (9999px) is reserved exclusively for floating nav, avatar, and status dots. *(UX-DR1)*
4. **Given** the web shell, **When** rendered, **Then** it consumes only tokens (no hard-coded colors) and core text passes WCAG 2.2 AA. *(UX-DR21)*

> **Sizing note (party 2026-07-20):** original single Story 2.3 (four auth paths + linking + phone-on-file) was ~4 dev sessions — split into 2.3a / 2.3b / 2.3c per Amelia/Winston.

### Story 2.3a: Email-identity path (email+password + passkey)

As a DJ,
I want to sign up / log in with email+password and optionally enable a passkey,
So that I have a base Curfew identity anchored to my verified email.

**Acceptance Criteria:**

1. **Given** email+password signup, **When** I verify my email, **Then** one `dj` account exists anchored to that verified email. *(FR-29, AR-10)*
2. **Given** the email path, **When** I add a passkey (WebAuthn), **Then** it attaches as an add-on to that same account — not a separate identity. *(FR-29, AR-10)*
3. **Given** an auth failure, **Then** the calm inline auth-failed copy shows (no modal, no alarm color). *(UX-DR18, UX-DR19)*

### Story 2.3b: OAuth paths + account linking (Google, Apple)

As a DJ,
I want to sign in with Google or Apple and land on my one account,
So that my provider choice never forks me into duplicate identities.

**Acceptance Criteria:**

1. **Given** Google or Apple sign-in, **When** the verified email matches an existing `dj`, **Then** it links to that same account (idempotent on verified email). *(FR-29, AR-10)*
2. **Given** Google or Apple sign-in with a new verified email, **When** it completes, **Then** a `dj` account is created idempotently. *(AR-10)*
3. **Given** distinct verified emails across providers, **Then** they are **not** auto-merged in v1. *(AR-10)*

### Story 2.3c: Phone-on-file (post-signup prompt)

As a DJ,
I want a phone number captured after signup, regardless of which path I used,
So that every account has a phone on file as required.

**Acceptance Criteria:**

1. **Given** any signup path — email+password (after confirmation) or Google/Apple OAuth — **When** it completes without a phone on file, **Then** I am prompted once for a phone number (single-field, required). *(FR-29, AR-10, UX-DR19 phone-required — revised 2026-07-27 from OAuth-only scope: AR-10/FR-29 require phone "regardless of signup path," and the original 2.3a/2.3c split had left the email+password path with no story ever collecting it. Arjun ruling, 2026-07-27: every account needs a phone number, close the gap rather than carry it further.)*
2. **Given** the phone-required state, **Then** it renders as the specified one-field post-signup screen, not a blocking modal wall. *(UX-DR19)*

### Story 2.3d: Production email delivery (SMTP provider wiring)

As a DJ,
I want the confirmation email I receive at signup to actually arrive at my real inbox,
So that email+password signup (2.3a) and future auth email (password reset, email change) work outside local development.

**Acceptance Criteria:**

1. **Given** a production Supabase project, **When** `[auth.email.smtp]` is configured against a real transactional email provider (e.g. Resend), **Then** signup-confirmation email sends successfully to a real inbox. *(FR-29 production completeness)*
2. **Given** the provider's sending domain, **When** SPF/DKIM/DMARC records are verified with the provider, **Then** confirmation email delivers without landing in spam.
3. **Given** local development, **Then** `supabase start`'s `local_smtp` testing inbox is unchanged — this story only adds the production-path configuration, no regression to Story 2.3a's local flow.
4. **Given** provider credentials, **Then** they are stored as an encrypted secret at the Supabase-project level (dashboard/`supabase config push`), never committed to the repo.

### Story 2.4: Auth UI components

As a DJ,
I want polished auth components that match the design system,
So that signing in feels native to Curfew's console voice.

**Acceptance Criteria:**

1. **Given** the auth form, **Then** ghost-style inputs (transparent, bottom-border, mono values, label-sm labels) render. *(UX-DR3)*
2. **Given** passkey enable, **Then** the Biometric Anchor row (fingerprint badge + radio indicator) renders. *(UX-DR3)*
3. **Given** Google/Apple sign-in, **Then** each uses its official button lockup and mandated colors (the one sanctioned palette exception); primary/secondary buttons have no pills or gradients. *(UX-DR3)*
4. **Given** keyboard-only use, **Then** the full auth flow is operable **And** focus rings use the lavender glow at AA contrast. *(UX-DR21)*

> **⚑ Prereq — provision passkeys on the prod Supabase project (owner of the prod-passkey gap; from 2.3b review, 2026-07-28).** AC-2 makes the Biometric Anchor (passkey enable) a first-class, *functional* auth component — this is the first story where prod passkeys must actually work, so it owns closing the gap found during 2.3b's prod OAuth verification: `[auth.passkey]`/`[auth.webauthn]` (Story 2.3a) exist only in local `supabase/config.toml` (`rp_id = "localhost"`) and were never provisioned on prod, so `signInWithPasskey()` silently no-ops against `prod` today. This story's DoD must include: enabling passkey/WebAuthn on the prod Supabase project (Dashboard, mirroring how 2.3b/2.3d provisioned OAuth + email), setting `rp_id` to the real prod web origin's host (not `localhost`), and human-verifying a real passkey register + sign-in against `prod`. Tracked in `deferred-work.md` (2.3b 2nd review, 2026-07-28) and `pre-launch-services-checklist.md` §4.

### Story 2.5: Agent shell + tray UI

As a DJ,
I want the local agent to live as a menu-bar/tray icon with a minimal settings panel,
So that it stays out of my way while showing sync state.

**Acceptance Criteria:**

1. **Given** the agent runs, **Then** its only UI is a tray icon with four states — idle / syncing / failed / drive-not-connected — each carrying a text label/tooltip (not color/glyph alone). *(FR-5, UX-DR23, UX-DR21)*
2. **Given** I open settings, **Then** the panel exposes only the Serato folder path override, in native OS chrome (not skinned to website tokens). *(FR-5, UX-DR23)*
3. **Given** the agent, **Then** it is never a full window and never mirrors the website UI. *(UX-DR22)*

### Story 2.6: Serato folder auto-detection + first-run confirm

As a DJ,
I want the agent to auto-find my Serato data folder (including on USB), let me confirm/override it, and resume when a drive reconnects,
So that setup is one confirmation and keeps working across removable media.

**Acceptance Criteria:**

1. **Given** OS defaults (`~/Music/_Serato_/` on macOS, Windows equivalent), **When** the agent starts, **Then** it auto-discovers the Serato data directory **And** scans connected removable/USB volumes. *(FR-1)*
2. **Given** nothing is found, **Then** I can set a manual path override via the tray. *(FR-1)*
3. **Given** first run, **When** a path is detected, **Then** I confirm or edit it before it is used — never silent auto-selection. *(UX-DR19 first-run, UX-DR20 confirm-never-silent)*
4. **Given** a removable drive is reconnected, **Then** the agent auto-detects it and resumes watching. *(FR-1)*
5. **Given** the detected install is Serato 4+ (`master.sqlite` present), **Then** the agent watches `master.sqlite` for new `history_session` rows as the play-log source (Story 1.3b), not the legacy `.session` folder, which may no longer change on that install. *(FR-1; closes the scope gap flagged in Story 1.3's Review Findings)*

### Story 2.7: Local-only raw-data boundary

As a DJ,
I want the agent's filesystem access scoped to only my configured Serato path, and raw files never to leave my machine,
So that my private library data stays local by construction.

**Acceptance Criteria:**

1. **Given** the agent, **Then** its filesystem capability is scoped to the configured Serato path only (not broad disk access). *(FR-3, NFR-2)*
2. **Given** any network transmission, **Then** raw `.session` files and the raw library DB are never sent off-machine — only derived/structured data leaves, over HTTPS. *(FR-3, NFR-2)*
3. **Given** a contract test on the outbound payload, **Then** it asserts no raw-file blob is present. *(AR-1)*

### Story 2.8: Set capture into local SQLite

As a DJ,
I want completed sets captured and stored durably in local SQLite via the Epic 1 engine,
So that my sets survive offline and are available to sync and backfill.

**Acceptance Criteria:**

1. **Given** a completed Serato session with no DJ action, **When** detected, **Then** the agent runs the Epic 1 parse/enrich/stat engine — Story 1.3's `.session` parser or Story 1.3b's `master.sqlite` reader, per Story 2.6's source selection — and writes the result + retained raw to local SQLite. *(FR-1, AR-3)*
2. **Given** local SQLite, **Then** it serves as durable parse + offline cache + raw retention, authoritative for a set until it syncs. *(AR-3)*
3. **Given** a set already captured, **When** re-detected, **Then** it is not duplicated locally (deterministic session identity). *(AR-2 foundation)*
4. **Given** an interrupted or partial session (laptop sleep, agent crash, drive yanked mid-gig), **Then** "completed" is defined by an explicit completion signal — a partial capture is marked **incomplete** and is **not** synced as if it were the whole night; it either resumes or is flagged, never silently truncated. *(Boundary's hole #3, party 2026-07-20 — sharpens FR-1's "completed session")*

> **Sizing note (party 2026-07-20):** original single Story 2.9 (two-OS signing + notarization + updater keypair) split into 2.9a / 2.9b / 2.9c per Winston — and **local development self-tests unsigned throughout** (signing blocks distribution, not dev; Epic 2 design note a). Ship order: 2.9a first (macOS-first launch is the accepted fallback if the Windows EV cert's identity verification drags).

### Story 2.9a: macOS signed build + notarization

As a developer,
I want `tauri-action` producing a signed, notarized macOS build,
So that macOS DJs can install an agent Gatekeeper trusts.

**Acceptance Criteria:**

1. **Given** the CI pipeline, **When** a macOS release is cut, **Then** it produces an Apple Developer ID-signed, notarized build; the cert lives as an encrypted CI secret. *(AR-14)*
2. **Given** local development, **Then** the agent self-tests unsigned. *(Design note a)*

### Story 2.9b: Windows signed build

As a developer,
I want `tauri-action` producing a Windows OV/EV-signed installer,
So that Windows DJs can install without a SmartScreen block.

**Acceptance Criteria:**

1. **Given** the CI pipeline, **When** a Windows release is cut, **Then** it produces an OV/EV-signed installer; the cert lives as an encrypted CI secret. *(AR-14)*
2. **Given** the Windows EV cert's identity verification can take 1–3 weeks, **Then** a macOS-first launch (Story 2.9a) is an accepted fallback while it clears. *(Design note a)*

### Story 2.9c: Signed auto-updater pipeline

As a developer,
I want a signed auto-updater with its own keypair,
So that we can push format-drift fixes DJs' agents will trust and apply.

**Acceptance Criteria:**

1. **Given** a release, **Then** `tauri-action` auto-generates the updater JSON + `.sig`. *(AR-14)*
2. **Given** the updater, **Then** it uses a **separate mandatory update-signing keypair**, distinct from the platform code-signing certs; the updater key lives as an encrypted CI secret. *(AR-14)*

### Story 2.10: Agent secure token storage

As a DJ,
I want the agent to authenticate to the cloud and persist its refresh token securely,
So that my sets sync under my account without re-login and without exposing tokens.

**Acceptance Criteria:**

1. **Given** the agent links to my account, **Then** it obtains a Supabase JWT + refresh token and persists the refresh token via Tauri secure storage (not browser storage). *(AR-10)*
2. **Given** an expired JWT, **When** the agent syncs, **Then** it refreshes transparently. *(AR-10)*
3. **Given** the stored token, **Then** it is scoped to my `dj` account so captured sets sync under the correct `dj_id`. *(AR-10, AR-4)*

### Story 2.11: Account deletion + data export (manual runbook)

As a DJ,
I want a way to delete my account and its data, and to get an export of it, on request,
So that handing Curfew my whole library history isn't a one-way trip — even before a self-serve control exists.

**Acceptance Criteria:**

1. **Given** a deletion request, **Then** a documented, tested runbook cascades a delete of every row owned by `dj_id` across all tables (`sessions`, `sets`, `plays`, `segments`, enrichment overlays, `djs`), deletes the Stripe customer if one exists, and purges the local agent SQLite on next launch. *(NFR-2 / CCPA-level posture; Paige's catch, party 2026-07-20)*
2. **Given** an export request, **Then** the same runbook produces the DJ's derived data in a portable format.
3. **Given** MVP scope, **Then** this is a **manual/operator runbook + a "delete my account" support link** (surfaced from the Profile/Settings screen, Story 3.10) — **not** a self-serve in-app feature; full self-serve deletion + automated portability are backlogged. *(Ruling, party 2026-07-20: CCPA thresholds don't bind a launch-size business)*
4. **Given** Curfew later lists on the Apple App Store or Google Play, **Then** their in-app-account-deletion guideline triggers and this must become a self-serve feature — tracked now, built then. *(Winston / Mary, party 2026-07-20)*

> **⚑ AC-3 amended — the delete-account link is CUT from MVP (Arjun, 2026-08-05, Story 3.10 design session; see `implementation-artifacts/3-10-settings.md` D-12).** AC-3's *"'delete my account' support link, surfaced from the Profile/Settings screen, Story 3.10"* does **not** ship: Story 3.10 renders a Privacy section with an **export-request link only** (`mailto:support@curfew.vip`), no deletion affordance. Recorded here rather than left to silently contradict 3.10's built screen. **Unchanged by this amendment:** AC-1's runbook (deletion still happens, operator-side, on request), AC-2's export, and AC-4 — the App-Store guideline still forces a self-serve deletion feature if Curfew ever lists, and that trigger is untouched. Revisit the in-app link whenever real users exist or a store listing is contemplated.

## Epic 3: Post-Set Sync & Personal Dashboard  ⭐ core value moment

The completed set syncs automatically (idempotent `PUT` on a deterministic `set_id`, offline-queued, content-column-scoped), and appears on the DJ's web dashboard the next morning — where they open it and see the per-set summary and energy arc. Establishes the Obsidian web surfaces (floating nav first), format-drift resilience, and backfill. This is the product's core morning-after reflection moment. *(UJ-1)*

### Story 3.1: Sessions/sets/plays schema + visibility + content/overlay split

As a developer,
I want the cloud schema for `sessions`, `sets`, `plays` with a `visibility` column defaulting to private-equivalent and content vs overlay columns kept disjoint,
So that synced content lands cleanly and Phase-2 read-policies never retroactively expose Phase-1 sets.

**Acceptance Criteria:**

1. **Given** the schema, **Then** `sessions` (immutable anchor), `sets` (with denormalized `derived` jsonb render-cache), and `plays` (with `in_library`, raw + normalized genre, `taxonomy_version`) exist. *(AR-15)*
2. **Given** `visibility`, **Then** it is the enum {public, friends_only, private} **And** Phase-1 sets default to private-equivalent and are never retroactively exposed. *(AR-9)*
3. **Given** content vs overlay columns, **Then** they are disjoint (overlay columns exist but are agent-untouchable). *(AR-8)*
4. **Given** the change, **Then** it ships as an additive-only migration. *(AR-12)*

### Story 3.2: Idempotent set sync

As a DJ,
I want each completed set to sync via an idempotent `PUT /sets/:set_id` on a deterministic namespaced id, updating only content columns,
So that a set appears in the cloud exactly once and re-parses never duplicate it or clobber overlays.

**Acceptance Criteria:**

1. **Given** a set, **When** synced, **Then** it PUTs to `set_id = hash(dj_id, session_identity)` — deterministic, never a fresh UUID, never session-identity alone. *(FR-4, AR-2)*
2. **Given** a re-parse/re-run, **When** synced again, **Then** content updates in place with no duplicate row and no re-keying/re-partition. *(AR-2)*
3. **Given** the upsert, **Then** it is column-scoped to content columns; overlay columns are never touched, enforced by a `shared/` contract test. *(AR-8)*
4. **Given** two DJs sharing a USB library, **Then** their sessions do not collide (dj_id is in the key). *(AR-2)*
5. **Given** contract tests for idempotency, no-backfill-dupes, shared-USB non-collision, and content/overlay disjointness, **Then** they are first-class passing acceptance criteria, not afterthoughts.
6. **Given** `session_identity` (the input to the AC-1 hash), **Then** it is derived from a **stable intrinsic property of the session** (its immutable start-anchor / first-play identity) — **never** file mtime, path, or filename — so a later Serato re-save does not re-key or duplicate the set, **And** two distinct same-night sessions never collide. *(Boundary's hole #1, party 2026-07-20 — refines AR-2; architecture-spine-sync owed)*

### Story 3.3: Offline sync queue

As a DJ,
I want a set completed while offline to queue locally and sync automatically on reconnect,
So that I never lose a set to a bad connection at the venue.

**Acceptance Criteria:**

1. **Given** no connectivity at set completion, **When** the set is captured, **Then** it queues in local SQLite. *(FR-4)*
2. **Given** connectivity returns, **Then** the queue drains automatically and idempotently (retries produce no duplicates). *(FR-4, AR-2)*
3. **Given** the tray, **Then** it reflects "offline / queued" with a text-labeled glyph. *(UX-DR19 sync-offline, UX-DR23)*
4. **Given** two agents on one account draining the same shared-USB session (a rare multi-device / shared-USB edge persona), **When** both `PUT` the same `set_id`, **Then** MVP behavior is explicit **last-write-wins** on content columns — accepted as a deliberate MVP choice (not a silent gap); a writer-of-record rule is deferred and does **not** change the architecture spine. *(Ruling, party 2026-07-20 — Arjun)*

### Story 3.3b: Version-agnostic history capture (watch-both + capture-time dedup)

*Surfaced by Story 3.3 manual verification (2026-07-31) as a silent-capture incident — the most severe class of failure this product can have: a Serato 4 DJ pointing at a USB `_Serato_` folder (the default migrated/USB layout) is classified legacy, watches a non-existent `History/Sessions/` path, and captures **nothing**, with the agent showing healthy `Idle` the whole time. Caught pre-launch by manual verification. Full investigation + decided design: `_bmad-output/implementation-artifacts/serato4-history-location-detection-gap-2026-07-31.md`; ledger: `deferred-work.md`.*

As a DJ,
I want the agent to capture my play history no matter which Serato generation is writing it or where my library lives,
So that I never silently lose nights to a setup detail I never knew mattered.

**Acceptance Criteria:**

1. **Given** an install exposing both a Serato 4 internal `master.sqlite` and a legacy `History/Sessions` catalogue, **When** the agent watches, **Then** it watches **both** sources concurrently rather than selecting one — so a silently-watched empty source can never be the whole picture. *(FR-4; direct fix for the 3.3 incident)*
2. **Given** the same real-world night surfaces from both sources, **Then** the Serato 4 capture wins and the legacy twin is suppressed before sync — no duplicate set reaches the cloud — enforced by a capture-time test, since the two formats emit **deliberately non-colliding** `session_identity` values (`serato4:{id}` vs `legacy:{fnv1a(path+start_time)}`, `capture.rs:473`) that Story 3.2's idempotency key would **not** dedup. *(Story 2.6 AC-5 "Serato 4 wins" precedence, moved from watch-time selection to capture-time dedup; AR-2)*
3. **Given** a Serato 4 install is present, **Then** the fixed internal `master.sqlite` is always a watched source regardless of a DJ's library-folder override (the saved override no longer skips detection of it — `mod.rs:80-82`), **And** `joiner::serato4::open_read_only(root, db_path)`'s containment check is satisfied by swapping `root` to the internal container on redirect rather than refusing the internal `db_path`. *(fixes the override-precedence root cause + the `open_read_only` root/db_path coupling)*
4. **Given** the DJ points the override at a folder with no reachable history, **When** they Save, **Then** the confirm UI rejects it **synchronously** with a specific reason ("No Serato library found here — point me at your `_Serato_` folder"), never a silent green. *(UX-DR18 calm failure copy)*
5. **Given** the fix, **Then** no new tray state is introduced — runtime staleness stays owned by the existing `DriveNotConnected` (drive unplugged) and Story 3.4 (post-setup format/layout drift), so this story does not duplicate one or pre-empt the other. *(UX-DR19 state ownership)*
6. **Given** the live watch/capture path, **Then** it carries automated coverage for: both-sources-present capture, the Serato-4-wins dedup on a night present in both, internal-path-wins-over-a-legacy-override, and Save-time rejection of a no-history folder — the incident escaped precisely because the live loop had no such coverage (standing gap from Story 2.6's review). *(AR-7 layer 1 discipline)*

**Open questions (logged, non-blocking — the AC-2 dedup guard keeps AC-1 safe either way):**
- Does Serato 4 ever write a **new** `.session` file for a set it also records in `master.sqlite`? One data point (Arjun's machine, 2026-07-31) says no; this determines whether AC-2's guard is load-bearing or belt-and-suspenders. A second migrated install settles it.
- Windows Serato 4 internal history path is unconfirmed (`SERATO4_HOME_RELPATH` is macOS-only, `detect.rs:14-19`).

**Explicitly deferred to a separate follow-on story (Arjun 2026-07-31, "onboarding polish can be done later as long as we know to do it"):** first-run **verified setup** — a live test capture proving capture works on the DJ's exact machine (the only thing that closes the residual "path validates but new plays land elsewhere" false-green); optional "on Serato 4? you're all set" copy, **never a version requirement**. Tracked in `deferred-work.md`.

### Story 3.4: Format-drift resilience + backfill

As the system,
I want agent-side error reporting tagged by `agent_version` and the ability to backfill affected sets from retained raw data,
So that a Serato format change is detected and recoverable without data loss.

**Acceptance Criteria:**

1. **Given** a parse/enrich error, **When** it occurs, **Then** it is reported tagged with `agent_version`. *(AR-7 layer 2, NFR-4)*
2. **Given** a fix shipped via the signed auto-updater, **When** affected sets are reprocessed, **Then** they backfill from raw data retained in local SQLite. *(AR-7 layer 3 + backfill)*
3. **Given** format-drift is detected, **Then** the tray shows the calm "format-drift paused" state and copy. *(UX-DR18, UX-DR19)*
4. **Given** the three drift layers (CI golden files, tagged error reporting, signed updater + backfill), **Then** all three are present. *(AR-7)*

### Story 3.5: Floating pill nav

As a DJ,
I want the signature floating pill nav present on every authenticated screen,
So that navigation is consistent, glanceable, and keyboard-operable.

**Acceptance Criteria:**

1. **Given** any logged-in screen, **Then** the bottom-center glassy pill nav (backdrop-blur over surface-container @90%, hairline border) is present. *(UX-DR2)*
2. **Given** the nav, **Then** the active item is solid lavender **And** the menu trigger opens an upward popover (hover desktop / tap touch) for secondary items. *(UX-DR2)*
3. **Given** keyboard-only use, **Then** every nav item and the popover are fully operable. *(UX-DR2, UX-DR21)*
4. **Given** mobile, **Then** the nav stays bottom-anchored. *(UX-DR22)*

### Story 3.6: Dashboard home

As a DJ,
I want a dashboard showing my recent sets as cards, with a cold-start state and a new-set nudge,
So that the morning after a gig I land somewhere that reflects my night.

**Acceptance Criteria:**

1. **Given** synced sets, **Then** each renders as a Card-Reflection set card (hairline border, no shadow, mono date/session-id header, genre chips, energy-arc thumbnail); clicking anywhere opens Set Detail. *(UX-DR4, UX-DR13, UX-DR17)*
2. **Given** no sets yet, **Then** the cold dashboard state renders, positive-framed with no error tone. *(UX-DR19 cold dashboard)*
3. **Given** a newly detected set, **Then** the declinable inline New-Set Nudge (lavender @20% border, pulsing lavender dot, "NEW SET DETECTED", equal-weight Add/Skip, no alarm colors) shows; Skip persists per-set and never re-prompts. *(UX-DR5, UX-DR19)*
4. **Given** the nudge, **Then** it is never a modal and never a push. *(UX-DR5, UX-DR20)*

> **⚑ Refinement (Arjun, 2026-08-02 — Story 3.6 planning + real-data findings; authored story: `implementation-artifacts/3-6-dashboard-home.md`).** Story 3.6 was widened and its ACs revised: **(1)** the New-Set Nudge's Add/Skip → a **passive NEW marker** (unopened = new; opening clears it; no Add button; deletion is the removal path) — sets already auto-sync, so confirm-to-add was ceremony. **(2)** **Card depth** locked exactly: card face = mono header · energy-arc thumbnail · 2–3 genre chips · set length · track count; deeper stats reserved for Set Detail. **(3)** **Fixed app-shell** — the page does not scroll (`100dvh`); only the set list scrolls within its own region. **(4)** A **basic dancefloor detector ships from the jump** (global-heuristic v0, client-side from `plays[]`) so card/detail stats reflect the dancefloor, not warm-up/dinner filler — knowingly interim, superseded by Story 5.2's per-DJ calibration (AR-13). **(5)** Folded in (the dashboard is only worth opening if its stats are *true*): the **agent-side stat-correctness fixes** — Camelot key recovery (read Serato `key_value` INT not the free-text `key`; ~12%→~94% coverage; verified mapping in memory `bug-serato-key-parsing`), a genre-source re-check, and a **backfill of the 491 already-captured local sets**. **(6)** Dashboard renders from a **real committed fixture** (set 975 from `local.sqlite`), not lorem-ipsum, behind a data-access seam that later swaps to Supabase. **(7)** Liquid-metal (`@paper-design/shaders`) CTA set up in `app/components/ui/` — a WebGL hero/CTA used **in-product too**, never a general Button variant.

### Story 3.7: Set Detail summary + tracklist

As a DJ,
I want a Set Detail view with the full per-set summary and tracklist,
So that I can study exactly what I played and how it landed.

**Acceptance Criteria:**

1. **Given** a set, **Then** Set Detail shows most-played tracks/artists, genre breakdown, BPM distribution, key/Camelot mixing stats, set length, and track count. *(FR-6, UX-DR17)*
2. **Given** most-played artists, **Then** it ranks artist-tagged plays only (no Unknown bucket, no untagged footnote). *(FR-6, CAP-5)*
3. **Given** the tracklist, **Then** per-track timeline rows (title, artist, timestamp) render with a vertical connector; the top "impact" track gets a highlighted node + peak-metric annotation; "View Full Tracklist" expands from the top-tracks summary; unknown track data uses the FR-2 fallback. *(UX-DR8)*
4. **Given** a long tracklist, **Then** it paginates / "load more" — never infinite scroll. *(UX-DR20)*

> **⚑ Refinement (Arjun, 2026-08-02).** Set Detail's default view **filters stats to the detected dancefloor segment** (recomputed from `plays[]`), not the whole night — "stats a DJ can actually use, not clouded by unrelated tracks." It shows a **"we detected dancefloor from X–Y"** line with an **edit** affordance; the editor is the **tracklist with two draggable pointers** the DJ moves to bracket the segment (the tracklist-based form of Story 5.3's editor), and that **same Set Detail surface** hosts second-layer enrichment (tags, pics — Story 5.5). **Delete-set** lives here (calm, non-alarm confirm; hard delete, not a visibility flag). Whole-set stats are the honest fallback until a segment is set. Harmonic/**Camelot mixing** is a real ~94%-coverage stat post key-fix and earns a headline slot here.

> **⚑ Dashboard-redesign carry-over (Arjun, 2026-08-03).** During the dashboard hero-chart decision (see `_bmad-output/implementation-artifacts/dashboard-redesign/PLAN.md`, D8), a **key/harmonic timeline** — the set's key progression over time, visualizing Camelot-compatible vs. clashing transitions — was considered for the dashboard hero and deliberately **saved for Set Detail instead**. When this screen is designed, treat it as a candidate companion visualization to the energy arc: AC-1's key/Camelot mixing stats earning a timeline form, in line with the 2026-08-02 refinement's Camelot headline slot.

> **⚑ Design session — full screen designed (Arjun, 2026-08-03). Authoritative spec: `implementation-artifacts/3-7-set-detail.md`** (step-by-step design working doc; read it before creating/deving this story — it carries every layout/interaction/state decision + ASCII mockups). Summary of what was locked, extending/revising the ACs above:
>
> **Layout & scope.** Two-pane, **whole-page scroll** — no `100dvh` fixed shell, no nested scroll regions (a deliberate break from the dashboard's signature). Header: A identity + B scope (~20-25% left) beside C energy arc (~75-80% right); header scrolls away. Body: tracklist left (~67%, the spine) + **sticky** right stats column (~33%). Default scope = **detected dancefloor** (3.6's shipped v0 detector), recomputed client-side from `plays[]`; a **global** `[Dancefloor | Whole night]` switch flips *everything* (stats + arc domain) to one frame; the toggle **hides** when no dancefloor is detected (whole-set fallback). **No edit affordance in 3.7** — the draggable-pointer editor + manual-segment *persistence* are Story 5.3 (needs 5.1's `segments` table); 3.7's switch is view-only.
>
> **C arc.** Reuse the 3.6 thumbnail arc renderer as interim; **arc domain changes with scope** (dancefloor-only vs full-night, morph transition). Story 3.8 upgrades the *same component* to full annotated mode in place.
>
> **Stats (right column, all scope-reactive, all click→focus the tracklist).** Harmonic mixing is the **hero** (LED pips, UX-DR11). Plus BPM (range+median+sparkline); Genre (top 3 = `genre · % · #tracks`, hover = dashboard motion vocab); **Set shape = "Longest Play" / "Shortest Play"** (plain names); **"New tracks played · N of M · [Week|Month]"** (library date-added within 7/30d before set date — launch-honest, survives Epic 4 Decision B); Most-played **artist-primary with conditional replays** (per-set most tracks are singletons — show artists ×2+ only; a "Replayed: X ×2" line only if any track count>1).
>
> **F tracklist.** Rows: timeline rail (timestamp+node) · title/artist · right-aligned mono `BPM · played-length · Camelot key`; **`·new·` marker** on new-window tracks. **In-key connector (Q1):** marker on the connector between consecutive rows, same Camelot rule as the harmonic aggregate, **always visible but quiet** — smooth = soft cyan glow, clash = faint dashed break (**never red / no alarm colors**), no-key = plain. Impact node = **peak of the energy arc** (`★ PEAK`). Unknown-track FR-2 fallback. **Load more** (~50 initial), never infinite.
>
> **Drill-in (the "each stat gets a modal" pattern).** Clicking a stat opens a detail overlay **over the right column only** (~33%, blurred backdrop over the other stats), **stays open**, back-arrow top-left; picking a value **highlights-in-place / dims others** (never hides rows — would break the timeline + connectors) with a dismissable "Focused: X ✕" pill, **single-select** in 3.7. Overlays: Genre (full list + **genre⇄subgenre toggle**), BPM (client-computed **histogram**, click band→focus), Harmonic (**transition list** + "show clashes only"; Camelot wheel deferred to 3.8). One shared "focus these plays" mechanism underlies genre/harmonic/most-played select **and** 3.8's arc click-to-jump (Q4). Mobile: panes stack, overlay becomes a bottom sheet.
>
> **Delete (AC new).** `[⋯]` → calm **blurred-modal** confirm (no alarm/red), copy clarifies **Curfew ≠ Serato/library**; **hard delete, never recoverable** → requires a permanent **tombstone/suppress-id** on stable session identity so re-sync never resurrects it (carry into the sync story; 3.7 pre-sync just removes the row via the 3.6 seam).
>
> **Data / capture (agent + contract — the 3.6 "stats must be true" move again).** Additive contract change + one backfill of the 491 local sets: **capture real per-play played-duration** (`ended_at`/`played_ms`, Serato-computed, honors the "Played" flag — powers per-row length + Longest/Shortest) and **library date-added** (powers New-tracks-played). Principle: **`EnrichedPlay` is internal → make it comprehensive** (also read total-length, deck, Played flag while in the joiner); **`SyncPlay` is the frozen wire → keep it consumer-gated, additive-only**. Owed: 5-min verification that Serato 4+ `history_entry` carries duration + date-added columns; and a standalone **`serato-capture-completeness.md`** field-map artifact.
>
> **States.** Sparse set (toggle hidden; arc<2pts → chart-summary text; harmonic "not enough tracks"; modules self-hide) · whole-set fallback · unknown-track FR-2 + aggregate "N unanalyzed" disclosure · low-confidence = **quiet non-hiding note** near header.
>
> **⚑ Carry-back to Story 3.6 (dashboard).** Low-confidence / no-dancefloor sets (soundchecks) should be **excluded from the dashboard by default but VISIBLY** (Story 4.1's exclude-visibly principle — "N low-confidence sessions hidden · show them"), not silently. 3.6 currently *includes* the soundcheck fixture on the dashboard — this is a behavior change, not already-done.

### Story 3.8: Energy arc chart + chart summary

As a DJ,
I want the energy arc rendered as a line chart with an auto-generated plain-language caption,
So that I can feel the pulse of the room and still get the takeaway if the chart can't render or I can't see it.

**Acceptance Criteria:**

1. **Given** a set's BPM-vs-time series, **Then** the shared energy-arc chart renders (lavender 2px stroke, no fill, dashed baseline, hover/tap point annotation) with no zoom/pan in v1. *(FR-7, UX-DR6)*
2. **Given** every chart, **Then** a Chart Summary caption is generated (templated min/max/direction, e.g. "BPM ranged 122–128, climbing through the back half"). *(UX-DR7)*
3. **Given** a render failure, **Then** the Chart Summary is the fallback. *(UX-DR7, UX-DR19 chart-failed)*
4. **Given** a screen-reader user, **Then** the Chart Summary is the accessible text-equivalent **And** the UJ-1 "genre gap" climax is reachable without seeing the chart. *(UX-DR7, UX-DR21)*
5. **Given** a set that spans a DST transition or crosses timezones, **Then** the energy-arc timeline is monotonic — stored UTC + offset, with no repeated hour and no negative time deltas — so neither the chart nor its downstream segment detection (Story 5.2) is corrupted. *(Boundary's hole #2, party 2026-07-20)*

> **⚑ Refinement (Arjun, 2026-08-02).** The full annotated + captioned energy-arc chart is the **"full" mode of the one reusable arc renderer** built in Story 3.6 (whose dashboard card uses its "thumbnail" mode) — one component, two modes, not two implementations.
>
> **⚑ Design session (Arjun, 2026-08-04) — see `3-8-energy-arc.md` as the authoritative spec.** Headlines: chrome look stays (the "lavender/no fill" sketch above is outdated); dashed baseline = median BPM with identifying hover; no axes (start/end/dancefloor-edge mono ticks only); monotone curve, hand-rolled (NOT shadcn/Recharts — never fork the renderer); hover = track name only, click = nearest-point jump via 3.7's DR-2 (mobile tap jumps immediately); small ★ peak mark (peak = moving window of ~10% of active-scope duration, shared with the tracklist impact node); caption = visible quiet one-liner bottom-right, min–max + direction, scope-reactive, no peak time — same string is the aria equivalent and the render-failure fallback; **key timeline strip** (plays as Camelot-colored time segments under the arc, in-key/out-of-key seams) is IN; **Camelot-wheel graphic is CUT**; dashboard thumbnail untouched; 3.7's deferred no-BPM-dancefloor silent-fallback edge is fixed here.
>
> **⚑ Built as specced (dev session 2026-08-04, branch `story/3-8-energy-arc`, status: review).** All 19 D-# rulings implemented; D-15 verification concluded the wire's UTC-Z strings suffice (no contract touch); the D-4 edge is closed in `deferred-work.md`. The polish pass (D-19) runs before `done`.

### Story 3.9: Console voice, failure register, state/a11y/responsive pass

As a DJ,
I want consistent console-voice copy, calm failure messaging, and a full state/accessibility/responsive pass across the dashboard surfaces,
So that the product feels like the "After-Hours Archive" and never celebratory or alarmist.

**Acceptance Criteria:**

1. **Given** all copy, **Then** it uses the After-Hours Archive console voice ("Initialize Session," "Archive Insight," "Session: Syncing…") and calm/technical failure strings (sync-failed, drive-disconnected, format-drift-paused, login-failed, email-already-registered, chart-failed) with no exclamations. *(UX-DR18)*
2. **Given** the product, **Then** it contains no streak counters, celebratory badges, or "you're crushing it"; no core stat is gated behind an enrichment prompt; no celebratory micro-interactions fire on stat milestones. *(UX-DR18, UX-DR20 — SM-C2 non-negotiable)*
3. **Given** the dashboard surfaces, **Then** the specified state patterns render (cold dashboard, new-set, unknown track data, sync offline/queued, drive-not-connected, sync-failed/retrying, format-drift paused, chart-failed). *(UX-DR19)*
4. **Given** the site, **Then** WCAG 2.2 AA holds, scroll-driven motion is absent on logged-in surfaces, **And** layout is the fixed centered 1100px grid adapting fluidly to tablet/phone. *(UX-DR20, UX-DR21, UX-DR22)*

### Story 3.10: Profile/Settings screen

As a DJ,
I want a Profile/Settings screen reachable from the floating nav's avatar, where I manage my account and privacy,
So that there is one home for my identity and controls that later features plug into.

**Acceptance Criteria:**

1. **Given** any authenticated screen, **Then** the floating nav shows my Avatar (circular `rounded.full`, hairline border, image only) as the Profile/Settings trigger — no other interaction. *(UX-DR15, UX-DR2)*
2. **Given** I open Profile/Settings, **Then** it shows and lets me manage my account details — email, phone on file, and linked auth providers (email / Google / Apple / passkey). *(UX-DR17, FR-29)*
3. **Given** the screen, **Then** it provides the privacy section and is the designated host surface for the location opt-in toggle (Story 5.7) and the billing-management entry (Story 7.4), which those stories populate — the shell exists independently of them. *(UX-DR17)*
4. **Given** a settings change, **When** saved, **Then** the settings-saved inline confirm renders (no modal, calm console voice). *(UX-DR19 settings-saved, UX-DR18)*
5. **Given** the design system, **Then** the screen uses only Obsidian tokens **And** meets WCAG 2.2 AA. *(UX-DR1, UX-DR21)*

> **⚑ Decision needed — strength of the "phone on file" invariant; this story owns hard enforcement (from 2.3c review, 2026-07-28).** AR-10/FR-29 state *"every account has a phone number on file, regardless of signup path."* Story 2.3c enforces this only **at the doorway** — the first email-confirmation (`auth/confirm`) and every OAuth callback (`auth/callback`) redirect a phone-less DJ to `/phone-required`. Three paths still bypass it: plain password `signIn()`, passkey sign-in, and a DJ who **abandons `/phone-required`** and later returns. So today the invariant is really *"prompted once, best-effort,"* not *"guaranteed on file."* This screen is the natural enforcement home because AC-2 already manages phone-on-file as a first-class field. **Recommended ruling (default unless Arjun rules otherwise):** keep best-effort-at-the-doorway through Epic 2 (no real users yet, so the gap is harmless), and make *this* story guarantee the invariant by (a) treating phone as required and non-clearable in the settings form, and (b) adding one lightweight gate — a middleware check (or a `phone_on_file` JWT claim to avoid a per-request DB read) that redirects any authenticated DJ still missing a phone to `/phone-required`. **Alternative if Arjun wants it airtight sooner:** add that middleware gate now rather than deferring to this story. Either way, the "prompted-once" acceptance for `signIn()`/passkey must become a *conscious* decision here, not the accident it is today. Tracked in `deferred-work.md` (2.3c review, 2026-07-27, `web/app/login/actions.ts` residual entry).
>
> **⚑ RULED (Arjun, 2026-08-05): the gate ships in this story.** Phone becomes **locked/read-only** on this screen (no change without verification infra that doesn't exist), so Settings can't be where a phone-less DJ fixes it — middleware is the only remaining lever. Mechanism: **cookie-marked lazy check** (one `djs.phone` read per session, not per request; JWT-claim auth hook noted as the airtight upgrade). Full rationale + alternatives weighed in `3-10-settings.md` §4.

> **⚑ Design session — full screen designed (Arjun, 2026-08-05). Authoritative spec: `implementation-artifacts/3-10-settings.md`** (step-by-step design working doc with 19 D-# rulings, ASCII mockups, states table; read it before creating/deving this story). Summary of what was locked, extending the ACs above:
>
> **Shape.** Single centered column (~720px), **whole-page scroll** (same break from the dashboard's viewport lock that 3.7 made), flat console rows — label left, value right, hairline rules — **not** the dashboard's card/glass vocabulary. Sections in order: Profile header → Account → Agent → Privacy → Appearance → About → Sign out; Billing slots between Account and Privacy when 7.4 lands. Deliberately the quietest surface in the product: **no WebGL/shader material** (the orphaned `LiquidMetalButton` is explicitly *declined* a demo home here), motion budget = the Saved fade + confirm scrim.
>
> **⚑ Amended (Arjun, 2026-08-05 — on-theme redesign, recorded in the story file's addendum and `3-10-settings.md` D-2/D-17):** the flat-console *material* clauses above are superseded — Settings now stands on the app's shared ground (Silk WebGL backdrop, `dz-shell` glass section cards, Hanken voice, abyss text ramp), and the motion budget includes the redesign's card entrance/press transitions. Still the quietest surface in the product; the column/scroll/row-grammar/section-order clauses and the `LiquidMetalButton` decline stand unchanged.
>
> **Identity (extends AC-1/AC-2).** New **optional `dj_name`** field (≤40 chars, no uniqueness) that **wins over OAuth `full_name` in the dashboard greeting** — fixes email-path DJs being permanently nameless. Avatar = **provider photo with a monogram fallback**, not editable (no upload story yet); the **nav swaps `UserCircle` → the real avatar**, same `/settings` destination. **Email read-only**; **password = send-reset-link**; **phone locked** (masked, `verified · locked`); providers **see + link, never unlink** (last-identity lockout); **"Add a passkey" lives here** — which **discharges the 2026-07-30 ledger ruling** to extend the post-signin passkey nudge to OAuth (resolved by relocation, not dropped).
>
> **Agent section (new, beyond the ACs).** Status line reusing 3.9's resolver + agent version + a **Link agent** button — giving orphaned `/link-agent` its first nav path. **No device registry, no unlink**: linking is a `curfew-agent://` token handoff with no server-side device row, and the only real revocation (global refresh-token revoke) would sign the browser out too. Unlike 3.9's silence-first dashboard banner, **this row always speaks** — on a settings screen "no news" is indistinguishable from "broken."
>
> **Privacy (AC-3).** **Export-request link only**; **delete-account is CUT from MVP** (amends Story 2.11 AC-3, see the ⚑ there). Location renders a **coming-soon note, not a dead toggle** — 5.7 fills the real control.
>
> **Save model (AC-4).** **Autosave, no Save button** — ~600ms debounce + save on blur/Enter; **page-level** "Saved." on the heading baseline. Failure is inline, **never silently reverts** ("Change not saved — retry."), a new Failure Register entry owed back to `EXPERIENCE.md`.
>
> **Also new.** **Sign out** — the product's first (nothing calls `signOut` today), bottom of page, **with** a calm confirm dialog. **About section**: web version + build hash, agent version, support email — load-bearing because **Sentry is not actually provisioned** (agent has the wiring but no DSN; `web/` has no Sentry at all), so these strings are the only diagnostic a DJ can hand over.
>
> **Schema deltas.** `djs.dj_name` (grant stays **column-scoped** per AD-19, never blanket) · `agent_status.agent_version` + one `set_agent_status` param + one agent call site (AD-20 discipline preserved) · **no `shared/` contract touch** (AD-3). Owed pre-launch-checklist rows: the **`support@curfew.vip` inbox does not exist**, and the **Sentry project/DSN** is unprovisioned; **no privacy-policy or terms page exists anywhere** in the app.

## Epic 4: Style Evolution & Library Utilization

A DJ can see how their playing style trends over time and hold their library accountable — conversion rate, an aging shelf with a prep-crate action, and time-to-first-play. Reuses the shared trend-chart utility. Style Evolution excludes likely-rehearsal sessions via the FR-27 signal. *(UJ-5, UJ-6)*

> **⚑ Decision B — "played" = played-on-Curfew; copy is history-as-asset, never a receipt (Arjun, 2026-07-25; story ACs owed rework, tracked in sprint-status `action_items` ai-7). Reads with Decision A (go-forward only) above.** In every Epic 4 feature **"played" means "played in a session Curfew captured"** (go-forward), not lifetime history. A feature works honestly at launch **iff** it needs only *(library add-date + go-forward plays)*; a feature that needs *a play we never saw* must be reframed or gated. Triage: **4.2** (correlation) and **4.3** (conversion) survive with a "since joining" *frame* (not that literal phrase — see copy rule); **4.4 aging shelf** and **4.5 time-to-first-play** are **cold-start-broken as written** — "last play" / "first play" are go-forward-unknowable, so at launch a veteran's played catalogue falsely reads all-aging / first-play-garbage. Re-spec both (restrict to tracks added after subscribing, and/or gate until warm-up) before build. **Copy rule (binding):** never surface elapsed subscription time as *cost* (no *"since you joined,"* no *"in your N months"* — that's a self-installed churn button); always frame the record as **theirs** (*"your history / your evolution"*, Wrapped-style), and let the frame **earn out over time**. Full triage + rationale: `implementation-artifacts/epic-1-review-decisions-2026-07-25.md`.

### Story 4.1: Style Evolution trend view (excludes low-confidence)

As a DJ,
I want a month-over-month trend of my BPM range, genre diversity, and key usage that excludes likely-rehearsal sessions,
So that I can see how my style is actually evolving in real gigs.

**Acceptance Criteria:**

1. **Given** ≥1 month of synced sets, **Then** Style Evolution shows BPM range, genre diversity, and key-usage patterns month-over-month using the shared trend chart. *(FR-9, UX-DR6)*
2. **Given** the FR-27 confidence signal, **Then** sessions below the confidence threshold are excluded from the trend **by default but never silently** — the view shows "N low-confidence sessions hidden — show them?" and the DJ can reveal them; a real set is never erased from the DJ's own history without their knowledge. *(FR-27 — resolved 2026-07-20: exclude-**visibly**; PRD-sync owed. Rationale: Story 1.8 documents the signal as heuristic, not ground truth, so silent deletion isn't defensible.)*
3. **Given** <1 month of history, **Then** the insufficient-history state renders, positive-framed (not an error). *(UX-DR19)*
4. **Given** each chart, **Then** it ships a Chart Summary text-equivalent. *(UX-DR7, UX-DR21)*

### Story 4.2: Library-to-setlist correlation trend

As a DJ,
I want a trend line of whether my recently-added library tracks are making it into sets,
So that I know if my digging is translating to the dancefloor.

**Acceptance Criteria:**

1. **Given** library add-dates and play history, **Then** a trend line over time shows the share of recently-added tracks that appear in sets. *(FR-10)*
2. **Given** the chart, **Then** it reuses the shared trend-chart utility + Chart Summary. *(UX-DR6, UX-DR7)*
3. **Given** sparse data, **Then** the insufficient-history state applies. *(UX-DR19)*

### Story 4.3: Conversion-rate LED-pip meter

As a DJ,
I want my conversion rate — % of added tracks played ≥1 time over a rolling 90-day window — as an LED-pip meter,
So that I can gauge how much of my library I actually use.

**Acceptance Criteria:**

1. **Given** a rolling 90-day window, **Then** conversion rate = % of tracks added to the library in the last 90 days that have been played ≥1 time in a set is computed. *(FR-11 — window length confirmed 2026-07-21, Arjun)*
2. **Given** the display, **Then** it renders as filled/empty square "pips" (hardware-LED-meter style), not a bar or a bare percentage. *(UX-DR11)*
3. **Given** the metric, **Then** the 90-day rolling-window definition is shown so the number is interpretable.
4. **Given** a library track missing both `tadd` and `uadd` (~6% of tracks, per Architecture Spine Open Questions #2), **Then** it is excluded from the conversion-rate denominator and disclosed via a distinct "Unknown add-date" count — never silently folded into the computed percentage. *(Architecture Spine OQ#2 graceful-fallback requirement; SM-C1)*

### Story 4.4: Aging shelf with prep-crate action

As a DJ,
I want a list of library tracks unplayed for 3+ months, sortable by days-unplayed, each with an "add to prep crate" action,
So that neglected tracks resurface and I can act on them.

**Acceptance Criteria:**

1. **Given** library tracks unplayed 3+ months (from add date or last play), **Then** they list in the aging shelf, sortable by days-unplayed. *(FR-12, UX-DR12)*
2. **Given** a row, **Then** it carries an explicit "add to prep crate" action — the one place the product nudges toward action. *(UX-DR12)*
3. **Given** nothing is aging, **Then** the positive-framed empty state renders. *(UX-DR19 aging-shelf-empty)*
4. **Given** recently-downloaded-not-yet-played tracks (30-day threshold — *[ASSUMPTION], PRD-sync owed*), **Then** the recently-downloaded nudge state renders. *(UX-DR19)*
5. **Given** a library track missing both `tadd` and `uadd` with no play history to fall back on (~6% of tracks, per Architecture Spine Open Questions #2), **Then** it renders in a distinct "Unknown add-date" state on the aging shelf rather than being silently omitted or defaulted into a sort position. *(Architecture Spine OQ#2 graceful-fallback requirement; SM-C1)*

### Story 4.5: Time-to-first-play

As a DJ,
I want to see the elapsed time between adding a track and first playing it,
So that I understand how long tracks sit before they debut.

**Acceptance Criteria:**

1. **Given** a track added then first played, **Then** time-to-first-play = (first-play timestamp − add timestamp) is computed and displayed. *(FR-13)*
2. **Given** a track never played, **Then** it is represented distinctly (not counted as zero).
3. **Given** the metric across the library, **Then** an aggregate view (e.g. distribution/median) is shown.
4. **Given** a track missing both `tadd` and `uadd` (~6% of tracks, per Architecture Spine Open Questions #2), **Then** time-to-first-play renders as "Unknown" (per FR-2's Unknown convention) and is excluded from the aggregate view — never computed against a missing timestamp. *(Architecture Spine OQ#2 graceful-fallback requirement; SM-C1)*

### Story 4.6: Web read path — swap the committed fixture for Supabase

As a DJ,
I want the dashboard, Set Detail, and Style Evolution/Library Utilization pages to show my real synced data,
So that the sets and library adds the agent has been syncing since Epic 3 actually appear, instead of the same committed fixture every DJ sees.

> **⚑ Launch blocker, unstoried until now.** Flagged during Story 4.2 review (`deferred-work.md`): the agent write path has been live since Epic 3 (`sync_set` → `sessions`/`sets`/`plays`) and Story 4.2 added `sync_library_add_events` → `library_track_events`, but `web/lib/sets/index.ts` — the one seam every page reads through (Story 3.6 Task 4, AC-13/SM-1) — still serves `getRecentSets`, `getSetById`, `deleteSet`, and `getLibraryAddEvents` from the committed `recent-sets.fixture.json` / `library-add-events.fixture.json`, exactly as Decision A intended as the *day-one stand-in*. Only `getAgentStatus` (Story 3.9) reads Supabase for real. Without this story, production data accumulates that the product can never display. Ruled by Arjun 2026-08-07 to be sequenced here, before Epic 5, rather than left to accrete further against an epic it doesn't belong to.

**Acceptance Criteria:**

1. **Given** the data-access seam in `web/lib/sets/index.ts`, **Then** `getRecentSets`, `getSetById`, `deleteSet`, and `getLibraryAddEvents` read from Supabase (`sessions`/`sets`/`plays`/`library_track_events`, all owner-SELECT via RLS per AD-7) instead of the committed fixtures — no `dj_id` filter needed or wanted, `auth.uid()` is the filter, matching `getAgentStatus`'s existing precedent exactly. *(Decision A's swap point; AD-7)*
2. **Given** every component that currently imports from this seam (dashboard, Set Detail, Style Evolution — `library-utilization/page.tsx` is still a Story 3.5 stub and not yet a caller), **Then** none of them change — the seam's function signatures and return shapes are preserved so the swap is invisible above this file, per the seam's own founding contract ("only the function bodies below change"). *(Story 3.6 Task 4, AC-13/SM-1)*
3. **Given** a DJ with no synced sets or add-events yet (a brand-new account, or Epic 3/4's own dev/test accounts before the agent has run), **Then** each function returns the same empty/`null` shape the fixture stage returns today, rendering the existing insufficient-history / empty-dashboard states — never a thrown error. *(Mirrors `getLibraryAddEvents`'s existing "day one, every DJ is empty by construction" contract)*
4. **Given** a genuine Supabase read failure (missing env, broken RLS, network), **Then** it fails calmly and resiliently exactly like `getAgentStatus` does today — rendered identically to "nothing synced yet" in production, but logged loudly in non-production so a real regression cannot sit invisible indefinitely. *(Mirrors `getAgentStatus`'s existing resilience contract)*
5. **Given** `deleteSet`, **Then** it performs a real hard delete against Supabase (not the fixture stage's in-memory `store` mutation), scoped by RLS so a DJ can only ever delete their own row. *(AC-12's original "removal path" intent, now against the real store)*
6. **Given** the committed fixtures (`recent-sets.fixture.json`, `library-add-events.fixture.json`) and their generator scripts (`build-fixture.mjs`, `build-library-fixture.mjs`), **Then** a decision is made and recorded on whether they are retired, or kept solely as local-dev/test fixtures decoupled from the production seam — not left ambiguous about which one `web/lib/sets/index.ts` actually serves. *(Prevents the same "which one is real" ambiguity this story exists to close)*
7. **Given** the full test suite, **Then** existing seam-consuming component tests are updated to mock/stub the Supabase client rather than relying on fixture data being served automatically, and the seam itself gains coverage for the empty-state and failure-state paths (AC-3/AC-4). *(Standing gate discipline, ai-8)*

## Epic 5: Set Segments & Layer 2 Enrichment

A DJ can add meaning on top of an immutable as-played set — labeled time-range segments (algorithm-suggested, confirmed via drag or keyboard, or added manually), per-segment stat slices, and Layer 2 enrichment (venue / crowd / event / notes, with optional off-by-default location suggestion). All overlays are web-authored and cloud-only; nothing here is ever required for core dashboard stats. *(UJ-7, UJ-4-lite)*

### Story 5.1: Segments overlay schema

As a developer,
I want a cloud-only `segments` overlay table with a fixed type enum, disjoint from content columns,
So that segment overlays never touch agent-written content and stay web-authored.

**Acceptance Criteria:**

1. **Given** the schema, **Then** `segments` rows are overlay / cloud-only, web-authored, never written back to the agent. *(AR-8)*
2. **Given** segment `type`, **Then** it is the fixed enum {dancefloor, dinner, performance, custom}. *(AR-15)*
3. **Given** a segment, **Then** it references a set without altering that set's content columns. *(AR-8)*

### Story 5.2: Segment-detection algorithm

As a DJ,
I want the agent to suggest segment boundaries from my session's timing patterns, calibrated to my own history,
So that splitting a set into meaningful parts starts from a smart guess, not a blank slate.

**Acceptance Criteria:**

1. **Given** a session, **Then** it is bucketed into fixed time windows with per-window play density, median BPM, and consecutive-pair BPM-delta smoothness computed. *(AR-13)*
2. **Given** a dancefloor candidate, **Then** it qualifies only if density + BPM clear floors calibrated per-DJ from that DJ's own history (never a global constant); adjacent candidates merge; a segment confirms only if transition-smoothness clears its own floor. *(AR-13)*
3. **Given** long no-play stretches, **Then** they mark an idle/gap. *(AR-13)*
4. **Given** a session, **Then** it may yield zero, one, or several dancefloor segments — never assume exactly one. *(AR-13, FR-28)*
5. **Given** a session spanning a DST transition, **Then** consecutive-pair time deltas stay non-negative and monotonic (the timeline is UTC-based), so per-window density and BPM-delta-smoothness are not corrupted by a repeated hour. *(Boundary's hole #2, party 2026-07-20)*

> **⚑ Refinement (Arjun, 2026-08-02).** Story 3.6 ships a **basic global-heuristic dancefloor detector (v0)** client-side so launch stats aren't clouded by non-dancefloor tracks. This story **supersedes** that v0 with the AR-13 per-DJ-calibrated version (floors from the DJ's own history — "never a global constant"). The v0 was shipped knowingly as interim; when this lands, the client-side heuristic is retired in its favor.

### Story 5.3: Segment editor

As a DJ,
I want to confirm/adjust suggested boundaries by dragging or keyboard, or add my own,
So that segmenting a set is fast, precise, and accessible.

**Acceptance Criteria:**

1. **Given** suggested boundaries, **Then** they render as draggable dividers over the energy arc; a "+" adds a manual boundary. *(FR-14, FR-28, UX-DR9)*
2. **Given** keyboard-only use, **Then** Tab reaches a boundary, arrows nudge, Enter confirms — a full keyboard path. *(UX-DR9, UX-DR20, UX-DR21)*
3. **Given** confirm, **Then** it commits; segments remain editable anytime. *(UX-DR9)*
4. **Given** each segment, **Then** it is typed (dancefloor/dinner/performance) or custom-labeled. *(FR-14)*

> **⚑ Refinement (Arjun, 2026-08-02).** The editor renders as draggable pointers **over the tracklist** (Arjun's mental model — bracket the dancefloor by pointing at the first and last track that count), in addition to over the arc. This editor and Story 5.5's Layer-2 enrichment share **one Set Detail editing surface** (the tracklist), not two separate screens. Layer 2 should also accept **photos/"pics"** (extend 5.5's venue/crowd/notes).

### Story 5.4: Segment-scoped stats

As a DJ,
I want per-set stats sliceable by segment,
So that I can compare, say, the dinner hour to the peak dancefloor.

**Acceptance Criteria:**

1. **Given** a set with segments, **When** I select a segment, **Then** the FR-6/FR-7 stats recompute scoped to that segment via cloud SQL re-aggregation over `plays`. *(FR-15, AR-8)*
2. **Given** segment stats, **Then** they derive from synced content (cloud may re-aggregate), not from re-running the agent. *(AR-8)*
3. **Given** no segments, **Then** whole-set stats show as before — segments are additive, never required.

### Story 5.5: Layer 2 enrichment form

As a DJ,
I want to add venue, crowd size, event type, and notes to any synced set after the fact,
So that I can enrich the record without it ever blocking my core stats.

**Acceptance Criteria:**

1. **Given** a synced set, **Then** an inline, expandable Layer 2 form (venue, crowd size, event type, free-text notes) is available beneath stats — never modal, never blocking, always skippable. *(FR-16, UX-DR10)*
2. **Given** Layer 2 data, **Then** it is web-authored overlay, cloud-only, never required for core dashboard value. *(FR-16, AR-8)*
3. **Given** no enrichment, **Then** all core stats still render fully. *(FR-16, UX-DR20 — no gating)*

### Story 5.6: Enrichment-driven comparisons

As a DJ,
I want Layer 2 tags to unlock richer comparisons,
So that enriching sets pays off with insights I couldn't get otherwise.

**Acceptance Criteria:**

1. **Given** enriched sets, **Then** comparisons like BPM-in-club vs BPM-in-radio become available, keyed off Layer 2 tags. *(FR-17)*
2. **Given** un-enriched sets, **Then** the comparison simply omits them — enrichment is never required for core stats. *(FR-17)*
3. **Given** a comparison, **Then** it is framed descriptively, consistent with the product's non-competitive voice.

### Story 5.7: Opt-in location venue suggestion

As a DJ,
I want an optional, off-by-default location-based venue suggestion that I confirm or edit,
So that tagging a venue is faster without ever silently recording where I am.

**Acceptance Criteria:**

1. **Given** location suggestion, **Then** it is off by default (opt-in). *(FR-18, NFR-2)*
2. **Given** it is enabled, **When** a set completes, **Then** the agent captures approximate device location and the website reverse-geocodes it to a suggested venue name. *(FR-18)*
3. **Given** a suggestion, **Then** it appears as an editable pre-filled field I confirm or edit — never silently saved. *(FR-18, UX-DR10, UX-DR20)*
4. **Given** it is disabled, **Then** no location is captured. *(FR-18, NFR-2)*

## Epic 6: Marketing & Entry Surfaces

A prospective DJ can discover Curfew through a public Landing page, read a Features walkthrough and a single-tier Pricing page, and enter the signup/login flow (rendered as an overlay on Landing). Launch-facing; sequenced late since SM-1/SM-2 validate on the builder's own use before it exists.

### Story 6.1: Landing page

As a prospective DJ,
I want a marketing Landing page that hooks me with "compared to what?" and restrained scroll-driven motion,
So that I immediately grasp what Curfew offers.

**Acceptance Criteria:**

1. **Given** the Landing page, **Then** it presents the "compared to what?" hook with a scroll-driven motion hero used on the Landing only. *(UX-DR16)*
2. **Given** logged-in surfaces, **Then** they stay still — scroll motion never leaks past Landing. *(UX-DR16, UX-DR20)*
3. **Given** accessibility, **Then** reduced-motion is honored **And** AA contrast holds. *(UX-DR21)*

### Story 6.2: Features walkthrough

As a prospective DJ,
I want a Features page walking through what Curfew does,
So that I can evaluate it before signing up.

**Acceptance Criteria:**

1. **Given** the Features page, **Then** it walks through the core Phase-1 capabilities in the console voice. *(UX-DR16, UX-DR18)*
2. **Given** the design system, **Then** the page uses only Obsidian tokens.

### Story 6.3: Pricing page

As a prospective DJ,
I want a single-tier Pricing page,
So that I see the one plan without a confusing comparison grid.

**Acceptance Criteria:**

1. **Given** the Pricing page, **Then** it shows a single-tier Pricing Card ($6/mo) with a large `display-lg` price + mono "/month" unit and a primary-button CTA to Signup/Login. *(UX-DR14)*
2. **Given** the card, **Then** there is no comparison table, plan picker, ribbon, or discount badge. *(UX-DR14)*
3. **Given** the CTA, **When** clicked, **Then** it routes into the auth overlay (Story 6.4).

### Story 6.4: Login/Signup overlay on Landing

As a prospective DJ,
I want the login/signup flow to appear as an overlay on the Landing page,
So that entering never dumps me on a blank page.

**Acceptance Criteria:**

1. **Given** a login/signup CTA, **When** clicked, **Then** the auth flow renders as an overlay on Landing — never a separate blank page. *(UX-DR16)*
2. **Given** the overlay, **Then** it hosts the Epic 2 auth components/paths. *(UX-DR3, FR-29)*
3. **Given** dismissal, **When** the overlay closes, **Then** it returns to Landing intact.

## Epic 7: Subscription & Billing

A DJ subscribes ($6/mo, with a free trial) via Stripe Checkout, manages/cancels via the hosted Customer Portal, and the web experience is access-gated on subscription status while the **local agent keeps capturing sets regardless** — nothing is lost, and data resumes syncing on reactivation. Grounded in AD-18/AD-19 (Architecture Spine) + SOLUTION-DESIGN §3.7. Launch-gating but not required to validate SM-1/SM-2.

### Story 7.1: Billing columns + write-scoped `SECURITY DEFINER` function

As a developer,
I want four additive billing columns on `djs` plus a single `SECURITY DEFINER` function that is their only writer,
So that subscription state lives on the account with a database-enforced, minimal write surface.

**Acceptance Criteria:**

1. **Given** an additive migration, **Then** `djs` gains nullable `stripe_customer_id`, `stripe_subscription_id`, `subscription_status` (text, Stripe's verbatim status), and `current_period_end`. *(AD-19, AR-12)*
2. **Given** `subscription_status`, **Then** it is `text` (not a restrictive DB enum) **And** while `= 'trialing'`, `current_period_end` is the trial end (no separate trial column). *(AD-19)*
3. **Given** RLS, **Then** a DJ can read their own billing columns, but no RLS `UPDATE` policy ever grants a DJ write access to them. *(AD-19)*
4. **Given** `apply_subscription_event(...)`, **Then** it is a `SECURITY DEFINER` function that touches only these four columns and is the sole caller of the elevated key from billing code. *(AD-18)*

### Story 7.2: Stripe Checkout subscribe flow

As a DJ,
I want to subscribe ($6/mo, with a free trial) via Stripe's hosted Checkout from the pricing/entry flow,
So that I can pay without Curfew ever handling my card.

**Acceptance Criteria:**

1. **Given** an authenticated DJ, **When** they start checkout, **Then** the app creates a Stripe Checkout Session carrying `client_reference_id`/`metadata.dj_id` = that DJ's id and `trial_period_days` (default 14). *(AD-18)*
2. **Given** the session, **Then** the DJ is sent to Stripe's hosted Checkout page — no bespoke payment UI. *(AD-18)*
3. **Given** trial config, **Then** trial length is a Stripe business parameter, not hard-coded app logic. *(AD-18)*

### Story 7.3: Payment webhook route handler

As the system,
I want a signature-verified, idempotent Stripe webhook that writes subscription state via the scoped function,
So that subscription changes reach the account exactly once and can't be forged or corrupted by retries.

**Acceptance Criteria:**

1. **Given** the webhook, **Then** it is a Next.js Route Handler in the existing `web/` deployment pinned to the Node.js runtime (not Edge), authenticated via `stripe.webhooks.constructEvent` (raw body + signing secret), not a Supabase JWT. *(AD-18)*
2. **Given** an event, **Then** `dj_id` is read from the event's own `metadata`, never re-derived from an email/customer lookup. *(AD-18)*
3. **Given** at-least-once, unordered delivery, **Then** the handler dedupes on `event.id` **And** on a subscription-changed event re-fetches the canonical subscription object from the Stripe API rather than trusting the payload verbatim. *(AD-18)*
4. **Given** a write, **Then** it goes only through `apply_subscription_event(...)` — never a raw elevated-key `UPDATE`. *(AD-18)*

### Story 7.4: Customer Portal (manage/cancel)

As a DJ,
I want a self-serve Stripe Customer Portal to manage or cancel my subscription,
So that I control my billing without contacting support.

**Acceptance Criteria:**

1. **Given** an authenticated subscribed DJ, **When** they open billing management, **Then** a Stripe Customer Portal session is created and they are sent to the hosted portal. *(AD-18)*
2. **Given** a change/cancel in the portal, **Then** it arrives back via the Story 7.3 webhook and updates `subscription_status`. *(AD-18, AD-19)*
3. **Given** the product, **Then** no subscription-lifecycle UI is hand-built. *(AD-18)*

### Story 7.5: Web access-gate on subscription

As a DJ,
I want the web dashboard gated on my subscription while my agent keeps capturing sets regardless,
So that lapsing restricts the website but never loses my data.

**Acceptance Criteria:**

1. **Given** a web route serving dashboard/stats, **When** accessed, **Then** a route guard allows `active`/`trialing` and restricts otherwise. *(AD-19)*
2. **Given** the agent, **Then** its local capture (parse → local SQLite → sync-queue) and the idempotent `PUT /sets/:set_id` endpoint are never gated by `subscription_status` — billing state is invisible to the agent. *(AD-19 hard invariant)*
3. **Given** a lapsed subscriber, **Then** their agent keeps parsing and queuing sets locally with no data loss. *(AD-19)*
4. **Given** reactivation, **When** the next webhook flips status to active, **Then** already-synced sets appear immediately (no backfill needed). *(AD-19, §3.7)*
