"use client";

import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
};

// DESIGN.md#Buttons: Primary sources its gradient from the live
// --btn-gradient-* tokens (small rounded.lg radius, no pill shape). Secondary
// is text-only, Geist-mono label, no fill.
export function Button({ variant = "primary", className, children, ...props }: ButtonProps) {
  const variantClass = variant === "primary" ? "auth-button-primary" : "auth-button-secondary";
  const classes = ["auth-button", variantClass, className].filter(Boolean).join(" ");

  return (
    <button {...props} className={classes}>
      {children}
    </button>
  );
}
