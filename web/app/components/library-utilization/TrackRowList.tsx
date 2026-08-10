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
 */
export function TrackRowList({
  rows,
  visibleRows,
  moreLabel,
}: {
  rows: { title: string; artist: string; value: ReactNode; key: string }[];
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
          <TrackRow key={row.key} title={row.title} artist={row.artist} value={row.value} />
        ))}
      </ul>

      {hidden.length > 0 && (
        <details className="lu-row-more">
          <summary className="lu-row-more-toggle">{moreLabel(hidden.length)}</summary>
          <ul className="lu-row-list">
            {hidden.map((row) => (
              <TrackRow key={row.key} title={row.title} artist={row.artist} value={row.value} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function TrackRow({ title, artist, value }: { title: string; artist: string; value: ReactNode }) {
  return (
    <li className="lu-row">
      <span className="lu-row-track">
        <span className="lu-row-title">{title}</span>
        {/* "Unknown" rather than an empty cell or a guess (AD-11's "never
            omitted, never guessed"; the same fallback `rightColumn.ts:116`
            already uses for the dashboard's most-played row). */}
        <span className="lu-row-artist">{artist}</span>
      </span>
      <span className="lu-row-value">{value}</span>
    </li>
  );
}
