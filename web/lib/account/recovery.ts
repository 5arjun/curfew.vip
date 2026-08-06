// Recovery-grade session check (Story 3.10 code-review ruling, Arjun
// 2026-08-05): `updatePassword` must only honor sessions that recently
// proved control of the inbox — otherwise any hijacked or left-open session
// could set a new password without knowing the old one, converting temporary
// session theft into durable account takeover. Pure so the rule is testable
// without Supabase.

/** AMR entry shape from GoTrue JWT claims (`timestamp` is unix seconds). */
export type AmrEntry = { method: string; timestamp: number };

/**
 * Methods that prove control of the inbox: the recovery link itself plus the
 * OTP/magic-link encodings GoTrue has used for email-proof grants across
 * versions — deliberately a set, so a rename on their side degrades to
 * another email-proof method rather than breaking every reset. Password and
 * OAuth grants (the session-theft surface) are deliberately absent.
 */
const INBOX_PROOF_METHODS = new Set(["recovery", "otp", "magiclink"]);

/** How fresh the inbox proof must be — tighter than the recovery link's own ~1h expiry. */
export const RECOVERY_MAX_AGE_MS = 30 * 60 * 1000;

export function hasRecentInboxProof(amr: unknown, nowMs: number): boolean {
  if (!Array.isArray(amr)) return false;
  return amr.some((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const { method, timestamp } = entry as Partial<AmrEntry>;
    return (
      typeof method === "string" &&
      INBOX_PROOF_METHODS.has(method) &&
      typeof timestamp === "number" &&
      nowMs - timestamp * 1000 <= RECOVERY_MAX_AGE_MS
    );
  });
}
