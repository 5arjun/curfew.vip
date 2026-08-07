// Fixture builder (Story 3.6 Task 4): converts the agent's local-shape export
// (epoch timestamps) into the frozen wire-shape `SyncPayload["set"]` the
// dashboard reads, doing the epoch → ISO-8601 conversion the frozen contract
// requires at "payload-build time" (shared/src/index.ts: `started_at` is ISO on
// the wire; the agent stores/emits Unix epoch seconds and has no chrono).
//
// The input is produced, read-only, from the DJ's real master.sqlite by:
//   CURFEW_REAL_MASTER=".../master.sqlite" CURFEW_FIXTURE_OUT=/tmp/real_sets.json \
//   cargo test --test export_real_fixtures -- --ignored --nocapture
// (agent/src-tauri/tests/export_real_fixtures.rs). Real Serato data is never
// committed; only this derived, non-identifying per-set stat payload is.
//
// Usage: node build-fixture.mjs <local-shape-export.json> > recent-sets.fixture.json
//
// Story 4.2: `track_id` now comes straight off the export (the agent computes
// it in `capture::assemble`), so this builder carries real path-derived
// identity. Run `node build-library-fixture.mjs` AFTERWARDS to produce the
// matching `library-add-events.fixture.json` — that is the DENOMINATOR half
// (tracks bought and never played), which no play-derived export can contain.
// Regenerating this file without that second pass leaves the
// library-conversion chart joining against a stale add-event list.
import { readFileSync } from "node:fs";

const toIso = (epochSeconds) =>
  epochSeconds == null ? null : new Date(epochSeconds * 1000).toISOString();

const src = JSON.parse(readFileSync(process.argv[2], "utf8"));

const sets = src
  .map((s) => ({
    external_id: s.external_id,
    started_at: toIso(s.started_at),
    ended_at: toIso(s.ended_at),
    plays: s.plays.map((p) => ({
      position: p.position,
      title: p.title,
      artist: p.artist,
      started_at: toIso(p.started_at),
      bpm: p.bpm,
      genre: p.genre
        ? {
            raw: p.genre.raw,
            normalized: p.genre.normalized,
            taxonomy_version: p.genre.taxonomy_version,
            subgenre: p.genre.subgenre,
          }
        : null,
      camelot_key: p.camelot_key ?? null,
      in_library: p.in_library,
      // Story 3.7 (§3d): the two wire-promoted capture fields. played_ms is
      // carried verbatim (already ms); library_added_at gets the same
      // epoch→ISO conversion as started_at.
      played_ms: p.played_ms ?? null,
      library_added_at: toIso(p.library_added_at),
      // Story 4.2 (D-2): the opaque path-derived identity the agent computes
      // (`capture::track_id`). Carried verbatim — it is already a hash, and it
      // is what joins a play to its library add-event. Present on every play
      // from an export taken at or after Story 4.2; `null` on older exports.
      track_id: p.track_id ?? null,
    })),
    derived: {
      ...s.derived,
      energy_arc: s.derived.energy_arc.map((pt) => ({
        started_at: toIso(pt.started_at),
        bpm: pt.bpm,
      })),
    },
  }))
  // Dashboard shows recent sets newest-first.
  .sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""));

process.stdout.write(JSON.stringify(sets, null, 2) + "\n");
