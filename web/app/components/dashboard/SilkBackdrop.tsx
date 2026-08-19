"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";

// Silk page background (D2) — React Bits `Silk` (app/components/Silk.jsx,
// verbatim from the registry), mounted full-bleed behind the dashboard with
// Arjun's exact sample props (speed 5, scale 1, noiseIntensity 0.3,
// rotation 0.4) and the Abyss silk tint (D11) in place of the sample mauve.
//
// The shader parses a hex string, not a CSS var(), so the tint is read from
// :root at runtime — same pattern as the liquid-metal materials. WebGL can't
// SSR, hence dynamic(ssr: false); .dz-silk paints the base token until the
// canvas is up. prefers-reduced-motion freezes the silk (speed 0): the
// pattern still renders, it just stops flowing.
const Silk = dynamic(() => import("@/app/components/Silk.jsx"), { ssr: false });

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(REDUCED_MOTION_QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

/**
 * Whether this browser can give the shader the context it needs — cached for
 * the session, since the answer cannot change within one.
 *
 * `@paper-design/shaders` asks for `webgl2` and **throws** when it does not get
 * one ("Paper Shaders: WebGL is not supported in this browser",
 * `shader-mount.js`). The throw happens inside an async `initShader()` that its
 * React wrapper calls without awaiting, so it surfaces as an unhandled
 * rejection rather than a render error: the page is fine and `.dz-silk`'s base
 * token paints exactly as it does before the canvas is up, but Sentry logs one
 * error per page view for every DJ whose browser has no WebGL2 — hardware
 * acceleration off, a locked-down or older browser, some in-app webviews
 * (Arjun, 2026-08-18: "I'm getting emails from Sentry").
 *
 * Asking first turns that into the no-op it was always meant to be. Note this
 * is a capability check, not an error filter: silencing the report in
 * `beforeSend` would leave the rejection happening and hide the next, different
 * reason the shader failed to start.
 *
 * `webgl2` specifically, not `webgl` — matching what the library requests. A
 * browser can have the first and not the second, and testing the wrong one
 * would answer a question nobody asked.
 */
let webgl2Supported: boolean | null = null;

function supportsWebgl2(): boolean {
  if (webgl2Supported !== null) return webgl2Supported;
  try {
    const probe = document.createElement("canvas").getContext("webgl2");
    // Hand the context slot straight back: they are a small per-page pool, and
    // the shader is about to ask for one of its own.
    probe?.getExtension("WEBGL_lose_context")?.loseContext();
    webgl2Supported = probe != null;
  } catch {
    // Getting a context can throw outright rather than return null (a blocked
    // or crashed GPU process). Same answer either way.
    webgl2Supported = false;
  }
  return webgl2Supported;
}

/** Reads the Abyss silk tint token from :root at runtime (see tokens.css). */
function useSilkColor(): string | null {
  const color = useSyncExternalStore(
    () => () => {},
    () => getComputedStyle(document.documentElement).getPropertyValue("--color-abyss-silk").trim(),
    () => "",
  );
  return color || null;
}

export function SilkBackdrop() {
  const reduced = usePrefersReducedMotion();
  const color = useSilkColor();
  // Same shape as `useSilkColor` above, and for the same reason: the answer
  // only exists in the browser, so the server snapshot is the one that renders
  // nothing. `() => {}` for subscribe — WebGL2 support does not change under a
  // live document, so there is nothing to subscribe to.
  const webgl = useSyncExternalStore(
    () => () => {},
    supportsWebgl2,
    () => false,
  );

  return (
    <div className="dz-silk" aria-hidden="true">
      {color && webgl && (
        <Silk speed={reduced ? 0 : 5} scale={1} color={color} noiseIntensity={0.3} rotation={0.4} />
      )}
    </div>
  );
}
