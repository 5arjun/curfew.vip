import type { Metadata } from "next";
import { geistMono, hankenGrotesk, inter } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Curfew",
  description: "DJ reflection platform.",
  icons: {
    icon: [
      { url: "/favicon-light.png", media: "(prefers-color-scheme: light)" },
      { url: "/favicon-dark.png", media: "(prefers-color-scheme: dark)" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${hankenGrotesk.variable} ${inter.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
