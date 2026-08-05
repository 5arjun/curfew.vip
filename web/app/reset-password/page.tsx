import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./reset-password-form";

// Set-new-password page (Story 3.10, AC-8 / D-5) — where the recovery link
// from Settings' "Send reset link" actually lands (via /auth/reset). One
// ghost field, one action; on success the DJ is already signed in (a
// recovery session IS a session) and returns to Settings. Server-guarded
// like /phone-required and /link-agent: signed-out visitors (an expired or
// re-used link) go to /login.
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect("/login");
  }

  return (
    <main className="st-main">
      <h1 className="text-headline-md" style={{ marginBottom: "var(--space-lg)" }}>
        Set a new password.
      </h1>

      <ResetPasswordForm />
    </main>
  );
}
