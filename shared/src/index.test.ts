import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  SEGMENT_TYPE,
  SOURCE,
  SYNC_PAYLOAD_SCHEMA_PATH,
  VISIBILITY,
} from "./index";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = resolve(packageRoot, SYNC_PAYLOAD_SCHEMA_PATH);

/**
 * The contract has two consumers (web = these TS exports, agent = the JSON-schema
 * file). This test is the guard that they never drift: the JSON schema must parse,
 * every AR-15 enum + the contract version must match on both sides, and (per Story
 * 1.10 Task 5.3, closing the Story 1.1 review's "shallow TS<->schema parity check"
 * deferred-work.md gap) the full required/property sets of the frozen shape match
 * too — not just enums.
 */
describe("@curfew/shared frozen contract", () => {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

  it("exposes the frozen payload schema as parseable JSON", () => {
    expect(schema).toBeTypeOf("object");
    expect(schema.$id).toContain("sync-payload");
  });

  it("keeps the source enum consistent across TS and JSON-schema", () => {
    expect(schema.properties.source.enum).toEqual([...SOURCE]);
  });

  it("keeps the contract version consistent across TS and JSON-schema", () => {
    expect(schema.properties.contract_version.const).toBe(CONTRACT_VERSION);
  });

  it("still exports the VISIBILITY/SegmentType AR-15 enums for future cloud-side use", () => {
    // Story 1.10 Task 1: these enums stay exported from shared/ (the `sets` table's
    // visibility column and the future Epic 5 `segments` table will use them) —
    // only their *presence inside the sync payload* was wrong, and is removed below.
    expect(VISIBILITY).toEqual(["public", "friends_only", "private"]);
    expect(SEGMENT_TYPE).toEqual(["dancefloor", "dinner", "performance", "custom"]);
  });

  it("never puts set.visibility on the outbound payload (AD-6/AD-16 overlay disjointness)", () => {
    expect(schema.properties.set.properties.visibility).toBeUndefined();
    expect(schema.properties.set.required).not.toContain("visibility");
  });

  it("never puts a top-level segments array on the outbound payload (AD-6/AD-16 overlay disjointness)", () => {
    expect(schema.properties.segments).toBeUndefined();
    expect(schema.required).not.toContain("segments");
    expect(schema.$defs.segment).toBeUndefined();
  });

  it("matches the full top-level SyncPayload required array and property set", () => {
    // Mirrors shared/src/index.ts's SyncPayload interface fields verbatim.
    const expectedProperties = ["contract_version", "agent_version", "source", "set"];
    expect(Object.keys(schema.properties).sort()).toEqual([...expectedProperties].sort());
    expect(schema.required.slice().sort()).toEqual([...expectedProperties].sort());
  });

  it("matches the full SyncPayload.set required array and property set", () => {
    const expectedProperties = ["external_id", "started_at", "ended_at", "plays", "derived"];
    const setSchema = schema.properties.set;
    expect(Object.keys(setSchema.properties).sort()).toEqual([...expectedProperties].sort());
    expect(setSchema.required.slice().sort()).toEqual([...expectedProperties].sort());
  });

  it("matches the full SyncPlay required array and property set", () => {
    // Mirrors shared/src/index.ts's SyncPlay interface fields verbatim (Story 1.10 Task 2).
    const expectedProperties = [
      "position",
      "title",
      "artist",
      "started_at",
      "bpm",
      "genre",
      "camelot_key",
      "in_library",
    ];
    const playSchema = schema.$defs.play;
    expect(Object.keys(playSchema.properties).sort()).toEqual([...expectedProperties].sort());
    expect(playSchema.required.slice().sort()).toEqual([...expectedProperties].sort());
  });

  it("matches the full SyncSetDerived required array and property set", () => {
    // Mirrors shared/src/index.ts's SyncSetDerived interface fields verbatim (Story 1.10 Task 3).
    const expectedProperties = [
      "most_played_tracks",
      "most_played_artists",
      "genre_breakdown",
      "bpm_distribution",
      "camelot_mixing_stats",
      "set_length_sec",
      "track_count",
      "energy_arc",
      "confidence",
    ];
    const derivedSchema = schema.$defs.derived;
    expect(Object.keys(derivedSchema.properties).sort()).toEqual([...expectedProperties].sort());
    expect(derivedSchema.required.slice().sort()).toEqual([...expectedProperties].sort());
  });

  it("matches the full SessionConfidence-derived confidence required array and property set", () => {
    const expectedProperties = ["value", "track_count", "long_gap_count"];
    const confidenceSchema = schema.$defs.confidence;
    expect(Object.keys(confidenceSchema.properties).sort()).toEqual([...expectedProperties].sort());
    expect(confidenceSchema.required.slice().sort()).toEqual([...expectedProperties].sort());
  });
});
