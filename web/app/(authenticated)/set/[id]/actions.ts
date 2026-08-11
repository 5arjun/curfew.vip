"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  adjustSegmentBoundary,
  confirmSegment,
  createManualSegment,
  deleteSegment,
  deleteSet,
  SegmentWriteError,
  type SegmentWriteReason,
} from "@/lib/sets";

// Story 3.7 AC-33/34: hard delete via the 3.6 seam, then back to the dashboard
// (set absent) with a brief calm inline confirm. The seam is the swap point:
// when the Supabase read/write path lands, only `deleteSet`'s body changes —
// revalidating here now means the dashboard is guaranteed fresh once that
// path adds real caching, not just today's uncached in-memory read.
// The permanent tombstone/suppress-id requirement is recorded in
// deferred-work.md, owed by the sync/read-path story — in 3.7 (pre-cloud-read,
// fixture-backed) removing the row is the whole delete.
export async function deleteSetAction(externalId: string): Promise<void> {
  await deleteSet(externalId);
  revalidatePath("/dashboard");
  redirect("/dashboard?deleted=1");
}

// ── Story 5.3: the segment editor's four writes ──────────────────────────────
//
// These RETURN a result rather than throwing, unlike `deleteSetAction` above,
// and the difference is not stylistic. A failed delete is terminal — there is
// nothing to go back to, so throwing and letting the modal report it is right.
// A rejected boundary is a conversation: the DJ tried to drag a floor into its
// neighbour, the segment is still perfectly fine, and the editor needs to say
// which rule it hit and leave them editing. An unhandled throw across the
// server-action boundary also loses `reason` — Next strips error details in
// production — which is exactly the information D-29 raised four distinct
// messages to preserve.
export type SegmentActionResult = { ok: true } | { ok: false; reason: SegmentWriteReason };

/** Every write below revalidates the set page it edited, and only that page. */
async function runSegmentWrite(
  setExternalId: string,
  write: () => Promise<void>,
): Promise<SegmentActionResult> {
  try {
    await write();
  } catch (err) {
    // A non-`SegmentWriteError` here is a bug rather than a rejected write, so
    // it reports as "unknown" instead of being dressed up as a rule violation.
    const reason = err instanceof SegmentWriteError ? err.reason : "unknown";
    return { ok: false, reason };
  }
  revalidatePath(`/set/${setExternalId}`);
  return { ok: true };
}

export async function confirmSegmentAction(
  setExternalId: string,
  segmentId: string,
): Promise<SegmentActionResult> {
  return runSegmentWrite(setExternalId, () => confirmSegment(segmentId));
}

export async function adjustSegmentBoundaryAction(
  setExternalId: string,
  segmentId: string,
  boundaries: { firstPlayId?: string; lastPlayId?: string },
): Promise<SegmentActionResult> {
  return runSegmentWrite(setExternalId, () => adjustSegmentBoundary(segmentId, boundaries));
}

export async function createManualSegmentAction(
  setExternalId: string,
  firstPlayId: string,
  lastPlayId: string,
): Promise<SegmentActionResult> {
  return runSegmentWrite(setExternalId, () =>
    createManualSegment(setExternalId, firstPlayId, lastPlayId),
  );
}

export async function deleteSegmentAction(
  setExternalId: string,
  segmentId: string,
): Promise<SegmentActionResult> {
  return runSegmentWrite(setExternalId, () => deleteSegment(segmentId));
}
