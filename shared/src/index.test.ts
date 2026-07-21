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
 * and every AR-15 enum + the contract version must match on both sides.
 */
describe("@curfew/shared draft contract", () => {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

  it("exposes the draft payload schema as parseable JSON", () => {
    expect(schema).toBeTypeOf("object");
    expect(schema.$id).toContain("sync-payload");
  });

  it("keeps the source enum consistent across TS and JSON-schema", () => {
    expect(schema.properties.source.enum).toEqual([...SOURCE]);
  });

  it("keeps the visibility enum consistent across TS and JSON-schema", () => {
    expect(schema.properties.set.properties.visibility.enum).toEqual([...VISIBILITY]);
  });

  it("keeps the segment-type enum consistent across TS and JSON-schema", () => {
    expect(schema.$defs.segment.properties.type.enum).toEqual([...SEGMENT_TYPE]);
  });

  it("keeps the contract version consistent across TS and JSON-schema", () => {
    expect(schema.properties.contract_version.const).toBe(CONTRACT_VERSION);
  });
});
