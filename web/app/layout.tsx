import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { OG_IMAGE, SITE_NAME, SITE_URL, TAGLINE, X_HANDLE } from "@/lib/seo";
import { geistMono, hankenGrotesk, inter } from "./fonts";
import "./globals.css";

// Launch checklist §1.5: before this pass there was no `metadataBase`, no
// `openGraph` and no `twitter` block anywhere in web/app — every link to
// curfew.vip unfurled as a bare URL — and the description below read "DJ
// reflection platform.", which is internal shorthand, not customer copy, and
// was what showed on every non-marketing route.
//
// What lives at the ROOT is the floor: the defaults every route inherits,
// including the authenticated ones a DJ might paste to a friend. Marketing
// routes override title/description/canonical per page through
// `pageMetadata()` — see lib/seo.ts for why each of those spells its own
// openGraph block out in full rather than inheriting this one.
//
// `app/opengraph-image.jpg` and `app/apple-icon.png` sit beside this file and
// are wired by Next's file conventions, not by this object: their presence
// emits og:image / twitter:image / apple-touch-icon for every route, at the
// right absolute URL and with the dimensions filled in. Regenerate them with
// `python3 web/scripts/og-assets.py`.
export const metadata: Metadata = {
  // Without this, every relative OG image URL resolves wrong and Next warns at
  // build time.
  metadataBase: new URL(SITE_URL),
  title: SITE_NAME,
  description: TAGLINE,
  applicationName: SITE_NAME,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    url: "/",
    title: SITE_NAME,
    description: TAGLINE,
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    site: X_HANDLE,
    creator: X_HANDLE,
    title: SITE_NAME,
    description: TAGLINE,
    images: [OG_IMAGE],
  },
  icons: {
    icon: [
      { url: "/favicon-light.png", media: "(prefers-color-scheme: light)" },
      { url: "/favicon-dark.png", media: "(prefers-color-scheme: dark)" },
    ],
    // Named here rather than left to `app/apple-icon.png`'s file convention
    // for the same reason the OG image is: declaring `icons` at all replaces
    // the file-convention set, so the home-screen mark went missing from every
    // page that this object reached — which is all of them.
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

// A separate export, not a `metadata.themeColor` key: Next moved themeColor
// and colorScheme out of Metadata and warns at build time if they are still
// there. Both say the same thing the whole product says — the ground is the
// Abyss base (#04060a), so mobile browser chrome matches the page instead of
// flashing white above it, and form controls render dark.
export const viewport: Viewport = {
  themeColor: "#04060a",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${hankenGrotesk.variable} ${inter.variable} ${geistMono.variable}`}>
      <body>
        {children}
        {/*
          Both scripts serve from this origin (`/_vercel/insights/*` and
          `/_vercel/speed-insights/*`), not from a third-party host — the same
          property BotID's rewrites and Sentry's `tunnelRoute` are configured
          for in next.config.ts, and the reason they survive both Cloudflare
          proxying our DNS and an ad blocker on the DJ's browser.

          Speed Insights is here rather than scoped to the landing page: the
          landing route is the one that runs a WebGL mesh and ships several
          MP4s, but field vitals are only comparable if every route reports.
        */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
