import { describe, expect, it } from "vitest";

import { MIN_PASSWORD_LENGTH, passwordStrength } from "@/lib/password";

describe("passwordStrength", () => {
  it("rates anything under the minimum length as too short", () => {
    const short = "a".repeat(MIN_PASSWORD_LENGTH - 1);

    expect(passwordStrength(short)).toEqual({ score: 0, label: "Too short" });
  });

  it("rewards length, mixed case, and digits with symbols", () => {
    expect(passwordStrength("abcdefghij").score).toBe(1);
    expect(passwordStrength("abcdefghijklmn").score).toBe(2);
    expect(passwordStrength("Abcdefghijklmn").score).toBe(3);
    expect(passwordStrength("Abcdefghijklm1!")).toEqual({
      score: 4,
      label: "Strong",
    });
  });
});
