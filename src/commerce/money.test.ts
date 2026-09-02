import { describe, expect, it } from "vitest";
import { formatMinorMoney } from "./money";

describe("formatMinorMoney", () => {
  it("respects each currency's minor-unit exponent", () => {
    expect(formatMinorMoney(12_000, "USD")).toBe("$120.00");
    expect(formatMinorMoney(1_200, "JPY")).toBe("¥1,200");
    expect(formatMinorMoney(1_234, "KWD")).toContain("1.234");
  });
});
