import { Geist_Mono, Hanken_Grotesk, Inter } from "next/font/google";
import localFont from "next/font/local";

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
 * Display face — MARKETING SURFACES ONLY. **D-4, round three: Clash Display**
 * (Arjun, 2026-08-14), replacing Bricolage Grotesque, which replaced the
 * original display-serif ruling. What has survived all three rounds: the
 * marketing surface must read as authored where the app reads as a console,
 * and a grotesque rhymes with the condensed-grotesque wordmark in a way the
 * four rejected serifs (Instrument, Newsreader, Fraunces, Bodoni) never did.
 * What killed Bricolage: at headline size its tight fit ran the words together
 * ("twentwell") and its drawn shapes still read too close to the console
 * register. Clash keeps the grotesque rhyme with a real poster voice.
 *
 * Self-hosted via next/font/local — Clash Display is Fontshare, not Google
 * (fonts/FFL.txt is its license; the ITF FFL permits web embedding). One
 * variable file, 200–700, used at 500/600 like the faces before it.
 *
 * Applied on the marketing layout's own wrapper, never on <html>, so the
 * authenticated app never loads it and can never accidentally use it.
 */
export const clashDisplay = localFont({
  src: "./fonts/ClashDisplay-Variable.woff2",
  weight: "200 700",
  variable: "--font-clash-var",
});

export const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-geist-mono-var",
});
