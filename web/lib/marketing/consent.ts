// The consent record's canonical wording and the postal address that has to
// appear in every commercial email. Both live here rather than inline in the
// form, because both are EVIDENCE: the point of storing consent is being able
// to say what a DJ was shown, and that claim is only as good as there being
// one place the wording could have come from.

// CAN-SPAM §7704(a)(5) requires a "valid physical postal address" in every
// commercial email. `isPostalAddressComplete()` below is the gate that keeps a
// half-filled one from shipping.
//
// ⚠️ This address becomes PUBLIC the moment a broadcast goes out — it is on
// every copy, forever, in every recipient's inbox, and it is equally in the
// page source of /privacy. If this is a home address, CAN-SPAM accepts a
// USPS-registered PO box just as readily, which is what most solo operators
// use for exactly that reason.
export const MARKETING_POSTAL_ADDRESS = {
  line1: "1405 N Sydenham St",
  city: "Philadelphia",
  region: "PA",
  postalCode: "19121",
  country: "USA",
} as const;

// A single-line rendering for an email footer. Empty parts are dropped rather
// than rendered as gaps, so an incomplete address reads as short rather than
// as broken punctuation — but see the completeness gate: short is not legal.
export function formatPostalAddress(
  address: {
    line1: string;
    city: string;
    region: string;
    postalCode: string;
    country: string;
  } = MARKETING_POSTAL_ADDRESS,
): string {
  const cityRegion = [address.city, address.region].filter(Boolean).join(", ");
  const locality = [cityRegion, address.postalCode].filter(Boolean).join(" ");
  return [address.line1, locality, address.country].filter(Boolean).join(", ");
}

// The gate. Nothing that sends commercial mail may run while this is false —
// the address is the one CAN-SPAM requirement that cannot be satisfied by
// code alone, so it gets an explicit check rather than an assumption.
export function isPostalAddressComplete(
  address: {
    line1: string;
    city: string;
    region: string;
    postalCode: string;
  } = MARKETING_POSTAL_ADDRESS,
): boolean {
  return Boolean(
    address.line1.trim() && address.city.trim() && address.region.trim() && address.postalCode.trim(),
  );
}

// Bumped whenever SIGNUP_AGREEMENT_TEXT changes. The stored consent keeps the
// text itself (not this id) so an old record stays readable without a lookup
// table, but the version makes "which cohort saw which wording" answerable
// with a GROUP BY instead of string matching.
//
// v2 (2026-08-20, second): moved from an optional box on /phone-required to a
// single REQUIRED box on /login's signup mode, and widened from marketing
// alone to Terms + Privacy + marketing. Arjun's call, made against a written
// tradeoff — see the note on SIGNUP_AGREEMENT_SEGMENTS.
export const SIGNUP_AGREEMENT_VERSION = "2026-08-20.2";

// ⚠️ THIS IS A REQUIRED CHECKBOX, AND THAT IS A DELIBERATE CHOICE WITH A KNOWN
// COST. Ticking it is a condition of creating an account, so:
//
//   - Under CAN-SPAM (US) this is fine. Prior consent is not required there at
//     all; the statute's demands are an unsubscribe mechanism, a valid postal
//     address, and honest headers, all of which exist.
//   - Under GDPR and CASL it is NOT valid consent. Consent bundled into
//     acceptance of terms, and required to receive the service, is not
//     "freely given". An EU or Canadian DJ mailed on the strength of this box
//     has not actually consented in the way those regimes mean.
//   - The `djs.marketing_email_consent_*` record no longer distinguishes
//     anyone from anyone, because everyone with an account has ticked it. It
//     documents what was shown, which is still worth having, but it is no
//     longer evidence that a particular DJ chose anything.
//
// Chosen 2026-08-20 by Arjun with those three consequences stated. Reverting
// is small: split this into two boxes, make the marketing half optional and
// unticked, and bump the version.
//
// Marketing TEXTS stay out of this wording entirely — consent.test.ts asserts
// it never mentions texts, SMS, or message rates. TCPA needs its own prior
// express written consent plus A2P 10DLC registration, and no SMS provider
// exists in this repo. Widening the box to cover email was a decision; letting
// it silently cover texts would be the exact defect the 2026-08-18 review
// flagged.
//
// Segments rather than one string so the rendered label (which needs anchors
// on "Terms" and "Privacy Policy") and the stored record are the SAME source.
// Two hand-maintained copies is a record describing wording nobody was shown.
export type AgreementSegment = { readonly text: string; readonly href?: string };

export const SIGNUP_AGREEMENT_SEGMENTS: readonly AgreementSegment[] = [
  { text: "I agree to the " },
  { text: "Terms", href: "/terms" },
  { text: " and " },
  { text: "Privacy Policy", href: "/privacy" },
  { text: ", and to receive marketing email from Curfew. Unsubscribe any time." },
];

// What gets stored. Derived, never hand-written — see above.
export const SIGNUP_AGREEMENT_TEXT = SIGNUP_AGREEMENT_SEGMENTS.map((s) => s.text).join("");

// Carries the tick across the OAuth round trip. Google and Apple bounce the
// browser to a provider and back to /auth/callback, so the checkbox state has
// to survive a full navigation away from the page — the auth route is where
// the account first exists to attach a consent record to.
//
// Not a security control and not treated as one: consent is mandatory to reach
// signup at all, so this cookie only distinguishes "went through the new
// signup form" from "signed in some other way". Its absence degrades to the
// safe answer (no consent recorded, contact stays opted out) rather than to a
// fabricated yes — which is the whole reason it exists instead of assuming
// every fresh account consented.
export const SIGNUP_CONSENT_COOKIE = "curfew_signup_consent";
