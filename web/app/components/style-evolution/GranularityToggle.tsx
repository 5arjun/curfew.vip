"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Granularity } from "@/lib/sets/styleEvolution";

// Week/Month granularity toggle (added post-launch-review, 2026-08-06,
// Arjun: monthly-only bucketing read as too sparse for a real trend). Same
// `useSyncExternalStore`-backed localStorage persistence as the metric chip
// (MetricChipToggle.tsx) — read the doc comment there for why an effect+
// setState isn't used. Defaults to Month: the AC-1/FR-9 "month-over-month"
// framing stays the first-visit default, week is an opt-in denser view.

const STORAGE_KEY = "curfew:style-evolution:granularity";

function isGranularity(v: unknown): v is Granularity {
  return v === "month" || v === "week";
}

const listeners = new Set<() => void>();

// This visit's choice, in memory — see the same field in MetricChipToggle for
// why: `getSnapshot` is React's only source of truth, so a `setItem` that
// throws would otherwise leave the toggle permanently stuck on Month.
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
