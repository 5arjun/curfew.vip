"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// The dashboard's right column (D7). A thin client wrapper around the server-
// rendered stat cards: on short-but-wide viewports the column quietly scrolls
// itself, and item 14 melts its top/bottom edges so the shells dissolve at the
// scroll bounds instead of hard-slicing (Arjun: "doesn't look natural"). The
// melt is CONDITIONAL — an edge only fades when there's actually content to
// scroll past it, so a column that fits (or is scrolled to an end) never dims
// the natural top/bottom of its cards. The fade sizes drive a mask on .dz-right
// via --dz-fade-top / --dz-fade-bottom (see dashboard.css).
export function RightColumn({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [fade, setFade] = useState({ top: false, bottom: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const top = el.scrollTop > 1;
      const bottom = el.scrollTop < el.scrollHeight - el.clientHeight - 1;
      setFade((f) => (f.top === top && f.bottom === bottom ? f : { top, bottom }));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    // Content/viewport height changes (data load, resize) flip scrollability.
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  return (
    <aside
      ref={ref}
      className="dz-right"
      aria-label="Stats"
      data-fade-top={fade.top || undefined}
      data-fade-bottom={fade.bottom || undefined}
    >
      {children}
    </aside>
  );
}
