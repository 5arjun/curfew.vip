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

// Bumped whenever MARKETING_EMAIL_CONSENT_TEXT changes. The stored consent
// keeps the text itself (not this id) so an old record stays readable without
// a lookup table, but the version makes "which cohort saw which wording"
// answerable with a GROUP BY instead of string matching.
export const MARKETING_EMAIL_CONSENT_VERSION = "2026-08-20";

// The exact sentence rendered beside the checkbox. Requirements it is built to
// satisfy, all from docs/legal-review-2026-08-18.md finding A:
//
//   - Its own sentence, naming what is being consented to.
//   - EMAIL ONLY. Marketing texts are deliberately NOT bundled in: TCPA wants
//     prior express written consent for those, plus A2P 10DLC registration,
//     and no SMS provider exists in this repo. Bundling them would recreate
//     the exact defect the review flagged — a grant broader than what was
//     actually asked for.
//   - Names the way out, because CAN-SPAM requires one to exist and a DJ
//     should know that before ticking rather than after.
//
// It is NOT a condition of subscribing, and the checkbox is unchecked by
// default. A pre-ticked box is not consent under GDPR, and it is not evidence
// of anything under any regime.
export const MARKETING_EMAIL_CONSENT_TEXT =
  "Email me about new Curfew features and offers. Not account mail — this is the optional kind, and you can unsubscribe from any of it.";
