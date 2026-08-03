import { describe, expect, it } from "vitest";

// WCAG 2.2 relative-luminance contrast ratio (no dependency needed — plain math).
function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

// Normalizes 3-digit shorthand and 8-digit alpha hex to a plain 6-digit RGB
// string; throws on anything else rather than silently computing on garbage.
function normalizeHex(hex: string): string {
  const clean = hex.replace("#", "");
  if (clean.length === 3) {
    return clean
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (clean.length === 6 || clean.length === 8) {
    return clean.slice(0, 6);
  }
  throw new Error(`Unsupported hex color length: "${hex}"`);
}

function relativeLuminance(hex: string): number {
  const clean = normalizeHex(hex);
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

const AA_NORMAL_TEXT_MIN = 4.5;
const AA_LARGE_TEXT_MIN = 3;

// Alpha-composites an 8-digit-hex foreground over an opaque background,
// returning the resulting 6-digit hex — for testing the translucent steps of a
// text ramp against the surface they actually render on.
function compositeOver(fgHex8: string, bgHex6: string): string {
  const clean = fgHex8.replace("#", "");
  if (clean.length !== 8) throw new Error(`Expected 8-digit hex, got "${fgHex8}"`);
  const alpha = parseInt(clean.slice(6, 8), 16) / 255;
  const bg = normalizeHex(bgHex6);
  const blend = (i: number) => {
    const fg = parseInt(clean.slice(i, i + 2), 16);
    const b = parseInt(bg.slice(i, i + 2), 16);
    return Math.round(alpha * fg + (1 - alpha) * b)
      .toString(16)
      .padStart(2, "0");
  };
  return blend(0) + blend(2) + blend(4);
}

describe("Obsidian core-text tokens meet WCAG 2.2 AA (Story 2.2 AC-4)", () => {
  it("on-surface (#e1e3e8) vs surface (#101319) passes AA", () => {
    const ratio = contrastRatio("#e1e3e8", "#101319");
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_MIN);
    expect(ratio).toBeCloseTo(14.48, 1);
  });

  it("on-surface-variant (#c4c8d5) vs surface (#101319) passes AA", () => {
    const ratio = contrastRatio("#c4c8d5", "#101319");
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_MIN);
    expect(ratio).toBeCloseTo(11.13, 1);
  });
});

// Story 2.4 AC-4 / UX-DR21: "focus rings use the primary-accent glow at AA
// contrast." The literal reading — alpha-composite --color-primary-glow
// (--color-primary at ~20% opacity, per DESIGN.md's "soft blur") over the
// surface it sits on, then require THAT composited color alone to clear
// 4.5:1 — is unsatisfiable by construction: at 20% opacity the composited
// color is dominated by the background it's blended into (proven below,
// ratio far under even the 3:1 non-text UI minimum, let alone 4.5:1). A
// translucent decorative glow cannot itself be the AA-contrast-bearing
// element against a similarly-toned background at any opacity worth calling
// "a glow." The corrected, implemented design (GhostInput/Button/
// BiometricAnchor's `:focus-visible` rules in globals.css) instead makes the
// solid-opacity `--color-primary` outline the AA-tested indicator, with the
// 20%-opacity glow layered on top as DESIGN.md's non-load-bearing decorative
// touch. This mirrors how prior stories corrected stale doc language against
// verified reality (e.g. Story 2.3b's Google-consent-screen finding) rather
// than silently reinterpreting the AC.
describe("Story 2.4 focus-ring glow: AA contrast (AC-4 / UX-DR21)", () => {
  const PRIMARY = "#e98aa2";
  const SURFACE = "#101319";
  const SURFACE_CONTAINER = "#1b1f28";

  it("solid --color-primary focus ring passes AA against --color-surface", () => {
    const ratio = contrastRatio(PRIMARY, SURFACE);
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_MIN);
  });

  it("solid --color-primary focus ring passes AA against --color-surface-container", () => {
    const ratio = contrastRatio(PRIMARY, SURFACE_CONTAINER);
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_MIN);
  });

  it("demonstrates why the 20%-opacity glow alone cannot carry AA contrast", () => {
    // --color-primary-glow is #e98aa233 (--color-primary + 0x33/255 ≈ 20% alpha),
    // alpha-composited over --color-surface.
    const fgHex = normalizeHex(PRIMARY);
    const bgHex = normalizeHex(SURFACE);
    const alpha = 0x33 / 255;
    const blendChannel = (start: number) => {
      const fg = parseInt(fgHex.slice(start, start + 2), 16);
      const bg = parseInt(bgHex.slice(start, start + 2), 16);
      return Math.round(alpha * fg + (1 - alpha) * bg);
    };
    const blendedHex = [blendChannel(0), blendChannel(2), blendChannel(4)]
      .map((channel) => channel.toString(16).padStart(2, "0"))
      .join("");
    const ratio = contrastRatio(blendedHex, SURFACE);
    // Nowhere near AA (4.5:1) or even the 3:1 non-text-UI minimum — proves the
    // literal "composite the glow, require 4.5:1" reading is unsatisfiable.
    expect(ratio).toBeLessThan(3);
  });
});

// ─── Abyss Cyan (Story 3.6 v2 dashboard redesign, D11) ──────────────────────
// The dev-task contrast verification PLAN.md's D11 mandates. Fixture hexes
// mirror tokens.css's Abyss block (the regression-check-on-source-of-truth
// pattern this file already uses). The translucent text-ramp steps are
// composited over BOTH surfaces they render on (base page + shell cards)
// before measuring — a translucent color has no contrast ratio of its own.
// Honest scoping, mirroring the focus-ring finding above: the 45% step
// measures ~3.9:1, below 4.5:1 — so it is BOUND to the 3:1 large-text/
// secondary floor and reserved for de-emphasized meta (the same register the
// music-player ref renders at 45% white on #161616, which measures ~3.5:1);
// the 22% step is decorative-only and deliberately untested as text.
describe("Abyss Cyan tokens meet WCAG 2.2 AA (dashboard redesign D11)", () => {
  const BASE = "#04070c";
  const SHELL = "#091018";
  const RAISED = "#0f1824";
  const TEXT = "#eaf3f8";
  const TEXT_72 = "#eaf3f8b8";
  const TEXT_45 = "#eaf3f873";
  const ACCENT = "#7fd8f2";
  const ACCENT_SOFT = "#4fb2d6";
  const ON_ACCENT = "#04131c";

  for (const [name, surface] of [
    ["base", BASE],
    ["shell", SHELL],
    ["raised", RAISED],
  ] as const) {
    it(`text-100 passes AA on ${name}`, () => {
      expect(contrastRatio(TEXT, surface)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_MIN);
    });
    it(`text-72 (composited) passes AA on ${name}`, () => {
      expect(contrastRatio(compositeOver(TEXT_72, surface), surface)).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT_MIN,
      );
    });
    it(`text-45 (composited) clears the 3:1 large/secondary floor on ${name}`, () => {
      expect(contrastRatio(compositeOver(TEXT_45, surface), surface)).toBeGreaterThanOrEqual(
        AA_LARGE_TEXT_MIN,
      );
    });
    it(`accent passes AA as text/icon on ${name}`, () => {
      expect(contrastRatio(ACCENT, surface)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_MIN);
    });
    it(`accent-soft clears 3:1 (non-text UI: today-ring, marks) on ${name}`, () => {
      expect(contrastRatio(ACCENT_SOFT, surface)).toBeGreaterThanOrEqual(AA_LARGE_TEXT_MIN);
    });
  }

  it("on-accent passes AA on the filled accent", () => {
    expect(contrastRatio(ON_ACCENT, ACCENT)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_MIN);
  });
});
