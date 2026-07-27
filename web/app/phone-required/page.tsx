"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { setPhone } from "./actions";

// Functional, unpolished (this story's explicit scope — Story 2.4 owns the
// Ghost-input visual spec). Not skippable per EXPERIENCE.md's State Patterns
// "Phone number required" row — no cancel/skip control anywhere on this page.

type PhoneActionState = {
  status: "idle" | "error";
  error?: string;
};

const INITIAL_STATE: PhoneActionState = { status: "idle" };

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

export default function PhoneRequiredPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [state, formAction, pending] = useActionState(setPhone, INITIAL_STATE);

  // This page has nothing to do for a signed-out visitor (Task 3.2).
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (cancelled) return;
        if (!data.user) {
          router.replace("/login");
          return;
        }
        setChecking(false);
      })
      .catch(() => {
        if (!cancelled) router.replace("/login");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (checking) {
    return null;
  }

  return (
    <main style={{ maxWidth: "var(--container-max)", margin: "var(--space-xxl) auto", padding: "0 var(--space-lg)" }}>
      <h1 className="text-headline-md" style={{ marginBottom: "var(--space-lg)" }}>
        Add a phone number.
      </h1>

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
    </main>
  );
}
