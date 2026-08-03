import { notFound } from "next/navigation";
import { getSetById } from "@/lib/sets";
import { formatSessionLabel, formatSetDate } from "@/lib/sets/format";
import { LiquidMetalButton } from "@/app/components/ui/liquid-metal-button";

// Set Detail route STUB (Story 3.6 Task 10). Its only job here is to exist so a
// card click resolves — the real screen (tracklist, annotated arc, dancefloor
// pointers, delete) is Story 3.7. Reads through the same data-access seam
// (`getSetById`), so an unknown id 404s rather than rendering an empty shell.
//
// It also hosts this story's single in-product LiquidMetalButton demo (AC-14).
// The real hero placements — login "Initialize Session", subscribe/paywall,
// marketing hero — belong to their own stories; landing it here keeps the calm
// dashboard uncluttered while proving the component in-product.
export default async function SetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const set = await getSetById(id);
  if (!set) notFound();

  return (
    <div className="dashboard-shell">
      <div className="dashboard-scroll">
        <div className="dashboard-inner">
          <section className="dashboard-cold" aria-label="Set detail">
            <p className="text-label-sm dashboard-cold-eyebrow">
              {formatSetDate(set.started_at)} · {formatSessionLabel(set.external_id)}
            </p>
            <h1 className="text-headline-md">The full read-back is on its way.</h1>
            <p className="text-body-md dashboard-cold-body">
              The tracklist, the annotated energy arc, the dancefloor you can nudge, and delete all
              live on this screen — landing in the next release. For now, the door opens.
            </p>
            <LiquidMetalButton href="/dashboard" aria-label="Back to the archive">
              Back to the archive
            </LiquidMetalButton>
          </section>
        </div>
      </div>
    </div>
  );
}
