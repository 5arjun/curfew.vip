import { notFound } from "next/navigation";
import { getMixNeighbours, getTrackPlays, getTrackRosterEntry } from "@/lib/sets";
import { buildNeighbourAnchors } from "@/lib/sets/trackDetail";
import { TrackDetail } from "@/app/components/track-detail/TrackDetail";

// Track Detail (Story 4.10, AC-3) — one record's whole story: identity and
// tags, every time it has been played, what time of night it lands, how long
// it gets ridden, and what sits either side of it in the mix.
//
// **Inside the `(authenticated)` route group, not `web/app/track/`.** Getting
// that wrong yields a route with no nav, no layout and no phone gate that still
// renders perfectly — and `/track` is in `GATED_PREFIXES` (D-35), which only
// helps because the middleware matches paths rather than files.
//
// `notFound()` on `null`, exactly like `/set/[id]` (D-37). The seams return
// nothing for "doesn't exist", "not this DJ's", "deleted" and "read failed"
// alike; RLS makes them indistinguishable by design and that is the correct
// privacy posture, so there is deliberately no message telling the two apart.
// No `metadata` export, no `loading.tsx`/`error.tsx`, no `export const dynamic`
// — no page in this app has any of them, and this story does not introduce the
// first.
//
// THREE reads, where `/set/[id]` needs one, and each is load-bearing:
// `getTrackPlays` is the indexed history (D-30); `getTrackRosterEntry` is what
// makes an owned-but-never-played track a real page rather than a 404 (D-38);
// `getMixNeighbours` is AC-10's second bounded read, which cannot be issued
// until the first has said which `(set_id, position)` pairs to ask about
// (D-31). The first two are concurrent; the third genuinely depends on them.
export default async function TrackDetailPage({
  params,
}: {
  params: Promise<{ track_id: string }>;
}) {
  const { track_id } = await params;
  const [plays, roster] = await Promise.all([
    getTrackPlays(track_id),
    getTrackRosterEntry(track_id),
  ]);

  // Neither population knows this id. Note that "no plays" ALONE is not
  // not-found: that is D-38's cold-start page, the first surface in the product
  // that says something true on day one.
  if (plays.length === 0 && roster === null) notFound();

  const neighbours = await getMixNeighbours(buildNeighbourAnchors(plays));

  // `track_id` itself is deliberately not passed on: it is an opaque 16-char
  // hash, not something a DJ can look up or act on, and nothing on the page
  // renders it. `formatSessionLabel`'s own history — a raw uuid reaching the
  // Set Detail header — is the precedent for keeping machine ids off screen.
  return <TrackDetail plays={plays} roster={roster} neighbourRows={neighbours} />;
}
