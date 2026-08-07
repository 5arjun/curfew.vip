"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_LIVE_WINDOW, LIVE_CONVERSION_WINDOWS, type LiveWindow } from "@/lib/sets/libraryConversion";

// Live-window dropdown (Story 4.3 follow-up, Arjun 2026-08-07: "instead of 90
// do 60 and add a drop down to let them select 30 days or 2 weeks"). Same
// `useSyncExternalStore`-backed localStorage persistence shape as
// `ConversionWindowToggle.tsx` (style-evolution's D-13 toggle) — copied
// rather than shared because the two toggles select from two different
// window scales (`LIVE_CONVERSION_WINDOWS` vs `CONVERSION_WINDOWS`) and
// persist independently. Rendered as an actual `<select>`, not a chip row,
// per Arjun's explicit "drop down" request — this page has exactly one
// control, and a dropdown reads calmer here than a 3-way toggle would.

const STORAGE_KEY = "curfew:library-utilization:conversion-window";

const WINDOW_LABEL: Record<LiveWindow, string> = {
  60: "60 days",
  30: "30 days",
  14: "2 weeks",
};

function isLiveWindow(v: unknown): v is LiveWindow {
  return LIVE_CONVERSION_WINDOWS.some((w) => `${w}` === v);
}

const listeners = new Set<() => void>();

// This visit's choice, in memory — see `ConversionWindowToggle.tsx`'s
// identical field for why: `getSnapshot` is React's only source of truth, so
// a `setItem` that throws would otherwise leave the dropdown permanently
// stuck on the default.
let sessionWindow: LiveWindow | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): LiveWindow {
  if (sessionWindow != null) return sessionWindow;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLiveWindow(stored) ? (Number(stored) as LiveWindow) : DEFAULT_LIVE_WINDOW;
  } catch {
    return DEFAULT_LIVE_WINDOW; // storage unavailable — the default stands.
  }
}

function getServerSnapshot(): LiveWindow {
  return DEFAULT_LIVE_WINDOW;
}

export function useLiveWindowSelection(): [LiveWindow, (w: LiveWindow) => void] {
  const selected = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const select = useCallback((next: LiveWindow) => {
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

export function LiveWindowDropdown({
  value,
  onChange,
}: {
  value: LiveWindow;
  onChange: (window: LiveWindow) => void;
}) {
  return (
    <select
      className="lu-window-select"
      aria-label="Conversion window"
      value={value}
      onChange={(e) => onChange(Number(e.target.value) as LiveWindow)}
    >
      {LIVE_CONVERSION_WINDOWS.map((w) => (
        <option key={w} value={w}>
          {WINDOW_LABEL[w]}
        </option>
      ))}
    </select>
  );
}
