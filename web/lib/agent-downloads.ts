// The one place the agent's download destinations are written down. Installers
// publish to GitHub Releases via .github/workflows/release-{macos,windows}.yml
// on the `agent-v*` tags that `tag-agent.yml` pushes whenever `agent/VERSION`
// changes on main.
//
// Until 2026-08-18 every affordance pointed at /releases/latest — the GitHub
// page that lists all eight assets (.dmg, .app.tar.gz, .msi, .exe, three
// minisign .sig files and latest.json). That page is a build-artifact index,
// not a download screen: it asks a DJ who has just paid $7.99 to guess which
// file is theirs, on the screen immediately after checkout. Launch checklist
// §1.3.
//
// What replaces it is deliberately NOT a pair of hardcoded asset URLs. Tauri
// stamps the version into every filename (`Curfew.Agent_0.1.2_universal.dmg`),
// so a constant here would have to move in lockstep with `agent/VERSION` — and
// when it didn't, it would 404 silently on the one screen that must not break.
// The timing is worse than the maintenance: the version bump IS the release
// (PR #48), so both ship in the same push. Vercel rebuilds the web half in
// about two minutes while the macOS job sits in Apple's notary queue, which has
// held this bundle for over two hours. A build-time constant would be live and
// wrong for that entire window.
//
// So the links point at our own /download/[platform], which asks GitHub for the
// current release at request time. It cannot go stale, needs no bump, and falls
// back to the releases page when GitHub can't be reached — the old behaviour
// kept as the floor rather than the ceiling.

export const AGENT_REPO = "5arjun/curfew.vip";

/** Every asset, on one GitHub page. The fallback when resolution fails. */
export const AGENT_RELEASES_URL = `https://github.com/${AGENT_REPO}/releases/latest`;

export const AGENT_PLATFORMS = ["mac", "windows"] as const;
export type AgentPlatform = (typeof AGENT_PLATFORMS)[number];

export function isAgentPlatform(value: string): value is AgentPlatform {
  return (AGENT_PLATFORMS as readonly string[]).includes(value);
}

// Which asset each platform's link resolves to, matched by suffix against the
// release's real filenames.
//
// Suffix matching is what keeps the three `.sig` files out by construction —
// `Curfew.Agent_0.1.2_universal.dmg.sig` does not end in `.dmg`. Those are
// detached minisign signatures for the Tauri updater, as is `.app.tar.gz`;
// none of the three is a thing a human should ever be handed.
const ASSET_SUFFIXES: Record<AgentPlatform, readonly string[]> = {
  mac: [".dmg"],
  // NSIS first, WiX second. Both install the same binary; `-setup.exe` is the
  // one that behaves like every other Windows installer a DJ has run. The .msi
  // stays as a fallback so a release built with only the WiX bundle still
  // resolves rather than dumping the DJ on the assets page.
  windows: ["-setup.exe", ".msi"],
};

/**
 * The asset a platform's download should hand over, or null if this release
 * doesn't carry one. Pure and case-insensitive; the route does the fetching.
 */
export function pickAssetName(
  platform: AgentPlatform,
  assetNames: readonly string[],
): string | null {
  for (const suffix of ASSET_SUFFIXES[platform]) {
    const match = assetNames.find((name) => name.toLowerCase().endsWith(suffix));
    if (match) return match;
  }
  return null;
}

export type AgentDownload = {
  platform: AgentPlatform;
  /** Same-origin on purpose — see the file header. */
  href: string;
  label: string;
  /** The one question a DJ actually has: will it run on my machine? */
  detail: string;
};

// macOS leads because Serato's install base does, not because of anything
// about the builds — and both are offered plainly, never OS-detected. Step 01
// of /welcome tells the DJ to install "on the laptop you play from", which is
// routinely not the device they are reading the page on. Guessing from this
// browser's user-agent would hide the right download from exactly the DJ who
// is reading on their phone.
export const AGENT_DOWNLOADS: readonly AgentDownload[] = [
  {
    platform: "mac",
    href: "/download/mac",
    label: "macOS",
    detail: "Apple silicon & Intel",
  },
  {
    platform: "windows",
    href: "/download/windows",
    label: "Windows",
    detail: "10 & 11, 64-bit",
  },
];
