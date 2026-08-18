import type { Metadata } from "next";

// ─── The SEO seam (launch checklist §1.5 / §1.6) ──────────────────────────
//
// One module so the four things that have to agree cannot drift: page
// metadata, the sitemap, robots.txt, and the JSON-LD. Before this, none of
// them existed — a link to curfew.vip pasted into a DM unfurled as a bare URL,
// there was no sitemap, and robots.txt was Cloudflare's injected
// content-signals block rather than anything this repo controlled.
//
// The rule this file exists to enforce: a route is either PUBLIC (in the
// sitemap, allowed to crawlers, carrying real share metadata) or PRIVATE (out
// of the sitemap, disallowed, noindex). There is no third state, and adding a
// route to one list is what puts it in the other's complement.

/**
 * Absolute origin. Hard-coded rather than read from VERCEL_URL: this value
 * ends up in `<link rel="canonical">` and every `og:image` URL, and a preview
 * deployment that canonicalises itself is how duplicate content and
 * self-competing previews happen. Previews are noindexed wholesale by
 * `robots.ts` for the same reason.
 */
export const SITE_URL = "https://curfew.vip";
export const SITE_NAME = "Curfew";

/**
 * The one-line pitch, verbatim from the marketing layout. This is the string
 * that replaced the root layout's "DJ reflection platform." — internal
 * shorthand that was showing on every non-marketing route.
 */
export const TAGLINE =
  "Curfew reads the sets you play and gives you the only baseline that means anything: your own.";

/** Social accounts (Arjun, 2026-08-18). Feed `sameAs` and the Twitter card. */
export const SOCIAL = {
  instagram: "https://www.instagram.com/curfew.vip",
  x: "https://x.com/curfewvip",
} as const;

/** X/Twitter handle, in the `@name` form the card tags want. */
export const X_HANDLE = "@curfewvip";

/**
 * Every indexable route, and the whole of the sitemap.
 *
 * `/pricing` is deliberately absent, and now permanently so. Story 6.3 was
 * closed by ruling on 2026-08-18 (launch checklist §2.6): one plan needs no
 * tier-comparison page, and `/`'s closing beat already is the single-tier card
 * the story specified. `/pricing` 308s to `/#pricing` (next.config.ts), and a
 * sitemap should list the destination of a redirect, never its source.
 *
 * No `lastModified`. Google only honours it when it is consistently accurate,
 * and the two ways to produce it here are both lies: build time changes on
 * every unrelated deploy, and a hand-maintained date rots the first time
 * someone edits copy without touching this file. Omitting it costs nothing.
 */
export const PUBLIC_ROUTES = [
  { path: "/", priority: 1.0 },
  { path: "/features", priority: 0.9 },
  { path: "/faq", priority: 0.8 },
  { path: "/contact", priority: 0.5 },
  { path: "/login", priority: 0.4 },
  { path: "/privacy", priority: 0.3 },
  { path: "/terms", priority: 0.3 },
] as const;

/**
 * Everything a crawler has no business in. Prefixes, matching the shape of
 * `phone-gate.ts`'s and `subscription-gate.ts`'s lists — and, like those, the
 * list a new route has to be added to.
 *
 * The three groups, and why each is here:
 *   - the `(authenticated)` group: private by definition
 *   - the `(onboarding)` corridor: mid-signup screens, meaningless out of
 *     context and thin content in Google's sense
 *   - the utility routes: `/auth/*` are redirect handlers carrying one-time
 *     tokens, and `/download/*` 302s to GitHub, so crawling one costs a
 *     GitHub API call and indexes nothing.
 */
export const DISALLOWED_PREFIXES = [
  "/dashboard",
  "/settings",
  "/set",
  "/track",
  "/style-evolution",
  "/library-utilization",
  "/welcome",
  "/phone-required",
  "/link-agent",
  "/subscribe",
  "/subscription-required",
  "/reset-password",
  "/auth/",
  "/download/",
  "/api/",
] as const;

/**
 * `robots: { index: false, follow: false }`, for the layouts of the groups
 * above. Defence in depth, and the stronger half of it: a robots.txt rule is a
 * request a crawler may ignore, a meta tag on the page is not. It also covers
 * the case robots.txt cannot — a page already in an index gets removed, where
 * a disallow only stops the re-crawl that would have removed it.
 */
export const NOINDEX: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The share card, named explicitly.
 *
 * `app/opengraph-image.jpg` is a Next file convention and the plan was to let
 * its mere presence do the wiring. The build says otherwise, and the evidence
 * is worth keeping: in `.next/server/app/`, `_not-found.html` — which
 * overrides nothing — carried all four `og:image*` tags, while `index.html`
 * carried none. Any route that exports an `openGraph` object REPLACES the
 * resolved parent object, and the file-convention image goes with it. So every
 * page that sets `openGraph` has to name the image too, which is what this
 * constant is for.
 *
 * The URL is the route the file convention publishes, minus Next's content
 * hash. That costs cache-busting: Facebook and X cache scraped images by URL,
 * so a regenerated card needs a manual re-scrape in their debuggers rather
 * than appearing on its own.
 */
export const OG_IMAGE = {
  url: "/opengraph-image.jpg",
  width: 1200,
  height: 630,
  alt: "Curfew — every set has a shape. You have never seen yours.",
} as const;

type PageInput = {
  /** Full `<title>`, verbatim. Brand-first ("Curfew — …"), as every page here already is. */
  title: string;
  description: string;
  /** Site-relative, with the leading slash — becomes the canonical and `og:url`. */
  path: string;
};

/**
 * Per-page metadata: canonical + Open Graph + Twitter, from one line of input.
 *
 * Both `openGraph` and `twitter` are spelled out in full rather than left to
 * inherit from the root layout, image included. Next replaces these objects
 * wholesale rather than merging their keys — see OG_IMAGE for the build output
 * that proves it. That is the trap this helper exists to close: inheritance
 * looks like it works right up until one page overrides one key.
 */
export function pageMetadata({ title, description, path }: PageInput): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      url: path,
      title,
      description,
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      site: X_HANDLE,
      creator: X_HANDLE,
      title,
      description,
      images: [OG_IMAGE],
    },
  };
}

// ─── Structured data ──────────────────────────────────────────────────────
//
// JSON-LD, which is the format Google actually reads. Kept as plain objects a
// server component stringifies into a <script type="application/ld+json">.
//
// Deliberately NOT here: a `keywords` meta tag (Google has ignored it since
// 2009 and it reads as spam to the people who look), and `aggregateRating`
// (there are no reviews; inventing them is a manual-action offence).

/** The publisher and the site, as one graph — every page can claim these. */
export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: SITE_URL,
        logo: `${SITE_URL}/brand/curfew-wordmark.png`,
        email: "support@curfew.vip",
        sameAs: [SOCIAL.instagram, SOCIAL.x],
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: SITE_NAME,
        url: SITE_URL,
        description: TAGLINE,
        publisher: { "@id": `${SITE_URL}/#organization` },
        inLanguage: "en-US",
      },
    ],
  };
}

/**
 * The product itself. Both real prices, because both are advertised: $6.99/mo
 * billed yearly ($83.88) and $7.99 month to month.
 *
 * ⚠️ If the plan or either price changes, it changes HERE too. Structured data
 * that contradicts the page is worse than none — Google treats a price
 * mismatch as a reason to distrust the rest of the markup.
 */
export function softwareApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}/#app`,
    name: SITE_NAME,
    url: SITE_URL,
    applicationCategory: "MultimediaApplication",
    operatingSystem: "macOS, Windows",
    description: TAGLINE,
    publisher: { "@id": `${SITE_URL}/#organization` },
    offers: [
      {
        "@type": "Offer",
        name: "Annual",
        price: "83.88",
        priceCurrency: "USD",
        category: "subscription",
        url: `${SITE_URL}/subscribe`,
      },
      {
        "@type": "Offer",
        name: "Monthly",
        price: "7.99",
        priceCurrency: "USD",
        category: "subscription",
        url: `${SITE_URL}/subscribe`,
      },
    ],
  };
}

/**
 * FAQPage, built from the SAME array /faq renders (`faq-content.ts`). Google's
 * policy is that the marked-up answer must be the answer on the page; one
 * array rather than two is the only way to keep that true without a reviewer
 * noticing every time.
 */
export function faqJsonLd(sections: readonly { qs: readonly { q: string; a: readonly string[] }[] }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${SITE_URL}/faq#faq`,
    mainEntity: sections.flatMap((section) =>
      section.qs.map((entry) => ({
        "@type": "Question",
        name: entry.q,
        acceptedAnswer: { "@type": "Answer", text: entry.a.join(" ") },
      })),
    ),
  };
}

/** `<script type="application/ld+json">` props, escaped for inline embedding. */
export function jsonLdScriptProps(data: object) {
  return {
    type: "application/ld+json",
    // `<` escaped so a stray "</script>" inside any string can never close the
    // tag early. None of today's copy contains one; this is here so that stays
    // a fact about the copy rather than a dependency on it.
    dangerouslySetInnerHTML: { __html: JSON.stringify(data).replace(/</g, "\\u003c") },
  } as const;
}
