"use client";

import { useActionState } from "react";
import { Button } from "@/app/components/auth/Button";
import { GhostInput } from "@/app/components/auth/GhostInput";
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
          is already a write to their `djs` row. `defaultValue` (not `value`)
          because it is never re-read or controlled — it is a one-shot fact
          about the machine, captured at render.

          Absent or garbage is fine: the action treats it as "no zone", and
          bucketing falls through to UTC with the set counted as a disclosure.
          Nothing here may gate the form (AD-19). */}
      <input
        type="hidden"
        name="timezone"
        defaultValue={resolveBrowserTimezone()}
        aria-hidden="true"
      />

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
