// Failure Register strings (EXPERIENCE.md, "Login failed, wrong password" /
// "Signup blocked, email already registered" rows) — quoted verbatim, not
// paraphrased (UX-DR18/19). `generic` covers auth failures the register
// doesn't name a specific line for, kept in the same calm, no-exclamation-point
// register.
export const AUTH_FAILURE_COPY = {
  wrongPassword: "Credentials not recognized. Try again.",
  emailAlreadyRegistered: "Account already archived. Log in instead.",
  emailNotConfirmed: "Check your email to confirm your account first.",
  generic: "Something went sideways. Try again.",
} as const;

type SignInErrorShape = { code?: string | null; message: string };

// Supabase's auth-js: wrong password surfaces as error.code === "invalid_credentials"
// (message "Invalid login credentials"). Checking the message as a fallback in
// case an older/newer client surfaces only one of the two (verified against
// supabase/auth-js source, 2026-07-26).
//
// A login attempt against a signed-up-but-not-yet-confirmed email surfaces as
// error.code === "email_not_confirmed" — a likely path given this story's own
// confirmation gate (Task 1.1). Added per code-review decision, 2026-07-27:
// no EXPERIENCE.md Failure Register line covers this case, so this copy is
// new (not sourced from the register), matching the check-email state's tone.
export function mapSignInError(error: SignInErrorShape): string {
  if (error.code === "invalid_credentials" || error.message === "Invalid login credentials") {
    return AUTH_FAILURE_COPY.wrongPassword;
  }
  if (error.code === "email_not_confirmed") {
    return AUTH_FAILURE_COPY.emailNotConfirmed;
  }
  return AUTH_FAILURE_COPY.generic;
}

type SignUpUserShape = { identities?: unknown[] | null } | null | undefined;

// Supabase's GoTrue server has two different "already registered" signals,
// verified directly against the running local stack (2026-07-26):
// - Existing but UNCONFIRMED email: signUp() returns HTTP 200 with a
//   sanitized user whose `identities` array is forced empty (anti-enumeration
//   — see supabase/auth signup.go's sanitizeUser). No `error` at all. A
//   genuinely new signup always has at least one ("email") identity.
// - Existing and CONFIRMED email: signUp() returns an actual error,
//   HTTP 422 `user_already_exists` / "User already registered" — confirmed
//   by a direct call against the local Auth API, not assumed from docs.
export function isAlreadyRegisteredSignUp(user: SignUpUserShape): boolean {
  return Array.isArray(user?.identities) && user.identities.length === 0;
}

export function isAlreadyRegisteredSignUpError(error: SignInErrorShape): boolean {
  return error.code === "user_already_exists" || error.message === "User already registered";
}
