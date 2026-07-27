"use client";

import { useActionState } from "react";
import { setPhone } from "./actions";
import { INITIAL_PHONE_STATE } from "./phone-state";

// Functional, unpolished (this story's explicit scope — Story 2.4 owns the
// Ghost-input visual spec).

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-xs)",
  marginBottom: "var(--space-md)",
};

const inputStyle: React.CSSProperties = {
  padding: "var(--space-sm)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-outline)",
  background: "var(--color-surface-container)",
  color: "var(--color-on-surface)",
  fontSize: "16px",
};

const errorStyle: React.CSSProperties = {
  color: "var(--color-error)",
};

const buttonStyle: React.CSSProperties = {
  padding: "var(--space-sm) var(--space-md)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-outline)",
  background: "var(--color-surface-container-high)",
  color: "var(--color-on-surface)",
  cursor: "pointer",
};

export function PhoneForm() {
  const [state, formAction, pending] = useActionState(setPhone, INITIAL_PHONE_STATE);

  return (
    <form action={formAction}>
      <div style={fieldStyle}>
        <label className="text-label-sm" htmlFor="phone">
          Phone number
        </label>
        <input id="phone" name="phone" type="tel" autoComplete="tel" required style={inputStyle} />
      </div>

      {state.status === "error" && state.error && (
        <p className="text-body-md" style={{ ...errorStyle, marginBottom: "var(--space-md)" }} role="alert">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} style={buttonStyle}>
        Continue
      </button>
    </form>
  );
}
