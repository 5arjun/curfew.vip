"use client";

import { useState } from "react";

// The Manage billing CTA (Story 7.4, AC-1/AC-3). One button, posts to the
// Portal route, sends the browser to Stripe's hosted Customer Portal.
// Structurally mirrors SubscribeActions — a client island for the onClick,
// with the render-or-not decision staying on the server in BillingSection.

// Failure is not one thing. The route already distinguishes four cases by
// status code; telling a DJ to "retry" is right for exactly one of them, and
// actively misleading for the rest — an expired session needs a re-login, a
// stale tab needs a reload, and a disabled-billing environment will never
// succeed no matter how many times the button is pressed.
type Failure = "retry" | "signedOut" | "gone" | "unavailable";

type State = { kind: "idle" } | { kind: "starting" } | { kind: "failed"; why: Failure };

const FAILURE_COPY: Record<Failure, string> = {
  retry: "Couldn't open billing management. Retry.",
  signedOut: "Your session expired. Sign in again to manage billing.",
  gone: "This subscription is no longer active. Reload the page.",
  unavailable: "Billing management is unavailable right now.",
};

function failureFor(status: number): Failure {
  if (status === 401) return "signedOut";
  if (status === 404) return "gone";
  if (status === 503) return "unavailable";
  return "retry";
}

export function ManageBillingActions() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function start() {
    setState({ kind: "starting" });
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setState({ kind: "failed", why: failureFor(response.status) });
        return;
      }

      const url =
        typeof payload === "object" && payload !== null
          ? (payload as { url?: unknown }).url
          : null;

      if (typeof url !== "string" || url === "") {
        setState({ kind: "failed", why: "retry" });
        return;
      }
      // Deliberately NOT resetting state here, same reasoning as
      // SubscribeActions: the navigation is already committed.
      window.location.assign(url);
    } catch {
      setState({ kind: "failed", why: "retry" });
    }
  }

  const busy = state.kind === "starting";

  return (
    <div className="st-row">
      <span className="st-row-label" aria-hidden="true" />
      <div className="st-row-cell">
        <button
          type="button"
          className="st-action"
          disabled={busy}
          onClick={() => void start()}
        >
          {busy ? "Opening…" : "Manage billing"}
        </button>
        {state.kind === "failed" && (
          <p className="st-inline-error" role="alert">
            {FAILURE_COPY[state.why]}
          </p>
        )}
      </div>
    </div>
  );
}
