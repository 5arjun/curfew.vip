"use client";

import { useSyncExternalStore } from "react";

// Per-set "seen" state for the passive NEW marker (Story 3.6 AC-3). Persisted
// client-side, per-set, in localStorage — a set is marked seen the moment it is
// opened and never re-prompts. Deliberately client-only (a read-receipt, not
// synced data).
//
// Modeled as an external store via useSyncExternalStore so there is no
// setState-in-effect (React 19 lint) AND the marker never flashes: the SERVER
// snapshot is a sentinel meaning "not hydrated yet", so the server HTML and the
// first client (hydration) render both show NO markers; only after hydration
// does the real seen-set snapshot reveal markers for unopened sets. No
// server/client mismatch, no all-new flash.
const STORAGE_KEY = "curfew.seen-sets.v1";

// Distinct identity used only during SSR + hydration; `!== NOT_HYDRATED` is how
// the hook knows the real snapshot has taken over.
const NOT_HYDRATED: ReadonlySet<string> = new Set();

const listeners = new Set<() => void>();
let clientSnapshot: ReadonlySet<string> | null = null;
let clientSnapshotRaw = "";

function readRaw(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "[]";
  } catch {
    // Disabled/`SecurityError` storage must never break the dashboard.
    return "[]";
  }
}

function parse(raw: string): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

// Stable reference unless localStorage actually changed — required by
// useSyncExternalStore (a fresh Set every call would loop forever).
function getClientSnapshot(): ReadonlySet<string> {
  const raw = readRaw();
  if (clientSnapshot === null || raw !== clientSnapshotRaw) {
    clientSnapshotRaw = raw;
    clientSnapshot = parse(raw);
  }
  return clientSnapshot;
}

function getServerSnapshot(): ReadonlySet<string> {
  return NOT_HYDRATED;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function markSeenGlobal(externalId: string): void {
  const current = getClientSnapshot();
  if (current.has(externalId)) return;
  const next = new Set(current);
  next.add(externalId);
  const raw = JSON.stringify([...next]);
  try {
    localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // Persisting is best-effort; the in-memory snapshot still clears the marker.
  }
  clientSnapshot = next;
  clientSnapshotRaw = raw;
  listeners.forEach((l) => l());
}

export interface SeenSets {
  /** False during SSR + the hydration render; true once the real snapshot is live. */
  hydrated: boolean;
  isSeen: (externalId: string) => boolean;
  markSeen: (externalId: string) => void;
}

export function useSeenSets(): SeenSets {
  const snapshot = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
  return {
    hydrated: snapshot !== NOT_HYDRATED,
    isSeen: (externalId: string) => snapshot.has(externalId),
    markSeen: markSeenGlobal,
  };
}
