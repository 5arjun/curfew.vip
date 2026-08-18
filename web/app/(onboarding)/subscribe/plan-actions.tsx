"use client";

import Link from "next/link";
import { useState } from "react";
import type { BillingInterval } from "@/lib/billing/checkout";

// The corridor's Subscribe CTAs — the onboarding twin of Settings'
// SubscribeActions, and deliberately a separate component rather than a
// `variant` prop on that one.
//
// They share nine lines of fetch and diverge on everything else: this is a
// two-option decision screen with prices, a headline and a card, while that
// one is a single row inside a settings table (`st-row`, `st-action`) whose
// whole job is to be unobtrusive. Threading both layouts through one component
// would mean a prop that switches every class name, which is two components
// wearing a trench coat. What DOES need to stay shared is the wire contract,
// and that lives in lib/billing/checkout.ts where both import it.
//
// A client island for the same reason its Settings sibling is one: it needs an
// onClick. Whether it renders at all is decided on the server, in page.tsx.

type State = "idle" | "starting" | "failed";

const OPTIONS: {
  interval: BillingInterval;
  price: string;
  cadence: string;
  note: string;
  primary: boolean;
}[] = [
  // Yearly first and emphasized, matching every marketing surface — the
  // landing hero, the login pitch and the FAQ all lead with $6.99 billed
  // yearly and mention $7.99 second. A DJ who read the price on the way in
  // should meet the same price on the way through.
  {
    interval: "annual",
    price: "$6.99",
    cadence: "/month, billed yearly",
    note: "$83.88 once a year",
    primary: true,
  },
  {
    interval: "monthly",
    price: "$7.99",
    cadence: "/month, month to month",
    note: "Cancel whenever",
    primary: false,
  },
];

export function PlanActions() {
  const [state, setState] = useState<State>("idle");

  async function start(interval: BillingInterval) {
    setState("starting");
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `source` is what routes Stripe's success_url back into the corridor
        // instead of to Settings. The server maps it to a URL; nothing here
        // names a destination.
        body: JSON.stringify({ interval, source: "onboarding" }),
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
      // Not reset to "idle" on success — the navigation is already committed,
      // and re-enabling the buttons for the instant before the page unloads
      // invites a second session. `.assign()` rather than assigning to
      // `location.href`, which the React Compiler's immutability lint fails.
      window.location.assign(url);
    } catch {
      setState("failed");
    }
  }

  const busy = state === "starting";

  return (
    <div className="lp-ob-plans">
      {OPTIONS.map((option) => (
        <button
          key={option.interval}
          type="button"
          className={option.primary ? "lp-ob-plan lp-ob-plan--primary" : "lp-ob-plan"}
          disabled={busy}
          onClick={() => void start(option.interval)}
        >
          <span className="lp-ob-plan-price">
            {option.price}
            <span className="lp-ob-plan-cadence">{option.cadence}</span>
          </span>
          <span className="lp-ob-plan-note">{busy ? "Opening…" : option.note}</span>
        </button>
      ))}

      {/* The auto-renewal disclosure, added by the 2026-08-18 legal review
          (finding C). California's ARL and federal ROSCA both want the renewal
          terms clear and conspicuous *next to the button*, not only on
          Stripe's hosted page — and the annual button above reads "$83.88 once
          a year", which is the one that most reads like a single purchase.
          Cancellation is genuinely self-serve (Settings → the Stripe portal,
          app/api/billing/portal), so this sentence is true as written; if that
          portal's cancel flow is ever turned off in the Stripe dashboard, this
          copy goes false and the click-to-cancel requirement goes with it. */}
      <p className="lp-ob-plan-fine">
        Renews automatically until you cancel. Cancel any time in Settings.
      </p>
      <p className="lp-ob-plan-fine">
        Card details go to Stripe, never to Curfew. By subscribing you agree to the{" "}
        <Link href="/terms">terms</Link> and <Link href="/privacy">privacy policy</Link>.
      </p>

      {state === "failed" && (
        <p className="lp-ob-plan-error" role="alert">
          Couldn&apos;t open checkout — retry.
        </p>
      )}
    </div>
  );
}
