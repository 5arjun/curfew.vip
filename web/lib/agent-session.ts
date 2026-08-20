import type { Session } from "@supabase/supabase-js";

// The agent-session route's one pure decision, kept out of the Route Handler
// so it's testable without a live Supabase project (this codebase has no
// Route Handler test harness — Story 7.2 Task 4.1). Everything else in that
// route is a network call: `generateLink` as service-role, then a
// server-side `verifyOtp` to redeem it.

/** The only two fields the agent's `curfew-agent://link?…` contract carries
 *  (plus the nonce, which the page passes straight through). Deliberately
 *  NOT the whole `Session` — nothing else may reach the client. */
export type AgentTokens = {
  access_token: string;
  refresh_token: string;
};

/**
 * Narrows a redeemed `verifyOtp` session down to the two tokens the deep
 * link carries, or `null` if either is missing/empty.
 *
 * The null case is the point. `Session.refresh_token` is typed non-optional,
 * but the value arrives over the wire from GoTrue, and a `undefined` reaching
 * `new URLSearchParams({...})` does not throw — it serializes as the literal
 * string `"undefined"`. That would hand the agent a token-shaped string it
 * would happily persist to the keychain and only fail on ~an hour later, at
 * the first refresh, with exactly the "Sync failed" symptom this whole change
 * exists to remove. Better to fail loudly here, before the handoff fires.
 */
export function extractAgentTokens(session: Session | null | undefined): AgentTokens | null {
  if (!session) return null;

  const { access_token, refresh_token } = session;
  if (typeof access_token !== "string" || access_token === "") return null;
  if (typeof refresh_token !== "string" || refresh_token === "") return null;

  return { access_token, refresh_token };
}
