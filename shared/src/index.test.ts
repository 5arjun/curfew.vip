import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  SEGMENT_TYPE,
  SOURCE,
  SYNC_LIBRARY_ADD_EVENTS_SCHEMA_PATH,
  SYNC_PAYLOAD_SCHEMA_PATH,
  VISIBILITY,
  type SyncLibraryAddEvent,
  type SyncLibraryAddEventBatch,
  type SyncPlay,
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
    const requiredProperties = [
      "position",
      "title",
      "artist",
      "started_at",
      "bpm",
      "genre",
      "camelot_key",
      "in_library",
    ];
    // played_ms + library_added_at were added post-freeze (Story 3.7 §3d), and
    // track_id post-freeze again (Story 4.2 D-2, resolving Story 1.10's Open
    // Question #1) — all optional per AD-15: present in `properties`,
    // deliberately absent from `required` (same pattern as
    // SyncSetDerived.subgenre_breakdown below).
    const allProperties = [...requiredProperties, "played_ms", "library_added_at", "track_id"];
    const playSchema = schema.$defs.play;
    expect(Object.keys(playSchema.properties).sort()).toEqual([...allProperties].sort());
    expect(playSchema.required.slice().sort()).toEqual([...requiredProperties].sort());
  });

  it("matches the full SyncSetDerived required array and property set", () => {
    // Mirrors shared/src/index.ts's SyncSetDerived interface fields verbatim (Story 1.10 Task 3).
    const requiredProperties = [
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
    // subgenre_breakdown was added post-freeze (taxonomy v2) and is optional per
    // AD-15 — present in `properties` but deliberately absent from `required`.
    const allProperties = [...requiredProperties, "subgenre_breakdown"];
    const derivedSchema = schema.$defs.derived;
    expect(Object.keys(derivedSchema.properties).sort()).toEqual([...allProperties].sort());
    expect(derivedSchema.required.slice().sort()).toEqual([...requiredProperties].sort());
  });

  it("matches the full SessionConfidence-derived confidence required array and property set", () => {
    const expectedProperties = ["value", "track_count", "long_gap_count"];
    const confidenceSchema = schema.$defs.confidence;
    expect(Object.keys(confidenceSchema.properties).sort()).toEqual([...expectedProperties].sort());
    expect(confidenceSchema.required.slice().sort()).toEqual([...expectedProperties].sort());
  });

  it("carries track_id as an optional, nullable string (Story 4.2 D-2, AD-15)", () => {
    const trackId = schema.$defs.play.properties.track_id;
    expect(trackId.type).toEqual(["string", "null"]);
    expect(schema.$defs.play.required).not.toContain("track_id");

    // A play may legally omit it entirely, carry it null, or carry the hash —
    // all three round-trip, which is what "additive" has to mean at the type
    // level too, not just in the schema file.
    const omitted: SyncPlay = {
      position: 1,
      title: null,
      artist: null,
      started_at: null,
      bpm: null,
      genre: null,
      camelot_key: null,
      in_library: false,
    };
    expect(omitted.track_id).toBeUndefined();
    expect({ ...omitted, track_id: null }.track_id).toBeNull();
    expect({ ...omitted, track_id: "a1b2c3d4e5f60718" }.track_id).toBe("a1b2c3d4e5f60718");
  });
});

/**
 * Story 4.2's second wire artifact (AD-21). Deliberately its own describe block
 * and its own schema file: an add-event is not set-scoped, so it never becomes
 * part of `SyncPayload` (see `SyncLibraryAddEvent`'s doc comment).
 */
describe("@curfew/shared library add-event batch (Story 4.2)", () => {
  const addEventSchemaPath = resolve(packageRoot, SYNC_LIBRARY_ADD_EVENTS_SCHEMA_PATH);
  const schema = JSON.parse(readFileSync(addEventSchemaPath, "utf8"));

  it("exposes the add-event schema as parseable JSON at the exported path", () => {
    expect(schema).toBeTypeOf("object");
    expect(schema.$id).toContain("sync-library-add-events");
  });

  it("agrees with the payload schema on contract version", () => {
    expect(schema.properties.contract_version.const).toBe(CONTRACT_VERSION);
  });

  it("matches SyncLibraryAddEventBatch's required array and property set", () => {
    const expectedProperties = ["contract_version", "agent_version", "events"];
    expect(Object.keys(schema.properties).sort()).toEqual([...expectedProperties].sort());
    expect(schema.required.slice().sort()).toEqual([...expectedProperties].sort());
  });

  it("matches SyncLibraryAddEvent's required array and property set", () => {
    const expectedProperties = ["track_id", "added_at"];
    const event = schema.$defs.library_add_event;
    expect(Object.keys(event.properties).sort()).toEqual([...expectedProperties].sort());
    expect(event.required.slice().sort()).toEqual([...expectedProperties].sort());
  });

  it("requires a real track_id but allows a null added_at (AD-11: absent, never guessed)", () => {
    const event = schema.$defs.library_add_event;
    expect(event.properties.track_id.type).toBe("string");
    expect(event.properties.track_id.minLength).toBe(1);
    expect(event.properties.added_at.type).toEqual(["string", "null"]);

    const unknownDate: SyncLibraryAddEvent = { track_id: "a1b2c3d4e5f60718", added_at: null };
    const knownDate: SyncLibraryAddEvent = {
      track_id: "0718a1b2c3d4e5f6",
      added_at: "2026-03-14T08:00:00.000Z",
    };
    const batch: SyncLibraryAddEventBatch = {
      contract_version: CONTRACT_VERSION,
      agent_version: "0.1.0",
      events: [unknownDate, knownDate],
    };
    expect(batch.events).toHaveLength(2);
    expect(batch.events[0]?.added_at).toBeNull();
  });

  it("refuses unknown properties on both the batch and each event", () => {
    expect(schema.additionalProperties).toBe(false);
    expect(schema.$defs.library_add_event.additionalProperties).toBe(false);
  });
});
