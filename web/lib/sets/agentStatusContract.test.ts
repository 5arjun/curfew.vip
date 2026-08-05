import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_SYNC_STATES, STALE_AFTER_MS } from "./agentStatus";

// Cross-language contract guard (Story 3.9 code review). The six-state wire
// contract is duplicated by hand across three languages — Rust
// `TrayState::wire_state()` (the writer), the SQL allow-list inside
// `set_agent_status` (the gate), and `AGENT_SYNC_STATES` here (the reader) —
// each with its own self-referential test, but nothing that previously
// caught a spelling drift *between* them. Same story for `STALE_AFTER_MS`
// (web) vs. `MAX_INTERVAL` (Rust): nothing failed if one was retuned without
// the other. This test reads the other two languages' source files as text
// (mirroring the static-analysis pattern already used by
// `web/app/no-hardcoded-colors.test.ts`) so a drift fails CI instead of
// shipping silently.

const REPO_ROOT = join(__dirname, "..", "..", "..");
const TRAY_RS = join(REPO_ROOT, "agent", "src-tauri", "src", "tray.rs");
const SYNC_QUEUE_RS = join(REPO_ROOT, "agent", "src-tauri", "src", "sync_queue.rs");
// Story 3.10 replaced the function's signature (added `agent_version`), so
// the LIVE allow-list is the re-created function in the 3.10 migration —
// the 3.9 file's copy was dropped along with the old signature.
const AGENT_STATUS_SQL = join(
  REPO_ROOT,
  "supabase",
  "migrations",
  "20260806090100_add_agent_status_agent_version.sql",
);

function rustWireStates(): string[] {
  const source = readFileSync(TRAY_RS, "utf-8");
  const fn = source.match(/pub fn wire_state\(self\) -> &'static str \{([\s\S]*?)\n {4}\}/);
  if (!fn) throw new Error("could not locate TrayState::wire_state() in tray.rs");
  return [...fn[1].matchAll(/=>\s*"([^"]+)"/g)].map((m) => m[1]);
}

function sqlAllowedStates(): string[] {
  const source = readFileSync(AGENT_STATUS_SQL, "utf-8");
  const list = source.match(/requested_state not in \(([\s\S]*?)\)/);
  if (!list) throw new Error("could not locate the allow-list in set_agent_status's SQL body");
  return [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function rustMaxIntervalMs(): number {
  const source = readFileSync(SYNC_QUEUE_RS, "utf-8");
  const constant = source.match(
    /const MAX_INTERVAL: Duration = Duration::from_secs\((\d+)\);/,
  );
  if (!constant) throw new Error("could not locate MAX_INTERVAL in sync_queue.rs");
  return Number(constant[1]) * 1000;
}

describe("agent-status wire contract stays in sync across Rust/SQL/TS", () => {
  it("Rust TrayState::wire_state() matches AGENT_SYNC_STATES exactly", () => {
    expect(new Set(rustWireStates())).toEqual(new Set(AGENT_SYNC_STATES));
    expect(rustWireStates()).toHaveLength(AGENT_SYNC_STATES.length);
  });

  it("the SQL allow-list in set_agent_status matches AGENT_SYNC_STATES exactly", () => {
    expect(new Set(sqlAllowedStates())).toEqual(new Set(AGENT_SYNC_STATES));
    expect(sqlAllowedStates()).toHaveLength(AGENT_SYNC_STATES.length);
  });

  it("STALE_AFTER_MS stays 2x the agent's MAX_INTERVAL", () => {
    expect(STALE_AFTER_MS).toBe(2 * rustMaxIntervalMs());
  });
});
