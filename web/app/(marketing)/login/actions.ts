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

type CredentialAction = "sign-in" | "sign-up";

// Both credential actions run this before touching Supabase, so a bot costs us
// nothing downstream. Signup still refuses on a bot verdict, and does it with
// the ordinary `generic` failure rather than a distinct "bot detected" line on
// purpose: the Failure Register has no line for this, and an honest one would
// tell a scripted attacker exactly what tripped.
// The client half is registered in instrumentation-client.ts — the two must stay
// in sync or the challenge is issued and never read.
//
// Off Vercel there is no BotID infrastructure to consult, and the two
// off-platform modes fail DIFFERENTLY: under `next dev`, checkBotId() reports
// HUMAN and everything works, but under a local production build
// (`next build && next start`) it THROWS "Must be deployed on Vercel to set
// response headers" — which made every local prod-build sign-in a blank 500.
// That is the exact configuration the repo's own browser-verification recipe
// calls for, so the breakage was invisible in dev and total in the one mode
// used to check work before shipping.
//
// Skipping off-platform cannot weaken production: Vercel always sets VERCEL=1
// in its runtime, so the check still runs on every deploy. Deliberately NOT a
// try/catch — swallowing the throw would also hide a genuine BotID
// misconfiguration in production, where it should stay loud.
async function botRejection(action: CredentialAction): Promise<AuthActionState | null> {
  if (!process.env.VERCEL) return null;

  const { isBot } = await checkBotId();
  if (!isBot) return null;

  // Record the verdict before acting on it. Until 2026-08-18 this branch
  // returned `generic` and wrote nothing at all, which made a false positive
  // undiagnosable from either side: the DJ saw the same line a wrong password
  // produces, and because the rejection happens BEFORE the Supabase call, the
  // attempt left no trace in the auth logs either — no failed login, no 4xx,
  // no rate-limit row. Arjun hit exactly this on admin@curfew.vip and the only
  // way to find it was to notice that Supabase had logged *zero* password
  // attempts while the form kept failing. Deliberately no email in the line:
  // the address is the one thing here worth keeping out of a log.
  console.warn(`[auth] BotID returned a bot verdict for ${action}`);

  // Signup refuses; sign-in does not (Arjun's ruling, 2026-08-18). The two
  // false positives are not symmetrical. On signup it costs one account that
  // was never created, and the person can try again from anywhere. On sign-in
  // it locks an already-paying DJ out of an archive they own, behind copy that
  // gives them nothing to act on — and the check runs on the credential form
  // of a product whose whole promise is that the archive is still there.
  //
  // Credential stuffing is still answered on this path, by Supabase Auth's own
  // per-IP rate limiting on /token. That was always the second layer; the hard
  // block in front of it was shadowing it rather than adding to it, since a
  // request rejected here never reaches the limiter to be counted at all.
  if (action === "sign-in") return null;

  return { status: "error", fieldErrors: { form: AUTH_FAILURE_COPY.generic } };
}

export async function signUp(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const rejected = await botRejection("sign-up");
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
  const rejected = await botRejection("sign-in");
  if (rejected) return rejected;

  const { email, password } = readCredentials(formData);
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { status: "error", fieldErrors: { password: mapSignInError(error) } };
  }

  return { status: "signed-in" };
}
