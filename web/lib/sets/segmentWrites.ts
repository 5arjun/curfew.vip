// The DJ's own writes to `segments` (Story 5.3, D-28).
//
// A separate file from `index.ts`, unlike `deleteSet`, because this is one
// cohesive concern with a failure taxonomy of its own rather than a fifth
// unrelated verb on the read seam. It is re-exported through `index.ts` so the
// seam's rule still holds exactly: components import from `@/lib/sets`, never
// from a Supabase client.
//
// ARCHITECTURE: these are DJ-DIRECT writes through Supabase under RLS — AD-8's
// generic "web-side mutations go through Supabase/RLS" clause, the same shape
// `deleteSet` uses. They are NOT a fifth entry in AD-8's agent-write amendment
// list (AD-20..AD-23): nothing here gives the agent any capability, and no new
// RPC exists. See AD-24.
//
// EVERY FUNCTION HERE THROWS on failure, and none of them has a calm empty
// fallback. That is the same deliberate split `deleteSet` documents at length:
// a read that fails can honestly render nothing, but a mutation that fails
// silently reports a change that did not happen — a DJ would watch a boundary
// snap back with no explanation, or worse, believe a confirm committed.

/**
 * Which rule a write broke — the four the `segments_validate` trigger
 * distinguishes (D-29, D-32), plus the two ways a write can fail before
 * reaching it.
 *
 * The trigger deliberately raises four DIFFERENT messages rather than a bare
 * constraint code precisely so this mapping can exist: "that would overlap your
 * other dancefloor" and "that boundary is from a different set" need different
 * things from the DJ, and collapsing them into one "couldn't save" is the
 * failure this taxonomy exists to prevent.
 */
export type SegmentWriteReason =
  | "boundaries-reversed"
  | "boundary-outside-set"
  | "overlaps-another-segment"
  | "type-not-supported"
  | "not-permitted"
  | "invalid-state"
  | "unknown";

/**
 * Maps the trigger's message text onto {@link SegmentWriteReason}.
 *
 * **This couples to the exact strings in
 * `20260811120000_add_segments_write_path.sql`**, which that migration's own
 * comments call out as a contract rather than prose. Postgres offers no better
 * seam here: `raise exception` without an explicit `errcode` surfaces as
 * P0001 for all four, so the message is the only thing telling them apart.
 * Matched on stable fragments, not whole strings, because two of the four
 * interpolate positions and a type name into the text.
 */
function reasonFromMessage(message: string): SegmentWriteReason {
  const text = message.toLowerCase();
  if (text.includes("boundaries reversed")) return "boundaries-reversed";
  if (text.includes("outside its own set")) return "boundary-outside-set";
  if (text.includes("overlaps an existing")) return "overlaps-another-segment";
  if (text.includes("only dancefloor segments")) return "type-not-supported";
  // 42501 covers both halves of D-28's split: a column absent from the UPDATE
  // grant, and a row the RLS policy rejects. Neither is reachable from the
  // editor's own UI, so they mean a bug here rather than DJ error.
  if (text.includes("permission denied") || text.includes("row-level security")) {
    return "not-permitted";
  }
  // `segments_manual_confirmed_check` (`20260810193000`): a manual segment is
  // confirmed by construction, so `('manual', false)` is impossible. Not
  // reachable from any write below today — `confirmed`/`type` are
  // grant-writable, though, so this stays a real failure mode rather than
  // dead code, and belongs in the same distinguishable taxonomy as the other
  // four (code review finding, 2026-08-11).
  if (text.includes("segments_manual_confirmed_check")) {
    return "invalid-state";
  }
  return "unknown";
}

/**
 * A rejected segment write, carrying WHICH rule was broken.
 *
 * The `message` is deliberately plain and developer-facing. Story 5.3 does not
 * word the DJ-facing copy — that is a writing-guidelines pass (D-35 flags the
 * confirm affordance's copy the same way) — and inventing it here would mean
 * shipping unreviewed voice into an error state, the place tone matters most.
 * What this story owes, and delivers, is that the four cases are DISTINGUISHABLE
 * at all: `reason` is the seam that pass writes against.
 */
export class SegmentWriteError extends Error {
  readonly reason: SegmentWriteReason;

  constructor(reason: SegmentWriteReason, message: string) {
    super(message);
    this.name = "SegmentWriteError";
    this.reason = reason;
  }
}

/** Shape of the `error` postgrest-js hands back; narrowed rather than cast. */
type PostgrestFailure = { message?: string | null } | null;

function throwWriteError(operation: string, error: PostgrestFailure): never {
  const message = error?.message ?? "";
  const reason = reasonFromMessage(message);
  if (process.env.NODE_ENV !== "production") {
    console.error(`${operation}: segment write rejected (${reason})`, error);
  }
  throw new SegmentWriteError(reason, `${operation} failed: ${message || "unknown error"}`);
}

/**
 * An UPDATE matching zero rows is not a Postgres error — RLS-filtered and
 * genuinely-nonexistent ids both come back as `error: null, data: []`. Without
 * this, `confirmSegment`/`adjustSegmentBoundary` would report success on a
 * stale or deleted id: the editor would retire its controls as if the write
 * landed when nothing was written. `deleteSegment` accepts this exact
 * limitation deliberately (its own doc comment explains why); these two
 * callers need the `.select()` + explicit check because unlike a delete, a
 * silently-no-op UPDATE leaves the DJ believing an edit was saved. Code review
 * finding, 2026-08-11.
 */
function assertRowMatched(operation: string, data: { id: string }[] | null): void {
  if (data != null && data.length > 0) return;
  if (process.env.NODE_ENV !== "production") {
    console.error(`${operation}: matched no row: id is stale, deleted, or not this DJ's`);
  }
  throw new SegmentWriteError(
    "not-permitted",
    `${operation} failed: no matching row (already removed, or not yours)`,
  );
}

/**
 * Confirms a suggested segment (AC-3) — the single most common write in this
 * story, and the whole point of D-18's two-column shape: `source` stays
 * `'suggested'` forever, so a future active-learning loop can still tell a
 * confirmed suggestion from a boundary the DJ drew themselves.
 *
 * `confirmed` is the ONLY column touched. `source` is not merely left alone
 * here, it is unreachable — absent from the column-scoped UPDATE grant.
 */
export async function confirmSegment(id: string): Promise<void> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("segments")
    .update({ confirmed: true })
    .eq("id", id)
    .select("id");
  if (error) throwWriteError("confirmSegment", error);
  assertRowMatched("confirmSegment", data);
}

/**
 * Moves one or both of a segment's boundaries (AC-1) — the tap, drag and
 * arrow-key write, all three of which resolve to this.
 *
 * UPDATE in place rather than delete-and-reinsert (D-28): the DJ experiences a
 * dragged boundary as the same segment, and minting a new `id` for it would
 * silently break 5.4's segment-scoped stats and D-17's active-learning signal,
 * both of which need one segment to stay one segment.
 *
 * Sending both boundaries in ONE statement when both moved is load-bearing, not
 * a tidiness choice: two sequential updates would leave the row transiently
 * reversed between them, and the D-29 trigger would reject the first of the two
 * writes rather than the intent.
 */
export async function adjustSegmentBoundary(
  id: string,
  boundaries: { firstPlayId?: string; lastPlayId?: string },
): Promise<void> {
  const patch: { first_play_id?: string; last_play_id?: string } = {};
  if (boundaries.firstPlayId != null) patch.first_play_id = boundaries.firstPlayId;
  if (boundaries.lastPlayId != null) patch.last_play_id = boundaries.lastPlayId;
  // Neither boundary moved. Returning early rather than issuing an empty
  // `update({})` — postgrest rejects that outright, so a no-op nudge (arrowing
  // at the first track, say) would surface as a write failure.
  if (Object.keys(patch).length === 0) return;

  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { data, error } = await supabase.from("segments").update(patch).eq("id", id).select("id");
  if (error) throwWriteError("adjustSegmentBoundary", error);
  assertRowMatched("adjustSegmentBoundary", data);
}

/**
 * The DJ's own boundary (AC-1's "+" path).
 *
 * `('manual', true)` by construction — D-18 rules out `('manual', false)` with a
 * CHECK, because a DJ drawing a boundary IS the confirmation. `type` is
 * hardcoded `'dancefloor'`: this story's MVP ships dancefloor only (D-33), and
 * the DB agrees via D-32's guard, so accepting a type parameter here would
 * offer a choice every write path below would reject.
 *
 * `dj_id` is read from the session rather than taken from the caller. RLS would
 * reject a forged one anyway, but deriving it means the failure is impossible
 * rather than merely caught — the same "derive, don't trust" discipline
 * `sync_set` applies to its own `set_id`/`dj_id`.
 */
export async function createManualSegment(
  setId: string,
  firstPlayId: string,
  lastPlayId: string,
): Promise<void> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const djId = userData?.user?.id;
  if (userError || !djId) {
    throw new SegmentWriteError("not-permitted", "createManualSegment failed: no authenticated DJ");
  }

  const { error } = await supabase.from("segments").insert({
    set_id: setId,
    dj_id: djId,
    type: "dancefloor",
    source: "manual",
    confirmed: true,
    first_play_id: firstPlayId,
    last_play_id: lastPlayId,
  });
  if (error) throwWriteError("createManualSegment", error);
}

/**
 * Removes a segment entirely (D-28).
 *
 * Shares `deleteSet`'s known limit, for the same structural reason: an
 * RLS-filtered no-op is not an error, so deleting an id that does not exist or
 * is not this DJ's returns success. Benign here for the same reason it is
 * there — the only id the editor can send is one the DJ was just looking at.
 */
export async function deleteSegment(id: string): Promise<void> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { error } = await supabase.from("segments").delete().eq("id", id);
  if (error) throwWriteError("deleteSegment", error);
}
