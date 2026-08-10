import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The shared row list behind AC-5's workhorses and AC-6's one-and-done — the
 * two "which tracks" modules on this page, which are a pair and should read as
 * one pattern rather than two.
 *
 * **"Load more" is a native `<details>`, and that is deliberate.**
 * `EXPERIENCE.md:108` bans infinite scroll on track lists and names
 * "paginate / 'load more'" as the required alternative. A `<details>` gives
 * exactly that with no client JavaScript, so both modules stay SERVER
 * components — the same cost `page.tsx`'s render block argues against paying
 * for `TimeToFirstPlay`. It is also keyboard-operable and correctly announced
 * for free, which a hand-rolled button+state would have to re-earn.
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
  moreLabel,
}: {
  rows: {
    title: string;
    artist: string;
    value: ReactNode;
    key: string;
    /** `/track/[track_id]` identity, or `null` for an unlinkable row (D-26). */
    trackId?: string | null;
  }[];
  /** How many rows show before the disclosure. */
  visibleRows: number;
  /** The `<summary>` copy, e.g. "Show the other 14". */
  moreLabel: (hiddenCount: number) => string;
}) {
  const visible = rows.slice(0, visibleRows);
  const hidden = rows.slice(visibleRows);

  return (
    <>
      <ul className="lu-row-list">
        {visible.map((row) => (
          <TrackRow
            key={row.key}
            title={row.title}
            artist={row.artist}
            value={row.value}
            trackId={row.trackId}
          />
        ))}
      </ul>

      {hidden.length > 0 && (
        <details className="lu-row-more">
          <summary className="lu-row-more-toggle">{moreLabel(hidden.length)}</summary>
          <ul className="lu-row-list">
            {hidden.map((row) => (
              <TrackRow
            key={row.key}
            title={row.title}
            artist={row.artist}
            value={row.value}
            trackId={row.trackId}
          />
            ))}
          </ul>
        </details>
      )}
    </>
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
