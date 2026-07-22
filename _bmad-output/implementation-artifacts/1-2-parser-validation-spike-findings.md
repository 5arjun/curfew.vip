# Story 1.2 — Parser-Validation Spike Findings

**Status:** Spike complete. **Recommendation: GO** on both parsing paths, with one required fix (record deduplication) and one re-scoped assumption (see below) carried into Story 1.3.

Spike code: `agent/spike-1-2-parser-validation/` (throwaway, not a workspace member — see Task 6). Run with `cargo run --manifest-path agent/spike-1-2-parser-validation/Cargo.toml`.

---

## 1. Test targets used (Task 1)

| Target | AC-1 role | Notes |
|---|---|---|
| `~/Music/_Serato_/History/Sessions/2521.session` | Multi-track wedding session | **Not** `4905.session` — see §2 correction below |
| `~/Music/_Serato_/History/Sessions/19544.session` | USB-hosted-library + WAV-heavy session | Doubles as both AC-1 cases — see §2 |
| `/Volumes/ARJUN SSD/_Serato_/database V2` | USB-hosted library root | 4,972 tracks, distinct from local library |
| 11 real `.wav` files on `ARJUN SSD` | WAV embedded-tag readability | Full list in Task 1 checklist |
| `~/Library/Application Support/Serato/Library/master.sqlite` | Serato 4+ path | 489 sessions, 2021-07-08 → 2026-06-26 |

Corpus confirmed as documented in the story: 474 legacy `.session` files, legacy `database V2` (661,594 bytes), USB `database V2` (3,217,384 bytes), `master.sqlite` (48,840,704 bytes). Migration date (2025-12-11) confirmed exactly across `History/Sessions/` mtime, `history.database` mtime, and `DBV2-legacy.zip` mtime.

## 2. Correction to story assumptions (Task 1)

Two assumptions made at story-creation time did not hold once tested against real bytes:

**Wedding-candidate correction.** `4905.session` (553 KB, the largest file in the corpus) is **not** the 8.6-hour wedding session AD-17 describes. Its own file header identifies it as a **"Serato Scratch LIVE Review"** file — a rapid track-preview/culling session: 865 log entries compressed into a real elapsed span of only **28 minutes** (2022-02-05, 11:26:38–11:54:10). `2521.session` (174,816 bytes — the 4th-largest file, previously not the leading candidate on size alone) is the real match: **8.60-hour** span (2021-10-30, 15:18:57–23:54:43), a 144-minute non-dancefloor gap early in the session, then sustained evening play ending on a track literally titled *"Its My Party"*. Confirmed independently against `master.sqlite` session 72 (same start/end timestamps, same track order — see §4). **Lesson for Story 1.3/1.9's fixture selection: file size is a weak proxy for "real multi-block gig"; elapsed real-world time span (derived from parsed timestamps) is the reliable signal.**

**WAV-play correction.** The story assumed **zero** local sessions ever played one of the 11 real WAV files on the SSD ("no real WAV-heavy played session exists"). A working decode of all 474 local `.session` files found **95 sessions with at least one real `.wav` play**, including verbatim absolute-path references to the SSD's own WAV files (e.g. `/Volumes/ARJUN SSD/A Indian/Vidhi/Shenai.wav` appears in `22119.session` and `23210.session`). `19544.session` is the WAV-heaviest real session (14 WAV plays / 116 total). **Lesson: a genuine WAV-heavy played-session fixture exists and should be used in Story 1.3/1.9's test suite, not just standalone `id3` reads against unplayed files.**

## 3. Legacy `.session` binary format — confirmed structure

Reverse-engineered from this spike's own hex-dump analysis (clean-room; see Dev Notes → Clean-room discipline in the story — no code ported from any existing parser).

- **Outer envelope** (confirms the Mixxx-documented hypothesis): 4-byte ASCII tag + 4-byte big-endian `u32` length + payload. Each play is one `oent` record; inside it, one `adat` record holds the fields.
- **Inner fields** (new finding, not in any public documentation consulted): fields inside `adat` are **not** ASCII-tagged. Each is a 4-byte big-endian `u32` **numeric** field ID + 4-byte BE `u32` length + payload. Text payloads are UTF-16BE, NUL-terminated.
- **Field ID map** (confirmed against real tracks with known artist/title/BPM/key):

  | ID | Meaning | Confidence |
  |---|---|---|
  | 1 | history row ID (sequential per session) | High — used for dedup, see §5 |
  | 2 | absolute file path (track identity) | High |
  | 6 | title | High |
  | 7 | artist | High |
  | 8 | label | High |
  | 9 | genre | High |
  | 17 | grouping (freeform tag list) | Medium |
  | 23 | year | High |
  | 28 | start_time (Unix epoch, UTC) | High — cross-validated against file mtime and `master.sqlite` |
  | 31 | deck (observed values: 1, 2) | High |
  | 45 | played duration, seconds | High — cross-validated against inter-play gaps |
  | 50 | "played" flag | Low — always `1` even on `4905.session`'s rapid-preview entries; does not discriminate a full play from a preview |
  | 51 | key (Camelot notation, e.g. `"1A"`) | High |
  | 15 | candidate: BPM (integer) | Low — plausible values observed (0, 125) but not independently cross-validated |
  | 29, 53 | candidate: end/modified time | Low — 29 often equals the *next* entry's field 28 (a continuous per-deck timeline), not necessarily "when the track finished playing" |
  | 39, 48, 52, 63, 68, 69, 70, 72, 78 | not decoded with confidence | — field 63 looked like a device/app-name string (`"Offline Player"`) in samples; field 48 was constant across all rows in a session (plausibly a session-id echo) |

This is enough to satisfy AC-1's "play counts + track identities" requirement (path + artist + title are solid); the low-confidence fields are exactly the kind of open item a spike should surface rather than guess at.

## 4. Ground-truth validation (Task 4)

`master.sqlite`'s `history_session`/`history_entry` tables hold a full migrated copy of the DJ's **entire** history back to 2021-07-08 (confirmed in Task 1) — not just data since the 2025-12-11 migration. This let the spike cross-validate its own from-scratch legacy-binary parser directly against Serato's own independently-migrated database for the same real gigs, which is a stronger ground truth than manual recall for events 2–5 years old. Three real sessions were cross-checked this way:

| Legacy file | Real date | `master.sqlite` session | Timestamps match? | Track order/names match? | Play count match? |
|---|---|---|---|---|---|
| `2521.session` | 2021-10-30 | id 72 | Yes, exactly (UTC↔local conversion confirmed) | Yes, exactly, in order | **No — see §5** |
| `19544.session` | 2024-06-30 | id 400 | Yes, exactly | Yes, exactly, in order | Yes — 116 = 116 |
| `11627.session` | 2022-08-20 | id 239 | Yes, exactly | (not individually spot-checked) | **No — see §5** |

No live comparison against Serato's in-app History UI was performed (no interactive Serato session available in this environment); `master.sqlite` is itself the data source that UI reads from, so this is treated as an acceptable substitute for a spike. Flagged for Arjun to spot-check visually if desired — not a blocker for the go/no-go.

## 5. Discrepancies (Task 4 — every discrepancy classified)

### D1 — Duplicate `oent` records inflate raw play counts (parser-fixable)

`2521.session`: 302 raw `oent` records parsed, but `master.sqlite` session 72 shows **151** plays for the same gig. `11627.session`: 506 raw vs. **253** in `master.sqlite` session 239. In both cases every field-1 (history row ID) value appears **exactly twice**, and the two copies are **byte-for-byte identical** (same row ID, same timestamps, same everything) — this is the literal file containing each record twice, not two distinct real events that happen to share fields.

`19544.session` shows **no** duplication (116 raw = 116 distinct row IDs = 116 in `master.sqlite`). `4905.session` (the rejected Scratch-LIVE-Review file) also shows no duplication (865 raw = 865 distinct row IDs). The trigger for when a session gets double-written wasn't conclusively isolated in the time available for a spike — it doesn't correlate cleanly with file size or date. **Classification: parser-fixable.** Story 1.3's production parser must deduplicate `oent` records by field-1 row ID before computing play counts; a naive "count `oent` tags" implementation will silently double-count roughly half the corpus's sessions.

### D2 — WAV filename with malformed on-disk Unicode (format-limitation)

One of the 11 real WAV files on the SSD (`Club/ABBA - GIMME GIMME GIMME (...).wav`) has a filename containing a genuinely malformed byte sequence at the filesystem level: `"A"` + U+0303 (COMBINING TILDE) + **U+0084** (a C1 control character) + `"T"` — confirmed via `os.listdir()`, not a copy/paste artifact. This is very likely a botched charset conversion from whenever the file was copied/renamed (possibly a Windows CP-1252 byte misread as UTF-8, or similar). The `id3` crate itself handled this fine once the spike's own hardcoded path literal was corrected to match the exact bytes — the initial "error" was a spike-code bug (wrong literal), not an `id3`/filesystem-handling gap. **Classification: format-limitation** (a real-world data quality issue Story 1.3/1.5 must tolerate gracefully — Result-returning path handling, never assuming valid Unicode in a filename — not something a parser can "fix").

### D3 — Off-library plays are common and expected (format-limitation, corroborates existing roadmap)

Wedding session (`2521.session`): **0 of 302** plays resolved against the local `triseratops` library index — all 302 distinct-path tracks live in `/Users/arjun/Downloads/Unlabeled Music!!!/`, a folder confirmed **deleted from disk** sometime after 2021 (files were never in a crate index and no longer exist to enrich even via direct `id3` read). USB session (`19544.session`): plays from `/Volumes/ARJUN SSD/Theo Indian/...` and `/Volumes/ARJUN SSD/JP Indian/...` resolved **0 of 116** against the USB library's own 4,972-track crate index — the files are real and present on disk (confirmed via direct `id3` read, 5/5 succeeded with real title/artist recovered) but were evidently played straight from Finder without ever being added to Serato's library. **Classification: format-limitation, and expected.** This directly corroborates Story 1.5's existing design ("off-library embedded-tag fallback with visible unknown") — the architecture already planned for exactly this case. New for the go/no-go: off-library is not an edge case in this DJ's real usage, it's routine (100% of two real target sessions), so Story 1.5's fallback path is load-bearing, not a rare-case safety net.

### D4 — `database V2` path format requires a join-time transform (parser-fixable, already solved)

Both the local and USB `database V2` files store file paths **root-relative, without a leading `/`** (e.g. `Users/arjun/Music/...`), while `.session` play-log paths are fully absolute POSIX (`/Users/arjun/Music/...`). A direct `HashMap` lookup by absolute path against `triseratops::Library` always misses. **Classification: parser-fixable** — solved in this spike by stripping the leading `/` before lookup (`library::resolve()` in `src/library.rs`); trivial to carry into Story 1.3/1.4.

## 6. Path comparison: legacy `.session` vs. Serato 4+ `master.sqlite`

The story's Dev Notes flagged this as an open question; the spike confirms the risk ordering should invert:

- **Legacy path**: required full clean-room reverse-engineering of an undocumented binary envelope (two nested tag/length layers, one ASCII-tagged and one numeric-ID-tagged — the numeric-ID layer was not documented anywhere consulted). ~180 lines of parsing code, several hours of hex-dump-driven investigation, and still leaves ~9 fields undecoded with confidence.
- **Serato 4+ path**: ~60 lines of plain SQL via `rusqlite`, zero binary decoding, richer denormalized data per play (artist/name/bpm/key/genre/deck/device/app_name all present directly on `history_entry`, no join needed).
- This machine's own data shows `master.sqlite` is not a secondary/parity format — it holds **the DJ's entire history** (2021–2026, 489 sessions) after the 2025-12-11 engine migration, including every session the legacy corpus has. For a DJ on Serato 4+, the legacy path is now purely historical/read-once, not the live system.

**Recommendation for Story 1.3's prioritization** (Story 1.3's call, not decided here, per the story's own scoping): build `master.sqlite` support first — it's lower-risk, lower-effort, and covers more of this DJ's real timeline. Scope the legacy clean-room `.session` parser as the harder, lower-priority-if-few-DJs-are-still-on-that-engine-version path. **Caveat, explicitly flagged**: this is an n=1 finding (one DJ's one machine). Whether `master.sqlite`'s schema/location is stable across Serato 4+ installs, and how common this engine version is across Curfew's target DJ population, is unknown and worth checking against a second real install before fully committing the prioritization.

## 7. Go/No-Go

**GO on both paths**, carried into Story 1.3 with these concrete requirements:

1. **Legacy `.session` parser**: build on this spike's confirmed envelope (§3), but add record deduplication by field-1 row ID (§5, D1) — this is not optional, roughly half the real corpus would otherwise report double play counts.
2. **Serato 4+ `master.sqlite` path**: build on this spike's confirmed schema (§3/§6) — lower effort, lower risk, and per §6's recommendation, worth prioritizing first.
3. **Off-library handling (Story 1.5) is load-bearing, not a rare-case fallback** — 100% off-library on both real target sessions tested (§5, D3).
4. **Path-join transform** (§5, D4) is a one-line fix, carry it forward.
5. Filenames/paths are not guaranteed valid Unicode in the real world (§5, D2) — production code must use `Result`-returning, non-panicking path/string handling throughout (consistent with 1.1's code-review finding on `load_sync_payload_schema`, noted in this story's Dev Notes).

## 8. Inputs for Story 1.10's `shared/` contract shape

Per-field reliability, both formats (for `SyncPlayDraft`-shaped data in `shared/src/index.ts`):

| Field | Legacy `.session` | `master.sqlite` |
|---|---|---|
| Track path | Reliable (field 2) | N/A — no path column; joins via `location_id`/`asset_id` FK into `location`/`asset` tables (not explored in this spike — flag for Story 1.4) |
| Artist / title | Reliable (fields 6/7) | Reliable, denormalized directly on `history_entry` |
| BPM / key / genre | Key reliable (field 51); BPM low-confidence (field 15); genre reliable (field 9) | All reliable, denormalized directly on `history_entry` — **richer than the legacy join ever produces**, no separate library join needed |
| Timestamp (play start) | Reliable (field 28, Unix epoch UTC) | Reliable (`start_time`, Unix epoch **UTC** — confirmed via local-time cross-check, see Task 1) |
| Ordinal position | Reliable — file order is chronological (confirmed on every session inspected) | Reliable — `ORDER BY start_time` |
| Deck | Reliable (field 31) | Reliable (`deck`, text column) |
| Duplicate-record risk | **Present, session-dependent** (§5, D1) — contract/ingest layer must dedupe or the parser must guarantee dedup before handoff | Not applicable — `master.sqlite` already reflects deduplicated canonical history |

**Implication for the contract**: `SyncPlayDraft` should not assume 1:1 between "raw parser records" and "real plays" for the legacy path — either the parser guarantees dedup before producing `SyncPlayDraft`s (recommended — keeps the contract format-agnostic) or the contract needs a way to represent pre-dedup ambiguity (not recommended — adds complexity Story 1.10 shouldn't need to carry). Recommend the former: dedup is a legacy-parser-internal concern, invisible to `shared/`.

Given `master.sqlite`'s richer per-play denormalized metadata (BPM/key/genre with no join), Story 1.4/1.5's enrichment logic may simplify significantly for DJs on this engine — worth scoping explicitly when those stories are created.

## 9. Sample spike output

Full annotated run (both parsing paths, both library roots, both embedded-tag cases) is reproducible via:

```
cargo run --manifest-path agent/spike-1-2-parser-validation/Cargo.toml
```

Representative excerpt (wedding fixture):

```
=== Legacy .session: wedding fixture (corrected from 4905.session) (.../2521.session) ===
play count: 302
elapsed span: 8.60h
sample track identities (first 5):
  [0] artist=None title=Some("Lady Gaga - Replay (Audio)") path=Some(".../Lady Gaga - Replay (Audio).mp3")
  ...
in-library: 0 / 302 plays resolved against local database V2
off-library distinct paths: 280

=== Serato 4+ path: master.sqlite via rusqlite ===
  session 489 name=Some("6/26/26") start_time(epoch)=1782511038
    play count: 75
    [sample] artist="Amit Gupta" name="Radhe Radhe - SongsMp3.Cool" genre="Bollywood" bpm=Some(69.99) key="Fm" deck="1"
```

## 10. Contract boundary

`shared/src/index.ts` and `shared/schema/sync-payload.schema.json` were not modified by this story. This findings doc is the durable input Story 1.10 will read when it freezes the contract.
