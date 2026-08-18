import { resolveFirstName } from "@/lib/account/greeting";
import { getAgentStatus, getDjTimezone, getRecentSets } from "@/lib/sets";
import { zoneForSet } from "@/lib/sets/civilTime";
import { splitSets } from "@/lib/sets/hero";
import { buildSetRows } from "@/lib/sets/listModel";
import { buildRightColumn } from "@/lib/sets/rightColumn";
import { createClient } from "@/lib/supabase/server";
import { AgentStatusBanner } from "@/app/components/dashboard/AgentStatusBanner";
import { ConfidenceTile } from "@/app/components/dashboard/ConfidenceTile";
import { DeletedNote } from "@/app/components/dashboard/DeletedNote";
import { GlassCalendar } from "@/app/components/dashboard/GlassCalendar";
import { Greeting } from "@/app/components/dashboard/Greeting";
import { HeroBand } from "@/app/components/dashboard/HeroBand";
import { MostPlayedCard } from "@/app/components/dashboard/MostPlayedCard";
import { OdometerCard } from "@/app/components/dashboard/OdometerCard";
import { RightColumn } from "@/app/components/dashboard/RightColumn";
import { SetListPanel } from "@/app/components/dashboard/SetListPanel";
import { SilkBackdrop } from "@/app/components/dashboard/SilkBackdrop";

// Dashboard home (Story 3.6 v2 redesign — PLAN.md D1–D14). A viewport-locked
// zone map (D7): greeting → full-width hero band → set list (left, the only
// scroll region on the page) + right column. Reads through the data-access
// seam (`getRecentSets`) — unchanged — so the fixture swaps for the Supabase
// read path with no change here.
async function getFirstName(): Promise<string | null> {
  // Resilient rather than gating: with no session (or no configured Supabase
  // env in a dev checkout) the greeting simply drops the name. A signed-out
  // visitor no longer reaches this page at all — the group layout redirects to
  // /login (launch checklist §1.4) — but the layout fails open on a thrown
  // read, so the nameless path stays reachable and stays handled.
  // Story 3.10 (AC-4/D-3): an explicit `djs.dj_name` wins over OAuth
  // metadata, so email-path DJs are no longer permanently nameless —
  // precedence lives in `resolveFirstName`, shared with Settings.
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return null;
    const { data: dj } = await supabase
      .from("djs")
      .select("dj_name")
      .maybeSingle<{ dj_name: string | null }>();
    return resolveFirstName(
      dj?.dj_name ?? null,
      data.user.user_metadata as Record<string, unknown> | undefined,
    );
  } catch {
    return null;
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  const [sets, firstName, agentStatus, { deleted }, djTimezone] = await Promise.all([
    getRecentSets(),
    getFirstName(),
    getAgentStatus(),
    searchParams,
    // Story 7.7: the DJ-level fallback zone, for sets whose own payload carried
    // none. Composed here with `Promise.all` rather than folded into
    // `getRecentSets`' return type — the same shape `getObservationStart` uses
    // on `/library-utilization`.
    getDjTimezone(),
  ]);
  // The hero is the most recent SUBSTANTIAL set (a one-track soundcheck never
  // takes the slot); the LIST still shows every set including the hero's —
  // D9: the archive is complete, the hero is a spotlight.
  const { hero } = splitSets(sets);
  const rows = buildSetRows(sets, djTimezone);
  const right = buildRightColumn(sets, djTimezone);

  return (
    <main className="dz">
      <SilkBackdrop />
      <Greeting name={firstName} />

      {/* Story 3.7 AC-34: the brief calm inline confirm after a delete — no
          celebration, no alarm; it simply states what happened. Scrubs its
          own query param on mount (see DeletedNote). */}
      {deleted != null && <DeletedNote />}

      {/* Story 3.9 AC-2: the agent's live sync state, in console voice. Renders
          nothing at all unless there is something true to report — which is the
          normal case. */}
      <AgentStatusBanner initial={agentStatus} />

      {hero ? (
        <HeroBand set={hero} zone={zoneForSet(hero, djTimezone).zone} />
      ) : (
        // Awaiting-first-set hero (D13): the real shell, calm copy — the
        // launch experience IS this state. History-as-asset voice; no fake
        // chart, no nagging, never "since you joined".
        <section className="dz-hero dz-shell dz-hero-cold" aria-label="Most recent set">
          <span className="dz-dots" aria-hidden="true" />
          <p className="dz-hero-cold-title">Your first set lands here.</p>
          <p className="dz-hero-cold-body">
            Play a night and Curfew traces it — the arc of the tempo, the dancefloor it finds, the
            numbers that made it.
          </p>
        </section>
      )}

      <div className="dz-columns">
        <SetListPanel rows={rows} />

        <RightColumn>
          <GlassCalendar marks={right.marks} />
          <MostPlayedCard recent={right.mostPlayed.recent} extended={right.mostPlayed.extended} />
          {/* Confidence + odometer as a half-width pair (Arjun's ruling at the
              functional checkpoint) so the whole column holds a 900px viewport
              without scrolling. */}
          <div className="dz-right-pair">
            <ConfidenceTile pct={right.confidencePct} />
            <OdometerCard
              sets={right.odometer.sets}
              hours={right.odometer.hours}
              tracks={right.odometer.tracks}
            />
          </div>
        </RightColumn>
      </div>
    </main>
  );
}
