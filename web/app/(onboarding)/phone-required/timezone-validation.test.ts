import { describe, expect, it } from "vitest";
import { normalizeTimezone } from "./timezone-validation";

describe("normalizeTimezone", () => {
  it("accepts the ordinary two-segment names", () => {
    expect(normalizeTimezone("America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(normalizeTimezone("Europe/Berlin")).toBe("Europe/Berlin");
    expect(normalizeTimezone("Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(normalizeTimezone("Australia/Sydney")).toBe("Australia/Sydney");
  });

  it("accepts three-segment names", () => {
    expect(normalizeTimezone("America/Argentina/Salta")).toBe("America/Argentina/Salta");
    expect(normalizeTimezone("America/Indiana/Indianapolis")).toBe("America/Indiana/Indianapolis");
  });

  it("accepts the legacy single-segment names", () => {
    expect(normalizeTimezone("UTC")).toBe("UTC");
    expect(normalizeTimezone("EST5EDT")).toBe("EST5EDT");
    expect(normalizeTimezone("Zulu")).toBe("Zulu");
  });

  it("accepts names with the punctuation IANA actually uses", () => {
    expect(normalizeTimezone("Etc/GMT+7")).toBe("Etc/GMT+7");
    expect(normalizeTimezone("America/Port-au-Prince")).toBe("America/Port-au-Prince");
    expect(normalizeTimezone("America/Ciudad_Juarez")).toBe("America/Ciudad_Juarez");
  });

  it("accepts a zone this checkout has never heard of", () => {
    // The point of shape-only validation. A browser with newer tzdata than the
    // server must not have its zone rejected — the read path degrades an
    // unrecognized zone to UTC on its own, which is strictly better than
    // refusing to store a name that is probably real.
    expect(normalizeTimezone("Mars/Olympus_Mons")).toBe("Mars/Olympus_Mons");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeTimezone("  Europe/Berlin\n")).toBe("Europe/Berlin");
  });

  it("returns null for absent input", () => {
    // Not an error: a browser that will not report a zone is a permanently
    // supported state (AD-3). The caller drops the key and the form proceeds.
    expect(normalizeTimezone("")).toBeNull();
    expect(normalizeTimezone("   ")).toBeNull();
  });

  it("rejects junk that is not shaped like a zone", () => {
    expect(normalizeTimezone("'; drop table djs; --")).toBeNull();
    expect(normalizeTimezone("<script>alert(1)</script>")).toBeNull();
    expect(normalizeTimezone("America/Los Angeles")).toBeNull(); // space, not underscore
    expect(normalizeTimezone("/leading-slash")).toBeNull();
    expect(normalizeTimezone("trailing/")).toBeNull();
    expect(normalizeTimezone("a/b/c/d")).toBeNull(); // four segments
    expect(normalizeTimezone("Europe//Berlin")).toBeNull();
  });

  it("rejects an over-long value", () => {
    expect(normalizeTimezone(`America/${"x".repeat(200)}`)).toBeNull();
  });
});
