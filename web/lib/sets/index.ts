// Data-access seam for sets (Story 3.6 Task 4, AC-13 / SM-1).
//
// The dashboard and Set Detail import ONLY from here — never a fixture file, a
// Supabase client, or the wire envelope directly. Four of the five DJ-data
// functions below (`getRecentSets`, `getSetById`, `deleteSet`,
// `getLibraryAddEvents` — but not `getLibraryRoster`, see below)
// read/write Supabase directly (Story 4.6 — the cloud read path landed):
// `sets` + its `plays` and `sessions` embeds, and `library_track_events`, all
// owner-`SELECT`-only via RLS (AD-7) — no `dj_id` filter needed or wanted,
// `auth.uid()` is the filter, same precedent `getAgentStatus` (Story 3.9)
// already set.
//
// The three READS (`getRecentSets`, `getSetById`, `getLibraryAddEvents`) follow
// `getAgentStatus`'s shape exactly: lazy `@/lib/supabase/server` import,
// try/catch around the whole body, dev-only console logging on failure, and a
// calm empty/`null` fallback in production — never a thrown error reaching a
// page. `deleteSet` deliberately does NOT (Story 4.6 code review): it is a
// mutation, and a calm fallback there reports a delete that did not happen. It
// throws instead — see its own doc comment.
//
// Two things here exist because PostgREST fails silently rather than loudly,
// and neither is redundant defensiveness: every unbounded select is capped at
// `max_rows` (1000) with HTTP 200 and `error: null`, so `getRecentSets` orders
// and limits explicitly and `getLibraryAddEvents` pages; and `derived` is cast
// rather than validated, so `hasRenderableDerived` drops a blob too incomplete
// for callers that dereference it without guards.
//
// `recent-sets.fixture.json` / `library-add-events.fixture.json` are no
// longer read by this module — they were the day-one stand-in for this exact
// swap (Decision A) and are retired from the production path now that it has
// landed. They are kept only as realistic sample data for a handful of pure
// unit tests (`dancefloor.test.ts`, `setDetail.test.ts`) that import them
// directly and never touch this seam.
//
// `library-roster.fixture.json` is the ONE fixture this module still reads,
// and deliberately so: `getLibraryRoster` (Story 4.11) is at the same day-one
// stage those two just graduated from — the agent writes `library_roster` but
// nothing selects from it yet. It is the next Decision-A swap, not a leftover.
//
// All five are `async` — the signature already matched the eventual awaited
// Supabase reads even at the fixture stage, so no component changes here, and
// so the roster swap will need none either.
import rosterFixture from "./library-roster.fixture.json";
import type { AgentStatusRow, AgentStatusSnapshot } from "./agentStatus";
import type { LibraryAddEvent } from "./libraryConversion";
import type { LibraryRosterSnapshot } from "./libraryRoster";
import type { SetRecord, SyncPlay, SyncSetDerived } from "./types";

/** Row shape of a single `plays` select, as the `sets` nested-select below returns it. */
type PlayRow = {
  position: number;
  title: string | null;
  artist: string | null;
  started_at: string | null;
  bpm: number | null;
  genre_raw: string | null;
  genre_normalized: string | null;
  subgenre: string | null;
  taxonomy_version: number | null;
  camelot_key: string | null;
  in_library: boolean;
  played_ms: number | null;
  library_added_at: string | null;
  track_id: string | null;
};

/** Row shape of a single `sets` select, nested `plays` + parent `sessions` included. */
type SetRow = {
  id: string;
  started_at: string;
  ended_at: string;
  derived: SyncSetDerived;
  plays: PlayRow[];
  /** To-ONE embed (`sets.session_id → sessions.id`), so PostgREST returns an object, not an array. */
  sessions: { session_identity: string } | null;
};

// Every column `getRecentSets`/`getSetById` need to reconstruct a `SetRecord`
// (Story 4.6 Task 3) — `sets.id` IS the `set_id` (no separate column), and
// `derived` is a plain jsonb column, so both round-trip with no reassembly
// beyond the rename below.
//
// `sessions(session_identity)` is a to-one embed carried for DISPLAY ONLY
// (Story 4.6 code review): `sets.id` is a uuid, so the Set Detail header read
// `SET 872d5614-…` where the fixture stage read `SET 975`. `sync_set` has no
// `external_id` parameter at all, so the agent's Serato-facing id is never
// stored — `session_identity` (`serato4:975`) is the only place that number
// survives in the cloud. See `formatSessionLabel` for the parse.
const SET_WITH_PLAYS_SELECT =
  "id, started_at, ended_at, derived, sessions(session_identity), plays(position, title, artist, started_at, bpm, genre_raw, genre_normalized, subgenre, taxonomy_version, camelot_key, in_library, played_ms, library_added_at, track_id)";

/**
 * How many sets `getRecentSets` will fetch. Explicit because PostgREST silently
 * caps every unbounded response at `max_rows` (1000, `supabase/config.toml`) and
 * returns HTTP 200 with `error: null` — a truncation this seam's error handling
 * is structurally blind to. Kept comfortably under that cap so the limit that
 * applies is always this documented one, never the server's invisible one.
 */
const RECENT_SETS_LIMIT = 500;

/** PostgREST's own `max_rows`; the page size `getLibraryAddEvents` pages at. */
const MAX_ROWS_PER_PAGE = 1000;

/** Safety stop for the paging loop — 50k add-events is far past any real library. */
const MAX_PAGES = 50;

/**
 * Whether a row's `derived` blob is complete enough for the dashboard to render.
 *
 * `sets.derived` is `jsonb not null default '{}'` and is cast, not validated —
 * and consumers dereference it without guards (`listModel.ts` reads
 * `set.derived.confidence.value`). A `{}` row (default-inserted, or written by
 * an agent predating one of these fields) would therefore throw a `TypeError`
 * in the *caller*, after this module's try/catch has already returned, taking
 * down the whole dashboard rather than one set.
 *
 * Such a row is dropped rather than repaired: a set with no summary blob has
 * nothing meaningful to show, and fabricating zeroed stats would render a
 * confident-looking lie. Not reachable through `sync_set` today (it always
 * supplies the blob), which is why this is a guard and not a migration.
 */
function hasRenderableDerived(row: SetRow): boolean {
  const derived = row.derived as Partial<SyncSetDerived> | null;
  return (
    derived != null &&
    typeof derived === "object" &&
    derived.confidence != null &&
    derived.bpm_distribution != null &&
    derived.genre_breakdown != null
  );
}

/**
 * `genre_raw`/`genre_normalized`/`taxonomy_version`/`subgenre` are written
 * together as one group by `sync_set` (all null, or all populated) — mirrors
 * `SyncPlay.genre`'s own "raw + normalized + taxonomy version, never
 * collapsed" discipline (AD-12). `genre_raw == null` is the "no genre at all"
 * case; the `?? ""`/`?? 0` fallbacks below only matter for a row that
 * violates that write-time invariant, never on the normal path.
 */
function reconstructGenre(row: PlayRow): SyncPlay["genre"] {
  if (row.genre_raw == null) return null;
  return {
    raw: row.genre_raw,
    normalized: row.genre_normalized ?? "",
    taxonomy_version: row.taxonomy_version ?? 0,
    ...(row.subgenre != null ? { subgenre: row.subgenre } : {}),
  };
}

function toSyncPlay(row: PlayRow): SyncPlay {
  return {
    position: row.position,
    title: row.title,
    artist: row.artist,
    started_at: row.started_at,
    bpm: row.bpm,
    genre: reconstructGenre(row),
    camelot_key: row.camelot_key,
    in_library: row.in_library,
    played_ms: row.played_ms,
    library_added_at: row.library_added_at,
    track_id: row.track_id,
  };
}

/** Plays are sorted by their own `position` — the stable ordering key independent of `started_at` (see `SyncPlay.position`'s own doc comment). */
function toSetRecord(row: SetRow): SetRecord {
  return {
    external_id: row.id,
    started_at: row.started_at,
    ended_at: row.ended_at,
    plays: [...row.plays].sort((a, b) => a.position - b.position).map(toSyncPlay),
    derived: row.derived,
    session_label: row.sessions?.session_identity ?? null,
  };
}

/**
 * Newest-first, with `external_id` breaking ties.
 *
 * The sort is still applied here rather than trusted from the query — the same
 * rationale this function held at the fixture stage — but the query now also
 * orders and limits server-side, which is load-bearing rather than redundant:
 * PostgREST truncates at `max_rows` BEFORE the client sees anything, so an
 * unordered+unlimited query would hand this sort an arbitrary subset and the
 * "newest" sets could be the ones silently dropped. Sorting after the fetch is
 * only safe when the fetch is bounded and ordered.
 *
 * The `external_id` tie-break makes the order total: `started_at` collisions
 * are real (two captures from one session anchor) and a comparator returning 0
 * left hero selection and list order free to differ between two identical
 * requests.
 */
export async function getRecentSets(): Promise<SetRecord[]> {
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("sets")
      .select(SET_WITH_PLAYS_SELECT)
      .order("started_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(RECENT_SETS_LIMIT);

    if (error && process.env.NODE_ENV !== "production") {
      console.error("getRecentSets: Supabase read failed, rendering as empty", error);
    }

    const rows = error || !data ? [] : (data as unknown as SetRow[]);
    // Per-row so one malformed set drops itself instead of emptying the archive.
    const sets = rows.flatMap((row) => {
      try {
        if (!hasRenderableDerived(row)) {
          if (process.env.NODE_ENV !== "production") {
            console.error("getRecentSets: dropping set with unrenderable `derived`", row.id);
          }
          return [];
        }
        return [toSetRecord(row)];
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          console.error("getRecentSets: dropping malformed set row", row?.id, err);
        }
        return [];
      }
    });

    return sets.sort(
      (a, b) =>
        (b.started_at ?? "").localeCompare(a.started_at ?? "") ||
        (b.external_id ?? "").localeCompare(a.external_id ?? ""),
    );
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("getRecentSets: unexpected failure, rendering as empty", err);
    }
    return [];
  }
}

/**
 * Library add-events plus the moment they were read (Story 4.2, FR-10).
 *
 * Carries the clock for the same reason `AgentStatusSnapshot` does: whether a
 * month-added cohort has finished its 90-day window is a question about *now*,
 * and `buildLibraryConversion` is a pure function that must be handed the time
 * rather than read it (Story 4.1's review: a `Date.now()` inside a "pure"
 * function is what made that suite machine-dependent). Reading it here also
 * keeps it out of a component render, which `react-hooks/purity` rightly
 * rejects.
 */
export interface LibraryAddEventSnapshot {
  events: LibraryAddEvent[];
  readAtMs: number;
}

/**
 * Every library add-event synced for this DJ (Story 4.2, FR-10) — the
 * denominator Style Evolution's library-conversion trend is computed against.
 *
 * Reads `library_track_events` directly (Story 4.6) — RLS is owner-SELECT-only,
 * so no `dj_id` filter, `auth.uid()` is the filter.
 *
 * Returns an empty list rather than throwing when nothing has ever synced, or
 * when the read itself fails: on day one after this shipped, EVERY DJ is in
 * that state by construction (D-1's baseline emits zero events), and it
 * renders as the insufficient-history copy, not as a broken page.
 */
export async function getLibraryAddEvents(): Promise<LibraryAddEventSnapshot> {
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();

    // Paged, because this is a denominator and a partial one is worse than
    // none. A single unbounded select is silently capped at `max_rows` (1000)
    // with HTTP 200 and `error: null` — verified against a live stack during
    // Story 4.6's code review: 1202 rows in the table returned exactly 1000,
    // `Content-Range: 0-999/*`, no error. Every conversion rate on Style
    // Evolution and Library Utilization divides by this list, so a truncated
    // read renders a confident percentage that is simply wrong, and the
    // module's own honesty apparatus (`undatedDisclosure`) would disclose
    // nothing about it. A real Serato/Rekordbox library is thousands of
    // tracks; the committed fixture already held 523 from a partial export.
    //
    // Ordered by `track_id` — `unique (dj_id, track_id)` makes it a total
    // order, so pages cannot overlap or skip rows the way a nullable
    // `added_at` ordering could.
    const events: LibraryAddEvent[] = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const from = page * MAX_ROWS_PER_PAGE;
      const { data, error } = await supabase
        .from("library_track_events")
        .select("track_id, added_at")
        .order("track_id", { ascending: true })
        .range(from, from + MAX_ROWS_PER_PAGE - 1);

      if (error) {
        if (process.env.NODE_ENV !== "production") {
          console.error("getLibraryAddEvents: Supabase read failed, rendering as empty", error);
        }
        // Empty, not the pages already collected: a partial denominator is the
        // exact failure this pagination exists to prevent, so it must never be
        // the fallback.
        return { events: [], readAtMs: Date.now() };
      }

      const batch = (data ?? []) as LibraryAddEvent[];
      events.push(...batch);
      if (batch.length < MAX_ROWS_PER_PAGE) {
        return { events, readAtMs: Date.now() };
      }
    }

    // Ran out of pages with a full final batch — the library is larger than
    // MAX_PAGES * MAX_ROWS_PER_PAGE. Loud in dev rather than a silent cap,
    // which is the whole lesson of the bug above.
    if (process.env.NODE_ENV !== "production") {
      console.error(
        `getLibraryAddEvents: stopped at ${MAX_PAGES} pages (${events.length} events); denominator may be incomplete`,
      );
    }
    return { events, readAtMs: Date.now() };
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("getLibraryAddEvents: unexpected failure, rendering as empty", err);
    }
    return { events: [], readAtMs: Date.now() };
  }
}

/**
 * The current DJ's library roster (Story 4.11, AD-22) — Tier A only
 * (title/artist; BPM/key/genre are Tier B, parked). Same seam discipline as
 * `getLibraryAddEvents` above: fixture-backed today
 * (`build-library-roster-fixture.mjs`, derived from the DJ's own catalogue
 * export), swapped for a `library_roster` select when the cloud read path
 * lands. RLS is owner-SELECT-only, so that query will need no `dj_id`
 * filter either — `auth.uid()` is the filter.
 *
 * No page reads `entries` yet (Story 4.4/4.10 are still `backlog`) — this
 * exists so those stories inherit a working read seam rather than needing
 * their own agent/shared/cloud work. `excludedNoIdentityCount`/
 * `totalCatalogueRows` DO have a consumer today (Story 4.3's meter, via
 * `unidentifiableTracksDisclosure`).
 */
export async function getLibraryRoster(): Promise<LibraryRosterSnapshot> {
  return rosterFixture as LibraryRosterSnapshot;
}

/**
 * One set by its `external_id` (== `sets.id`, see `SET_WITH_PLAYS_SELECT`'s
 * doc comment), or `null` if it does not exist, was deleted, or is not this
 * DJ's — RLS makes "not found" and "not mine" indistinguishable by design,
 * same as the fixture stage's `?? null` behavior.
 */
export async function getSetById(externalId: string): Promise<SetRecord | null> {
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("sets")
      .select(SET_WITH_PLAYS_SELECT)
      .eq("id", externalId)
      .maybeSingle();

    if (error && process.env.NODE_ENV !== "production") {
      console.error("getSetById: Supabase read failed, rendering as not-found", error);
    }

    if (error || !data) return null;

    const row = data as unknown as SetRow;
    // Same guard as `getRecentSets`, same reason — but here the alternative to
    // dropping is a 500 on Set Detail, so `null` (a calm 404) is the fallback.
    if (!hasRenderableDerived(row)) {
      if (process.env.NODE_ENV !== "production") {
        console.error("getSetById: set has unrenderable `derived`, rendering as not-found", row.id);
      }
      return null;
    }

    return toSetRecord(row);
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("getSetById: unexpected failure, rendering as not-found", err);
    }
    return null;
  }
}

/**
 * Removes a set from Supabase (AC-5) — a real hard delete, not a visibility
 * flag. Scoped to `id = externalId`; RLS (the `sets_delete_own` policy added
 * alongside this story) makes cross-DJ deletion impossible without a
 * redundant application-level `dj_id` check. `plays` rows cascade via the
 * table's own `on delete cascade` foreign key — no separate cleanup needed,
 * and the `trg_sets_record_delete` trigger writes the permanent tombstone that
 * stops the agent re-syncing the set back into existence.
 *
 * **This one deliberately does NOT follow `getAgentStatus`'s calm-fallback
 * shape** (Story 4.6 code review). The other three functions here are reads,
 * where "render nothing" is a truthful degradation. A mutation has no truthful
 * silent fallback: swallowing the error let `actions.ts` go on to
 * `redirect("/dashboard?deleted=1")` and tell the DJ a set was deleted that was
 * still there, and made `DeleteModal`'s own "nothing was deleted" branch
 * unreachable dead code. So a failed delete throws, the server action
 * propagates it, and the modal reports it.
 *
 * KNOWN LIMIT: an RLS-filtered no-op is NOT an error. Deleting an id that does
 * not exist, or is not this DJ's, returns HTTP 204 with `error: null` —
 * verified against a live stack during the code review — so success and
 * "matched nothing" are indistinguishable here by construction. Distinguishing
 * them needs `{ count: "exact" }` plus a caller that reads it, which would
 * change this function's signature and `actions.ts` with it (AC-2 froze both).
 * Left as a documented limit rather than a silent one; it is benign today,
 * since the only id the UI can send is one the DJ was just reading.
 */
export async function deleteSet(externalId: string): Promise<void> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { error } = await supabase.from("sets").delete().eq("id", externalId);

  if (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("deleteSet: Supabase delete failed", error);
    }
    throw new Error(`deleteSet failed for ${externalId}: ${error.message}`);
  }
}

/**
 * The current DJ's agent-status heartbeat, stamped with the moment it was read
 * (Story 3.9, AC-1/AC-2 — AD-20).
 *
 * A `null` row covers every "we don't know" case, and the caller must treat
 * them all identically (render nothing): no session, no Supabase configured in
 * this checkout, no agent ever linked, or a read that failed. RLS
 * (owner-SELECT only) means the query can never return another DJ's row, so no
 * `dj_id` filter is needed or wanted here — `auth.uid()` is the filter.
 *
 * Deliberately resilient rather than gating, exactly like the dashboard's own
 * `getFirstName`: a status region that throws would take down a page whose
 * actual content (the DJ's sets) has nothing to do with the heartbeat.
 *
 * Staleness is NOT decided here — this returns the row as stored, plus the
 * clock. See `resolveAgentStatus` in `./agentStatus`, which owns that
 * definition.
 *
 * `@/lib/supabase/server` is imported lazily on purpose: it pulls in
 * `next/headers`, and a static import would bind that into every consumer of
 * this module.
 */
export async function getAgentStatus(): Promise<AgentStatusSnapshot> {
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("agent_status")
      .select("sync_state, updated_at, agent_version")
      .maybeSingle();

    // A real misconfiguration (missing env, broken RLS) renders identically
    // to "no agent has ever linked" by design (see doc comment above), which
    // would otherwise let a genuine regression sit invisible indefinitely —
    // so it's still surfaced loudly in dev (Story 3.9 code review).
    if (error && process.env.NODE_ENV !== "production") {
      console.error("getAgentStatus: Supabase read failed, rendering as no-agent", error);
    }

    return { row: error ? null : ((data as AgentStatusRow | null) ?? null), readAtMs: Date.now() };
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("getAgentStatus: unexpected failure, rendering as no-agent", err);
    }
    return { row: null, readAtMs: Date.now() };
  }
}

export type { SetRecord } from "./types";
export type { AgentStatusRow, AgentStatusSnapshot } from "./agentStatus";
export type { LibraryAddEvent } from "./libraryConversion";
export type { LibraryRosterEntry, LibraryRosterSnapshot } from "./libraryRoster";
