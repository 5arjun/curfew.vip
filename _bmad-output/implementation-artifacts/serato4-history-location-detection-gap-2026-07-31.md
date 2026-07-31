# Findings: Serato 4 play-history location vs. the "point at `_Serato_`" model

**Date:** 2026-07-31
**Surfaced by:** Story 3.3 manual verification (offline sync queue) on Arjun's machine
**Status:** Open — blocks Story 3.3 manual verification; proposes a detection/UX change (not yet a story)
**Owner:** TBD (detection lives in `agent/src-tauri/src/watcher/detect.rs`)

---

## TL;DR

Serato 4 stores **all play history** in a single fixed internal file —
`~/Library/Application Support/Serato/Library/master.sqlite` — **regardless of
where the DJ's tracks/library live** (internal disk, USB, etc.). The
`_Serato_` folder on a USB drive contains the *library* (tracks, crates,
`database V2`, `location.sqlite`) but **no play history at all** for a Serato 4
install.

Our current model asks the DJ to point the agent at their `_Serato_` folder.
That is a **legacy-Serato mental model** (where history lived in
`<_Serato_>/History/Sessions/*.session`). For a Serato 4 DJ who points at their
USB `_Serato_` folder, the agent classifies it as *legacy*, watches
`USB/_Serato_/History/Sessions/` for `.session` files that **never appear**, and
**captures nothing** — with no error surfaced to the DJ.

---

## How we found it

Attempting Story 3.3's manual verification (capture a set offline → confirm the
tray shows `Queued` → reconnect → confirm it drains to `Idle`). The capture step
never produced a row, so the sync/queue path under test was never even reached.
Walking backward through the pipeline:

1. **Agent's `local.sqlite` had zero rows** — nothing was ever captured.
2. **Confirmed path was** `/Volumes/Samsung USB/_Serato_` (a USB `_Serato_`
   folder containing `database V2`, so the agent classified it **legacy**).
3. **`USB/_Serato_/History/` did not exist** — legacy watches
   `<_Serato_>/History/Sessions/*.session`; there were no session files, and no
   `History/` folder at all. Nothing for the legacy watcher to see, ever.
4. The USB `_Serato_/Library/` held `location.sqlite` (2.9 MB — a track-location
   index, tables like `asset`/`container`/`space`) and a **1-byte placeholder
   `master.sqlite`** (empty, no `history_session` table).
5. **The actual play history was internal:**
   `~/Library/Application Support/Serato/Library/master.sqlite` (48 MB, live WAL,
   modified at the exact minute of the test set). Querying it:
   ```
   490|7/31/26|1785518734|1785518839   ← the test set (~105s, 4 songs), end_time resolved
   489|6/26/26|...
   ...
   ```
   The set was recorded correctly — just not anywhere the agent was looking.

**Conclusion:** every "failure" in this session was environmental/path-related,
upstream of Story 3.3. Story 3.3's queue/backoff/tray logic is unit-tested and
green; its *manual end-to-end* remains unverified because capture can't engage
on this drive layout under the current detection model.

---

## Root cause: Serato 4 decoupled history location from library location

| | Legacy Serato | Serato 4 |
|---|---|---|
| **Library** (tracks/crates) | `<_Serato_>/database V2` | `<_Serato_>/Library/` + `location.sqlite`, and/or `database V2` during migration |
| **Play history** | `<_Serato_>/History/Sessions/*.session` | **`~/Library/Application Support/Serato/Library/master.sqlite`** (`history_session` table) — **internal, fixed, one location for all history** |
| **On a USB drive?** | History lives with the library on the USB | Library can live on USB; **history never does** — it stays internal |

So "point at the `_Serato_` folder" only locates history for **legacy**. For
**Serato 4**, the folder the DJ naturally points at (their library, often on USB)
is the *wrong place to look for history* by design.

### Migrated-install wrinkle (Arjun's exact case)

Arjun's USB `_Serato_` folder has **both** a legacy `database V2` **and** Serato 4
artifacts (`Library/location.sqlite`, an empty placeholder `master.sqlite`). Our
`classify()` (`detect.rs:65`) checks for `master.sqlite` under the home-relative
suffix and directly under the root, then falls to `database V2`. Pointed at the
USB `_Serato_` root:

- `root.is_file()` → no (it's a dir)
- `root/Library/Application Support/Serato/Library/master.sqlite` → no (that
  suffix only resolves under a *home* root, not a USB `_Serato_` root)
- `root/master.sqlite` → no (the placeholder is at `root/Library/master.sqlite`,
  which `classify()` never checks)
- `root/_Serato_/database V2` → no
- **`root/database V2` → yes → classified `Legacy(root)`** ✅ matches, wrong answer

Even if `classify()` *had* found `USB/_Serato_/Library/master.sqlite`, it's the
**1-byte placeholder** — no history. The real history is internal and
unreachable from the USB root the DJ selected.

---

## The design question

> Should the DJ still point at the USB `_Serato_` folder either way — best case
> we detect the right version, and if not we tell them to switch to the internal
> folder (or do it ourselves)?

### Recommendation: **do it ourselves — detect and watch history automatically; don't make the DJ reason about where Serato hides history.**

The DJ's mental model ("this is my Serato folder") is about their **library**.
History location is a Serato *implementation detail* that changed between
versions and, in Serato 4, is a fixed internal path independent of the library
drive. Asking the DJ to know that is a leaky abstraction that will silently fail
for every Serato 4 user who points at their USB library.

Concretely, I'd propose the detection contract become:

1. **History and library are separate concerns.** What the DJ points at
   (or what we auto-detect) identifies their *install*; from that we
   independently resolve the **history source**:
   - If a **Serato 4** install is present, the history source is *always* the
     internal `~/Library/Application Support/Serato/Library/master.sqlite`
     (the canonical `SERATO4_HOME_RELPATH`, `detect.rs:19`) — **never** a
     `_Serato_/History/Sessions/` folder, even if the DJ pointed at a USB
     `_Serato_`.
   - If only a **legacy** install exists (no Serato 4 anywhere), the history
     source is `<_Serato_>/History/Sessions/*.session` as today.

2. **Prefer zero-input auto-detection for the common case.** The internal
   Serato 4 `master.sqlite` is at a fixed, known location — auto-detect and watch
   it without requiring the DJ to select anything. The folder-picker becomes an
   *override/escape hatch*, not the primary flow.

3. **When the DJ points at a `_Serato_` folder that belongs to a Serato 4
   install, redirect to the internal `master.sqlite`** rather than watching for
   legacy `.session` files. The DJ shouldn't have to know history moved.

4. **Never fail silently.** If we resolve to a history source that produces no
   sessions after a set, or we detect a `_Serato_` folder with no reachable
   history, surface it (the existing calm-copy convention) instead of sitting
   `Idle` forever. A Serato 4 DJ following the intended flow today captures
   *nothing* and gets no signal — that's the worst failure mode.

### Why not "tell them to switch to the internal folder"?

It works as an interim fix (and is exactly what unblocks Arjun's test right now
— see below), but as the product model it pushes Serato's internal storage
layout onto the DJ. Most DJs won't know the internal `master.sqlite` exists;
"point at `_Serato_`" is the promise, and the agent should honor it by resolving
history itself. Keep the manual internal-path override for genuinely weird
setups, but don't make it the expected path.

### Open sub-questions for whoever picks this up

- **Multiple Serato 4 libraries / external "Serato 4 on USB" mode.** Does Serato
  4 *ever* write history somewhere other than the internal path (e.g. a true
  portable/external-history mode)? This session only observed the internal
  location; confirm before hardcoding "history is always internal."
- **Windows.** `SERATO4_HOME_RELPATH` is macOS-only; the project has no confirmed
  Serato 4 Windows history path (`detect.rs:14-19`). Needs research before the
  auto-detect-internal approach is cross-platform.
- **Migration state.** During legacy→Serato 4 migration a DJ may have live
  history in *both* the old `.session` files and the new `master.sqlite`.
  Precedence rule needed (likely: Serato 4 wins, matching the existing AC-5
  "Serato 4+ wins when both present" intent — which today only holds for the
  paths `classify()` actually checks).

---

## Immediate unblock for Story 3.3 (test setup, not a code change)

To get capture working on Arjun's machine right now, re-confirm the agent's
Serato path in the tray settings to the **internal file**:

```
/Users/arjun/Library/Application Support/Serato/Library/master.sqlite
```

This is the canonical Serato 4 macOS history location. Then:

1. Play/end a set → confirm a `captured` row appears in the agent's `local.sqlite`
   (`status='captured'`, `synced_at` NULL, then populated once synced).
2. To actually observe the **`Queued`** tray state, do **not** toggle Wi-Fi —
   local Supabase on `127.0.0.1` (loopback) stays reachable with Wi-Fi off, so
   the row would just sync and never show `Queued`. Instead **`supabase stop`**
   to genuinely cut the connection, capture a set → tray → `Queued`, then
   **`supabase start`** → tray drains to `Idle` within one backoff interval
   (30s–5min).

*(A `#[cfg(debug_assertions)]` shortcut — shorten the legacy quiet period + force
the sync target unreachable — was offered to make this a ~30s repeatable check
instead of the multi-step manual dance. Not yet built.)*

---

## Impact on Story 3.3 status

- **Not a defect in Story 3.3's code.** The queue/backoff/error-classification/
  tray-`Queued` logic is fully unit-tested and green (267/267 cargo tests,
  pnpm suites, 58/58 pgTAP). The one unchecked box — manual end-to-end
  verification — was blocked at the *capture* stage by the detection model above,
  which is upstream of anything 3.3 touches.
- **Recommendation:** keep Story 3.3 `in-progress` (matching its own Dev Notes
  precedent for a single incomplete manual task) until the manual walkthrough is
  completed via the internal-path unblock above. The detection/UX gap is its own
  work item, tracked here and (suggested) mirrored into `deferred-work.md`.

---

## Suggested `deferred-work.md` entry

> **Serato 4 play history is not in the `_Serato_` folder the DJ points at.**
> Serato 4 writes all history to the internal
> `~/Library/Application Support/Serato/Library/master.sqlite`, independent of
> library/drive location; a DJ pointing at a USB `_Serato_` folder (esp. a
> migrated install with `database V2` present) is classified legacy, watches a
> non-existent `History/Sessions/` path, and captures nothing with no error.
> `classify()` never checks the internal Serato 4 location from a non-home root,
> and history/library are conflated as one path. Fix: resolve history source
> independently of the DJ-selected library folder — auto-detect/redirect to the
> internal Serato 4 `master.sqlite` when a Serato 4 install is present; keep
> legacy `.session` watching only when no Serato 4 install exists; never fail
> silently. Windows history path unknown. Surfaced by Story 3.3 manual
> verification. [agent/src-tauri/src/watcher/detect.rs:14-90,
> agent/src-tauri/src/watcher/mod.rs:730-747]
