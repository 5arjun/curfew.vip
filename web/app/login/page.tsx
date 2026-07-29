"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useActionState, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AppleSignInButton } from "../components/auth/AppleSignInButton";
import { BiometricAnchor } from "../components/auth/BiometricAnchor";
import { Button } from "../components/auth/Button";
import { GhostInput } from "../components/auth/GhostInput";
import { GoogleSignInButton } from "../components/auth/GoogleSignInButton";
import { AUTH_FAILURE_COPY } from "./auth-copy";
import { INITIAL_AUTH_STATE, type AuthActionState } from "./auth-state";
import { signIn, signUp } from "./actions";

// Story 2.4: OAuth/passkey render as the prominent top-of-form content
// (AC-5); email+password is collapsed by default behind a disclosure toggle,
// fully functional when expanded. Story 2.3a/b/c's server actions, copy, and
// state shapes are unchanged — this file only changes how they're triggered
// from markup/style.

type Mode = "login" | "signup";

const mainStyle: React.CSSProperties = {
  maxWidth: "var(--container-max)",
  margin: "var(--space-xxl) auto",
  padding: "0 var(--space-lg)",
};

const errorStyle: React.CSSProperties = {
  color: "var(--color-error)",
};

const oauthGroupStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
  marginBottom: "var(--space-lg)",
};

// See web/app/login/page.tsx's own prior comment (kept below on the const):
// Apple can never be enabled in local supabase/config.toml — Sign In with
// Apple hard-requires an HTTPS Return URL, which the local Auth server
// (http://127.0.0.1:54321) can't provide. Apple is configured per-environment
// via the Supabase Dashboard instead, so this flag reads an env var rather
// than being a single hardcoded constant.
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
  const [authStatus, setAuthStatus] = useState<AuthActionState["status"]>("idle");
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [passkeySignedIn, setPasskeySignedIn] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeyPending, setPasskeyPending] = useState(false);
  const [oauthPending, setOauthPending] = useState<"google" | "apple" | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const confirmationFailed = searchParams.get("error") === "confirmation-failed";

  // Task 5.2 (deferred-work.md, 2.3a/2.3b reviews): a stale failure message
  // from one mode/method must not persist across an unrelated interaction.
  // Clearing oauthError/passkeyError happens at the start of every handler
  // below and on mode switch; AuthForm's own useActionState error resets via
  // key={mode} remounting a fresh hook instance on mode change (see AuthForm).
  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setAuthStatus("idle");
    setOauthError(null);
    setPasskeyError(null);
  }

  function clearCrossMethodErrors() {
    setOauthError(null);
    setPasskeyError(null);
  }

  async function handlePasskeySignIn() {
    clearCrossMethodErrors();
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
    clearCrossMethodErrors();
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

  if (authStatus === "signed-in" || passkeySignedIn) {
    return <EnablePasskeyPrompt />;
  }

  if (authStatus === "check-email") {
    return (
      <main style={mainStyle}>
        <p className="text-body-lg">Check your email to confirm your account.</p>
      </main>
    );
  }

  return (
    <main style={mainStyle}>
      <h1 className="text-headline-md" style={{ marginBottom: "var(--space-lg)" }}>
        Sign in to Curfew
      </h1>

      {confirmationFailed && (
        <p className="text-body-md" style={{ ...errorStyle, marginBottom: "var(--space-md)" }} role="alert">
          {AUTH_FAILURE_COPY.generic}
        </p>
      )}

      <div style={oauthGroupStyle}>
        <GoogleSignInButton onClick={() => handleOAuthSignIn("google")} disabled={oauthPending !== null} />
        <AppleSignInButton
          onClick={() => handleOAuthSignIn("apple")}
          disabled={!appleSignInAvailable || oauthPending !== null}
          unavailableReason={appleSignInAvailable ? undefined : "coming soon"}
        />
        <BiometricAnchor
          primaryLabel="Sign in with Passkey"
          secondaryLabel="use an existing passkey"
          onClick={handlePasskeySignIn}
          disabled={passkeyPending}
        />
      </div>

      {(oauthError || passkeyError) && (
        <p className="text-body-md" style={{ ...errorStyle, marginBottom: "var(--space-md)" }} role="alert">
          {oauthError ?? passkeyError}
        </p>
      )}

      <Button
        type="button"
        variant="secondary"
        onClick={() => setShowEmailForm((shown) => !shown)}
        aria-expanded={showEmailForm}
      >
        {showEmailForm ? "Hide email sign-in" : "Use email instead"}
      </Button>

      {showEmailForm && (
        <div style={{ marginTop: "var(--space-lg)" }}>
          <AuthForm
            key={mode}
            mode={mode}
            onStatusChange={setAuthStatus}
            onSubmitStart={clearCrossMethodErrors}
          />
          <Button type="button" variant="secondary" onClick={() => switchMode(mode === "login" ? "signup" : "login")}>
            {mode === "login" ? "Need an account? Sign up" : "Have an account? Log in"}
          </Button>
        </div>
      )}
    </main>
  );
}

function AuthForm({
  mode,
  onStatusChange,
  onSubmitStart,
}: {
  mode: Mode;
  onStatusChange: (status: AuthActionState["status"]) => void;
  onSubmitStart: () => void;
}) {
  const [state, formAction, pending] = useActionState(mode === "login" ? signIn : signUp, INITIAL_AUTH_STATE);

  useEffect(() => {
    onStatusChange(state.status);
  }, [state.status, onStatusChange]);

  return (
    <form action={formAction} onSubmit={onSubmitStart}>
      <GhostInput
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        error={state.fieldErrors?.email}
      />
      <GhostInput
        label="Password"
        name="password"
        type="password"
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        minLength={6}
        required
        error={state.fieldErrors?.password}
      />

      {state.fieldErrors?.form && (
        <p className="text-body-md" style={{ ...errorStyle, marginBottom: "var(--space-md)" }} role="alert">
          {state.fieldErrors.form}
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {mode === "login" ? "Log in" : "Sign up"}
      </Button>
    </form>
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
    <main style={mainStyle}>
      <p className="text-body-lg" style={{ marginBottom: "var(--space-md)" }}>
        You&apos;re signed in.
      </p>

      {!checking && !hasPasskey && !registered && (
        <div style={{ marginBottom: "var(--space-md)" }}>
          <p className="text-body-md" style={{ marginBottom: "var(--space-sm)" }}>
            Add a passkey for faster sign-in next time — optional.
          </p>
          <BiometricAnchor
            primaryLabel={registering ? "Adding passkey…" : "Enable Passkey"}
            secondaryLabel="Biometric bypass"
            onClick={handleRegister}
            disabled={registering}
          />
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
