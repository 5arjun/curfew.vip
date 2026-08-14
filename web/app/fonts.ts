import { Bricolage_Grotesque, Geist_Mono, Hanken_Grotesk, Inter } from "next/font/google";

// Obsidian type scale (UX-DR1): Hanken Grotesk for headlines, Inter for body,
// Geist Mono for label-sm/mono-data (Story 2.2 AC-2 calls these "Geist mono" —
// treated as Geist Mono, not a separate non-mono "Geist" family).
export const hankenGrotesk = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-hanken-grotesk-var",
});

export const inter = Inter({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-inter-var",
});

/**
 * Display face — MARKETING SURFACES ONLY. **D-4 IS SETTLED: Bricolage
 * Grotesque** (Arjun, 2026-08-14), after two rounds against nine other faces.
 *
 * The original ruling called for a display *serif* on the reasoning that the
 * marketing surface must read as authored where the app reads as a console.
 * That half held; the serif half did not — four serifs (Instrument, Newsreader,
 * Fraunces, Bodoni) were all rejected. What the page actually wanted was a
 * grotesque with a voice: Curfew's own wordmark is a condensed grotesque, so a
 * grotesque headline rhymes with the logo in a way no serif did, and
 * Bricolage's irregular, slightly drawn shapes keep it from collapsing into
 * Hanken Grotesk's neutral console register.
 *
 * Applied on the marketing layout's own wrapper, never on <html>, so the
 * authenticated app never loads it and can never accidentally use it. 500 for
 * display, 600 for the headline's second line, which holds its emphasis by
 * weight (no italic — Bricolage has none worth setting a headline in).
 */
export const bricolageGrotesque = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-bricolage-var",
});

export const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-geist-mono-var",
});
