"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { AUTH_FAILURE_COPY } from "@/app/login/auth-copy";

// Sign-in providers row (Story 3.10, AC-9/AC-10, D-6/D-7): shows which of
// Email / Google / Apple / Passkey are attached, with a link affordance for
// the OAuth providers that aren't. UNLINK IS DELIBERATELY ABSENT — unlinking
// your only identity locks you out of your archive.
//
// Notes against D-6's letter, decided here for honesty:
// - Email has no link affordance when unattached: `linkIdentity` is
//   OAuth-only, and an email identity is created by password signup — a
//   "+ Link" that can't work would lie. It renders as attached-or-absent.
// - Apple's link path is gated on NEXT_PUBLIC_APPLE_SIGNIN_AVAILABLE, same
//   flag and reason as the login page (Sign In with Apple hard-requires an
//   HTTPS return URL, so localhost can never exercise it).
//
// Passkeys (D-7): attachment comes from the client-side credential list
// (same call the login page uses), and "Add a passkey" reuses the shipped
// registerPasskey() — hidden entirely (not shown-and-failing) on browsers
// without WebAuthn. This is the durable home that discharges the 2026-07-30
// OAuth-nudge ledger ruling by relocation.
//
// Provider-link failure renders inline under the row (Failure Register
// register) — never a banner (§5).

const appleSignInAvailable = process.env.NEXT_PUBLIC_APPLE_SIGNIN_AVAILABLE === "true";

type OAuthProvider = "google" | "apple";

export function ProvidersRow({ providers }: { providers: string[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<OAuthProvider | null>(null);

  // WebAuthn capability, SSR-safe without an effect-set state (the same
  // useSyncExternalStore idiom as the dashboard Greeting's day-part): server
  // snapshot says unsupported, the client snapshot corrects at hydration.
  const webAuthnSupported = useSyncExternalStore(
    () => () => {},
    () => "PublicKeyCredential" in window,
    () => false,
  );
  const [hasPasskey, setHasPasskey] = useState(false);
  const [passkeyChecked, setPasskeyChecked] = useState(false);
  const [registeringPasskey, setRegisteringPasskey] = useState(false);
  const [passkeyAdded, setPasskeyAdded] = useState(false);

  useEffect(() => {
    // Client-only credential probe. Failure leaves the passkey line at its
    // safe default: no check, CTA still offered (UX-DR20's "skippable,
    // never blocking" direction of failure).
    let cancelled = false;
    const supabase = createClient();
    supabase.auth.passkey
      .list()
      .then(({ data }) => {
        if (!cancelled) setHasPasskey((data?.length ?? 0) > 0);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setPasskeyChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // linkIdentity triggers a full-page redirect to the provider (same shape
  // as signInWithOAuth) — it only returns here on an error. The callback
  // lands on /auth/callback like every OAuth flow; the DJ returns to the
  // dashboard with the identity attached.
  async function link(provider: OAuthProvider) {
    setError(null);
    setPending(provider);
    const supabase = createClient();
    try {
      const { error } = await supabase.auth.linkIdentity({
        provider,
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) setError(AUTH_FAILURE_COPY.generic);
    } catch {
      setError(AUTH_FAILURE_COPY.generic);
    } finally {
      setPending(null);
    }
  }

  async function addPasskey() {
    setError(null);
    setRegisteringPasskey(true);
    const supabase = createClient();
    try {
      const { error } = await supabase.auth.registerPasskey();
      if (error) {
        setError(AUTH_FAILURE_COPY.generic);
        return;
      }
      setPasskeyAdded(true);
      setHasPasskey(true);
    } catch {
      setError(AUTH_FAILURE_COPY.generic);
    } finally {
      setRegisteringPasskey(false);
    }
  }

  const attached = new Set(providers);
  const passkeyAttached = hasPasskey || passkeyAdded || attached.has("passkey");

  return (
    <div className="st-row">
      <span className="st-row-label">Sign-in</span>
      <div className="st-row-cell">
        <div className="st-providers">
          {attached.has("email") && (
            <span className="st-provider">
              Email <span className="st-provider-check" aria-hidden="true">✓</span>
              <span className="sr-only">attached</span>
            </span>
          )}
          <ProviderLine
            name="Google"
            attachedNow={attached.has("google")}
            pending={pending === "google"}
            onLink={() => void link("google")}
          />
          <ProviderLine
            name="Apple"
            attachedNow={attached.has("apple")}
            pending={pending === "apple"}
            onLink={() => void link("apple")}
            disabled={!appleSignInAvailable}
            disabledReason="coming soon"
          />
          {passkeyChecked && passkeyAttached && (
            <span className="st-provider">
              Passkey <span className="st-provider-check" aria-hidden="true">✓</span>
              <span className="sr-only">attached</span>
            </span>
          )}
          {webAuthnSupported && !passkeyAttached && (
            <button
              type="button"
              className="st-action"
              disabled={registeringPasskey}
              onClick={() => void addPasskey()}
            >
              {registeringPasskey ? "Adding passkey…" : "Add a passkey"}
            </button>
          )}
          {passkeyAdded && (
            <p className="st-inline-ok" role="status">
              Passkey added.
            </p>
          )}
        </div>
        {error && (
          <p className="st-inline-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function ProviderLine({
  name,
  attachedNow,
  pending,
  onLink,
  disabled = false,
  disabledReason,
}: {
  name: string;
  attachedNow: boolean;
  pending: boolean;
  onLink: () => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  if (attachedNow) {
    return (
      <span className="st-provider">
        {name} <span className="st-provider-check" aria-hidden="true">✓</span>
        <span className="sr-only">attached</span>
      </span>
    );
  }
  return (
    <span className="st-provider">
      {name}
      <button type="button" className="st-action" disabled={disabled || pending} onClick={onLink}>
        {pending ? "Opening…" : disabled && disabledReason ? `Link (${disabledReason})` : "+ Link"}
      </button>
    </span>
  );
}
