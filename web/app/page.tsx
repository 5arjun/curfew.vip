import { CONTRACT_VERSION, VISIBILITY, type SyncPayload } from "@curfew/shared";

// Proves web/ consumes @curfew/shared: a runtime import (CONTRACT_VERSION, VISIBILITY)
// plus a type-only import (SyncPayload). Server Component (default) => rendered
// on the server, reinforcing that web/ keeps SSR (no static export).
const contractSource: SyncPayload["source"] = "serato";

export default function Home() {
  return (
    <main
      style={{
        maxWidth: "var(--container-max)",
        margin: "var(--space-xxl) auto",
        padding: `0 var(--space-lg)`,
        lineHeight: 1.6,
      }}
    >
      <h1 className="text-display-lg" style={{ marginBottom: "var(--space-sm)" }}>
        Curfew
      </h1>
      <p className="text-body-lg">DJ reflection platform — web app scaffold.</p>
      <p
        className="text-mono-data"
        style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-sm)" }}
      >
        Sync contract v{CONTRACT_VERSION} (frozen) · source: {contractSource} · visibility
        options: {VISIBILITY.join(", ")}
      </p>
    </main>
  );
}
