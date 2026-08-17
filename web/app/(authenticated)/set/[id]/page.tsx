import { notFound } from "next/navigation";
import { getDjTimezone, getSetById } from "@/lib/sets";
import { zoneForSet } from "@/lib/sets/civilTime";
import { SetDetail } from "@/app/components/set-detail/SetDetail";

// Set Detail (Story 3.7) — the read-back shell: identity + scope, energy arc,
// right-column stats with drill-ins, and the full tracklist as the page spine.
// Replaces the 3.6 stub entirely (whole-page scroll — the deliberate break
// from the dashboard's fixed shell; no `dashboard-shell` wrappers, L-2).
//
// NOTE (Task 4.1): the replaced stub hosted the app's only in-product
// LiquidMetalButton demo (3.6 AC-14). No placement on this screen is natural —
// Set Detail's actions are the calm [⋯] overflow and stat drill-ins, not a
// hero CTA — so the component keeps zero in-product usages until its real
// hero placements (login/subscribe/marketing) land. Recorded in
// deferred-work.md rather than silently dropped.
//
// Server component: reads through the data-access seam (unknown ids 404) and
// hands the full wire-shaped record to the client shell — every stat is a
// scope-reactive client recompute from `plays[]` (D1/D5).
export default async function SetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [set, djTimezone] = await Promise.all([getSetById(id), getDjTimezone()]);
  if (!set) notFound();

  // Story 7.7: resolved once, here, and passed down as a plain string. Every
  // clock on this page is the clock the DJ read off the booth — not the
  // server's (UTC on Vercel, which rendered a 10:14 PM set as 5:14 AM) and not
  // the viewer's.
  const { zone } = zoneForSet(set, djTimezone);

  return <SetDetail set={set} zone={zone} />;
}
