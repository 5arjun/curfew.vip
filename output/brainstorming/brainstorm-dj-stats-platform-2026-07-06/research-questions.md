# Research Brief — DJ Stats & Reflection Platform ("Strava for DJs")

**Source:** Brainstorming session memory log (`brainstorm-dj-stats-platform-2026-07-06`)
**Purpose:** Prime the next BMAD step — domain research + market research. Below is a prioritized list of the exact questions those efforts must answer, derived from the session's locked MVP scope and its explicit open questions.

**Locked concept (context for all questions below):** Serato-first, set-as-unit reflection + social platform for DJs. Effortless / after-the-fact (near-zero manual input). Automatic history-file parsing is the product; optional tags are bonus depth. Per-track hide + friends-only setlists as the privacy model. 2-week free trial → subscription. Launch to one saturated scene (~20 DJs in a tight rotation), then expand city by city. Target paying segment = working/gigging DJs who buy music and have scenes.

Priority legend: **[P0]** = highest priority / decision-blocking · **[P1]** = important · **[P2]** = supporting.

---

## 1. Market research questions

### Competitor landscape & gaps
- **[P0]** For each of **Songstats, DJ.Studio, Serato Playlists, and rekordbox analytics**: what exactly do they do, and what do they NOT do, relative to this concept's three differentiators — (a) automatic history-file parsing, (b) reflection framing ("compared to what?" baseline comparison, style evolution), and (c) privacy-first scene sharing (per-track hide + friends-only feed)? Map each competitor's coverage against these three axes to find the whitespace.
- **[P1]** Does any existing tool already offer a social/feed layer for DJs to see each other's setlists and stats? If so, how do they handle track-ID privacy, and why has it (or hasn't it) taken hold?
- **[P1]** Do any competitors offer "library utilization" analytics (aging shelf, conversion rate, time-to-first-play — a locked MUST feature)? Is "am I playing what I bought?" an unmet need in the current market?

### Willingness to pay
- **[P0]** Is there proven willingness to pay among working/gigging DJs for **reflection analytics** (not skill-coaching, not label/artist services)? Cite evidence — existing paid tools, their subscriber counts, pricing tiers, churn if available.
- **[P0]** At what price point do comparable DJ SaaS / analytics tools sell (monthly/annual), and what does the working-DJ segment currently accept as reasonable?

### Pricing model validation (explicitly flagged in session)
- **[P0]** Does a **~2-week free trial alone** sustain the DJ-to-DJ funnel / word-of-mouth growth loop, or is a **lightweight permanent free tier** required to fuel peer-to-peer recruitment? The session locked "subscription gated by 2-week trial" but flagged direct tension with the free-hobbyist funnel and the DJ-to-DJ growth loop — this must be resolved with evidence (analogous consumer-social + SaaS-freemium precedents).
- **[P1]** How have analogous "social + subscription" products (fitness/Strava, creative-tool communities) balanced free-tier reach against paid conversion? What does that imply for whether the hobbyist funnel can survive a trial-only model?

### Market sizing
- **[P0]** How many Serato DJs are there (total active user base), and what credible sources support that number?
- **[P0]** What fraction of Serato DJs fit the **paying segment** — "working/gigging DJs who buy music and have scenes"? Explicitly distinguish this from the free-hobbyist segment (bedroom DJs who rip music, have no scene, and break both monetization hooks). Size the reachable paying market.
- **[P2]** How large / addressable is the future expansion audience deferred to later versions (rekordbox DJs, and the wedding/DJ-company B2B roster tier) — for sizing the growth ceiling, not v1.

---

## 2. Domain / technical research questions

### Serato file format & parsing
- **[P0]** What is the structure of Serato **history/session files**? Document the reverse-engineering status in the community, available open-source parsers/libraries, and their reliability.
- **[P0]** What is the **maintenance risk** of relying on an unofficial/reverse-engineered format — how often does Serato change it, is there any official/supported export, and how have existing tools coped with format changes?

### Available metadata
- **[P0]** What metadata is **reliably available** in Serato history files: BPM, musical key, genre, timestamps, per-track play duration? Which of these are present per-play vs only in the track database, and how complete/clean are they in practice?
- **[P0]** Is **"played detection" / crossfade information** available — can the file tell whether a track was actually played out vs cued/previewed, and for how long? This underpins play-duration-vs-track-length inference (flop/rescue detection) and avg-playtime accuracy.

### Set segmentation feasibility
- **[P1]** Is it feasible to **auto-detect set segments** (dancefloor vs dinner vs performance) purely from file data — using gaps between tracks, track-length patterns, and mixing density — with a user one-tap confirm? How accurate can gap/density-based boundary detection realistically be? (Session made segmentation optional/per-user; multi-context wedding DJs opt in.)
- **[P1]** Related data-quality question: can non-set audio (family performance tracks, speech filler, dinner background) be reliably identified and excluded so it doesn't poison stats like average song playtime?

### Analysis without paid AI (confirm cost assumption)
- **[P0]** Confirm that **harmonic transition analysis via the Camelot wheel** can be computed purely from key metadata in the file (lookup table, no paid AI API).
- **[P0]** Confirm that the **energy arc ("the room's pulse")** can be derived from BPM vs timestamp alone (no paid AI API). Validate the session's core insight that key transitions, energy arc, genre, and first-ever-played all run at near-zero marginal cost from DB metadata + queries. Flag any stat that would actually require an external/paid API.

---

## 3. Go-to-market / validation questions

### "One saturated scene, then expand" strategy
- **[P0]** Validate the **launch-to-one-scene** strategy: is a **~20-DJ tight rotation** enough critical mass to make the social feed feel alive on day one? What is the realistic minimum active-DJ density for a scene feed to feel "live," and what evidence from other hyper-local social launches supports/refutes ~20?
- **[P1]** What are the mechanics of picking and saturating a first scene/city, and what signals indicate a scene is "saturated enough" to justify expanding to the next city?

### DJ culture — the track-ID secrecy tension
- **[P0]** Will the **per-track hide + friends-only setlists** mechanic satisfy BOTH poles of DJ culture — the secretive working DJ (fears track-ID leaks, demands privacy as the obvious default) AND the collaborative scene DJ (freely shares, hides only the one track an artist asked to keep private)? Validate against real DJ-community attitudes toward track-ID (IID) secrecy.
- **[P1]** Is the "redacted banger" scarcity dynamic (seeing a hidden track you want but can't get) a net positive engagement driver or a net frustration/churn risk? The session bet it is the product's central dramatic tension and what makes shared tracks feel valuable — test this assumption against how DJs actually react to track-ID gatekeeping.
- **[P2]** Does the DJ-to-DJ growth loop ("get it so we can be friends and see each other's stats") match how DJ tools actually spread within scenes, and does the social feed doubling as a crate-digging tool (tap a buddy's track → into your crate) align with real crate-digging behavior?

---

## Cross-cutting note for researchers
Two decisions carry the most residual risk and should be treated as the throughline across all three sections: **(1)** the trial-only vs permanent-free-tier monetization question (Section 1) directly determines whether the DJ-to-DJ / hobbyist-funnel growth loop (Section 3) can function; and **(2)** Serato file parsing reliability + metadata availability (Section 2) determines whether the locked MUST features (auto per-set dashboard, Camelot harmonic analysis, energy arc, library utilization) are buildable without a paid AI API. Resolve these first.
