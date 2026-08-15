"use client";

import { useActionState } from "react";
import { Button } from "@/app/components/auth/Button";
import { GhostInput } from "@/app/components/auth/GhostInput";
import { setPhone } from "./actions";
import { INITIAL_PHONE_STATE } from "./phone-state";

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
