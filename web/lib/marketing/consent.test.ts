import { describe, expect, it } from "vitest";

import {
  MARKETING_POSTAL_ADDRESS,
  SIGNUP_AGREEMENT_SEGMENTS,
  SIGNUP_AGREEMENT_TEXT,
  formatPostalAddress,
  isPostalAddressComplete,
} from "./consent";

describe("formatPostalAddress", () => {
  it("renders the configured address on one line", () => {
    expect(formatPostalAddress()).toBe("1405 N Sydenham St, Philadelphia, PA 19121, USA");
  });

  it("drops empty parts instead of leaving stray punctuation", () => {
    expect(
      formatPostalAddress({
        line1: "1 Example Rd",
        city: "",
        region: "",
        postalCode: "",
        country: "USA",
      }),
    ).toBe("1 Example Rd, USA");
  });
});

describe("isPostalAddressComplete", () => {
  // The gate exists because CAN-SPAM wants a *valid* postal address, and a
  // street line on its own is not one. This is the check that has to fail
  // before a broadcast can ship with a half-filled footer.
  it("accepts the configured address", () => {
    expect(isPostalAddressComplete()).toBe(true);
    expect(isPostalAddressComplete(MARKETING_POSTAL_ADDRESS)).toBe(true);
  });

  it("rejects a street line with no city, state, or ZIP", () => {
    expect(
      isPostalAddressComplete({ line1: "1405 N Sydenham St", city: "", region: "", postalCode: "" }),
    ).toBe(false);
  });

  it("rejects each single missing part", () => {
    const full = { line1: "1 Example Rd", city: "Philadelphia", region: "PA", postalCode: "19121" };
    expect(isPostalAddressComplete({ ...full, city: "" })).toBe(false);
    expect(isPostalAddressComplete({ ...full, region: "" })).toBe(false);
    expect(isPostalAddressComplete({ ...full, postalCode: "" })).toBe(false);
    expect(isPostalAddressComplete({ ...full, line1: "" })).toBe(false);
  });

  it("rejects whitespace masquerading as a filled field", () => {
    expect(
      isPostalAddressComplete({
        line1: "1 Example Rd",
        city: "   ",
        region: "PA",
        postalCode: "19121",
      }),
    ).toBe(false);
  });
});

describe("SIGNUP_AGREEMENT_TEXT", () => {
  // The box is REQUIRED to create an account (Arjun, 2026-08-20), which makes
  // its exact scope load-bearing: everyone who has an account will have ticked
  // it, so whatever it says is what every DJ is on record as agreeing to.
  //
  // The email/text split is the part that must not slip. Widening the box to
  // cover marketing email was a decision made with its consequences written
  // down; letting it silently cover TEXTS would be the exact defect the
  // 2026-08-18 review flagged, and TCPA damages start at $500 a message.
  it("never claims consent for texts", () => {
    const text = SIGNUP_AGREEMENT_TEXT.toLowerCase();
    expect(text).not.toMatch(/\btext(s|ing)?\b/);
    expect(text).not.toContain("sms");
    expect(text).not.toContain("message rates");
    expect(text).not.toContain("phone");
  });

  it("names email marketing, since that is what it grants", () => {
    expect(SIGNUP_AGREEMENT_TEXT.toLowerCase()).toContain("marketing email");
  });

  it("names the terms and the privacy policy it also accepts", () => {
    expect(SIGNUP_AGREEMENT_TEXT).toContain("Terms");
    expect(SIGNUP_AGREEMENT_TEXT).toContain("Privacy Policy");
  });

  it("names the way out, so the box is not ticked in ignorance of it", () => {
    expect(SIGNUP_AGREEMENT_TEXT.toLowerCase()).toContain("unsubscribe");
  });
});

describe("SIGNUP_AGREEMENT_SEGMENTS", () => {
  // The segments exist so the rendered label and the stored record share one
  // source. If these ever diverged, the consent column would describe wording
  // no DJ was actually shown — which is the one thing the record exists to
  // establish.
  it("joins to exactly the stored text", () => {
    expect(SIGNUP_AGREEMENT_SEGMENTS.map((s) => s.text).join("")).toBe(SIGNUP_AGREEMENT_TEXT);
  });

  it("links both documents the DJ is agreeing to", () => {
    const linked = SIGNUP_AGREEMENT_SEGMENTS.filter((s) => s.href);
    expect(linked.map((s) => s.href)).toEqual(["/terms", "/privacy"]);
  });

  it("keeps every link's visible text inside the sentence", () => {
    // A link whose label is not part of the joined string would render text
    // that the stored record does not contain.
    for (const segment of SIGNUP_AGREEMENT_SEGMENTS) {
      expect(SIGNUP_AGREEMENT_TEXT).toContain(segment.text);
    }
  });
});
