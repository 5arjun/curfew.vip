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
| **library date-added** | library | ❌ | ❌ | **New tracks played (3.7)** | **CAPTURE now (3.7)** → promote to wire |
| "Played" flag | play log (✅) | partial (play-log semantics) | — | filter previews from played stats | **CAPTURE into EnrichedPlay**; verify honored; no wire field needed |
| track total length (full song) | library/play | ❌ | ❌ | context ("played 4:12 of 6:30") | read into EnrichedPlay (cheap); promote when a story shows it |
| deck assignment | play log (✅) | ❌ | ❌ | true overlap/transition + mix analysis | read into EnrichedPlay; wire later (energy-arc/mix story) |
| album | library | ❌ | ❌ | none yet | skip until consumer |
| year | library | ❌ | ❌ | none yet | skip |
| bitrate | library | ❌ | ❌ | none yet | skip |
| comments | library | ❌ | ❌ | none yet | skip |
| row/session id | play log | ✅ (session identity) | ✅ (set identity) | idempotency, delete tombstone | shipped |

## Action items

1. **Verify (5 min, blocks the capture task):** confirm Serato 4+ `history_entry` (or joined `asset`) carries **end-time/played-duration** and **date-added** columns, and the exact column names. Serato computes both; research verified them in the legacy `.session` format — need the serato4 column names. Inspect `~/Library/Application Support/app.curfew.agent/local.sqlite` raw + the live `master.sqlite`.
2. **Capture (Story 3.7 agent task):** add `played_ms` (+ `ended_at`) and `library_added_at` to `EnrichedPlay`; also read total-length, deck, Played-flag into `EnrichedPlay` while in the joiner. Honor the "Played" flag so previews don't count.
3. **Contract (additive):** promote `played_ms` and `library_added_at` to `SyncPlay` (AR-15 additive-only, `agent_version` bump; contract tests in `shared/`).
4. **Backfill:** re-derive the 491 local sets through the retained-raw mechanism (same as the 3.6 Camelot fix). Idempotent, no data loss.
5. **Keep this table current:** any future field need updates this doc first (conscious inventory), then the contract.

## Notes / risks

- Legacy vs serato4 parity: the legacy `.session` path (`legacy.rs`) should capture the same new fields where present, but Arjun's library is serato4 — prioritize serato4, sanity-check legacy.
- Additive-only discipline: never mutate/remove a frozen wire field; new fields optional per AD-15. `EnrichedPlay` is free to change (internal).
- "Played" flag semantics: Serato counts a track played only after crossfade+fader action — this is what makes Shortest Play meaningful (a real short play, not a 2s preview).
