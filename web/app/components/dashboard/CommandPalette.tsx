"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { filterItems, type SearchItem } from "@/lib/sets/search";

// ⌘K spotlight command palette (Story 3.6 redesign, must-have #2). An
// Apple-Spotlight overlay: a centered frosted panel over a dim-to-focus scrim,
// keyboard-first fuzzy search over sets. Built on the apple-design skill's
// material + motion guidance:
//  • Materialise, don't just fade — the panel scales + un-blurs on enter, and
//    dismisses along the same path (spatial consistency). Springy settle via the
//    Expo-out easing token; exit is quicker than enter.
//  • Dim to focus — a scrim pushes the page back; the panel is a lighter
//    translucent material on top (never light-on-light).
//  • Interruptible-ish: open/close are cheap opacity+transform, so a fast
//    re-toggle never locks out.
//  • Reduced motion → a plain cross-fade (globals.css); reduced transparency →
//    a near-solid surface; forced-colors → a real outline.
// Rendered through a portal to <body> so no `overflow:hidden`/stacking ancestor
// (the dashboard shell, the nav) can clip it. Colour is entirely token-driven.

const EXIT_MS = 200;

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: SearchItem[];
}

export function CommandPalette({ open, onClose, items }: CommandPaletteProps) {
  const router = useRouter();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const restoreFocusRef = useRef<Element | null>(null);

  const [render, setRender] = useState(open);
  const [shown, setShown] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const results = useMemo(() => filterItems(items, query), [items, query]);
  // Clamp for reads so a shrinking list never points past the end; the raw
  // `active` is reset to 0 on open and on every keystroke (both event handlers,
  // never a setState-in-effect).
  const activeIndex = results.length === 0 ? 0 : Math.min(active, results.length - 1);

  // Mount for the enter transition / defer unmount for the exit. Every setState
  // runs inside a deferred rAF/timeout callback — never synchronously in the
  // effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (open) {
      restoreFocusRef.current = document.activeElement;
      const raf = requestAnimationFrame(() => {
        setRender(true);
        setQuery("");
        setActive(0);
      });
      return () => cancelAnimationFrame(raf);
    }
    const raf = requestAnimationFrame(() => setShown(false));
    const t = window.setTimeout(() => setRender(false), EXIT_MS);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [open]);

  // Next frame after mount → flip to the "open" visual state so the transition runs.
  useLayoutEffect(() => {
    if (!render) return;
    const r = requestAnimationFrame(() => {
      setShown(true);
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(r);
  }, [render]);

  // Lock background scroll while open; restore focus to the trigger on close.
  useEffect(() => {
    if (!render) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = prev;
      const el = restoreFocusRef.current;
      if (el instanceof HTMLElement) el.focus();
    };
  }, [render]);

  // Keep the active row scrolled into view (no state writes here).
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const commit = useCallback(
    (item: SearchItem | undefined) => {
      if (!item) return;
      onClose();
      router.push(`/set/${item.id}`);
    },
    [onClose, router],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        onClose();
        break;
      case "ArrowDown":
        event.preventDefault();
        setActive(Math.min(activeIndex + 1, results.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive(Math.max(activeIndex - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        setActive(0);
        break;
      case "End":
        event.preventDefault();
        setActive(results.length - 1);
        break;
      case "Enter":
        event.preventDefault();
        commit(results[activeIndex]);
        break;
      case "Tab": {
        // Focus trap — cycle within the panel so focus never lands behind the scrim.
        const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
          'input, [href], button, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables || focusables.length === 0) break;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        break;
      }
    }
  };

  if (!render) return null;

  return createPortal(
    <div
      className="cmdk-scrim"
      data-state={shown ? "open" : "closed"}
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        className="cmdk-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Search sets"
        data-state={shown ? "open" : "closed"}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="cmdk-field">
          <Search className="cmdk-field-icon" size={18} strokeWidth={1.75} aria-hidden="true" />
          <input
            ref={inputRef}
            className="cmdk-input"
            type="text"
            placeholder="Search the archive — date, session, genre, artist…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={results[activeIndex] ? `${listboxId}-${results[activeIndex].id}` : undefined}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <kbd className="cmdk-esc">ESC</kbd>
        </div>

        {results.length > 0 ? (
          <ul ref={listRef} className="cmdk-list" role="listbox" id={listboxId} aria-label="Sets">
            {results.map((item, index) => (
              <li
                key={item.id}
                id={`${listboxId}-${item.id}`}
                data-index={index}
                role="option"
                aria-selected={index === activeIndex}
                className="cmdk-row"
                data-active={index === activeIndex}
                onMouseMove={() => setActive(index)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(item);
                }}
              >
                <span className="cmdk-row-main">
                  <span className="cmdk-row-title">{item.sessionLabel}</span>
                  <span className="cmdk-row-meta text-label-sm">{item.meta}</span>
                </span>
                <span className="cmdk-row-date text-label-sm">{item.dateLabel}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="cmdk-empty">
            <p className="cmdk-empty-title">Nothing under “{query.trim()}”.</p>
            <p className="cmdk-empty-hint text-body-md">
              Try a date, a session number, or a genre like “house”.
            </p>
          </div>
        )}

        <div className="cmdk-foot text-label-sm" aria-hidden="true">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
