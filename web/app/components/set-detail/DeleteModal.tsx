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
export function DeleteModal({
  externalId,
  onCancel,
}: {
  externalId: string;
  onCancel: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
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
          This removes it from Curfew for good — it can&apos;t be undone. Your Serato history and
          library aren&apos;t touched.
        </p>
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
              setDeleting(true);
              await deleteSetAction(externalId);
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
