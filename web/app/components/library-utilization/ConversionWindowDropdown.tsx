"use client";

import { useCallback, useSyncExternalStore } from "react";
import { CONVERSION_WINDOWS, DEFAULT_CONVERSION_WINDOW, type ConversionWindow } from "@/lib/sets/libraryConversion";

// The ONE conversion-window control on this page (Story 4.7, AC-3) — shared
// by the moved library-conversion trend and Story 4.3's meter, both reading
// the same persisted selection so they can never disagree on screen. Was two
// components (`ConversionWindowToggle.tsx`'s chip row on 90/60/30, and this
// file as `LiveWindowDropdown.tsx` on 60/30/14) until Story 4.7 unified the
// window scale (see `libraryConversion.ts`'s `CONVERSION_WINDOWS` doc
// comment) and moved the trend onto this page — the chip-row toggle is
// retired outright rather than kept as a second, now-redundant control.
//
// Rendered as an actual `<select>`, not a chip row, per Arjun's original
// "drop down" request for this page (Story 4.3 follow-up) — now doing double
// duty for both modules it sits above.

const STORAGE_KEY = "curfew:library-utilization:conversion-window";

const WINDOW_LABEL: Record<ConversionWindow, string> = {
  60: "60 days",
  30: "30 days",
  14: "2 weeks",
};

function isConversionWindow(v: unknown): v is ConversionWindow {
  return CONVERSION_WINDOWS.some((w) => `${w}` === v);
}

const listeners = new Set<() => void>();

// This visit's choice, in memory — `getSnapshot` is React's only source of
// truth, so a `setItem` that throws would otherwise leave the dropdown
// permanently stuck on the default (same discipline as every other
// `useSyncExternalStore`-backed toggle in this codebase).
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

export function ConversionWindowDropdown({
  value,
  onChange,
}: {
  value: ConversionWindow;
  onChange: (window: ConversionWindow) => void;
}) {
  return (
    <select
      className="lu-window-select"
      aria-label="Conversion window"
      value={value}
      onChange={(e) => onChange(Number(e.target.value) as ConversionWindow)}
    >
      {CONVERSION_WINDOWS.map((w) => (
        <option key={w} value={w}>
          {WINDOW_LABEL[w]}
        </option>
      ))}
    </select>
  );
}
