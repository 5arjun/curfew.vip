import { formatDayDate } from "@/lib/sets/format";

// A day label for an epoch-ms timestamp, rendered on the server in the DJ's own
// zone (Story 7.7).
//
// **This used to be a Client Component, and the reason it no longer is, is the
// same reason `ClockStrip` stopped being one.** Its own comment stated the
// premise: "`formatDayDate` is locale- and timezone-dependent … rendering it in
// a Server Component risks the wrong calendar day near a viewer's midnight
// boundary … so these dates render here instead, after hydration, in the
// viewer's own zone."
//
// Story 7.7 makes a real zone available — the set's captured `derived.timezone`,
// with `djs.timezone` behind it — so the choice is no longer "the server's zone
// or the viewer's", both of which were wrong. It is the DJ's, which is the one
// the date is actually about: a track first played at 11pm on the 20th was
// first played on the 20th, whichever airport the DJ opens the page in.
//
// The hydration gate went with it. There is nothing left for the server and the
// client to disagree about, so there is no mismatch to defer around, and the
// date no longer arrives as an em dash that swaps in after paint.
//
// The LOCALE half of that old comment is still true and still out of scope —
// `formatDayDate` resolves month names against the runtime's default locale.
// That defect is ledgered separately in `deferred-work.md`; this component adds
// no new instance of it.

/**
 * Renders a day label from an epoch-ms timestamp, in `zone`.
 *
 * `placeholder` is what renders when the timestamp is not a real instant — an
 * em dash, distinct from the `null`-timestamp case callers already render as
 * "—" themselves.
 */
export function ClientDayDate({
  ms,
  zone,
  placeholder = "–",
}: {
  ms: number;
  /** The IANA zone this date belongs to — the DJ's, never the viewer's. */
  zone: string;
  placeholder?: string;
}) {
  if (!Number.isFinite(ms)) return <>{placeholder}</>;
  const label = formatDayDate(new Date(ms).toISOString(), zone);
  return <>{label === "—" ? placeholder : label}</>;
}
