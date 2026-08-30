import { describe, expect, it } from "vitest";
import { parseE2ePort } from "./playwright.config";

describe("parseE2ePort", () => {
  it("uses the supported default and accepts a numeric unprivileged port", () => {
    expect(parseE2ePort(undefined)).toBe(4_173);
    expect(parseE2ePort("4287")).toBe(4_287);
    expect(parseE2ePort("1024")).toBe(1_024);
    expect(parseE2ePort("65535")).toBe(65_535);
  });

  it.each([
    "",
    "0",
    "1023",
    "65536",
    "-1",
    "4.173",
    "04173",
    " 4173",
    "4173 ",
    "4173\n",
    "4173@attacker.invalid",
    "4173; touch /tmp/wimy-port-injection",
    "4173 && touch /tmp/wimy-port-injection",
    "$(touch /tmp/wimy-port-injection)",
    "`touch /tmp/wimy-port-injection`",
  ])("rejects an unsafe E2E port value: %s", (value) => {
    expect(() => parseE2ePort(value)).toThrow(
      "WIMY_E2E_PORT must be an integer from 1024 to 65535",
    );
  });
});
