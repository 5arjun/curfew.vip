---
title: "Curfew — PRD"
status: final
created: 2026-07-19
updated: 2026-07-19
---

# PRD: Curfew

## 0. Document Purpose

This PRD is for Arjun (PM + builder) and any downstream collaborators, feeding directly into UX and architecture work. It builds on `brief-name-pending-2026-07-19/brief.md` and four prior research artifacts (market, domain/Serato-format, technical architecture, WTP survey) rather than duplicating them. Vocabulary is Glossary-anchored (§3); features are grouped with Functional Requirements (FRs) nested and globally numbered, phase-tagged Phase 1 (Launch) or Phase 2 (Fast-Follow, §1 Vision); inferences are tagged inline `[ASSUMPTION]` and indexed in §12. Technical-how detail that doesn't belong in this narrative (backend/storage choices, sync protocol, parser architecture) lives in the companion `addendum.md` — this PRD states capability-level requirements only.

## 1. Vision

Curfew is a Serato-linked platform, not a standalone desktop app. A lightweight local component runs in the background, auto-detecting and parsing a DJ's Serato session and library files after a gig — no in-the-moment input required. Raw Serato files never leave the DJ's machine; only derived, structured data (per-track metadata, session stats) syncs to Curfew's backend. The DJ experiences everything else — personal dashboard, style trends, social feed — on Curfew's website. Every stat is framed against the DJ's own baseline: not "you were great," but "compared to what?"

Curfew is DJ-first, not social-first — and ships that way too. **Phase 1 (V1 Launch)** is the personal reflection layer standing entirely on its own: the mirror on a DJ's own trajectory — widening BPM range, growing genre count, whether newly-bought music is actually making it into sets — never a coach grading beat-matching or transitions. **Phase 2 (Fast-Follow)**, gated on Phase 1 proving out (§10 Success Metrics), adds the social layer: DJs follow each other, see sets as energy-arc thumbnails, and can selectively redact individual tracks from an otherwise-visible setlist — one mechanic that protects the secretive DJ and makes a shared setlist feel like something worth looking at.

This phasing isn't just caution — it's what the evidence pointed to. A small WTP survey found the social feed itself, not just its privacy mechanics, tested weak (⅓ of respondents wouldn't use it), the DJ-to-DJ invite loop scored a lukewarm 3.0/5, and reflection appetite alone tested "real but mild" against an already-free incumbent (DJs already self-review via Serato's own history). Independently, the technical research recommended de-risking parsing before investing in cloud/social infrastructure. Personal reflection has to earn its own adoption before the network effect is asked to carry the product.

Phase 2 launches across the Philly / NYC / NJ DJ scene as one combined network — prioritizing DJ critical mass over city-by-city rollout — then expands city by city as it grows. If it works, Curfew becomes the thing a working DJ checks the morning after a gig, the way a runner checks Strava, reflection deepening with accumulated history while the social layer stays peer-driven rather than ad-driven.

Nothing else combines all three pieces: Serato Playlists uploads history but has no reflection layer or privacy controls; Songstats does track-level industry analytics for artists/labels, not personal reflection; DJ.Studio does prep-time library stats, not post-set reflection. The moat this creates is closer to "nobody has built the combination" than "nobody could build the parts" — worth naming plainly, since the social/privacy layer is also the piece with the weakest validated demand signal so far (§11 Open Questions), which is exactly why it's Phase 2 rather than launch scope.
## 2. Target User

### 2.1 Jobs To Be Done

- **Working, gigging club DJs (primary, intended paying core)** — Help me see how I'm actually evolving as a DJ, and keep me connected to my scene — seeing what my friends are playing, supporting each other, with just enough friendly competition to make it fun. Not a leaderboard to flex on, a community to grow with. They play the same club rotations as their peers, so low competition among them makes the social layer additive rather than threatening.
- **Bedroom/hobbyist DJs (highest-engagement free-tier/funnel audience)** — Help me understand my own habits and progress, even though I don't have a scene or DJ friends yet. Word-of-mouth engine and funnel into the paying core, not the initial paying customer themselves.
- **Wedding/private-event DJs** *(secondary)* — Help me avoid repeating myself across sangeet/welcome/reception sets and see how I compare across event types.
- **Producer-DJs** *(cross-cutting)* — Show my unreleased edits and mashups in my stats alongside commercial tracks.

### 2.2 Non-Users (v1)

- Labels/artists as users
- DJ company/roster B2B tooling — a plausible future paid tier, not V1. Two related but distinct shapes exist in prior thinking: an internal team tool (library-overlap analysis across a roster) and an external client-facing tool (aggregated/anonymized roster-level stats an agency uses to differentiate its DJs to clients). Neither is designed for now; which shape (or both) to pursue is itself an open question if this is ever prioritized.

### 2.3 Key User Journeys

- **UJ-1. A working club DJ finds out what they missed, over coffee.** *(Phase 1)*
  - **Persona + context:** A gigging club DJ, the morning after a set.
  - **Entry state:** Already logged in, opens the Curfew website on their laptop over breakfast.
  - **Path:** (1) A popup says a new set was detected, asks if they want to add Layer 2 details — they decline. (2) Lands on the dashboard, clicks into last night's set. (3) Reviews the set's stats. (4) Back on the dashboard, notices a track they downloaded days ago that they meant to play and forgot. (5) Looking at the set's genre breakdown, realizes they under-played EDM relative to what that club normally wants.
  - **Climax:** The genre chart reveals a gap between what they played and what the room wanted — an actionable "do better next time" moment, not just a report.
  - **Resolution:** Leaves with two concrete takeaways — a specific forgotten track, and a genre-mix adjustment for next time at that venue.
  - **Realizes:** FR-1, FR-4 (silent auto-sync overnight), FR-16 (declinable Layer 2 prompt), FR-6 (genre breakdown).
  - `[NOTE FOR PM]` Suggests "recently downloaded but not yet played" may be worth a direct dashboard nudge (days-scale), distinct from the 3-month aging-shelf view (FR-12). Design-phase exploration, not committed.

- **UJ-2. A DJ gets curious about a friend's set, and it turns into a collaboration lead.** *(Phase 2)*
  - **Persona + context:** A DJ browsing the feed.
  - **Entry state:** Logged in, on the feed.
  - **Path:** (1) Taps into a friend's profile, then a recent set. (2) Sees BPM jumping around in the energy arc, wonders what transitions were used. (3) Comments on the set to ask, visible to other curious DJs too. (4) Notices a hidden track, wonders if it's an unreleased/self-produced track, curious rather than annoyed. (5) Later, checks a circle-scoped comparison (FR-25) and notices this friend plays significantly more techno than the rest of the group. (6) Considers reaching out to trade tracks and expand their own library into techno.
  - **Climax:** The comparison view turns into a real reason to reach out to a specific friend — collaboration, not envy.
  - **Resolution:** Strengthens an actual DJ-to-DJ relationship — the product working exactly as "community to grow with."
  - **Realizes:** FR-19–21 (follow/feed/profile), FR-26 (comments), FR-7 (energy arc prompting curiosity), FR-22 (hidden track sparks curiosity, not resentment), FR-25 (circle comparison).

- **UJ-3. First-time setup.** *(Phase 1 — the agent is foundational to both phases, but this journey covers no social surface)*
  - **Persona + context:** A DJ installing the local agent for the first time.
  - **Entry state:** Freshly signed up, agent just installed, no sets synced yet.
  - **Path:** (1) Runs the installer; agent auto-launches into the tray. (2) Agent scans default paths and connected drives, finds a Serato folder. (3) Agent surfaces the detected path and asks the DJ to confirm it's the right one, rather than silently trusting auto-detection. (4) DJ confirms (or corrects it, if wrong/ambiguous — e.g. multiple Serato installs). (5) DJ plays their next gig as normal, no in-the-moment action. (6) Next time they open the website, the set is already there.
  - **Climax:** The zero-setup promise proving itself on the very first real use, after one quick confirmation.
  - **Resolution:** Builds trust that the tool works invisibly going forward.
  - **Edge case:** Auto-detection finds the wrong path or nothing at all (nonstandard install, multiple Serato libraries) — DJ corrects it manually via the tray settings panel; a real early-friction point if not handled clearly.
  - **Realizes:** FR-1 (auto-discovery + confirmation), FR-5 (tray UI/settings fallback).

- **UJ-4. Deciding what to hide, before it's public.** *(Phase 2)*
  - **Persona + context:** A producer-DJ reviewing a just-synced set.
  - **Entry state:** Logged in, reviewing a set that synced as public by default.
  - **Path:** (1) DJ reviews the set's tracklist before their circle sees it. (2) Spots an unreleased edit they played. (3) Hides that one track — it shows as a redacted placeholder, not omitted. (4) Leaves the rest of the set public rather than making the whole thing private, since only one track needed protecting.
  - **Climax:** Choosing selective protection over an all-or-nothing toggle — validates per-track hide as distinct from whole-set private.
  - **Resolution:** Shares a set that still shows their skill and selection, without giving up the one track they're protecting.
  - **Realizes:** FR-22 (per-track hide), FR-23 (visibility tiers, default public).

- **UJ-5. Bedroom DJ, solo — no scene yet.** *(Phase 1)*
  - **Persona + context:** A hobbyist DJ who practices at home, no scene, no DJ friends on Curfew yet.
  - **Entry state:** Logged in, has synced a few weeks of practice sets.
  - **Path:** (1) Opens the dashboard after a practice session. (2) Skips the feed entirely — no one to follow yet. (3) Checks Style Evolution (FR-9), sees their BPM range has widened over the past month. (4) Feels visible progress despite no audience or scene.
  - **Climax:** The trend chart is proof of improvement that exists independent of any social validation.
  - **Resolution:** Motivated to keep logging sets — a future scene member once/if they start gigging.
  - **Realizes:** FR-9 (style evolution); directly tests the brief's "personal value stands alone" success criterion.

- **UJ-6. Library accountability, before a gig.** *(Phase 1)*
  - **Persona + context:** A working DJ prepping for an upcoming set.
  - **Entry state:** Logged in, browsing Library Utilization ahead of a gig.
  - **Path:** (1) Checks the aging-shelf view before prepping. (2) Sees tracks bought 3+ months ago, never played, some forgotten entirely. (3) Deliberately pulls a few into the prep crate for the upcoming gig, specifically to break the streak.
  - **Climax:** The list directly changes what the DJ digs for — behavior change, not just awareness.
  - **Resolution:** Higher utilization of their own purchased library.
  - **Realizes:** FR-12 (aging shelf).

- **UJ-7. Wedding DJ, client-request mismatch.** *(Phase 1, light)* Reviewing a wedding set, a DJ realizes they under-played pop relative to what the bride/groom explicitly asked for — signals them to weight client requests more heavily next time. Realizes FR-6, FR-16 (event-type tagging).

## 3. Glossary

- **Session** — Serato's own unit of file-level activity: one continuous launch-to-close (or manual Start/End Session) of the Serato application, captured in a `.session` file. Not every Session is a Set.
- **Set** — The product-level unit Curfew tracks and displays: a DJ's played performance, derived from a Session after passing set detection (FR-1) and, when ambiguous, DJ confirmation (FR-27). Every Set originates from a Session; not every Session becomes a Set.
- **Local agent** — The background component (Tauri/Rust) that watches the Serato data directory, parses Sessions, and syncs derived data. Its only UI is the tray/menu-bar presence (FR-5).
- **Serato data directory** — The folder (default or DJ-configured, possibly on removable media) containing Serato's History and library files.
- **In-library / off-library track** — Whether a track was imported into Serato's library database (in-library) or only ever played from disk (off-library), which determines how its metadata is resolved (FR-2).
- **Derived data** — Structured, computed data (stats, per-track metadata) as distinct from raw Serato files. Only derived data ever leaves the DJ's machine (FR-3).
- **Energy arc** — BPM plotted against timestamp within a Set; the visual "pulse of the room" (FR-7).
- **Camelot wheel** — The harmonic-mixing key notation system used for key-compatibility stats (FR-6).
- **Layer 2 enrichment** — Optional, after-the-fact context (venue, crowd size, event type, notes) a DJ can add to a Set from the website (§4.6). Never required for core dashboard value.
- **Segment** — A labeled time-range within a single Set (e.g. dancefloor / dinner / performance), for multi-context Sets like weddings (§4.5).
- **Conversion rate** — % of tracks added to a DJ's library that have been played at least once in a Set (FR-11).
- **Aging shelf** — Library tracks unplayed for 3+ months (FR-12).
- **Per-track hide** — Marking an individual track within a Set as hidden; renders as a redacted placeholder rather than being omitted (FR-22).
- **Visibility tier** — A Set's sharing level: public, friends-only, or private (FR-23).
- **Circle** — The set of DJs a given DJ follows; used for circle-scoped comparisons (FR-25) as distinct from network-wide ones (FR-24).
- **Network** — The full Curfew user base within the launch region (Philly / NYC / NJ, combined per Vision §1).

## 4. Features

### 4.1 Serato Parsing & Auto-Sync *(Phase 1 — Launch)*

**Description:** A local background agent (Tauri/Rust) watches the DJ's Serato History folder, parses completed session files, joins each track against the Serato library database (or falls back to embedded file tags for tracks never imported into the library) to enrich with BPM/key/genre, computes stats locally, and auto-syncs the derived result to Curfew's backend. Raw session files and the raw library database never leave the machine.

**Functional Requirements:**

#### FR-1: Background set detection

The local agent detects a completed Serato session without any DJ action.

**Consequences (testable):**
- Agent auto-discovers the Serato data directory at its OS-standard default location (`~/Music/_Serato_/` on macOS, equivalent on Windows) on first launch, no DJ input required.
- Agent also scans connected removable/USB volumes for a Serato data directory, since many DJs keep their entire Serato library (history + music) on a USB drive rather than the internal disk.
- If no Serato directory is found automatically, the DJ can set the folder path manually via the tray settings panel (see FR-5).
- If the configured path lives on removable media, the agent detects reconnection automatically on drive plug-in and resumes watching without requiring re-configuration.

#### FR-2: Track-level enrichment via library join

For each track in a session, the agent resolves BPM/key/genre from the Serato library.

**Consequences (testable):**
- In-library tracks: BPM/key/genre pulled from the Serato library database.
- Off-library tracks (never imported into Serato's library): agent falls back to embedded file tags (Serato Autotags GEOB for BPM, ID3 `TKEY`/`TCON` or Vorbis comments for key/genre).
- If neither source has data, the track displays as "Unknown" rather than being silently omitted or guessed.

**Out of Scope:**
- Local audio analysis/DSP (e.g. key-finding from waveform) for tracks with no library or tag data — deferred beyond V1.

#### FR-3: Local-only raw data boundary

The agent never transmits raw Serato session files or the raw library database off the DJ's machine.

**Consequences (testable):**
- Only derived/structured data (per-track metadata + computed stats) leaves the machine, over HTTPS.
- Agent's filesystem access is scoped to the configured Serato data path only.

#### FR-4: Auto-sync to backend after each set

Completed sets upload to Curfew's backend automatically, without the DJ manually triggering it.

**Consequences (testable):**
- Sync is idempotent — re-running does not duplicate a set.
- If offline at set-completion time, the set queues locally and syncs when connectivity returns.

#### FR-5: Menu-bar/tray presence

The agent's only UI surface is a menu-bar icon (macOS) / system-tray icon (Windows) plus a minimal settings panel.

**Consequences (testable):**
- Icon reflects sync state: idle / syncing / failed / drive not connected.
- Settings panel exposes only the Serato folder path override — everything else (dashboard, stats, social) lives on the website, not in the agent.

#### FR-27: Confidence-gated live/practice confirmation *(dormant until Phase 2)*

Before a session becomes visible to anyone but the DJ, the system checks classification confidence and only asks for confirmation when genuinely ambiguous.

**Consequences (testable):**
- Sessions with a low-confidence signal (dense, continuous play with no long gaps — could be a real set or a realistic home rehearsal) trigger a one-tap confirmation ("was this a real set?") before the session can become visible to others (feed, comparisons, public/friends-only visibility).
- High-confidence real sets and obviously-not-a-set sessions (e.g. a single track briefly cued) never trigger a prompt.
- The DJ's own personal dashboard (FR-6 onward) is unaffected by this gate — a session is visible to the DJ themself regardless of classification confidence, preserving the zero-effort promise for personal reflection.

**Out of Scope:**
- Reliably distinguishing a realistic home rehearsal from a real live gig by data alone — research found no available signal (Serato's own "Played" flag fires identically in Practice Mode) and no comparable tool in this space has solved it. This FR reduces friction, it does not claim to solve the underlying ambiguity.

**Feature-specific NFRs:**
- Format-drift resilience: golden-file regression tests against known-good session/DB fixtures catch a Serato format change before it silently corrupts synced data.

**Notes:**
- `[NOTE FOR PM]` This FR's actual gate (visibility to others) has nothing to protect until Phase 2's feed/comparisons ship — in Phase 1, every session is dashboard-only regardless of classification confidence, so the confirmation prompt never fires. The underlying classification signal is still worth computing from Phase 1 onward, since a misclassified rehearsal session polluting a DJ's own Style Evolution trend (§4.3) is a Phase 1 data-quality concern independent of the Phase 2 visibility gate — but no FR currently specifies Phase 1 filtering/flagging on that basis. Worth a design-phase look.
- `[NOTE FOR PM]` Set-boundary detection (where one set starts/ends from raw session data) is an unresolved, blocking technical validation gate — research so far only validated parsing against a single-track sample, not a real multi-track gig session. Carried forward from the brief's Known Risks; tracked in §11 Open Questions.
- `[NOTE FOR PM]` A deeper, smarter set-detection/classification algorithm (better live-vs-practice signal, flow-aware wedding-style segmentation) was discussed and intentionally deferred to a future session — not in scope for this PRD pass. FR-27/FR-28 represent the V1 baseline, not the ceiling.

### 4.2 Personal Dashboard *(Phase 1 — Launch)*

**Description:** The core reflection surface, viewed on the website. Every synced set produces a per-set summary and an energy-arc visualization; raw genre tags are normalized before display so fragmented taxonomy (e.g. "Hip-Hop / R&B" vs "Hip Hop") doesn't split what should be one bucket.

**Functional Requirements:**

#### FR-6: Per-set summary

DJ can view, for any synced set: most played tracks/artists, genre breakdown, BPM distribution, key/Camelot-wheel mixing stats, set length, and track count.

#### FR-7: Energy arc

DJ can view BPM plotted against timestamp within a set, rendered as a visual "pulse of the room."

#### FR-8: Genre normalization

Raw Serato genre tags are mapped to a normalized taxonomy before display.

**Consequences (testable):**
- Normalization uses a fixed mapping table Curfew maintains; not DJ-editable in V1.

### 4.3 Style Evolution *(Phase 1 — Launch)*

**Description:** Trend view showing how a DJ's playing style shifts over time, plus whether newly-acquired library tracks are actually making it into sets.

**Functional Requirements:**

#### FR-9: Trend view

DJ can view BPM range, genre diversity, and key-usage patterns month-over-month across their synced set history.

#### FR-10: Library-to-setlist correlation

DJ can see whether recently-added library tracks are making it into their sets, as a trend line over time. (Underlying conversion-rate computation lives in Library Utilization, §4.4.)

### 4.4 Library Utilization *(Phase 1 — Launch)*

**Description:** Surfaces whether a DJ's library spending translates into actual playing — conversion rate, aging shelf, and time-to-first-play, all derived from library and session data with no manual input.

**Functional Requirements:**

#### FR-11: Conversion rate

DJ can view the % of tracks added to their library that have been played at least once in a set, over a rolling window.

#### FR-12: Aging shelf

DJ can view library tracks unplayed for 3+ months (from add date or last play).

#### FR-13: Time-to-first-play

DJ can view the elapsed time between a track being added to the library and its first play in a set.

**Notes:**
- `[ASSUMPTION]` FR-11–FR-13 depend on a reliable "date added to library" timestamp field from Serato's library DB. Domain research's field-coverage table didn't explicitly confirm this field; flagged for architecture-stage validation (see `addendum.md`).

### 4.5 Set Segments *(Phase 1 — Launch)*

**Description:** Lets a DJ split a single continuous set into labeled time-range segments — needed for multi-context sets like weddings (dinner → dancefloor → performance) where one Serato session covers fundamentally different playing contexts.

**Functional Requirements:**

#### FR-14: Segment marking

DJ can mark one or more time-range segments within a set, each with a type (dancefloor / dinner / performance) or custom label.

#### FR-15: Segment-scoped stats

Per-set stats (FR-6, FR-7) can be filtered/sliced by segment.

#### FR-28: Algorithmic segment suggestion

The system uses inter-track timestamp gaps (and other available session patterns) to auto-suggest segment boundaries within a set.

**Consequences (testable):**
- DJ confirms or adjusts suggested boundaries rather than manually creating every boundary from scratch (FR-14 remains available as fully-manual fallback).
- A large gap between tracks is treated as a candidate boundary (e.g. distinguishing a doors/entrances lull from continuous dancefloor play).

**Out of Scope:**
- Reliable, fully-automatic flow-aware segmentation (e.g. confidently auto-labeling "dinner" vs "dancefloor" without DJ confirmation) — deferred to a future session as part of the deeper set-detection algorithm work (see FR-27 notes).

**Notes:**
- `[NOTE FOR PM]` This FR shares its unvalidated status with FR-1/FR-27 — depends on real multi-track session data not yet available (brief's O-4).

### 4.6 Layer 2 Enrichment *(Phase 1 — Launch)*

**Description:** Optional, after-the-fact context a DJ can add to any synced set from the website. Never required — the personal dashboard works fully on file data alone.

**Functional Requirements:**

#### FR-16: Manual enrichment

DJ can add venue, crowd size, event type, and free-text notes to any synced set, from the website, after the fact.

#### FR-17: Enrichment unlocks richer comparisons

Layer 2 tags enable comparisons like BPM-in-club-sets vs. BPM-in-radio-sets, without being required for core dashboard stats.

#### FR-18: Location-based venue suggestion

DJ can opt in (off by default) to location-based venue suggestions.

**Consequences (testable):**
- When enabled, the local agent captures approximate device location at set-completion time.
- The website reverse-geocodes this into a suggested venue name.
- The DJ confirms or edits the suggestion before it saves — never silently auto-filled, since dense nightlife blocks (multiple venues per building) can misattribute.
- Disabled by default; requires explicit opt-in given location is more sensitive than any other data Curfew touches.

### 4.7 Social Feed *(Phase 2 — Fast-Follow, gated on Phase 1 Success Metrics SM-1/SM-2)*

**Description:** Where the community layer lives. DJs follow each other and see sets show up as energy-arc thumbnails — a glanceable, supportive presence rather than a stat dump.

**Functional Requirements:**

#### FR-19: Follow

DJ can follow other DJs in the network.

#### FR-20: Feed

DJ sees followed DJs' sets in a feed, rendered as energy-arc thumbnails; clicking through opens the full set view.

**Notes:**
- `[NOTE FOR PM]` Feed card variety beyond the energy-arc thumbnail (mixing in other content types) was raised as worth exploring, but not locked down — open for UX exploration rather than fixed to a single card format in v1.

#### FR-21: Profile

Each DJ has a profile showing recent sets and whichever aggregate stats they've chosen to make visible.

#### FR-26: Set comments

DJ can leave comments on a set (e.g. asking about a transition or track choice).

**Consequences (testable):**
- Comments are visible to anyone who can see the set, respecting its visibility tier (FR-23) — public/friends-only viewers can read and add comments; a private set has no comment surface beyond the owner.
- Surfaced by a DJ wanting to ask a friend about a set's transitions and wishing other curious DJs could see the exchange too (UJ-2), rather than a 1:1 side-channel.

### 4.8 Per-Track Hide & Privacy *(Phase 2 — Fast-Follow)*

**Description:** Privacy controls at two grains: a whole-set toggle for DJs who want the simplest option, and per-track redaction for DJs who want to share most of a set but protect a specific track. Per-track hide serves two distinct cases with one mechanic: a DJ protecting their own track ID (e.g. an unreleased edit, UJ-4), and a DJ protecting a collaborator's track that isn't theirs to share. This dual purpose matters because DJ culture spans two extremes — many treat track selections as competitive IP and are protective of revealing exact tracklists, while others are fully open — and a tool that assumes either extreme alienates half its potential users. Neither hide mechanic is the product's flagship mechanic — both are features among several, not the emotional core of the product.

**Functional Requirements:**

#### FR-22: Per-track hide

DJ can mark individual tracks in a set as hidden.

**Consequences (testable):**
- Hidden tracks render as a visible redacted placeholder in the setlist — not silently omitted.

#### FR-23: Set visibility tiers

Each set has one of three visibility levels: public (any DJ in the network), friends-only (mutual follows), or private (visible only to the DJ themself — appears on their own dashboard, never shared to feed or profile).

**Consequences (testable):**
- Default visibility on sync is **public** — promotes community/critical-mass over privacy-by-default.
- Private is a one-action, whole-set toggle — the easy option for a DJ who wants full privacy without hiding tracks one at a time.

**Notes:**
- `[NOTE FOR PM]` WTP survey signal (n=10, low confidence) found per-track hide was the single least-wanted feature tested (6/10 wouldn't use it), and "follow" was unanimously expected free. Arjun has chosen to keep both in scope regardless (now Phase 2, which gives this more runway to be re-tested before it's built — §11 Open Questions).

### 4.9 Community Comparisons *(Phase 2 — Fast-Follow)*

**Description:** Friendly-competition comparisons built from aggregate stats, never raw tracklists — available both as network-wide leaderboards and scoped to a DJ's own circle.

**Functional Requirements:**

#### FR-24: Network-wide leaderboards

DJ can view network-wide aggregate comparisons (e.g. widest BPM range this month, genre diversity) — public within the network, framed descriptively rather than as "best"/"winner" rankings.

#### FR-25: Circle-scoped comparison

DJ can view the same comparison stats scoped specifically to DJs they follow, independent of the network-wide leaderboard.

## 5. Cross-Cutting NFRs & Constraints

### 5.1 Performance
- Local parsing/sync of a typical library (~5,000 tracks) completes without noticeable resource usage on the DJ's machine — stats computation is arithmetic-only, no ML/inference required.

### 5.2 Privacy
- Raw Serato session files and the raw library database never leave the DJ's machine (FR-3) — only derived/structured data syncs.
- Per-DJ data isolation enforced server-side (see `addendum.md`) — one DJ's data is unreachable by another DJ's session even if the API layer has a bug.
- Location data (FR-18) requires explicit, off-by-default opt-in — the most sensitive data category Curfew touches.
- `[NOTE FOR PM]` A formal privacy review (GDPR/CCPA-equivalent) is flagged in the technical research as advised before public launch but not yet assessed in depth. Carried to §11 Open Questions.

### 5.3 Cost
- No paid AI/ML API required anywhere in the core product — all stats are derived arithmetically from parsed metadata, keeping marginal per-DJ cost near zero.

### 5.4 Reliability
- Format-drift resilience via golden-file regression tests (FR-1/FR-27 feature NFR) — a Serato format change is caught by CI before it silently corrupts synced data, shipped via a signed auto-updater.

## 6. Product Surfaces & Platform

### 6.1 Information Architecture
- **Website (DJ-facing):** Dashboard (home) → Set Detail (stats, energy arc, segments, enrichment) → Style Evolution → Library Utilization → Feed → Profile → Comparisons (network + circle) → Account/Privacy settings.
- **Local agent:** tray/menu-bar icon + one settings panel (Serato path override) only — no other surface (FR-5).

### 6.2 Aesthetic and Tone
- Copy and UI framing favor community and friendly competition over status/flex — no "best," "winner," or ranking language that reads as arrogant. Carried through Features §4.7–4.9 per explicit correction during this PRD's discovery.
- Reflection framing stays descriptive/comparative to the DJ's own baseline ("compared to what?"), never coach-graded (Vision §1).

### 6.3 Platform
- Local agent: desktop, macOS + Windows (Tauri/Rust). No mobile companion app in V1.
- DJ-facing experience: website (responsive web), not a native app.
- Serato only — no Rekordbox support in V1 (considered for v2, per brief).

## 7. Monetization

- Not locked down in this PRD — deferred until the product exists and usage data can inform pricing. `[ASSUMPTION, unresolved.]`
- The brief's original ~$5-10/mo subscription assumption is contradicted by the WTP survey's own data: only 2/10 respondents wanted a subscription, 7/10 preferred one-time payment. Actual Van Westendorp price-sensitivity data exists ($10 "sweet spot," ~$25-30 ceiling) and sits well above the brief's assumed range — worth pricing against real data rather than the original assumption when this is revisited.
- WTP survey signal: "follow" was unanimously expected to be free by survey respondents (n=10, convenience sample skewed pro, low confidence) — since "follow" is now Phase 2 rather than launch scope, this has more runway to be re-tested before it's monetization-relevant.
- Paying-core-vs-funnel segmentation from the brief (club DJs as intended paying core, bedroom DJs as free-tier growth engine, §2.1) still needs to be reconciled with the one-time-vs-subscription signal above — e.g. a one-time "supporter" purchase model may fit the funnel dynamic better than recurring subscription. Not resolved here.

## 8. Non-Goals (Explicit)

- Rekordbox support (Serato only in V1; considered for v2).
- Mobile companion app (desktop agent + web only).
- Skill coaching / transition-quality grading — against product identity (Vision §1), not just deferred.
- In-the-moment/mid-set tagging — breaks the "effortless, after-the-fact" principle.
- Paid AI/ML API features — not needed for any locked-in stat.
- Labels/artists as users; DJ company/roster B2B tooling (§2.2).
- Reliably distinguishing a live gig from a realistic home rehearsal by data alone — unsolved by anyone in this space (FR-27); V1 mitigates with confidence-gated confirmation, does not claim to solve it.
- Fully automatic, flow-aware segmentation (auto-labeling "dinner" vs. "dancefloor" with no DJ confirmation) — FR-28 suggests, DJ confirms.
- Local audio DSP/waveform key-finding for tracks with no library or tag data (FR-2).
- Locking down monetization mechanics — directional assumption only (§7).

## 9. MVP Scope

Scope is split into two phases (§1 Vision). Phase 2 isn't a backlog item — it's gated on Phase 1 proving out SM-1 and SM-2 (§10), a product decision, not a calendar date.

### 9.1 Phase 1 — Launch
- Serato parsing + auto-sync, including USB/removable-drive discovery (§4.1, FR-1–FR-5). Session classification confidence (FR-27) is computed from Phase 1 onward, but its confirmation-prompt behavior is dormant — see FR-27 notes.
- Personal dashboard: per-set stats, energy arc, genre normalization (§4.2).
- Style evolution trend view (§4.3).
- Library utilization: conversion rate, aging shelf, time-to-first-play (§4.4).
- Set segments, manual and algorithm-suggested (§4.5).
- Layer 2 enrichment, including opt-in location-based venue suggestion (§4.6).

### 9.2 Phase 2 — Fast-Follow (gated on Phase 1 Success Metrics)
- FR-27's confirmation-prompt gate activates — the first time it has anything to protect (feed, comparisons, public/friends-only visibility).
- Social feed: follow, feed, profile, comments (§4.7).
- Per-track hide and three-tier set visibility, public by default (§4.8).
- Community comparisons: network-wide and circle-scoped (§4.9).

### 9.3 Out of Scope (Both Phases)
- Everything listed in §8 Non-Goals.
- The deeper set-detection/classification algorithm (better live-vs-practice signal, true flow-aware segmentation) — `[NOTE FOR PM]` intentionally deferred to a dedicated future session, not lost.
- Reverse-geocoding provider selection for venue auto-suggest — deferred to architecture phase (`addendum.md`).

## 10. Success Metrics

*Framed as validation gates rather than committed business metrics, since this PRD feeds Arjun's own build rather than external stakeholders — per brief. SM-1 and SM-2 are also the literal Phase 2 gate (§9).*

**Phase 1 gate (both must hold before Phase 2 work starts)**
- **SM-1**: Parsing correctness — Curfew reliably parses a real, multi-track Serato gig session (not just the single-track sample validated so far) and produces accurate per-set stats. Blocking technical validation. Validates FR-1, FR-2, FR-28. (FR-27's classification signal is computed from Phase 1 onward and its accuracy matters for SM-2's data quality, but FR-27's own confirmation-prompt behavior isn't exercised until Phase 2 — see FR-27 notes.)
- **SM-2**: Personal value stands alone — a DJ using only the personal dashboard finds it worth opening after every gig. Validates FR-6–FR-13. Set the bar deliberately: WTP survey found reflection appetite "real but mild" (3.8/5) against an already-free incumbent (DJs already self-review via Serato's own history) — this metric needs to clear that incumbent, not just register non-zero interest.
- `[NOTE FOR PM]` The primary/paying persona (club DJs, §2.1) has a JTBD that's majority about the scene/community layer — "keep me connected to my scene... a community to grow with" — which Phase 1 doesn't deliver at all. SM-2 is where this tension actually gets tested: does personal reflection alone hold this persona's interest, or does the paying-core assumption itself depend on Phase 2 existing? Not resolved here — a real risk to watch, not smoothed over.

**Phase 2 metrics (evaluated once Phase 2 ships)**
- **SM-3**: Scene feed feels alive — in the combined Philly/NYC/NJ network, the feed has enough regular activity that new sets show up on peers' feeds within a normal usage cadence. Validates FR-19–FR-21. Starting bar is lower than it looks: WTP survey found ⅓ of respondents wouldn't use the feed at all — this metric is explicitly there to test whether that holds at real scale, not assumed to pass.
- **SM-4**: DJ-to-DJ growth signal — at least some fraction of network growth comes from existing users inviting peers, not 100% founder-driven. Validates FR-19, FR-24, FR-25. Same caveat: WTP's invite-loop question scored a lukewarm 3.0/5.

**Counter-metrics (do not optimize)**
- **SM-C1**: Parsing "Unknown" rate must stay honestly visible, not suppressed to make coverage look better than it is. Counterbalances SM-1.
- **SM-C2**: Personal-dashboard engagement must reflect genuine reflection value, not compulsion loops (artificial notification pressure, streak mechanics) — contradicts the privacy-first, reflection-not-coaching positioning (Vision §1). Counterbalances SM-2.
- **SM-C3**: Feed/network "activity" must not be inflated by loosening FR-27's confidence gate — a rehearsal session posted as a real gig damages trust more than a quiet feed. Counterbalances SM-3.
- **SM-C4**: Growth mechanics must not rely on spammy notification pressure — contradicts the "community, not flex" positioning (§6.2). Counterbalances SM-4.

`[ASSUMPTION]` No numeric targets are set for any metric above — carried from the brief; Arjun to fill in thresholds once the app exists and real usage data is available.

## 11. Open Questions

1. Set-boundary detection (where a set starts/ends) is unvalidated against real multi-track gig data — blocking gate for FR-1/FR-27/FR-28 (brief's O-4).
2. A deeper set-detection/classification algorithm (better live-vs-practice signal, true flow-aware wedding-style segmentation) was discussed and intentionally deferred to a future session.
3. Does Serato's library DB reliably expose a "date added to library" field? Needed for FR-11–FR-13; unconfirmed by domain research.
4. Formal GDPR/CCPA-equivalent privacy review not yet conducted — advised before public launch (technical research).
5. Per-track hide and "follow" tested weakest in the WTP survey (n=10, convenience sample skewed toward pro DJs, low confidence) — kept in scope (now Phase 2) regardless; worth re-testing with a larger, less pro-skewed sample before Phase 2 engineering investment, especially since per-track hide's positioning shifted this session from brief's "flagship privacy mechanic" to "one feature among several."
6. Culture risk, distinct from #5's demand-signal question: does the per-track-hide redaction actually drive engagement (a "scarce, worth looking at" effect) once used, or does it just read as frustrating to the viewer? Unaddressed by any research so far — a design bet, not a validated finding.
7. Reverse-geocoding provider for venue auto-suggest (FR-18) not yet chosen — cost/accuracy/attribution tradeoffs deferred to architecture phase.
8. Feed card variety beyond the energy-arc thumbnail (FR-20) — open for UX exploration.
9. "Recently downloaded, not yet played" as a direct dashboard nudge, distinct from the 3-month aging-shelf view — surfaced by UJ-1, not committed.
10. Scene critical mass unverified — is the combined Philly/NYC/NJ network enough for the feed to feel alive at launch? (brief's known risk, still open.)
11. Monetization mechanics entirely unresolved (§7) — revisit once the product exists, including whether the paying-core (club DJs) vs. free-tier-funnel (bedroom DJs) segmentation from the brief still holds.
12. Format-maintenance risk: judged low-risk due to redundancy across multiple independent open-source parsing projects, but `triseratops` (a direct dependency, see `addendum.md`) explicitly warns of breaking API changes over time — worth re-confirming this calculus stays favorable as the dependency evolves.
13. Named fast-follower risk: `unbox` (Go, 364★, cross-platform Serato read+display tool) is the closest existing project to Curfew's parsing layer. Market research recommends monitoring it, not acting now — no current overlap with Curfew's reflection/social layer, but worth tracking.
14. Unprompted feature signals from market research, not scoped into any current feature: a crate/duplicate-finder tool, and a scene-level "record pool" concept — both loosely tied to Library Utilization's stronger paid-intent signal. Logged for future consideration, not committed to V1.

## 12. Assumptions Index

- §4.4 (FR-11–FR-13) — Library Utilization depends on a reliable "date added to library" field from Serato's DB, not explicitly confirmed by domain research.
- §7 (Monetization) — Not locked down; pricing model itself (one-time vs. subscription) and paying-core/funnel segmentation both unresolved.
- §10 (Success Metrics) — No numeric targets set for any SM; carried from the brief, to be filled in once real usage data exists.

