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
import { AGENT_DOWNLOADS } from "@/lib/agent-downloads";

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

        {/* One CTA became two on 2026-08-18 (launch checklist §1.3). It was a
            single "Download Curfew Agent" pointing at the GitHub releases page,
            which handed a DJ who had just paid a list of eight build artifacts
            and asked them to pick. Now each platform is its own choice and the
            file arrives directly — lib/agent-downloads.ts explains how the two
            hrefs stay right across releases without anyone bumping them.

            Both are offered plainly and neither is emphasized: the two are
            equal choices, and the same reason forbids OS-detecting the pair
            down to one. Step 01 says "the laptop you play from", which is
            routinely not the device this page is being read on. */}
        <div className="lp-ob-dls">
          {AGENT_DOWNLOADS.map((download) => (
            <a
              key={download.platform}
              className="lp-ob-dl"
              href={download.href}
              // The visible label is one word, which is right in a two-up grid
              // and wrong read aloud on its own. The accessible name contains
              // it verbatim, so voice control still matches what's on screen.
              aria-label={`Download Curfew Agent for ${download.label}`}
            >
              <span className="lp-ob-dl-line">
                <strong>{download.label}</strong>
                <span className="lp-ob-dl-arrow" aria-hidden="true">
                  ↓
                </span>
              </span>
              <span className="lp-ob-dl-sub">{download.detail}</span>
            </a>
          ))}
        </div>

        {/* This line used to read "signed, updates itself". Half of that
            stopped being true on 2026-08-16, when Windows was ruled to ship
            UNSIGNED (no Authenticode cert — see the Windows row in
            pre-launch-services-checklist.md), so the word is gone. "Updates
            itself" is still true on both: the Tauri updater keypair is
            minisign, unrelated to Authenticode, so update payloads stay
            verified either way.

            An explanatory SmartScreen warning lived here briefly and was
            REMOVED at Arjun's direction (2026-08-17): a Windows DJ can work
            out "More info → Run anyway" unaided, and the note cost more room
            than it bought. Deliberate product call, not an oversight — the
            page now says nothing false, which was the actual defect. */}
        <p className="lp-ob-dl-fine">Both update themselves after the first install.</p>

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
