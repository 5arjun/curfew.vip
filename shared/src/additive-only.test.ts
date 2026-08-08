import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const packageRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

const readSchema = (name: string) =>
  JSON.parse(readFileSync(resolvePath(packageRoot, "schema", name), "utf8"));

/**
 * Every wire artifact under the AD-15 additive-only guard, each paired with
 * the frozen snapshot it may only ever grow away from.
 *
 * Story 4.2 added the second entry: its `SyncLibraryAddEventBatch` is a new,
 * separate payload (AD-21's sanctioned second agent write), and it gets the
 * same CI regression protection from birth rather than inheriting none just
 * because it wasn't part of Story 1.10's original freeze. Story 4.11 adds the
 * third, `SyncLibraryRosterBatch` (AD-22), for the same reason.
 */
const SCHEMA_PAIRS = [
  {
    name: "sync-payload.schema.json",
    baseline: readSchema("sync-payload.schema.frozen-baseline.json"),
    current: readSchema("sync-payload.schema.json"),
  },
  {
    name: "sync-library-add-events.schema.json",
    baseline: readSchema("sync-library-add-events.schema.frozen-baseline.json"),
    current: readSchema("sync-library-add-events.schema.json"),
  },
  {
    name: "sync-library-roster.schema.json",
    baseline: readSchema("sync-library-roster.schema.frozen-baseline.json"),
    current: readSchema("sync-library-roster.schema.json"),
  },
] as const;

/** The pair currently under assertion — the roots `$ref`s resolve against. */
let baseline: any = SCHEMA_PAIRS[0].baseline;
let current: any = SCHEMA_PAIRS[0].current;

/** Resolves a (possibly chained) `$ref` (`"#/$defs/xxx"`) against its own schema root. */
function resolveRef(node: any, root: any): any {
  let resolved = node;
  while (resolved && typeof resolved === "object" && typeof resolved.$ref === "string") {
    const key = resolved.$ref.replace("#/$defs/", "");
    resolved = root.$defs[key];
  }
  return resolved;
}

/** All primitive JSON-schema `type`s a node can take on, resolving `$ref`/`oneOf`. */
function collectTypes(node: any, root: any): Set<string> {
  const resolved = resolveRef(node, root);
  if (resolved.oneOf) {
    const types = new Set<string>();
    for (const branch of resolved.oneOf) {
      for (const t of collectTypes(branch, root)) types.add(t);
    }
    return types;
  }
  if (resolved.type === undefined) return new Set();
  return new Set(Array.isArray(resolved.type) ? resolved.type : [resolved.type]);
}

/**
 * Walks a baseline schema node and asserts every property, `required` entry, and
 * type it declares is still present (possibly widened) in the current schema — the
 * mechanical, CI-enforced form of AC-3's "only additive changes pass" (AD-15).
 * New properties present only in `current` pass freely; that's what "additive" means.
 */
function assertAdditiveOnly(path: string, baselineNode: any, currentNode: any): void {
  const bNode = resolveRef(baselineNode, baseline);
  const cNode = resolveRef(currentNode, current);

  const bTypes = collectTypes(bNode, baseline);
  const cTypes = collectTypes(cNode, current);
  for (const t of bTypes) {
    expect(cTypes.has(t), `${path}: type "${t}" was removed — AD-15 forbids narrowing/retyping`).toBe(
      true,
    );
  }

  if (bNode.properties) {
    expect(cNode.properties, `${path}: lost its "properties" object`).toBeDefined();
    for (const key of Object.keys(bNode.properties)) {
      expect(
        cNode.properties[key],
        `${path}.${key}: property removed from the frozen baseline — AD-15 forbids this`,
      ).toBeDefined();
      assertAdditiveOnly(`${path}.${key}`, bNode.properties[key], cNode.properties[key]);
    }
  }

  const bRequired: string[] = bNode.required ?? [];
  if (bNode.required) {
    expect(cNode.required, `${path}: lost its "required" array`).toBeDefined();
    for (const key of bRequired) {
      expect(
        cNode.required,
        `${path}: "${key}" was removed from required — AD-15 forbids this`,
      ).toContain(key);
    }
  }
  for (const key of cNode.required ?? []) {
    expect(
      bRequired,
      `${path}: "${key}" was newly added to required — AD-15 forbids adding a new required field (old payloads don't carry it)`,
    ).toContain(key);
  }

  if (bNode.enum) {
    expect(cNode.enum, `${path}: lost its "enum" constraint`).toBeDefined();
    for (const value of bNode.enum) {
      expect(
        cNode.enum,
        `${path}: enum value ${JSON.stringify(value)} was removed — AD-15 forbids narrowing an enum`,
      ).toContainEqual(value);
    }
  }

  if (bNode.const !== undefined) {
    expect(
      cNode.const,
      `${path}: "const" changed from ${JSON.stringify(bNode.const)} to ${JSON.stringify(cNode.const)} — AD-15 forbids this`,
    ).toEqual(bNode.const);
  }

  if (bNode.pattern !== undefined) {
    expect(cNode.pattern, `${path}: lost its "pattern" constraint`).toBeDefined();
  }

  if (bNode.items) {
    expect(cNode.items, `${path}: lost its "items" schema`).toBeDefined();
    assertAdditiveOnly(`${path}[]`, bNode.items, cNode.items);
  }

  if (bNode.oneOf) {
    expect(cNode.oneOf, `${path}: lost its "oneOf"`).toBeDefined();
    for (const bBranch of bNode.oneOf) {
      const bBranchTypes = collectTypes(bBranch, baseline);
      const cBranch = cNode.oneOf.find((candidate: any) => {
        const cBranchTypes = collectTypes(candidate, current);
        return [...bBranchTypes].some((t) => cBranchTypes.has(t));
      });
      expect(
        cBranch,
        `${path}: oneOf branch [${[...bBranchTypes].join(", ")}] missing in current`,
      ).toBeDefined();
      assertAdditiveOnly(`${path}(oneOf)`, bBranch, cBranch);
    }
  }
}

describe.each(SCHEMA_PAIRS)("$name additive-only guard (AC-3, AD-15)", (pair) => {
  beforeEach(() => {
    baseline = pair.baseline;
    current = pair.current;
  });

  it("keeps every baseline property, required entry, and type present in the current schema", () => {
    assertAdditiveOnly("root", baseline, current);
  });

  it("keeps every baseline $defs entry present in the current schema's $defs", () => {
    for (const defName of Object.keys(baseline.$defs ?? {})) {
      expect(
        current.$defs?.[defName],
        `$defs.${defName} was removed from the frozen baseline`,
      ).toBeDefined();
      assertAdditiveOnly(`$defs.${defName}`, baseline.$defs[defName], current.$defs[defName]);
    }
  });
});

/**
 * The guard's own regression test: a hand-built "someone narrowed a field"
 * mutation must actually fail. Without this, every assertion above could be
 * silently vacuous (`describe.each` + shared roots is exactly the shape that
 * goes quietly inert) and nobody would notice until a real narrowing shipped.
 */
describe("the additive-only guard itself", () => {
  it("rejects a narrowed field, a dropped property, and a newly-required field", () => {
    const original = { baseline, current };
    try {
      baseline = {
        type: "object",
        required: ["a"],
        properties: { a: { type: ["string", "null"] }, b: { type: "string" } },
      };

      current = {
        type: "object",
        required: ["a"],
        properties: { a: { type: "string" }, b: { type: "string" } },
      };
      expect(() => assertAdditiveOnly("root", baseline, current)).toThrow();

      current = { type: "object", required: ["a"], properties: { a: { type: ["string", "null"] } } };
      expect(() => assertAdditiveOnly("root", baseline, current)).toThrow();

      current = {
        type: "object",
        required: ["a", "b"],
        properties: { a: { type: ["string", "null"] }, b: { type: "string" } },
      };
      expect(() => assertAdditiveOnly("root", baseline, current)).toThrow();
    } finally {
      baseline = original.baseline;
      current = original.current;
    }
  });
});
