"use server";

import { redirect } from "next/navigation";
import { deleteSet } from "@/lib/sets";

// Story 3.7 AC-33/34: hard delete via the 3.6 seam, then back to the dashboard
// (set absent) with a brief calm inline confirm. The seam is the swap point:
// when the Supabase read/write path lands, only `deleteSet`'s body changes.
// The permanent tombstone/suppress-id requirement is recorded in
// deferred-work.md, owed by the sync/read-path story — in 3.7 (pre-cloud-read,
// fixture-backed) removing the row is the whole delete.
export async function deleteSetAction(externalId: string): Promise<void> {
  await deleteSet(externalId);
  redirect("/dashboard?deleted=1");
}
