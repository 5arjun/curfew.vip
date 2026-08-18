import { describe, expect, it } from "vitest";
import { AGENT_DOWNLOADS, isAgentPlatform, pickAssetName } from "./agent-downloads";

// The failure this file exists to prevent is not a crash. It is handing a DJ
// who has just paid a 400-byte minisign signature named `.dmg.sig` and calling
// it the app — a download that "works", produces a useless file, and looks like
// the product is broken.

/** Verbatim from `gh release view agent-v0.1.1 --json assets`. */
const RELEASE_ASSETS = [
  "Curfew.Agent_0.1.1_universal.app.tar.gz",
  "Curfew.Agent_0.1.1_universal.app.tar.gz.sig",
  "Curfew.Agent_0.1.1_universal.dmg",
  "Curfew.Agent_0.1.1_x64-setup.exe",
  "Curfew.Agent_0.1.1_x64-setup.exe.sig",
  "Curfew.Agent_0.1.1_x64_en-US.msi",
  "Curfew.Agent_0.1.1_x64_en-US.msi.sig",
  "latest.json",
];

describe("pickAssetName", () => {
  it("hands macOS the .dmg, not the updater tarball", () => {
    expect(pickAssetName("mac", RELEASE_ASSETS)).toBe("Curfew.Agent_0.1.1_universal.dmg");
  });

  it("hands Windows the NSIS installer over the MSI", () => {
    expect(pickAssetName("windows", RELEASE_ASSETS)).toBe("Curfew.Agent_0.1.1_x64-setup.exe");
  });

  it("falls back to the MSI when a release carries no .exe", () => {
    const msiOnly = RELEASE_ASSETS.filter((name) => !name.includes("-setup.exe"));
    expect(pickAssetName("windows", msiOnly)).toBe("Curfew.Agent_0.1.1_x64_en-US.msi");
  });

  it("never returns a detached signature", () => {
    // The whole suffix rule in one assertion: a release stripped of everything
    // BUT the signatures resolves to nothing rather than to a .sig.
    const signaturesOnly = RELEASE_ASSETS.filter((name) => name.endsWith(".sig"));
    expect(pickAssetName("mac", signaturesOnly)).toBeNull();
    expect(pickAssetName("windows", signaturesOnly)).toBeNull();
  });

  it("returns null rather than guessing when the platform has no asset", () => {
    expect(pickAssetName("mac", ["latest.json"])).toBeNull();
    expect(pickAssetName("windows", [])).toBeNull();
  });

  it("matches regardless of case", () => {
    expect(pickAssetName("mac", ["Curfew.Agent_9.9.9_universal.DMG"])).toBe(
      "Curfew.Agent_9.9.9_universal.DMG",
    );
  });
});

describe("isAgentPlatform", () => {
  it("accepts exactly the platforms the route serves", () => {
    expect(isAgentPlatform("mac")).toBe(true);
    expect(isAgentPlatform("windows")).toBe(true);
    expect(isAgentPlatform("linux")).toBe(false);
    expect(isAgentPlatform("")).toBe(false);
  });
});

describe("AGENT_DOWNLOADS", () => {
  // A typo here is a 302 to the fallback page for every DJ on that platform —
  // the exact regression /download/[platform] was built to make impossible.
  it("points every entry at a route the download handler answers", () => {
    for (const download of AGENT_DOWNLOADS) {
      expect(download.href).toBe(`/download/${download.platform}`);
      expect(isAgentPlatform(download.platform)).toBe(true);
    }
  });
});
