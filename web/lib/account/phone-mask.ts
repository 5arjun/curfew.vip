// Phone display mask (Story 3.10, AC-7 / D-8): the row shows enough to
// recognize the number (`+1 415 ••• ••42`) and no more. Pure, and works from
// the digits rather than the formatting.
//
// That digits-first approach was written when the stored value was whatever
// the DJ typed. As of 20260816170000 the column is E.164 only, so the
// tolerance is no longer load-bearing — but it is kept deliberately: it
// costs nothing and it is why this function needed no change when the
// storage format did.

/**
 * Masks all but the last two digits. US-shaped numbers (10 digits, or 11
 * with a leading 1) keep their area code visible, matching the spec's
 * anatomy; anything else masks down to the last two digits alone. Never
 * returns an empty string for a non-empty input — a row that renders blank
 * reads as broken (§5's "never an empty value" rule belongs to the caller,
 * which renders "Not on file" for null).
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 0) return "•••";
  if (digits.length <= 2) return `••${digits.slice(-1)}`;

  const last2 = digits.slice(-2);
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 ${digits.slice(1, 4)} ••• ••${last2}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)} ••• ••${last2}`;
  }
  return `••• ••${last2}`;
}
