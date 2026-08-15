import { describe, expect, it } from "vitest";
import { isValidPhone } from "./phone-validation";

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
