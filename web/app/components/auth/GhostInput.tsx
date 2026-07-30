"use client";

import { useId } from "react";

type GhostInputProps = {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  defaultValue?: string;
  error?: string;
  id?: string;
};

// DESIGN.md#Input Fields: transparent background, bottom-border only, label
// above in text-label-sm, value in text-mono-data — "reads like data entry,
// not a generic web form."
export function GhostInput({
  label,
  name,
  type = "text",
  autoComplete,
  required,
  minLength,
  maxLength,
  pattern,
  defaultValue,
  error,
  id,
}: GhostInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;

  return (
    <div className="auth-ghost-field">
      <label className="text-label-sm auth-ghost-field-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        pattern={pattern}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="text-mono-data auth-ghost-field-input"
      />
      {error && (
        <p id={errorId} className="text-body-md auth-ghost-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
