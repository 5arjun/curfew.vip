// Library add-event fixture builder (Story 4.2 Task 5) — the fixture-stage
// stand-in for the `library_track_events` cloud read.
//
// THIS IS THE DENOMINATOR HALF, and it is the reason this builder exists
// separately from `build-fixture.mjs`. That builder is derived from the play
// log, so every track it can see is by definition a track that was PLAYED. The
// music FR-10 actually cares about — bought and never touched — is structurally
// invisible to it. So this builder reads the DJ's real library CATALOGUE
// instead, exported by `agent/src-tauri/tests/export_real_library.rs` through
// the exact same `DateAddedIndex::all_tracks()` the shipping agent's add-scan
// uses:
//
//   CURFEW_REAL_HOME="$HOME" CURFEW_LIBRARY_OUT=/tmp/real_library.json \
//     cargo test --test export_real_library -- --ignored --nocapture
//
// The export carries opaque `fnv1a_hex` identities and epoch add-dates only —
// never a path — so it is as committable as the set fixture's derived stats.
// Both halves hash the same volume-root-relative path via the agent's own
// `capture::track_id`, which is what lets a play join its add-event at all.
//
// GO-FORWARD SIMULATION (D-1). A real agent takes a silent baseline of the
// existing library on first run and emits add-events only for tracks that
// appear on a LATER scan — so a DJ never sees their back-catalogue as "added
// this month". A catalogue export has no notion of when Curfew was installed,
// so this builder simulates it: everything added before INSTALL_DATE is treated
// as baselined and dropped entirely, and only tracks added on or after it
// become add-events. That models exactly what a DJ who installed Curfew on that
// date would have, using nothing but real dates.
//
// Usage (from web/):
//   node lib/sets/build-library-fixture.mjs [library-export.json] [sets-export.json]
// Defaults to /tmp/real_library.json and the committed set fixture. Override
// the simulated install date with CURFEW_FIXTURE_INSTALL_DATE=YYYY-MM-DD.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const setsFixturePath = resolve(here, "recent-sets.fixture.json");
const eventsPath = resolve(here, "library-add-events.fixture.json");

const libraryExportPath = process.argv[2] ?? "/tmp/real_library.json";

/**
 * The simulated Curfew install date. Defaults to 2025-01-01 — the month the
 * committed set fixture's play history begins, so the add-event window and the
 * play window cover the same span and no cohort is scored against a period
 * where no plays could possibly have been captured.
 */
const INSTALL_DATE = new Date(`${process.env.CURFEW_FIXTURE_INSTALL_DATE ?? "2025-01-01"}T00:00:00Z`);

if (!existsSync(libraryExportPath)) {
  console.error(
    `no library export at ${libraryExportPath}\n\n` +
      `Produce one first (read-only, emits no paths):\n` +
      `  cd agent/src-tauri && CURFEW_REAL_HOME="$HOME" CURFEW_LIBRARY_OUT=/tmp/real_library.json \\\n` +
      `    cargo test --test export_real_library -- --ignored --nocapture\n\n` +
      `Mount every drive you want counted first — a track on an unmounted volume\n` +
      `has no reachable catalogue and is simply absent.`,
  );
  process.exit(1);
}

const library = JSON.parse(readFileSync(libraryExportPath, "utf8"));
const toIso = (epochSeconds) =>
  epochSeconds == null ? null : new Date(epochSeconds * 1000).toISOString();

let baselined = 0;
let undated = 0;
const events = [];

for (const track of library) {
  if (track.added_at == null) {
    // Undated tracks cannot be placed relative to the install date, so the
    // simulation cannot honestly decide whether they are baseline or add. The
    // real agent CAN (it knows when it first SAW the track, independent of the
    // catalogue's date) and emits them with `added_at: null` — which is exactly
    // what D-10's disclosure line exists to surface. Dropped here rather than
    // guessed; the count is reported below so a future export that has some
    // does not vanish silently.
    undated++;
    continue;
  }
  if (new Date(track.added_at * 1000) < INSTALL_DATE) {
    baselined++;
    continue;
  }
  events.push({ track_id: track.track_id, added_at: toIso(track.added_at) });
}

// Stable order so re-running against an unchanged library diffs cleanly.
events.sort((a, b) => a.track_id.localeCompare(b.track_id));
writeFileSync(eventsPath, `${JSON.stringify(events, null, 2)}\n`);

// Reach check: how much of this denominator the play fixture can actually
// speak to. A low join rate is not a bug — it usually means the plays came
// from a drive whose catalogue was not mounted at export time — but it caps
// how meaningful the conversion rates are, so it is printed rather than left
// to be discovered in the chart.
const sets = JSON.parse(readFileSync(setsFixturePath, "utf8"));
const playedIds = new Set();
let playsWithoutIdentity = 0;
for (const set of sets) {
  for (const play of set.plays) {
    if (play.track_id) playedIds.add(play.track_id);
    else playsWithoutIdentity++;
  }
}
const eventIds = new Set(events.map((e) => e.track_id));
const joined = [...eventIds].filter((id) => playedIds.has(id)).length;

console.error(
  [
    `library export:      ${library.length} tracks`,
    `  baselined (pre-${INSTALL_DATE.toISOString().slice(0, 10)}): ${baselined}  — silent, never synced (D-1)`,
    `  undated, dropped:   ${undated}`,
    `  -> add-events:      ${events.length}`,
    `play fixture:        ${playedIds.size} distinct played identities` +
      (playsWithoutIdentity ? ` (${playsWithoutIdentity} plays carry no track_id — re-export the sets)` : ""),
    `join:                ${joined} of ${events.length} add-events were ever played ` +
      `(${Math.round((100 * joined) / (events.length || 1))}%) — ${events.length - joined} never played`,
  ].join("\n"),
);
