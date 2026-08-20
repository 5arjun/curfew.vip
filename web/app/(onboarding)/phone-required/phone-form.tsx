"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/app/components/auth/Button";
import { GhostInput } from "@/app/components/auth/GhostInput";
import { MARKETING_EMAIL_CONSENT_TEXT } from "@/lib/marketing/consent";
import { setPhone } from "./actions";
import { INITIAL_PHONE_STATE } from "./phone-state";

/**
 * The browser's IANA zone name, or `""` if this runtime will not say.
 *
 * `resolvedOptions().timeZone` is universally supported and returns an IANA
 * name, but it is spec'd to be allowed to return `undefined`, and it can throw
 * in a locked-down runtime. Neither case may break signup — a missing zone is a
 * permanently valid state here, not an error (AD-3), so it degrades to `""` and
 * the server reads that as absent.
 */
function resolveBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

export function PhoneForm() {
  const [state, formAction, pending] = useActionState(setPhone, INITIAL_PHONE_STATE);
  const timezoneRef = useRef<HTMLInputElement>(null);

  // Written in an effect, not rendered (code review, 2026-08-17). This is a
  // Client Component, and Next still prerenders those on the server — where
  // `resolvedOptions().timeZone` is the SERVER's zone, i.e. `"UTC"` on Vercel.
  // Rendering the call put `value="UTC"` in the delivered HTML, and a submit
  // that beat hydration (this form is progressively enhanced — `formAction` is
  // a real server action) would have written `djs.timezone = 'UTC'`: a
  // fabricated zone indistinguishable from a DJ who genuinely plays in London,
  // resolving as `source: "dj"` and never counted as a fallback. That is the
  // exact default `capture.rs`'s `local_timezone` refuses to invent on the
  // agent side (AD-11), and it must not be invented here either.
  //
  // An effect only runs in the browser, so the field is either the DJ's real
  // zone or empty — and empty is a permanently valid state (AD-3), read by the
  // action as absent.
  useEffect(() => {
    const field = timezoneRef.current;
    if (field) field.value = resolveBrowserTimezone();
  }, []);

  return (
    <form action={formAction}>
      {/* Parens escaped because browsers compile `pattern` with the regex
          v-flag, where ( ) are reserved class punctuators — the unescaped
          form is a SyntaxError and the whole attribute is silently ignored
          (caught in the 2026-08-15 browser pass; server-side
          isValidPhone() was the only thing actually validating). */}
      <GhostInput
        label="Phone number"
        name="phone"
        type="tel"
        autoComplete="tel"
        required
        pattern="^\+?[0-9\(\)\-.\s]{7,20}$"
        maxLength={20}
      />

      {/* Story 7.7: the DJ's time zone, from the only place that knows it —
          their own browser. The server renders in UTC (Vercel), so this cannot
          be derived server-side; it has to ride a request the browser makes.

          It rides THIS form rather than getting its own round trip because
          /phone-required is the one corridor step every new DJ walks, and this
          is already a write to their `djs` row. Filled by the effect above
          rather than by `defaultValue` — see the note there for why rendering
          the value was wrong.

          Absent or garbage is fine: the action treats it as "no zone", and
          bucketing falls through to UTC with the set counted as a disclosure.
          Nothing here may gate the form (AD-19). */}
      <input
        ref={timezoneRef}
        type="hidden"
        name="timezone"
        defaultValue=""
        aria-hidden="true"
      />

      {/* The marketing consent control (docs/legal-review-2026-08-18.md
          finding A). Deliberately shaped:

          - UNCHECKED by default, and there is no `defaultChecked`. A pre-ticked
            box is not consent under GDPR and is not evidence under any regime.
          - Not `required`, and nothing above depends on it. Consent that is a
            condition of finishing signup is not freely given — the DJ can leave
            it alone and Continue works exactly the same.
          - EMAIL only. Marketing texts stay out of this until TCPA's prior
            express written consent and A2P 10DLC registration exist; the page
            comment above tracks that separately.

          The label text is imported, not written here, because the server
          stores that exact string as the consent record — if the two could
          drift, the record would describe wording the DJ never saw. */}
      <div className="auth-consent-field">
        <input
          id="marketing-email-consent"
          name="marketingEmailConsent"
          type="checkbox"
          value="yes"
          className="auth-consent-field-box"
        />
        <label className="text-body-md auth-consent-field-label" htmlFor="marketing-email-consent">
          {MARKETING_EMAIL_CONSENT_TEXT}
        </label>
      </div>

      {state.status === "error" && state.error && (
        <p className="lp-auth-error" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending} className="lp-auth-submit">
        {pending ? "Saving…" : "Continue"}
      </Button>
    </form>
  );
}
