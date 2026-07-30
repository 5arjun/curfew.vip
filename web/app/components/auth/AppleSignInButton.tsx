"use client";

type AppleSignInButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  unavailableReason?: string;
};

// Apple's black button variant (Human Interface Guidelines — true black
// fill, white logomark, "Sign in with Apple" label in Apple's mandated
// system-font rendering, not Hanken Grotesk/Inter). Logomark ships as a
// static asset (web/public/apple-logo.svg), same rationale as
// GoogleSignInButton. When disabled (Apple not configured in this
// environment), the reason renders as visible label text, not only a
// `title` attribute — title is inconsistently exposed by screen readers and
// unreachable on touch devices, closing the a11y gap Task 4.3/deferred-work.md
// flagged against the pre-2.4 button.
export function AppleSignInButton({ onClick, disabled, unavailableReason }: AppleSignInButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      className="auth-oauth-button auth-oauth-button-apple"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset, no next/image optimization needed for a 16x20 logomark */}
      <img src="/apple-logo.svg" alt="" width={16} height={20} aria-hidden="true" />
      Sign in with Apple{disabled && unavailableReason ? ` (${unavailableReason})` : ""}
    </button>
  );
}
