"use client";

type BiometricAnchorProps = {
  primaryLabel: string;
  secondaryLabel: string;
  onClick: () => void;
  disabled?: boolean;
};

// DESIGN.md#Biometric Anchor: bordered row, rounded.full badge holding a
// filled fingerprint icon, two-line label, circular radio indicator that
// fills solid on hover. Reused for both the main login form's existing-
// passkey sign-in and EnablePasskeyPrompt's passkey-enable opt-in (see the
// story's Scope boundaries "Passkey UX scope note") — only the two label
// lines differ between the two entry points, not the visual pattern.
export function BiometricAnchor({ primaryLabel, secondaryLabel, onClick, disabled }: BiometricAnchorProps) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="auth-biometric-anchor">
      <span className="auth-biometric-badge" aria-hidden="true">
        <FingerprintIcon />
      </span>
      <span className="auth-biometric-label">
        <span className="text-label-sm auth-biometric-label-primary">{primaryLabel}</span>
        <span className="text-label-sm auth-biometric-label-secondary">{secondaryLabel}</span>
      </span>
      <span className="auth-biometric-radio" aria-hidden="true" />
    </button>
  );
}

function FingerprintIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="var(--color-primary)"
        d="M12 2a8 8 0 0 0-8 8c0 4.5 2.7 7 3.8 9.4a1 1 0 0 0 1.8-.8C8.6 16.5 6 14.3 6 10a6 6 0 0 1 12 0c0 1.8-.4 3.2-1 4.4a1 1 0 0 0 1.8.9C19.5 13.9 20 12.1 20 10a8 8 0 0 0-8-8Zm0 4a4 4 0 0 0-4 4c0 3.1 1.6 4.8 2.6 6.9a1 1 0 0 0 1.8-.9C11.5 14.2 10 12.8 10 10a2 2 0 0 1 4 0c0 .7-.1 1.3-.3 1.9a1 1 0 0 0 1.9.6c.3-.8.4-1.6.4-2.5a4 4 0 0 0-4-4Zm0 4a1 1 0 0 0-1 1c0 2.3.9 3.6 1.6 4.9a1 1 0 0 0 1.7-1c-.6-1.1-1.3-2.1-1.3-3.9a1 1 0 0 0-1-1Z"
      />
    </svg>
  );
}
