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
| **end_time / played-duration (s)** | play log — **✅ verified** (`end−start == dur`, 381s; "Played" flag) | ✅ `played_ms` + `ended_at` | ✅ `SyncPlay.played_ms` | **per-row played-length (Q3), Longest/Shortest Play** | **shipped (3.7)** — `-1` fallback: next-play-start, else `history_session.end_time`; 105/105 on set 975 |
| **library date-added** | **`database V2` `tadd`/`uadd` by path (~94% when USB mounted)** — NOT serato4 `asset` (4.6% join, tracks on USB) | ✅ `library_added_at` | ✅ `SyncPlay.library_added_at` | **New tracks played (3.7)** | **shipped (3.7)** — `joiner/date_added.rs` loads every reachable catalogue (`~/Music` + `/Volumes/*`); coverage is drive-dependent (backfill carry-forward guard never regresses a stored date); disclosed in UI |
| "Played" flag | play log (✅) | ✅ `played` | — by design | filter previews from played stats | **shipped (3.7)** — `build_serato4` drops `played = 0` rows before positions/stats/durations (set 975: 178 → 105 rows); `NULL` (legacy) kept, never guessed false |
| track total length (full song) | library/play | ✅ `total_length_ms` (`length_ms`, else `length_sec`×1000) | ❌ | context ("played 4:12 of 6:30") | shipped into EnrichedPlay (3.7); promote when a story shows it |
| deck assignment | play log (✅) | ✅ `deck` | ❌ | true overlap/transition + mix analysis | shipped into EnrichedPlay (3.7); wire later (energy-arc/mix story) |
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
2. ~~Capture~~ **DONE (Story 3.7, 2026-08-03).** `EnrichedPlay` carries `played_ms`/`ended_at`/`played`/`deck`/`total_length_ms`/`library_added_at`; `build_serato4` honors `played` (set 975: 178 → 105 real plays) and applies the `-1` fallback (next-play-start, else `history_session.end_time` — 105/105 durations on set 975). The cross-path `database V2` reader is `agent/src-tauri/src/joiner/date_added.rs` (`DateAddedIndex`: lazy, loads `~/Music` + every mounted `/Volumes/*` catalogue; `uadd` u32 preferred, `tadd` epoch-string fallback — verified identical on real data). **Portable-path finding:** `portable_id` is *volume-root-relative* (`Users/…` or `A Indian/…`), matching `database V2`'s own `pfil` convention — a direct string join.
3. ~~Contract~~ **DONE (Story 3.7).** `SyncPlay.played_ms` (int ms) + `SyncPlay.library_added_at` (ISO) — optional per AD-15; `agent_version` 0.0.0 → 0.1.0; schema + parity + additive-only tests green. Supabase: `plays.played_ms` (bigint) + `plays.library_added_at` (timestamptz) + `sync_set()` replacement (`20260803190000_add_play_capture_fields.sql`) so the fields survive the RPC boundary.
4. ~~Backfill~~ **DONE (Story 3.7).** Same retained-raw sweep (`backfill_captured_serato4`), now with a **carry-forward guard**: a stored `library_added_at` survives a sweep run with the covering volume unmounted (matched on `started_at` + title), so plug/unplug cycles never flip-flop/re-sync the 491 sets or lose dates. Runs on next agent launch.
5. **Keep this table current:** any future field need updates this doc first (conscious inventory), then the contract.
6. **Coverage note (2026-08-03, fixture regen):** with the Samsung USB unplugged, date-added resolves only via `~/Music`'s catalogue — set 975 gets 25/105. Plugging the USB and relaunching the agent back-fills the rest (~94% ceiling); the web fixture regenerates with it. The UI's "N without an add-date" disclosure owns the gap either way.

## Notes / risks

- Legacy vs serato4 parity: the legacy `.session` path (`legacy.rs`) should capture the same new fields where present, but Arjun's library is serato4 — prioritize serato4, sanity-check legacy.
- Additive-only discipline: never mutate/remove a frozen wire field; new fields optional per AD-15. `EnrichedPlay` is free to change (internal).
- "Played" flag semantics: Serato counts a track played only after crossfade+fader action — this is what makes Shortest Play meaningful (a real short play, not a 2s preview).
