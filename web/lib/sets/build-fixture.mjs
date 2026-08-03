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
