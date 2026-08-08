"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Granularity } from "@/lib/sets/styleEvolution";

// Week/Month granularity toggle (added post-launch-review, 2026-08-06,
// Arjun: monthly-only bucketing read as too sparse for a real trend).
// `useSyncExternalStore`-backed localStorage persistence — NOT effect+
// setState, which `react-hooks/set-state-in-effect` rejects and which Story
// 4.1's review already had to fix once. `ConversionWindowDropdown.tsx` is the
// other live instance of this exact shape; the pattern's original home
// (`MetricChipToggle.tsx`) was deleted by Story 4.7's AC-1 chip retirement,
// so the pointer moved here rather than dangling. Defaults to Month: the
// AC-1/FR-9 "month-over-month" framing stays the first-visit default, week is
// an opt-in denser view.
//
// Story 4.7 AC-2: now a PAGE-level control acting on all three trend sections
// at once, not a per-section one.

const STORAGE_KEY = "curfew:style-evolution:granularity";

function isGranularity(v: unknown): v is Granularity {
  return v === "month" || v === "week";
}

const listeners = new Set<() => void>();

// This visit's choice, in memory — `getSnapshot` is React's only source of
// truth, so a `setItem` that throws (private browsing, storage disabled)
// would otherwise leave the toggle permanently stuck on Month.
let sessionGranularity: Granularity | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Granularity {
  if (sessionGranularity != null) return sessionGranularity;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isGranularity(stored) ? stored : "month";
  } catch {
    return "month";
  }
}

function getServerSnapshot(): Granularity {
  return "month";
}

export function useGranularitySelection(): [Granularity, (g: Granularity) => void] {
  const granularity = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const select = useCallback((next: Granularity) => {
    sessionGranularity = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Non-persistent this visit; `sessionGranularity` still carries it.
    }
    listeners.forEach((listener) => listener());
  }, []);

  return [granularity, select];
}

export function GranularityToggle({
  value,
  onChange,
}: {
  value: Granularity;
  onChange: (granularity: Granularity) => void;
}) {
  return (
    <div className="se-gran" role="group" aria-label="Chart granularity">
      <button
        type="button"
        className="se-gran-btn"
        aria-pressed={value === "week"}
        onClick={() => onChange("week")}
      >
        Week
      </button>
      <button
        type="button"
        className="se-gran-btn"
        aria-pressed={value === "month"}
        onClick={() => onChange("month")}
      >
        Month
      </button>
    </div>
  );
}
