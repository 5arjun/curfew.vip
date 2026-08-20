"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { capture } from "@/lib/posthog/client";
import { createClient } from "@/lib/supabase/client";

// Reads the *browser* Supabase client's already-issued session (this page
// does not itself authenticate anyone — Stories 2.3a/2.3b/2.3d already did,
// or the DJ just signed in via the server guard's /login redirect) and hands
// its access/refresh tokens off to the agent via a custom-scheme redirect.
// No new database row, no new API route, no new Supabase mutation (AD-8/
// AD-14 by construction).
// How long to keep watching for the agent's first heartbeat before falling
// back to the manual copy. The agent beats on every sync-queue drain pass, so
// a healthy link shows up in seconds; this only needs to outlast one slow
// pass, not a DJ's whole install.
const CONFIRM_TIMEOUT_MS = 90_000;
const CONFIRM_POLL_MS = 2_000;

export function LinkHandoff() {
  const [status, setStatus] = useState<
    "opening" | "confirmed" | "no-session" | "error"
  >("opening");

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    // Watches `agent_status` for this DJ's heartbeat, which is the only
    // evidence either side has that linking worked.
    //
    // The comment below is right that a custom-scheme redirect gives the
    // *browser* no callback — but that only means the confirmation cannot
    // come back through the scheme. It can come from the agent's own first
    // contact with the cloud, and Story 3.9's heartbeat is already that
    // signal. Before this, a DJ who linked successfully saw the same
    // "Opening Curfew Agent…" as a DJ who never installed it, which on
    // 2026-08-20 sent a real linked install down a LaunchServices rabbit hole
    // for twenty minutes.
    //
    // Compared against a baseline rather than mere existence: a DJ re-linking
    // an install that already beat once would otherwise be told "connected"
    // by the old row, before the new link had landed.
    async function confirmAgentContact(dj_id: string, since: string | null) {
      const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
      while (!cancelled && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, CONFIRM_POLL_MS));
        if (cancelled) return;

        const { data } = await supabase
          .from("agent_status")
          .select("updated_at")
          .eq("dj_id", dj_id)
          .maybeSingle<{ updated_at: string }>();

        if (data && (!since || data.updated_at > since)) {
          if (cancelled) return;
          setStatus("confirmed");
          // The real linked signal the `agent_link_started` comment below
          // says is missing — fired from the one place that can actually
          // observe it, so the funnel's last step stops being a guess.
          void capture("agent_linked");
          return;
        }
      }
    }

    // The agent generates this nonce when it opens the browser (tray "Link
    // Account") and remembers it in memory; echoing it back unmodified is
    // what lets the agent reject an unsolicited curfew-agent://link trigger
    // (CSRF mitigation, Review Findings) — this page never validates it
    // itself, it's purely a pass-through.
    const nonce = new URLSearchParams(window.location.search).get("nonce") ?? "";

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
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

        // NOT named `agent_linked`, and deliberately so. This page cannot
        // observe whether linking worked: the handoff is a custom-scheme
        // redirect, and as the comment further down records, a browser gives
        // no callback when the scheme isn't registered. An `agent_linked`
        // fired here would count DJs who never installed the agent, which is
        // worse than not measuring it — it would read as a healthy step while
        // hiding the exact drop-off it was added to find.
        //
        // What this DOES prove is that a DJ with a valid session reached the
        // handoff and it fired. Pairing it with a real linked signal (which
        // has to come from the agent's first contact, and the agent talks to
        // Supabase directly rather than through this app) is what would close
        // the gap.
        //
        // `has_nonce` separates the two ways in: the agent's tray "Link
        // Account" button supplies one, a DJ navigating here by hand does not.
        void capture("agent_link_started", { has_nonce: Boolean(nonce) });

        // Awaited, and BEFORE the handoff fires. A linked agent can beat
        // within seconds, so a baseline read that resolved after the redirect
        // could capture the very beat it is supposed to be the "before" of —
        // and then wait for another one. Not fatal (the agent beats on every
        // drain pass) but it turns an instant confirmation into a slow one,
        // and slow here is what sent us hunting through LaunchServices.
        const { data: before } = await supabase
          .from("agent_status")
          .select("updated_at")
          .eq("dj_id", session.user.id)
          .maybeSingle<{ updated_at: string }>();
        if (cancelled) return;

        // Not awaited: a custom-scheme navigation does not unload this page,
        // so the queued event still sends, and the handoff should not wait on
        // analytics.
        window.location.href = `curfew-agent://link?${params.toString()}`;

        void confirmAgentContact(session.user.id, before?.updated_at ?? null);
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

  if (status === "confirmed") {
    return (
      <div>
        <p className="lp-body lp-auth-tag" role="status">
          Curfew Agent is linked. Play a set in Serato and it&rsquo;ll show up
          on your dashboard automatically.
        </p>
        <p className="lp-auth-switch">
          <Link href="/dashboard">Go to your dashboard</Link>.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* If the agent isn't installed or its curfew-agent:// scheme isn't
          registered, this redirect silently does nothing in most browsers —
          no reliable cross-browser "app not installed" callback exists for
          custom schemes. That much is still true and still unfixable.

          What WAS wrong here until 2026-08-20 is the conclusion drawn from
          it: that calm copy plus a manual fallback was "the whole mitigation"
          and there was "no way to engineer around it". The callback can't
          come back through the scheme, but it doesn't have to — the agent
          reports its own first contact via Story 3.9's heartbeat, which
          `confirmAgentContact` now watches. This copy is the pre-confirmation
          state, not the terminal one. The fallback points at /welcome — the
          setup screen with the actual download. */}
      <p className="lp-body lp-auth-tag">
        Opening Curfew Agent. If nothing happens, make sure it&rsquo;s installed and running.
      </p>
      <p className="lp-auth-switch">
        Don&rsquo;t have the agent yet? <Link href="/welcome">Get set up</Link>.
      </p>
    </div>
  );
}
