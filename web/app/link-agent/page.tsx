import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LinkHandoff } from "./link-handoff";

// Server-guarded exactly like `phone-required/page.tsx`: redirect to plain
// `/login` on signed-out (no `next`/return-path param support exists yet —
// the DJ clicks back to `/link-agent` manually after signing in, same
// documented limitation that page's own comment carries). No phone-gate
// check needed here (unrelated to Story 2.3c's concern).
export default async function LinkAgentPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect("/login");
  }

  return (
    <main
      style={{ maxWidth: "var(--container-max)", margin: "var(--space-xxl) auto", padding: "0 var(--space-lg)" }}
    >
      <h1 className="text-headline-md" style={{ marginBottom: "var(--space-lg)" }}>
        Link Curfew Agent
      </h1>

      <LinkHandoff />
    </main>
  );
}
