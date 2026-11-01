import { describe, expect, it } from "vitest";

import type { MonitorSample } from "@/lib/ipc";
import { appendSample } from "@/stores/monitor";

function sample(cpu: number | null, rx: number | null): MonitorSample {
  return {
    supported: true,
    cpu_percent: cpu,
    cores: 4,
    load: null,
    memory: null,
    disks: [],
    network:
      rx === null
        ? null
        : {
            rx_total_bytes: 0,
            tx_total_bytes: 0,
            rx_bytes_per_sec: rx,
            tx_bytes_per_sec: 1,
          },
    gpus: [],
    uptime_secs: null,
  };
}

describe("appendSample", () => {
  it("adds readings and skips ones that are not known yet", () => {
    const first = appendSample({ cpu: [], rx: [], tx: [] }, sample(null, null));
    expect(first).toEqual({ cpu: [], rx: [], tx: [] });

    const second = appendSample(first, sample(40, 100));
    expect(second).toEqual({ cpu: [40], rx: [100], tx: [1] });
  });

  it("keeps only the most recent samples", () => {
    let history = { cpu: [] as number[], rx: [] as number[], tx: [] as number[] };
    for (let index = 0; index < 75; index += 1) {
      history = appendSample(history, sample(index, index));
    }

    expect(history.cpu).toHaveLength(60);
    expect(history.cpu[0]).toBe(15);
    expect(history.cpu[59]).toBe(74);
  });
});
