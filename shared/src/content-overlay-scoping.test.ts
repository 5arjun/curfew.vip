import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolvePath(packageRoot, "..");
const schema = JSON.parse(
  readFileSync(resolvePath(packageRoot, "schema/sync-payload.schema.json"), "utf8"),
);

/**
 * The canonical, documented overlay-column allowlist (Story 3.1 AC-3/AD-16):
 * web-authored, agent-never-writes columns, kept disjoint from every content
 * column a sync write path may touch. Today this is exactly one column,
 * `sets.visibility` (Story 3.1's schema comments; `plays` carries no overlay
 * column yet, per Story 3.2's Dev Notes). Extend this map, not the tests
 * below, the day a second overlay column ships (e.g. Epic 5's segment
 * edits) — the two assertions in this file automatically re-check the new
 * entry against both the wire schema and the write-path migration.
 */
const OVERLAY_COLUMNS: Record<string, string[]> = {
  sets: ["visibility"],
};

/**
 * Resolves a (possibly chained) `$ref` (`"#/$defs/xxx"`) against the schema
 * root, with a cycle guard — mirrors `no-raw-data.test.ts`'s `resolveRef`
 * rather than reinventing it.
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
 * Walks one schema node (resolving `$ref`/`oneOf`/`allOf`/`items`, cycle
 * guarded) and asserts no property name anywhere matches any overlay column
 * name in [`OVERLAY_COLUMNS`] — mirrors `no-raw-data.test.ts`'s
 * `assertNoRawData` walk shape, applied to a different forbidden-name list.
 */
function assertNoOverlayColumnName(
  path: string,
  node: any,
  seen: Set<string>,
  forbiddenNames: Set<string>,
): void {
  const resolved = resolveRef(node, schema);
  if (!resolved || typeof resolved !== "object") return;
  if (seen.has(path)) return;
  seen.add(path);

  if (resolved.properties) {
    for (const key of Object.keys(resolved.properties)) {
      expect(
        forbiddenNames.has(key),
        `${path}.${key}: property name matches a documented overlay column -- overlay columns are ` +
          `web-authored only and must never appear in the agent's outbound sync shape (AC-3, AD-16)`,
      ).toBe(false);
      assertNoOverlayColumnName(`${path}.${key}`, resolved.properties[key], seen, forbiddenNames);
    }
  }

  if (resolved.items) {
    assertNoOverlayColumnName(`${path}[]`, resolved.items, seen, forbiddenNames);
  }

  if (resolved.oneOf) {
    resolved.oneOf.forEach((branch: any, i: number) => {
      assertNoOverlayColumnName(`${path}(oneOf:${i})`, branch, seen, forbiddenNames);
    });
  }

  if (resolved.allOf) {
    resolved.allOf.forEach((branch: any, i: number) => {
      assertNoOverlayColumnName(`${path}(allOf:${i})`, branch, seen, forbiddenNames);
    });
  }
}

/**
 * Finds the Supabase migration file defining `public.sync_set` (Story 3.2,
 * Task 2's `SECURITY DEFINER` write path) by content, not by a hardcoded
 * filename -- migration files are timestamp-prefixed and immutable once
 * committed, so a future story adding another migration must not silently
 * break this lookup.
 */
function findSyncSetMigrationText(): string {
  const migrationsDir = resolvePath(repoRoot, "supabase/migrations");
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  for (const file of files) {
    const text = readFileSync(resolvePath(migrationsDir, file), "utf8");
    if (/create\s+function\s+public\.sync_set/i.test(text)) {
      return text;
    }
  }
  throw new Error(
    "no migration under supabase/migrations defines public.sync_set -- " +
      "this test's write-path assertion has nothing to check against",
  );
}

/**
 * Extracts just `create function public.sync_set(...) ... as $$ ... $$` --
 * signature (the parameter list an overlay column must never appear in) plus
 * dollar-quoted body (the SET clause an overlay column must never appear
 * in) -- then strips `--` line comments. Scoping to this span (rather than
 * the whole migration file) and stripping comments matters because this
 * migration's own prose comments legitimately *name* the overlay column
 * repeatedly to explain why it's withheld (see the migration file itself) --
 * a naive whole-file substring search would flag its own documentation.
 */
function extractSyncSetDefinitionCode(migrationText: string): string {
  const match = migrationText.match(/create\s+function\s+public\.sync_set[\s\S]*?\$\$[\s\S]*?\$\$/i);
  if (!match) {
    throw new Error("could not isolate the sync_set function definition from its migration file");
  }
  return match[0]
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("content/overlay column scoping stays in sync across the wire shape and the write path (AC-3, AC-5)", () => {
  it("the frozen sync-payload schema never carries a documented overlay column's name", () => {
    const forbiddenNames = new Set(Object.values(OVERLAY_COLUMNS).flat());
    assertNoOverlayColumnName("root", schema, new Set(), forbiddenNames);
  });

  it("re-checks every $defs entry directly, so an orphaned def can't hide a violation", () => {
    const forbiddenNames = new Set(Object.values(OVERLAY_COLUMNS).flat());
    for (const defName of Object.keys(schema.$defs ?? {})) {
      assertNoOverlayColumnName(`$defs.${defName}`, schema.$defs[defName], new Set(), forbiddenNames);
    }
  });

  it("the sync_set function's own signature + body never mentions a documented overlay column", () => {
    const definitionCode = extractSyncSetDefinitionCode(findSyncSetMigrationText());
    for (const [table, columns] of Object.entries(OVERLAY_COLUMNS)) {
      for (const column of columns) {
        expect(
          definitionCode.includes(column),
          `sync_set's parameter list + body must never reference overlay column "${table}.${column}" -- ` +
            `not in its parameter list, not in any SET clause -- withholding it entirely is what ` +
            `makes AC-3's "agent-untouchable" guarantee mechanically true`,
        ).toBe(false);
      }
    }
  });

  it("still finds the sync_set migration at all -- a passing suite above must not be vacuous", () => {
    expect(() => findSyncSetMigrationText()).not.toThrow();
  });
});
