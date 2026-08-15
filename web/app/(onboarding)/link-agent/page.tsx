import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LinkHandoff } from "./link-handoff";

// Server-guarded exactly like `phone-required/page.tsx`: redirect to plain
// `/login` on signed-out (no `next`/return-path param support exists yet —
// the DJ clicks back to `/link-agent` manually after signing in, same
// documented limitation that page's own comment carries). No phone-gate
// check needed here (unrelated to Story 2.3c's concern).
//
// Onboarding pass (2026-08-15): joined the (onboarding) shell — same URL
// (the route group doesn't change the path, so phone-gate.ts's
// GATED_PREFIXES entry for /link-agent still matches), now the ember room
// and the auth card instead of a bare <main>.
export default async function LinkAgentPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect("/login");
  }

  return (
    <main className="lp-main lp-auth lp-auth--solo lp-auth--ob">
      <div className="lp-auth-card" data-shown="true">
        <p className="lp-feat-eyebrow">Curfew Agent</p>
        <h1 className="lp-auth-title">Linking the agent.</h1>

        <LinkHandoff />
      </div>
    </main>
  );
}
