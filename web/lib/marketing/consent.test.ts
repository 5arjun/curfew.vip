import { describe, expect, it } from "vitest";

import {
  MARKETING_EMAIL_CONSENT_TEXT,
  MARKETING_POSTAL_ADDRESS,
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

describe("MARKETING_EMAIL_CONSENT_TEXT", () => {
  // These are the properties the 2026-08-18 ruling asked for, asserted so an
  // edit to the wording cannot quietly drop one. The consent is EMAIL-scoped
  // on purpose: bundling marketing texts in would recreate the exact defect
  // the review flagged, since TCPA needs its own written consent and no SMS
  // provider exists in this repo.
  it("names email and does not claim consent for texts", () => {
    expect(MARKETING_EMAIL_CONSENT_TEXT.toLowerCase()).toContain("email");
    expect(MARKETING_EMAIL_CONSENT_TEXT.toLowerCase()).not.toMatch(/\btext(s|ing)?\b/);
    expect(MARKETING_EMAIL_CONSENT_TEXT.toLowerCase()).not.toContain("sms");
    expect(MARKETING_EMAIL_CONSENT_TEXT.toLowerCase()).not.toContain("message rates");
  });

  it("names the way out, so the box is not ticked in ignorance of it", () => {
    expect(MARKETING_EMAIL_CONSENT_TEXT.toLowerCase()).toContain("unsubscribe");
  });

  it("distinguishes itself from account mail", () => {
    expect(MARKETING_EMAIL_CONSENT_TEXT.toLowerCase()).toContain("account mail");
  });
});
