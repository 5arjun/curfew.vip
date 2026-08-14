import {
  Archivo,
  Big_Shoulders,
  Bricolage_Grotesque,
  Geist_Mono,
  Hanken_Grotesk,
  Instrument_Serif,
  Inter,
  Space_Grotesk,
  Syne,
} from "next/font/google";

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

// Display serif — MARKETING SURFACES ONLY (Story 6.1, D-4). Deliberately a
// different register from the app: Hanken Grotesk is right for a console and
// wrong for a hero that has to read as authored. Applied on the marketing
// layout's own wrapper, never on <html>, so the authenticated app never loads
// it and can never accidentally use it.
export const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-instrument-serif-var",
});

/**
 * D-4 IS BACK OPEN (Arjun, 2026-08-13: "can i see a different font?"; round two
 * 2026-08-14 after "I don't like any of these fonts"). Round one was four
 * serifs — Instrument, Newsreader, Fraunces, Bodoni — and all four were
 * rejected, which reads as a rejection of the DIRECTION, not of four particular
 * drawings of it. Round two is therefore a spread across registers rather than
 * four more of the same: two grotesques, one technical, one art-display, one
 * condensed poster face, and the app's own Hanken Grotesk as a control (D-4
 * assumed the marketing surface must differ from the app; that assumption has
 * never actually been tested against the hero).
 *
 * Loaded ONLY in development and switched live by the chip row on /landing —
 * see FaceSwitcher. Once Arjun picks, the losers and the switcher come out and
 * this file keeps one display face. They must not ship: a rack of display
 * families preloading would blow the hero's LCP budget (§5, "LCP < 2.5s").
 */
export const archivo = Archivo({
  subsets: ["latin"],
  weight: ["500", "600"],
  style: ["normal", "italic"],
  variable: "--font-archivo-var",
});

export const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-space-grotesk-var",
});

export const syne = Syne({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-syne-var",
});

export const bricolageGrotesque = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-bricolage-var",
});

export const bigShoulders = Big_Shoulders({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-big-shoulders-var",
});

export const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-geist-mono-var",
});
