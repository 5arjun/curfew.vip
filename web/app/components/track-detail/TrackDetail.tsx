import Link from "next/link";
import type { LibraryRosterEntry } from "@/lib/sets/libraryRoster";
import { parseCamelot } from "@/lib/sets/setDetail";
import {
  buildClockStrip,
  buildMixNeighbours,
  buildRideTime,
  buildTrackHistory,
  buildTrackIdentity,
  formatRideTime,
  hasMixNeighbours,
  hasPlayHistory,
  hasRideTime,
  mixNeighboursDisclosure,
  mixNeighboursSummary,
  partitionTrackPlaysByConfidence,
  rideTimeDisclosure,
  rideTimeSummary,
  trackHistorySummary,
  UNKNOWN,
  type MixNeighbourRow,
  type MixNeighboursModel,
  type TrackIdentity,
  type TrackPlayRecord,
} from "@/lib/sets/trackDetail";
import { SilkBackdrop } from "@/app/components/dashboard/SilkBackdrop";
import { InsufficientHistory } from "@/app/components/style-evolution/InsufficientHistory";
import { LibraryUtilizationReveal } from "@/app/components/library-utilization/LibraryUtilizationReveal";
import { ClockStrip } from "./ClockStrip";
import { ClientDayDate } from "./ClientDayDate";
import { FALLBACK_ZONE } from "@/lib/sets/civilTime";

// Track Detail's shell (Story 4.10, AC-5..AC-12).
//
// A SERVER component, unlike `SetDetail` — every stat here is a pure function
// of the two reads, with no scope toggle to recompute against. The only client
// code on the page is `ClockStrip` (D-32: hour labels must be produced in the
// viewer's own timezone) and `LibraryUtilizationReveal`'s one boolean.
//
// Whole-page scroll and the same `SilkBackdrop` ground as `/set/[id]`, so the
// two detail screens read as one pattern rather than two.

/**
 * AC-12 on this surface (D-34) — the same exclude-visibly contract the rest of
 * Epic 4 uses, through the same component and the same compound predicate.
 *
 * Both subtrees are built up front and the reveal swaps them; nothing
 * recomputes on click. Identity and tags sit OUTSIDE the swap deliberately:
 * what a record is tagged as does not change because one of the nights it
 * played was a soundcheck, and re-rendering the title under a reveal would
 * imply it might.
 */
export function TrackDetail({
  plays,
  roster,
  neighbourRows,
  djTimezone,
}: {
  plays: TrackPlayRecord[];
  roster: LibraryRosterEntry | null;
  neighbourRows: MixNeighbourRow[];
  /** The DJ's fallback zone (Story 7.7); a set's own captured zone wins. */
  djTimezone: string | null;
}) {
  // Identity from EVERY play, not the surviving ones: a track played only at a
  // soundcheck still has a title, a BPM and a key, and hiding them behind the
  // reveal would make the page look empty for a track Curfew knows plenty about.
  const identity = buildTrackIdentity(plays, roster);
  // Story 7.7. The page-level zone, for the facts that belong to the DJ's
  // whole library rather than to one gig — when a track was added, when it
  // was first and last played across every set. A per-set row uses its own
  // `row.zone` instead; see the history table below.
  const djZone = djTimezone ?? FALLBACK_ZONE;
  const { surviving, hiddenSetCount } = partitionTrackPlaysByConfidence(plays);

  return (
    <main className="td">
      <SilkBackdrop />

      <header className="td-header">
        {/* The DJ arrived here from a row that read exactly this, so the title
            is the page's `<h1>`. One `<h1>`, matching every other screen. */}
        <h1 className="td-title">{identity.title}</h1>
        <p className="td-artist">{identity.artist}</p>
        <TrackTags identity={identity} djZone={djZone} />
      </header>

      {plays.length === 0 ? (
        // D-38's cold start, designed rather than fallen into: a DJ with a
        // synced roster and zero sets gets a page that is true on day one,
        // rather than four modules each rendering its own empty state.
        <InsufficientHistory copy={NOT_PLAYED_YET_COPY} />
      ) : (
        <LibraryUtilizationReveal
          hiddenCount={hiddenSetCount}
          excluding={
            <TrackBody
              plays={surviving}
              allPlays={plays}
              neighbourRows={neighbourRows}
              djTimezone={djTimezone}
            />
          }
          including={
            hiddenSetCount > 0 ? (
              <TrackBody
                plays={plays}
                allPlays={plays}
                neighbourRows={neighbourRows}
                djTimezone={djTimezone}
              />
            ) : null
          }
        />
      )}

      {/* AC-4's counterpart on this page: the DJ got here by a link, so the id
          is known to work — but a track can be in the roster and never played,
          and saying so once at the foot is what keeps "no plays" from reading
          as a failure. Keyed on the roster rather than on the id string. */}
      {plays.length > 0 && !identity.inRoster && (
        <p className="td-disclosure">
          This track is not in your current library sync — you have played it, but Curfew does not
          see it in your library now.
        </p>
      )}

      <p className="td-footnote">
        <Link className="td-back" href="/library-utilization">
          Back to Library Utilization
        </Link>
      </p>
    </main>
  );
}

/**
 * D-38's copy for a track the DJ owns but has never played.
 *
 * **Module-specific, never borrowed** — the rule ruled twice, in Story 4.3 and
 * Story 4.5. The gate is `plays.length === 0` (no play of THIS track), and the
 * sentence describes that same quantity: it is about this record, not about the
 * DJ's history in general, and it does not tell them to go do anything.
 */
const NOT_PLAYED_YET_COPY =
  "In your library, not played yet. The first time this turns up in a set, its history starts here.";

/**
 * AC-5's tags, in FR-2's **Unknown** convention: an absent field is named, never
 * blank and never guessed (AD-11).
 *
 * Rendered as a definition list because that is what it is — a label and its
 * value, four times — and it gives a screen-reader user the pairing for free.
 * `genre → subgenre` stays two values in one row rather than a collapsed
 * string: `genre_raw`/`genre_normalized`/`taxonomy_version`/`subgenre` are four
 * columns written as one group and never collapsed (AD-12), and a track with a
 * genre but no subgenre must not read as though the subgenre were the genre.
 */
function TrackTags({ identity, djZone }: { identity: TrackIdentity; djZone: string }) {
  const keyCamelot = identity.camelotKey ? parseCamelot(identity.camelotKey) : null;
  return (
    <dl className="td-tags">
      <div className="td-tag">
        <dt>BPM</dt>
        <dd>{identity.bpm === null ? UNKNOWN : identity.bpm}</dd>
      </div>
      {/* AC-5 plus a colour (Arjun, 2026-08-12: "make the key be the actual
          colour that the key is in for the clock"). The hue is the track's own
          `--camelot-{n}{a|b}` token — the exact 1:1 mapping the Camelot wheel
          and the set-detail tracklist's key chips already use, so a key is the
          same colour everywhere in the app rather than a third convention.
          Built from the PARSED key, never the raw string: a malformed value has
          to fall back to neutral, and interpolating it would name a CSS custom
          property that does not exist — which is invalid-at-computed-value-time
          rather than a var() fallback, i.e. it would not fall back at all.
          (The identical trap is documented at `Tracklist.tsx`'s `sd-row-key`.) */}
      <div className="td-tag">
        <dt>Key</dt>
        <dd
          className="td-tag-key"
          style={
            keyCamelot
              ? ({
                  "--td-key-color": `var(--camelot-${keyCamelot.number}${keyCamelot.letter.toLowerCase()})`,
                } as React.CSSProperties)
              : undefined
          }
        >
          {identity.camelotKey ?? UNKNOWN}
        </dd>
      </div>
      <div className="td-tag">
        <dt>Genre</dt>
        <dd>
          {identity.genre === null
            ? UNKNOWN
            : identity.subgenre
              ? `${identity.genre} → ${identity.subgenre}`
              : identity.genre}
        </dd>
      </div>
      <div className="td-tag">
        {/* AC-6. "Unknown" and not a guess, and specifically never defaulted to
            the first play: when the DJ got a record and when they first played
            it are different questions. ~6% of real plays carry no
            `library_added_at`. */}
        <dt>Added</dt>
        <dd>
          {identity.libraryAddedAtMs === null ? (
            UNKNOWN
          ) : (
            // A library fact, not a gig's — the DJ's own zone (Story 7.7).
            <ClientDayDate ms={identity.libraryAddedAtMs} zone={djZone} />
          )}
        </dd>
      </div>
    </dl>
  );
}

/**
 * The four population-dependent modules (AC-7..AC-11).
 *
 * `allPlays` rides alongside `plays` so `buildMixNeighbours` can tell how many
 * sets the neighbour READ covered — that read was issued once, over every play,
 * because it has to serve both sides of the reveal.
 */
function TrackBody({
  plays,
  allPlays,
  neighbourRows,
  djTimezone,
}: {
  plays: TrackPlayRecord[];
  allPlays: TrackPlayRecord[];
  neighbourRows: MixNeighbourRow[];
  /** The DJ's fallback zone (Story 7.7); a set's own captured zone wins. */
  djTimezone: string | null;
}) {
  const djZone = djTimezone ?? FALLBACK_ZONE;
  const history = buildTrackHistory(plays, djTimezone);
  const clock = buildClockStrip(plays, djTimezone);
  const rideTime = buildRideTime(plays);
  const neighbours = buildMixNeighbours(plays, neighbourRows, allPlays);
  const rideNote = rideTimeDisclosure(rideTime);
  const neighbourNote = mixNeighboursDisclosure(neighbours);

  return (
    <div className="td-body">
      {/* ── Play history (AC-7) ─────────────────────────────────────────── */}
      <div className="td-module dz-shell" role="group" aria-label={trackHistorySummary(history)}>
        <span className="dz-dots" aria-hidden="true" />
        <h2 className="td-module-label">Play history</h2>
        {!hasPlayHistory(history) ? (
          <InsufficientHistory copy={NO_SURVIVING_PLAYS_COPY} />
        ) : (
          <>
            {/* aria-hidden: the group's `aria-label` already states both
                figures, and leaving these exposed announces the same numbers
                twice in two registers — the failure this epic has now paid for
                five times. */}
            <ul className="td-figures" aria-hidden="true">
              <li>
                <span className="td-figure">{history.timesPlayed}</span>
                <span className="td-figure-label">
                  {history.timesPlayed === 1 ? "play" : "plays"}
                </span>
              </li>
              <li>
                <span className="td-figure">{history.sets.length}</span>
                <span className="td-figure-label">
                  {history.sets.length === 1 ? "set" : "sets"}
                </span>
              </li>
            </ul>
            {/* AC-7's first and last. NOT inside the group's `aria-label`,
                which states the two counts only — a label may say less than the
                visible UI, never more (Non-negotiable 2). `null` renders as an
                em dash rather than a guessed date (D-8); it is reachable
                whenever every play carried an unparseable time, which is the
                same population the disclosure below counts. */}
            <p className="td-span">
              <span>
                First played{" "}
                {history.firstPlayedMs === null ? (
                  "—"
                ) : (
                  <ClientDayDate ms={history.firstPlayedMs} zone={djZone} />
                )}
              </span>
              <span>
                Last played{" "}
                {history.lastPlayedMs === null ? (
                  "—"
                ) : (
                  <ClientDayDate ms={history.lastPlayedMs} zone={djZone} />
                )}
              </span>
            </p>
            <ul className="td-set-list">
              {history.sets.map((row) => (
                // Keyed on `setId`, NEVER the label: two "Untitled set" rows
                // are reachable and would collide on a label key.
                <li className="td-set-row" key={row.setId}>
                  <Link className="td-set-link" href={`/set/${encodeURIComponent(row.setId)}`}>
                    {row.label}
                  </Link>
                  <span className="td-set-meta">
                    {row.startedAtMs === null ? (
                      // Never a guessed date (D-8). An em dash says "unknown"
                      // without inventing one — the same treatment
                      // `OneAndDone` gives an undated play.
                      "—"
                    ) : (
                      // This row IS one set, so it gets that set's own zone.
                      <ClientDayDate ms={row.startedAtMs} zone={row.zone} />
                    )}
                    {row.playCount > 1 && ` · ${row.playCount} plays`}
                  </span>
                </li>
              ))}
            </ul>
            {history.undatedPlayCount > 0 && (
              <p className="td-disclosure">
                {history.undatedPlayCount}{" "}
                {history.undatedPlayCount === 1 ? "play carries" : "plays carry"} no time, so{" "}
                {history.undatedPlayCount === 1 ? "it is" : "they are"} absent from the first and
                last dates and from the clock below.
              </p>
            )}
          </>
        )}
      </div>

      {/* ── Clock (AC-8) ────────────────────────────────────────────────── */}
      <ClockStrip model={clock} />

      {/* ── Ride time (AC-9/AC-11) ──────────────────────────────────────── */}
      <div className="td-module dz-shell" role="group" aria-label={rideTimeSummary(rideTime)}>
        <span className="dz-dots" aria-hidden="true" />
        <h2 className="td-module-label">Ride time</h2>
        {!hasRideTime(rideTime) ? (
          <InsufficientHistory copy={NO_RIDE_TIME_COPY} />
        ) : (
          <p className="td-readout" aria-hidden="true">
            <span className="td-figure">{formatRideTime(rideTime.medianMs as number)}</span>
            {/* AC-11's n=1 form: one observation is a fact about one night, not
                a distribution, so the word "typically" is absent rather than
                hedged — and the n is stated either way (D-33). */}
            <span className="td-figure-label">
              {rideTime.n === 1 ? "on its one play" : `typical, across ${rideTime.n} plays`}
            </span>
          </p>
        )}
        {rideNote && <p className="td-disclosure">{rideNote}</p>}
      </div>

      {/* ── Mix neighbours (AC-10) ──────────────────────────────────────── */}
      <div className="td-module dz-shell" role="group" aria-label={mixNeighboursSummary(neighbours)}>
        <span className="dz-dots" aria-hidden="true" />
        <h2 className="td-module-label">Mix neighbours</h2>
        {!hasMixNeighbours(neighbours) ? (
          <InsufficientHistory copy={NO_NEIGHBOURS_COPY} />
        ) : (
          <div className="td-neighbours">
            <NeighbourColumn heading="Played before it" entries={neighbours.before} />
            <NeighbourColumn heading="Played after it" entries={neighbours.after} />
          </div>
        )}
        {neighbourNote && <p className="td-disclosure">{neighbourNote}</p>}
      </div>
    </div>
  );
}

/**
 * Each module's OWN copy — never a neighbour's string (ruled in Story 4.3 and
 * again in 4.5), and in each case the gate and the sentence describe the same
 * quantity.
 */
const NO_SURVIVING_PLAYS_COPY =
  "Every play of this so far was in a short or low-confidence set. Reveal them above to see them.";
const NO_RIDE_TIME_COPY = "No play of this has carried a duration yet.";
const NO_NEIGHBOURS_COPY =
  "Nothing has landed either side of this yet — it has only opened or closed the sets it was in.";

/**
 * One side of AC-10's neighbours.
 *
 * **Ordered by recurrence, described in no ranking words at all** — no "top",
 * no "most", no row numbers, no badges (`DESIGN.md:199`). The count on each row
 * is the fact; the order is just how a list is read.
 *
 * Each entry links when it has an identity of its own and renders as plain text
 * when it does not, the same D-26 rule the lists on `/library-utilization`
 * follow.
 */
function NeighbourColumn({ heading, entries }: { heading: string; entries: MixNeighboursModel["before"] }) {
  return (
    <div className="td-neighbour-col">
      <h3 className="td-neighbour-head">{heading}</h3>
      {entries.length === 0 ? (
        <p className="td-neighbour-empty">Nothing yet.</p>
      ) : (
        <ul className="td-neighbour-list">
          {entries.map((entry) => (
            <li className="td-neighbour-row" key={JSON.stringify([entry.title, entry.artist])}>
              <span className="td-neighbour-track">
                {entry.trackId ? (
                  <Link
                    className="td-neighbour-title td-neighbour-link"
                    href={`/track/${encodeURIComponent(entry.trackId)}`}
                  >
                    {entry.title}
                  </Link>
                ) : (
                  <span className="td-neighbour-title">{entry.title}</span>
                )}
                <span className="td-neighbour-artist">{entry.artist}</span>
              </span>
              <span className="td-neighbour-count">
                {entry.count} {entry.count === 1 ? "time" : "times"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
