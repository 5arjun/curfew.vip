import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The shared row list behind AC-5's workhorses and AC-6's one-and-done — the
 * two "which tracks" modules on this page, which are a pair and should read as
 * one pattern rather than two.
 *
 * **The list SCROLLS IN PLACE; it used to hide its tail behind a `<details>`
 * "Show the other N"** (Arjun, 2026-08-12: "let's also make them scrolling in
 * place so you don't have to click a button to show the rest of it").
 *
 * This is not the thing `EXPERIENCE.md:108` bans. That rule is about INFINITE
 * scroll — a list that keeps fetching and appending, where the DJ can never see
 * how much there is or reach the end. What renders here is the opposite: a
 * fixed, already-complete, already-capped set of rows inside a bounded box that
 * has a real bottom. The module also stops growing the page, which the
 * `<details>` did not: expanding one added ~40 rows of height and pushed its
 * paired sibling's module off screen.
 *
 * Same shape `AgingShelf` already uses on this page (`.lu-shelf-list`), down to
 * the `tabIndex={0}`: a scroll container whose rows may be non-interactive has
 * to be focusable itself, or a keyboard-only user with no trackpad cannot reach
 * anything past the first screenful. Still SERVER components either way — a
 * scroll region needs no client JavaScript, same as the `<details>` did not.
 *
 * **No ranking vocabulary anywhere** — no "top", no "best", no "#1", no medals,
 * no badges (`DESIGN.md:199`: *"There is a total absence of competitive social
 * cues — no 'best,' 'winner,' or ranking language, ever."*). The rows are
 * ordered, because an ordered list is how you find the thing you are looking
 * for; nothing around them scores the DJ against anyone. The row number is
 * deliberately absent for the same reason.
 *
 * **Story 4.10: the title links when — and only when — the track has an
 * identity (AC-3/AC-4; D-26).** `trackId` is `null` for the ~21% of real plays
 * that resolve no artist tag, and such a row renders as the same plain text it
 * always did rather than as a link that 404s. The count is disclosed once at
 * page level (`unlinkableTracksDisclosure`), never per row — a badge on every
 * unlinked row would be noise on a fifth of the list and would say the same
 * thing 212 times.
 *
 * Still a server component: `next/link` needs no client boundary, so both
 * modules and the search results keep rendering on the server.
 */
export function TrackRowList({
  rows,
  visibleRows,
}: {
  rows: {
    title: string;
    artist: string;
    value: ReactNode;
    key: string;
    /** `/track/[track_id]` identity, or `null` for an unlinkable row (D-26). */
    trackId?: string | null;
  }[];
  /**
   * How many rows fit before the box starts scrolling. Not a slice any more —
   * every row is in the DOM and reachable — just the height the container is
   * bounded to, so the two paired modules stay the same size as each other
   * regardless of how many rows each one happens to hold.
   */
  visibleRows: number;
}) {
  // A list shorter than the cap must not reserve the cap's height — an
  // three-row module with seven rows of empty box below it reads as a broken
  // list, not a short one.
  const boundedRows = Math.min(visibleRows, rows.length);

  return (
    <ul
      className="lu-row-list"
      // Only focusable when it can actually scroll: a `tabIndex={0}` on a box
      // with nothing hidden is a tab stop that does nothing.
      tabIndex={rows.length > visibleRows ? 0 : undefined}
      style={{ "--lu-rows-visible": boundedRows } as React.CSSProperties}
    >
      {rows.map((row) => (
        <TrackRow
          key={row.key}
          title={row.title}
          artist={row.artist}
          value={row.value}
          trackId={row.trackId}
        />
      ))}
    </ul>
  );
}

function TrackRow({
  title,
  artist,
  value,
  trackId,
}: {
  title: string;
  artist: string;
  value: ReactNode;
  trackId?: string | null;
}) {
  return (
    <li className="lu-row">
      <span className="lu-row-track">
        {trackId ? (
          // The accessible name is the title alone. The artist sits in its own
          // element beside it and the value is a separate cell, so pulling
          // either inside the link would make every row announce a sentence
          // where the DJ wanted a track name — and the artist is not part of
          // what the link goes to.
          <Link className="lu-row-title lu-row-link" href={`/track/${encodeURIComponent(trackId)}`}>
            {title}
          </Link>
        ) : (
          // D-26: readable, and NOT a dead link. `encodeURIComponent` above is
          // belt-and-braces — a `track_id` is 16 hex chars — but the id is
          // untrusted text from the wire, and building a route from unescaped
          // input is how a path separator becomes a different route.
          <span className="lu-row-title">{title}</span>
        )}
        {/* "Unknown" rather than an empty cell or a guess (AD-11's "never
            omitted, never guessed"; the same fallback `rightColumn.ts:116`
            already uses for the dashboard's most-played row). */}
        <span className="lu-row-artist">{artist}</span>
      </span>
      <span className="lu-row-value">{value}</span>
    </li>
  );
}
