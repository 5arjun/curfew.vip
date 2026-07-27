import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Static-analysis guard (Story 2.2 AC-4: "consumes only tokens, no hard-coded
// colors"). Mirrors the CI-enforced-invariant pattern already used for
// supabase/scripts/check-additive-only-migrations.sh (Story 2.1) and the
// schema-parity guard (Story 1.10) — static analysis over doc-only convention.
//
// tokens.css is the token DEFINITION file — it's expected to contain hex
// values and is excluded. fonts.ts has no colors. *.test.ts files are
// excluded because tests legitimately assert against known token hex values
// as fixtures (see tokens.test.ts) — that's not "hard-coded style," it's a
// regression check on the token source of truth.
//
// Excluded by path relative to web/app (not basename), so a future nested
// file that happens to share one of these names isn't silently exempted.
const EXCLUDED_FILES = new Set(["tokens.css", "fonts.ts"]);

// CSS Level 1 named colors + transparent/currentColor (the ones a component
// spec is actually likely to reach for, e.g. DESIGN.md's OAuth-button spec
// naming "white"/"black") plus modern color functions.
const NAMED_COLOR_PATTERN =
  /\b(black|silver|gray|white|maroon|red|purple|fuchsia|green|lime|olive|yellow|navy|blue|teal|aqua|transparent|currentColor)\b/;
const COLOR_LITERAL_PATTERN = new RegExp(
  [
    /#[0-9a-fA-F]{3,8}\b/.source,
    /\brgba?\(/.source,
    /\bhsla?\(/.source,
    /\b(?:oklch|oklab|lab|lch|color|color-mix)\(/.source,
    NAMED_COLOR_PATTERN.source,
  ].join("|"),
);

function stripComments(line: string): string {
  return line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
}

function collectFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...collectFiles(fullPath, extensions));
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

describe("web/app has no hard-coded colors outside the token file (Story 2.2 AC-4)", () => {
  it("contains zero hex/rgb/hsl/named-color literals in .ts, .tsx, .css files (excluding tokens.css, fonts.ts, tests)", () => {
    const appDir = join(__dirname);
    const files = collectFiles(appDir, [".ts", ".tsx", ".css"]).filter((file) => {
      const relativePath = relative(appDir, file);
      if (EXCLUDED_FILES.has(relativePath)) return false;
      const basename = relativePath.split("/").pop() ?? "";
      if (basename.endsWith(".test.ts") || basename.endsWith(".test.tsx")) return false;
      return true;
    });

    const violations: { file: string; line: number; text: string }[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf-8").split("\n");
      lines.forEach((line, index) => {
        if (COLOR_LITERAL_PATTERN.test(stripComments(line))) {
          violations.push({ file, line: index + 1, text: line.trim() });
        }
      });
    }

    expect(violations, JSON.stringify(violations, null, 2)).toHaveLength(0);
  });
});
