"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Page-level save confirmation (Story 3.10, AC-16 / D-15, EXPERIENCE.md
// "Settings saved"): every successful save on the page announces through ONE
// "Saved." on the heading baseline, fading after ~2s — no per-row toasts, no
// modal escalation. Context so any row (today: the DJ-name autosave) can
// announce without the page threading callbacks; the provider wraps the
// whole server-rendered page and passes it through as children.

const SHOW_MS = 2000;

const SavedContext = createContext<{ announce: () => void; visible: boolean; seq: number }>({
  announce: () => {},
  visible: false,
  seq: 0,
});

export function SettingsSavedProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  // Bumped per announce so the status region's TEXT changes even when a
  // save lands inside the previous one's 2s window — aria-live announces
  // text changes, and "Saved." → "Saved." is not one.
  const [seq, setSeq] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback(() => {
    setVisible(true);
    setSeq((n) => n + 1);
    if (timer.current != null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), SHOW_MS);
  }, []);

  useEffect(
    () => () => {
      if (timer.current != null) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <SavedContext.Provider value={{ announce, visible, seq }}>{children}</SavedContext.Provider>
  );
}

/** A row calls this after a confirmed-successful save. */
export function useAnnounceSaved(): () => void {
  return useContext(SavedContext).announce;
}

/**
 * The "Saved." text itself — mounted once, on the heading baseline. The
 * visible copy stays in the DOM permanently (opacity fade, not mount/unmount)
 * so the fade-out actually has text to fade and the heading row never
 * reflows; a separate visually-hidden status region carries the screen-
 * reader announcement, since an opacity change alone announces nothing.
 */
export function SavedBadge() {
  const { visible, seq } = useContext(SavedContext);
  return (
    <>
      <span
        className={`st-saved${visible ? " st-saved-visible" : ""}`}
        aria-hidden="true"
      >
        Saved.
      </span>
      <span className="sr-only" role="status">
        {/* The alternating zero-width space forces a text change per save,
            so back-to-back saves inside the 2s window each announce. */}
        {visible ? (seq % 2 === 0 ? "Saved." : "Saved.​") : ""}
      </span>
    </>
  );
}
