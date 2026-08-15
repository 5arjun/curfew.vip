"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AppleSignInButton } from "@/app/components/auth/AppleSignInButton";
import { BiometricAnchor } from "@/app/components/auth/BiometricAnchor";
import { Button } from "@/app/components/auth/Button";
import { GhostInput } from "@/app/components/auth/GhostInput";
import { GoogleSignInButton } from "@/app/components/auth/GoogleSignInButton";
import { useInView } from "@/app/components/landing/Beats";
import { AUTH_FAILURE_COPY } from "./auth-copy";
import { INITIAL_AUTH_STATE, type AuthActionState } from "./auth-state";
import { signIn, signUp } from "./actions";

// Story 2.4 gave this page its behavior: OAuth/passkey prominent (AC-5),
// email+password behind a disclosure, server actions from 2.3a/b/c. All of
// that survives here verbatim — same handlers, same state shapes, same
// aria wiring (the e2e pass clicks button[aria-controls="auth-email-form-panel"]).
//
// What changed (Arjun, 2026-08-15): the page joined the marketing shell and
// the signup side now has to EARN the account — "very convincing that a DJ
// should be paying for this product, just like any other purchasing page."
// So signup mode runs two columns: the pitch (what the plan buys, the price
// set large, the assurances) beside the card (the checkout form). Login mode
// collapses the pitch and centres the card. The landing's close shows only
// the yearly rate on purpose; the month-to-month price lives here (Beats.tsx
// records that split).

type Mode = "login" | "signup";

// See web/app/(marketing)/login's own prior comment: Apple can never be
// enabled in local supabase/config.toml — Sign In with Apple hard-requires an
// HTTPS Return URL, which the local Auth server can't provide. Configured
// per-environment via the Supabase Dashboard, so this reads an env var.
const appleSignInAvailable = process.env.NEXT_PUBLIC_APPLE_SIGNIN_AVAILABLE === "true";

// What the plan buys, in the landing's own words — these rows are the sell,
// so they stay claims about nights and records, never feature-matrix rows.
const PITCH_FACTS = [
  "Every set files itself the night you play it — no export, no ritual",
  "The full tracklist against the clock, the night’s arc, the real dancefloor",
  "Your drift over months — genres, keys, tempo — against no one but you",
  "Your library: what you own against what you actually play",
];

const PITCH_ASSURANCES = [
  "Cancel whenever",
  "Music files never leave your laptop",
  "Export or delete on request",
  "Never ranked against another DJ",
];

export function LoginClient() {
  const searchParams = useSearchParams();
  // The Landing's "Join" and "Start your archive" land here rather than on a
  // separate signup route — one auth surface, opened on the right side of its
  // own toggle. Read once, as the initial state, so the toggle below still
  // owns the mode afterwards: a reader who arrives via Join and decides they
  // already have an account must not be snapped back to signup on re-render.
  const [mode, setMode] = useState<Mode>(
    searchParams.get("intent") === "join" ? "signup" : "login",
  );
  const [authStatus, setAuthStatus] = useState<AuthActionState["status"]>("idle");
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [passkeySignedIn, setPasskeySignedIn] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeyPending, setPasskeyPending] = useState(false);
  const [oauthPending, setOauthPending] = useState<"google" | "apple" | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  // OAuth (full-page redirect) and passkey (WebAuthn ceremony) are mutually
  // exclusive in-flight — without this, a user could trigger both in the
  // window before the OAuth redirect navigates away.
  const authMethodPending = passkeyPending || oauthPending !== null;
  const confirmationFailed = searchParams.get("error") === "confirmation-failed";
  const [shellRef, shellShown] = useInView<HTMLDivElement>(0.1);

  // Task 5.2 (deferred-work.md, 2.3a/2.3b reviews): a stale failure message
  // from one mode/method must not persist across an unrelated interaction.
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
  // default — this only ever returns (without navigating away) on an error.
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
      <main className="lp-main lp-auth lp-auth--solo">
        <div className="lp-auth-card" data-shown="true">
          <h1 className="lp-auth-title">One email to go.</h1>
          <p className="lp-body lp-auth-tag">
            Check your email to confirm your account. The link brings you straight back.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="lp-main lp-auth" data-mode={mode}>
      <div className="lp-auth-grid" ref={shellRef} data-shown={shellShown ? "true" : "false"}>
        {/* Card before pitch in the DOM — the h1 leads the outline and a
            keyboard lands on the form first; the pitch takes the left column
            through `order` at two-column widths (landing.css). */}
        <section className="lp-auth-card">
          <h1 className="lp-auth-title">
            {mode === "signup" ? "Start your archive." : "Welcome back."}
          </h1>
          <p className="lp-body lp-auth-tag">
            {mode === "signup"
              ? "Create the account tonight’s set will land in."
              : "Sign in — the archive is where you left it."}
          </p>

          {confirmationFailed && (
            <p className="lp-auth-error" role="alert">
              {AUTH_FAILURE_COPY.generic}
            </p>
          )}

          <div className="lp-auth-providers">
            <GoogleSignInButton
              onClick={() => handleOAuthSignIn("google")}
              disabled={authMethodPending}
            />
            <AppleSignInButton
              onClick={() => handleOAuthSignIn("apple")}
              disabled={!appleSignInAvailable || authMethodPending}
              unavailableReason={appleSignInAvailable ? undefined : "coming soon"}
            />
            <BiometricAnchor
              primaryLabel="Sign in with Passkey"
              secondaryLabel="use an existing passkey"
              onClick={handlePasskeySignIn}
              disabled={authMethodPending}
            />
          </div>

          {(oauthError || passkeyError) && (
            <p className="lp-auth-error" role="alert">
              {oauthError ?? passkeyError}
            </p>
          )}

          <div className="lp-auth-or" aria-hidden="true">
            or
          </div>

          <button
            type="button"
            className="lp-auth-alt"
            onClick={() => setShowEmailForm((shown) => !shown)}
            aria-expanded={showEmailForm}
            aria-controls="auth-email-form-panel"
          >
            {showEmailForm ? "Hide email sign-in" : "Use email instead"}
            <span
              className="lp-auth-alt-mark"
              data-open={showEmailForm ? "true" : "false"}
              aria-hidden="true"
            />
          </button>

          {/* Mounted at all times (the original page's `hidden` discipline —
              collapsing mid-submit must never discard typed input or an
              in-flight result), but collapsed by state so it can animate.
              `inert` keeps the closed panel out of the tab order the way
              `hidden` did. */}
          <div
            id="auth-email-form-panel"
            className="lp-auth-email"
            data-open={showEmailForm ? "true" : "false"}
            inert={!showEmailForm}
          >
            <div className="lp-auth-email-inner">
              <AuthForm
                key={mode}
                mode={mode}
                onStatusChange={setAuthStatus}
                onSubmitStart={clearCrossMethodErrors}
              />
            </div>
          </div>

          <p className="lp-auth-switch">
            {mode === "login" ? (
              <>
                New here?{" "}
                <button type="button" onClick={() => switchMode("signup")}>
                  Start your archive
                </button>
              </>
            ) : (
              <>
                Already archiving?{" "}
                <button type="button" onClick={() => switchMode("login")}>
                  Log in
                </button>
              </>
            )}
          </p>

          {mode === "signup" && (
            <p className="lp-auth-fineprint">
              One plan. $6.99/month billed yearly, or $7.99 month to month. Cancel whenever.
            </p>
          )}
        </section>

        {/* The pitch stays mounted in login mode — collapsed, faded and inert
            — so switching modes is one liquid move rather than a relayout. */}
        <section className="lp-auth-pitch" inert={mode === "login"}>
          <div className="lp-auth-pitch-inner">
            <p className="lp-feat-eyebrow">Join Curfew</p>
            <h2 className="lp-auth-claim">Every night you play, kept.</h2>
            <p className="lp-sub lp-auth-sub">
              Curfew reads the sets you already played and gives you the only baseline that means
              anything: your own. Here is what the plan buys, all of it, for every DJ on it.
            </p>
            <ul className="lp-feat-facts lp-auth-facts">
              {PITCH_FACTS.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
            <div className="lp-auth-plan">
              <p className="lp-feat-eyebrow lp-auth-plan-eyebrow">One plan — everything in it</p>
              <p className="lp-auth-price">
                $6.99<span>/month</span>
              </p>
              <p className="lp-auth-plan-terms">Billed yearly — or $7.99 month to month.</p>
            </div>
            <ul className="lp-feat-chips lp-auth-chips" aria-label="What you can count on">
              {PITCH_ASSURANCES.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </section>
      </div>
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
  const [state, formAction, pending] = useActionState(
    mode === "login" ? signIn : signUp,
    INITIAL_AUTH_STATE,
  );

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
        <p className="lp-auth-error" role="alert">
          {state.fieldErrors.form}
        </p>
      )}

      <Button type="submit" disabled={pending} className="lp-auth-submit">
        {pending
          ? mode === "login"
            ? "Logging in…"
            : "Creating account…"
          : mode === "login"
            ? "Log in"
            : "Create account"}
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
    <main className="lp-main lp-auth lp-auth--solo">
      <div className="lp-auth-card" data-shown="true">
        <h1 className="lp-auth-title">You&apos;re signed in.</h1>

        {!checking && !hasPasskey && !registered && (
          <div className="lp-auth-passkey">
            <p className="lp-body lp-auth-tag">
              Add a passkey for faster sign-in next time — optional.
            </p>
            <BiometricAnchor
              primaryLabel={registering ? "Adding passkey…" : "Enable Passkey"}
              secondaryLabel="Biometric bypass"
              onClick={handleRegister}
              disabled={registering}
            />
            {error && (
              <p className="lp-auth-error" role="alert">
                {error}
              </p>
            )}
          </div>
        )}

        {registered && <p className="lp-body lp-auth-tag">Passkey added.</p>}

        <Link href="/" className="lp-auth-continue">
          Continue to Curfew
        </Link>
      </div>
    </main>
  );
}
