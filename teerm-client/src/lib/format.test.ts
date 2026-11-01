import { describe, expect, it } from "vitest";

import {
  formatBytes,
  formatKiB,
  formatPercent,
  formatRate,
  formatUptime,
  percentOf,
} from "@/lib/format";

describe("formatBytes", () => {
  it("scales through binary units with sensible precision", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1536)).toBe("1.50 KiB");
    expect(formatBytes(15 * 1024 * 1024)).toBe("15.0 MiB");
    expect(formatBytes(200 * 1024 ** 3)).toBe("200 GiB");
  });

  it("shows a dash for values that are not sizes", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });

  it("converts kibibytes", () => {
    expect(formatKiB(1024)).toBe("1.00 MiB");
  });
});

describe("rates and percentages", () => {
  it("formats a rate or a dash when unknown", () => {
    expect(formatRate(2048)).toBe("2.00 KiB/s");
    expect(formatRate(null)).toBe("—");
  });

  it("rounds percentages", () => {
    expect(formatPercent(46.6)).toBe("47%");
    expect(formatPercent(null)).toBe("—");
  });

  it("computes a bounded share", () => {
    expect(percentOf(25, 100)).toBe(25);
    expect(percentOf(150, 100)).toBe(100);
    expect(percentOf(5, 0)).toBe(0);
  });
});

describe("formatUptime", () => {
  it("uses the two largest units", () => {
    expect(formatUptime(90_061)).toBe("1d 1h");
    expect(formatUptime(3 * 3600 + 20 * 60)).toBe("3h 20m");
    expect(formatUptime(125)).toBe("2m");
  });
});
