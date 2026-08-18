import { NextResponse, type NextRequest } from "next/server";
import {
  AGENT_RELEASES_URL,
  AGENT_REPO,
  isAgentPlatform,
  pickAssetName,
  type AgentPlatform,
} from "@/lib/agent-downloads";

// /download/mac and /download/windows — the two stable URLs every download
// affordance points at, resolved to the current release's real asset at request
// time. Why this exists rather than two constants: lib/agent-downloads.ts.
//
// The contract this route owes its callers is that it ALWAYS lands somewhere
// useful. Every failure — an unknown platform in the path, GitHub down, GitHub
// rate-limiting us, a release that somehow carries no installer for this OS —
// redirects to the all-assets page, which is exactly where these links pointed
// before today. The floor is the old behaviour; there is no error state.
//
// Node runtime to match the rest of this app's route handlers. Nothing here
// needs it, but the one thing worth avoiding on the post-payment screen is a
// runtime that behaves differently from every other route we have run in prod.
export const runtime = "nodejs";

/**
 * How long a resolved release is reused before we ask GitHub again.
 *
 * The unauthenticated API allows 60 requests an hour per IP, and Vercel's
 * functions share egress addresses — without a memo, a busy launch day could
 * spend that budget and start falling back to the assets page for everyone.
 * Fifteen minutes is far shorter than the gap between agent releases and far
 * longer than any traffic spike.
 *
 * A module-level memo rather than `next: { revalidate }` because the two would
 * be doing the same job and only one of them is legible here: Fluid Compute
 * reuses function instances, so this survives across requests, and the TTL is
 * stated in one place instead of being a property of a framework cache.
 */
const RELEASE_TTL_MS = 15 * 60 * 1000;

/**
 * How long a FAILED lookup is remembered. Deliberately short — a GitHub blip
 * shouldn't cost fifteen minutes of degraded links — but non-zero, so an
 * outage or a rate-limit doesn't turn every pageview into another doomed call.
 */
const FAILURE_TTL_MS = 60 * 1000;

/** Give up well before the DJ does. */
const GITHUB_TIMEOUT_MS = 4000;

type CachedAssets = { names: Map<string, string>; expiresAtMs: number };

let cache: CachedAssets | null = null;

/**
 * Asset name → download URL for the latest release, memoized.
 *
 * `/releases/latest` is the right endpoint rather than listing tags: GitHub
 * defines it as the newest non-draft, non-prerelease release, which is what
 * skipped `agent-v0.1.0-rc.1` — the prerelease WiX rejected — without this
 * route having to know that story.
 */
async function readReleaseAssets(): Promise<Map<string, string>> {
  const now = Date.now();
  if (cache && cache.expiresAtMs > now) return cache.names;

  const names = new Map<string, string>();
  let ok = false;

  try {
    const response = await fetch(`https://api.github.com/repos/${AGENT_REPO}/releases/latest`, {
      headers: {
        Accept: "application/vnd.github+json",
        // GitHub rejects unidentified API clients outright.
        "User-Agent": "curfew.vip",
      },
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
      cache: "no-store",
    });

    if (response.ok) {
      const payload: unknown = await response.json();
      const assets =
        typeof payload === "object" && payload !== null
          ? (payload as { assets?: unknown }).assets
          : null;

      if (Array.isArray(assets)) {
        for (const asset of assets) {
          if (typeof asset !== "object" || asset === null) continue;
          const { name, browser_download_url: url } = asset as {
            name?: unknown;
            browser_download_url?: unknown;
          };
          if (typeof name === "string" && typeof url === "string") names.set(name, url);
        }
        ok = true;
      }
    }
  } catch {
    // Timeout, DNS, malformed JSON — all the same answer downstream.
  }

  // A successful read with zero assets is still a successful read: it means the
  // release genuinely has nothing to offer, and re-asking every minute won't
  // change that.
  cache = { names, expiresAtMs: now + (ok ? RELEASE_TTL_MS : FAILURE_TTL_MS) };
  return names;
}

async function resolveAssetUrl(platform: AgentPlatform): Promise<string | null> {
  const assets = await readReleaseAssets();
  const name = pickAssetName(platform, [...assets.keys()]);
  return name ? (assets.get(name) ?? null) : null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform } = await params;

  if (!isAgentPlatform(platform)) {
    return NextResponse.redirect(AGENT_RELEASES_URL, 302);
  }

  const url = await resolveAssetUrl(platform);

  // 302, never 301: the destination changes with every agent release, and a
  // permanent redirect is the one kind a browser is entitled to keep forever.
  return NextResponse.redirect(url ?? AGENT_RELEASES_URL, 302);
}
