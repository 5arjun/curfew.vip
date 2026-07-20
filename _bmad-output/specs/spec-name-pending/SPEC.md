---
id: SPEC-name-pending
companions:
  # Adopted (upstream-owned; downstream MUST read for the full contract). Spec-authored vs adopted is implicit by path.
  - ../../planning-artifacts/prds/prd-name-pending-2026-07-19/prd.md
  - ../../planning-artifacts/prds/prd-name-pending-2026-07-19/addendum.md
  - ../../planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md
  - ../../planning-artifacts/architecture/architecture-name-pending-2026-07-20/SOLUTION-DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-name-pending-2026-07-19/EXPERIENCE.md
  - ../../planning-artifacts/ux-designs/ux-name-pending-2026-07-19/DESIGN.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. The kernel below fixes the WHY, the capability set (with stable `CAP-N` IDs mapped to PRD `FR-N`), the load-bearing constraints, the non-goals, and the success gate. The companions hold the detail the kernel cites: `prd.md`/`addendum.md` for per-FR product detail and parser/field-coverage facts, `ARCHITECTURE-SPINE.md` (AD-1…AD-17 + diagrams) and `SOLUTION-DESIGN.md` for architecture invariants and walkthrough, `EXPERIENCE.md`/`DESIGN.md` for UX behavior and visual system.

# Curfew

## Why

**A vision to realize, backed by an opportunity nobody has claimed.** Working, gigging DJs have no mirror on their own craft the morning after a set: Serato records everything but only self-reviews as a raw history list, Songstats does industry analytics not personal reflection, and DJ.Studio does prep-time library stats not post-set reflection. Curfew is the missing combination — a Serato-linked platform where a background agent auto-parses each gig with zero in-the-moment input, and every stat is framed against the DJ's *own* baseline ("compared to what?", never "you were great"). The opportunity is real but the demand signal is uneven: a small WTP survey found personal reflection appetite "real but mild" against an already-free incumbent (Serato's own history) and the social layer testing weak. So the product ships in two phases — **Phase 1** is the personal reflection layer standing entirely on its own; **Phase 2** adds the peer-driven social layer, gated on Phase 1 proving out, not a calendar date. Personal value has to earn its own adoption before the network effect is asked to carry the product. If it works, Curfew becomes what a working DJ checks the morning after a gig, the way a runner checks Strava.

## Capabilities

Each capability cites the PRD `FR-N` it covers and its architectural governance (`AD-N` in `ARCHITECTURE-SPINE.md`). Phase tags follow PRD §9; Phase 2 is gated on the Phase 1 success signal below.

- **CAP-1 — Background set detection & auto-sync** *(Phase 1 · FR-1, FR-4 · AD-1, AD-4, AD-13, AD-16, AD-17)*
  - **intent:** The local agent auto-discovers the Serato data directory (including on USB/removable volumes), detects a completed session with no DJ action, and syncs the derived result to the backend.
  - **success:** A real gig session played after setup appears on the dashboard by the next morning with zero in-the-moment action; re-running sync never duplicates a set; a set completed offline queues locally and syncs on reconnect.

- **CAP-2 — Track-level enrichment via library join** *(Phase 1 · FR-2 · AD-11)*
  - **intent:** For each played track, resolve BPM/key/genre from the Serato library DB (handling both legacy `database V2` and Serato 4+ `master.sqlite`), falling back to embedded file tags for off-library tracks, then to a visible "Unknown".
  - **success:** In-library tracks show DB metadata; off-library tracks show embedded-tag metadata; a track with neither displays "Unknown" — never guessed, never silently dropped.

- **CAP-3 — Agent tray presence** *(Phase 1 · FR-5 · AD-11)*
  - **intent:** The agent's only UI is a menu-bar/system-tray icon plus one minimal settings panel exposing the Serato path override.
  - **success:** The icon reflects idle / syncing / failed / drive-not-connected; the settings panel exposes only the path override; no other agent UI surface exists (dashboard/stats/social all live on the website).

- **CAP-4 — Session classification-confidence signal** *(Phase 1 compute, Phase 2 gate · FR-27 · AD-17)*
  - **intent:** Compute a live-vs-practice confidence signal per session from Phase 1 onward; its one-tap confirmation prompt stays dormant until Phase 2, when a low-confidence session must be confirmed before becoming visible to others.
  - **success:** In Phase 1 the signal is computed and stored but no confirmation prompt fires (every session is dashboard-only); in Phase 2 a low-confidence session triggers exactly one "was this a real set?" prompt before it can reach feed/comparisons, while high-confidence and obviously-not-a-set sessions never prompt.

- **CAP-5 — Personal dashboard: per-set summary, energy arc, genre normalization** *(Phase 1 · FR-6, FR-7, FR-8 · AD-1, AD-12)*
  - **intent:** For any synced set, show most-played tracks/artists, genre breakdown, BPM distribution, key/Camelot mixing stats, length and track count; render BPM-vs-time as an energy arc; normalize raw Serato genre tags via a fixed Curfew-maintained table before display.
  - **success:** Any synced set renders its summary and energy arc; fragmented raw genre strings (e.g. "Hip-Hop / R&B" vs "Hip Hop") collapse into single normalized buckets in the chart. The "most played artists" ranking includes only artist-tagged plays — no "Unknown" bucket in the ranking, no untagged footnote on it; the ~11% no-artist plays still count in track count, BPM distribution, energy arc and length, and still render as "Unknown" in the tracklist (AD-11), so Unknown-honesty (SM-C1) lives in the tracklist rather than the leaderboard.

- **CAP-6 — Style Evolution trend view** *(Phase 1 · FR-9, FR-10 · AD-1, AD-12)*
  - **intent:** Show how a DJ's BPM range, genre diversity, and key-usage shift month-over-month, plus whether recently-added library tracks are actually reaching sets.
  - **success:** A DJ with at least a month of synced sets sees month-over-month trend lines, including a library-to-setlist correlation line; below that history the view shows an honest "not enough yet" state rather than a thin/misleading chart.

- **CAP-7 — Library Utilization** *(Phase 1 · FR-11, FR-12, FR-13 · AD-1)*
  - **intent:** Surface whether library spending translates into playing: conversion rate over a rolling window, an aging shelf (unplayed 3+ months), and time-to-first-play — all derived, no manual input.
  - **success:** A DJ sees the % of their library ever played, a list of 3+-month-unplayed tracks sortable by days-unplayed with a row-level "add to prep crate" action, and elapsed add-to-first-play time.

- **CAP-8 — Set Segments** *(Phase 1 · FR-14, FR-15, FR-28 · AD-6, AD-16, AD-17)*
  - **intent:** Let a DJ split one continuous session into labeled time-range segments; the agent suggests boundaries from play density, DJ-relative BPM floors, and transition-smoothness; per-set stats can be sliced by segment.
  - **success:** A multi-context session surfaces suggested boundaries the DJ confirms or edits (manual marking always available as fallback); per-set stats filter by segment; the suggester correctly yields zero, one, or several dancefloor segments — never a forced fixed shape.

- **CAP-9 — Layer 2 Enrichment** *(Phase 1 · FR-16, FR-17, FR-18 · AD-6, AD-16)*
  - **intent:** Let a DJ add optional venue / crowd size / event type / notes to any set from the website after the fact, unlocking richer comparisons, with an opt-in (off by default) location-based venue suggestion.
  - **success:** The core dashboard delivers full value with zero enrichment; added tags enable comparisons like club-vs-radio BPM; the location suggestion appears only after explicit opt-in and is always confirm-or-edit, never silently auto-filled.

- **CAP-10 — Account & multi-provider authentication** *(Phase 1 · FR-29 · AD-10)*
  - **intent:** Let a DJ sign up or log in via email+password, Google, Apple, or passkey, all linked to one account by verified email, with a phone number required on file.
  - **success:** Mixing methods under the same verified email lands in one account with no duplicate; a Google/Apple signup is prompted for a phone number before the account is usable.

- **CAP-11 — Social feed: follow, feed, profile, comments** *(Phase 2 · FR-19, FR-20, FR-21, FR-26 · AD-14, AD-15)*
  - **intent:** Let DJs follow each other, see followed DJs' sets in a feed of energy-arc thumbnails, view profiles showing recent sets and chosen aggregate stats, and comment on a set.
  - **success:** A followed DJ's new set appears in the follower's feed as an energy-arc thumbnail opening the full set on click; comments are readable and addable by anyone who can see the set, and absent on a private set beyond its owner.

- **CAP-12 — Per-track hide & set visibility tiers** *(Phase 2 · FR-22, FR-23 · AD-7, AD-9)*
  - **intent:** Let a DJ hide individual tracks (rendered as a redacted placeholder, never omitted) and set each set to public / friends-only / private, defaulting to public on sync — but only for sets synced after the DJ joins the social layer.
  - **success:** A hidden track shows as a visible redaction with no leak via track count or omission; a one-toggle private set never reaches feed or profile; Phase 1 sets are stored private-equivalent and are never retroactively exposed when Phase 2 read-policies ship.

- **CAP-13 — Community comparisons: network + circle** *(Phase 2 · FR-24, FR-25 · AD-1 scene-aggregate exception, AD-7)*
  - **intent:** Offer descriptive (never "winner"/ranking) aggregate comparisons both network-wide and scoped to a DJ's own circle, built from aggregate stats, never raw tracklists.
  - **success:** A DJ sees the same comparison metric both network-wide and scoped to who they follow, framed descriptively, computed by cloud SQL over shared sets only (never from any DJ's raw tracklist).

- **CAP-14 — Format-drift resilience** *(Phase 1 · FR-1 feature NFR, §5.4 · AD-13)*
  - **intent:** Keep a Serato format change from silently corrupting synced data, via golden-file CI tests, agent-side error reporting tagged with `agent_version`, a signed auto-updater, and backfill from retained local raw data after a fix.
  - **success:** A format change is caught by CI pre-release or by tagged in-the-wild error reports post-release; a signed update ships the parser fix; affected sets are re-parsed from retained local raw data and backfilled without duplication (deterministic `set_id`) or overlay loss (content-only upsert).

## Constraints

- **Raw-data boundary.** Raw `.session` files and the raw library DB never leave the DJ's machine; only derived/normalized JSON syncs, over HTTPS. Agent filesystem access is capability-scoped to the configured Serato path only. *(FR-3, AD-2, §5.2)*
- **Edge computes, cloud stores.** The edge owns all derivation from raw Serato data; the cloud never parses Serato binary or re-derives base metadata (it may run SQL over already-synced clean rows — segment slices, scene aggregates, genre re-normalization). No paid AI/ML anywhere — every stat is arithmetic over parsed metadata, keeping marginal per-DJ cost near zero. *(AD-1, §5.3)*
- **Isolation is below the app.** Per-DJ isolation is a null-safe RLS policy (`auth.uid() IS NOT NULL AND auth.uid() = dj_id`), never application-layer filtering; all cloud mutation goes through Supabase/PostgREST+RLS; the agent's only write is the idempotent set sync. *(AD-7, AD-8)*
- **Deterministic, idempotent sync.** Sync is an idempotent `PUT` on `set_id = hash(dj_id, session_identity)` — namespaced by `dj_id` (shared-USB DJs can't collide), never a fresh UUID (would duplicate on backfill). The session is the immutable anchor; set boundaries, once synced, are stable in the cloud. *(AD-4, AD-16)*
- **Content flows one way; overlays are cloud-only.** Set content flows agent→cloud only; user overlays (enrichment, segments, per-track hide, visibility tier) are web-authored, cloud-only, and never written back to the agent; the agent upsert is column-scoped to content and never touches an overlay column. No bidirectional sync. *(AD-6, AD-16)*
- **Phase 1 → Phase 2 is additive, never a rewrite.** Phase 2 adds fields, RLS read-policies, and Realtime subscriptions; it never restructures existing tables or the sync contract. Sync-contract evolution is additive-only and the cloud accepts the last N `agent_version`s. Enforced by additive-only Supabase-CLI migrations in the monorepo. *(AD-15, AD-3)*
- **"Unknown" is honest, never hidden.** Missing metadata renders as a visible "Unknown" carrying the `in_library` flag — never guessed, never silently omitted — and the "Unknown" rate is never suppressed to make coverage look better. *(AD-11, SM-C1)*
- **Reflection, not coaching or gamification.** Framing stays descriptive/comparative to the DJ's own baseline, never coach-graded; no streak counters, gamified-habit visuals, or celebratory milestone animations; copy favors community over status (no "best"/"winner"/ranking language). *(§6.2, SM-C2)*
- **Platform boundary.** Serato only (no Rekordbox in V1). The agent is Tauri 2/Rust on macOS + Windows desktop; the DJ-facing experience is a responsive website (desktop/laptop-first), with no native mobile app. *(§6.3, AD-11)*
- **US-only at launch.** A CCPA-level posture is sufficient at v1; GDPR-equivalent review is deferred until international expansion. The formal CCPA-compliance review remains a pre-launch checklist item. *(arch OQ#6)*
- **Single subscription tier, $6/month.** A locked PM decision made deliberately against the WTP survey's one-time-payment preference; pricing surfaces show one plan with nothing to compare. *(§7)*
- **Accessibility floor.** WCAG 2.2 AA across the website; every chart ships a plain-language text-equivalent so the core value moment is reachable without seeing the chart; every drag interaction has a keyboard path. *(EXPERIENCE Accessibility Floor)*

## Non-goals

- Rekordbox support (Serato only in V1; considered for v2).
- Mobile companion app (desktop agent + responsive web only).
- Skill coaching / transition-quality grading — against product identity, not merely deferred.
- In-the-moment / mid-set tagging — breaks the effortless, after-the-fact principle.
- Paid AI/ML API features — not needed for any locked-in stat.
- Labels/artists as users; DJ company/roster B2B tooling.
- Reliably distinguishing a live gig from a realistic home rehearsal by data alone — unsolved by anyone in this space; V1 mitigates with confidence-gated confirmation, it does not claim to solve it.
- Fully automatic flow-aware segmentation (auto-labeling "dinner" vs "dancefloor" without DJ confirmation) — the system suggests, the DJ confirms.
- Local audio DSP / waveform key-finding for tracks with no library or tag data.
- A server-side re-derivation path beside the edge one (forbidden by the edge-computes constraint).
- International launch / GDPR scope at v1 (US-only launch).

## Success signal

The Phase 1 validation gate — which is *also* the literal gate to Phase 2 — is two signals, both of which must hold: **(SM-1)** Curfew reliably parses a real, multi-track Serato gig session (not just the single-track sample) and produces accurate per-set stats; and **(SM-2)** a DJ using only the personal dashboard finds it worth opening after every gig, clearing the already-free Serato-history incumbent rather than merely registering non-zero interest. The parsing-correctness core of SM-1 (set-boundary / dancefloor-segment detection) was validated on 2026-07-20 against a real 474-session corpus (see AD-17). The world-change moment: Curfew becomes the thing a working DJ opens the morning after a gig, the way a runner checks Strava — and that pull is genuine reflection value, not manufactured by streaks, notifications, or inflated feed activity (counter-metrics SM-C1–SM-C4).

## Assumptions

- **CAP-14** promotes format-drift resilience from a cross-cutting PRD NFR to a first-class capability; it is load-bearing enough (golden-file tests, `agent_version` error reporting, signed updater, backfill under AD-13) to carry its own CAP ID and success criterion, rather than being buried in another capability's NFRs.
- No numeric targets are set for any success metric (SM-1…SM-4); carried from the brief, to be filled in once real usage data exists.
- `EXPERIENCE.md`/`DESIGN.md` cover Phase 1 surfaces only; the Phase 2 capabilities (CAP-11–CAP-13) have architecture governance but no UX design yet — Phase 2 UX is a later pass.
- Genre coverage is permanently partial (~80% in the sampled library) and no coverage guard rides the diversity trend (CAP-6/CAP-13): the file-type-correlated gap (WAV/AIFF at 0%) is accepted as immaterial for v1 since WAV is uncommon among DJs, so a diversity trend can move partly on coverage rather than playing — an accepted risk, not a guarded one.
- Filename-parse metadata recovery (recovering artist/genre from the 100%-coverage file path before declaring "Unknown") is deferred as a named future lever, not v1.

## Open Questions

- **WAV off-library embedded tags (CAP-2).** WAV embedded-tag readability is unconfirmed and the one real off-library sample was a `.wav` with 0% genre coverage — FR-2's fallback may hit "Unknown" disproportionately for WAV. Needs a WAV test file at parser-implementation time. *(arch OQ#3)*
- **Reverse-geocoding provider (CAP-9).** Provider for venue auto-suggest (Google Places / Apple Maps / OSM Nominatim) unchosen — cost/accuracy/attribution tradeoff deferred to implementation, or defer the feature (it is opt-in, off by default). *(arch OQ#5)*
- **Phase 2 demand & culture (CAP-11, CAP-12).** Per-track hide and "follow" tested weakest in the WTP survey (n=10, pro-skewed, low confidence); worth re-testing with a larger sample before Phase 2 engineering. Separately, whether per-track-hide redaction actually drives engagement or just reads as frustrating to viewers is an unvalidated design bet. *(PRD OQ#5, OQ#6)*
- **Paying-persona risk (product, non-blocking).** The primary paying persona (club DJs) has a JTBD largely about the scene/community layer, which Phase 1 doesn't deliver; SM-2 is where "does personal reflection alone hold this persona" gets tested, and the paying-core-vs-free-funnel split is not yet reconciled with the locked $6/mo price. A risk to watch, not a blocker for epics/stories. *(PRD OQ#11)*
