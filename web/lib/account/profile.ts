// Account data-access seam (Story 3.10) — the Settings page and the
// authenticated layout read identity facts ONLY from here, mirroring the
// `web/lib/sets` seam discipline. Server-only (pulls in `next/headers` via
// the Supabase server client) — client components receive these values as
// props, never import this module.
import { createClient } from "@/lib/supabase/server";
import { allowedAvatarUrl, monogramLetter } from "./avatar";

export { monogramLetter } from "./avatar";

export type SettingsProfile = {
  email: string | null;
  /** Raw stored phone (masking is the caller's presentation concern). */
  phone: string | null;
  djName: string | null;
  /**
   * Stripe's own subscription status verbatim, or `null` when the DJ has
   * never subscribed (Story 7.1's column, AD-19 — a thin passthrough, never
   * a second state machine). Read here rather than in a second query so the
   * Settings page keeps its single `djs` read. UNKNOWN, not `null`, when
   * `djsReadFailed` is true — see that field.
   */
  subscriptionStatus: string | null;
  /**
   * True when the `djs` row read failed — phone/djName/subscriptionStatus are
   * UNKNOWN, not absent, and the phone row must render "—", never the
   * confirmed-null copy "Not on file" (§5 reserves that for a truly
   * phone-less DJ).
   */
  djsReadFailed: boolean;
  /** OAuth display name (`user_metadata.full_name ?? name`), if any. */
  oauthName: string | null;
  /** OAuth provider photo (`user_metadata.avatar_url ?? picture`), if any. */
  avatarUrl: string | null;
  /**
   * Lowercased, deduped union of `identities[].provider` and
   * `app_metadata.providers` — e.g. `["email", "google"]`. Passkey
   * attachment is deliberately NOT read from here: the WebAuthn credential
   * list is a client-side read (`supabase.auth.passkey.list()`), same as the
   * login page's own check.
   */
  providers: string[];
};

/**
 * The signed-in DJ's identity facts, or `null` when there is no session (or
 * no configured Supabase env in a dev checkout) — the caller redirects.
 * Resilient rather than gating, same rationale as `getAgentStatus`.
 */
export async function getSettingsProfile(): Promise<SettingsProfile | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user) return null;

    // RLS owner-SELECT means no `.eq("id", …)` filter is needed — auth.uid()
    // is the filter (same note as getAgentStatus).
    const { data: dj, error: djError } = await supabase
      .from("djs")
      .select("dj_name, phone, subscription_status")
      .maybeSingle<{
        dj_name: string | null;
        phone: string | null;
        subscription_status: string | null;
      }>();

    const meta = user.user_metadata as Record<string, unknown> | undefined;
    // Trim-tested like djName in resolveFirstName: a whitespace-only
    // `full_name` must not short-circuit past a real `name`.
    const oauthName =
      (typeof meta?.full_name === "string" && meta.full_name.trim() !== "" && meta.full_name) ||
      (typeof meta?.name === "string" && meta.name.trim() !== "" && meta.name) ||
      null;
    // Hostname-validated before it can reach <Image> — see allowedAvatarUrl.
    const avatarUrl = allowedAvatarUrl(
      (typeof meta?.avatar_url === "string" && meta.avatar_url) ||
        (typeof meta?.picture === "string" && meta.picture) ||
        null,
    );

    const identityProviders = (user.identities ?? []).map((identity) => identity.provider);
    const appMetaProviders = Array.isArray(user.app_metadata?.providers)
      ? user.app_metadata.providers.filter((p): p is string => typeof p === "string")
      : [];
    const providers = [
      ...new Set([...identityProviders, ...appMetaProviders].map((p) => p.toLowerCase())),
    ];

    return {
      email: user.email ?? null,
      phone: dj?.phone ?? null,
      djName: dj?.dj_name ?? null,
      subscriptionStatus: dj?.subscription_status ?? null,
      djsReadFailed: Boolean(djError),
      oauthName,
      avatarUrl,
      providers,
    };
  } catch {
    return null;
  }
}

export type NavAvatar = {
  imageUrl: string | null;
  /** Monogram fallback letter — first letter of DJ name, else email (D-4). */
  monogram: string;
};

/**
 * The avatar as the floating nav needs it, or `null` when signed out — the
 * nav then keeps its placeholder icon. Fetched in the (authenticated) layout
 * (server) and passed down as a prop so `FloatingNav` stays a dumb
 * `usePathname()` client component that never fetches.
 */
export async function getNavAvatar(): Promise<NavAvatar | null> {
  const profile = await getSettingsProfile();
  if (!profile) return null;
  return {
    imageUrl: profile.avatarUrl,
    monogram: monogramLetter(profile.djName, profile.email),
  };
}
