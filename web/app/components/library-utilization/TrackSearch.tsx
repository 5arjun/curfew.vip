"use client";

import { Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { formatDayDate } from "@/lib/sets/format";
import {
  filterTrackSearchRows,
  isOwned,
  trackSearchCapDisclosure,
  trackSearchHaystacks,
  visibleTrackSearchRows,
  hasSearchableTracks,
  TRACK_SEARCH_MAX_ROWS,
  TRACK_SEARCH_VISIBLE_ROWS,
  TS_ADDED_AT_MS,
  TS_ALL_PLAY_COUNT,
  TS_ALL_SET_COUNT,
  TS_ARTIST,
  TS_PLAY_COUNT,
  TS_SET_COUNT,
  TS_TITLE,
  TS_TRACK_ID,
  type TrackSearchIndex,
  type TrackSearchRow,
} from "@/lib/sets/trackSearch";
import { InsufficientHistory } from "@/app/components/style-evolution/InsufficientHistory";
import { TrackRowList } from "./TrackRowList";

/**
 * Track search (Story 4.10, AC-1/AC-2/AC-4/AC-12/AC-13).
 *
 * **The one client component this story adds to `/library-utilization`, and it
 * owns exactly the query string** (plus, through `LibraryUtilizationReveal`,
 * one boolean). Every row it renders comes from `TrackRowList`, which stays a
 * server-shaped pure component; the index arrives prebuilt from the server.
 *
 * **Why it is not a module inside `renderBody` (D-36).** `page.tsx` calls
 * `renderBody()` TWICE — once excluding the short/low-confidence sets, once
 * including them — so a search field placed inside it would be two independent
 * fields, and revealing would silently discard whatever the DJ had typed. It is
 * rendered instead from `LibraryUtilizationReveal`'s `search` slot, which is
 * what lets ONE boolean govern both this and the page body (AC-12) without
 * putting two identical reveal controls on screen. It adds no `<h2>` and no
 * landmark, so the page's outline and landmark count are exactly what Story
 * 4.9 left them.
 *
 * **Visual language from `SpotlightSearch`, mechanics deliberately not.** The
 * `.spot-*` chrome is reused verbatim (already global, `dashboard.css:1208`),
 * and so is its accessibility shape: a real `<input>` with an explicit
 * `aria-label`, a decorative placeholder marked `aria-hidden`, icons
 * `aria-hidden`. Three things are NOT copied:
 *   - the sort chips, and with them the `.spot-goo` blob filter that exists to
 *     merge the pill with them. There is nothing to merge here, and an SVG
 *     filter over a live-filtering field is cost with no reader.
 *   - `framer-motion`. `SpotlightSearch` wraps itself in `<MotionConfig
 *     reducedMotion="user">` because it animates; nothing here does, and a
 *     no-op `MotionConfig` would pull the whole library toward this page's
 *     bundle to configure animations that do not exist. The results' entrance
 *     is CSS, inside a `prefers-reduced-motion` guard — same contract, no
 *     dependency.
 *   - its chip pattern generally. `deferred-work.md:135` has that logged as an
 *     incomplete tablist (no roving tabindex, no `aria-controls`); this story
 *     must not add a fourth instance.
 */

/**
 * AC-13's insufficient state — **and its copy describes the same quantity its
 * gate tests**, which is the rule Story 4.5's review produced after a gate
 * counting *adds* shipped beside copy telling the DJ to go *play*.
 *
 * The gate is `hasSearchableTracks` — "Curfew knows of no track at all, in
 * either population" — so the sentence names both ways a track becomes
 * knowable, and promises the search rather than apologising for it. A DJ with a
 * synced roster and zero sets never sees this: they have owned tracks to find,
 * which is the whole point of D-38.
 */
const TRACK_SEARCH_INSUFFICIENT_COPY =
  "Once a set is captured or your library syncs, every track Curfew knows about is searchable here.";

/** AC-2's no-match state — plain, unapologetic, and not a claim about the library's completeness. */
const NO_MATCH_COPY = "No track here matches that — Curfew has no play and no library entry under that name.";

export function TrackSearch({
  index,
  revealed,
}: {
  index: TrackSearchIndex;
  /**
   * Whether the page's ONE reveal is open (AC-12) — owned by
   * `LibraryUtilizationReveal`, never by this component. Results follow the
   * same population as every other figure on the page, so the two can never
   * describe different set populations at the same moment.
   */
  revealed: boolean;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Built ONCE per index, not once per keystroke — the property D-29 asks for,
  // preserved through D-39's change to the wire encoding. `index.rows` is a
  // stable server-provided array, so this runs once for the page's life.
  const haystacks = useMemo(() => trackSearchHaystacks(index.rows), [index.rows]);

  // Every whitespace-split token must hit the haystack, mirroring
  // `SetListPanel.tsx:76-90` exactly. Filtered before the population split so
  // the matching work happens once rather than twice.
  const matches = useMemo(
    () => filterTrackSearchRows(index.rows, haystacks, query),
    [index.rows, haystacks, query],
  );

  const searchable = hasSearchableTracks(index);
  const typed = query.trim() !== "";

  return (
    <div className="lu-search">
      <div className="spot">
        <div className="spot-pill" onClick={() => inputRef.current?.focus()}>
          <span className="spot-search-icon">
            <Search aria-hidden="true" />
          </span>
          <div className="spot-field">
            {/* Decorative: the input carries the real name below, and leaving
                this exposed announces the same sentence twice. */}
            {query === "" && (
              <div className="spot-placeholder" aria-hidden="true">
                <p>Search your plays and your library</p>
              </div>
            )}
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              // AC-1: the label names BOTH populations. "Your library" alone
              // would over-promise on the ~28% of catalogue rows with no
              // resolvable identity; "tracks you've played" alone is now simply
              // false, since Story 4.11's roster landed and its AC-9 assigns
              // this widening here (D-25).
              aria-label="Search the tracks you've played and the tracks in your synced library"
            />
          </div>
        </div>
      </div>

      {!searchable ? (
        <InsufficientHistory copy={TRACK_SEARCH_INSUFFICIENT_COPY} />
      ) : (
        // Nothing renders until the DJ types: the results list is a response to
        // a question, and rendering the whole library under an empty field
        // answers one nobody asked.
        typed && <SearchResults matches={matches} revealed={revealed} />
      )}
    </div>
  );
}

/**
 * One population's results.
 *
 * Rendered twice by the reveal above — once excluding the short/low-confidence
 * sets, once including them — so this is a pure function of `(matches,
 * revealed)` and holds no state of its own. Both subtrees come from the ONE
 * index the server built; nothing recomputes on reveal beyond re-reading two
 * fields of the same tuples (D-13).
 */
function SearchResults({ matches, revealed }: { matches: TrackSearchRow[]; revealed: boolean }) {
  const rows = visibleTrackSearchRows(matches, revealed);
  const capNote = trackSearchCapDisclosure(rows.length);

  if (rows.length === 0) {
    // `role="status"` so the live filter announces the miss rather than leaving
    // a screen-reader user typing into silence. ONE register: the sentence is
    // visible and announced, never duplicated into an `aria-label` too.
    return (
      <p className="lu-search-status" role="status">
        {NO_MATCH_COPY}
      </p>
    );
  }

  return (
    <>
      <p className="lu-search-status" role="status">
        {rows.length === 1 ? "1 match" : `${rows.length} matches`}
      </p>
      <TrackRowList
        rows={rows.slice(0, TRACK_SEARCH_MAX_ROWS).map((row) => ({
          // `trackId` is unique where it exists; the title/artist pair is the
          // fallback identity for the ~21% that have none. `JSON.stringify`
          // rather than a joined string, because a plain join collides across a
          // title/artist boundary shift and yields duplicate React keys.
          key: row[TS_TRACK_ID] ?? JSON.stringify([row[TS_TITLE], row[TS_ARTIST]]),
          title: row[TS_TITLE],
          artist: row[TS_ARTIST],
          // D-26: `null` renders plain text, never a dead link.
          trackId: row[TS_TRACK_ID],
          value: stateLabel(row, revealed),
        }))}
        visibleRows={TRACK_SEARCH_VISIBLE_ROWS}
        moreLabel={(n) => `Show the other ${n}`}
      />
      {capNote && <p className="lu-disclosure">{capNote}</p>}
    </>
  );
}

/**
 * AC-2 — which population a result came from, on the row itself.
 *
 * A track with no plays has two completely different causes, and the DJ must
 * never have to guess which one they are looking at: *owned but not reached
 * yet* is a prompt, while *played, but the tags could not identify it* is a
 * data gap. Naming the population is what separates them.
 *
 * The date is formatted HERE, in the browser, and that is safe for the reason
 * D-32 makes it necessary elsewhere: `formatDayDate` is locale- and
 * timezone-dependent, but result rows only ever render after a keystroke — the
 * query starts empty and renders no rows at all — so this code never runs
 * during SSR and cannot produce a hydration mismatch. This epic already carries
 * one unfixed locale-dependent mismatch (`deferred-work.md:491`); it must not
 * add a second.
 */
function stateLabel(row: TrackSearchRow, revealed: boolean): string {
  if (isOwned(row)) {
    const addedAtMs = row[TS_ADDED_AT_MS];
    // AC-6's rule, applied to the row: absent is a distinct honest state, never
    // guessed and never defaulted to something else Curfew happens to know.
    const added =
      addedAtMs === null ? "add date unknown" : `added ${formatDayDate(new Date(addedAtMs).toISOString())}`;
    return `Not played yet · ${added}`;
  }
  const plays = revealed ? row[TS_ALL_PLAY_COUNT] : row[TS_PLAY_COUNT];
  const sets = revealed ? row[TS_ALL_SET_COUNT] : row[TS_SET_COUNT];
  return `${plays} ${plays === 1 ? "play" : "plays"} · ${sets} ${sets === 1 ? "set" : "sets"}`;
}
