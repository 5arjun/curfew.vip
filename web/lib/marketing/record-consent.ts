import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { SIGNUP_AGREEMENT_TEXT, SIGNUP_CONSENT_COOKIE } from "./consent";

// Did this request arrive carrying a signup-agreement marker?
//
// READ AND CLEARED IN ONE STEP, deliberately. Both auth routes run on every
// sign-in, not just the first, and a marker left in place would re-assert the
// same consent on every future login — harmless for the record's content, but
// it would keep overwriting the ORIGINAL timestamp with a later one, and the
// timestamp is the part a "as of when did they agree" question turns on.
//
// Absence is the safe answer: no consent recorded, contact stays opted out.
// The alternative — treating any account younger than the freshness window as
// consented — would fabricate records for the accounts that existed before
// this gate shipped, and a consent record that documents an agreement nobody
// made is worse than no record at all.
export async function takeSignupConsentMarker(): Promise<boolean> {
  const jar = await cookies();
  const present = jar.get(SIGNUP_CONSENT_COOKIE) !== undefined;
  if (present) jar.delete(SIGNUP_CONSENT_COOKIE);
  return present;
}

// Write the consent record onto the DJ's own row.
//
// Never throws: this runs on the last step of signup, immediately before a
// redirect into the app, and an account that exists must not be stranded
// because a consent write failed. A missing record is recoverable — it means
// the DJ stays opted out, which is the safe direction — while a 500 here
// strands someone who has already paid.
//
// The wording comes from the server's own constant, never from the request. A
// record assembled out of client-supplied values proves what a client sent,
// not what Curfew displayed, which is the one thing it exists to establish.
export async function recordSignupConsent(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  try {
    await supabase
      .from("djs")
      .update({
        marketing_email_consent_at: new Date().toISOString(),
        marketing_email_consent_text: SIGNUP_AGREEMENT_TEXT,
      })
      .eq("id", userId);
  } catch (error) {
    console.error("[consent] failed to record signup agreement", error);
  }
}
