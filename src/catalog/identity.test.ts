import { describe, expect, it } from "vitest";
import {
  isValidGtin,
  normalizeGtinForComparison,
} from "./identity";

describe("normalizeGtinForComparison", () => {
  it("removes ASCII whitespace and hyphens while preserving digits", () => {
    expect(normalizeGtinForComparison(" 1234-5670 ")).toBe(
      "00000012345670",
    );
    expect(normalizeGtinForComparison("0000-0000")).toBe("00000000000000");
  });

  it.each([
    ["12345670", "00000012345670"],
    ["036000291452", "00036000291452"],
    ["4006381333931", "04006381333931"],
    ["10012345678902", "10012345678902"],
  ])("normalizes %s to the GTIN-14 comparison form", (value, expected) => {
    expect(normalizeGtinForComparison(value)).toBe(expected);
  });

  it.each([
    "",
    " - ",
    "1234567",
    "123456789",
    "1234/5670",
    "1234A670",
  ])("rejects unsupported GTIN input %j", (value) => {
    expect(normalizeGtinForComparison(value)).toBeUndefined();
  });
});

describe("isValidGtin", () => {
  it.each([
    "12345670",
    "036000291452",
    "4006381333931",
    "10012345678902",
  ])("accepts a GTIN with a valid GS1 Mod-10 check digit: %s", (value) => {
    expect(isValidGtin(value)).toBe(true);
  });

  it("rejects a GTIN with an incorrect check digit", () => {
    expect(isValidGtin("12345671")).toBe(false);
  });

  it("normalizes permitted separators before validating", () => {
    expect(isValidGtin(" 1234-5670 ")).toBe(true);
  });
});
