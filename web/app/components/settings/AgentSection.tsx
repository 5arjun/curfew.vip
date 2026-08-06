import Link from "next/link";
import type { AgentStatusSnapshot } from "@/lib/sets/agentStatus";
import { settingsAgentLine } from "./agent-status-copy";

// Agent section (Story 3.10, AC-11..13, D-10): what's actually true today —
// a status line that ALWAYS speaks (unlike the dashboard's silence-first
// banner), the beating agent's version, and the Link-agent entry that gives
// the orphaned /link-agent route its first in-app path. No device row, no
// unlink (no server-side device record exists to revoke). Server-rendered
// snapshot, no polling — a settings screen is read on arrival, and the
// resolver reuse means this can never disagree with the dashboard about
// what the agent said.

export function AgentSection({ snapshot }: { snapshot: AgentStatusSnapshot }) {
  const line = settingsAgentLine(snapshot);
  // Gated on the line's kind, not just the row: a clock-skewed (future-
  // stamped) beat carries a version while the status honestly says "No
  // agent linked" — a Version row two lines under that would contradict it
  // (AC-3's "nothing true to say" rule).
  const agentVersion = line.kind === "none" ? null : (snapshot.row?.agent_version ?? null);

  return (
    <section className="st-card dz-shell" aria-labelledby="st-agent-label">
      <h2 id="st-agent-label" className="st-section-label">
        Agent
      </h2>
      <div className="st-row">
        <span className="st-row-label">Status</span>
        <span className="st-row-value">{line.text}</span>
      </div>
      {agentVersion && (
        <div className="st-row">
          <span className="st-row-label">Version</span>
          <span className="st-row-value text-mono-data">{agentVersion}</span>
        </div>
      )}
      {/* No label on purpose: D-10 rules out a device row, so this is an
          action line, not a fact line — matching the spec's anatomy where
          [ Link agent ] stands alone under the facts. */}
      <div className="st-row">
        <span className="st-row-label" aria-hidden="true" />
        <Link href="/link-agent" className="st-action">
          Link agent
        </Link>
      </div>
    </section>
  );
}
