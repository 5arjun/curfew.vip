import { describe, expect, it } from "vitest";
import { maskPhone } from "./phone-mask";

describe("maskPhone", () => {
  it("masks an E.164 US number to the spec's anatomy", () => {
    expect(maskPhone("+14155550142")).toBe("+1 415 ••• ••42");
  });

  it("survives the loose formats /phone-required actually accepts", () => {
    expect(maskPhone("+1 (415) 555-0142")).toBe("+1 415 ••• ••42");
    expect(maskPhone("415.555.0142")).toBe("415 ••• ••42");
    expect(maskPhone("4155550142")).toBe("415 ••• ••42");
  });

  it("masks non-US shapes down to the last two digits alone", () => {
    expect(maskPhone("+44 20 7946 0958")).toBe("••• ••58");
  });

  it("never renders empty for degenerate input", () => {
    expect(maskPhone("")).toBe("•••");
    expect(maskPhone("+4")).toBe("••4");
  });
});
