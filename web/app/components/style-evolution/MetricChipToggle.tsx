"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { TrendMetric } from "./TrendChart";

const STORAGE_KEY = "curfew:style-evolution:metric";

// The one list of metrics — chip order IS the AC-1/FR-9 order, and the
// storage validator derives from it rather than repeating it (two
// hand-maintained copies of the same three keys drift).
export const METRIC_CHIPS: Array<{ key: TrendMetric; label: string }> = [
  { key: "bpm", label: "BPM Range" },
  { key: "genre", label: "Genre Diversity" },
  { key: "key", label: "Key Usage" },
];

function isTrendMetric(v: unknown): v is TrendMetric {
  return typeof v === "string" && METRIC_CHIPS.some((c) => c.key === v);
}

// localStorage is an external store, so this reads it the same way
// CursorChip/SilkBackdrop read other external browser state — via
// useSyncExternalStore, not a setState-in-effect (React 19's own guidance:
// an effect should subscribe to an external system, not synchronously push
// its value into React state). The native `storage` event only fires in
// OTHER tabs, so same-tab reactivity needs its own tiny notify — `select`
// below calls it directly right after the write.
const listeners = new Set<() => void>();

// Selection for THIS visit, held in memory. `getSnapshot` is the only source
// of truth React reads, so without this a failed `setItem` (quota exceeded,
// storage disabled by policy) left the chips permanently inert: the write
// threw, the notify fired, and the snapshot re-read the unchanged stored
// value. Persistence is the nice-to-have (D-6); switching metric at all is
// the feature.
let sessionMetric: TrendMetric | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): TrendMetric {
  if (sessionMetric != null) return sessionMetric;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isTrendMetric(stored) ? stored : "bpm";
  } catch {
    return "bpm"; // storage unavailable (private mode, disabled) — the default stands.
  }
}

// D-6: falls back to BPM range (the FR-9/AC-1 list order) on the first-ever
// visit AND on the server, before localStorage can be read at all.
function getServerSnapshot(): TrendMetric {
  return "bpm";
}

/** D-6: default chip selection = last-selected metric, persisted in localStorage. */
export function useMetricSelection(): [TrendMetric, (metric: TrendMetric) => void] {
  const metric = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const select = useCallback((next: TrendMetric) => {
    // In-memory first, so the UI flips whether or not the write lands.
    sessionMetric = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Non-persistent this visit; `sessionMetric` still carries the choice.
    }
    listeners.forEach((listener) => listener());
  }, []);

  return [metric, select];
}

// Metric chip toggle (Task 4) — 3 chips, one chart visible at a time
// (EXPERIENCE.md:73: never stacked small-multiples). Matches the existing
// chip/hover-glow visual language (genre chips, sort chips) rather than
// inventing a new idiom — see `.se-chip` in style-evolution.css. Plain
// `<button>`s are Tab/Enter/Space-operable natively (UX-DR21). Selection
// persistence and the D-6 first-visit default live in `useMetricSelection`
// above, in this file — `StyleEvolutionView` just calls the hook and passes
// the value down; it touches no storage itself.

export function MetricChipToggle({
  value,
  onChange,
}: {
  value: TrendMetric;
  onChange: (metric: TrendMetric) => void;
}) {
  return (
    <div className="se-chips" role="group" aria-label="Trend metric">
      {METRIC_CHIPS.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className="se-chip"
          aria-pressed={value === chip.key}
          onClick={() => onChange(chip.key)}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
