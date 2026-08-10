"use client";

import { useMemo, useSyncExternalStore } from "react";
import { formatDayDate } from "@/lib/sets/format";

// `formatDayDate` is locale- and timezone-dependent (D-32's reasoning, applied
// here to a day rather than an hour). Rendering it in a Server Component risks
// the wrong calendar day near a viewer's midnight boundary — this diff's own
// `TrackSearch.tsx` comment says the epic must not add a second instance of
// that class of bug, so these dates render here instead, after hydration, in
// the viewer's own zone. Same hydration-gate shape as `ClockStrip`.

const NEVER_CHANGES = () => () => {};
const ON_CLIENT = () => true;
const ON_SERVER = () => false;

/**
 * Renders a day label from an epoch-ms timestamp, client-side only.
 *
 * `placeholder` is what the server (and the first client render, which must
 * match it) sends down — an em dash reads as "pending" rather than "unknown",
 * distinct from the `null`-timestamp case callers already render as "—"
 * themselves.
 */
export function ClientDayDate({ ms, placeholder = "–" }: { ms: number; placeholder?: string }) {
  const hydrated = useSyncExternalStore(NEVER_CHANGES, ON_CLIENT, ON_SERVER);
  const label = useMemo(
    () => (hydrated ? formatDayDate(new Date(ms).toISOString()) : null),
    [hydrated, ms],
  );
  return <>{label ?? placeholder}</>;
}
