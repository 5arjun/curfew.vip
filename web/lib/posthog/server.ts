import { createHash } from "node:crypto";

import { PostHog } from "posthog-node";

import { isFreshSignup } from "@/lib/signup/window";

import { POSTHOG_INGEST_HOST, POSTHOG_KEY } from "./config";

// Server-side capture, for the events that must not be reported by a browser.
//
// The subscription is the one event where a client-side report isn't good
// enough. Browser capture undercounts (ad blockers, a tab closed on the Stripe
// return, a DJ who pays on their phone and never lands back), and an
// undercounted conversion doesn't read as missing — it reads as a worse
// product. Capturing from the Stripe webhook instead means the revenue funnel
// agrees with Stripe by construction.
//
// `distinctId` is always the Supabase user id, the same value PostHogIdentify
// sends from the browser. That is what lets a server-captured conversion land
// on the same person as the anonymous landing-page visit that preceded it.

// The project API key is a write-only ingest key (the same value the browser
// bundle carries), so there is no secret here to keep off the server/client
// boundary — only a different host, because the server has no rewrites to use.
export function getPostHogServer(): PostHog | null {
  if (!POSTHOG_KEY) return null;

  // A fresh client per call, flushed and shut down by the caller. Serverless
  // gives no reliable "process is ending" hook to drain a long-lived queue
  // from, and a batched event that never flushes is an event that never
  // happened — worth more than the cost of re-creating the client.
  return new PostHog(POSTHOG_KEY, {
    host: POSTHOG_INGEST_HOST,
    flushAt: 1,
    flushInterval: 0,
  });
}

// PostHog drops an event whose `uuid` it has already ingested, which is the
// only dedupe hook available to a caller that gets redelivered — but the field
// has to BE a uuid. The natural key here (a Stripe event id, `evt_1ABC…`) is
// not one, and handing PostHog a malformed value doesn't fail loudly: it
// falls back to minting a fresh id, so every redelivery lands as a new event
// and the dedupe silently never happens. Hashing the natural key into
// uuid-shaped hex keeps it deterministic AND well-formed.
//
// Version nibble 5 and variant nibble 8 are set so this reads as a name-based
// UUID rather than a random one that happens to collide with the format.
function dedupeUuid(key: string): string {
  const h = createHash("sha1").update(key).digest("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `5${h.slice(13, 16)}`,
    `8${h.slice(17, 20)}`,
    h.slice(20, 32),
  ].join("-");
}

// Capture one server-side event and drain it before returning. Never throws:
// every caller is a route whose real job (writing billing state, responding to
// Stripe) must not fail because analytics did.
//
// `dedupeKey` should be the upstream event's own id wherever the caller can be
// redelivered — pass it and redelivery becomes a no-op.
export async function captureServer(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
  dedupeKey?: string,
): Promise<void> {
  const client = getPostHogServer();
  if (!client) return;

  try {
    client.capture({
      distinctId,
      event,
      properties,
      ...(dedupeKey ? { uuid: dedupeUuid(dedupeKey) } : {}),
    });
    await client.shutdown();
  } catch (err) {
    console.error("posthog: server capture failed", event, err);
  }
}

// A DJ has an account. The top of the funnel's second half, and the event both
// auth routes report because a signup can arrive through either of them:
// /auth/callback for Google and Apple, /auth/confirm for email.
//
// Fired from the SERVER rather than the browser for the same reason the Stripe
// conversion is: the OAuth and email-confirmation round trips both end in a
// redirect, and a browser-side capture racing a redirect is a capture that
// sometimes doesn't happen.
//
// TWO INDEPENDENT GUARDS, because each covers a case the other doesn't:
//
//   1. `signup:<id>` as the dedupe key means PostHog keeps the first of these
//      and drops the rest. Both routes run on every subsequent sign-in too, so
//      without this the event would count logins, not signups.
//   2. The age window, because guard 1 rests on PostHog retaining a dedupe
//      record indefinitely, and a returning DJ signing in months later must
//      not be able to re-report their own signup if it ever ages out.
//
// Guard 2 lives in lib/signup/window.ts, shared with the Resend contact write
// so the two cannot drift apart about what counts as a new account — see the
// note there for why the window is a day rather than minutes.
export async function captureSignupCompleted(user: {
  id: string;
  created_at?: string;
  app_metadata?: { provider?: string };
}): Promise<void> {
  // Checked BEFORE the client is constructed, so a returning DJ's sign-in
  // costs nothing — no PostHog client, no network, no added latency on the
  // hot path every login walks. Only a genuinely new account pays for this.
  if (!isFreshSignup(user.created_at)) return;

  await captureServer(
    user.id,
    "signup_completed",
    { provider: user.app_metadata?.provider ?? "email" },
    `signup:${user.id}`,
  );
}
