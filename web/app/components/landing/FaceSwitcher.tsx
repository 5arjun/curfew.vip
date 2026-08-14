"use client";

import { useEffect, useSyncExternalStore } from "react";

// TEMPORARY — D-4 redline, ROUND TWO (Arjun, 2026-08-14: "I don't like any of
// these fonts"). Round one offered four serifs and all four were rejected, so
// this round changes register rather than drawing: grotesque, technical,
// art-display, condensed poster, plus the app's own Hanken as the control that
// tests D-4's premise that the marketing surface must differ from the app.
// Instrument stays as the incumbent to compare against.
//
// Rendered in development only; when Arjun picks a winner this file, the losing
// families in fonts.ts, and the .lp-root[data-face] rules in landing.css all
// come out together. Nothing else on the page reads `data-face`.

const FACES = [
  { id: "instrument", label: "Instrument" },
  { id: "archivo", label: "Archivo" },
  { id: "space", label: "Space" },
  { id: "syne", label: "Syne" },
  { id: "bricolage", label: "Bricolage" },
  { id: "shoulders", label: "Shoulders" },
  { id: "hanken", label: "App" },
] as const;

const KEY = "curfew:landing-face";
const DEFAULT = "instrument";

// A module store rather than useState: the choice has to survive a reload (the
// hero's word-rise only plays once per load, and it is half of what is being
// judged), and the server has no localStorage. Starting at DEFAULT on both
// sides keeps hydration honest; the saved value arrives in an effect.
let current: string = DEFAULT;
const listeners = new Set<() => void>();

function setFace(next: string) {
  current = next;
  window.localStorage.setItem(KEY, next);
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

export function FaceSwitcher() {
  const face = useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULT,
  );

  useEffect(() => {
    const saved = window.localStorage.getItem(KEY);
    if (saved && saved !== current) setFace(saved);
  }, []);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".lp-root");
    if (root) root.dataset.face = face;
  }, [face]);

  return (
    <div className="lp-face-switch">
      {FACES.map((option) => (
        <button
          key={option.id}
          type="button"
          data-active={option.id === face ? "true" : "false"}
          onClick={() => setFace(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
