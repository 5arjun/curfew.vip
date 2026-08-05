import { describe, expect, it } from "vitest";
import { resolveFirstName } from "./greeting";

// AC-4 / D-3: dj_name → OAuth full_name → name → nameless. First whitespace
// token only, matching the dashboard's existing behavior.
describe("resolveFirstName", () => {
  it("prefers dj_name over OAuth metadata", () => {
    expect(resolveFirstName("DJ Shadow", { full_name: "Josh Davis", name: "Josh" })).toBe("DJ");
  });

  it("falls back to full_name when dj_name is unset", () => {
    expect(resolveFirstName(null, { full_name: "Josh Davis" })).toBe("Josh");
  });

  it("falls back to name when full_name is absent", () => {
    expect(resolveFirstName(null, { name: "Josh Davis" })).toBe("Josh");
  });

  it("is null when nothing is available (email-path DJ with no dj_name)", () => {
    expect(resolveFirstName(null, {})).toBeNull();
    expect(resolveFirstName(null, undefined)).toBeNull();
  });

  it("ignores a whitespace-only dj_name rather than greeting with nothing", () => {
    expect(resolveFirstName("   ", { full_name: "Josh Davis" })).toBe("Josh");
  });

  it("ignores non-string metadata values", () => {
    expect(resolveFirstName(null, { full_name: 42, name: { first: "x" } })).toBeNull();
  });

  it("takes the first whitespace token of a multi-word dj_name", () => {
    expect(resolveFirstName("  Carl   Cox  ", undefined)).toBe("Carl");
  });
});
