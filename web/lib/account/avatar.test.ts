import { describe, expect, it } from "vitest";
import { allowedAvatarUrl, monogramLetter } from "./avatar";

// Review patches (2026-08-05): an unallowlisted avatar host must fall back
// to the monogram before reaching <Image> (whose throw would take down the
// whole authenticated shell), and the monogram must read the first CODE
// POINT (D-3 allows any characters, emoji included).

describe("allowedAvatarUrl", () => {
  it("passes the allowlisted Google photo hosts through", () => {
    const url = "https://lh3.googleusercontent.com/a/photo=s96-c";
    expect(allowedAvatarUrl(url)).toBe(url);
  });

  it("rejects hosts next/image is not configured for", () => {
    expect(allowedAvatarUrl("https://lh7.googleusercontent.com/a/photo")).toBeNull();
    expect(allowedAvatarUrl("https://is1-ssl.mzstatic.com/apple/photo.jpg")).toBeNull();
    expect(allowedAvatarUrl("https://evil.example/x.png")).toBeNull();
  });

  it("rejects non-https schemes and unparseable values", () => {
    expect(allowedAvatarUrl("http://lh3.googleusercontent.com/a/photo")).toBeNull();
    expect(allowedAvatarUrl("javascript:alert(1)")).toBeNull();
    expect(allowedAvatarUrl("not a url")).toBeNull();
    expect(allowedAvatarUrl(null)).toBeNull();
  });
});

describe("monogramLetter", () => {
  it("takes the DJ name's first letter, else the email's", () => {
    expect(monogramLetter("shadow", null)).toBe("S");
    expect(monogramLetter(null, "arjun@example.com")).toBe("A");
    expect(monogramLetter(null, null)).toBe("?");
  });

  it("keeps an astral-plane first character whole (review patch)", () => {
    expect(monogramLetter("🎧 nights", null)).toBe("🎧");
    expect(monogramLetter("𝔻eluxe", null)).toBe("𝔻");
  });
});
