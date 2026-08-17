// Pure shape validation for the signup time zone (Story 7.7). Sibling to
// `phone-validation.ts`, and split out for the same reason: `actions.ts` is
// `"use server"`, where every export must be an async server action, so a pure
// helper cannot be exported from there — and an untested regex guarding a
// column write is exactly the kind of thing that turns out to be wrong.
//
// The zone reaches this file from `phone-form.tsx`'s hidden input, i.e. from
// `Intl.DateTimeFormat().resolvedOptions().timeZone` in the DJ's browser. It is
// the DJ-level fallback used to bucket sets whose own payload carried no zone.

/** Longest real IANA name is 32 chars (`America/Argentina/ComodRivadavia`).
 *  64 leaves generous headroom for future names while keeping junk out. */
const MAX_ZONE_LENGTH = 64;

/**
 * `Area/Location`, optionally three segments (`America/Argentina/Salta`), plus
 * the legacy single-segment names (`UTC`, `EST5EDT`, `Zulu`) that are still
 * valid IANA identifiers.
 */
const IANA_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;

/**
 * A submitted zone, trimmed, or `null` if it is not shaped like an IANA name.
 *
 * **Shape only — deliberately not a membership check.** tzdata gains zones
 * (`America/Ciudad_Juarez` arrived in 2022) and renames others, and this value
 * comes from a browser whose tzdata may be newer than the server's. Rejecting a
 * legitimately-new zone would be strictly worse than storing it: the read path
 * already degrades an unrecognized zone to UTC without throwing
 * (`web/lib/sets/civilTime.ts`'s `formatterFor`). The job here is keeping an
 * injected string or a megabyte of junk out of the column, not adjudicating
 * which zones exist.
 *
 * `null` is a permanently valid outcome, never an error to surface: AD-3 makes
 * a zone-less DJ a forever-supported state, and AD-19 forbids gating on it. The
 * caller drops the key and the form proceeds.
 */
export function normalizeTimezone(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > MAX_ZONE_LENGTH) return null;
  return IANA_SHAPE.test(value) ? value : null;
}
