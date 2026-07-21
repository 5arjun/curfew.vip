---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
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
- **AR-12 — Additive-only migrations + environments (AD-15)**: Schema changes ship as additive-only Supabase-CLI migration files committed in the monorepo. Dedicated Supabase **prod** project + **preview branches** for dev/PRs. A migration that drops/renames a live column or breaks the sync contract is forbidden.
- **AR-13 — Segment-detection algorithm (AD-17)**: Agent buckets a session into fixed time windows; per-window play density, median BPM, and consecutive-pair BPM-delta smoothness. Dancefloor candidate only if density + BPM clear floors **calibrated per-DJ from that DJ's own history** (never a global constant); adjacent candidates merge; a segment is confirmed only if transition-smoothness clears its own floor (confirming gate, not primary signal); long no-play stretches → idle/gap marker. A session yields **zero, one, or several** dancefloor segments — never assume exactly one.
- **AR-14 — Signed builds & release pipeline (Stack / Deployment)**: Code-signing is a fixed-cost ship gate — Apple Developer ID + notarization (macOS) and a Windows OV/EV cert. Signed Tauri auto-updater uses a separate mandatory update-signing keypair. `tauri-action` (GitHub Actions) produces cross-platform signed builds + auto-generated updater JSON/`.sig`; certs + updater key are encrypted CI secrets.
- **AR-15 — Core entity model (Structural Seed)**: Entities `djs`, `sessions`, `sets`, `plays`, `segments`, `follows` (plural, snake_case). Session is the immutable anchor; `sets` carries a denormalized `derived` (jsonb) render-cache; `plays` carry `in_library`, raw + normalized genre, `taxonomy_version`. Enums fixed in `shared/`: `visibility` ∈ {public, friends_only, private}; segment `type` ∈ {dancefloor, dinner, performance, custom}; `source` = serato.
- **AR-16 — No named starter template**: Architecture specifies no external greenfield boilerplate. Epic 1 Story 1 is a from-scratch monorepo scaffold (Tauri 2 agent + Next.js 16 web + shared contract package), not adoption of a named starter.

### UX Design Requirements

*Extracted from DESIGN.md (visual identity + components) and EXPERIENCE.md (IA, states, interactions, a11y). EXPERIENCE.md scope is Phase 1 only; Phase 2 social surfaces (feed, profile, comparisons) are not yet UX-specced.*

**Design system & foundations**

- **UX-DR1 — "Obsidian" design-token system**: Implement the dark M3-tonal-named token set — background `#121415` (deep charcoal, never true black/white), five surface-container elevation tiers, Electric Lavender primary (`#cbbeff` / container `#9d85ff`, used scarcely), desaturated dusty-rose error family. Typography scale: Hanken Grotesk (headlines), Inter (body), Geist mono (`mono-data`/`label-sm` for timestamps, BPM, session IDs, stat codes). 4px spacing baseline; soft-industrial radius where `rounded.full` (9999px) is reserved **exclusively** for floating nav, avatar, status dots.

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
- **UX-DR19 — State patterns (17)**: Implement each specified state — cold dashboard (no sets), new-set-detected banner, unknown track data, sync offline/queued (+ tray glyph), drive-not-connected, first-run path confirmation, aging-shelf empty (positive-framed), insufficient history (<1 month), settings-saved inline confirm, auth-failed inline, phone-required post-OAuth (one-field), recently-downloaded-not-yet-played nudge (30-day threshold — *[ASSUMPTION], PRD-sync owed*), sync-failed/retrying, format-drift paused, chart-failed-to-render fallback.
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

### Epic 1: Foundation & Proven Parsing

Stand up the monorepo (`agent/` · `web/` · `shared/`) and the `shared/` versioned sync contract, then build and **prove** the local parsing + stat engine against real multi-track Serato sessions — clean-room `.session` parser, library join (both legacy `database V2` and Serato 4+ `master.sqlite`), off-library embedded-tag fallback with visible "Unknown," edge genre normalization (raw + normalized + `taxonomy_version`), and the core per-set stat math — all golden-file tested offline, closing the **SM-1** parsing-correctness gate before any cloud or code-signing spend. This is the risk-boundary-first foundation everything else builds on; its outcome is concretely demonstrable (point the engine at a real Serato folder → accurate normalized per-set stats).
**FRs covered:** FR-2, FR-8, FR-27 *(signal only; prompt dormant until Phase 2)* — plus the stat-computation foundation for FR-6/FR-7. **ARs:** AR-1, AR-5, AR-6, AR-15, AR-16. **NFRs:** NFR-1, NFR-5.
*Design notes:* (a) the epic **leads with a parser-validation spike** against real sessions before the full pipeline is committed — the algorithm is validated, the clean-room Rust implementation is not; **scope the spike to the riskiest real session types** (multi-track wedding, USB-hosted library, WAV-heavy library); (b) the `shared/` derived-payload/stat-output shape is designed against the **Set Detail + Style Evolution UX** (its frozen, additive-only consumer), not blind; (c) **freeze the `shared/` contract only *after* the spike** — freezing it before parsing reality is known risks additive-only "contract debt" that ripples to E2–E5.

### Epic 2: Account & Agent Onboarding

A DJ creates one Curfew account via any of four paths (email+password, Google, Apple, passkey — auto-linked by verified email, phone number on file), downloads and installs the signed local agent, and the agent auto-detects and asks them to confirm their Serato data folder (including on a USB drive), then quietly watches and captures completed sets into local SQLite using the Epic 1 engine. Establishes the cloud foundation (Supabase + null-safe RLS + additive-only migrations + prod/preview environments), the signed-build/auto-updater pipeline, and the agent's tray UI. *(UJ-3)*
**FRs covered:** FR-1, FR-3, FR-5, FR-29. **ARs:** AR-3, AR-4, AR-10, AR-11, AR-12, AR-14. **UX:** UX-DR1 (Obsidian token system — established here as the first web surface, so auth screens aren't styled against tokens that don't exist yet), UX-DR3 (auth components), UX-DR23 (tray UI), UX-DR19 (first-run path confirm + phone-required states).
*Design notes:* (a) **code-signing (`SIGN`) blocks release/distribution, not local development** — the agent self-tests unsigned; only shipping an installer to a real DJ needs the certs, so parallel procurement (see cross-cutting notes) keeps it off the critical coding path; **fallback: macOS-first launch** if the Windows EV cert's identity verification drags; (b) the `djs` account schema should **anticipate a `subscription_status` concept** even though Epic 7 implements the billing flow — the E7 access-gate is cross-cutting (additive column later is possible, but knowing it's coming shapes the account model).

### Epic 3: Post-Set Sync & Personal Dashboard  ⭐ core value moment

The completed set syncs automatically to the cloud (idempotent `PUT` on a deterministic `set_id`, offline-queued and drained on reconnect, content-column-scoped so overlays are never clobbered), and appears on the DJ's web dashboard the next morning — where they open it and see the per-set summary (top tracks/artists, genre breakdown, BPM distribution, Camelot mixing, length, track count) and the energy arc. Establishes the Obsidian web token system and the signature floating nav as the first authenticated surfaces, plus format-drift resilience and backfill. This is the product's core morning-after reflection moment. *(UJ-1)*
**FRs covered:** FR-4, FR-6, FR-7. **ARs:** AR-2, AR-7, AR-8, AR-9 *(create the `visibility` column + private-equivalent default now — additive-only Phase-2 groundwork, so Phase-2 read-policies never retroactively expose Phase-1 sets)*. **NFRs:** NFR-4. *Design note:* the sync seam is the system's single load-bearing integration — **`shared/` contract tests for idempotency (deterministic `set_id`, no backfill dupes, shared-USB non-collision) and content/overlay column-disjointness are first-class acceptance criteria**, not afterthoughts. **UX:** *(builds on the token system from Epic 2)* UX-DR2 (floating nav — first authenticated surface), UX-DR4 (set card), UX-DR5 (new-set nudge), UX-DR6 (energy-arc chart), UX-DR7 (chart summary), UX-DR8 (tracklist), UX-DR13 (chips), UX-DR17 (dashboard + set detail), UX-DR18 (voice/failure register), UX-DR19–22 (states, primitives, a11y, responsive).

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

A DJ can subscribe to Curfew ($6/mo) from the Pricing/entry flow via a payment provider (e.g. Stripe Checkout), manage or cancel through a provider-hosted customer portal, and the product gates the authenticated experience on subscription status — a lapsed/inactive subscription restricts the web experience while the **local agent keeps capturing sets locally** (nothing is lost; data resumes syncing on reactivation). Subscription state lives on the `djs` account as **additive columns** (AR-12); the payment webhook is handled by a Next.js route handler / Supabase Edge Function — the one sanctioned exception to AD-8's "no bespoke write path," scoped to billing events only. Launch-gating: **must ship before public paid launch, but is not required to validate SM-1/SM-2** on the builder's own use.
**FRs covered:** — *(no numbered FR; realizes PRD §7 monetization + the UX-DR14 pricing CTA)*. **Consideration:** a free-trial window so SM-2 can be observed before the paywall. **🔒 Hard invariant:** the subscription gate restricts the **web experience only — never the local agent's capture**; a lapsed subscriber keeps parsing sets into local SQLite, and they resume syncing on reactivation, so the "nothing is lost" promise holds. **⚠️ Architecture gap:** payment provider + webhook pattern is outside the spine's FR-1..29 scope — resolve via a brief architecture addendum before this epic's story creation.
