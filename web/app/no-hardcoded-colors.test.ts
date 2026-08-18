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

// `transparent` is a CSS color keyword AND a three.js material property name
// (`<shaderMaterial transparent />` enables alpha blending — it is a boolean,
// not a color). Story 6.1's WebGL ribbon is the first code in the app to hit
// that collision. Narrowed rather than exempting the file: only the bare JSX
// boolean attribute form is dropped, so `color: transparent`, `"transparent"`,
// and `transparent: "#fff"` all still trip the guard exactly as before. The
// invariant being protected is "no hard-coded colors" — a blend-mode flag was
// never one, and the CSS keyword remains banned everywhere it can be a color
// (use a zero-alpha token instead; see tokens.css's *-fade family).
function stripNonColorKeywords(line: string): string {
  // Trailing `$` matters: Prettier puts a lone boolean JSX attribute on its own
  // line, so the common form has no trailing character at all.
  return line.replace(/(^|[\s{])transparent(?=\s*\/?>|\s*=\s*\{(?:true|false)\}|\s|$)/g, "$1");
}

// `viewport.themeColor` (app/layout.tsx) is the second collision, and unlike
// the first it IS a color — it just cannot be a token. Next serialises it into
// `<meta name="theme-color">` on the server, where there is no DOM and no
// stylesheet to resolve a custom property against, so the getComputedStyle
// escape hatch the shader colors use (--color-abyss-silk and friends) is not
// available either. A literal is the only form the value can take.
//
// Narrowed to the property, not the file, following the `transparent`
// precedent above: only the value of a `themeColor:` key is dropped, so a hex
// anywhere else in app/layout.tsx still trips the guard. Keep this value equal
// to --color-abyss-base; nothing but review enforces that.
function stripThemeColor(line: string): string {
  return line.replace(/\bthemeColor:\s*"[^"]*"/g, "themeColor:");
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
        if (COLOR_LITERAL_PATTERN.test(stripThemeColor(stripNonColorKeywords(stripComments(line))))) {
          violations.push({ file, line: index + 1, text: line.trim() });
        }
      });
    }

    expect(violations, JSON.stringify(violations, null, 2)).toHaveLength(0);
  });
});
