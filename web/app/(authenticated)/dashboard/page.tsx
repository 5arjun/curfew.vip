import { getRecentSets } from "@/lib/sets";
import { splitSets } from "@/lib/sets/hero";
import { buildSetRows } from "@/lib/sets/listModel";
import { buildRightColumn } from "@/lib/sets/rightColumn";
import { createClient } from "@/lib/supabase/server";
import { ConfidenceTile } from "@/app/components/dashboard/ConfidenceTile";
import { GlassCalendar } from "@/app/components/dashboard/GlassCalendar";
import { Greeting } from "@/app/components/dashboard/Greeting";
import { HeroBand } from "@/app/components/dashboard/HeroBand";
import { MostPlayedCard } from "@/app/components/dashboard/MostPlayedCard";
import { OdometerCard } from "@/app/components/dashboard/OdometerCard";
import { SetListPanel } from "@/app/components/dashboard/SetListPanel";
import { SilkBackdrop } from "@/app/components/dashboard/SilkBackdrop";

// Dashboard home (Story 3.6 v2 redesign — PLAN.md D1–D14). A viewport-locked
// zone map (D7): greeting → full-width hero band → set list (left, the only
// scroll region on the page) + right column. Reads through the data-access
// seam (`getRecentSets`) — unchanged — so the fixture swaps for the Supabase
// read path with no change here.
async function getFirstName(): Promise<string | null> {
  // Resilient rather than gating: with no session (or no configured Supabase
  // env in a dev checkout) the greeting simply drops the name — auth-gating
  // this route group is a known separate gap, not this page's job.
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    const meta = data.user?.user_metadata as Record<string, unknown> | undefined;
    const raw =
      (typeof meta?.full_name === "string" && meta.full_name) ||
      (typeof meta?.name === "string" && meta.name) ||
      null;
    return raw ? raw.trim().split(/\s+/)[0] : null;
  } catch {
    return null;
  }
}

export default async function DashboardPage() {
  const [sets, firstName] = await Promise.all([getRecentSets(), getFirstName()]);
  // The hero is the most recent SUBSTANTIAL set (a one-track soundcheck never
  // takes the slot); the LIST still shows every set including the hero's —
  // D9: the archive is complete, the hero is a spotlight.
  const { hero } = splitSets(sets);
  const rows = buildSetRows(sets);
  const right = buildRightColumn(sets);

  return (
    <main className="dz">
      <SilkBackdrop />
      <Greeting name={firstName} />

      {hero ? (
        <HeroBand set={hero} />
      ) : (
        // Awaiting-first-set hero (D13): the real shell, calm copy — the
        // launch experience IS this state. History-as-asset voice; no fake
        // chart, no nagging, never "since you joined".
        <section className="dz-hero dz-shell dz-hero-cold" aria-label="Most recent set">
          <p className="dz-hero-cold-title">Your first set lands here.</p>
          <p className="dz-hero-cold-body">
            Play a night and Curfew traces it — the arc of the tempo, the dancefloor it finds, the
            numbers that made it.
          </p>
        </section>
      )}

      <div className="dz-columns">
        <SetListPanel rows={rows} />

        <aside className="dz-right" aria-label="Stats">
          <GlassCalendar marks={right.marks} />
          <MostPlayedCard week={right.mostPlayed.week} month={right.mostPlayed.month} />
          <ConfidenceTile pct={right.confidencePct} />
          <OdometerCard
            sets={right.odometer.sets}
            hours={right.odometer.hours}
            tracks={right.odometer.tracks}
          />
        </aside>
      </div>
    </main>
  );
}
