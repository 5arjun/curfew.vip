import { CONTRACT_VERSION, VISIBILITY, type SyncPayloadDraft } from "@curfew/shared";

// Proves web/ consumes @curfew/shared: a runtime import (CONTRACT_VERSION, VISIBILITY)
// plus a type-only import (SyncPayloadDraft). Server Component (default) => rendered
// on the server, reinforcing that web/ keeps SSR (no static export).
const draftContractSource: SyncPayloadDraft["source"] = "serato";

export default function Home() {
  return (
    <main style={{ maxWidth: "32rem", margin: "4rem auto", padding: "0 1.5rem", lineHeight: 1.6 }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Curfew</h1>
      <p>DJ reflection platform — web app scaffold.</p>
      <p style={{ opacity: 0.7, fontSize: "0.9rem" }}>
        Sync contract v{CONTRACT_VERSION} (draft) · source: {draftContractSource} · visibility
        options: {VISIBILITY.join(", ")}
      </p>
    </main>
  );
}
