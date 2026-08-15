"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AUTH_FAILURE_COPY } from "@/app/(marketing)/login/auth-copy";
import { isValidPhone } from "./phone-validation";
import type { PhoneActionState } from "./phone-state";

export async function setPhone(
  _prevState: PhoneActionState,
  formData: FormData,
): Promise<PhoneActionState> {
  const phone = String(formData.get("phone") ?? "").trim();

  if (!phone) {
    return { status: "error", error: "Enter a phone number." };
  }

  if (!isValidPhone(phone)) {
    return { status: "error", error: "Enter a valid phone number." };
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
      // .select("id") makes a zero-row update (e.g. no matching djs row)
      // distinguishable from a real success — a bare .update() with no
      // .select() reports no error either way.
      const { data: updated, error } = await supabase
        .from("djs")
        .update({ phone })
        .eq("id", data.user.id)
        .select("id");
      succeeded = !error && (updated?.length ?? 0) > 0;
    }
  } catch {
    succeeded = false;
  }

  if (succeeded) {
    // Step 2 of the setup corridor: the account is contactable, the archive
    // is still empty — /welcome is where the agent gets introduced (UJ-3
    // step 3, the "the account alone can't do anything yet" prompt).
    redirect("/welcome");
  }

  return { status: "error", error: AUTH_FAILURE_COPY.generic };
}
