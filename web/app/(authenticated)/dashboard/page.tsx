import { getRecentSets } from "@/lib/sets";
import { splitSets } from "@/lib/sets/hero";
import { buildSearchItems } from "@/lib/sets/search";
import { Archive } from "@/app/components/dashboard/Archive";
import { ColdState } from "@/app/components/dashboard/ColdState";
import { DashboardMasthead } from "@/app/components/dashboard/DashboardMasthead";
import { Hero } from "@/app/components/dashboard/Hero";

// Dashboard home (Story 3.6, cool-direction redesign). A fixed, viewport-locked
// app shell (AC-4): the page never scrolls, only the content region does. Reads
// through the data-access seam (`getRecentSets`) — unchanged — so the fixture
// swaps for the Supabase read path with no change here. Feature-first: the most
// recent substantial set is the hero (a one-track soundcheck never takes the
// slot); the rest fall to the lighter archive below. With no sets, the cold
// dashboard IS the screen (AC-2), not a fallback bolted onto a list.
export default async function DashboardPage() {
  const sets = await getRecentSets();
  const { hero, archive } = splitSets(sets);
  const searchItems = buildSearchItems(sets);

  return (
    <div className="dashboard-shell">
      <DashboardMasthead />

      <div className="dashboard-scroll">
        <div className="dashboard-inner">
          {hero ? (
            <>
              <Hero set={hero} />
              <Archive allSets={sets} sets={archive} searchItems={searchItems} />
            </>
          ) : (
            <ColdState />
          )}
        </div>
      </div>
    </div>
  );
}
