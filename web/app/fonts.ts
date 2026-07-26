import { Geist_Mono, Hanken_Grotesk, Inter } from "next/font/google";

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

export const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-geist-mono-var",
});
