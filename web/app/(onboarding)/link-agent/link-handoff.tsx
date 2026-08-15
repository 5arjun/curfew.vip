"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Reads the *browser* Supabase client's already-issued session (this page
// does not itself authenticate anyone — Stories 2.3a/2.3b/2.3d already did,
// or the DJ just signed in via the server guard's /login redirect) and hands
// its access/refresh tokens off to the agent via a custom-scheme redirect.
// No new database row, no new API route, no new Supabase mutation (AD-8/
// AD-14 by construction).
export function LinkHandoff() {
  const [status, setStatus] = useState<"opening" | "no-session" | "error">(
    "opening",
  );

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    // The agent generates this nonce when it opens the browser (tray "Link
    // Account") and remembers it in memory; echoing it back unmodified is
    // what lets the agent reject an unsolicited curfew-agent://link trigger
    // (CSRF mitigation, Review Findings) — this page never validates it
    // itself, it's purely a pass-through.
    const nonce = new URLSearchParams(window.location.search).get("nonce") ?? "";

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;

        const session = data.session;
        if (!session) {
          setStatus("no-session");
          return;
        }

        const params = new URLSearchParams({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          nonce,
        });
        window.location.href = `curfew-agent://link?${params.toString()}`;
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "no-session") {
    return (
      <p className="lp-auth-error" role="alert">
        Your session expired. Go back and sign in, then return to this page.
      </p>
    );
  }

  if (status === "error") {
    return (
      <p className="lp-auth-error" role="alert">
        Something went wrong checking your session. Please try again.
      </p>
    );
  }

  return (
    <div>
      {/* Known, unavoidable UX edge case (Story 2.10 Task 7): if the agent
          isn't installed or its curfew-agent:// scheme isn't registered, this
          redirect silently does nothing in most browsers — no reliable
          cross-browser "app not installed" callback exists for custom
          schemes. Calm, Console-Voice-style copy plus a manual fallback is
          the whole mitigation; there is no way to engineer around it. The
          fallback now points at /welcome — the setup screen with the actual
          download — instead of the marketing landing it pointed at when no
          such screen existed. */}
      <p className="lp-body lp-auth-tag">
        Opening Curfew Agent — if nothing happens, make sure it&rsquo;s installed and running.
      </p>
      <p className="lp-auth-switch">
        Don&rsquo;t have the agent yet? <Link href="/welcome">Get set up</Link>.
      </p>
    </div>
  );
}
