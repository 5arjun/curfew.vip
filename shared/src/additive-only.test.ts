import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const baseline = JSON.parse(
  readFileSync(resolvePath(packageRoot, "schema/sync-payload.schema.frozen-baseline.json"), "utf8"),
);
const current = JSON.parse(
  readFileSync(resolvePath(packageRoot, "schema/sync-payload.schema.json"), "utf8"),
);

/** Resolves a single-level `$ref` (`"#/$defs/xxx"`) against its own schema root. */
function resolveRef(node: any, root: any): any {
  if (node && typeof node === "object" && typeof node.$ref === "string") {
    const key = node.$ref.replace("#/$defs/", "");
    return root.$defs[key];
  }
  return node;
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

  if (bNode.required) {
    expect(cNode.required, `${path}: lost its "required" array`).toBeDefined();
    for (const key of bNode.required) {
      expect(
        cNode.required,
        `${path}: "${key}" was removed from required — AD-15 forbids this`,
      ).toContain(key);
    }
  }

  if (bNode.items) {
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

describe("sync-payload.schema.json additive-only guard (AC-3, AD-15)", () => {
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
