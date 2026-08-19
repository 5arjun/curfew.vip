"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { signOut } from "@/lib/account/actions";

// Sign out (Story 3.10, AC-17, D-16) — the product's first. Bottom of the
// page, behind a calm confirm dialog: DeleteModal's exact treatment (portal
// to body, blurred scrim, role=dialog, focus-on-open + restore-on-close,
// Escape, Tab focus trap) with zero destructive language or alarm color.
// Copy is D-16's, verbatim.

// `redirect()` throws a Next control-flow error tagged with this digest —
// it must propagate, never be treated as a real failure (same helper as
// DeleteModal).
function isRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

// :not(:disabled) matters: while signing out both buttons disable, and a
// trap that targets unfocusable elements silently no-ops — focus falls to
// body and Tab walks out from behind an aria-modal dialog.
const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function SignOutRow() {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="st-signout">
      <button type="button" className="st-action" onClick={() => setConfirming(true)}>
        Sign out
      </button>
      {confirming && <SignOutModal onCancel={() => setConfirming(false)} />}
    </div>
  );
}

function SignOutModal({ onCancel }: { onCancel: () => void }) {
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const signingOutRef = useRef(signingOut);

  useEffect(() => {
    signingOutRef.current = signingOut;
  }, [signingOut]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!signingOutRef.current) onCancel();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = modalRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!focusables || focusables.length === 0) {
        // Everything inside is disabled mid-sign-out: hold the trap shut
        // rather than letting Tab reach the page behind.
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (!modalRef.current?.contains(active)) {
        // Focus fell to body (the focused button disabled itself) — pull it
        // back inside instead of tabbing the page behind the dialog.
        e.preventDefault();
        first.focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return createPortal(
    <div className="st-modal-scrim" onClick={signingOut ? undefined : onCancel}>
      <div
        ref={modalRef}
        className="st-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="st-signout-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="st-signout-title" className="st-modal-title">
          Sign out?
        </h2>
        <p className="st-modal-body">Your sets stay archived. The agent keeps capturing.</p>
        {error && (
          <p className="st-modal-error">Something went sideways. You&apos;re still signed in.</p>
        )}
        <div className="st-modal-actions">
          <button
            type="button"
            ref={cancelRef}
            className="st-modal-cancel"
            disabled={signingOut}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="st-modal-confirm"
            disabled={signingOut}
            onClick={async () => {
              setError(false);
              setSigningOut(true);
              try {
                // A returned value (instead of the redirect throwing) means
                // the server-side sign-out failed and the session may still
                // be live — surface it (review ruling, 2026-08-05).
                const result = await signOut();
                if (result && !result.ok) {
                  setSigningOut(false);
                  setError(true);
                }
              } catch (err) {
                if (isRedirectError(err)) throw err;
                setSigningOut(false);
                setError(true);
              }
            }}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
