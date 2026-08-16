"use client";

import { useState } from "react";

// The Manage billing CTA (Story 7.4, AC-1/AC-3). One button, posts to the
// Portal route, sends the browser to Stripe's hosted Customer Portal.
// Structurally mirrors SubscribeActions — a client island for the onClick,
// with the render-or-not decision staying on the server in BillingSection.

type State = "idle" | "starting" | "failed";

export function ManageBillingActions() {
  const [state, setState] = useState<State>("idle");

  async function start() {
    setState("starting");
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const payload: unknown = await response.json().catch(() => null);
      const url =
        response.ok && typeof payload === "object" && payload !== null
          ? (payload as { url?: unknown }).url
          : null;

      if (typeof url !== "string" || url === "") {
        setState("failed");
        return;
      }
      // Deliberately NOT resetting state here, same reasoning as
      // SubscribeActions: the navigation is already committed.
      window.location.assign(url);
    } catch {
      setState("failed");
    }
  }

  const busy = state === "starting";

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
        {state === "failed" && (
          <p className="st-inline-error" role="alert">
            Couldn&apos;t open billing management — retry.
          </p>
        )}
      </div>
    </div>
  );
}
