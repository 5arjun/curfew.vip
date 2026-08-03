# Serato Capture Completeness — field-map plan

> **Purpose (Arjun, 2026-08-03):** stop discovering missing fields one story at a time (key → Story 3.6; duration + date-added → Story 3.7). Enumerate *everything* Serato exposes per play/track, map it source → `EnrichedPlay` (agent-internal) → `SyncPlay`/`SyncSetDerived` (frozen wire) → consumer, and make each field a **conscious** capture/skip decision.
>
> **Governing principle:** `EnrichedPlay` is **internal to the agent → capture comprehensively** (cheap in one joiner pass; retained-raw backfill exists if we add more later, but re-deriving is work, so read generously now). `SyncPlay` / `SyncSetDerived` are the **frozen wire contract → consumer-gated, additive-only (AR-1/AR-15)** — promote a field to the wire only when a story renders it.

## Sources

- **Serato 4+ (Arjun's library): `master.sqlite`** — `history_entry` (play log) joined to `asset`/library for metadata. Current joiner: `agent/src-tauri/src/joiner/serato4.rs` (SELECT `id, bpm, key_value, "key", genre`, ORDER BY `start_time`).
- **Legacy `.session` binary** (`_Serato_/History/Sessions/`, OENT/ADAT chunks; parsed like `sslscrobbler`) — per domain research carries the richest per-play set. `agent/src-tauri/src/joiner/legacy.rs`.
- Domain research (fields verified against a real export): `_bmad-output/planning-artifacts/research/domain-serato-history-file-parsing-metadata-research-2026-07-07.md`.

## Field map

| Field | Serato source (verified?) | `EnrichedPlay` now | Wire now | Consumer | Decision |
|---|---|---|---|---|---|
| title | play log | ✅ | ✅ `SyncPlay.title` | tracklist, most-played | shipped |
| artist | play log | ✅ | ✅ | tracklist, most-played artists | shipped |
| genre (raw+normalized) | library/embedded | ✅ | ✅ | genre stats, tracklist | shipped |
| subgenre | taxonomy v2 | ✅ | ✅ `genre.subgenre?` | genre overlay toggle (3.7) | shipped |
| bpm | library/play | ✅ | ✅ | BPM stats, arc, tracklist | shipped |
| key (Camelot) | `key_value` INT (✅ 24/24, Story 3.6) | ✅ | ✅ `camelot_key` | harmonic, in-key connectors | shipped (3.6 fix) |
| start_time | play log (✅) | ✅ | ✅ `started_at` | ordering, arc, timestamps | shipped |
| path | play log | ✅ (internal) | ❌ by design (leaks local FS) | dedup only | shipped |
| in_library | join | (join) | ✅ | new-tracks exclusion, off-library marker | shipped |
| **end_time / played-duration (s)** | play log — **✅ verified** (`end−start == dur`, 381s; "Played" flag) | ❌ | ❌ | **per-row played-length (Q3), Longest/Shortest Play** | **CAPTURE now (3.7)** → `EnrichedPlay.played_ms` + `ended_at`; promote `played_ms` to wire |
| **library date-added** | **`database V2` `tadd` by path (~94%)** — NOT serato4 `asset` (4.6% join, tracks on USB) | ❌ | ❌ | **New tracks played (3.7)** | **CAPTURE now (3.7)** via `portable_id`→`database V2` `tadd`; promote to wire; disclose non-covered |
| "Played" flag | play log (✅) | partial (play-log semantics) | — | filter previews from played stats | **CAPTURE into EnrichedPlay**; verify honored; no wire field needed |
| track total length (full song) | library/play | ❌ | ❌ | context ("played 4:12 of 6:30") | read into EnrichedPlay (cheap); promote when a story shows it |
| deck assignment | play log (✅) | ❌ | ❌ | true overlap/transition + mix analysis | read into EnrichedPlay; wire later (energy-arc/mix story) |
| album | library | ❌ | ❌ | none yet | skip until consumer |
| year | library | ❌ | ❌ | none yet | skip |
| bitrate | library | ❌ | ❌ | none yet | skip |
| comments | library | ❌ | ❌ | none yet | skip |
| row/session id | play log | ✅ (session identity) | ✅ (set identity) | idempotency, delete tombstone | shipped |

## ✅ Verification results (2026-08-03, live `~/Library/Application Support/Serato/Library/master.sqlite`, 23,259 plays)

Confirmed column names on serato4 `history_entry`: `start_time`, **`end_time`** (INTEGER, `-1`=unset), **`played`** (bool), **`deck`** (TEXT), `length_sec`/`length_ms` (full-song total), `time_added` (**NOT the library add-date — was `-1`; it's the row's own field, useless**), `portable_id` (**full file path, 100% populated**), `asset_id`, `location_id`, `bpm`, `key`, `key_value`, `genre`.

- **Played duration = `end_time − start_time`** — `end_time` populated **98%** (22,795/23,259). No precomputed duration column (unlike legacy `.session` field 45), but both timestamps present. ✅
- **`played` flag** — 75% played=1 → 25% are loaded-but-not-played previews; **filter on it.** ✅
- **`deck`** present. ✅ **`portable_id`** (full path) 100%. ✅
- **Library date-added — NOT via serato4 `asset`.** `history_entry→asset` join is only **4.6%** (asset_id 1080, location_id 1134, portable_id 1108, all ~4.6-4.9%) — because the tracks live on the **Samsung USB**, not the laptop `asset` table. `history_entry.time_added` is `-1`. ⚠️
  - **Reliable date-added path:** `play.portable_id` (full path) → **`database V2` `tadd`** (the USB's `/Volumes/Samsung USB/_Serato_/database V2`, 3.2 MB; and/or `~/Music/_Serato_/database V2`). Epic 1 measured `tadd` ~94% there. The agent already parses `database V2` (legacy/triseratops). So **"New tracks played" reads date-added from `database V2` by path, NOT from `asset`.**
  - Coverage ceiling ~94%; tracks missing from `database V2` (or off-USB) → excluded + disclosed. `asset.time_added` itself is real (20,408 tracks, 2020-2026 spread) — it's the *play→asset linkage* that fails.

## Action items

1. ~~Verify columns~~ **DONE (2026-08-03, above).** Verdict: played-duration + played-flag + deck solid on serato4; **date-added requires the `database V2` `tadd`-by-path lookup, not the `asset` join.**
2. **Capture (Story 3.7 agent task):** add `played_ms` (+ `ended_at`, from `end_time`; fall back to next-play-start or set-end when `end_time=-1`) and `library_added_at` (from `database V2` `tadd`, joined by `portable_id` path) to `EnrichedPlay`; also read total-length, `deck`, `played` flag into `EnrichedPlay` while in the joiner. Honor `played` so previews don't count. Note: date-added needs the `database V2` reader wired into the serato4 enrichment path (currently separate) — small cross-path task.
3. **Contract (additive):** promote `played_ms` and `library_added_at` to `SyncPlay` (AR-15 additive-only, `agent_version` bump; contract tests in `shared/`).
4. **Backfill:** re-derive the 491 local sets through the retained-raw mechanism (same as the 3.6 Camelot fix). Idempotent, no data loss.
5. **Keep this table current:** any future field need updates this doc first (conscious inventory), then the contract.

## Notes / risks

- Legacy vs serato4 parity: the legacy `.session` path (`legacy.rs`) should capture the same new fields where present, but Arjun's library is serato4 — prioritize serato4, sanity-check legacy.
- Additive-only discipline: never mutate/remove a frozen wire field; new fields optional per AD-15. `EnrichedPlay` is free to change (internal).
- "Played" flag semantics: Serato counts a track played only after crossfade+fader action — this is what makes Shortest Play meaningful (a real short play, not a 2s preview).
