"use client";

import { useState } from "react";
import { sendPasswordReset } from "@/lib/account/actions";

// Password row (Story 3.10, AC-8, D-5): one action that emails a recovery
// link — no in-form old/new pair. The link lands on /auth/reset →
// /reset-password, where the new password is actually set (the story's
// "minimal COMPLETE flow" ruling). States stay inline and calm.

type State = "idle" | "sending" | "sent" | "failed";

export function PasswordResetRow() {
  const [state, setState] = useState<State>("idle");

  async function send() {
    setState("sending");
    const result = await sendPasswordReset().catch(() => ({ ok: false as const }));
    setState(result.ok ? "sent" : "failed");
  }

  return (
    <div className="st-row">
      <span className="st-row-label">Password</span>
      <div className="st-row-cell">
        <button
          type="button"
          className="st-action"
          disabled={state === "sending"}
          onClick={() => void send()}
        >
          {state === "sending" ? "Sending…" : "Send reset link"}
        </button>
        {state === "sent" && (
          <p className="st-inline-ok" role="status">
            Reset link sent — check your email.
          </p>
        )}
        {state === "failed" && (
          <p className="st-inline-error" role="alert">
            Link not sent — retry.
            <button type="button" className="st-retry" onClick={() => void send()}>
              Retry
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
