import { describe, expect, it } from "vitest";
import { isActiveNavItem } from "./FloatingNav";

// Story 3.5 Task 6.1: no component/DOM testing library exists in web/ (only
// vitest) — pure-logic unit test only, matching every prior web story's
// stated testing philosophy. FloatingNav itself is presentational; this is
// the one piece of standalone logic worth factoring out and testing directly.
describe("isActiveNavItem", () => {
  it("returns true when pathname exactly matches the item's href", () => {
    expect(isActiveNavItem("/dashboard", "/dashboard")).toBe(true);
  });

  it("returns false when pathname does not match the item's href", () => {
    expect(isActiveNavItem("/style-evolution", "/dashboard")).toBe(false);
  });

  it("does not treat a nested path as active for a parent href", () => {
    expect(isActiveNavItem("/dashboard/details", "/dashboard")).toBe(false);
  });

  it("does not treat one nav route as active for another with a shared prefix", () => {
    expect(isActiveNavItem("/library-utilization", "/library")).toBe(false);
  });
});
