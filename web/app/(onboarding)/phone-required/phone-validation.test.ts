import { describe, expect, it } from "vitest";
import { isValidPhone, normalizePhone } from "./phone-validation";

describe("isValidPhone", () => {
  it("accepts plain digit strings within range", () => {
    expect(isValidPhone("2677772111")).toBe(true);
  });

  it("accepts common formatting characters", () => {
    expect(isValidPhone("+1 (267) 777-2111")).toBe(true);
  });

  it("rejects empty or whitespace-only input", () => {
    expect(isValidPhone("")).toBe(false);
    expect(isValidPhone("   ")).toBe(false);
  });

  it("rejects too few digits", () => {
    expect(isValidPhone("12345")).toBe(false);
  });

  it("rejects too many digits (the observed garbage-input case)", () => {
    expect(isValidPhone("2349871823471948790")).toBe(false);
  });

  it("rejects letters", () => {
    expect(isValidPhone("267-CALL-NOW")).toBe(false);
  });

  it("rejects other symbols", () => {
    expect(isValidPhone("2677772111;drop table djs")).toBe(false);
  });
});

describe("normalizePhone", () => {
  it("stamps +1 on a bare NANP number", () => {
    // The exact value prod stored unnormalized, which is what surfaced the
    // bug — it must now come back out as E.164.
    expect(normalizePhone("2677772111")).toBe("+12677772111");
  });

  it("collapses every spelling of one number onto a single stored form", () => {
    const canonical = "+12677772111";
    expect(normalizePhone("2677772111")).toBe(canonical);
    expect(normalizePhone("(267) 777-2111")).toBe(canonical);
    expect(normalizePhone("267.777.2111")).toBe(canonical);
    expect(normalizePhone("12677772111")).toBe(canonical);
    expect(normalizePhone("+1 (267) 777-2111")).toBe(canonical);
  });

  it("leaves an already-normalized value untouched", () => {
    // The seeded demo row's format — a backfill or a re-save must be a no-op.
    expect(normalizePhone("+15555550142")).toBe("+15555550142");
  });

  it("strips formatting from international numbers without guessing at them", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("+81 3-1234-5678")).toBe("+81312345678");
  });

  it("refuses a bare national number whose country cannot be inferred", () => {
    // 9 digits: a real subscriber-number length in several countries, none
    // of them distinguishable here. Refusing beats silently stamping +1.
    expect(normalizePhone("207946095")).toBeNull();
    expect(normalizePhone("2079460")).toBeNull();
  });

  it("refuses a 10-digit number that is not NANP-shaped", () => {
    // Area codes never start with 0 or 1, so these are not US numbers typed
    // bare — they are something else that must not be stamped +1.
    expect(normalizePhone("0207946095")).toBeNull();
    expect(normalizePhone("1207946095")).toBeNull();
  });

  it("refuses a valid-area-code number with an invalid exchange code", () => {
    // Exchange codes never start with 0 or 1 either — a valid area code
    // (267) paired with an invalid exchange (012) is not NANP-shaped.
    expect(normalizePhone("2670123456")).toBeNull();
    expect(normalizePhone("2671123456")).toBeNull();
  });

  it("refuses a country code starting with zero", () => {
    expect(normalizePhone("+0207946095")).toBeNull();
  });

  it("returns null for anything isValidPhone already rejects", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("267-CALL-NOW")).toBeNull();
    expect(normalizePhone("2349871823471948790")).toBeNull();
    expect(normalizePhone("2677772111;drop table djs")).toBeNull();
  });

  it("only ever emits the shape the column CHECK accepts", () => {
    // Mirrors `djs_phone_e164` in 20260816170000 — if these drift, the DB
    // rejects a write the app thought was valid.
    for (const input of ["2677772111", "+44 20 7946 0958", "12677772111"]) {
      expect(normalizePhone(input)).toMatch(/^\+[1-9]\d{6,14}$/);
    }
  });

  it("accepts at the 7-digit floor and 15-digit ceiling", () => {
    // Both bounds are E.164's own (mirrored in the CHECK's {6,14}); a value
    // right at either edge must not be rejected by an off-by-one.
    expect(normalizePhone("+1234567")).toBe("+1234567");
    expect(normalizePhone("+123456789012345")).toBe("+123456789012345");
  });
});
