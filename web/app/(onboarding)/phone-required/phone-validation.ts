// Pure validation + E.164 normalization, no libphonenumber dependency.
// Bounds are E.164's own: a phone number is at most 15 digits total; 7 is a
// permissive floor for the shortest real national numbers.
//
// This file used to say "Story 2.4 owns real formatting/E.164
// normalization." Story 2.4 closed `done` without touching it, and nothing
// caught the dangling hand-off — the gap only surfaced when prod's first
// real Google sign-up stored `2677772111` one row away from the seeded demo
// account's `+15555550142`. Same column, two formats. Normalization lives
// here now, and a column CHECK (20260816170000) enforces the result, so a
// future write path cannot quietly reintroduce the split.

export function isValidPhone(rawPhone: string): boolean {
  const trimmed = rawPhone.trim();
  if (!/^\+?[0-9()\-.\s]+$/.test(trimmed)) {
    return false;
  }
  const digitCount = (trimmed.match(/\d/g) ?? []).length;
  return digitCount >= 7 && digitCount <= 15;
}

/**
 * Normalizes an input to E.164 (`+` then 7–15 digits, no spaces or
 * punctuation). Returns null when the input is not a valid phone at all, and
 * — the case worth understanding — when it is a *bare national* number whose
 * country cannot be inferred.
 *
 * Country inference is deliberately narrow, because guessing wrong writes a
 * number that silently cannot be dialled:
 *
 *   - A leading `+` is trusted as already international. Only the formatting
 *     is stripped.
 *   - A bare 10-digit number (or 11 digits led by `1`) with an area code
 *     starting 2–9 is read as NANP and stamped `+1`. That shape is a real
 *     NANP constraint, not a heuristic — area and exchange codes never begin
 *     with 0 or 1 — which keeps most non-US numbers from matching it.
 *   - Everything else bare is refused. A bare 9-digit string is a valid
 *     subscriber number in several countries with nothing to distinguish
 *     them, so the caller asks for a country code instead of picking one.
 *
 * US-only-at-launch (the PRD's CCPA scoping) is what makes the NANP branch
 * defensible; it is the one assumption to revisit if that changes.
 */
export function normalizePhone(rawPhone: string): string | null {
  if (!isValidPhone(rawPhone)) {
    return null;
  }

  const trimmed = rawPhone.trim();
  const digits = trimmed.replace(/\D/g, "");

  if (trimmed.startsWith("+")) {
    // A country code never starts with 0, so `+0…` is malformed rather than
    // merely unfamiliar — refuse it instead of storing an undiallable value.
    return digits.startsWith("0") ? null : `+${digits}`;
  }

  // Treat 11-digits-led-by-1 as the same NANP number wearing its country
  // code, so both spellings converge on one stored form.
  const nanp = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (nanp.length === 10 && /^[2-9]\d{2}[2-9]/.test(nanp)) {
    return `+1${nanp}`;
  }

  return null;
}
