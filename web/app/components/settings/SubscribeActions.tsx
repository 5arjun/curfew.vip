"use client";

import { useState } from "react";
import type { BillingInterval } from "@/lib/billing/checkout";

// The Subscribe CTA (Story 7.2, AC-3/AC-6). Two intervals of one plan; each
// posts to the Checkout route and sends the browser to Stripe's hosted page.
// Nothing here touches a card field — that's the whole point of hosted
// Checkout, and AD-18 rules out bespoke payment UI.
//
// A client island for the same reason PasswordResetRow is one: it needs an
// onClick. The visibility decision (whether to render at all) stays on the
// server, in BillingSection.

type State = "idle" | "starting" | "failed";

const OPTIONS: { interval: BillingInterval; label: string; primary: boolean }[] = [
  // Yearly first and emphasized — it's the price the marketing surfaces lead
  // with ("$6.99/month. Billed yearly — or $7.99 month to month").
  { interval: "annual", label: "Billed yearly · $6.99/mo", primary: true },
  { interval: "monthly", label: "Month to month · $7.99/mo", primary: false },
];

export function SubscribeActions() {
  const [state, setState] = useState<State>("idle");

  async function start(interval: BillingInterval) {
    setState("starting");
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `source` picks the success_url from a server-side map — Settings
        // returns here, while /subscribe's twin of this component continues
        // down the setup corridor instead. The server defaults a missing
        // `source` to "settings", so an open tab from before this field
        // existed still works; sending it explicitly is what keeps the two
        // callers legible.
        body: JSON.stringify({ interval, source: "settings" }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const url =
        response.ok && typeof payload === "object" && payload !== null
          ? (payload as { url?: unknown }).url
          : null;

      if (typeof url !== "string" || url === "") {
        setState("failed");
        return;
      }
      // Deliberately NOT resetting state here: the navigation is already
      // committed, so flipping back to "idle" would re-enable the buttons for
      // the instant before the page unloads and invite a second session.
      //
      // `.assign()` rather than the story's `location.href = url`: the two are
      // equivalent, but the React Compiler's immutability lint reads the
      // assignment as mutating a value defined outside the component and
      // fails the build.
      window.location.assign(url);
    } catch {
      setState("failed");
    }
  }

  const busy = state === "starting";

  return (
    <div className="st-row">
      {/* Unlabeled, like AgentSection's Link-agent row: this is an action
          line, not a fact line. */}
      <span className="st-row-label" aria-hidden="true" />
      <div className="st-row-cell">
        <div className="st-action-pair">
          {OPTIONS.map((option) => (
            <button
              key={option.interval}
              type="button"
              className={option.primary ? "st-action st-action-primary" : "st-action"}
              disabled={busy}
              onClick={() => void start(option.interval)}
            >
              {busy ? "Opening…" : option.label}
            </button>
          ))}
        </div>
        <p className="st-row-note">Card details go to Stripe, never to Curfew.</p>
        {state === "failed" && (
          <p className="st-inline-error" role="alert">
            Couldn&apos;t open checkout. Retry.
          </p>
        )}
      </div>
    </div>
  );
}
