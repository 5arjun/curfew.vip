// Set-domain types for the dashboard + Set Detail, sourced from the frozen
// agent↔cloud contract (Story 1.10, AD-15). The dashboard renders a set's
// `plays` + `derived` render-cache; nothing here re-declares those shapes, it
// re-exports them from `@curfew/shared` so the fixture and the eventual Supabase
// read path are provably the same wire shape.
import type { SyncPayload, SyncPlay, SyncSetDerived } from "@curfew/shared";

/**
 * One set as the dashboard consumes it — exactly `SyncPayload["set"]`
 * (`external_id`, ISO `started_at`/`ended_at`, `plays`, `derived`). Named for the
 * data-access seam so a component never imports the wire envelope directly.
 */
export type SetRecord = SyncPayload["set"];

export type { SyncPlay, SyncSetDerived };
