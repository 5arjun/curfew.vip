"use client";

import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { formatDayDate } from "@/lib/sets/format";
import {
  filterTrackSearchRows,
  isOwned,
  trackSearchHaystacks,
  trackSearchNoMatchCopy,
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
 * `aria-hidden`.
 *
 * **The `.spot-goo` blob filter IS copied now (Arjun, 2026-08-12: "I wanted
 * the toggles on the song search to have the same animation, sort of thing as
 * the dashboard set search").** This comment used to say the opposite — "there
 * is nothing to merge here" — and that was true right up until this field grew
 * filter chips beside its pill. Now there is exactly the thing the filter
 * exists for, so the chips emerge from behind the pill as one liquid mass and
 * separate out, the same way the dashboard's sort chips do.
 *
 * **`framer-motion` and the HOVER-GATED mounting are now copied too** (Arjun,
 * same session, follow-up: "the same exact way ... filter icons popping out
 * and hover animations the same way"). This comment used to keep both out —
 * the chips used to animate in once on mount and then stay, on the reasoning
 * that hiding which filter is active until you hover it makes a control you
 * cannot read. That reasoning did not survive contact with the actual ask:
 * `aria-pressed` still carries the state for anyone who reaches the group (via
 * hover OR focus — focusing the input sets `hovered` exactly like
 * `SpotlightSearch`'s own `onFocus`, so Tab still reaches every chip in
 * order), and the springs firing on every hover is the whole point being
 * copied. `SpotlightSearch`'s literal spring values (0.8s, bounce 0.2, 64px ×
 * index, 0.05s stagger) are reused verbatim rather than re-derived.
 *
 * Two things are still NOT copied:
 *   - the placeholder-roll-on-hover trick. That exists to reveal an
 *     icon-only chip's meaning; these chips already show their label the
 *     whole time they're mounted, so there is no meaning left to reveal.
 *   - its chip pattern's ARIA. `deferred-work.md:135` logs that as an
 *     incomplete tablist (no roving tabindex, no `aria-controls`); these are
 *     plain toggle buttons in a labelled group, which owes none of that.
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

/**
 * The population filter beside the field (Arjun, 2026-08-12: "add a toggle(s)
 * to the right of the search bar similar to the dashboard, which has the filter
 * buttons").
 *
 * These chips REPLACE a sentence, they are not decoration on top of one. The
 * results used to carry "tracks you've played come first, by play count, then
 * the rest of your library" underneath them — a line explaining an ordering the
 * DJ could not act on. The same fact is now a control: the two halves of the
 * index the sentence described are the two things you can filter to.
 *
 * AC-2's requirement that a result says which population it came from is
 * untouched — that lives on the row (`stateLabel`), and still does with the
 * filter set to "all".
 */
type SearchFilter = "all" | "played" | "library";

const SEARCH_FILTERS: Array<{ id: SearchFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "played", label: "Played" },
  { id: "library", label: "Not played" },
];

function matchesFilter(row: TrackSearchRow, filter: SearchFilter): boolean {
  if (filter === "all") return true;
  // `isOwned` is "in the library, never played" — the exact split the retired
  // sentence was describing, so the filter and the row's own state label can
  // never disagree about which half a track is in.
  return filter === "library" ? isOwned(row) : !isOwned(row);
}

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
  const [filter, setFilter] = useState<SearchFilter>("all");
  // Gates the filter chips exactly like `SpotlightSearch`'s own `hovered` —
  // hover OR focus, cleared only when focus leaves the whole group (see the
  // `onBlur` below). Deliberately NOT also gated on `query` the way the
  // dashboard's sort chips are: those hide once you start typing because
  // there is nothing left in the field to make room for; these three FILTER
  // the results a query produces, so they matter most exactly when a query is
  // typed and must stay reachable then.
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Built ONCE per index, not once per keystroke — the property D-29 asks for,
  // preserved through D-39's change to the wire encoding. `index.rows` is a
  // stable server-provided array, so this runs once for the page's life.
  const haystacks = useMemo(() => trackSearchHaystacks(index.rows), [index.rows]);

  // Every whitespace-split token must hit the haystack, mirroring
  // `SetListPanel.tsx:76-90` exactly. Filtered before the population split so
  // the matching work happens once rather than twice.
  const matches = useMemo(() => {
    const hits = filterTrackSearchRows(index.rows, haystacks, query);
    return filter === "all" ? hits : hits.filter((row) => matchesFilter(row, filter));
  }, [index.rows, haystacks, query, filter]);

  const searchable = hasSearchableTracks(index);
  const typed = query.trim() !== "";

  return (
    <div className="lu-search">
      {/* The blob filter the goo row references. Duplicated from
          `SpotlightSearch` rather than hoisted to a shared component: it is
          nine lines of inert SVG, the two pages never render together, and a
          shared `<SVGFilter>` would be a new module whose only job is to own an
          id string. */}
      <svg width="0" height="0" aria-hidden="true" focusable="false">
        <filter id="lu-blob">
          <feGaussianBlur stdDeviation="10" in="SourceGraphic" />
          <feColorMatrix
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -9"
            result="blob"
          />
          <feBlend in="SourceGraphic" in2="blob" />
        </filter>
      </svg>

      <MotionConfig reducedMotion="user">
      <div
        className="lu-search-bar spot-goo"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={(e) => {
          // Mirrors `SpotlightSearch` exactly: only clear when focus leaves
          // the whole pill+chips group, not when it moves between the input
          // and a chip within it — otherwise the chips would unmount out from
          // under a keyboard user tabbing from the field into them.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHovered(false);
        }}
      >
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

        {/* Deliberately NOT `SpotlightSearch`'s chip pattern's ARIA, which
            `deferred-work.md:135` logs as an incomplete tablist (no roving
            tabindex, no `aria-controls`) — these are plain toggle buttons in a
            labelled group: three real tab stops, `aria-pressed` carrying the
            state, nothing to re-earn. The MOUNTING and SPRINGS, though, are
            now the dashboard's own: hidden until `hovered`, same 64px×index
            offset and 0.05s stagger, same 0.8s/bounce-0.2 spring in both
            directions (`SpotlightSearch.tsx`'s literal values). */}
        <div className="lu-search-filters" role="group" aria-label="Filter results">
          <AnimatePresence>
            {hovered &&
              SEARCH_FILTERS.map((option, i) => (
                <motion.button
                  key={option.id}
                  type="button"
                  className="lu-search-filter"
                  aria-pressed={filter === option.id}
                  onClick={() => setFilter(option.id)}
                  initial={{ scale: 0.7, x: -1 * (64 * (i + 1)) }}
                  animate={{ scale: 1, x: 0 }}
                  exit={{
                    scale: 0.7,
                    x: 1 * (16 * (SEARCH_FILTERS.length - i - 1) + 64 * (SEARCH_FILTERS.length - i - 1)),
                  }}
                  transition={{ duration: 0.8, type: "spring", bounce: 0.2, delay: i * 0.05 }}
                >
                  {option.label}
                </motion.button>
              ))}
          </AnimatePresence>
        </div>
      </div>
      </MotionConfig>

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
  const noMatchCopy = trackSearchNoMatchCopy(matches.length, rows.length);
  const shown = Math.min(rows.length, TRACK_SEARCH_MAX_ROWS);

  if (noMatchCopy) {
    // `role="status"` so the live filter announces the miss rather than leaving
    // a screen-reader user typing into silence. ONE register: the sentence is
    // visible and announced, never duplicated into an `aria-label` too.
    return (
      <p className="lu-search-status" role="status">
        {noMatchCopy}
      </p>
    );
  }

  return (
    // Results sit on their OWN surface (Arjun, 2026-08-12: "let's make it a
    // container or something so you don't see only the background of the actual
    // site"). They used to render straight onto the page ground, so a list that
    // appears on a keystroke had no edge and no depth — it read as text dropped
    // over the Silk backdrop rather than as a panel that opened. Same
    // `.dz-shell` glass every other module on this page already sits on, so the
    // results belong to the field above them rather than looking like a fourth
    // kind of surface.
    <div className="lu-search-results dz-shell">
      <span className="dz-dots" aria-hidden="true" />
      <p className="lu-search-status" role="status">
        {/* The cap is stated as a count rather than as the sentence that used
            to hang under the list ("Showing 25 of N matches — tracks you've
            played come first, by play count, then the rest of your library").
            Non-negotiable 5 is that a truncation is never SILENT, not that it
            costs a line of prose; the ordering half of that sentence is now the
            filter chips beside the field. */}
        {shown < rows.length
          ? `${shown} of ${rows.length} matches`
          : rows.length === 1
            ? "1 match"
            : `${rows.length} matches`}
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
      />
    </div>
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
