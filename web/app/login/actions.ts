"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  AUTH_FAILURE_COPY,
  isAlreadyRegisteredSignUp,
  isAlreadyRegisteredSignUpError,
  mapSignInError,
} from "./auth-copy";
import type { AuthActionState } from "./auth-state";

function readCredentials(formData: FormData) {
  return {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  };
}

export async function signUp(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const { email, password } = readCredentials(formData);
  const supabase = await createClient();
  // Server Actions run as same-origin POSTs, so the browser-sent Origin header
  // reflects the real dev/prod host; localhost:3000 fallback matches this
  // story's config.toml site_url decision (Task 1.4).
  const origin = (await headers()).get("origin") ?? "http://localhost:3000";

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/confirm` },
  });

  if (error) {
    if (isAlreadyRegisteredSignUpError(error)) {
      return { status: "error", fieldErrors: { email: AUTH_FAILURE_COPY.emailAlreadyRegistered } };
    }
    return { status: "error", fieldErrors: { form: AUTH_FAILURE_COPY.generic } };
  }

  if (isAlreadyRegisteredSignUp(data.user)) {
    return { status: "error", fieldErrors: { email: AUTH_FAILURE_COPY.emailAlreadyRegistered } };
  }

  // Expected once Task 1.1's confirmation gate is on: no usable session until confirmed.
  if (data.session === null) {
    return { status: "check-email" };
  }

  return { status: "signed-in" };
}

export async function signIn(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const { email, password } = readCredentials(formData);
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { status: "error", fieldErrors: { password: mapSignInError(error) } };
  }

  return { status: "signed-in" };
}
