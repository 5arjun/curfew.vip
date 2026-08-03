import { getRecentSets } from "@/lib/sets";
import { splitSets } from "@/lib/sets/hero";
import { buildSetRows } from "@/lib/sets/listModel";
import { createClient } from "@/lib/supabase/server";
import { Greeting } from "@/app/components/dashboard/Greeting";
import { HeroBand } from "@/app/components/dashboard/HeroBand";
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

  return (
    <main className="dz">
      <SilkBackdrop />
      <Greeting name={firstName} />

      {hero ? (
        <HeroBand set={hero} />
      ) : (
        <section className="dz-hero dz-shell" aria-label="Most recent set">
          {/* Step 7: awaiting-first-set cold state (D13) */}
        </section>
      )}

      <div className="dz-columns">
        <SetListPanel rows={rows}>
          {/* Step 5: the gooey spotlight search (D6/D12) mounts here */}
        </SetListPanel>

        <aside className="dz-right" aria-label="Stats">
          {/* Step 6: calendar, most played, confidence, archive odometer (D5/D10) */}
        </aside>
      </div>
    </main>
  );
}
