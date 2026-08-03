"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// Archive odometer (D10): lifetime totals — sets archived · hours on decks ·
// tracks played — under "Your archive" (the copy rule: the history is the
// DJ's asset, never "since you joined"). Numerals count up on load with an
// ease-out ramp; frozen (instant) under prefers-reduced-motion.
const COUNT_UP_MS = 900;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(REDUCED_MOTION_QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => true,
  );
}

function useCountUp(target: number, frozen: boolean): number {
  // Progress (0→1) only ever advances inside rAF callbacks — never
  // synchronously in the effect body; frozen renders bypass it entirely.
  const [progress, setProgress] = useState(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (frozen) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_UP_MS);
      setProgress(1 - (1 - t) ** 3);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [target, frozen]);

  return frozen ? target : Math.round(target * progress);
}

export function OdometerCard({
  sets,
  hours,
  tracks,
}: {
  sets: number;
  hours: number;
  tracks: number;
}) {
  const reduced = usePrefersReducedMotion();
  const s = useCountUp(sets, reduced);
  const h = useCountUp(hours, reduced);
  const t = useCountUp(tracks, reduced);

  // D10's own labeling: 3-across numerals over "sets · hours · tracks"; the
  // full phrasing rides the accessible name.
  const stats = [
    { value: s, target: sets, label: "sets", full: "sets archived" },
    { value: h, target: hours, label: "hours", full: "hours on decks" },
    { value: t, target: tracks, label: "tracks", full: "tracks played" },
  ];

  return (
    <section className="dz-shell dz-card odo" aria-label="Your archive">
      <h2 className="dz-card-title">Your archive</h2>
      <dl className="odo-row">
        {stats.map((stat) => (
          <div key={stat.label} className="odo-stat">
            <dd>{stat.target === 0 ? "—" : stat.value}</dd>
            <dt aria-label={stat.full}>{stat.label}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}
