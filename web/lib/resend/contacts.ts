import { Resend } from "resend";

import { isFreshSignup } from "@/lib/signup/window";

// Every DJ who signs up becomes a Resend contact, so the list exists on the
// day it is first needed rather than being reconstructed from auth.users
// later. Nothing is sent to them here — see the topic note below.
//
// Resend is already in this stack, but ONLY as Supabase Auth's SMTP transport
// (supabase/EMAIL-PROVISIONING.md): the domain is wired through Resend's
// Supabase integration and no application code has ever called the Resend API.
// This is the first module that does, which is why it carries its own key
// rather than borrowing the integration's — that one belongs to Supabase, and
// revoking the integration would silently take this with it.
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// Created 2026-08-20 with `defaultSubscription: "opt_out"`, which CANNOT be
// changed after creation — a new topic would be the only way to alter it.
//
// opt_out is the whole point. `docs/legal-review-2026-08-18.md` finding A:
// the Terms already grant Curfew the right to email marketing, but the consent
// was never collected and no unsubscribe mechanism exists. Ruled 2026-08-18 —
// keep the grant, build the consent before the first send. Storing a contact
// is not sending to one, so the list can start accumulating today; opted out
// of this topic, every DJ here is unreachable by a broadcast until they
// actively opt in.
//
// When the consent control lands on (onboarding)/phone-required, opting a DJ
// in is a single `contacts.update` against this id. Until then, this constant
// is what makes "we have a list" and "we may mail it" separate facts.
export const PRODUCT_UPDATES_TOPIC_ID = "737e9737-e979-4e5c-af4f-42d268662d3f";

// Sign in with Apple lets a DJ hide their real address behind a per-app relay.
// Those addresses are real and routable, but only while the relay is live AND
// only if the sending domain is registered with Apple's private email relay
// service — otherwise mail to them bounces. Recording the provider means a
// future broadcast can segment them out (or the registration can be checked)
// instead of discovering the bounce rate the hard way on the first send.
const APPLE_PRIVATE_RELAY_DOMAIN = "@privaterelay.appleid.com";

export function isApplePrivateRelay(email: string): boolean {
  return email.toLowerCase().endsWith(APPLE_PRIVATE_RELAY_DOMAIN);
}

// What gets stored alongside the address. `provider` answers the question the
// list is most likely to be sliced by (Google vs Apple vs email), and it is
// the only one of these facts that is not recoverable from the address itself.
export function contactProperties(user: {
  app_metadata?: { provider?: string };
}): { signup_provider: string } {
  return { signup_provider: user.app_metadata?.provider ?? "email" };
}

// Never throws, and never blocks a signup. A DJ who has just paid and is
// mid-redirect must not see a failure because a CRM write did — the account
// exists either way, and a missing contact is recoverable by backfill from
// auth.users. Same discipline as captureSignupCompleted, for the same reason.
//
// An absent key is a no-op, not an error: that is the correct state for a dev
// checkout and for any preview deployment built before the env var lands.
// RESEND_API_KEY is read at REQUEST time, inside the route handler — it is
// deliberately not consumed at build time, so it does not need naming in
// turbo.json. Anything that reads it during the build would be scrubbed by
// Turborepo, and the build would stay green while this silently did nothing
// (see turbo.json's comment on SENTRY_AUTH_TOKEN and the PostHog keys).
export async function recordSignupContact(
  user: {
    id: string;
    email?: string;
    created_at?: string;
    app_metadata?: { provider?: string };
  },
  // Defaults to OUT. Every caller that means "in" has to say so, and the one
  // that says so does it on the strength of a consent marker it actually saw —
  // never on the assumption that a new account must have consented.
  optedIn = false,
): Promise<void> {
  if (!RESEND_API_KEY) return;

  // No address, nothing to record. Reachable in principle: Supabase can be
  // configured to let a provider that returns no email still authenticate.
  if (!user.email) return;

  // Checked BEFORE the client is constructed, so a returning DJ's sign-in
  // costs nothing — no client, no network, no added latency on the hot path
  // every login walks. Only a genuinely new account pays for this.
  if (!isFreshSignup(user.created_at)) return;

  try {
    await new Resend(RESEND_API_KEY).contacts.create({
      email: user.email,
      properties: contactProperties(user),
      topics: [
        { id: PRODUCT_UPDATES_TOPIC_ID, subscription: optedIn ? "opt_in" : "opt_out" },
      ],
    });
  } catch (error) {
    // Swallowed on purpose: the alternative is a 500 on the last step of
    // signup in exchange for a mailing-list row.
    //
    // Logged, though, rather than swallowed silently — this catch covers
    // client construction as well as the request, so a malformed key or a
    // breaking SDK change lands here looking exactly like a transient network
    // blip. Without a line in the runtime log the failure mode is "the list
    // just never grows", which is precisely the kind of green-but-broken this
    // codebase keeps getting bitten by.
    console.error("[resend] contact write failed for a new signup", error);
  }
}

// Flip a DJ's Product-updates subscription to match what they just chose.
//
// This is the other half of the opt_out default: the contact row already
// exists from signup, so consent is an UPDATE, not a create. Resend's contact
// write upserts on email, which means this is also self-healing — a DJ whose
// signup-time write was lost to a Resend outage still lands on the list here,
// with the correct subscription, the moment they consent.
//
// Same failure discipline as recordSignupContact: never throws. The
// authoritative consent record is the `djs` row written in the same action —
// that is what a regulator would be shown. This call only mirrors it into the
// sending system, so it must not be able to fail the DJ's form.
//
// The mirror can therefore drift if Resend is down: `djs` says yes while
// Resend still says opt_out. That direction is the safe one — it under-sends,
// never over-sends — and is reconcilable later from the djs column, which is
// why it is the direction the failure is allowed to take.
export async function setMarketingEmailConsent(
  email: string | undefined,
  optedIn: boolean,
): Promise<void> {
  if (!RESEND_API_KEY || !email) return;

  try {
    // `contacts.topics.update`, not `contacts.update` — topics are a separate
    // sub-resource in the SDK and UpdateContactOptions carries no `topics`
    // field at all. Addressed by email rather than contact id so this needs no
    // stored Resend id of its own; the djs row stays the only record.
    await new Resend(RESEND_API_KEY).contacts.topics.update({
      email,
      topics: [
        {
          id: PRODUCT_UPDATES_TOPIC_ID,
          subscription: optedIn ? "opt_in" : "opt_out",
        },
      ],
    });
  } catch (error) {
    console.error("[resend] marketing consent mirror failed", error);
  }
}
