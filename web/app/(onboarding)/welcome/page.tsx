import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { billingEnabled } from "@/lib/billing/checkout";
import {
  CHECKOUT_PENDING_COOKIE,
  mustSubscribeFirst,
  readSetupState,
  setupStepLabel,
} from "@/lib/onboarding/corridor";
import { createClient } from "@/lib/supabase/server";
import { AGENT_DOWNLOAD_URL } from "@/lib/agent-downloads";

// /welcome — UJ-3 step 3, built at last: "Curfew prompts Devon to download
// the local agent — the account alone can't do anything yet." Sits between
// /phone-required and the dashboard in the setup corridor. Content rule
// carried from FaqBeats.tsx: no mechanism spillage — "the agent reads
// Serato" is the whole public story, so the steps below never mention
// session files or folders.
//
// Server-guarded like its siblings: signed-out → /login; no phone yet →
// /phone-required (the corridor runs in order). A DJ whose agent has
// already reported in has nothing to set up — agent_status carries one row
// per linked agent (dj_id PK), so a row existing at all means this screen
// is behind them and they go straight to the dashboard. The read fails
// open to showing the page: worst case a set-up DJ sees setup steps and a
// working "go to the dashboard" link, never a block.
//
// Billing pass (2026-08-16): the corridor grew a step in front of this one, so
// the guard checks /subscribe before /phone-required — the corridor runs in
// order and this page is now last of three. Note what is NOT added here: the
// agent download stays reachable for a LAPSED subscriber, because AD-19 is
// explicit that a lapsed DJ's agent keeps working and they keep being able to
// link one. `mustSubscribeFirst` is false for them by construction; only a DJ
// who has never subscribed at all is sent back.
export default async function WelcomePage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect("/login");
  }

  const sellsSubscriptions = billingEnabled(process.env);
  const state = await readSetupState(supabase, data.user.id);
  const checkoutPending =
    (await cookies()).get(CHECKOUT_PENDING_COOKIE)?.value === data.user.id;

  if (mustSubscribeFirst({ sellsSubscriptions, checkoutPending, state })) {
    redirect("/subscribe");
  }

  if (state.phone === "missing") {
    redirect("/phone-required");
  }

  const { data: agentRow } = await supabase
    .from("agent_status")
    .select("dj_id")
    .eq("dj_id", data.user.id)
    .maybeSingle();

  if (agentRow) {
    redirect("/dashboard");
  }

  return (
    <main className="lp-main lp-auth lp-auth--solo lp-auth--ob">
      <div className="lp-auth-card lp-ob-card" data-shown="true">
        <p className="lp-feat-eyebrow">{setupStepLabel("agent", sellsSubscriptions)}</p>
        <h1 className="lp-auth-title">Now, the agent.</h1>
        <p className="lp-body lp-auth-tag">
          Your account is ready — and empty. The agent is the part that fills it: a small app on
          the laptop that runs Serato. Install it once and every set you play files itself.
        </p>

        <ol className="lp-ob-steps">
          <li>
            <span className="lp-ob-n" aria-hidden="true">
              01
            </span>
            Download the agent on the laptop you play from.
          </li>
          <li>
            <span className="lp-ob-n" aria-hidden="true">
              02
            </span>
            Run the installer. The agent lives in the menu bar on macOS, the system tray on
            Windows.
          </li>
          <li>
            <span className="lp-ob-n" aria-hidden="true">
              03
            </span>
            Choose &ldquo;Link Account&rdquo; from its menu — it opens this site and connects
            itself to your account.
          </li>
          <li>
            <span className="lp-ob-n" aria-hidden="true">
              04
            </span>
            Play. The set is on your dashboard the night you play it.
          </li>
        </ol>

        <a className="lp-ob-dl" href={AGENT_DOWNLOAD_URL}>
          <span className="lp-ob-dl-line">
            <strong>Download Curfew Agent</strong>
            <span className="lp-ob-dl-arrow" aria-hidden="true">
              ↓
            </span>
          </span>
          <span className="lp-ob-dl-sub">macOS · Windows — signed, updates itself</span>
        </a>

        {/* Skippable on purpose — the opposite of /phone-required. The
            dashboard's AgentStatusBanner keeps telling the story until an
            agent reports in, so leaving here loses nothing. */}
        <Link href="/dashboard" className="lp-ob-skip">
          Set it up later — go to the dashboard
        </Link>
      </div>
    </main>
  );
}
