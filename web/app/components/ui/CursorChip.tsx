"use client";

import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

// Cursor-follow chip — the calendar day-chip treatment (project-showcase
// mechanics) extracted into a shared primitive (REFINEMENTS item 4): one
// floating surface that trails the cursor via rAF lerp — the sanctioned
// unregistered-vars/inline-style pattern from the @property bug — flips and
// clamps inside a bounds rect (item 13 mechanics), and crossfades content
// between hover targets. Styles: .cursor-chip* (dashboard.css).
//
// Portaled to document.body with VIEWPORT coords, so no ancestor
// backdrop-filter can hijack its containing block and no scroll-region
// mask/overflow clips it (the in-card version relied on that containing-block
// accident; the calendar's card clip is now an explicit boundsRef instead).
//
// The parent feeds viewport cursor coords into `target` (a mutable ref — no
// per-frame React state) and keys `contentKey` by the hovered thing so the
// body crossfades when the target changes while the chip stays up.

const LERP_FACTOR = 0.15;
const PAD = 10;

/** Mutable viewport-coord target the parent writes on mousemove/enter. */
export function useCursorChipTarget() {
  return useRef({ x: 0, y: 0 });
}

export function CursorChip({
  target,
  visible,
  contentKey,
  boundsRef,
  offsetX = 18,
  offsetY = -72,
  children,
}: {
  target: RefObject<{ x: number; y: number }>;
  visible: boolean;
  /** Keys the content crossfade; change it when the hovered target changes. */
  contentKey: string | null;
  /** Clamp the chip inside this element's rect; omit to clamp to the viewport. */
  boundsRef?: RefObject<HTMLElement | null>;
  offsetX?: number;
  offsetY?: number;
  children: ReactNode;
}) {
  const chipRef = useRef<HTMLDivElement>(null);
  const smooth = useRef({ x: 0, y: 0 });
  const raf = useRef<number | null>(null);
  // Portals can't SSR — render nothing until hydrated (the canonical
  // useSyncExternalStore is-hydrated snapshot; no setState-in-effect).
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // Appear in place: when the chip turns visible, snap the smoothed position
  // onto the cursor (the glow's handleEnter precedent) so the first show never
  // lerps in from a stale corner; while it stays visible, moves keep the glide.
  useEffect(() => {
    if (visible) smooth.current = { ...target.current };
  }, [visible, target]);

  useEffect(() => {
    const animate = () => {
      const t = target.current;
      smooth.current = {
        x: smooth.current.x + (t.x - smooth.current.x) * LERP_FACTOR,
        y: smooth.current.y + (t.y - smooth.current.y) * LERP_FACTOR,
      };
      const chip = chipRef.current;
      if (chip) {
        // Item 13 mechanics, generalized: default up-and-right of the cursor,
        // FLIP to the cursor's left when the chip would overrun the bounds'
        // right edge, then clamp on both axes so edge targets can't push it
        // out. (Per-frame layout reads are fine here — transform writes don't
        // dirty layout, so the reads stay cached.)
        const b = boundsRef?.current?.getBoundingClientRect();
        const left = b ? b.left : 0;
        const top = b ? b.top : 0;
        const right = b ? b.right : window.innerWidth;
        const bottom = b ? b.bottom : window.innerHeight;
        const chipW = chip.offsetWidth;
        const chipH = chip.offsetHeight;
        let x = smooth.current.x + offsetX;
        if (x + chipW > right - PAD) x = smooth.current.x - offsetX - chipW;
        x = Math.max(left + PAD, Math.min(x, right - chipW - PAD));
        let y = smooth.current.y + offsetY;
        y = Math.max(top + PAD, Math.min(y, bottom - chipH - PAD));
        chip.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }
      raf.current = requestAnimationFrame(animate);
    };
    raf.current = requestAnimationFrame(animate);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [target, boundsRef, offsetX, offsetY]);

  if (!mounted) return null;

  return createPortal(
    <div
      ref={chipRef}
      className="cursor-chip"
      data-visible={visible || undefined}
      aria-hidden="true"
    >
      <MotionConfig reducedMotion="user">
        <AnimatePresence mode="popLayout">
          {visible && (
            <motion.div
              key={contentKey}
              initial={{ opacity: 0, scale: 1.06, filter: "blur(6px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 0.98, filter: "blur(6px)" }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="cursor-chip-body"
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      </MotionConfig>
    </div>,
    document.body,
  );
}
