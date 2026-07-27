import { describe, expect, it } from "vitest";

// WCAG 2.2 relative-luminance contrast ratio (no dependency needed — plain math).
function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const clean = hex.replace("#", "");
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
