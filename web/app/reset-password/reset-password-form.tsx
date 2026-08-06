"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { GhostInput } from "@/app/components/auth/GhostInput";
import { Button } from "@/app/components/auth/Button";
import { updatePassword } from "@/lib/account/actions";

// The single new-password field (D-5: no old/new pair — the recovery link
// already proved control of the inbox). Minimum length mirrors the signup
// form's floor; failure copy stays inline and calm.
export function ResetPasswordForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    const result = await updatePassword(password).catch(
      () => ({ ok: false, error: "Password not changed — try again." }) as const,
    );
    if (result.ok) {
      // Back into the app: Settings is where the reset began, and for a DJ
      // arriving from the email it is the account home either way.
      router.push("/settings");
      return;
    }
    setPending(false);
    setError(result.error);
  }

  return (
    <form onSubmit={handleSubmit} className="st-reset-form">
      <GhostInput
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={6}
        required
        error={error ?? undefined}
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Set password"}
      </Button>
    </form>
  );
}
