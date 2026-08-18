import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NOINDEX } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./reset-password-form";

// Top-level like /subscription-required, so it inherits no group layout and
// needs its own noindex (launch checklist §1.6). It had no metadata at all
// before this pass, which meant it was also carrying the root layout's title.
export const metadata: Metadata = {
  title: "Curfew — set a new password",
  description: "Set a new password for your Curfew account.",
  ...NOINDEX,
};

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
