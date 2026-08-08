// Library roster fixture builder (Story 4.11 Task 9) — the fixture-stage
// stand-in for the `library_roster` cloud read (AD-22).
//
// Reads the SAME real-library catalogue export `build-library-fixture.mjs`
// reads (`agent/src-tauri/tests/export_real_library.rs`), extended by this
// story to also carry title/artist (Tier A) alongside the opaque
// `track_id`/`added_at` pair it already emitted for Story 4.2:
//
//   CURFEW_REAL_HOME="$HOME" CURFEW_LIBRARY_OUT=/tmp/real_library.json \
//     cargo test --test export_real_library -- --ignored --nocapture
//
// GO-FORWARD SIMULATION (D-1), same as build-library-fixture.mjs: a real
// agent's D-1 baseline is silent and the export has no notion of "when
// Curfew was installed", so everything added before the same simulated
// INSTALL_DATE is marked `is_baseline: true` here — deliberately using the
// SAME install date as the add-event fixture builder, so the two committed
// fixtures agree on which tracks are baseline vs go-forward (a track cannot
// be an add-event in one fixture and a non-baseline roster entry disagreeing
// with it in the other).
//
// `absent_at` is always null in this fixture — a single catalogue snapshot
// has no way to know a track was ever removed; that needs two scans a real
// agent produces over time, which a one-shot export cannot simulate
// honestly. Left null rather than guessed.
//
// Usage (from web/):
//   node lib/sets/build-library-roster-fixture.mjs [library-export.json]
// Defaults to /tmp/real_library.json. Override the simulated install date
// with CURFEW_FIXTURE_INSTALL_DATE=YYYY-MM-DD (must match
// build-library-fixture.mjs's own override if both are regenerated together).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const rosterFixturePath = resolve(here, "library-roster.fixture.json");

const libraryExportPath = process.argv[2] ?? "/tmp/real_library.json";

const INSTALL_DATE = new Date(`${process.env.CURFEW_FIXTURE_INSTALL_DATE ?? "2025-01-01"}T00:00:00Z`);
// An unparseable override yields `Invalid Date`, and every `<` comparison
// against it is false -- so every entry would silently emit `is_baseline: false`
// and disagree with build-library-fixture.mjs, which this file's header
// requires it to match (Story 4.11 code review).
if (Number.isNaN(INSTALL_DATE.getTime())) {
  throw new Error(
    `CURFEW_FIXTURE_INSTALL_DATE is not a parseable YYYY-MM-DD date: ` +
      `${JSON.stringify(process.env.CURFEW_FIXTURE_INSTALL_DATE)}`,
  );
}

if (!existsSync(libraryExportPath)) {
  console.error(
    `no library export at ${libraryExportPath}\n\n` +
      `Produce one first (read-only, emits no paths -- title/artist DO cross\n` +
      `the seam as of Story 4.11, same category as SyncPlay's per-play fields):\n` +
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

const entries = library
  .map((track) => ({
    track_id: track.track_id,
    title: track.title ?? null,
    artist: track.artist ?? null,
    added_at: toIso(track.added_at),
    is_baseline: track.added_at != null && new Date(track.added_at * 1000) < INSTALL_DATE,
    absent_at: null,
  }))
  // Stable order so re-running against an unchanged library diffs cleanly.
  .sort((a, b) => a.track_id.localeCompare(b.track_id));

// The exporter's own stderr line already prints `no_identity`/`total` — the
// export JSON itself only ever contains identifiable rows (a track with no
// resolvable title/artist has no track_id to appear under at all, AD-11), so
// this builder cannot recompute the exclusion count from `library` alone.
// Read it from the exporter's own printed summary instead of re-deriving it
// a second way: CURFEW_EXCLUDED_NO_IDENTITY/CURFEW_TOTAL_CATALOGUE_ROWS, set
// by hand from that run's stdout line ("N/M catalogue rows had no resolvable
// title+artist and were excluded") — documented rather than silently
// defaulted to 0, which would silently under-disclose a real, measured gap.
//
// Both are REQUIRED, not defaulted (Story 4.11 code review). They previously
// defaulted to 0, which makes `unidentifiableTracksDisclosure` return null and
// the disclosure vanish from the page entirely -- the exact silent
// under-disclosure AC-6 exists to end -- behind nothing but a stderr warning
// nobody reads in a passing build. A regeneration that cannot state the real
// numbers must fail loudly instead of quietly shipping a fixture that claims
// there is no gap.
const requiredCount = (name) => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    throw new Error(
      `${name} is required. Copy it from the exporter's own stdout line\n` +
        `  "N/M catalogue rows had no resolvable title+artist and were excluded"\n` +
        `Defaulting it would silently under-disclose a real, measured gap (AC-6).`,
    );
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number, got ${JSON.stringify(raw)}`);
  }
  return value;
};

const excludedNoIdentityCount = requiredCount("CURFEW_EXCLUDED_NO_IDENTITY");
// Deliberately NOT defaulted to `entries.length + excludedNoIdentityCount`:
// `entries` is post-dedup, so that sum understates the real catalogue size
// (925 vs the measured 910/930 depending on scope) and would quietly inflate
// the computed exclusion rate past the materiality bar.
const totalCatalogueRows = requiredCount("CURFEW_TOTAL_CATALOGUE_ROWS");
if (totalCatalogueRows < excludedNoIdentityCount) {
  throw new Error(
    `CURFEW_TOTAL_CATALOGUE_ROWS (${totalCatalogueRows}) cannot be smaller than ` +
      `CURFEW_EXCLUDED_NO_IDENTITY (${excludedNoIdentityCount}) -- the exclusions are a ` +
      `subset of the catalogue rows.`,
  );
}

const baselined = entries.filter((e) => e.is_baseline).length;
const undated = entries.filter((e) => e.added_at === null).length;

writeFileSync(
  rosterFixturePath,
  `${JSON.stringify({ entries, excludedNoIdentityCount, totalCatalogueRows }, null, 2)}\n`,
);

console.error(
  [
    `library export:       ${library.length} identifiable tracks`,
    `  baselined (pre-${INSTALL_DATE.toISOString().slice(0, 10)}): ${baselined} -- reach the roster (unlike library_track_events), never cohort math`,
    `  undated:             ${undated}`,
    `  -> roster entries:   ${entries.length}`,
    `excluded (no title/artist at all): ${excludedNoIdentityCount} of ${totalCatalogueRows} total catalogue rows` +
      ` (${totalCatalogueRows ? Math.round((100 * excludedNoIdentityCount) / totalCatalogueRows) : 0}%)`,
  ].join("\n"),
);
