// Greeting-name precedence (Story 3.10, AC-4 / D-3): `djs.dj_name` wins over
// OAuth `full_name`, which wins over `name`; nameless if none. Pure so the
// rule is testable without Supabase — the dashboard's `getFirstName` and any
// future consumer both call this instead of re-deriving the order.

/**
 * Picks the display name and reduces it to its first whitespace token (the
 * greeting says "Good evening, Arjun", never a full legal name). Returns
 * `null` when nothing true is available — the greeting simply drops the name.
 */
export function resolveFirstName(
  djName: string | null | undefined,
  userMetadata: Record<string, unknown> | undefined,
): string | null {
  const raw =
    (typeof djName === "string" && djName.trim() !== "" && djName) ||
    (typeof userMetadata?.full_name === "string" && userMetadata.full_name) ||
    (typeof userMetadata?.name === "string" && userMetadata.name) ||
    null;
  if (!raw) return null;
  const first = raw.trim().split(/\s+/)[0];
  return first === "" ? null : first;
}
