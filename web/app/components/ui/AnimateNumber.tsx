"use client";

/**
 * <AnimateNumber> — a number that transitions digit-by-digit, in the spirit of
 * iOS's `.contentTransition(.numericText())` (Arjun-supplied reference
 * implementation, 3.8 review round 1), PLUS: only the digits that actually
 * change blur as they move. Unchanged digits never animate.
 *
 * The formatted value is split into characters rendered right-aligned, one
 * <CharSlot> per place value (keyed by its offset from the right, so the ones
 * digit keeps a stable identity as the number grows/shrinks). A slot only
 * mounts its sliding+blurring layers when its own character differs from the
 * last one — a 1199 → 1200 tick animates just "99" → "00". The slide rides a
 * baked spring (linear() easing, damped oscillator, ~5% overshoot) while
 * opacity+blur fade on their own ease so the overshoot never leaks into them.
 *
 * Adapted for this repo: state reconciles DURING render (the React-sanctioned
 * derive-from-prior-render pattern) instead of inside effects — the repo's
 * `react-hooks/set-state-in-effect` lint forbids the original's effect-based
 * approach. Single file, zero runtime dependencies; styles injected once.
 */

import * as React from "react";

const STYLES = `
.an-root {
  --an-spring: linear(
    0, 0.028 2.5%, 0.0995 5%, 0.198 7.5%, 0.3106 10%, 0.4272 12.5%, 0.5405 15%,
    0.6454 17.5%, 0.7387 20%, 0.819 22.5%, 0.8856 25%, 0.9391 27.5%, 0.9803 30%,
    1.0107 32.5%, 1.0317 35%, 1.045 37.5%, 1.052 40%, 1.0543 42.5%, 1.053 45%,
    1.0493 47.5%, 1.044 50%, 1.0379 52.5%, 1.0316 55%, 1.0254 57.5%, 1.0197 60%,
    1.0146 62.5%, 1.0102 65%, 1.0065 67.5%, 1.0035 70%, 1.0012 72.5%, 0.9995 75%,
    0.9984 77.5%, 0.9976 80%, 0.9972 82.5%, 0.9971 85%, 0.9971 87.5%, 0.9973 90%,
    0.9976 92.5%, 0.9979 95%, 0.9983 97.5%, 1
  );
  --an-dist: 0.55em;
  display: inline-flex;
  align-items: baseline;
  text-wrap: nowrap;
  font-variant-numeric: tabular-nums;
}
.an-slot { position: relative; display: inline-block; }
.an-layer { display: inline-block; will-change: transform, opacity, filter; }
.an-out { position: absolute; inset: 0; }
.an-in {
  animation:
    an-slide-in var(--an-dur, 450ms) var(--an-spring) both,
    an-resolve var(--an-dur, 450ms) cubic-bezier(0.22, 1, 0.36, 1) both;
}
.an-out {
  animation:
    an-slide-out var(--an-dur, 450ms) cubic-bezier(0.4, 0, 1, 1) both,
    an-dissolve var(--an-dur, 450ms) cubic-bezier(0.4, 0, 1, 1) both;
}
@keyframes an-slide-in {
  from { transform: translateY(calc(var(--an-dir, 1) * var(--an-dist))); }
  to { transform: translateY(0); }
}
@keyframes an-slide-out {
  from { transform: translateY(0); }
  to { transform: translateY(calc(var(--an-dir, 1) * var(--an-dist) * -1)); }
}
@keyframes an-resolve {
  from { opacity: 0; filter: blur(var(--an-blur, 21px)); }
  to { opacity: 1; filter: blur(0); }
}
@keyframes an-dissolve {
  from { opacity: 1; filter: blur(0); }
  to { opacity: 0; filter: blur(var(--an-blur, 21px)); }
}
@media (prefers-reduced-motion: reduce) {
  .an-in { animation: none; }
  .an-out { animation: none; display: none; }
}
.an-sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); text-wrap: nowrap; border: 0;
}
`;

let stylesInjected = false;
function ensureStyles() {
  if (stylesInjected || typeof document === "undefined") return;
  stylesInjected = true;
  if (document.getElementById("animate-number-styles")) return;
  const el = document.createElement("style");
  el.id = "animate-number-styles";
  el.textContent = STYLES;
  // Prepend so app/author styles always win over the defaults.
  document.head.prepend(el);
}
ensureStyles();

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

// Zero-width space so an empty slot (a digit that vanished / not yet present)
// still has a line box to animate.
const ZWSP = "​";

export type AnimateNumberProps = {
  value: number;
  /** Forwarded to `Intl.NumberFormat` (grouping, fraction digits, currency…). */
  format?: Intl.NumberFormatOptions;
  /** Defaults to "en-US" so SSR and client format identically (no hydration drift). */
  locale?: string;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  /** Slide+blur duration in ms. */
  duration?: number;
  /** Peak blur of a changing digit, in px. */
  blur?: number;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLSpanElement>, "prefix" | "children">;

function formatValue(value: number, locale: string, opts?: Intl.NumberFormatOptions) {
  try {
    return new Intl.NumberFormat(locale, opts).format(value);
  } catch {
    return String(value);
  }
}

type CharSlotProps = {
  char: string;
  direction: number;
  durationMs: number;
  blur: number;
};

/** A single character cell that slides + blurs only when its char changes. */
function CharSlot({ char, direction, durationMs, blur }: CharSlotProps) {
  const [state, setState] = React.useState(() => ({
    cur: char,
    out: null as string | null,
    gen: 0,
  }));

  // Render-time reconcile (not an effect): when the incoming char differs from
  // the one we're showing, swap it in and start animating the old one out.
  if (state.cur !== char) {
    setState((s) => ({ cur: char, out: s.cur, gen: s.gen + 1 }));
  }

  const animating = state.out !== null;

  const style = {
    "--an-dur": `${durationMs}ms`,
    "--an-blur": `${blur}px`,
    "--an-dir": direction,
  } as React.CSSProperties;

  return (
    <span className="an-slot" style={style} aria-hidden>
      <span
        key={`in-${state.gen}`}
        className={cn("an-layer", animating && "an-in")}
        onAnimationEnd={
          animating ? () => setState((s) => ({ ...s, out: null })) : undefined
        }
      >
        {state.cur === "" ? ZWSP : state.cur}
      </span>
      {animating ? (
        <span key={`out-${state.gen}`} className="an-layer an-out">
          {state.out === "" ? ZWSP : state.out}
        </span>
      ) : null}
    </span>
  );
}

export function AnimateNumber({
  value,
  format,
  locale = "en-US",
  prefix,
  suffix,
  duration = 450,
  blur = 21,
  className,
  ...rest
}: AnimateNumberProps) {
  // Inject styles before paint on the client too (covers lazy/dynamic imports).
  ensureStyles();

  const formatted = formatValue(value, locale, format);

  // Roll up when the value rises, down when it falls — previous value kept in
  // state and reconciled during render (derive-from-prior-render pattern).
  const [prev, setPrev] = React.useState(value);
  const [direction, setDirection] = React.useState(1);
  if (prev !== value) {
    setDirection(value < prev ? -1 : 1);
    setPrev(value);
  }

  const chars = formatted.split("");
  const len = chars.length;

  const label = [
    typeof prefix === "string" ? prefix : "",
    formatted,
    typeof suffix === "string" ? suffix : "",
  ].join("");

  return (
    <span {...rest} className={cn("an-root", className)}>
      <span className="an-sr">{label}</span>
      {prefix != null ? <span aria-hidden>{prefix}</span> : null}
      {chars.map((ch, i) => (
        // Keyed by distance from the right so each place value keeps its slot.
        <CharSlot
          key={len - 1 - i}
          char={ch}
          direction={direction}
          durationMs={duration}
          blur={blur}
        />
      ))}
      {suffix != null ? <span aria-hidden>{suffix}</span> : null}
    </span>
  );
}

export default AnimateNumber;
