# Brainstorm Intent: DJ Stats & Reflection Platform ("Strava for DJs")

## 1. Product thesis

A Serato-first stats and reflection platform for DJs that reads their play history after every gig and — with near-zero effort — turns it into a per-set dashboard where every number is framed against the DJ's own baseline ("compared to what?"). The core "aha" is self-discovery: "I learned things about my own DJing." It is DJ-first (a personal mirror), with a social layer where DJs in the same scene follow each other, see each other's setlists (some tracks hidden), and lovingly steal tracks — spreading DJ-to-DJ within a tight scene.

## 2. Locked principles

1. **DJ-first, not social-first** — the product's identity is a personal reflection tool; social is a selling point, not the primary identity.
2. **Reflection, not coaching** — no skill-coaching (transition quality, beat-match tightness): not detectable from history files, and it dilutes positioning. Trajectory reflection ("style evolution over time") serves the "am I improving?" need without becoming a teaching app.
3. **DJs-only in v1** — labels/artists and company/roster B2B are explicitly future audiences; do not design for them yet.
4. **Effortless / after-the-fact / derive-don't-ask** — minimize user input; NO in-the-moment tagging mid-set; derive as much as possible automatically from the files.
5. **Two-layer data model** — Layer 1 automatic (pure file data, zero effort, works for every DJ, IS the product) + Layer 2 optional after-the-fact tags (requests, popped-off, venue, notes) that unlock richer stats only for enriched sets. Graceful absence: untagged stats simply aren't tracked; the app still works fully on file data alone.
6. **No paid AI API in the core** — key/BPM/genre read from DB metadata; key transitions = Camelot wheel lookup; energy arc = BPM vs timestamp; first-ever-played = DB query. Near-zero marginal cost.
7. **Per-track hide as the privacy primitive AND the emotional engine** — one mechanic (per-track hide/cross-out in an otherwise-visible setlist) satisfies the secretive DJ, the collaborative DJ, and creates the "redacted banger" tension. Scarcity is what makes shared tracks feel like a gift; privacy controls aren't just protection, they give sharing its meaning.
8. **Growth = DJ-to-DJ within one scene** — the product spreads peer-to-peer inside a scene ("get it so we can be friends & see each other's stats"), not via ads.

## 3. Target personas

- **Bedroom / hobbyist DJ** — does practice mixes not "sets"; no DJ friends, rips music free, so social + utilization pitches are moot; most engaged daily user; a free-tier funnel / word-of-mouth engine, not a paying customer.
- **Working club DJ in a scene** — plays same club rotations with DJ friends, low competition, freely shares tracks; wants a shared space to see each other's stuff; the paying core.
- **Wedding / private-events DJ** — repetitive sets, wants prompts to mix it up and play unexplored record-pool downloads; has distinct set types per event (sangeet, welcome, reception, mehndi) and wants like-to-like comparison; plays non-dancefloor audio that would poison stats.
- **Producer-DJ** — many in the club scene produce their own edits/mashups/tracks and want a shared space for them.
- **DJ company / roster** — wants its roster's libraries differentiated so clients can tell DJs apart; library-overlap analysis = a business tool (future paid team tier, WON'T v1).

## 4. The 6 resolved forks

1. **Atomic unit** = the SET, with optional typed segments (dancefloor / dinner / performance). Serves club DJs simply and multi-context/wedding DJs; feeds energy arc, feed thumbnail, baseline compare, like-to-like.
2. **V1 wedge** = SOCIAL FROM DAY ONE (dashboard + feed + leaderboards together). Highest ceiling; accepts the cold-start/scene-onboarding risk.
3. **Platform** = SERATO FIRST (club/open-format base, matches the pitch, known history format). Rekordbox in v2.
4. **Money** = SUBSCRIPTION ONLY (flat sub for all users), gated by a ~2-week FREE TRIAL (not a permanent free tier). Everyone trials free, then pays.
5. **Launch** = ONE saturated scene/city (~20 DJs in a tight rotation) so the feed is alive day one, then expand city by city — turning cold-start risk into go-to-market strategy.

*(The memlog records these as Fork 1–4 plus the launch-strategy decision; the money fork carries the trial refinement, giving the resolved set above.)*

## 5. MVP scope (MoSCoW)

**MUST**
- Serato parsing + auto per-set data
- Per-set dashboard with baseline comparison
- Energy arc ("the room's pulse")
- Key/harmonic (Camelot) + genre + set metadata
- Optional segments
- Library utilization (aging shelf, conversion rate, time-to-first-play) — promoted to MUST: every DJ wants "am I playing what I bought?", needs no social network, and is a uniquely-yours hook
- Social feed with energy-arc thumbnails (DJ-chosen card)
- Per-track hide + friends-only setlists
- Follow DJs / profiles
- 2-week trial → subscription

**SHOULD**
- Taste leaderboards
- "The One Thing" share card
- Optional after-the-fact tags
- Per-set photos/videos

**COULD**
- Style-evolution
- Rediscovery prompts
- "Request the ID"
- Crews / shared crate
- Unreleased-music tracking

**WON'T (this time)**
- Rekordbox
- Mobile app
- Labels/artists
- Company/roster B2B tier
- Skill coaching
- AI-API features
- In-the-moment tagging

## 6. Open questions for research

- **Funnel model:** does a ~2-week trial alone sustain the DJ-to-DJ growth loop, or is a lightweight permanent free tier needed?
- **Platform-scene fit:** which platform (Serato vs Rekordbox) owns the target launch scene?
- **Competitor gaps:** what do existing DJ-stats/reflection tools leave uncovered?
- **Segmentation feasibility:** can set-type / segment boundaries be auto-detected (from gaps, track length, mixing density) reliably enough for one-tap confirmation?
