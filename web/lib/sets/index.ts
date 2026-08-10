// Data-access seam for sets (Story 3.6 Task 4, AC-13 / SM-1).
//
// The dashboard and Set Detail import ONLY from here — never a fixture file, a
// Supabase client, or the wire envelope directly. EVERY DJ-data function below
// reads/writes Supabase directly as of Story 4.4 (`getLibraryRoster` was the
// last hardcoded one; it now reads `library_roster`, and Story 4.4's
// `getObservationStart` reads `djs`): `sets` + its `plays` and `sessions`
// embeds, `library_track_events`, `library_roster`, `agent_status` and `djs` —
// all owner-`SELECT`-only via RLS (AD-7), so no `dj_id` filter is needed or
// wanted, `auth.uid()` is the filter, the same precedent `getAgentStatus`
// (Story 3.9) set.
//
// Every READ follows `getAgentStatus`'s shape exactly: lazy
// `@/lib/supabase/server` import, try/catch around the whole body, dev-only
// console logging on failure, and a calm empty/`null` fallback in production —
// never a thrown error reaching a page. `deleteSet` deliberately does NOT
// (Story 4.6 code review): it is a mutation, and a calm fallback there reports
// a delete that did not happen. It throws instead — see its own doc comment.
//
// `getObservationStart`'s `null` is the one fallback that is NOT merely
// "render nothing": it is a binding instruction to its caller to suppress a
// whole branch of the aging shelf's clock (Story 4.4 AC-11). Read its doc
// comment before treating it like the others.
//
// Two things here exist because PostgREST fails silently rather than loudly,
// and neither is redundant defensiveness: every unbounded select is capped at
// `max_rows` (1000) with HTTP 200 and `error: null`, so `getRecentSets` orders
// and limits explicitly while `getLibraryAddEvents` and `getLibraryRoster`
// page; and `derived` is cast rather than validated, so `hasRenderableDerived`
// drops a blob too incomplete for callers that dereference it without guards.
//
// `recent-sets.fixture.json` / `library-add-events.fixture.json` are no
// longer read by this module — they were the day-one stand-in for this exact
// swap (Decision A) and are retired from the production path now that it has
// landed. They are kept only as realistic sample data for a handful of pure
// unit tests (`dancefloor.test.ts`, `setDetail.test.ts`) that import them
// directly and never touch this seam.
//
// `library-roster.fixture.json` is likewise no longer read here. It WAS, until
// the post-merge integration review: Story 4.11 branched pre-4.6 and justified
// serving it as "pending Story 4.6's Supabase read-path swap", then merged one
// commit AFTER that swap landed, so the premise had expired. Because
// `excludedNoIdentityCount`/`totalCatalogueRows` have a live consumer (Story
// 4.3's meter, via `unidentifiableTracksDisclosure`), serving the fixture
// stated ONE developer's library counts — 252 of 910 — to every DJ as a
// first-person fact about their own library, including brand-new accounts with
// nothing synced. An omission had become an affirmative false statement. It is
// kept as sample data for `libraryRoster.test.ts`/future stories, same
// disposition as the two above.
//
// All of these are `async` — the signature already matched the eventual
// awaited Supabase reads even at the fixture stage, which is why Story 4.4's
// roster swap needed no component changes either.
import type { AgentStatusRow, AgentStatusSnapshot } from "./agentStatus";
import type { LibraryAddEvent } from "./libraryConversion";
import type { LibraryRosterEntry, LibraryRosterSnapshot } from "./libraryRoster";
// A VALUE import, deliberately: `MIX_NEIGHBOUR_SET_LIMIT` is declared beside
// `buildNeighbourAnchors` because both sides need the same number — the query
// below builds from it, and the model has to rebuild the same anchor set to
// know which returned rows are "before" and which are "after". Two copies would
// let the model look for pairs the query never asked for. `trackDetail` is a
// pure module with no server dependencies, so importing it here adds nothing.
import { MIX_NEIGHBOUR_SET_LIMIT } from "./trackDetail";
import type { MixNeighbourRow, TrackPlayRecord } from "./trackDetail";
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

/**
 * Row shape of one `TRACK_PLAYS_SELECT` row — a play, plus the set it sat in.
 *
 * `sets` is nullable in the TYPE only: `plays.set_id` is `not null` with a
 * foreign key, so a play with no parent set is unreachable. Modelled nullable
 * anyway because an embed that RLS filters out comes back as `null` rather than
 * as a missing row, and dereferencing it would throw inside the caller — after
 * this module's try/catch has already returned.
 */
type TrackPlayRow = PlayRow & {
  set_id: string;
  sets: {
    id: string;
    started_at: string;
    ended_at: string;
    derived: SyncSetDerived;
    sessions: { session_identity: string } | null;
  } | null;
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
 * Every column `/track/[track_id]` needs, in ONE indexed read (Story 4.10,
 * **D-30**).
 *
 * Selected FROM `plays` (not from `sets` with a nested filter), because
 * `plays_dj_id_track_id_idx on public.plays (dj_id, track_id)` already exists
 * (`20260807100000_create_library_track_events.sql:130`) and serves
 * `.eq("track_id", …)` directly. The alternative — filtering `getRecentSets`'
 * 500-set array in memory — would ship ~2,294 plays across the wire to render
 * one track, and would silently inherit that seam's 500-set horizon on a page
 * whose whole claim is "every time you've played this".
 *
 * `sets(...)` is a to-ONE embed (`plays.set_id → sets.id`), so PostgREST
 * returns an object per row rather than an array — the same shape
 * `SET_WITH_PLAYS_SELECT` relies on for `sessions`. One read therefore serves
 * AC-7's linked set rows, AC-8's clock strip and AC-12's confidence predicate.
 */
const TRACK_PLAYS_SELECT =
  "set_id, position, title, artist, started_at, bpm, genre_raw, genre_normalized, subgenre, taxonomy_version, camelot_key, in_library, played_ms, library_added_at, track_id, sets(id, started_at, ended_at, derived, sessions(session_identity))";

/**
 * How many plays of ONE track `getTrackPlays` will fetch.
 *
 * Explicit for the reason every bound in this file is explicit: PostgREST
 * truncates at `max_rows` (1000) with HTTP 200 and `error: null`, which this
 * seam's error handling is structurally blind to. Kept under that cap so the
 * limit that applies is always this documented one.
 *
 * 500 is far past any real value — the busiest track on the committed seed has
 * **10 plays across 10 sets** — and is deliberately not tuned tighter: a DJ who
 * loops one record all night is exactly the DJ this page is for.
 */
const TRACK_PLAYS_LIMIT = 500;

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
function hasRenderableDerived(blob: SyncSetDerived | null | undefined): boolean {
  const derived = blob as Partial<SyncSetDerived> | null | undefined;
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
        if (!hasRenderableDerived(row.derived)) {
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
 * (title/artist; BPM/key/genre are Tier B, parked and NOT in this select; see
 * Story 4.4 Context §5).
 *
 * **`entries` reads `library_roster` for real as of Story 4.4** (AC-10), the
 * first story with a consumer. `excludedNoIdentityCount`/`totalCatalogueRows`
 * deliberately still do not — the split below is not an oversight, and
 * conflating the two halves is what produced the bug this function's history
 * records:
 *   - `entries` CAN be read. `library_roster` exists with owner-SELECT RLS
 *     (AD-7 — no `dj_id` filter needed or wanted, `auth.uid()` is the filter)
 *     and a `(dj_id, absent_at)` index. Paged exactly like
 *     `getLibraryAddEvents`, for the same reason: PostgREST silently caps an
 *     unbounded select at `max_rows` with HTTP 200 and `error: null`, and a
 *     truncated roster renders a confidently short aging shelf.
 *   - `excludedNoIdentityCount`/`totalCatalogueRows` CANNOT. They are
 *     scan-level scalars with no cloud carrier at all: `library_roster` is
 *     per-track (wrong shape) and AD-20's heartbeat carries no derived Serato
 *     data. The agent computes them (`store::scan_identity_coverage`) and
 *     persists them locally, but nothing ships them — that function has no
 *     caller outside its own unit test. Needs a named decision (an extra
 *     AD-22 RPC argument, or two `agent_status` columns), not a default —
 *     tracked in `deferred-work.md`. They stay `0`, which is what makes
 *     `unidentifiableTracksDisclosure` return `null` and Story 4.11 AC-6's
 *     line not render rather than render a false one. **Do not "make them
 *     consistent" with `entries` by deriving them from the rows below** —
 *     the roster is post-exclusion by construction, so anything computed from
 *     it would be a different number wearing the same name.
 *
 * `absent_at is null` is filtered SERVER-side (Story 4.4 AC-8). Not a
 * post-filter: it is what makes the paging cap count tracks the DJ still owns
 * rather than burning pages on deleted ones, and it is the exact predicate
 * `library_roster_dj_id_absent_at_idx` exists for. `.is()`, not `.eq()` —
 * `eq` renders `absent_at=eq.null`, a literal string comparison matching
 * nothing.
 *
 * Returns the empty shape rather than throwing on failure or on a brand-new
 * account, the same contract the other reads honor (Story 4.6 AC-3).
 */
export async function getLibraryRoster(): Promise<LibraryRosterSnapshot> {
  // The two scalars ride along unchanged on every return path below — see the
  // doc comment: they have no carrier, and 0 is the honest answer, not a
  // placeholder.
  const empty: LibraryRosterSnapshot = {
    entries: [],
    excludedNoIdentityCount: 0,
    totalCatalogueRows: 0,
  };

  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();

    // Ordered by `track_id` — `unique (dj_id, track_id)` makes it a total
    // order, so pages cannot overlap or skip rows the way a nullable
    // `added_at` ordering could. Same discipline as `getLibraryAddEvents`.
    const entries: LibraryRosterEntry[] = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const from = page * MAX_ROWS_PER_PAGE;
      const { data, error } = await supabase
        .from("library_roster")
        .select("track_id, title, artist, added_at, is_baseline, absent_at")
        .is("absent_at", null)
        .order("track_id", { ascending: true })
        .range(from, from + MAX_ROWS_PER_PAGE - 1);

      if (error) {
        if (process.env.NODE_ENV !== "production") {
          console.error("getLibraryRoster: Supabase read failed, rendering as empty", error);
        }
        // Empty, not the pages already collected: a partial roster is the exact
        // failure this pagination exists to prevent, so it must never be the
        // fallback. The aging shelf would otherwise state a qualifying count
        // out loud (AC-9) that is simply short.
        return empty;
      }

      const batch = (data ?? []) as LibraryRosterEntry[];
      entries.push(...batch);
      if (batch.length < MAX_ROWS_PER_PAGE) return { ...empty, entries };
    }

    // Ran out of pages with a full final batch — the library is larger than
    // MAX_PAGES * MAX_ROWS_PER_PAGE. Loud in dev rather than a silent cap.
    if (process.env.NODE_ENV !== "production") {
      console.error(
        `getLibraryRoster: stopped at ${MAX_PAGES} pages (${entries.length} entries); roster may be incomplete`,
      );
    }
    return { ...empty, entries };
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("getLibraryRoster: unexpected failure, rendering as empty", err);
    }
    return empty;
  }
}

/**
 * When Curfew started being able to observe this DJ's plays at all, in epoch
 * ms — or `null` if that cannot be established (Story 4.4, Context §3).
 *
 * This is the lower bound on the aging shelf's "days unplayed" clock. Decision
 * A means Curfew only ever observes plays going forward, so a veteran's track
 * added in 2019 and played every weekend — but never yet in a Curfew-captured
 * set — would otherwise read as "2,400 days unplayed". A track's shelf age
 * must never be older than however long Curfew has actually been watching it.
 *
 * **`djs.created_at` is the anchor, and the alternatives are wrong, not merely
 * worse.** `library_roster.created_at` reads as "Curfew started watching last
 * Tuesday" for any DJ who installed before Story 4.11 shipped, clamping the
 * entire shelf to empty. The earliest `sessions.started_at` does not exist for
 * a DJ who has synced no sets — and that is exactly the DJ this metric is
 * about.
 *
 * KNOWN IMPRECISION, accepted: signup precedes agent install, so a DJ who
 * signs up and installs a week later gets up to a week of "unplayed" time
 * Curfew could not actually observe. It errs toward showing MORE age, not
 * less, and Epic 2's onboarding drives install straight off signup. Not worth
 * a second anchor.
 *
 * **FAIL-CLOSED, and this is binding (AC-11).** `null` means the caller must
 * SUPPRESS the no-play branch entirely — only tracks with a real observed last
 * play may age. It must NEVER be treated as "fall back to raw `added_at`":
 * that is precisely the pre-fix behaviour the clamp exists to remove, and
 * shipping it under a story claiming to have fixed it would be a silent
 * regression with a green gate. See `buildAgingShelf` in `./agingShelf`, which
 * owns the suppression.
 */
export async function getObservationStart(): Promise<number | null> {
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const { data, error } = await supabase.from("djs").select("created_at").maybeSingle();

    if (error && process.env.NODE_ENV !== "production") {
      console.error("getObservationStart: Supabase read failed, suppressing the add-date branch", error);
    }

    if (error || !data) return null;

    const createdAt = (data as { created_at: string | null }).created_at;
    // `not null default now()` in the schema, so a null here is unreachable —
    // but `new Date(null).getTime()` is 0, not NaN, and a 0 would clamp every
    // track to 1970 and quietly restore the raw-`added_at` behaviour this
    // function exists to prevent. Guarded rather than assumed.
    if (!createdAt) return null;
    const ms = new Date(createdAt).getTime();
    return Number.isNaN(ms) ? null : ms;
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("getObservationStart: unexpected failure, suppressing the add-date branch", err);
    }
    return null;
  }
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
    if (!hasRenderableDerived(row.derived)) {
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
 * Every play of ONE track, with the set each sat in (Story 4.10, AC-5..AC-12;
 * **D-30**).
 *
 * Served by `plays_dj_id_track_id_idx` — see {@link TRACK_PLAYS_SELECT} for why
 * this is a new read rather than a filter over `getRecentSets()`'s array.
 *
 * Follows `getSetById`'s shape exactly, and the calm-empty fallback is the
 * load-bearing part: an empty array means "no plays", which the detail page
 * renders as an honest state (a roster-only track, D-38), NOT as a 404. The
 * page decides not-found by asking whether the track exists in either
 * population — see `track/[track_id]/page.tsx`.
 *
 * No `dj_id` filter: RLS is owner-SELECT-only and `auth.uid()` is the filter
 * (AD-7), the same precedent every read in this file follows.
 */
export async function getTrackPlays(trackId: string): Promise<TrackPlayRecord[]> {
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("plays")
      .select(TRACK_PLAYS_SELECT)
      .eq("track_id", trackId)
      // Ordered server-side so the explicit `.limit()` keeps the OLDEST plays
      // when it bites, which is the end "first played" is read from. An
      // unordered limit would hand back an arbitrary 500 and both AC-7's first
      // play and AC-8's clock strip would quietly describe a subset.
      .order("started_at", { ascending: true })
      .order("position", { ascending: true })
      .limit(TRACK_PLAYS_LIMIT);

    if (error && process.env.NODE_ENV !== "production") {
      console.error("getTrackPlays: Supabase read failed, rendering as no plays", error);
    }

    const rows = error || !data ? [] : (data as unknown as TrackPlayRow[]);
    // Per-row, so one malformed set drops its own plays instead of emptying the
    // whole history — the same discipline `getRecentSets` applies, and the same
    // `derived` guard, because `isLowConfidenceSet` dereferences
    // `derived.confidence.value` without one.
    return rows.flatMap((row) => {
      try {
        if (row.sets == null || !hasRenderableDerived(row.sets.derived)) {
          if (process.env.NODE_ENV !== "production") {
            console.error("getTrackPlays: dropping play whose set is unrenderable", row.set_id);
          }
          return [];
        }
        return [
          {
            setId: row.sets.id,
            setLabel: row.sets.sessions?.session_identity ?? null,
            setStartedAt: row.sets.started_at,
            setDerived: row.sets.derived,
            play: toSyncPlay(row),
          },
        ];
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          console.error("getTrackPlays: dropping malformed play row", row?.set_id, err);
        }
        return [];
      }
    });
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("getTrackPlays: unexpected failure, rendering as no plays", err);
    }
    return [];
  }
}

/**
 * What was played immediately before and after this track, across its plays
 * (Story 4.10, AC-10; **D-31**).
 *
 * Adjacency is `position ± 1` **within the same set only**. `plays` carries
 * `unique (set_id, position)` and the column is 1-based, so a neighbour is a
 * lookup rather than a time comparison — and the last track of one night is
 * never the neighbour of the first track of the next.
 *
 * **Two steps, and the second over-fetches on purpose.** PostgREST cannot
 * express "these exact `(set_id, position)` pairs", so step 2 asks for the
 * cross product `.in("set_id", …).in("position", …)` and the exact pairs are
 * filtered client-side. The cross product is bounded by
 * {@link MIX_NEIGHBOUR_SET_LIMIT} — see that constant for the arithmetic, and
 * `buildMixNeighbours` for the disclosure when it bites.
 *
 * Returns `[]` for an empty anchor list without touching the network.
 */
export async function getMixNeighbours(
  anchors: { setId: string; position: number }[],
): Promise<MixNeighbourRow[]> {
  if (anchors.length === 0) return [];

  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();

    // The pairs we actually want, and the two `.in()` lists that will
    // over-fetch a superset of them.
    const wanted = new Set<string>();
    const setIds = new Set<string>();
    const positions = new Set<number>();
    for (const anchor of anchors) {
      if (setIds.size >= MIX_NEIGHBOUR_SET_LIMIT && !setIds.has(anchor.setId)) continue;
      setIds.add(anchor.setId);
      for (const position of [anchor.position - 1, anchor.position + 1]) {
        // `position` is 1-based, so 0 is not a row — asking for it would widen
        // the cross product by a value that can never match.
        if (position < 1) continue;
        positions.add(position);
        wanted.add(`${anchor.setId}${position}`);
      }
    }
    if (wanted.size === 0) return [];

    const { data, error } = await supabase
      .from("plays")
      .select("set_id, position, title, artist, track_id")
      .in("set_id", [...setIds])
      .in("position", [...positions])
      // Bounded explicitly even though the arithmetic above already keeps the
      // cross product under `max_rows` — a silent server-side truncation is
      // exactly what this file's other bounds exist to make impossible.
      .limit(MAX_ROWS_PER_PAGE);

    if (error && process.env.NODE_ENV !== "production") {
      console.error("getMixNeighbours: Supabase read failed, rendering as no neighbours", error);
    }

    const rows = error || !data ? [] : (data as unknown as MixNeighbourRow[]);
    return rows.filter((row) => wanted.has(`${row.set_id}${row.position}`));
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("getMixNeighbours: unexpected failure, rendering as no neighbours", err);
    }
    return [];
  }
}

/**
 * One roster entry by `track_id`, or `null` (Story 4.10, AC-6/AC-13; D-38).
 *
 * The other half of the detail page's identity: a track the DJ **owns** may
 * have no plays at all, and on a fresh account with a synced library that is
 * every track. `.is("absent_at", null)`, server-side and with `.is` rather than
 * `.eq` — `eq` renders `absent_at=eq.null`, a literal string comparison
 * matching nothing (the same trap `getLibraryRoster` documents).
 *
 * `null` covers "not in the roster", "removed from the library", "not this
 * DJ's" and "read failed" alike — RLS makes the last two indistinguishable by
 * design, and the caller treats them identically (AC-6's honest absent state).
 */
export async function getTrackRosterEntry(trackId: string): Promise<LibraryRosterEntry | null> {
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("library_roster")
      .select("track_id, title, artist, added_at, is_baseline, absent_at")
      .eq("track_id", trackId)
      .is("absent_at", null)
      .maybeSingle();

    if (error && process.env.NODE_ENV !== "production") {
      console.error("getTrackRosterEntry: Supabase read failed, rendering as not-in-roster", error);
    }

    if (error || !data) return null;
    return data as LibraryRosterEntry;
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("getTrackRosterEntry: unexpected failure, rendering as not-in-roster", err);
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
export type { MixNeighbourRow, TrackPlayRecord } from "./trackDetail";
