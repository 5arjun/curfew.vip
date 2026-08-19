import type { PostHog } from "posthog-js";

// No POSTHOG_ASSET_PATH here on purpose: posthog-js derives the recorder URL
// from `api_host` itself (`/relay` + `/static/...`), so the asset path is
// next.config.ts's business alone. Both ends still agree because both are
// spelled once, in ./config.
import { POSTHOG_KEY, POSTHOG_PROXY_PATH } from "./config";

// Single owner of posthog-js's lifecycle in the browser.
//
// Everything that touches PostHog goes through `ensurePostHog()` and gets the
// same promise back, because there are two independent callers and they race:
// instrumentation-client.ts schedules the init at idle (below), while
// PostHogIdentify mounts as soon as an authenticated layout renders — often
// FIRST. A component that reached for the singleton directly would find it
// un-initialised and silently drop the identify() call, which is the one call
// the whole funnel depends on. Awaiting a shared promise removes the race
// rather than papering it with a `__loaded` check and a retry.
let ready: Promise<PostHog | null> | null = null;

// True when the browser is asking not to be measured, by either signal:
// Do Not Track (the older header-era one, still what most browsers expose) or
// Global Privacy Control (the newer one, and the one with actual legal weight
// under CCPA). The 2026-08-18 legal review named both.
//
// VERIFIED THE HARD WAY, 2026-08-19: posthog-js's own `respect_dnt: true` is
// NOT sufficient to back the promise /privacy makes. It suppresses event
// capture, but the library still initialises, still fetches remote config, and
// still SETS ITS COOKIE (`ph_phc_…`) — observed live on a preview deploy in a
// browser with DNT on. The policy says "no analytics cookie set", so the only
// honest implementation is to never load the library at all. `respect_dnt`
// stays on below as a second line, but this is the one that makes the sentence
// true. Deleting this function silently falsifies a published privacy policy.
function measurementRefused(): boolean {
  if (typeof navigator === "undefined") return false;

  const nav = navigator as Navigator & {
    globalPrivacyControl?: boolean;
    msDoNotTrack?: string;
  };
  const win = window as Window & { doNotTrack?: string };

  if (nav.globalPrivacyControl === true) return true;

  // Browsers have historically spelled the affirmative as "1" or "yes", and
  // hung the property off three different objects.
  const dnt = nav.doNotTrack ?? win.doNotTrack ?? nav.msDoNotTrack;
  return dnt === "1" || dnt === "yes";
}

export function ensurePostHog(): Promise<PostHog | null> {
  if (ready) return ready;

  ready = (async () => {
    // No key (dev checkout, or a preview built before the integration's env
    // vars landed) means no PostHog at all — not a broken one. Returning null
    // rather than throwing keeps every caller's `?.` path the quiet one.
    if (!POSTHOG_KEY || typeof window === "undefined") return null;

    // Before the import, not after: returning here means posthog-js is never
    // even fetched, so there is no cookie, no config request, and no chunk on
    // the wire. That is what /privacy promises.
    if (measurementRefused()) return null;

    // Dynamic, not a top-level import: posthog-js with session replay is a
    // sizeable dependency, and instrumentation-client.ts is on the critical
    // path of EVERY route — including the landing page, which already spends
    // its main-thread budget on a WebGL mesh and several MP4s. A dynamic
    // import puts it in its own async chunk so it costs nothing until idle.
    const { default: posthog } = await import("posthog-js");

    posthog.init(POSTHOG_KEY, {
      // Relative, so requests go to this origin and hit the rewrites in
      // next.config.ts. See lib/posthog/config.ts for why the proxy exists.
      api_host: POSTHOG_PROXY_PATH,
      // Where the *toolbar* and "view in PostHog" links point. Not proxied —
      // it is a link target for us, not a request path for the DJ's browser.
      ui_host: "https://us.posthog.com",

      // Belt and braces. measurementRefused() above has already returned for
      // any browser this flag would apply to, so in practice this never fires
      // — it is here to cover any DNT spelling posthog-js recognises and the
      // check above doesn't. It is NOT what backs the privacy policy; see the
      // comment on measurementRefused() for why it can't be.
      respect_dnt: true,

      // Anonymous visitors still produce events (that IS the prospective-DJ
      // funnel), they just don't each mint a stored person profile. Person
      // profiles begin at identify(), which is also when the anonymous history
      // gets stitched onto the account. Cheaper, and less retained data about
      // people who never signed up.
      person_profiles: "identified_only",

      // App Router does client-side navigation, so a pageview must follow
      // history changes — the default only fires on hard loads, which would
      // make every soft-navigated route invisible and collapse the whole
      // /dashboard → /set → /track path report into one entry.
      capture_pageview: "history_change",
      capture_pageleave: true,

      session_recording: {
        // Replay is the point of this at current traffic — twenty recordings
        // of real DJs stalling on the phone step beats a conversion rate
        // computed over thirty people. But it must not become a way to read
        // things back that the policy says are never collected.
        maskAllInputs: true,
        maskTextSelector: "[data-private]",
      },
    });

    return posthog;
  })();

  return ready;
}

// Fire-and-forget event capture that is safe before init and safe with no key.
export async function capture(
  event: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  const posthog = await ensurePostHog();
  posthog?.capture(event, properties);
}
