# Deferred Work

## Deferred from: story creation of 1-3-clean-room-session-parser (2026-07-22)

- **[RESOLVED 2026-07-22] `master.sqlite` play-log scope gap** — Story 1.2's findings (§6) recommend prioritizing `master.sqlite` as the live play-log source (it holds this DJ's entire history, no binary decoding needed), but no epics.md story owned reading play-log data directly from `master.sqlite`'s `history_session`/`history_entry` tables; Story 1.4 as scoped treats `master.sqlite` only as a metadata-join library. Resolved by spinning a new sibling story **1.3b — `master.sqlite` play-log reader** (not folded into 1.4, to keep play-log-source and metadata-join concerns separate); Story 2.6/2.8 ACs updated to select the source per DJ install generation. [_bmad-output/planning-artifacts/epics.md — Story 1.3b, Story 2.6 AC-5, Story 2.8 AC-1]

## Deferred from: code review of 1-3-clean-room-session-parser (2026-07-22)

- **Flag for Story 1.9 (golden-file suite) — RF-2's trailing-fragment hard failure is unverified against real files.** RF-2 makes `parse()` return `Err(Desync)` on a trailing fragment too short to hold a record header. If real `.session` files carry trailing padding, this converts what may be benign padding into a hard parse failure. `parse_partial()` still returns the plays already decoded (loud, not lossy), but this needs checking against the real 474-file corpus once 1.9 lands. [agent/src-tauri/src/parser/session.rs — `is_plausible_tag`/trailing-fragment check]
- **Flag for Story 1.9 — fixture-construction gotcha found while testing RF-2.** Understating an `oent`'s declared length yields `Truncated` (the inner `adat` bound catches it first), not `Desync` — to exercise the tag-plausibility/desync check, a fixture must understate a top-level *header* record's length instead. Worth documenting explicitly when 1.9's real-corpus fixtures are built, so a "desync" golden fixture isn't accidentally written as a `Truncated` one. [agent/src-tauri/src/parser/session.rs test module]

## Deferred from: code review of 1-1-monorepo-scaffold-with-three-workspaces (2026-07-21)

- **`csp: null` in Tauri config** — the webview Content-Security-Policy is disabled in the baseline every later story inherits. The agent will later load/parse local Serato data; a `null` CSP tends never to get tightened. Set a restrictive CSP before the agent loads untrusted/local file content. [agent/src-tauri/tauri.conf.json:20]
- **No OS matrix in CI** — the Rust agent core is only built and tested on `ubuntu-latest`. Cross-platform (macOS/Windows) compile breakage is unguarded. Deferred because signed cross-platform bundling is explicitly Epic 2 (AR-14) scope. [.github/workflows/ci.yml:48]
- **Shallow TS↔schema parity check** — the parity test (Rust + vitest) asserts only the AR-15 enums and `contract_version`, not full property sets / required keys. Structural drift between the TS type and JSON schema can pass both guards. Deferred to contract-freeze work (Story 1.10). [agent/src-tauri/src/lib.rs:49; shared/src/index.test.ts]

## Deferred from: code review round 2 of 1-1-monorepo-scaffold-with-three-workspaces (2026-07-21)

- **`window.is_visible().unwrap_or(false)` swallows errors** — the tray click handler treats a platform visibility-query error as "not visible," which could re-show/refocus an already-visible window with no diagnostic. Low likelihood, low impact. [agent/src-tauri/src/lib.rs]
- **Heavy full Supabase stack in CI for a no-op migration** — the `supabase` CI job boots Postgres, Studio, Auth, Storage, Realtime, Edge Runtime, Analytics, vector, etc. just to prove one no-op migration applies. Mirrors what the story's Dev Notes prescribe, so it's an accepted tradeoff today, not a code defect — worth a lighter-weight CI investigation later. [.github/workflows/ci.yml]
- **`sync_payload_schema_path()` uses a compile-time build-machine path** — resolves the shared schema via `env!("CARGO_MANIFEST_DIR")`, which won't exist on a bundled, installed end-user agent. Fine for `cargo test` today; real pipeline wiring (where this needs a runtime-relative or embedded-resource path) is Stories 1.3+ scope. [agent/src-tauri/src/lib.rs]

## Deferred from: code review of 1-2-parser-validation-spike-against-real-sessions (2026-07-22)

- **`ParseError::Truncated` is unreachable dead code; malformed field-length payloads and truncated trailing records are silently dropped rather than logged as discrepancies** — in tension with the module's own "logged discrepancy, not a crash" doc comment. No occurrence observed in the real 474-file corpus; crate is explicitly throwaway (AC-4) and not extended by Story 1.3. [agent/spike-1-2-parser-validation/src/legacy_session.rs]
- **`home()`'s `.expect("HOME not set")` and `serato4_path()`'s `db_path.to_str().unwrap()` panic instead of failing gracefully** — story's own Dev Notes explicitly mark this as not a hard requirement for throwaway spike code. [agent/spike-1-2-parser-validation/src/main.rs]
- **Byte-level resync (`i += 1` until the next literal `"oent"`) could theoretically desync on a coincidental match inside a UTF-16BE text payload** — never observed against the real corpus; would show up as a track-order/name mismatch in the (now-passing) ground-truth cross-validation. [agent/spike-1-2-parser-validation/src/legacy_session.rs:104]
- **`2521.session`'s framing as matching AD-17's "morning block + gap + evening block" pattern is imprecise** — the 144-minute gap sits near the start of the session, not after a distinct morning block. Interpretive/documentation nuance; doesn't affect fixture validity. [_bmad-output/implementation-artifacts/1-2-parser-validation-spike-against-real-sessions.md]
