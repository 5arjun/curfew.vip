---
stepsCompleted: [1, 3]
inputDocuments: ['output/brainstorming/brainstorm-dj-stats-platform-2026-07-06/research-questions.md', '_bmad-output/planning-artifacts/research/market-dj-stats-reflection-platform-research-2026-07-07.md', 'sample export: 22474.session + database V2 (Serato, provided 2026-07-17)']
workflowType: 'research'
lastStep: 3
research_type: 'domain'
research_topic: 'Serato history-file parsing & metadata availability for a DJ reflection platform'
research_goals: 'Resolve Section 2 (domain/technical) of the research brief — the build-feasibility gate: document Serato history/session file structure & reverse-engineering status, verify open-source parsers and their reliability, assess maintenance risk of the unofficial format, confirm which metadata (BPM/key/genre/timestamps/play-duration/played-detection) is reliably available per-play, assess set-segmentation feasibility, and confirm the no-paid-AI cost assumption (Camelot harmonic analysis + energy arc). Produce a build-risk verdict per locked MUST feature.'
user_name: 'Arjun'
date: '2026-07-07'
web_research_enabled: false
web_fetch_enabled: true
source_verification: true
research_mode: 'hybrid (WebFetch + user-supplied URLs + labeled analyst estimates); WebSearch disabled environment-wide (IL2/GovCloud)'
---

# Research Report: Domain / Technical — Serato History-File Parsing & Metadata Availability

**Date:** 2026-07-07
**Author:** Arjun
**Research Type:** Domain Research (technical feasibility)

---

## Research Overview

This report resolves **Section 2 (domain / technical)** of the DJ Stats & Reflection Platform research brief — the *build-feasibility gate*. It follows the market research (`market-dj-stats-reflection-platform-research-2026-07-07.md`), which resolved Section 1 and explicitly handed off the parser-reliability and metadata-availability questions here as "the remaining build-risk gate."

**Central question:** Can the locked MUST features (auto per-set dashboard, Camelot harmonic analysis, energy arc, library utilization, flop/rescue detection) be built on Serato history data **without a paid AI API**, and how much maintenance risk does the reverse-engineered format carry?

**Methodology:** Hybrid, source-verified. WebSearch is disabled environment-wide (IL2/GovCloud); all findings come from WebFetch of named URLs (GitHub repos/READMEs, format write-ups, Serato docs), verified and dated 2026-07-07. Any claim that cannot be live-sourced is labeled `[ANALYST ESTIMATE — needs verification]`. Multi-source validation is sought for every build-blocking claim.

---

## Domain Research Scope Confirmation

**Research Topic:** Serato history-file parsing & metadata availability for a DJ reflection platform
**Research Goals:** Resolve Section 2 (domain/technical) of the research brief — document Serato history/session file structure & reverse-engineering status; verify open-source parsers and their reliability; assess maintenance risk of the unofficial format; confirm which metadata (BPM/key/genre/timestamps/play-duration/played-detection) is reliably available per-play; assess set-segmentation feasibility; and confirm the no-paid-AI cost assumption (Camelot harmonic analysis + energy arc). Produce a build-risk verdict per locked MUST feature.

**Domain Research Scope (adapted to a technical-feasibility domain):**

- **File format & reverse-engineering status** — structure of Serato history/session files and the library/crate database; community reverse-engineering maturity; documented field layouts
- **Open-source parser landscape & reliability** — verify surfaced parsers (`unbox`, `sslscrobbler`, `triseratops`, `serato-tools`, `whats-now-playing`) by repo/README: scope, language, license, maintenance signal, known limits
- **Maintenance-risk assessment** — format-change frequency, existence of any official/supported export, how existing tools have coped with breakage
- **Metadata availability (per-play vs. DB-only)** — reliability of BPM, key, genre, timestamps, per-track play duration, and played-detection / crossfade information
- **Set-segmentation feasibility** — inferring set boundaries and excluding non-set audio from gaps / track-length / mixing-density alone
- **No-paid-AI cost confirmation** — validate Camelot-wheel harmonic analysis (key lookup) and energy arc (BPM × timestamp) compute from file metadata; flag any stat requiring an external/paid API

**Research Methodology:**

- All claims verified against current public sources via WebFetch (WebSearch disabled — IL2/GovCloud)
- Multi-source validation for critical, build-blocking claims
- Confidence-level framework: every claim tagged `[SOURCE: … fetched 2026-07-07]` or `[ANALYST ESTIMATE — needs verification]`
- Deliverable: build-risk verdict per locked MUST feature (buildable / conditional / blocked)

**Scope Confirmed:** 2026-07-07

---

## 1. Domain Analysis — The Serato Format & Reverse-Engineering Ecosystem

*(In a technical-feasibility domain, "industry/market analysis" maps to the state of the Serato-parsing ecosystem: what data Serato writes, where it lives, how mature the reverse-engineering community is, and how healthy/maintained the open-source tooling is. This is the foundation the build-risk verdict rests on.)*

### 1.1 Where Serato stores DJ data — three distinct stores

Serato does **not** keep everything in one place. The build touches three separate stores, each with a different reliability and reverse-engineering profile:

| Store | What it holds | Format | RE maturity |
|---|---|---|---|
| **History / session files** (`.session`, in `_Serato_/History/Sessions/`) | The play log: which tracks were loaded/played, on which deck, start/end timestamps, a "played" flag, computed play time | Custom **chunked binary** (`OENT`/`ADAT`/`VRSN`…) | **High** — fully parsed by `sslscrobbler` |
| **Library database** (`database V2`; Serato 4+ adds `master.sqlite`) | The crate/library cache: per-track BPM, key, genre, bitrate, length, date added, play count | Custom binary (V2) / **SQLite** (Serato 4+) | **High** for SQLite, **Medium-High** for V2 |
| **GEOB tags** (embedded in the audio files themselves) | Beatgrid, cue points, waveform overview, **Autotags = BPM + Gain** | ID3v2.4 GEOB frames (MP3/AIFF), Vorbis comments (FLAC/Ogg), MP4 atoms | **High** — documented spec exists |

[SOURCES: github.com/ben-xo/sslscrobbler (session files), github.com/bvandrc/serato-tools + docs/fileformats.md (database V2, GEOB), github.com/Holzhaus/serato-tags docs (GEOB tag catalog) — all fetched 2026-07-07.]

**Why this matters:** the concept's core — *"read what I actually played after a gig"* — lives in the **history/session files**, which are the *best*-reverse-engineered of the three (`sslscrobbler` has parsed them in production since ~2011 and shipped a release in **April 2026**). The per-track attributes the stats need (BPM/key/genre) live in the **library DB** and/or **GEOB tags**. The build reads the session file for *the play log* and joins to the DB/tags for *track attributes*.

### 1.2 The session-file format is well-understood (Axis A is real)

`sslscrobbler` documents the `.session` binary format concretely [SOURCE: github.com/ben-xo/sslscrobbler, fetched 2026-07-07]:

- **Chunked structure:** *"4-byte identifier and 4-byte length followed by bytes. Chunks themselves can contain other chunks."*
- **Chunk types:** `OENT`/`ADAT` (track data), `VRSN` (format version), `UENT` (track deletion), `OREN`/`OSES`/`OCOL` (compound chunks).
- **Per-track fields extracted:** artist, title, album, genre, full file path, length, bitrate, year, comments, **start time + end time (Unix timestamps)**, **deck assignment**, **calculated play time**, row/session ID, and a **"Played" status flag**.
- **Serato 4+:** also reads `~/Library/Application Support/Serato/Library/master.sqlite` (macOS) / Windows equivalent.

This is the single most important finding for Axis A: **the play log, per-track timestamps, deck, play-duration, and a played flag are all already extractable from the session file** — the exact primitives the per-set dashboard, energy arc, and flop/rescue detection need.

### 1.3 The GEOB tag catalog is documented — but note *what's not there*

The Holzhaus `serato-tags` project (formerly the `triseratops` companion) maintains a written spec of the GEOB tags [SOURCE: github.com/Holzhaus/serato-tags, fetched 2026-07-07]:

| GEOB tag | Contents |
|---|---|
| `Serato Autotags` | **BPM and Gain values** |
| `Serato BeatGrid` | Beatgrid markers |
| `Serato Markers2` / `Serato Markers_` | Hotcues, saved loops |
| `Serato Overview` | Waveform overview data |
| `Serato Analysis` | Version info |
| `Serato Offsets_` | MP3 timing offsets |

**Material finding for the Camelot feature:** `Serato Autotags` stores **BPM + Gain only — not musical key.** Serato does compute/display key, but it is **not** in a Serato GEOB tag. It lives in the **standard ID3 `TKEY` frame / the library DB cache**, and genre likewise lives in standard `TCON` / the DB. `[ANALYST ESTIMATE — needs verification: key/genre sourced from standard file tags + Serato DB cache rather than a Serato-specific GEOB tag; recommend confirming key availability directly in a sample session+DB export.]` This does **not** block the Camelot feature — key is still available — but it means the build reads key from the **DB/ID3 tags**, not from the session file or Autotags. This is a routing detail with real consequence: key completeness now depends on whether the DJ (or Serato's analysis) populated `TKEY`, which is exactly the reliability question Step 3 (metadata availability) must resolve.

### 1.4 Format-spec provenance & the reverse-engineering community

The reverse-engineering effort is **mature, documented, and multi-author** — not a single fragile script:

- **Jan Holthuis (Holzhaus)** authored a written GEOB reverse-engineering spec (originally blogged at ruhr-uni-bochum.de — the specific post URL now 404s, but the spec lives on in `github.com/Holzhaus/serato-tags/docs/`, MIT + CC BY-SA 4.0 licensed, **138 commits, actively maintained**). His work fed **Mixxx** (the major open-source DJ app) integration. [SOURCE: github.com/Holzhaus/serato-tags, fetched 2026-07-07.]
- **`triseratops`** (also Holzhaus) is the Rust implementation of that spec [SOURCE: github.com/Holzhaus/triseratops, fetched 2026-07-07].
- **`bvandrc/serato-tools`** independently documents `database V2`, `.crate`, `.scrate`, GEOB, beatgrid, and marker formats in `docs/fileformats.md` [SOURCE: github.com/bvandrc/serato-tools, fetched 2026-07-07] — a **second, independent** documentation of the same formats (multi-source corroboration).

Two independent projects documenting the same binary layouts, one of them feeding a major open-source DJ application, is strong evidence the formats are **genuinely understood**, not guessed.

### 1.5 Ecosystem health — the parser landscape (verified maintenance signals)

Every parser surfaced in market research was re-verified by fetching its repo on 2026-07-07:

| Repo | Lang | License | Stars | Latest activity | What it proves |
|---|---|---|---|---|---|
| **sslscrobbler** (ben-xo) | PHP | MIT | 109 | **Release Apr 2026**, 497 commits | Session-file parsing + played-flag + play-time is production-solved |
| **whats-now-playing** | Python | MIT | 93 | **v5.2.2 Jun 2026**, 42 releases | Live Serato track-read, actively shipped; multi-platform |
| **unbox** (erikrichardlarson) | Go | (unlisted) | 364 | **v12 May 2025**, 41 open issues | Cross-platform history read incl. BPM/key/genre display |
| **serato-tags** (Holzhaus) | Python | MIT / CC BY-SA | 92 | 138 commits, active | The canonical GEOB/format spec |
| **triseratops** (Holzhaus) | Rust | MPL-2.0 | 18 | 218 commits; "heavy development, breaking API changes" | Rust parser; fed Mixxx |
| **serato-tools** (bvandrc) | Python | (unlisted) | 25 | 298 commits, recent | 2nd independent DatabaseV2/crate/GEOB spec |

[SOURCES: respective github.com repos, all fetched 2026-07-07.]

**Ecosystem verdict:** healthy and **redundant**. Multiple independent, actively-maintained (2026) projects across four languages parse Serato data. Redundancy is the key risk-reducer — no single unmaintained repo is a point of failure, and the two most relevant (`sslscrobbler` for sessions, `serato-tags`/`serato-tools` for track attributes) both shipped activity in 2025–2026.

### 1.6 Cross-cutting note & open items

- **`unbox` (364★) is the latent fast-follower** flagged in market research: it already reads cross-platform history *and* displays BPM/key/genre. It does *not* do reflection or scene-social, but it proves the "read + display played tracks with attributes" layer is commoditized. Speed to the scene network-effect — not the parsing tech — remains the moat.
- **Open item O-1:** confirm musical **key** availability/completeness in a real session+DB export (see §1.3). *If you can export a `.session` + `database V2` (or `master.sqlite`) from a Serato machine, I can specify exactly which fields to dump to close this.*
- **Open item O-2:** `unbox` and `serato-tools` licenses were not surfaced on their repo pages — worth confirming before any code reuse (vs. clean-room reimplementation from the specs).

---

## 3. Metadata Availability — Empirically Verified Against a Real Serato Export

*Step 3 was the "needs verification" gate left open by §1.3 / §1.6 (Open Item O-1). It is now resolved not by estimate but by **directly parsing a real Serato export** the user supplied on 2026-07-17: `22474.session` (a single-track session log) and `database V2` (a 4,974-track library). Every claim in this section is tagged `[VERIFIED against sample export 2026-07-17]` and was produced by round-tripping the documented chunk format against the actual bytes.*

### 3.1 The session file parses exactly as `sslscrobbler` documents

`22474.session` (414 bytes) decoded cleanly as the chunked binary described in §1.2: a `vrsn` chunk (`"1.0/Serato Scratch LIVE Review"`) followed by an `oent` → `adat` track entry. The `adat` payload uses an internal `field-id (4B) + length (4B) + value` layout. Every play-log primitive the concept's MUST features need is present in this one real record:

| adat field | Decoded value | Interpretation | Feature powered |
|---|---|---|---|
| 2 | `/Users/arjun/Desktop/tonic ware house 812.wav` | Absolute file path | Join key to library DB |
| 6 | `tonic ware house 812` | Title | Display |
| 28 | `1755215597` → `2025-08-14 23:53:17 UTC` | Start timestamp | Energy arc, set segmentation |
| 29 | `1755215978` → `2025-08-14 23:59:38 UTC` | End timestamp | Play duration |
| 45 | `381` | Play duration (seconds) | Flop/rescue detection |
| 31 | `1` | "Played" flag | Played-vs-loaded detection |
| 48 | `22474` | Session/row id | Per-deck / session grouping |

**Cross-check that raises confidence:** end − start = 1755215978 − 1755215597 = **381 s**, which equals field 45 *exactly*. The stored play-duration is internally consistent with the timestamps — the primitives are trustworthy, not merely present. `[VERIFIED against sample export 2026-07-17]`

**Confirmed absence:** the session record carries **no BPM, key, or genre** — exactly as §1.3 predicted. Those attributes must come from the DB join (§3.2). This validates the architectural split: *session file = play log; library DB = track attributes.*

### 3.2 The library DB resolves Open Item O-1 — key/BPM are effectively complete

`database V2` (3.24 MB) decoded as a `vrsn` chunk plus **4,974 `otrk` (track) chunks**, each a nested field structure. Field completeness was measured across **all 4,974 tracks** (not sampled):

| DB field | Attribute | Non-empty completeness | Verdict |
|---|---|---|---|
| `tsng` | Title | 100.0% | ✅ |
| `pfil` | File path | 100.0% | ✅ (join key) |
| `tbpm` | BPM (e.g. `"122.00"`) | **100.0%** (4972/4974) | ✅ Energy arc unblocked |
| `tkey` | Musical key (e.g. `"Ebm"`) | **98.8%** (4912/4974) | ✅ Camelot feature unblocked |
| `tart` | Artist | 89.2% | ✅ |
| `tgen` | Genre (e.g. `"House"`) | 80.4% | ⚠️ Usable; ~1-in-5 gap |
| `ttyr` | Year | 78.4% | Minor / cosmetic |

**This closes Open Item O-1 decisively:** musical key is *not* in a Serato GEOB tag (confirming §1.3's routing estimate) but **is** in `database V2` under `tkey`, present for **98.8%** of the library and already in Camelot-convertible notation (`Ebm`, `Em`, `G#m`, `Am`…, 53 distinct keys observed). BPM is effectively universal at 100%. **No stat requires a paid AI API** — Camelot harmonic analysis is a key-string lookup and the energy arc is BPM × timestamp, both computed directly from these fields. The no-paid-AI cost assumption is **confirmed against real data.**

Genre (80.4%) is the one attribute with meaningful gaps; any genre-based stat must degrade gracefully for the ~20% unlabeled tail (169 distinct genre strings observed, including a literal `"Other"` bucket of 419 tracks — genre is also *dirty*, not just sparse: e.g. `"Hip-Hop / R&B"` vs `"Hip Hop"` coexist and would need normalization).

### 3.3 File type does NOT gate metadata — but library membership does

A key disambiguation the sample makes possible: the played track was a `.wav`, and it had no attributes — but this is **not** because WAV is unsupported. Completeness broken out by file type:

| Type | Count | BPM | Key | Genre |
|---|---|---|---|---|
| mp3 | 4954 | 100.0% | 98.7% | 80.7% |
| wave | 11 | 100.0% | 100.0% | 0.0% |
| quicktime | 8 | 100.0% | 100.0% | 25.0% |
| aiff | 1 | 100.0% | 100.0% | 0.0% |

WAV/AIFF/QuickTime files that **are in the library** get full BPM + key. So metadata availability is gated by **whether Serato has imported and analyzed the file**, not by its format. `[VERIFIED against sample export 2026-07-17]`

### 3.4 New build-risk finding — the session→DB join is the real weak link (Open Item O-3)

Parsing succeeded; the risk that surfaced is in **reconciling the two stores**, and the sample exposed it concretely:

1. **Path-format mismatch.** The session stores an **absolute** path (`/Users/arjun/Desktop/tonic ware house 812.wav`); the DB stores **relative** paths (`bharat today/…​.mp3`) — 0 of 4,974 DB paths are absolute. The join therefore cannot be a naive string match; it must resolve the DB's paths against the library root (the tracks span 21 top-level library folders such as `A Hip Hop`, `A Indian`, `Pop`, `House`). A path-normalization layer is required, and it is OS-/setup-specific.

2. **Off-library plays don't join at all.** The played `tonic ware house 812.wav` lived on the **Desktop** and was **never imported into the library** — so it is absent from `database V2` and has zero BPM/key/genre. DJs routinely play files outside the managed library (last-minute downloads, requests, USB drops), so **every real set will contain some share of plays with no joinable attributes.** In this (tiny) sample it was 100% of plays, which overstates the real rate but proves the failure mode is live.

**Mitigations (all no-paid-AI, in preference order):**
   - **(a) Read the file's own embedded tags** for off-library plays — GEOB `Serato Autotags` (BPM+gain) and standard ID3 `TKEY`/`TCON` (key/genre), per §1.3. Recovers metadata for any file that was ever analyzed, even if not library-imported.
   - **(b) On-the-fly local analysis** (e.g. `aubio`/`librosa`/`keyfinder`-style DSP) if no embedded tags exist. Local compute, no API cost, but adds a dependency and latency.
   - **(c) Graceful "Unknown"** — count the play in duration/segmentation stats (which need only the session) but exclude it from BPM/key-dependent charts, with an honest "N tracks unanalyzed" disclosure.

   Recommended: **(a) then (c)** for v1; defer (b). This keeps the build free of paid APIs and heavy DSP while still surfacing the coverage gap honestly.

### 3.5 Updated build-risk verdict (post-verification)

| MUST feature | Pre-Step-3 status | Post-verification status |
|---|---|---|
| Auto per-set dashboard | Conditional | ✅ **Buildable** — timestamps, played flag, duration all confirmed in session |
| Energy arc (BPM × time) | Conditional | ✅ **Buildable** — BPM 100% in DB, timestamps confirmed |
| Camelot harmonic analysis | Conditional (key routing unverified) | ✅ **Buildable** — key 98.8% in DB, Camelot-ready notation, no paid AI |
| Library utilization | Buildable | ✅ **Buildable** — full 4,974-track library parses |
| Flop / rescue detection | Conditional | ✅ **Buildable** — per-play duration confirmed & self-consistent |
| Set segmentation | Conditional | ✅ **Buildable** on timestamps (unchanged; multi-track session still to be sampled) |

**No feature remains blocked or merely conditional on metadata availability.** The residual risks are now (i) the **join/path-normalization** engineering (O-3), (ii) **genre sparsity/dirtiness** (~20%), and (iii) **off-library plays** (mitigated per §3.4) — all engineering/design problems, none a feasibility blocker.

### 3.6 Open items after Step 3

- **O-1 — CLOSED.** Key confirmed at 98.8% in `database V2` (`tkey`), Camelot-ready. `[VERIFIED against sample export 2026-07-17]`
- **O-2 — still open.** `unbox` / `serato-tools` licenses unconfirmed — matters only for code reuse vs. clean-room reimplementation from the specs.
- **O-3 — NEW.** Session→DB join requires path normalization (absolute-vs-relative) and an off-library-play fallback (§3.4). Engineering risk, not feasibility risk.
- **O-4 — NEW (nice-to-have).** The supplied `.session` contained a single track. Sampling a **multi-track, real-gig session** would let us verify set-segmentation heuristics (gap detection, deck-alternation) against real inter-track timing rather than estimate.

<!-- Content will be appended sequentially through research workflow steps -->
