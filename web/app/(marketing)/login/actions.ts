"use server";

import { headers } from "next/headers";
import { checkBotId } from "botid/server";
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

// Both credential actions run this before touching Supabase, so a bot costs us
// nothing downstream. It returns the ordinary `generic` failure rather than a
// distinct "bot detected" line on purpose: the Failure Register has no line for
// this, and an honest one would tell a scripted attacker exactly what tripped.
// The client half is registered in instrumentation-client.ts — the two must stay
// in sync or the challenge is issued and never read.
//
// checkBotId() reports HUMAN in local dev, so this does not gate `pnpm dev`.
async function botRejection(): Promise<AuthActionState | null> {
  const { isBot } = await checkBotId();
  if (!isBot) return null;
  return { status: "error", fieldErrors: { form: AUTH_FAILURE_COPY.generic } };
}

export async function signUp(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const rejected = await botRejection();
  if (rejected) return rejected;

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
  const rejected = await botRejection();
  if (rejected) return rejected;

  const { email, password } = readCredentials(formData);
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { status: "error", fieldErrors: { password: mapSignInError(error) } };
  }

  return { status: "signed-in" };
}
