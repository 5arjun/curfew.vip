"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  CONVERSION_WINDOWS,
  DEFAULT_CONVERSION_WINDOW,
  type ConversionWindow,
} from "@/lib/sets/libraryConversion";

// Conversion-window toggle — 90 / 60 / 30 days (D-13, Arjun 2026-08-07:
// "add a toggle which changes the graph from 90 days to 60 to 30, similarly to
// how the bpm graph has a week and month toggle"). Same shape, same
// `useSyncExternalStore`-backed localStorage persistence, and the same
// `.se-gran` visual language as `GranularityToggle` — it occupies that exact
// slot in the controls row, since the week/month toggle is hidden for this
// metric (month cohorts only). Read MetricChipToggle.tsx's doc comment for why
// an effect+setState isn't used.
//
// Defaults to 90 and stays defaulted to 90: D-8 locked that length to match
// FR-11's already-fixed window (`prd.md:239`) so this trend and Story 4.3's
// conversion-rate meter can never disagree by measuring different things. 60
// and 30 are an exploration affordance on top of that default, NOT a
// redefinition of the metric — which is also why the selected window is named
// in the caption and the disclosure line rather than left implicit.

const STORAGE_KEY = "curfew:style-evolution:conversion-window";

function isConversionWindow(v: unknown): v is ConversionWindow {
  return CONVERSION_WINDOWS.some((w) => `${w}` === v);
}

const listeners = new Set<() => void>();

// This visit's choice, in memory — see the same field in MetricChipToggle for
// why: `getSnapshot` is React's only source of truth, so a `setItem` that
// throws would otherwise leave the toggle permanently stuck on 90.
let sessionWindow: ConversionWindow | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ConversionWindow {
  if (sessionWindow != null) return sessionWindow;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isConversionWindow(stored) ? (Number(stored) as ConversionWindow) : DEFAULT_CONVERSION_WINDOW;
  } catch {
    return DEFAULT_CONVERSION_WINDOW; // storage unavailable — the default stands.
  }
}

function getServerSnapshot(): ConversionWindow {
  return DEFAULT_CONVERSION_WINDOW;
}

export function useConversionWindowSelection(): [ConversionWindow, (w: ConversionWindow) => void] {
  const selected = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const select = useCallback((next: ConversionWindow) => {
    sessionWindow = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, `${next}`);
    } catch {
      // Non-persistent this visit; `sessionWindow` still carries it.
    }
    listeners.forEach((listener) => listener());
  }, []);

  return [selected, select];
}

export function ConversionWindowToggle({
  value,
  onChange,
}: {
  value: ConversionWindow;
  onChange: (window: ConversionWindow) => void;
}) {
  return (
    // The group label carries the UNIT, so the buttons can stay bare numerals
    // ("90 60 30" reads as a scale; "90 days 60 days 30 days" reads as three
    // unrelated settings) without leaving a screen-reader user to guess what
    // the numbers mean.
    <div className="se-gran" role="group" aria-label="Conversion window, in days">
      {CONVERSION_WINDOWS.map((w) => (
        <button
          key={w}
          type="button"
          className="se-gran-btn"
          aria-pressed={value === w}
          aria-label={`${w} days`}
          onClick={() => onChange(w)}
        >
          {w}
        </button>
      ))}
    </div>
  );
}
