// Pure identity-presentation helpers (Story 3.10): shared by the server-side
// profile seam, the Settings page, and unit tests — no Supabase/server
// imports here, so vitest can load it without `next/headers`.

/**
 * Hosts `next/image` is configured to optimize (next.config.ts
 * `remotePatterns`) — keep the two lists in sync. A provider photo on any
 * other host must fall back to the monogram BEFORE reaching `<Image>`: an
 * unallowlisted hostname throws at render, and the nav avatar renders in the
 * `(authenticated)` layout, so one bad URL would take down every
 * authenticated page. `user_metadata` is user-writable via
 * `auth.updateUser({ data })`, so this is input validation, not just
 * CDN-drift-proofing.
 */
const ALLOWED_AVATAR_HOSTS = new Set([
  "lh3.googleusercontent.com",
  "lh4.googleusercontent.com",
  "lh5.googleusercontent.com",
  "lh6.googleusercontent.com",
]);

/** The URL if `next/image` can render it, else `null` — the caller falls back to the monogram. */
export function allowedAvatarUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && ALLOWED_AVATAR_HOSTS.has(parsed.hostname)
      ? url
      : null;
  } catch {
    return null;
  }
}

/** First letter of the DJ name, else the email, uppercased; "?" only if neither exists. */
export function monogramLetter(djName: string | null, email: string | null): string {
  const source = (djName ?? "").trim() || (email ?? "").trim();
  if (source === "") return "?";
  // Code-point access, not `source[0]`: D-3 allows any characters, and a
  // UTF-16-indexed read of an astral-plane first char (an emoji DJ name)
  // yields a lone surrogate that renders as U+FFFD.
  return String.fromCodePoint(source.codePointAt(0) as number).toUpperCase();
}
