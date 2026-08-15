// Pure validation, no libphonenumber dependency — this screen is explicitly
// functional-not-polished (Story 2.4 owns real formatting/E.164 normalization).
// Bounds are E.164's own: a phone number is at most 15 digits total; 7 is a
// permissive floor for the shortest real national numbers.
export function isValidPhone(rawPhone: string): boolean {
  const trimmed = rawPhone.trim();
  if (!/^\+?[0-9()\-.\s]+$/.test(trimmed)) {
    return false;
  }
  const digitCount = (trimmed.match(/\d/g) ?? []).length;
  return digitCount >= 7 && digitCount <= 15;
}
