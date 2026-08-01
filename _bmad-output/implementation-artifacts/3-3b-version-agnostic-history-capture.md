---
baseline_commit: 021e81602771ddfed1245b9bd11d6ee801dbe9b7
---

# Story 3.3b: Version-agnostic history capture (watch-both + capture-time dedup)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a DJ,
I want the agent to capture my play history no matter which Serato generation is writing it or where my library lives,
so that I never silently lose nights to a setup detail I never knew mattered.

## Acceptance Criteria

1. **Given** an install exposing both a Serato 4 internal `master.sqlite` and a legacy `History/Sessions` catalogue, **When** the agent watches, **Then** it watches **both** sources concurrently rather than selecting one — so a silently-watched empty source can never be the whole picture. *(FR-4; direct fix for the 3.3 incident)*
2. **Given** the same real-world night surfaces from both sources, **Then** the Serato 4 capture wins and the legacy twin is suppressed before sync — no duplicate set reaches the cloud — enforced by a capture-time test, since the two formats emit **deliberately non-colliding** `session_identity` values (`serato4:{id}` vs `legacy:{fnv1a(path+start_time)}`, `capture.rs:473`) that Story 3.2's idempotency key would **not** dedup. *(Story 2.6 AC-5 "Serato 4 wins" precedence, moved from watch-time selection to capture-time dedup; AR-2)*
3. **Given** a Serato 4 install is present, **Then** the fixed internal `master.sqlite` is always a watched source regardless of a DJ's library-folder override (the saved override no longer skips detection of it — `mod.rs:80-82`), **And** `joiner::serato4::open_read_only(root, db_path)`'s containment check is satisfied by swapping `root` to the internal container on redirect rather than refusing the internal `db_path`. *(fixes the override-precedence root cause + the `open_read_only` root/db_path coupling)*
4. **Given** the DJ points the override at a folder with no reachable history, **When** they Save, **Then** the confirm UI rejects it **synchronously** with a specific reason ("No Serato library found here — point me at your `_Serato_` folder"), never a silent green. *(UX-DR18 calm failure copy)*
5. **Given** the fix, **Then** no new tray state is introduced — runtime staleness stays owned by the existing `DriveNotConnected` (drive unplugged) and Story 3.4 (post-setup format/layout drift), so this story does not duplicate one or pre-empt the other. *(UX-DR19 state ownership)*
6. **Given** the live watch/capture path, **Then** it carries automated coverage for: both-sources-present capture, the Serato-4-wins dedup on a night present in both, internal-path-wins-over-a-legacy-override, and Save-time rejection of a no-history folder — the incident escaped precisely because the live loop had no such coverage (standing gap from Story 2.6's review). *(AR-7/AD-13 layer 1 discipline)*

## Tasks / Subtasks

- [x] **Task 1: `detect.rs` — resolve a *set* of history sources, not one install** (AC: 1, 3)
  - [x] Add `pub fn classify_all(root: &Path) -> Vec<SeratoInstall>` alongside the existing `classify()`. Same three root shapes, same probe order, but it **collects** every hit instead of returning on the first. A migrated USB `_Serato_` (Arjun's exact case) must yield **both** a `Serato4 { db_path }` (if a real `master.sqlite` resolves there) and a `Legacy(dir)` (from `database V2`). Keep `classify()` unchanged and still exported — `watch_loop`'s per-source reachability check still wants a single-answer "does this exact source still resolve" probe, and changing its precedence would silently alter Story 2.6's tested behavior.
  - [x] Add a `WatchPlan` type (suggested home: `detect.rs`, since it is pure filesystem resolution):
        `pub struct WatchPlan { pub serato4: Option<Serato4Source>, pub legacy: Option<LegacySource> }`
        with `Serato4Source { root: PathBuf, db_path: PathBuf }` and `LegacySource { serato_dir: PathBuf, library_root: PathBuf }`.
        **`root` is per-source, not global** — this is AC-3's `open_read_only` coupling fix (see Dev Notes "The `open_read_only` root trap").
  - [x] Add `pub fn resolve_watch_plan(settings: &AgentSettings, home: &Path, disks: &dyn DiskSource) -> WatchPlan` (or take `override: Option<&str>` directly — a pure signature is what makes AC-6's tests possible). Rules, in this order:
        1. **Always** probe `home` for the internal Serato 4 `master.sqlite` (`SERATO4_HOME_RELPATH`) — unconditionally, override or not. This single line is the root-cause fix for the incident.
        2. Union in every source `classify_all(override_path)` finds, when an override is saved.
        3. When **no** override is saved, union in `detect(home, disks)`'s hits as today (so first-run/auto-detect behavior is unchanged for legacy-only DJs).
        4. **Dedup by canonicalized path** — if the override *is* the internal `master.sqlite` (Arjun's current interim setup, and what a Serato-4 auto-detect Saves), rules 1 and 2 resolve to the same file and must produce **one** source, not two watchers on one path.
        5. Serato 4 wins **nothing** here. Both slots fill independently; precedence is capture-time only (Task 3).
  - [x] `SERATO4_HOME_RELPATH` stays macOS-only and unconfirmed on Windows (`detect.rs:14-19`). Do **not** guess a Windows path — carry the existing flagged gap forward in a doc comment; a Windows DJ simply gets whatever their override resolves to, exactly as today. Do not regress Windows below current behavior.

- [x] **Task 2: `watch_loop` — watch both sources concurrently** (AC: 1, 3, 5)
  - [x] Replace `watch_loop`'s single `current_path: Option<PathBuf>` / `connected: Option<bool>` / `_fs_watcher` / `watermark` with **per-source** state. The two pending trackers (`pending_serato4: HashSet<i64>`, `legacy_pending: HashMap<PathBuf, LegacyPendingSession>`) are already source-typed — keep them as-is; only the surrounding path/connect/watcher bookkeeping needs splitting.
  - [x] Two `RecommendedWatcher`s, one per live source, both feeding the **existing single** `mpsc` channel (`tx.clone()` into each — `start_fs_watch` already takes a `Sender` by value). On a `notify` event, dispatch on the event's own path: a `.session` extension routes to `handle_legacy_session_event`; anything else routes to `check_for_new_sessions` for the serato4 source. Do **not** re-run `classify(current_path)` inside the event branch to decide which handler to call (`mod.rs:397-429` does that today) — with two sources that classification is ambiguous by construction.
  - [x] **Per-source reset semantics.** Today a changed override resets watermark + clears *both* pending trackers (`mod.rs:238-267`). That must now be scoped: a changed override invalidates only the sources it produced. The internal serato4 source is override-independent — a DJ repointing their library folder must **not** reset the serato4 watermark and re-backfill all history (see Dev Notes "Watermark reset is a 490-row event").
  - [x] `reregister_pending_as_watching`, `recheck_pending_serato4`, `recheck_legacy_quiet_periods`, and the disconnect-time `mark_incomplete` sweeps all run **per live source** rather than in an either/or `match`. A legacy source disconnecting must not flag serato4's pending sessions `incomplete`, and vice versa.
  - [x] **Drive-connected signal (AC-5).** `DriveTrayCoordinator::set_drive_connected` is called on a transition today from a single source's classify result (`mod.rs:277-283`, `mod.rs:352-359`). With two sources, the decided rule is: **`connected = any configured history source currently resolves`**; `DriveNotConnected` fires only when **no** source resolves. Extract this as a small pure function (`fn drive_connected(plan: &WatchPlan) -> Option<bool>` or equivalent) so it is unit-testable, and only call the coordinator on an actual *transition*, exactly as today. See Dev Notes "Drive-connected semantics — decided, flag if you disagree" for the rationale and the rejected alternative. **No new `TrayState` variant** — AC-5 is a prohibition; `tray.rs`'s enum must be untouched by this story.
  - [x] `scan_legacy_session_dir` (commit `e6a36b9`) and the serato4 startup catch-up both still run on each source's own (re)connect. Do not remove either — they are the "session finished while the agent was closed" catch-up, and they are what makes AC-1 true across restarts, not just live.

- [x] **Task 3: Capture-time "Serato 4 wins" dedup** (AC: 2)
  - [x] Add `SessionStatus::Superseded` to `store.rs` (string `"superseded"`). **No schema migration needed** — `status` is a free `TEXT` column under `CREATE TABLE IF NOT EXISTS` (`store.rs:34-48`); only `as_str`/`parse` and the doc comment change. `rows_pending_sync` already filters `status = 'captured'` (`store.rs:394-401`), so a superseded row is excluded from sync **automatically** — verify this with a test rather than adding a new filter.
  - [x] Add `store::overlapping_captured(conn, source: SessionSource, started_at: i64, ended_at: i64) -> Result<Vec<CapturedSessionRow>, StoreError>` — rows of the given source whose `[started_at, ended_at]` interval overlaps the supplied one within a small tolerance, `status IN ('captured')`. Both sides are unix epoch seconds derived from Serato's own play `start_time`s (`capture::session_bounds`, `capture.rs:~282`), so they are directly comparable with no clock conversion.
  - [x] Add the pure overlap predicate as its own unit-tested function (e.g. `capture::same_night(a: (i64, i64), b: (i64, i64)) -> bool`) rather than burying the arithmetic in SQL. Suggested rule: `a.0 <= b.1 + TOL && b.0 <= a.1 + TOL` with `TOL = 60` seconds (covers a single-play session where `started_at == ended_at`, and any second-resolution skew between the two formats' records of the same play).
  - [x] **Forward direction** (the common one — serato4's `end_time` resolves at set end, legacy needs a 15-minute quiet period, so serato4 almost always lands first): in `watcher::capture_and_store_legacy`, after `build_legacy` produces plays and `session_bounds` gives the interval, query for an overlapping **serato4** `captured` row. If one exists, write the legacy row as `Superseded` instead of `Captured` and return the terminal-outcome `true` (stop tracking it) — do **not** silently drop it, the row must stay visible in the local store for debugging and for the DJ-visibility precedent Story 3.3's review set.
  - [x] **Reverse direction** (legacy captured first — possible when a pre-migration `.session` file goes quiet before the matching serato4 row is polled): in `watcher::capture_and_store_serato4`, after computing bounds, find any overlapping **legacy** row that is `captured AND synced_at IS NULL` and mark it `Superseded`. If the overlapping legacy row has **already synced** (`synced_at IS NOT NULL`), leave it alone and log — there is no retraction path in the sync contract, and inventing one is out of scope. Document this as an accepted, narrow edge.
  - [x] **Fail open — when the data is ambiguous, capture both.** If either side's bounds are `NULL`/unknown, do **not** suppress. A spurious duplicate set is recoverable-ish; a silently suppressed real set is the exact failure class this entire story exists to eliminate. State this principle in the dedup function's doc comment.

- [x] **Task 4: Save-time validation against the resolved plan** (AC: 4)
  - [x] `settings::validate_override` (`settings.rs:97-105`) currently calls `classify()` and therefore **accepts** the incident path — a USB `_Serato_` with `database V2` and no `History/` at all. Change it to validate against the **resolved `WatchPlan`**: reject only if the plan that would result from saving this override has **no** history source at all. Consequence, and it is the correct one: a Serato 4 DJ who picks a no-history USB folder is **accepted**, because the internal `master.sqlite` will be watched and their sets will be captured. Only a DJ with genuinely nothing anywhere is rejected.
  - [x] Rejection copy, verbatim from AC-4: `No Serato library found here — point me at your `_Serato_` folder.` — Failure Register register (calm, technical, no exclamation), consistent with `EXPERIENCE.md:46-56`. Replaces the current longer string at `settings.rs:99-102`.
  - [x] `validate_override` needs `home`/`DiskSource` to resolve a plan. Keep it a pure function taking those as parameters (the existing split rationale at `settings.rs:93-96` — testable without an `AppHandle`); `set_serato_path_override` resolves the real home the same way `lib.rs`'s `.setup()` already does and passes them in.
  - [x] `agent/ui/index.html` (`156` lines, no build step, vanilla JS) already surfaces a failed Save's error verbatim (`index.html:145-150`) and already resets the hint. **No UI change should be needed** — confirm this by reading the Save handler before deciding to touch it. The "synchronously at Save, never a silent green" requirement is already satisfied by the existing `invoke`-then-`catch` shape; this story only changes *what* the backend rejects.

- [x] **Task 5: Automated coverage for the four named cases** (AC: 6)
  - [x] `resolve_watch_plan` — both sources present under one root yields both slots filled (AC-1); an override pointing at a legacy USB folder **still** yields the internal serato4 source (AC-3, "internal-path-wins-over-a-legacy-override"); override == internal `master.sqlite` yields exactly one serato4 source, not two (the dedup rule).
  - [x] `classify_all` — returns both generations for a migrated root, where `classify` returns only Serato4.
  - [x] Dedup (AC-2): a night present in both sources ends with exactly one `captured` row (serato4) and one `superseded` row (legacy), and `rows_pending_sync` returns only the serato4 row. Cover **both arrival orders**. Cover the fail-open case (unknown bounds → both captured).
  - [x] `validate_override` (AC-4): a no-history folder with **no** serato4 install anywhere is rejected with the exact copy; the same folder **with** an internal serato4 install present is accepted.
  - [x] Drive-connected: the pure `drive_connected` function returns connected while any source resolves, and disconnected only when none do.
  - [x] Follow the established conventions exactly (Stories 2.6/2.8/3.2/3.3, no deviation): inline `#[cfg(test)] mod tests` per file; the `TempDir` RAII fixture already duplicated in `detect.rs:171-190` and `watcher/mod.rs:847-873` (copy the local pattern, do not extract a shared test crate); `store::open_at` against a temp file for store-level tests; no mocking framework.

- [x] **Task 6: Verification** (AC: all)
  - [x] Full local gate: `cargo build` / `cargo fmt --check` / `cargo clippy -- -D warnings` / `cargo test`, all `--manifest-path agent/src-tauri/Cargo.toml` (`agent/README.md`). Baseline is **267 passing** as of `021e816`.
  - [x] Repo-root `pnpm lint` / `pnpm typecheck` / `pnpm test` — expected untouched (no `web/`, `shared/`, or `supabase/` changes in this story). If any of those directories end up modified, stop and re-read the scope boundary in Dev Notes.
  - [x] No `supabase test db` run needed — no schema, RPC, or wire-format change. Confirm this claim holds rather than assuming it.
  - [x] Manual walkthrough is **Arjun's** (needs a real bundled `.app`, real Serato, and the physical USB drive). Write the exact steps into Dev Notes for him rather than attempting it; see "Manual verification hand-off" below for the shape 3.3 established.

## Dev Notes

### Read this first: what actually broke

A Serato 4 DJ points the agent at their USB `_Serato_` folder (the natural, documented flow). That folder holds a **library** (`database V2`, `Library/location.sqlite`, a 1-byte placeholder `master.sqlite`) but **no play history** — Serato 4 writes all history to a fixed internal path, `~/Library/Application Support/Serato/Library/master.sqlite`, regardless of where the library lives. `classify()` finds `database V2`, returns `Legacy(root)`, and the agent watches `USB/_Serato_/History/Sessions/` for `.session` files **that never appear**. Zero rows captured, tray shows a healthy `Idle` the entire time. This is the most severe failure class this product has: silent, indefinite, invisible.

The root cause is **not** a missing path case in `classify()`. `detect_os_default(home)` → `classify(home)` already resolves the internal path correctly. The bug is `resolve_startup`'s precedence: **a saved override skips detection entirely** (`watcher/mod.rs:80-82`). The override mechanism, meant to help, is what breaks Serato 4 capture. Full investigation: `serato4-history-location-detection-gap-2026-07-31.md`.

**The decided design supersedes that document's own "Recommendation" section** (which proposed redirecting to a single source plus a new never-silent tray state). Read the doc's "Decision (2026-07-31)" block at the top and treat everything from "## The design question" down as superseded background. Do not implement the redirect-to-one-source model.

### The core shape change: one install → a set of sources

`SeratoInstall` is an enum — *one* generation, at *one* place. Every consumer inherits that: `watch_loop` holds one `current_path`, one `_fs_watcher`, one `watermark`, and a single `match &install` that runs either the serato4 branch or the legacy branch. AC-1 requires both to run. That is the real structural work in this story, and it is the part most likely to be under-done.

The good news, and the reason this is a small story rather than a rewrite: **the two pending trackers are already separate and already source-typed** (`pending_serato4: HashSet<i64>` and `legacy_pending: HashMap<PathBuf, LegacyPendingSession>`, `mod.rs:193-194`), and `start_fs_watch` already takes an owned `Sender` so two watchers can share one channel. The per-source capture functions (`capture_and_store_serato4`, `capture_and_store_legacy`) are already independent. What is genuinely single-valued and must be split is: `current_path`, `connected`, `_fs_watcher`, and `watermark` (which belongs to serato4 alone).

### The `open_read_only` root trap (AC-3, and easy to get subtly wrong)

`joiner::serato4::open_read_only(root, path)` refuses to open a `path` that resolves outside `root` (`joiner/serato4.rs:80-93`, via `fs_scope::ensure_within_root`, which **canonicalizes both**). Today `root` is the DJ's confirmed override path (`check_for_new_sessions`'s doc comment, `mod.rs:773-776`) — which works only because the override and the db are the same install.

Watch-both breaks that: the internal `master.sqlite` lives under `$HOME`, and the DJ's override points at `/Volumes/…/_Serato_`. Passing the override as `root` makes `ensure_within_root` reject the internal db **every time**, and the failure is a silent `let Ok(conn) = … else { return; }` early return at `mod.rs:520` and `mod.rs:792` — you would ship a story that changes nothing and passes its own unit tests. **Each source must carry its own `root`**, which is why `Serato4Source` has a `root` field. For the internal source, `root` is the `master.sqlite` path itself (or its parent) — `open_read_only` already handles a file-shaped `root` by scoping to its parent (`joiner/serato4.rs:68-75`), so passing `db_path` as `root` is correct and needs no change to that function.

Verify this end-to-end with a real open, not just by reading the code. A test that never actually calls `open_read_only` will not catch it.

### Drive-connected semantics — ruled by Arjun 2026-08-01

With two sources, "is the drive connected" stops being a single fact. **Ruled: `connected = any configured history source currently resolves`; `DriveNotConnected` only when none do.** (Arjun, 2026-08-01, at story-creation time — not a dev-agent judgment call; implement it as written.)

Rationale: UX-DR19's copy is `"Archive unreachable — reconnect drive to resume."` (`EXPERIENCE.md:52`). If the internal `master.sqlite` is present and capturing, the archive is *not* unreachable and sets are *not* paused — showing that state would be the mirror image of the very lie this story exists to eliminate. The rejected alternative (drive-connected reflects only the override-derived source, so an unplugged USB always alarms even while internal capture continues) preserves Story 2.6's existing tests more literally but tells the DJ something false.

Consequence to accept and document: for a Serato 4 DJ with a USB library, unplugging the drive no longer shows `DriveNotConnected`. Their serato4 capture genuinely continues (Serato 4's `history_entry` carries BPM/key/genre **denormalized on the play row** — `joiner/serato4.rs:1-14` — so serato4 capture needs no library file at all). A legacy-only DJ's behavior is **unchanged**. Story 2.6/2.5's `DriveNotConnected` transition tests should still pass for the single-source cases; if one fails, understand exactly which multi-source case it is asserting before changing it.

`DriveTrayCoordinator` (`tray.rs:231-276`) is the single-writer coordinator added by Story 3.3's code review — it owns the tri-state drive signal *and* serializes both loops' tray writes under one mutex. Keep routing through it. Do not add a second writer, and do not add a `TrayState` variant (AC-5).

### Watermark reset is a 490-row event — scope it carefully

`check_for_new_sessions` calls `list_sessions_after(conn, watermark)` (`parser/serato4.rs:100`), so `watermark = 0` means "return every session in the database." Story 3.3's manual verification hit exactly this: repointing the override reset the watermark and backfilled **all 490** of Arjun's historical sessions as `captured` rows in one pass. That is documented, expected behavior (`mod.rs:230-237`), not a bug.

Two implications for this story:
1. The per-source reset (Task 2) matters. The internal serato4 source is override-independent, so a DJ editing their library-folder override must not trigger a full 490-row re-backfill. Reset the serato4 watermark only when the *serato4 source's own path* changes.
2. **First run after this story ships is a backfill event** for every DJ whose override was legacy-only — the internal serato4 source becomes watched for the first time and its entire history lands at once. That is the intended fix (they were capturing nothing), but it means the dedup guard is exercised at volume on day one, not gradually.

### The dedup guard is load-bearing — more than the open questions suggest

The logged open question asks whether Serato 4 ever writes a **new** `.session` file alongside a `master.sqlite` row (one data point — Arjun's machine, 2026-07-31 — says no). That question is about *live* capture. **The backfill case makes the guard load-bearing regardless of how it resolves:**

`scan_legacy_session_dir` (added in commit `e6a36b9`) replays every pre-existing `.session` file on watch start. A migrated DJ has pre-migration `.session` files on their USB **and**, if Serato 4's migration carried history forward, the same nights as `history_session` rows in `master.sqlite`. Turning on watch-both surfaces those nights from both sources on the very first run. Without Task 3's guard, that is a duplicate dashboard set for every pre-migration night — at Arjun's scale, potentially hundreds.

This is the load-bearing case. Build the guard as if it fires constantly, because on a migrated install it will.

Why Story 3.2's idempotency key does not save you: `set_id = hash(dj_id, session_identity)` (AD-4/AD-16), and the two formats emit **deliberately non-colliding** identities — `serato4:{id}` vs `legacy:{fnv1a(path+start_time)}`, with a test at `capture.rs:466-479` asserting they can never collide. Two identities → two `set_id`s → two rows in the cloud. The idempotency contract is working exactly as designed; it just isn't the mechanism for this problem.

### Scope boundaries — what this story is not

- **Agent-only.** No `supabase/` migration, no `web/` change, no `shared/` wire-format change. Nothing about *what* gets synced changes; only which sessions reach the queue.
- **No new tray state** (AC-5, a prohibition). Runtime staleness is already owned: unplug → `DriveNotConnected`; post-setup format/layout drift → Story 3.4.
- **No first-run "verified setup" / live test capture.** That is the explicitly deferred follow-on story (`deferred-work.md`, Arjun 2026-07-31: "onboarding polish can be done later as long as we know to do it"). It is the only thing that closes the residual "path validates but new plays land elsewhere" false-green — deliberately **not** this story's job, so this correctness core ships fast.
- **No version gate, no "please update Serato" copy, ever.** A real population runs legacy Serato deliberately, and "on latest" doesn't collapse the migration case anyway (the old files persist on disk regardless of version).
- **No Windows Serato 4 path guess.** Unconfirmed and staying unconfirmed (`detect.rs:14-19`); carry the flag forward.

### Testing conventions (unchanged, follow exactly)

Established by Stories 2.6/2.8/2.10/3.2/3.3 with no deviation expected: inline `#[cfg(test)] mod tests` per file; small `pub enum FooError` with hand-written `Display`/`std::error::Error` impls, **no** `thiserror`/`anyhow`; local test-double structs (`FakeDisks` at `detect.rs:347`, `NoDisks` at `watcher/mod.rs:868`, `TempDir` RAII guards) over a shared test-support crate or a mocking framework; `#[cfg(debug_assertions)] eprintln!` for swallowed non-fatal errors (`log_store_err`, `mod.rs:453-458`). Do not add a crate for anything in this story.

The reason AC-6 exists: `watch_loop` itself takes an `AppHandle` and has **zero** test coverage — the incident escaped through exactly that hole, and Story 2.6's review already flagged it as a standing gap. The established remedy in this codebase is extracting pure functions the loop calls (`resolve_startup`, `pending_after_override_check`, `sync_queue::desired_tray_state`). Follow that pattern: `resolve_watch_plan`, `same_night`, `drive_connected`, and `validate_override` should all be pure and directly tested. Do not attempt to test `watch_loop` itself.

### Manual verification hand-off

Story 3.3 established the pattern (its own "Manual Verification (2026-07-31)" section is the reference). Write exact steps for Arjun rather than attempting them; useful facts from that run:
- A bare `cargo run` has no macOS `.app` bundle. `cargo tauri build --debug` produces a real Launch-Services-registered `Curfew Agent.app`; launch its binary directly (not via `open`, which drops shell env vars).
- Tray tooltip can be read programmatically via Accessibility (`osascript` querying `AXHelp` on the menu bar item) instead of eyeballing a screenshot.
- `CURFEW_DEBUG_QUIET_PERIOD_SEC` (debug builds only, `capture.rs:186-196`) shortens the legacy 15-minute quiet period — **this story finally needs it**, since exercising the dedup guard means driving a legacy capture to completion.
- Arjun's local Supabase currently holds all 490 of his real historical sets from 3.3's verification pass. Expect that as the starting state, and account for it when checking for duplicate sets.

Steps worth specifying: (a) override set to the USB `_Serato_` — the incident configuration — and confirm sets now capture from the internal `master.sqlite`; (b) unplug the USB mid-run and confirm the tray behaves per the decided drive-connected rule; (c) confirm the pre-migration nights present in both sources produce exactly one dashboard set each.

### Manual Verification (2026-08-01) — run, all steps passed

Run against the real bundled `.app` (`cargo tauri build --debug`), Arjun's real Serato 4 install, and the physical "ARJUN SSD" USB drive. Claude Code drove the agent process/log/local-store inspection; Arjun performed the physical actions (tray click, Save, playing/stopping a track in Serato, physically unplugging the drive) since the tray icon is custom-drawn and does not respond to Accessibility-simulated clicks.

- **AC-4 (Save-time validation)**: override saved to `/Volumes/ARJUN SSD/_Serato_` — Arjun's real incident config (a `database V2` library, zero `History` folder). Save succeeded; this exact path used to be silently accepted-but-broken (or rejected under the old copy) before this story.
- **AC-1/AC-3 (watch-both, internal DB always probed)**: while the override pointed at the USB the entire time, a real track played+stopped in Serato landed as `serato4:491` in the local store, transitioned `watching` → `captured`, and synced (`synced_at` set) — proving live capture from the internal `master.sqlite`, independent of the override.
- **Watermark scoping**: agent's stdout log stayed at exactly 490 lines across the Save (no re-backfill burst) — confirms the override change did not reset the serato4 watermark, per the "490-row event" Dev Note.
- **Per-source teardown**: the 474 legacy sessions previously `watching` (from the prior override, a local folder with real history) correctly transitioned to `incomplete` on Save, once the USB's plan resolved to no legacy source — not lost, resumable.
- **Drive-connected semantics**: the USB was physically unplugged (confirmed via `/Volumes` dropping the mount) while the agent ran; tray tooltip (`Curfew Agent — Idle`, read via `osascript`/Accessibility `AXHelp`) never flipped to `DriveNotConnected` throughout, because the internal source kept resolving — matches the 2026-08-01 ruling exactly.
- **AC-2 (dedup)**: not independently live-reproduced — Arjun's real incident USB has zero legacy `.session` history by definition (that's the incident), so there was no live overlapping-night case available to trigger it this session. Left to the 12 unit/integration tests (`capture::same_night`, `store::overlapping_captured`, and the 4 forward/reverse/fail-open `dedup_*` integration tests in `watcher::mod`), all passing.
- **AC-5**: confirmed via `git diff --stat` that `tray.rs` is untouched.

Full local gate re-run same session: `cargo build`/`fmt --check`/`clippy -D warnings`/`test` — 309/309 unit + 9/9 golden/integration tests green. Repo-root `pnpm lint`/`typecheck`/`test` — cache hits, `web` 23/23 and `shared` 20/20 green, confirming no drift outside `agent/`.

### Manual Verification Steps (superseded by the completed run above — kept for reference)

All automated coverage (309 unit tests, up from 267) and the full local gate are green as of this dev session. The one thing this session could not do itself is drive the real agent against your real Serato 4 install + USB drive. Exact steps:

1. Build a real bundle: `cargo tauri build --debug --manifest-path agent/src-tauri/Cargo.toml` (a bare `cargo run` has no macOS `.app` bundle — Story 3.3's own finding). Launch the resulting `Curfew Agent.app`'s binary directly, not via `open` (which drops shell env vars you may want, e.g. `CURFEW_DEBUG_QUIET_PERIOD_SEC` below).
2. In the settings panel, set the Serato folder override to the USB `_Serato_` folder — the exact incident configuration (a library, no `History/`). Confirm Save now **succeeds** (AC-4 — this used to be rejected).
3. Play a short set for real (or drive one synthetically) and confirm a set actually gets captured — check the tray cycles through `Syncing`/`Idle` and that a new row lands in the local store from the **internal** `master.sqlite`, not the USB (AC-1/AC-3 — this is the direct incident fix).
4. Unplug the USB mid-run. Per the decided drive-connected rule (Dev Notes, "Drive-connected semantics"), the tray must **not** show `DriveNotConnected` while the internal serato4 source keeps resolving — confirm it stays `Idle`/`Syncing` instead. Then also fully disconnect (or point the override at a folder that resolves nothing) to confirm `DriveNotConnected` still fires when truly nothing resolves.
5. Set `CURFEW_DEBUG_QUIET_PERIOD_SEC=5` (debug builds only) before launch to shorten the legacy 15-minute quiet period, so you can actually drive a legacy capture to completion within the walkthrough — exercising the dedup guard requires a real legacy `.session` file going quiet.
6. Confirm the pre-migration nights present in both the USB's `.session` files and the internal `master.sqlite` (if any overlap exists on your real data) produce **exactly one** dashboard set each, not a duplicate — check the local store directly (`sqlite3 <app_local_data_dir>/local.sqlite "select session_identity, source, status from captured_sessions order by started_at"`) for a `superseded` row alongside its winning `captured` counterpart. Arjun's local Supabase already holds all 490 historical sets from Story 3.3's verification pass — expect that as the starting state and account for it when scanning for duplicates.
7. Tray tooltip can be read programmatically via Accessibility (`osascript` querying `AXHelp` on the menu bar item) instead of eyeballing a screenshot, if that's faster.

### Project Structure Notes

Files expected to change (all under `agent/`):
- `agent/src-tauri/src/watcher/detect.rs` — **UPDATE**: `classify_all`, `WatchPlan`/`Serato4Source`/`LegacySource`, `resolve_watch_plan`. `classify`/`detect`/`detect_os_default`/`scan_removable_volumes` stay as-is.
- `agent/src-tauri/src/watcher/mod.rs` — **UPDATE**, the largest change: per-source state in `watch_loop`, two fs watchers, per-source reset/reregister/recheck/disconnect sweeps, path-based event dispatch, the `drive_connected` extraction, and the dedup calls in `capture_and_store_legacy`/`capture_and_store_serato4`. `resolve_startup`/`StartupResolution` may need a companion rather than a rewrite — the first-run confirm gate (AC-3, UX-DR20) must keep working unchanged.
- `agent/src-tauri/src/store.rs` — **UPDATE**: `SessionStatus::Superseded`, `overlapping_captured`, `mark_superseded`. No schema/table change, no migration.
- `agent/src-tauri/src/capture.rs` — **UPDATE**: the `same_night` overlap predicate. Identity/completion/build functions unchanged.
- `agent/src-tauri/src/settings.rs` — **UPDATE**: `validate_override` signature + plan-based check + new copy.
- `agent/src-tauri/src/lib.rs` — **UPDATE** (likely small): passing `home`/disks into the validation path.
- `agent/ui/index.html` — probably **untouched**; confirm before editing.

Not expected: `web/`, `shared/`, `supabase/`, `agent/src-tauri/src/tray.rs` (AC-5), `agent/src-tauri/src/sync.rs`, `agent/src-tauri/src/sync_queue.rs`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3b] — acceptance criteria verbatim, open questions, and the deferred-follow-on boundary; lines 618-640.
- [Source: _bmad-output/implementation-artifacts/serato4-history-location-detection-gap-2026-07-31.md] — full investigation. **Read the "Decision (2026-07-31)" block at the top; everything from "## The design question" down is superseded background.**
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — "Surfaced by: 3-3-offline-sync-queue manual verification (2026-07-31)": the ledger entry, both open questions, and the two deliberately-separate follow-ons (verified setup; the interim manual unblock).
- [Source: git commit 2921659] — "Decide Serato 4 history-detection fix: watch both, dedup at capture" — the design-discussion outcome commit; its message is the shortest complete statement of the decided shape.
- [Source: git commit e6a36b9] — "Scan legacy .session files on watch start/reconnect" — the startup catch-up this story must preserve, and the mechanism that makes the backfill-dedup case load-bearing.
- [Source: git commit 021e816] — Story 3.3 code review: introduced `tray::DriveTrayCoordinator` as the single tray writer. Anything in Story 3.3's own file describing a `watcher::DriveConnectionState(AtomicBool)` is **stale** — that was replaced by the coordinator.
- [Source: _bmad-output/planning-artifacts/architecture/.../ARCHITECTURE-SPINE.md#AD-4] — deterministic `set_id = hash(dj_id, session_identity)`; why two identities means two cloud rows.
- [Source: _bmad-output/planning-artifacts/architecture/.../ARCHITECTURE-SPINE.md#AD-16] — `session_identity` must derive from a stable intrinsic property, never mtime/path/filename; the rule that forces content-based dedup rather than re-keying.
- [Source: _bmad-output/planning-artifacts/architecture/.../ARCHITECTURE-SPINE.md#AD-13] — three-layer format-drift resilience; AC-6's "layer 1 discipline" citation.
- [Source: _bmad-output/planning-artifacts/architecture/.../ARCHITECTURE-SPINE.md#AD-5] — local SQLite is source of truth until sync; why `synced_at IS NULL` is the queue and why a synced row can't be retracted.
- [Source: _bmad-output/planning-artifacts/ux-designs/.../EXPERIENCE.md:46-56] — Failure Register (calm, technical, no exclamations); line 52 `"Archive unreachable — reconnect drive to resume."`; line 76 the four tray states; the "First-run path confirmation" and "Settings saved" State Pattern rows.
- [Source: _bmad-output/implementation-artifacts/2-6-serato-folder-auto-detection-first-run-confirm.md] — the story that built `detect.rs`/`resolve_startup`/the confirm gate, including its AC-5 "Serato 4 wins" precedence this story relocates.
- [Source: _bmad-output/implementation-artifacts/3-3-offline-sync-queue.md] — previous story: Dev Notes conventions, the manual-verification playbook, and the prerequisites section that first confirmed this bug firsthand.
- [Source: agent/src-tauri/src/watcher/detect.rs:14-24] — `SERATO4_HOME_RELPATH` / `SERATO4_DB_FILENAME`; :65-94 `classify` and its three root shapes; :116-122 `detect_os_default`; :149-161 `scan_removable_volumes`/`detect`.
- [Source: agent/src-tauri/src/watcher/mod.rs:75-87] — `resolve_startup`, the override-skips-detection root cause; :166-436 `watch_loop`; :238-267 path-change reset; :277-283 and :352-359 the two tray transitions; :514-540 `recheck_pending_serato4`; :550-592 `capture_and_store_serato4`; :601-641 `handle_legacy_session_event`; :652-666 `scan_legacy_session_dir`; :699-743 `capture_and_store_legacy`; :750-767 `start_fs_watch`; :785-827 `check_for_new_sessions`.
- [Source: agent/src-tauri/src/joiner/serato4.rs:60-93] — `open_read_only`'s containment check and its file-shaped-`root` branch.
- [Source: agent/src-tauri/src/fs_scope.rs:63-72] — `ensure_within_root` canonicalizes both sides before comparing.
- [Source: agent/src-tauri/src/store.rs:34-48] — `captured_sessions` schema; :120-152 `SessionStatus`; :264-282 `upsert_watching`; :291-330 `upsert_captured`; :381-401 `rows_with_status`/`rows_pending_sync`.
- [Source: agent/src-tauri/src/capture.rs:92-148] — the two identity functions; :155-196 the two completion signals + the debug quiet-period override; :282-289 `session_bounds`; :434-436 `library_root_from_serato_dir`; :466-479 the never-collide assertion.
- [Source: agent/src-tauri/src/settings.rs:93-124] — `validate_override` and `set_serato_path_override`.
- [Source: agent/src-tauri/src/tray.rs:231-276] — `DriveTrayCoordinator`, the single-writer tray coordinator (Story 3.3 review).
- [Source: agent/ui/index.html:140-151] — the Save handler that already surfaces a rejection verbatim.
- [Source: agent/README.md] — the four-command cargo gate.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via Claude Code.

### Debug Log References

None — no debugger/trace tooling invoked. All verification was the four-command cargo gate (`build`/`fmt --check`/`clippy -D warnings`/`test`) plus repo-root `pnpm lint`/`typecheck`/`test`, all run to completion each task.

### Completion Notes List

- **Task 1** (`detect.rs`): `classify_all` collects every hit under a root instead of stopping at the first (mirrors `classify`'s three root shapes exactly, branch-by-branch, so behavior can't silently drift between the two). `WatchPlan`/`Serato4Source`/`LegacySource` added; `resolve_watch_plan` implements the five ordered rules verbatim — the internal-`master.sqlite` probe is genuinely unconditional (`home.join(SERATO4_HOME_RELPATH).is_file()`, no override/settings dependency at all), and dedup is by canonicalized path with a raw-equality fallback (`paths_match`) for paths that don't yet exist (test fixtures, mid-Save states). `SERATO4_HOME_RELPATH` widened to `pub(crate)` so Task 4's settings tests can build a realistic internal-install fixture without duplicating the literal. 10 new tests.
- **Task 2** (`watch_loop`): replaced the single `current_path`/`connected`/`watermark`/`_fs_watcher` locals with per-source `Serato4Watch`/`LegacyWatch` state structs and two focused `advance_serato4`/`advance_legacy` functions, each owning its own identity-change-vs-reconnect distinction, connect/disconnect, and catch-up scan — called every tick against a freshly resolved `WatchPlan`. Event dispatch is now by the notify event's own path (`.session` extension → legacy; anything else → the live serato4 slot), not by re-classifying a single path, per the story's explicit instruction that classification would be ambiguous with two live sources. `drive_connected(plan)` is a pure `bool` projection (`serato4.is_some() || legacy.is_some()`) written through `DriveTrayCoordinator` only on a transition, exactly mirroring the old single-source transition-only write. Home resolution (with its non-fatal fallback) was factored out of `lib.rs`'s `.setup()` into `watcher::resolve_home`, shared by both the loop and `.setup()`. `reregister_pending_as_watching`/`db_path_for` (combined, single-install-shaped) were replaced by two source-specific reregister functions. 4 new tests (`drive_connected_*`).
- **Task 3** (capture-time dedup): `SessionStatus::Superseded` added (free `TEXT` column, no migration); `rows_pending_sync`'s existing `status = 'captured'` filter excludes it automatically, verified by test rather than adding a new filter as the story instructed. `capture::same_night` is the pure, unit-tested tolerance predicate (`TOL = 60s`); `store::overlapping_captured` calls it in Rust rather than embedding the arithmetic in SQL (an intentional `store → capture` dependency alongside the pre-existing `capture → store` one — both live in the same crate, so this is not a build-breaking cycle, just a deliberate layering call the story specified explicitly). Forward direction wired into `capture_and_store_legacy` (upsert as captured, then supersede on a proven serato4 overlap); reverse direction wired into `capture_and_store_serato4` (supersedes an unsynced overlapping legacy row; an already-synced one is left alone and logged, per the story's explicit "no retraction path" ruling). Both directions fail open on unknown bounds or a query error. 8 store-level tests + 4 end-to-end integration tests in `watcher::mod` driving the real `capture_and_store_*` functions against real on-disk fixtures (forward, reverse, reverse-already-synced, fail-open).
- **Task 4** (Save-time validation): `settings::validate_override` now resolves a full `WatchPlan` (via the same `resolve_watch_plan` Task 1 built) instead of calling `classify()` on the candidate path alone, and rejects only when *both* plan slots are empty — so the incident configuration (USB library, no history) is now accepted whenever the internal serato4 install exists. Rejection copy replaced verbatim per AC-4. `set_serato_path_override` resolves `home` via the new shared `watcher::resolve_home` and passes it through. Confirmed `agent/ui/index.html`'s Save handler already surfaces any rejection string verbatim (`catch (err) { status.textContent = \`${err}\`; }`) — no UI change made. 3 tests (accept/reject/incident-acceptance), rewritten to the new signature with a local `TempDir`/`NoDisks` fixture pair matching the rest of the crate's convention.
- **Task 5** (coverage checklist): every case the story named was already produced by the TDD cycle in Tasks 1-4 (verified by re-reading the task list against actual test names afterward, rather than assuming) — no additional tests were needed.
- **Task 6** (verification): four-command cargo gate green — 309 unit tests (up from the 267 baseline at `021e816`, +42 net new) + 9 golden/integration tests, `fmt --check`/`clippy -D warnings` clean. Repo-root `pnpm lint`/`typecheck`/`test` green and untouched by this diff (`web` 23/23, `shared` 20/20, both cache hits — no shared/web/supabase file was modified, confirmed via `git status`). No `supabase test db` run — no schema/RPC/wire-format change, confirmed rather than assumed. Manual verification (real bundled `.app`, real Serato 4 install, real USB drive) is Arjun's — exact steps written into Dev Notes' "Manual Verification Steps" subsection rather than attempted here.

### File List

- `agent/src-tauri/src/watcher/detect.rs` — `classify_all`, `WatchPlan`/`Serato4Source`/`LegacySource`, `resolve_watch_plan`, `paths_match`; `SERATO4_HOME_RELPATH` widened to `pub(crate)`; 10 new tests.
- `agent/src-tauri/src/watcher/mod.rs` — per-source `watch_loop` rewrite (`Serato4Watch`/`LegacyWatch`, `advance_serato4`/`advance_legacy`, `connect_*`/`disconnect_*`, `reregister_pending_serato4_as_watching`/`reregister_pending_legacy_as_watching`, `drive_connected`, `resolve_home`), event dispatch by path, `start_fs_watch` signature simplified to a raw path, dedup calls wired into `capture_and_store_serato4`/`capture_and_store_legacy`; 8 new tests (4 `drive_connected_*`, 4 `dedup_*` end-to-end).
- `agent/src-tauri/src/store.rs` — `SessionStatus::Superseded`, `mark_superseded`, `overlapping_captured`; schema doc comment updated; 8 new tests.
- `agent/src-tauri/src/capture.rs` — `same_night`; 7 new tests.
- `agent/src-tauri/src/settings.rs` — `validate_override` resolves a `WatchPlan` instead of calling `classify()` directly, new rejection copy, `home`/`DiskSource` params; `set_serato_path_override` resolves `home` via `watcher::resolve_home`; existing tests updated to the new signature, 1 new test (incident-acceptance case).
- `agent/src-tauri/src/lib.rs` — `.setup()`'s inline home-resolution fallback replaced with a call to the new shared `watcher::resolve_home`; unused `PathBuf` import removed.

### Change Log

- 2026-08-01 — Story 3.3b implemented: watch-both + capture-time dedup, fixing the Story 3.3 incident where a saved override silently starved the Serato 4+ internal `master.sqlite` out of ever being watched. All 6 tasks complete, full local gate green (309/309 unit tests, up from 267), repo-root `pnpm lint`/`typecheck`/`test` green and unaffected. Manual verification hand-off written for Arjun; not yet run.
