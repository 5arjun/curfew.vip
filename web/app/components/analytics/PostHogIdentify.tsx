"use client";

import { useEffect } from "react";

import { ensurePostHog } from "@/lib/posthog/client";

// Ties the anonymous browsing session to the account, and it is the single
// most important line of the whole analytics setup.
//
// Without it there are two disconnected piles of data: an anonymous one where
// prospective DJs read the landing page and start signing up, and an
// identified one where accounts use the product — with no way to join them.
// The question this exists to answer ("what path did this DJ take BEFORE they
// converted, and did the ones who bounced differ?") is only answerable across
// that join. posthog.identify() performs it retroactively: PostHog rewrites
// the already-captured anonymous events onto the person.
//
// Mounted in the authenticated layout, so it covers every signed-in route
// without a per-page list — the same property that layout's login gate was
// rewritten to have.
export function PostHogIdentify({ distinctId }: { distinctId: string | null }) {
  useEffect(() => {
    // Null when the layout's auth read threw and it failed open. Not an error:
    // just an un-attributed session, which is the correct degradation.
    if (!distinctId) return;

    let cancelled = false;

    void ensurePostHog().then((posthog) => {
      if (cancelled || !posthog) return;
      // identify() on an already-identified person is not free — it re-sends
      // the person payload on every mount, i.e. on every soft navigation
      // between authenticated routes. Guarding on the current distinct id
      // makes this fire once per session instead of once per render.
      if (posthog.get_distinct_id() !== distinctId) {
        posthog.identify(distinctId);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [distinctId]);

  return null;
}
