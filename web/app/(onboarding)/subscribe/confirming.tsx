"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// The "we've seen your payment, Stripe hasn't finished telling us" state.
//
// Reachable only by navigating BACK to /subscribe after a confirmed Checkout —
// the corridor's happy path never renders this, because the return route sends
// a paying DJ straight to the phone step. It exists so that the one way back
// to this URL shows the truth ("your payment landed, hold on") instead of the
// two CTAs, which would read as "we didn't get it, try again" to the one
// person who must not try again.
//
// Refreshing rather than polling an endpoint of its own: `router.refresh()`
// re-runs page.tsx's server guard, which already knows every rule for leaving
// this screen. A bespoke /api/billing/status route would be a second, drifting
// copy of that logic for no gain.

const POLL_MS = 2500;
/** ~1 minute of refreshes. Past that the webhook isn't merely late, and a
 *  spinner that never resolves is a worse answer than saying so. */
const MAX_POLLS = 24;

export function ConfirmingSubscription() {
  const router = useRouter();
  const [exhausted, setExhausted] = useState(false);

  useEffect(() => {
    let polls = 0;
    const timer = setInterval(() => {
      polls += 1;
      if (polls > MAX_POLLS) {
        setExhausted(true);
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [router]);

  return (
    <div className="lp-ob-confirming">
      <p className="lp-body lp-auth-tag" role="status" aria-live="polite">
        {exhausted
          ? "Your payment went through, but the confirmation is taking longer than it should. Nothing is lost and you have not been charged twice. Get in touch and we'll finish this by hand."
          : "Payment received. Confirming with Stripe. This takes a few seconds."}
      </p>

      {exhausted && (
        <a className="lp-ob-skip" href="/contact">
          Contact us
        </a>
      )}
    </div>
  );
}
