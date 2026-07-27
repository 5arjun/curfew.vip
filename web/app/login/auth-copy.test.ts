import { describe, expect, it } from "vitest";
import {
  AUTH_FAILURE_COPY,
  isAlreadyRegisteredSignUp,
  isAlreadyRegisteredSignUpError,
  mapSignInError,
} from "./auth-copy";

describe("mapSignInError (Story 2.3a AC-3, Task 4.4)", () => {
  it("maps error.code 'invalid_credentials' to the exact Failure Register string", () => {
    expect(mapSignInError({ code: "invalid_credentials", message: "irrelevant" })).toBe(
      AUTH_FAILURE_COPY.wrongPassword,
    );
  });

  it("maps message 'Invalid login credentials' to the exact Failure Register string when code is absent", () => {
    expect(mapSignInError({ message: "Invalid login credentials" })).toBe(
      AUTH_FAILURE_COPY.wrongPassword,
    );
  });

  it("falls back to the generic calm copy for an unrecognized error shape", () => {
    expect(mapSignInError({ code: "something_else", message: "boom" })).toBe(
      AUTH_FAILURE_COPY.generic,
    );
  });
});

describe("isAlreadyRegisteredSignUp (Story 2.3a AC-1/AC-3, Task 4.4)", () => {
  it("is true when identities is an empty array (GoTrue's sanitized-user anti-enumeration signal)", () => {
    expect(isAlreadyRegisteredSignUp({ identities: [] })).toBe(true);
  });

  it("is false for a genuinely new signup (at least one identity)", () => {
    expect(isAlreadyRegisteredSignUp({ identities: [{ provider: "email" }] })).toBe(false);
  });

  it("is false when identities is missing or the user is null", () => {
    expect(isAlreadyRegisteredSignUp({})).toBe(false);
    expect(isAlreadyRegisteredSignUp(null)).toBe(false);
    expect(isAlreadyRegisteredSignUp(undefined)).toBe(false);
  });
});

describe("isAlreadyRegisteredSignUpError (Story 2.3a AC-1/AC-3, Task 4.4)", () => {
  it("is true for error.code 'user_already_exists' (confirmed-existing-email signup, verified against the local Auth API)", () => {
    expect(
      isAlreadyRegisteredSignUpError({ code: "user_already_exists", message: "irrelevant" }),
    ).toBe(true);
  });

  it("is true for message 'User already registered' when code is absent", () => {
    expect(isAlreadyRegisteredSignUpError({ message: "User already registered" })).toBe(true);
  });

  it("is false for an unrelated error", () => {
    expect(isAlreadyRegisteredSignUpError({ code: "weak_password", message: "boom" })).toBe(false);
  });
});
