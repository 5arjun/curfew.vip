// The one place the agent's download destination is written down. Installers
// publish to GitHub Releases via .github/workflows/release-{macos,windows}.yml
// on `agent-v*` tags — until a first signed build ships and a real download
// page exists, the latest-release page is the canonical download surface for
// both platforms. Swap for per-OS artifact URLs when the filenames are real,
// and every screen that offers the download follows at once.
export const AGENT_DOWNLOAD_URL = "https://github.com/5arjun/curfew.vip/releases/latest";
