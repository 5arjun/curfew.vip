"use client";

type GoogleSignInButtonProps = {
  onClick: () => void;
  disabled?: boolean;
};

// Google's dark/filled theme (Identity Services branding guidelines,
// verified 2026-07-28 against developers.google.com/identity/branding-guidelines:
// fill #131314, border #8E918F, label #E3E3E3 — see tokens.css's
// --color-oauth-google-* comment). Logomark ships as a static asset
// (web/public/google-logo.svg) rather than inline JSX SVG, since Google's
// "G" is multi-color and inline hex fills would trip no-hardcoded-colors.test.ts.
export function GoogleSignInButton({ onClick, disabled }: GoogleSignInButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="auth-oauth-button auth-oauth-button-google"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset, no next/image optimization needed for an 18x18 logomark */}
      <img src="/google-logo.svg" alt="" width={18} height={18} aria-hidden="true" />
      Sign in with Google
    </button>
  );
}
