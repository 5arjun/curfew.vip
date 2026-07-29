import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const current = JSON.parse(
  readFileSync(resolvePath(packageRoot, "schema/sync-payload.schema.json"), "utf8"),
);

/**
 * Property names that would suggest a raw file path or binary blob crossing the
 * wire (Story 2.7 AC-2/AC-3, AD-2). `raw` is included because it is the obvious
 * name a future author would reach for to carry file bytes — the one legitimate
 * use today is `genre.raw` (a normalized *string*, the un-bucketed genre tag),
 * which [`isReviewedRawException`] scopes out rather than weakening this list.
 */
const FORBIDDEN_PROPERTY_NAMES = ["path", "file_path", "raw", "blob", "bytes", "data_url", "base64"];

/** `format`/`contentEncoding` values that would mark a string as binary content. */
const BINARY_STRING_HINTS = ["binary", "byte"];

/**
 * Resolves a (possibly chained) `$ref` (`"#/$defs/xxx"`) against the schema root.
 * Guards against a cyclic `$ref` chain (e.g. two `$defs` aliasing each other)
 * hanging the resolution loop itself — this is a stricter, earlier guard than
 * `assertNoRawData`'s own `seen` set, which only runs after a node resolves.
 */
function resolveRef(node: any, root: any): any {
  let resolved = node;
  const visitedRefs = new Set<string>();
  while (resolved && typeof resolved === "object" && typeof resolved.$ref === "string") {
    if (visitedRefs.has(resolved.$ref)) {
      throw new Error(`cyclic $ref chain detected at ${resolved.$ref}`);
    }
    visitedRefs.add(resolved.$ref);
    const key = resolved.$ref.replace("#/$defs/", "");
    resolved = root.$defs[key];
  }
  return resolved;
}

/**
 * True only for the `raw` property declared directly on the `genre` definition
 * — the one already-reviewed field this name is allowed for (see
 * `shared/src/index.ts`'s `SyncPlay` doc comment and
 * `deferred-work.md`'s "Raw file `path` deliberately excluded..." entry).
 * Checked by object identity against the actual `$defs.genre` node (not by
 * matching "genre" in a path string), so a future def that merely happens to
 * be named or nested under something ending in "genre" can't inherit this
 * exception, and a legitimate rename of `genre` fails closed rather than
 * silently passing for the wrong reason.
 */
function isReviewedRawException(propertyName: string, parentNode: any): boolean {
  return propertyName === "raw" && parentNode === current.$defs?.genre;
}

/**
 * Walks one schema node (resolving `$ref`s) and asserts, at every level:
 * - no property name looks like it could carry a raw path or file blob (AC-2/AC-3);
 * - every object declares `additionalProperties: false`, so only fields this
 *   schema explicitly defines can ever be present (the structural guarantee
 *   AC-3's test pins, not just a convention);
 * - no string-typed property is marked as binary content (`contentEncoding`,
 *   a binary-suggestive `format`, or `contentMediaType`).
 *
 * Mirrors `additive-only.test.ts`'s walk (`$ref`/`oneOf`/`items` traversal,
 * cycle guard) rather than reinventing it, extended to also walk `allOf` and
 * `patternProperties` — the other JSON Schema composition/property shapes a
 * raw-data field could hide behind.
 */
function assertNoRawData(path: string, node: any, seen: Set<string>): void {
  const resolved = resolveRef(node, current);
  if (!resolved || typeof resolved !== "object") return;
  if (seen.has(path)) return; // cycle guard — no cyclic $defs today, but cheap to keep
  seen.add(path);

  const types = Array.isArray(resolved.type)
    ? resolved.type
    : resolved.type
      ? [resolved.type]
      : [];

  if (resolved.properties || resolved.patternProperties || types.includes("object")) {
    expect(
      resolved.additionalProperties,
      `${path}: every object must declare additionalProperties: false, so only explicitly-defined fields can ever be present`,
    ).toBe(false);
  }

  if (types.includes("string")) {
    expect(
      resolved.contentEncoding,
      `${path}: a string property must never declare contentEncoding — that would mark it as binary content`,
    ).toBeUndefined();
    expect(
      resolved.contentMediaType,
      `${path}: a string property must never declare contentMediaType — that would mark it as binary/media content`,
    ).toBeUndefined();
    if (typeof resolved.format === "string") {
      expect(
        BINARY_STRING_HINTS.includes(resolved.format),
        `${path}: format "${resolved.format}" reads as binary content, which must never cross the wire`,
      ).toBe(false);
    }
  }

  if (resolved.properties) {
    for (const key of Object.keys(resolved.properties)) {
      expect(
        FORBIDDEN_PROPERTY_NAMES.includes(key) && !isReviewedRawException(key, resolved),
        `${path}.${key}: property name suggests a raw file path or blob — raw data must never cross the wire (AD-2)`,
      ).toBe(false);
      assertNoRawData(`${path}.${key}`, resolved.properties[key], seen);
    }
  }

  if (resolved.patternProperties) {
    for (const pattern of Object.keys(resolved.patternProperties)) {
      assertNoRawData(`${path}{${pattern}}`, resolved.patternProperties[pattern], seen);
    }
  }

  if (resolved.items) {
    assertNoRawData(`${path}[]`, resolved.items, seen);
  }

  if (resolved.oneOf) {
    resolved.oneOf.forEach((branch: any, i: number) => {
      assertNoRawData(`${path}(oneOf:${i})`, branch, seen);
    });
  }

  if (resolved.allOf) {
    resolved.allOf.forEach((branch: any, i: number) => {
      assertNoRawData(`${path}(allOf:${i})`, branch, seen);
    });
  }
}

describe("sync-payload.schema.json carries no raw file path or blob (AC-2, AC-3, AD-2)", () => {
  it("has no forbidden-named property, keeps additionalProperties:false everywhere, and marks no string as binary, walking from root", () => {
    assertNoRawData("root", current, new Set());
  });

  it("re-checks every $defs entry directly, so an orphaned def can't hide a violation", () => {
    for (const defName of Object.keys(current.$defs ?? {})) {
      assertNoRawData(`$defs.${defName}`, current.$defs[defName], new Set());
    }
  });

  it("still allows the one reviewed exception, genre.raw, as a normalized string field", () => {
    const genre = current.$defs.genre;
    expect(genre.properties.raw).toEqual({ type: "string" });
  });
});
