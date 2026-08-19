"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { deleteSetAction } from "@/app/(authenticated)/set/[id]/actions";

// Delete confirm (spec §3e, AC-32..34): centered modal over a blurred
// backdrop (the drill-in overlay's blur language), calm — no alarm colors, no
// red, no exclamation marks, no type-to-confirm ceremony. The copy clarifies
// Curfew ≠ Serato, verbatim from the spec. Delete is hard and (once sync
// lands) suppressed forever — the tombstone requirement is recorded in
// deferred-work.md, owed by the sync/read-path story.

// `redirect()` throws a special Next.js control-flow error tagged with this
// digest prefix — it must propagate, never be treated as a real failure.
function isRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function DeleteModal({
  externalId,
  onCancel,
}: {
  externalId: string;
  onCancel: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const deletingRef = useRef(deleting);

  useEffect(() => {
    deletingRef.current = deleting;
  }, [deleting]);

  // Focus the modal on open, restore focus to whatever opened it (the [⋯]
  // trigger) on close — this is the one true modal in the app (OverlayPanel
  // intentionally leaves the tracklist reachable; this doesn't).
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  // Escape cancels (unless a delete is in flight — the backdrop click
  // already guards that, this closes the same gap for the keyboard path) +
  // a Tab focus trap keeps keyboard focus from leaking into the page behind
  // the scrim.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!deletingRef.current) onCancel();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = modalRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  // Portaled to <body>: the identity card's backdrop-filter would otherwise
  // become this fixed scrim's containing block, trapping the "centered modal"
  // inside the card.
  return createPortal(
    <div className="sd-modal-scrim" onClick={deleting ? undefined : onCancel}>
      <div
        ref={modalRef}
        className="sd-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sd-delete-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="sd-delete-title" className="sd-modal-title">
          Delete this set?
        </h2>
        <p className="sd-modal-body">
          This removes it from Curfew for good and can&apos;t be undone. Your Serato history and
          library aren&apos;t touched.
        </p>
        {error && (
          <p className="sd-modal-error">Something went wrong. Nothing was deleted, so try again.</p>
        )}
        <div className="sd-modal-actions">
          <button
            type="button"
            ref={cancelRef}
            className="sd-modal-cancel"
            disabled={deleting}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="sd-modal-delete"
            disabled={deleting}
            onClick={async () => {
              setError(false);
              setDeleting(true);
              try {
                await deleteSetAction(externalId);
              } catch (err) {
                if (isRedirectError(err)) throw err;
                setDeleting(false);
                setError(true);
              }
            }}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
