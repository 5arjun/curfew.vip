"use client";

import { useEffect, useId, useRef, useState } from "react";
import { updateDjName } from "@/lib/account/actions";
import { useAnnounceSaved } from "./SavedIndicator";

// The one writable row on the screen (Story 3.10, AC-4/AC-16, D-3/D-15):
// autosave with a ~600ms debounce while typing plus save on blur/Enter — no
// Save button. Success announces the page-level "Saved."; failure renders
// inline under the row and NEVER reverts the typed value ("Change not saved
// — retry.", the new Failure Register entry). Network drop, expired session,
// RLS rejection, and offline-while-typing all take the same row.
//
// The input wears the auth ghost-input treatment (auth-ghost-field-input) —
// looks like a plain value until focused — but sits in the console-row
// grammar, so the row's own left label labels it (htmlFor) rather than
// GhostInput's stacked label-above layout.

const DEBOUNCE_MS = 600;

export function DjNameRow({ initialName }: { initialName: string | null }) {
  const inputId = useId();
  const announceSaved = useAnnounceSaved();
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const valueRef = useRef(initialName ?? "");
  const lastSavedRef = useRef(initialName ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic save sequence: only the latest in-flight save's result may
  // touch state, so a slow failure can't overwrite a newer success (or vice
  // versa) after fast typing.
  const seqRef = useRef(0);

  useEffect(
    () => () => {
      if (debounceRef.current != null) clearTimeout(debounceRef.current);
    },
    [],
  );

  async function save(value: string) {
    if (value === lastSavedRef.current) {
      // Typing back to the stored value is a resolution, not a failure.
      setFailed(false);
      return;
    }
    const seq = ++seqRef.current;
    setSaving(true);
    const result = await updateDjName(value).catch(() => ({ ok: false as const }));
    if (seq !== seqRef.current) return;
    setSaving(false);
    if (result.ok) {
      lastSavedRef.current = value;
      setFailed(false);
      announceSaved();
    } else {
      setFailed(true);
    }
  }

  function scheduleSave(value: string) {
    valueRef.current = value;
    if (debounceRef.current != null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void save(valueRef.current), DEBOUNCE_MS);
  }

  function flush() {
    if (debounceRef.current != null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    void save(valueRef.current);
  }

  return (
    <div className="st-row">
      <label className="st-row-label" htmlFor={inputId}>
        DJ name
      </label>
      <div className="st-row-cell">
        <input
          id={inputId}
          name="dj_name"
          type="text"
          defaultValue={initialName ?? ""}
          maxLength={40}
          autoComplete="nickname"
          spellCheck={false}
          className="text-mono-data auth-ghost-field-input st-name-input"
          aria-describedby={failed ? `${inputId}-error` : undefined}
          aria-invalid={failed ? true : undefined}
          onChange={(e) => scheduleSave(e.target.value)}
          onBlur={flush}
          onKeyDown={(e) => {
            if (e.key === "Enter") flush();
          }}
        />
        {failed && (
          <p id={`${inputId}-error`} className="st-inline-error" role="alert">
            Change not saved — retry.
            <button type="button" className="st-retry" disabled={saving} onClick={flush}>
              Retry
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
