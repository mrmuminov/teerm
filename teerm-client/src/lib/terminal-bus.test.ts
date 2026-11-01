import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  attachTerminal,
  clearTerminal,
  pushTerminalData,
  resetTerminalBus,
} from "@/lib/terminal-bus";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("terminal bus", () => {
  beforeEach(() => resetTerminalBus());

  it("buffers output until a terminal attaches, then flushes it in order", () => {
    pushTerminalData("tab", bytes(1));
    pushTerminalData("tab", bytes(2));

    const write = vi.fn();
    attachTerminal("tab", write);

    expect(write.mock.calls.map(([chunk]) => [...chunk])).toEqual([[1], [2]]);
  });

  it("delivers live output to every attached writer", () => {
    const first = vi.fn();
    const second = vi.fn();
    attachTerminal("tab", first);
    attachTerminal("tab", second);

    pushTerminalData("tab", bytes(7));

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it("keeps delivering when one writer throws", () => {
    const broken = vi.fn(() => {
      throw new Error("tearing down");
    });
    const healthy = vi.fn();
    attachTerminal("tab", broken);
    attachTerminal("tab", healthy);

    pushTerminalData("tab", bytes(1));

    expect(healthy).toHaveBeenCalledOnce();
  });

  it("buffers again after the last writer detaches", () => {
    const write = vi.fn();
    const detach = attachTerminal("tab", write);
    detach();

    pushTerminalData("tab", bytes(9));
    const next = vi.fn();
    attachTerminal("tab", next);

    expect(next).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });

  it("drops buffered output for a closed tab", () => {
    pushTerminalData("tab", bytes(1));
    clearTerminal("tab");

    const write = vi.fn();
    attachTerminal("tab", write);

    expect(write).not.toHaveBeenCalled();
  });
});
