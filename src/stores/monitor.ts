import { useEffect } from "react";
import { create } from "zustand";

import { errorMessage, ipc, type MonitorSample } from "@/lib/ipc";

/** Samples kept for the sparklines: three minutes at the polling rate. */
const HISTORY_LENGTH = 60;
export const POLL_INTERVAL_MS = 3000;

export type MonitorHistory = {
  cpu: number[];
  rx: number[];
  tx: number[];
};

type MonitorEntry = {
  latest: MonitorSample | null;
  history: MonitorHistory;
  error: string | null;
};

type MonitorStore = {
  bySession: Record<string, MonitorEntry>;
  poll: (sessionId: string) => Promise<void>;
  forget: (sessionId: string) => void;
};

const EMPTY_HISTORY: MonitorHistory = { cpu: [], rx: [], tx: [] };

function append(values: number[], value: number | null): number[] {
  if (value === null) {
    return values;
  }
  return [...values, value].slice(-HISTORY_LENGTH);
}

/** Adds a sample's readings to the running history. */
export function appendSample(
  history: MonitorHistory,
  sample: MonitorSample,
): MonitorHistory {
  return {
    cpu: append(history.cpu, sample.cpu_percent),
    rx: append(history.rx, sample.network?.rx_bytes_per_sec ?? null),
    tx: append(history.tx, sample.network?.tx_bytes_per_sec ?? null),
  };
}

const inFlight = new Set<string>();

export const useMonitorStore = create<MonitorStore>((set, get) => ({
  bySession: {},

  poll: async (sessionId) => {
    // A slow server must not pile up overlapping probes.
    if (inFlight.has(sessionId)) {
      return;
    }
    inFlight.add(sessionId);

    try {
      const sample = await ipc.monitorSample(sessionId);
      const previous = get().bySession[sessionId];
      set((state) => ({
        bySession: {
          ...state.bySession,
          [sessionId]: {
            latest: sample,
            history: appendSample(previous?.history ?? EMPTY_HISTORY, sample),
            error: null,
          },
        },
      }));
    } catch (error) {
      const previous = get().bySession[sessionId];
      set((state) => ({
        bySession: {
          ...state.bySession,
          [sessionId]: {
            latest: previous?.latest ?? null,
            history: previous?.history ?? EMPTY_HISTORY,
            error: errorMessage(error),
          },
        },
      }));
    } finally {
      inFlight.delete(sessionId);
    }
  },

  forget: (sessionId) =>
    set((state) => {
      const { [sessionId]: _removed, ...rest } = state.bySession;
      void _removed;
      return { bySession: rest };
    }),
}));

/** Polls the server monitor while mounted and a Session is connected. */
export function useMonitorPolling(sessionId: string | null): void {
  useEffect(() => {
    if (!sessionId) {
      return;
    }

    void useMonitorStore.getState().poll(sessionId);
    const timer = window.setInterval(
      () => void useMonitorStore.getState().poll(sessionId),
      POLL_INTERVAL_MS,
    );

    return () => window.clearInterval(timer);
  }, [sessionId]);
}
