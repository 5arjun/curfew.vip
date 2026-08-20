import { describe, expect, it } from "vitest";
import type { Session } from "@supabase/supabase-js";
import { extractAgentTokens } from "./agent-session";

// Fixtures are plain objects cast to `Session`, carrying only the fields the
// helper reads — not full, valid Supabase sessions (same discipline as
// `webhook.test.ts`).
function fakeSession(fields: Record<string, unknown>): Session {
  return fields as unknown as Session;
}

describe("extractAgentTokens", () => {
  it("returns exactly the two tokens the deep link carries", () => {
    const session = fakeSession({
      access_token: "eyJhbGciOi.access",
      refresh_token: "refresh-abc",
      token_type: "bearer",
      expires_in: 3600,
      user: { id: "dj-1", email: "dj@example.com" },
    });

    expect(extractAgentTokens(session)).toEqual({
      access_token: "eyJhbGciOi.access",
      refresh_token: "refresh-abc",
    });
  });

  it("drops everything else off the session — the user object never reaches the client", () => {
    const session = fakeSession({
      access_token: "a",
      refresh_token: "r",
      user: { id: "dj-1", email: "dj@example.com", phone: "+15551234567" },
    });

    expect(Object.keys(extractAgentTokens(session) ?? {}).sort()).toEqual([
      "access_token",
      "refresh_token",
    ]);
  });

  it("returns null for a missing session", () => {
    expect(extractAgentTokens(null)).toBeNull();
    expect(extractAgentTokens(undefined)).toBeNull();
  });

  it("returns null when the refresh token is absent — never `\"undefined\"` in the link URL", () => {
    expect(extractAgentTokens(fakeSession({ access_token: "a" }))).toBeNull();
  });

  it("returns null when the access token is absent", () => {
    expect(extractAgentTokens(fakeSession({ refresh_token: "r" }))).toBeNull();
  });

  it("treats an empty string as missing on either token", () => {
    expect(extractAgentTokens(fakeSession({ access_token: "", refresh_token: "r" }))).toBeNull();
    expect(extractAgentTokens(fakeSession({ access_token: "a", refresh_token: "" }))).toBeNull();
  });
});
