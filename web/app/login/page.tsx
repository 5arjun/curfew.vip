"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useActionState, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AUTH_FAILURE_COPY } from "./auth-copy";
import { INITIAL_AUTH_STATE } from "./auth-state";
import { signIn, signUp } from "./actions";

// Functional, token-consuming, unpolished forms (this story's explicit scope —
// the Ghost-input/Biometric-Anchor visual spec is Story 2.4's job).

type Mode = "login" | "signup";

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-xs)",
  marginBottom: "var(--space-md)",
};

const inputStyle: React.CSSProperties = {
  padding: "var(--space-sm)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-outline)",
  background: "var(--color-surface-container)",
  color: "var(--color-on-surface)",
  fontSize: "16px",
};

const errorStyle: React.CSSProperties = {
  color: "var(--color-error)",
};

const buttonStyle: React.CSSProperties = {
  padding: "var(--space-sm) var(--space-md)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-outline)",
  background: "var(--color-surface-container-high)",
  color: "var(--color-on-surface)",
  cursor: "pointer",
};

// Apple can never be enabled in local supabase/config.toml — Sign In with
// Apple hard-requires an HTTPS Return URL, which the local Auth server
// (http://127.0.0.1:54321) can't provide. Apple is configured per-environment
// via the Supabase Dashboard instead (prod: enabled 2026-07-28), so this flag
// reads an env var rather than being a single hardcoded constant. Left
// enabled while the backend provider is actually disabled, clicking redirects
// straight to GoTrue's /authorize, which rejects the disabled provider before
// ever reaching this app's /auth/callback — bypassing the calm failure copy
// below entirely (2026-07-27 review finding) — hence gating per-environment
// rather than always-on.
const appleSignInAvailable = process.env.NEXT_PUBLIC_APPLE_SIGNIN_AVAILABLE === "true";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}

function LoginPageContent() {
  const [mode, setMode] = useState<Mode>("login");
  const [signInState, signInAction, signInPending] = useActionState(signIn, INITIAL_AUTH_STATE);
  const [signUpState, signUpAction, signUpPending] = useActionState(signUp, INITIAL_AUTH_STATE);
  const [passkeySignedIn, setPasskeySignedIn] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeyPending, setPasskeyPending] = useState(false);
  const [oauthPending, setOauthPending] = useState<"google" | "apple" | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const confirmationFailed = searchParams.get("error") === "confirmation-failed";

  const state = mode === "login" ? signInState : signUpState;
  const pending = mode === "login" ? signInPending : signUpPending;

  async function handlePasskeySignIn() {
    setPasskeyError(null);
    setPasskeyPending(true);
    const supabase = createClient();
    try {
      const { error } = await supabase.auth.signInWithPasskey();
      if (error) {
        setPasskeyError(AUTH_FAILURE_COPY.generic);
        return;
      }
      setPasskeySignedIn(true);
    } catch {
      setPasskeyError(AUTH_FAILURE_COPY.generic);
    } finally {
      setPasskeyPending(false);
    }
  }

  // signInWithOAuth triggers a full-page browser redirect to the provider by
  // default — this only ever returns (without navigating away) on an error
  // (e.g. provider misconfigured), matching handlePasskeySignIn's shape.
  async function handleOAuthSignIn(provider: "google" | "apple") {
    setOauthError(null);
    setOauthPending(provider);
    const supabase = createClient();
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) {
        setOauthError(AUTH_FAILURE_COPY.generic);
      }
    } catch {
      setOauthError(AUTH_FAILURE_COPY.generic);
    } finally {
      setOauthPending(null);
    }
  }

  if (state.status === "signed-in" || passkeySignedIn) {
    return <EnablePasskeyPrompt />;
  }

  if (state.status === "check-email") {
    return (
      <main style={{ maxWidth: "var(--container-max)", margin: "var(--space-xxl) auto", padding: "0 var(--space-lg)" }}>
        <p className="text-body-lg">Check your email to confirm your account.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: "var(--container-max)", margin: "var(--space-xxl) auto", padding: "0 var(--space-lg)" }}>
      <h1 className="text-headline-md" style={{ marginBottom: "var(--space-lg)" }}>
        {mode === "login" ? "Log in" : "Sign up"}
      </h1>

      {confirmationFailed && (
        <p
          className="text-body-md"
          style={{ ...errorStyle, marginBottom: "var(--space-md)" }}
          role="alert"
        >
          {AUTH_FAILURE_COPY.generic}
        </p>
      )}

      <form action={mode === "login" ? signInAction : signUpAction}>
        <div style={fieldStyle}>
          <label className="text-label-sm" htmlFor="email">
            Email
          </label>
          <input id="email" name="email" type="email" autoComplete="email" required style={inputStyle} />
          {state.fieldErrors?.email && (
            <p className="text-body-md" style={errorStyle} role="alert">
              {state.fieldErrors.email}
            </p>
          )}
        </div>

        <div style={fieldStyle}>
          <label className="text-label-sm" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={6}
            required
            style={inputStyle}
          />
          {state.fieldErrors?.password && (
            <p className="text-body-md" style={errorStyle} role="alert">
              {state.fieldErrors.password}
            </p>
          )}
        </div>

        {state.fieldErrors?.form && (
          <p className="text-body-md" style={{ ...errorStyle, marginBottom: "var(--space-md)" }} role="alert">
            {state.fieldErrors.form}
          </p>
        )}

        <button type="submit" disabled={pending} style={buttonStyle}>
          {mode === "login" ? "Log in" : "Sign up"}
        </button>
      </form>

      <div style={{ marginTop: "var(--space-lg)" }}>
        <button type="button" onClick={handlePasskeySignIn} disabled={passkeyPending} style={buttonStyle}>
          Sign in with Passkey
        </button>
        {passkeyError && (
          <p className="text-body-md" style={{ ...errorStyle, marginTop: "var(--space-sm)" }} role="alert">
            {passkeyError}
          </p>
        )}
      </div>

      <div style={{ marginTop: "var(--space-lg)", display: "flex", gap: "var(--space-sm)" }}>
        <button
          type="button"
          onClick={() => handleOAuthSignIn("google")}
          disabled={oauthPending !== null}
          style={buttonStyle}
        >
          Sign in with Google
        </button>
        <button
          type="button"
          onClick={() => handleOAuthSignIn("apple")}
          disabled={!appleSignInAvailable || oauthPending !== null}
          style={buttonStyle}
          title={appleSignInAvailable ? undefined : "Apple sign-in isn't configured yet"}
        >
          Sign in with Apple{!appleSignInAvailable && " (coming soon)"}
        </button>
      </div>
      {oauthError && (
        <p className="text-body-md" style={{ ...errorStyle, marginTop: "var(--space-sm)" }} role="alert">
          {oauthError}
        </p>
      )}

      <button
        type="button"
        onClick={() => setMode(mode === "login" ? "signup" : "login")}
        style={{ ...buttonStyle, marginTop: "var(--space-lg)", background: "none" }}
      >
        {mode === "login" ? "Need an account? Sign up" : "Have an account? Log in"}
      </button>
    </main>
  );
}

function EnablePasskeyPrompt() {
  const [checking, setChecking] = useState(true);
  const [hasPasskey, setHasPasskey] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.auth.passkey
      .list()
      .then(({ data }) => {
        if (cancelled) return;
        setHasPasskey((data?.length ?? 0) > 0);
      })
      .catch(() => {
        // Leave hasPasskey at its default (false) — the "Enable Passkey" CTA
        // still renders, which is the safe direction to fail in (skippable,
        // never blocking per UX-DR20).
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleRegister() {
    setError(null);
    setRegistering(true);
    const supabase = createClient();
    try {
      // registerPasskey() requires an existing session — it structurally
      // cannot create a separate identity, only add on to the signed-in
      // account (AC-2).
      const { error } = await supabase.auth.registerPasskey();
      if (error) {
        setError(AUTH_FAILURE_COPY.generic);
        return;
      }
      setRegistered(true);
    } catch {
      setError(AUTH_FAILURE_COPY.generic);
    } finally {
      setRegistering(false);
    }
  }

  return (
    <main style={{ maxWidth: "var(--container-max)", margin: "var(--space-xxl) auto", padding: "0 var(--space-lg)" }}>
      <p className="text-body-lg" style={{ marginBottom: "var(--space-md)" }}>
        You&apos;re signed in.
      </p>

      {!checking && !hasPasskey && !registered && (
        <div style={{ marginBottom: "var(--space-md)" }}>
          <p className="text-body-md" style={{ marginBottom: "var(--space-sm)" }}>
            Add a passkey for faster sign-in next time — optional.
          </p>
          <button type="button" onClick={handleRegister} disabled={registering} style={buttonStyle}>
            {registering ? "Adding passkey…" : "Enable Passkey"}
          </button>
          {error && (
            <p className="text-body-md" style={{ ...errorStyle, marginTop: "var(--space-sm)" }} role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      {registered && (
        <p className="text-body-md" style={{ marginBottom: "var(--space-md)" }}>
          Passkey added.
        </p>
      )}

      <Link href="/" className="text-body-md">
        Continue to Curfew
      </Link>
    </main>
  );
}
