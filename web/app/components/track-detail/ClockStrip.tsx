import type { ClockStripModel } from "@/lib/sets/trackDetail";

// AC-8's clock-time strip — what time of night the DJ drops this track.
//
// **This was the app's clearest instance of the bug Story 7.7 exists to fix,
// and it is worth recording what changed, because the code was right about its
// own constraints and wrong about nothing except a premise.**
//
// It used to be a Client Component whose whole reason for existing was D-32:
// "`plays.started_at` is `timestamptz`: the capture-side offset is normalized to
// UTC and lost, and there is no venue timezone, no DJ timezone on `djs` and no
// set-level offset anywhere in the system (GAP-3)." Given that, a server-rendered
// hour would be the SERVER's hour, so the bucketing was deferred behind a
// `useSyncExternalStore` hydration gate and computed in the viewer's zone.
//
// Story 7.7 closes GAP-3: a set now carries the IANA zone it was captured in,
// with `djs.timezone` behind it. Once a real zone exists, the viewer's zone
// stops being the least-wrong option and becomes simply wrong — a DJ who played
// Berlin does not want those plays re-bucketed because they opened the page in
// Los Angeles, and a histogram whose shape depends on who is looking is not an
// answer to "what time of night do I drop this".
//
// So the aggregation moved to the server (`buildClockStrip`), each play counted
// in ITS OWN set's zone, and the hydration gate went with it — there is nothing
// left for the two environments to disagree about. **If a hydration warning ever
// reappears here, the warning is the symptom and a wrong bucket is the defect:
// do not reach back for `useSyncExternalStore` to silence it.**
//
// Deferring a *label* to the client would still be defensible. Deferring an
// aggregation is what this story exists to stop.

/** Hours in a night, laid out 6pm → 6pm so a set that crosses midnight reads as one arc. */
const NIGHT_START_HOUR = 18;

export function ClockStrip({ model }: { model: ClockStripModel }) {

  // Already bucketed, server-side, in each play's own set zone. Nothing to
  // compute here and nothing to wait for — the strip renders complete on the
  // first paint, in the DJ's own hours.
  const buckets = model.hourCounts;
  const summary = clockSummary(buckets, model.startedAtMs.length);

  return (
    <div className="td-module dz-shell" role="group" aria-label={summary}>
      <span className="dz-dots" aria-hidden="true" />
      <h2 className="td-module-label">Clock</h2>

      {model.startedAtMs.length === 0 ? (
        <p className="td-neighbour-empty">No play of this has carried a time yet.</p>
      ) : (
        <>
          {/* aria-hidden on the graphic; the group's `aria-label` above carries
              the SAME numbers in words (AC-12's text equivalent), generated
              from the SAME `buckets` array — so the picture and its description
              cannot drift, which is the failure a hand-written alt text always
              eventually becomes. */}
          <ul className="td-clock" aria-hidden="true">
            {Array.from({ length: 24 }, (_, i) => (NIGHT_START_HOUR + i) % 24).map((hour) => {
              const count = buckets[hour];
              const peak = Math.max(...buckets, 1);
              return (
                <li className="td-clock-slot" key={hour}>
                  <span
                    className={count > 0 ? "td-clock-bar td-clock-bar--on" : "td-clock-bar"}
                    // A ratio, rounded to whole percent. 4.7's hydration
                    // mismatch was a 17-significant-digit inline style; this
                    // one is an integer, and it is only ever set post-mount
                    // anyway.
                    style={{ height: `${Math.round((count / peak) * 100)}%` }}
                  />
                  {/* Hover readout (Arjun, 2026-08-12: "add a hover that says
                      how many plays at the time"). Until now the strip's shape
                      was the whole answer — a DJ could see that one hour was
                      taller than another and never learn what either number
                      was, and the only place the counts existed at all was the
                      group's `aria-label`, which names the busiest hour and
                      nothing else. The hover target is the whole SLOT, not the
                      bar: a one-play hour draws a 2px bar, and a tooltip you
                      have to hit a 2px target to read is a tooltip nobody
                      reads. Pure CSS on `:hover`/`:focus-within` — the strip is
                      already `aria-hidden` with the summary carrying the
                      accessible reading, so this is mouse enrichment on top of
                      a text equivalent that already exists, exactly the
                      precedent the chart hovers elsewhere in the app follow. */}
                  <span className="td-clock-tip" aria-hidden="true">
                    {formatHour(hour)} · {count} {count === 1 ? "play" : "plays"}
                  </span>
                  {hour % 6 === 0 && <span className="td-clock-tick">{formatHour(hour)}</span>}
                </li>
              );
            })}
          </ul>
          {model.undatedPlayCount > 0 && (
            <p className="td-disclosure">
              {model.undatedPlayCount}{" "}
              {model.undatedPlayCount === 1 ? "play carries" : "plays carry"} no time, so{" "}
              {model.undatedPlayCount === 1 ? "it is" : "they are"} not on this strip.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** "9pm", "12am", "3am" — the DJ's own clock at the gig, in the register the rest of the page uses. */
function formatHour(hour: number): string {
  const suffix = hour < 12 ? "am" : "pm";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${suffix}`;
}

/**
 * AC-12's text equivalent for the strip — built from the same `buckets` the
 * bars are, so the two cannot disagree.
 *
 * Names the busiest hour and how many plays landed there, as a share of the
 * total rather than a comparison against the other hours. "More than any
 * other" reads as a superlative claim — the exact ranking vocabulary
 * Non-negotiable 6 bans (`DESIGN.md:199`) — even though no individually banned
 * word appears in it, so it is worded as a count-of-total instead. Exported so
 * the bucket math and this string are unit-testable directly, rather than only
 * reachable through the component's pre-hydration branch.
 */
export function clockSummary(buckets: number[], total: number): string {
  let bestHour = 0;
  let best = 0;
  // Ties go to the earlier hour of the night — walked in NIGHT_START order so
  // "earlier" means earlier in the night rather than earlier by clock number,
  // which would make 1am beat 11pm.
  for (let i = 0; i < 24; i += 1) {
    const hour = (NIGHT_START_HOUR + i) % 24;
    if (buckets[hour] > best) {
      best = buckets[hour];
      bestHour = hour;
    }
  }
  if (best === 0) return "Clock";
  return `Of ${total} timed ${total === 1 ? "play" : "plays"}, ${best} landed in the ${formatHour(bestHour)} hour.`;
}
