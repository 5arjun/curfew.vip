import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { needsPhone } from "@/lib/supabase/phone-gate";
import { PhoneForm } from "./phone-form";

// Server-guarded (Task 3.2 explicitly allows this) so the redirect for a
// signed-out or already-phone-on-file visitor happens before any markup
// ships, matching the server-side gating both auth routes already use — no
// blank-page flash, no dependency on client JS running successfully.
// Not skippable per EXPERIENCE.md's State Patterns "Phone number required"
// row — no cancel/skip control anywhere on this page.
export default async function PhoneRequiredPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect("/login");
  }

  if (!(await needsPhone(supabase, data.user.id))) {
    redirect("/");
  }

  return (
    <main style={{ maxWidth: "var(--container-max)", margin: "var(--space-xxl) auto", padding: "0 var(--space-lg)" }}>
      <h1 className="text-headline-md" style={{ marginBottom: "var(--space-lg)" }}>
        Add a phone number.
      </h1>

      <PhoneForm />
    </main>
  );
}
