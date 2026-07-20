# Reconciliation: Domain Research vs. PRD + Addendum

**Input reconciled:** `_bmad-output/planning-artifacts/research/domain-serato-history-file-parsing-metadata-research-2026-07-07.md`
**Against:** `prd.md` + `addendum.md` in `prd-name-pending-2026-07-19/`
**Purpose:** This research was already used heavily to ground FR-1/FR-2 and the addendum's technical sections (path-join, format-drift, no-paid-AI, off-library fallback are all well-carried). This document catalogs what *specific field-coverage data, parsing risks, or technical caveats* from the research still aren't reflected anywhere in the PRD or addendum — the residue a downstream architecture reader would otherwise have to re-derive by re-reading the raw research. Eight gaps found (six material, two minor/housekeeping); none block the PRD, all are addendum/architecture-stage additions.

---

## Gap 1 (Material) — Field-coverage percentages are nowhere in the PRD/addendum

The research's headline empirical result (§3.2, measured across all 4,974 tracks, not sampled) is a field-completeness table:

| DB field | Attribute | Completeness |
|---|---|---|
| `tbpm` | BPM | 100.0% (4972/4974) |
| `tkey` | Musical key | **98.8%** (4912/4974) |
| `tart` | Artist | **89.2%** |
| `tgen` | Genre | **80.4%** |
| `ttyr` | Year | 78.4% |

None of these numbers appear in `prd.md` or `addendum.md`. FR-2 (track-level enrichment), FR-6 (per-set summary incl. "most played tracks/artists" and key/Camelot stats), FR-8 (genre normalization), and FR-9 (key-usage trend patterns) all consume these fields, but the PRD's language is qualitative only ("agent resolves BPM/key/genre," "if neither source has data, track displays as Unknown") with no sense of *how often* that Unknown path actually fires. An architect sizing the "Unknown" UX (SM-C1's counter-metric — "Unknown rate must stay honestly visible") has no baseline rate to design against: key gaps are small (~1.2%) but genre gaps are large (~1-in-5), and that asymmetry matters for how prominently each Unknown state needs to surface.

**Recommendation:** Carry the field-coverage table (or at minimum the tkey/tbpm/tgen/tart percentages) into the addendum, likely alongside the existing "Path-Join Complexity" section, since it's the same kind of downstream-parser-relevant technical detail.

## Gap 2 (Material) — Genre dirtiness scale is understated

FR-8 (genre normalization) and the PRD's §4.2 description both reference the qualitative problem ("raw genre tags... fragmented taxonomy e.g. 'Hip-Hop / R&B' vs 'Hip Hop'"), which *is* correctly sourced from the research's §3.2 note. But the research also quantifies the scale of the problem, and none of that quantification carried over:

- **169 distinct genre strings observed** across the library.
- A literal **"Other" catch-all bucket of 419 tracks** (~8.4% of the library) — i.e., a meaningful share of tracks are already dumped into a non-informative bucket by Serato/the DJ, before normalization even starts.
- Genre is present for only 80.4% of tracks to begin with (Gap 1), so normalization has to operate on top of an already-incomplete field.

This matters for scoping FR-8: "map raw tags to a normalized taxonomy" reads as a small lookup-table problem in the PRD, but the research implies a three-layered problem (missing ~20%, dirty/inconsistent for an unknown share of the remaining 80%, and a non-trivial "Other" bucket that normalization can't fix because it's not a granular tag). Worth a line in FR-8's Consequences or the addendum about designing the mapping table to explicitly handle an "Other"/unmapped tail rather than assuming full coverage.

## Gap 3 (Material) — Artist field completeness (89.2%) has no fallback treatment

FR-6 promises "most played tracks/artists" as a per-set stat. The research shows `tart` (artist) is only 89.2% complete — a bigger gap than key (98.8%) and comparable in scale to genre. Genre gets an explicit degrade-gracefully treatment (FR-8's normalization + the PRD's general "Unknown" pattern from FR-2); key gets FR-2's Unknown-display consequence. Artist gets neither — there's no PRD language addressing what a "most played artists" ranking does when ~11% of tracks have no artist string (omit from the ranking silently? bucket as "Unknown Artist"? both have UX implications given SM-C1's "don't suppress Unknown rate" principle).

**Recommendation:** Either explicitly fold artist into FR-2's existing "Unknown" consequence (it likely already applies mechanically, since FR-2 covers BPM/key/genre resolution generically) or add a one-line Consequence to FR-6 confirming the same Unknown-display treatment applies to artist-based stats.

## Gap 4 (Risk caveat, addendum-specific) — `triseratops` crate's own maintenance risk isn't carried into the addendum's dependency choice

The addendum's Local Agent section commits to a specific dependency: *"the `triseratops` crate (Rust, MPL-2.0) for library DB/GEOB tags."* The research's own parser-landscape table (§1.5) flags this exact crate's maintenance signal as:

> `triseratops` (Holzhaus) | Rust | MPL-2.0 | 18★ | **218 commits; "heavy development, breaking API changes"** | Rust parser; fed Mixxx

This is a distinct risk from "Serato's file format changing" (which the addendum's Format-Drift Mitigation section does address, via golden-file CI tests + signed auto-updater). The risk here is that the *parsing library itself* is explicitly documented (by the research that recommended it) as being under heavy development with breaking API changes — meaning a `cargo update` could break the build/parse logic independent of any Serato-side format change. Nothing in the addendum's Format-Drift Mitigation section (or elsewhere) addresses dependency-pinning or version-locking `triseratops`, even though this is the exact kind of caveat that section exists to capture.

**Recommendation:** Add a line to the addendum's Format-Drift Mitigation (or Local Agent) section noting `triseratops` should be version-pinned and its upgrades treated as a change requiring the same golden-file regression pass as a Serato format change — not auto-upgraded.

## Gap 5 (Material) — Genre completeness collapses by file type, even for in-library tracks; BPM/key don't

The research's §3.3 file-type breakdown shows BPM and key stay ~100% complete regardless of format, but **genre does not**:

| Type | Count | BPM | Key | Genre |
|---|---|---|---|---|
| mp3 | 4954 | 100.0% | 98.7% | 80.7% |
| wave | 11 | 100.0% | 100.0% | **0.0%** |
| quicktime | 8 | 100.0% | 100.0% | **25.0%** |
| aiff | 1 | 100.0% | 100.0% | **0.0%** |

The played `.wav` in the sample had no metadata at all only because it was never imported into the library (import-status is what the PRD/addendum's `in-library / off-library` glossary entry and FR-2 correctly capture) — but the table shows a *second*, independent gap: even WAV/AIFF/QuickTime tracks that **are** in-library get essentially no genre data, while MP3 gets 80.7%. This is a real risk to FR-6 (genre breakdown) and FR-24 (network "genre diversity" leaderboard) for any DJ whose sets lean WAV/AIFF (common for edits, acapellas, high-fidelity drops) — their genre stats will look sparse for reasons unrelated to off-library status or the taxonomy-dirtiness problem FR-8 already addresses. Nothing in the PRD/addendum surfaces this format-dependent genre skew.

**Recommendation:** Note in FR-6 or FR-8 that genre "Unknown" rate should be expected to skew by file type (near-total for WAV/AIFF) independent of library-import status, so the honest-disclosure UX (SM-C1) doesn't read as a bug when a WAV-heavy DJ's genre chart is mostly gaps.

## Gap 6 (Material) — WAV embedded-tag fallback (FR-2's actual real-world case) is unverified

FR-2 states the off-library fallback as settled behavior: *"agent falls back to embedded file tags (Serato Autotags GEOB for BPM, ID3 `TKEY`/`TCON` or Vorbis comments for key/genre)."* But the research's own format table (§1.1) only confirms embedded-tag carriers for three format families — *"ID3v2.4 GEOB frames (MP3/AIFF), Vorbis comments (FLAC/Ogg), MP4 atoms"* — and **WAV is not listed as a confirmed carrier anywhere in the research**. This is not a hypothetical edge case: the one concrete off-library play the sample export actually surfaced (§3.1–§3.4) was exactly a `.wav` file, and the research never tested whether that file carried readable embedded tags — it only established the track wasn't in the library DB. FR-2's fallback path is therefore unverified for precisely the file type the sample data flagged as the real-world failure mode, and WAV is a routine DJ format, not a rare one.

**Recommendation:** Add as an open technical-validation item (parallel to the existing multi-track-session gate) — confirm ID3/GEOB tag readability on real WAV files before relying on FR-2's fallback in production. If WAV doesn't reliably carry these tags, off-library WAV plays fall straight to "Unknown" at a materially higher rate than the fallback design implies.

## Gap 7 (Material) — Serato 4+ / `master.sqlite` dual-format requirement not addressed in the addendum's parser design

Research §1.1 explicitly splits the library-store format by Serato version: *"Custom binary (V2) / **SQLite** (Serato 4+)"*, rating RE maturity *"High for SQLite, Medium-High for V2"* — two structurally different formats depending on which Serato version a DJ runs. The addendum's Local Agent section only describes parsing `database V2` (via `triseratops` + the clean-room `.session` parser) and never mentions `master.sqlite` or any Serato-version branching. Since Curfew's install base will span DJs on varying Serato versions, this is a concrete architecture gap: scope should either explicitly exclude Serato 4+/`master.sqlite` from V1 (with a stated Open Question/Non-Goal), or the addendum should specify how that second format gets parsed.

**Recommendation:** Add to addendum's Local Agent section or PRD §11 Open Questions — confirm which Serato major versions V1 targets and whether `master.sqlite` support is in scope.

## Gap 8 (Minor, housekeeping) — Open Item O-2 (parser license uncertainty) is implicitly resolved but never stated as such

Research's Open Item O-2: *"`unbox` and `serato-tools` licenses were not surfaced on their repo pages — worth confirming before any code reuse (vs. clean-room reimplementation from the specs)."* The addendum's architecture choice — clean-room `.session` parser + `triseratops` (confirmed MPL-2.0) for DB/GEOB, `id3` crate for tags — sidesteps this by simply not depending on the two unlicensed repos (`unbox`, `serato-tools`). That's a reasonable resolution, but it's never stated as *deliberately* resolving O-2; a future reader (or Arjun re-reading this in six months) has no signal that this was a considered decision rather than an oversight. Worth a half-line note in the addendum's Local Agent section: "avoids `unbox`/`serato-tools` due to unconfirmed licensing (research O-2)."

---

## Non-gaps (verified as already well-covered, for completeness)

To avoid re-litigating what's already solid:
- Path-join complexity (absolute vs. relative paths, 0% absolute in DB) — addendum, verbatim-quality coverage.
- Off-library play rate caveat ("100% in sample, overstates real rate, proves failure mode is live") — addendum, direct quote carried over correctly.
- No-paid-AI / Camelot-as-lookup / energy-arc-as-arithmetic confirmation — PRD §5.3, correct.
- "Date added to library" field open item (O-1-adjacent, new in this research pass) — PRD Open Question 3, Assumptions Index, and addendum's dedicated "Open Item" section all track it correctly as unconfirmed.
- Multi-track/single-track sample limitation (O-4) and set-segmentation validation gate — PRD SM-1, SM-C1, Open Question 1, and multiple `[NOTE FOR PM]` tags all correctly carry this forward as the single biggest blocking gate.
- Format-drift mitigation (golden-file tests, signed auto-updater) — PRD §5.4 and addendum, correct.
- Genre normalization *qualitative* need (dirty taxonomy example) — FR-8, correctly sourced (see Gap 2 for the quantitative shortfall on top of this).
