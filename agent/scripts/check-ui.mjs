// Minimal "build"/"lint"/"typecheck" for the agent workspace.
// The tray/settings surface is a committed static asset (UX-DR23: native + minimal,
// not a full web UI), so there is no bundler step. This just asserts the surface
// Tauri embeds (frontendDist = ../ui) actually exists, giving the pnpm workspace a
// real, fast task and keeping CI's "build each workspace" honest.
import { accessSync, constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const uiEntry = resolve(dirname(fileURLToPath(import.meta.url)), "..", "ui", "index.html");

try {
  accessSync(uiEntry, constants.R_OK);
  console.log(`agent: static tray surface present at ${uiEntry}`);
} catch {
  console.error(`agent: missing tray surface at ${uiEntry} (tauri.conf frontendDist points here)`);
  process.exit(1);
}
