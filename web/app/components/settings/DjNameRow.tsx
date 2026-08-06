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
// The input wears the ghost treatment in the abyss register (st-name-input,
// settings.css) — looks like a plain value until focused — and sits in the
// console-row grammar, so the row's own left label labels it (htmlFor)
// rather than GhostInput's stacked label-above layout.

const DEBOUNCE_MS = 600;

export function DjNameRow({ initialName }: { initialName: string | null }) {
  const inputId = useId();
  const announceSaved = useAnnounceSaved();
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const valueRef = useRef(initialName ?? "");
  const lastSavedRef = useRef(initialName ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic save sequence: only the latest save's result may touch state,
  // so a slow failure can't overwrite a newer success (or vice versa) after
  // fast typing.
  const seqRef = useRef(0);
  // Saves are SERIALIZED (each awaits the one before): the seq alone only
  // orders client state — two overlapping UPDATEs could commit out of order
  // server-side, leaving the DB with the stale value while the UI says
  // "Saved." A superseded save is skipped at dequeue time, so the chain
  // also never fires a write the DJ has already typed past.
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(
    () => () => {
      if (debounceRef.current != null) clearTimeout(debounceRef.current);
    },
    [],
  );

  function save(value: string) {
    const seq = ++seqRef.current;
    chainRef.current = chainRef.current.then(() => runSave(value, seq));
  }

  async function runSave(value: string, seq: number) {
    if (seq !== seqRef.current) return; // superseded while queued — skip the write
    if (value === lastSavedRef.current) {
      // Typing back to the stored value is a resolution, not a failure.
      // Compared at DEQUEUE time (after any earlier save settled), so a
      // revert that raced an in-flight save still lands on the truth.
      setSaving(false);
      setFailed(false);
      return;
    }
    setSaving(true);
    const result = await updateDjName(value).catch(() => ({ ok: false as const }));
    if (result.ok) lastSavedRef.current = value;
    if (seq !== seqRef.current) return;
    setSaving(false);
    if (result.ok) {
      setFailed(false);
      announceSaved();
    } else {
      setFailed(true);
    }
  }

  function scheduleSave(value: string) {
    valueRef.current = value;
    if (debounceRef.current != null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => save(valueRef.current), DEBOUNCE_MS);
  }

  function flush() {
    if (debounceRef.current != null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    save(valueRef.current);
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
          placeholder="Add your DJ name"
          maxLength={40}
          autoComplete="nickname"
          spellCheck={false}
          className="text-mono-data st-name-input"
          aria-describedby={failed ? `${inputId}-error` : undefined}
          aria-invalid={failed ? true : undefined}
          onChange={(e) => scheduleSave(e.target.value)}
          onBlur={flush}
          onKeyDown={(e) => {
            // isComposing: Enter confirming an IME conversion (CJK input)
            // must not save the half-composed text.
            if (e.key === "Enter" && !e.nativeEvent.isComposing) flush();
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
