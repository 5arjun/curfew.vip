"use client";

import { useActionState } from "react";
import { Button } from "../components/auth/Button";
import { GhostInput } from "../components/auth/GhostInput";
import { setPhone } from "./actions";
import { INITIAL_PHONE_STATE } from "./phone-state";

const errorStyle: React.CSSProperties = {
  color: "var(--color-error)",
};

export function PhoneForm() {
  const [state, formAction, pending] = useActionState(setPhone, INITIAL_PHONE_STATE);

  return (
    <form action={formAction}>
      <GhostInput
        label="Phone number"
        name="phone"
        type="tel"
        autoComplete="tel"
        required
        pattern="^\+?[0-9()\-.\s]{7,20}$"
        maxLength={20}
      />

      {state.status === "error" && state.error && (
        <p className="text-body-md" style={{ ...errorStyle, marginBottom: "var(--space-md)" }} role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending}>
        Continue
      </Button>
    </form>
  );
}
