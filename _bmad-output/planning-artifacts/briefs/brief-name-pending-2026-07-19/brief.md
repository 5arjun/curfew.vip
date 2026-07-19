---
title: "Curfew — Product Brief"
status: draft
created: 2026-07-19
updated: 2026-07-19
---

# Product Brief: Curfew

## Executive Summary

Curfew is a Serato-first desktop app that turns a DJ's own play history into a personal reflection dashboard and a privacy-first social feed for their scene. Every gig generates rich session data — track order, BPM, key, timestamps — that today dies inside Serato's files and is never looked at again. Curfew reads that history automatically after the set is over, requires no in-the-moment input, and turns it into a per-set dashboard where every stat is framed against the DJ's own baseline: not "you were great," but "compared to what?"

Curfew is DJ-first, not social-first. Its core identity is a mirror — a way for a DJ to see their own trajectory (widening BPM range, growing genre count, whether the music they're buying is actually making it into their sets) without ever grading their beat-matching or transition quality. Social is a layer on top: DJs in the same scene follow each other, see each other's sets as energy-arc thumbnails, and can peek at tracklists with individual tracks redacted — a single "per-track hide" mechanic that serves both the DJ protecting a track ID and the DJ who just wants to keep one collaborator's track private. The redaction is what makes the visible tracks feel like something worth sharing.

V1 targets a single saturated DJ scene — one city, a tight club rotation — so the social feed feels alive from day one rather than launching into an empty room, then expands scene by scene. [ASSUMPTION: Arjun has not yet named the target launch city/scene — flag as open pre-launch decision.]

## The Problem

Every time a DJ plays, Serato silently logs everything: what was played, in what order, at what BPM and key, exactly when. That data is locked inside proprietary, undocumented file formats and never surfaces again once the set ends. Three specific gaps exist today:

- **No reflection.** A DJ has no easy way to see how their own playing style and library use have evolved — whether they're taking more risks, whether their sets are converging on the same "safe" tracks, whether the crates they've been digging in are actually making it into rotation.
- **No library accountability.** DJs buy and download far more music than they ever play out. There's no visibility into what's aging unplayed on the shelf, or how long it takes a newly-added track to get its first spin.
- **No low-friction way to share with peers.** DJs who want to compare notes or show off a set to scene friends either manually build and publish a tracklist (high friction, all-or-nothing) or say nothing at all. Existing tools solve fragments of this — Serato Playlists lets you upload a history but has no reflection layer or privacy controls; Songstats does track-level industry analytics for artists/labels, not personal reflection; DJ.Studio does prep-time library stats, not post-set reflection. Nothing combines automatic parsing, personal reflection, and scene-level privacy-aware sharing in one place.

DJ culture adds a real constraint on top of this: many DJs treat their track selections as competitive IP and are protective of revealing exact tracklists, while others are fully open. A tool that assumes either extreme alienates half its potential users.

## The Solution

Curfew is a desktop app (Tauri/Rust) that parses a DJ's local Serato library and session history after a gig and turns it into two layers of value:

**Personal Dashboard (Layer 1 — automatic, zero-effort, works for every DJ):**
- Per-set stats: most played tracks/artists, genre breakdown, BPM distribution, key/harmonic (Camelot wheel) mixing stats, set length and track count
- The energy arc — a visual "pulse of the room" built from BPM over time within a set
- Style evolution over time — how genre/BPM/key tendencies shift month to month
- Library utilization: conversion rate (% of newly-added tracks played), aging shelf (unplayed tracks 3+ months old), time-to-first-play

**Optional Enrichment (Layer 2 — after-the-fact, opt-in):**
- Venue, date, crowd size, event type tags per set; free-text notes
- These unlock richer comparisons (e.g., "how does my BPM differ between club sets and radio sets?") but are never required — the app works fully on file data alone

**Social Layer (ships with V1):**
- Follow other DJs in your scene, see their sets as energy-arc thumbnails in a feed
- Per-track hide — cross out any individual track in an otherwise-visible setlist, satisfying both the secretive DJ and the DJ protecting one collaborator's unreleased track
- Comparison/leaderboard mechanics built on aggregate stats (widest BPM range this month, genre diversity) rather than raw tracklists, giving a competitive hook without forcing full transparency

Everything is derived — no in-the-moment tagging, no manual data entry required to get value. Key, BPM, and genre come straight from Serato's metadata; key transitions are a pure Camelot-wheel lookup; the energy arc is BPM plotted against timestamp. No paid AI API is required anywhere in the core product, keeping marginal cost near zero.

## What Makes This Different

- **Reflection, not coaching.** Curfew shows trajectory — it never grades transition quality or beat-matching, both because that's not detectable from history files and because it protects the "mirror, not teacher" positioning that experienced DJs are more likely to trust.
- **Per-track hide is the privacy primitive *and* the emotional engine.** One mechanic works for the DJ who wants to protect a track ID and the DJ who's happy to share almost everything — and the redaction itself is what makes a shared setlist feel valuable rather than just informational.
- **It sees what commercial tools can't.** Unreleased edits, mashups, and self-produced tracks show up in a DJ's own history whether or not they were ever sold — Curfew surfaces them same as any other track.
- **The honest caveat:** the product's biggest advantage — the social/privacy layer — is also the piece with the weakest validated demand signal so far (see Known Risks). The moat here is closer to "nobody has built the combination" than "nobody could build the parts."

## Who This Serves

- **Working, gigging club DJs in a scene** — the primary target and intended paying core. They play the same club rotations with DJ friends, share tracks freely within their circle, and want a shared space to see how their scene collectively plays. Low competition among them makes the social layer additive rather than threatening.
- **Bedroom/hobbyist DJs** — practice mixers with no DJ friends and no scene, so the social and library-conversion pitches largely don't land for them. They're the highest-engagement free-tier/funnel audience and word-of-mouth engine, not the initial paying customer.
- **Wedding/private-event DJs** — distinct set types per event (sangeet, welcome, reception) with repetitive rotations; want prompts to mix it up and like-to-like comparisons across event types. [ASSUMPTION: secondary priority for V1, not a driver of core scope.]
- **Producer-DJs** — many club-scene DJs produce their own edits/mashups and want a place where those unreleased tracks show up in their stats alongside commercial releases.

Out of scope for V1: labels/artists as users, DJ company/roster B2B tooling (library-overlap analysis as a team tool is a plausible future paid tier, not now).

## Success Criteria

Given this brief feeds Arjun's own build planning rather than external stakeholders, success criteria are framed as validation gates rather than committed business metrics:

- **Parsing correctness**: Curfew reliably parses a real, multi-track Serato session (not just the single-track sample validated so far) and produces accurate per-set stats — this is a blocking technical validation, not just a nice-to-have (see O-4 below).
- **Personal value stands alone**: a DJ using only the personal dashboard (no social features touched) finds it worth opening after every gig — validates the "DJ-first, not social-first" thesis independent of scene network effects.
- **Scene feed feels alive**: in the single launch scene (~20 DJs), the feed has enough regular activity that new sets show up on peers' feeds within a normal usage cadence, not into a visibly empty room.
- **DJ-to-DJ growth signal**: at least some fraction of the launch scene's growth comes from existing users inviting scene peers ("get it so we can see each other's stats"), rather than the founder driving 100% of adds.

[ASSUMPTION: no numeric targets set yet for any of the above — Arjun to fill in thresholds once the app exists and there's real usage to compare against.]

## Scope

**In for V1:**
- Serato history + library parsing (desktop, local-first; raw files never leave the machine)
- Personal dashboard: most played tracks/artists, genre breakdown, BPM stats, key/harmonic stats, set metadata, energy arc
- Library utilization: conversion rate, aging shelf, time-to-first-play
- Optional segments within a set (dancefloor/dinner/performance) for multi-context sets
- Social feed with energy-arc thumbnails, follow/profiles
- Per-track hide + friends-only setlist visibility
- Optional Layer 2 tags (venue, crowd, event type, notes)

**Explicitly out for V1:**
- Rekordbox support (Serato only; Rekordbox is a considered v2)
- Mobile companion app (desktop only)
- Skill coaching / transition-quality grading (against product identity, not just deferred)
- In-the-moment/mid-set tagging (breaks the "effortless, after-the-fact" principle)
- Paid AI API features (not needed for any locked-in stat)
- Labels/artists and DJ company/roster B2B tooling
- Pricing/monetization mechanics beyond a rough directional assumption (subscription, ~$5-10/mo) — deliberately not finalized in this brief; revisit once the product exists

## Known Risks & Open Questions

This product rests on real research (market, domain, technical, and a pilot WTP survey), which surfaced specific tensions worth carrying forward rather than glossing over:

- **Social-vs-reflection demand tension.** A pilot WTP survey (n=10, convenience sample, low confidence) found paid appetite concentrated on reflection depth (style evolution, library utilization) while social/privacy features underperformed — "follow DJs" was unanimously expected to be free, and per-track hide (the flagship privacy mechanic) was the single least-wanted feature tested (6/10 wouldn't use it). Arjun has explicitly chosen to keep social-from-day-one as V1 scope despite this signal, judging the survey too small and the combination itself to be the differentiator. Worth re-testing with a larger, less pro-skewed sample before committing further engineering to the social layer.
- **Segmentation is unvalidated.** Set-boundary auto-detection (gap/deck-alternation heuristics) has only been tested against a single-track sample, not a real multi-track gig session. This is a blocking technical unknown, not a nice-to-have refinement.
- **Path-join complexity (O-3).** Serato's session file stores absolute paths while the library database stores relative paths; joining them requires normalization, and off-library plays (never imported into Serato's library) have no metadata and need a fallback (embedded tags or graceful "Unknown" handling).
- **Format maintenance risk.** Serato's `.session` format is undocumented and reverse-engineered by multiple independent open-source projects; judged low-risk due to redundancy across projects, but at least one (`triseratops`) explicitly warns of breaking changes over time.
- **Scene critical mass is unverified.** Whether ~20 DJs is enough for a launch scene's feed to feel "alive" rather than sparse has not been tested or addressed in any research to date.
- **Culture risk, not yet resolved.** Whether the "redacted banger" scarcity mechanic actually drives engagement, versus just reading as frustrating, is unaddressed by any research so far — it's a design bet, not a validated finding.
- **Target launch scene/city is not yet chosen** — a prerequisite decision before go-to-market execution can start.

## Vision

If Curfew works, it becomes the default place a working DJ checks the morning after a gig — the way a runner checks Strava. Reflection deepens (multi-year style trajectories, richer library insight) as more history accumulates per DJ. The social layer expands scene by scene, city by city, staying peer-driven rather than ad-driven. Rekordbox support extends the addressable base beyond Serato's open-format/club-leaning user base. Further out, the same underlying data — now aggregated and anonymized at the DJ-company/roster level — becomes a plausible B2B product for agencies who want to differentiate their roster's playing styles to clients, though that audience is explicitly not being designed for today.
