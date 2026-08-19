"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AppleSignInButton } from "@/app/components/auth/AppleSignInButton";
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
  "Every set files itself the night you play it: no export, no ritual",
  "The full tracklist against the clock, the night’s arc, the real dancefloor",
  "Watch your sound move month by month: genres, keys, tempo",
  "Your library: what you own against what you actually play",
];

export function LoginClient() {
  const searchParams = useSearchParams();
  // The Landing's "Join" and "Start your archive" land here rather than on a
  // separate signup route — one auth surface, opened on the right side of its
  // own toggle. Initial state comes from the URL, but the toggle below still
  // owns the mode afterwards: a reader who arrives via Join and decides they
  // already have an account must not be snapped back to signup on re-render.
  const intentParam = searchParams.get("intent");
  const [mode, setMode] = useState<Mode>(intentParam === "join" ? "signup" : "login");
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

  // The nav's "Log in" (/login) and "Join" (/login?intent=join) are the SAME
  // route, so clicking one while on the other client-navigates without a
  // remount and the initial-state read above never re-runs — the mode was
  // stuck on whichever side loaded first (Arjun, 2026-08-15: "when i click
  // login it goes to intent join"). Track the last-seen param and follow the
  // URL only when it actually changes, so the in-page toggle (which moves
  // mode while the param stays put) is never clobbered. Render-phase
  // adjustment per React's "adjusting state when props change" pattern.
  const [seenIntent, setSeenIntent] = useState(intentParam);
  if (intentParam !== seenIntent) {
    setSeenIntent(intentParam);
    const urlMode: Mode = intentParam === "join" ? "signup" : "login";
    if (urlMode !== mode) {
      switchMode(urlMode);
    }
  }

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
          {/* The two ways this screen dead-ends — a slow send, a typo in the
              address — each get one quiet line. "Go back" resets the local
              status so the signup card returns and the address can be
              re-entered; signUp() is safe to repeat (auth-copy.ts already
              names the already-registered case). */}
          <p className="lp-auth-switch">
            Nothing arriving? Check spam, or if the address was wrong,{" "}
            <button type="button" onClick={() => setAuthStatus("idle")}>
              go back
            </button>{" "}
            and fix it.
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
              : "Sign in. The archive is where you left it."}
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
            {/* The BiometricAnchor row read as a gadget next to the OAuth
                buttons (Arjun, 2026-08-15: "it doesn't look professional") —
                here the passkey is simply the third provider, same geometry
                as the two above it. Later the same day the anchor left the
                post-sign-in enable prompt too ("make the passkey look like
                the other on the sign in page"), so this button's treatment
                is now the passkey's one look everywhere. */}
            <button
              type="button"
              className="lp-auth-passkey-btn"
              onClick={handlePasskeySignIn}
              disabled={authMethodPending}
            >
              <PasskeyIcon />
              {passkeyPending ? "Waiting for your passkey…" : "Sign in with Passkey"}
            </button>
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

          {/* Two different weights on purpose: toward signup is the business
              (a real bordered CTA carrying the price); toward login is an
              escape hatch (one quiet line). */}
          {mode === "login" ? (
            <button type="button" className="lp-auth-startcta" onClick={() => switchMode("signup")}>
              <span className="lp-auth-startcta-line">
                <strong>Start your archive tonight</strong>
                <span className="lp-auth-startcta-arrow" aria-hidden="true">
                  →
                </span>
              </span>
              <span className="lp-auth-startcta-sub">
                Every set you play from tonight on, kept. $6.99/month.
              </span>
            </button>
          ) : (
            <p className="lp-auth-switch">
              Already have an account?{" "}
              <button type="button" onClick={() => switchMode("login")}>
                Log in
              </button>
            </p>
          )}

          {mode === "signup" && (
            <p className="lp-auth-fineprint">
              One plan. $6.99/month billed yearly, or $7.99 month to month. Cancel whenever. By
              creating an account you agree to the <Link href="/terms">Terms</Link> and{" "}
              <Link href="/privacy">Privacy Policy</Link>.
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
              Curfew turns the sets you play into the only baseline that means anything: your own.
              Here is what the plan buys, all of it, for every DJ on it.
            </p>
            <ul className="lp-feat-facts lp-auth-facts">
              {PITCH_FACTS.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
            <div className="lp-auth-plan">
              <p className="lp-feat-eyebrow lp-auth-plan-eyebrow">One plan, everything in it</p>
              <p className="lp-auth-price">
                $6.99<span>/month</span>
              </p>
              <p className="lp-auth-plan-terms">Billed yearly, or $7.99 month to month.</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

// The FIDO passkey silhouette — a person and a key, nothing biometric or
// gadget-like. Token fill, same rule as every inline icon in the app.
function PasskeyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="var(--color-abyss-text)"
        fillRule="evenodd"
        d="M17.5 9.5a3.25 3.25 0 0 1 1.25 6.25v3.05l-1.25 1.7-1.25-1.7v-.55l.65-.85-.65-.85v-.8A3.25 3.25 0 0 1 17.5 9.5Zm0 2a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z"
      />
      <path
        fill="var(--color-abyss-text)"
        d="M9.5 3.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0 9.75c1.52 0 2.94.33 4.1.9a5.23 5.23 0 0 0-1.35 3.52c0 .95.25 1.87.71 2.66l-.06.17H2.75v-2.2c0-2.8 3.02-5.05 6.75-5.05Z"
      />
    </svg>
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
              Add a passkey for faster sign-in next time. Optional.
            </p>
            <button
              type="button"
              className="lp-auth-passkey-btn"
              onClick={handleRegister}
              disabled={registering}
            >
              <PasskeyIcon />
              {registering ? "Adding passkey…" : "Enable Passkey"}
            </button>
            {error && (
              <p className="lp-auth-error" role="alert">
                {error}
              </p>
            )}
          </div>
        )}

        {registered && <p className="lp-body lp-auth-tag">Passkey added.</p>}

        {/* Into the app, not back onto the sales page — the middleware's
            phone gate still owns the detour to /phone-required if this
            account has no phone on file yet. */}
        <Link href="/dashboard" className="lp-auth-continue">
          Continue to Curfew
        </Link>
      </div>
    </main>
  );
}
