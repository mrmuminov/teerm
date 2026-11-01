import { describe, expect, it } from "vitest";

import { resolveTheme } from "@/lib/theme";

describe("resolveTheme", () => {
  it("honours an explicit choice regardless of the OS setting", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("follows the OS setting for system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("falls back to dark when nothing valid is stored", () => {
    expect(resolveTheme(undefined, false)).toBe("dark");
    expect(resolveTheme("sepia", false)).toBe("dark");
  });
});
