"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AUTH_FAILURE_COPY } from "@/app/login/auth-copy";

// Local to this file, not auth-state.ts's AuthActionState — that type's
// fieldErrors shape (email/password/form) belongs to the login/signup form,
// not this one-field page (Story 2.3c Task 4.1).
type PhoneActionState = {
  status: "idle" | "error";
  error?: string;
};

export async function setPhone(
  _prevState: PhoneActionState,
  formData: FormData,
): Promise<PhoneActionState> {
  const phone = String(formData.get("phone") ?? "").trim();

  if (!phone) {
    return { status: "error", error: "Enter a phone number." };
  }

  const supabase = await createClient();

  // Supabase calls are caught (not the redirect() below — redirect() works
  // by throwing, so it must stay outside this block or its own throw would
  // be swallowed here) so a network hiccup returns a calm form error instead
  // of surfacing a raw 500. Same discipline as auth/callback and
  // auth/confirm's route handlers.
  let succeeded = false;
  try {
    const { data, error: userError } = await supabase.auth.getUser();
    if (!userError && data.user) {
      const { error } = await supabase.from("djs").update({ phone }).eq("id", data.user.id);
      succeeded = !error;
    }
  } catch {
    succeeded = false;
  }

  if (succeeded) {
    redirect("/");
  }

  return { status: "error", error: AUTH_FAILURE_COPY.generic };
}
