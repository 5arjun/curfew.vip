"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MARKETING_EMAIL_CONSENT_TEXT } from "@/lib/marketing/consent";
import { setMarketingEmailConsent } from "@/lib/resend/contacts";
import { AUTH_FAILURE_COPY } from "@/app/(marketing)/login/auth-copy";
import { isValidPhone, normalizePhone } from "./phone-validation";
import { normalizeTimezone } from "./timezone-validation";
import type { PhoneActionState } from "./phone-state";

export async function setPhone(
  _prevState: PhoneActionState,
  formData: FormData,
): Promise<PhoneActionState> {
  const phone = String(formData.get("phone") ?? "").trim();

  if (!phone) {
    return { status: "error", error: "Enter a phone number." };
  }

  if (!isValidPhone(phone)) {
    return { status: "error", error: "Enter a valid phone number." };
  }

  // Stored in E.164, always — never the DJ's own spelling. Two formats in
  // one column is a bug that only shows up much later, at the first thing
  // that has to dial or text the number.
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    // Reachable only for a well-formed but country-ambiguous number, since
    // isValidPhone already cleared the input above. Naming the country code
    // is the whole ask, so the copy shows one.
    return {
      status: "error",
      error: "Add a country code before your number, like +1 267 555 0199.",
    };
  }

  // Story 7.7: the browser's IANA zone, from this form's hidden field. It is
  // the DJ-level fallback for bucketing a set whose own payload carried no zone
  // (an agent older than 7.7, or any set captured before it).
  //
  // **It must never be able to fail this form.** A DJ whose browser reports no
  // zone, or a nonsense one, still gets a phone number saved and still reaches
  // /welcome — AD-19 forbids gating in this direction, and losing the zone
  // costs a disclosure line, while losing the phone number costs the account's
  // only contactability. So: validated loosely, dropped silently, never
  // surfaced as an error.
  const timezone = normalizeTimezone(String(formData.get("timezone") ?? ""));

  // The checkbox contributes exactly one bit: present or absent. Everything
  // else about the record — the timestamp and the wording — is taken from the
  // SERVER's own constant, never from the request.
  //
  // That is the whole point. A consent record assembled from client-supplied
  // values proves only that a client sent those values; it cannot establish
  // what Curfew actually displayed. Reading the text server-side from the same
  // module the form imports for rendering is what makes the stored string a
  // claim about our own behaviour rather than about theirs.
  const marketingConsent = formData.get("marketingEmailConsent") !== null;

  const supabase = await createClient();

  // Supabase calls are caught (not the redirect() below — redirect() works
  // by throwing, so it must stay outside this block or its own throw would
  // be swallowed here) so a network hiccup returns a calm form error instead
  // of surfacing a raw 500. Same discipline as auth/callback and
  // auth/confirm's route handlers.
  let succeeded = false;
  // Set only on a djs_phone_e164 CHECK violation (23514) — normalizedPhone
  // always satisfies that constraint today, so this only fires if a stale
  // pre-normalization deploy is still live against an already-migrated DB,
  // or the app-side and column-side rules ever drift. Worth a specific
  // message either way, rather than the generic fallback below.
  let checkViolation = false;
  try {
    const { data, error: userError } = await supabase.auth.getUser();
    if (!userError && data.user) {
      // .select("id") makes a zero-row update (e.g. no matching djs row)
      // distinguishable from a real success — a bare .update() with no
      // .select() reports no error either way.
      //
      // The zone goes in the SAME update as the phone — one write, one RLS
      // check, no second round trip and no partial-success state to reason
      // about. When the browser gave us nothing, the key is omitted entirely
      // rather than written as null: this action also runs for a DJ correcting
      // a rejected number, and an omitted key leaves a zone we already have
      // alone, where an explicit null would erase it.
      // The consent columns ride the SAME update as the phone and the zone —
      // one write, one RLS check. They are only included when the box was
      // ticked: an unticked box must leave a NULL record as NULL rather than
      // writing a "no", because djs_marketing_consent_complete makes a
      // timestamp-without-wording unrepresentable and because absent is
      // already the correct encoding of "never opted in".
      const consentFields = marketingConsent
        ? {
            marketing_email_consent_at: new Date().toISOString(),
            marketing_email_consent_text: MARKETING_EMAIL_CONSENT_TEXT,
          }
        : {};

      const { data: updated, error } = await supabase
        .from("djs")
        .update({
          phone: normalizedPhone,
          ...(timezone ? { timezone } : {}),
          ...consentFields,
        })
        .eq("id", data.user.id)
        .select("id");
      succeeded = !error && (updated?.length ?? 0) > 0;
      checkViolation = error?.code === "23514";

      // Mirrored into Resend only after the djs write is known to have landed,
      // and only for a yes. The djs row is the authoritative record — this
      // call just tells the sending system about it, and it cannot throw (see
      // setMarketingEmailConsent). Mirroring a consent whose own record failed
      // to save would invert which system is the source of truth.
      if (succeeded && marketingConsent) {
        await setMarketingEmailConsent(data.user.email, true);
      }
    }
  } catch {
    succeeded = false;
  }

  if (succeeded) {
    // Step 2 of the setup corridor: the account is contactable, the archive
    // is still empty — /welcome is where the agent gets introduced (UJ-3
    // step 3, the "the account alone can't do anything yet" prompt).
    redirect("/welcome");
  }

  if (checkViolation) {
    return {
      status: "error",
      error: "Add a country code before your number, like +1 267 555 0199.",
    };
  }

  return { status: "error", error: AUTH_FAILURE_COPY.generic };
}
