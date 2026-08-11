// Set-domain types for the dashboard + Set Detail, sourced from the frozen
// agent↔cloud contract (Story 1.10, AD-15). The dashboard renders a set's
// `plays` + `derived` render-cache; nothing here re-declares those shapes, it
// re-exports them from `@curfew/shared` so the fixture and the eventual Supabase
// read path are provably the same wire shape.
import type { SyncPayload, SyncPlay, SyncSetDerived } from "@curfew/shared";
import type { DancefloorSegment } from "./dancefloor";

/**
 * One set as the dashboard consumes it — `SyncPayload["set"]`
 * (`external_id`, ISO `started_at`/`ended_at`, `plays`, `derived`), plus the
 * one display-only field below. Named for the data-access seam so a component
 * never imports the wire envelope directly.
 *
 * `session_label` is an **optional additive augmentation, not a wire field** —
 * `@curfew/shared`'s frozen contract is deliberately left alone. Story 4.6's
 * code review found that `external_id` is `sets.id` (a uuid) in the cloud read
 * path, because `sync_set` never accepts the agent's `external_id` at all, so
 * the header that used to read `SET 975` from the fixture rendered
 * `SET 872d5614-9894-5803-80f5-aa1dd4177944`. `external_id` stays the uuid —
 * it is the correct routing and delete key, and the contract calls it an
 * "idempotency key", never a display value — and the human label now comes
 * from `sessions.session_identity` through this field instead. Optional so the
 * fixture-shaped test inputs still satisfy the type.
 */
/**
 * One play as the dashboard consumes it — the frozen wire `SyncPlay`, plus the
 * cloud row's own uuid (Story 5.3).
 *
 * **Optional, and that is not defensiveness.** `id` exists on every play the
 * Supabase read path returns, but a play reconstructed from
 * `recent-sets.fixture.json` genuinely has none: those sets were never inserted
 * into a database, so there is no row to have an id. Modelling it as required
 * would force the fixture-backed tests to mint uuids that stand for nothing.
 * The third optional additive augmentation on this type, for the same reason as
 * the two below it — the frozen `@curfew/shared` contract stays untouched,
 * because this is a cloud row's identity, not a wire field.
 *
 * A caller that needs to WRITE a segment boundary must therefore check for it
 * (see `web/lib/sets/segmentWrites.ts`): absent means this play cannot be a
 * boundary, which for fixture data is the literal truth, not a degraded state.
 * See `PlayRow.id` in `./index` for why it must never be treated as stable
 * across re-syncs.
 */
export type SetPlay = SyncPlay & { id?: string };

export type SetRecord = Omit<SyncPayload["set"], "plays"> & {
  /** This set's plays, each carrying its cloud row id where one exists. See {@link SetPlay}. */
  plays: SetPlay[];
  /** Raw `sessions.session_identity` (e.g. `serato4:975`), for display only. `null`/absent when unknown — render from `external_id` then. See `formatSessionLabel`. */
  session_label?: string | null;
  /**
   * This set's dancefloor segments, read from the `segments` **rows** (Story
   * 5.2, D-19/D-24) and resolved to ISO bounds from their boundary plays. Zero,
   * one, or several (FR-28/D-15); absent on a test input that predates the
   * embed, which reads the same as "no segments" everywhere.
   *
   * A second optional additive augmentation, like `session_label` above — the
   * frozen `@curfew/shared` contract is deliberately left alone, because these
   * are cloud rows, not a wire field.
   *
   * **This is the sole read model.** `derived.suggested_segments` also carries
   * the agent's original suggestion, and the web must never read it: once Story
   * 5.3 lets a DJ confirm or drag a boundary, the rows diverge from that blob by
   * design and reading it would render a suggestion the DJ already overruled
   * (D-19's drift guard).
   */
  segments?: DancefloorSegment[];
};

export type { SyncPlay, SyncSetDerived };
