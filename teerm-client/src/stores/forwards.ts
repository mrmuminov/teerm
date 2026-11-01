import { useEffect } from "react";
import { toast } from "sonner";
import { create } from "zustand";

import { listenForwardStatus } from "@/lib/events";
import {
  errorMessage,
  ipc,
  type ForwardState,
  type ForwardStatus,
} from "@/lib/ipc";
import { tr } from "@/lib/translate";

export type ForwardRuntime = {
  state: ForwardState;
  message: string | null;
};

type ForwardsStore = {
  /** Runtime state keyed by SSH session id, then by Port Forward id. */
  bySession: Record<string, Record<string, ForwardRuntime>>;
  handleStatus: (event: ForwardStatus) => void;
  refresh: (sessionId: string) => Promise<void>;
  start: (sessionId: string, forwardId: string) => Promise<void>;
  stop: (sessionId: string, forwardId: string) => Promise<void>;
};

export const useForwardsStore = create<ForwardsStore>((set) => ({
  bySession: {},

  handleStatus: (event) =>
    set((state) => ({
      bySession: {
        ...state.bySession,
        [event.sessionId]: {
          ...state.bySession[event.sessionId],
          [event.forwardId]: { state: event.state, message: event.message },
        },
      },
    })),

  refresh: async (sessionId) => {
    try {
      const statuses = await ipc.forwardsStatus(sessionId);
      set((state) => ({
        bySession: {
          ...state.bySession,
          [sessionId]: Object.fromEntries(
            statuses.map((status) => [
              status.forwardId,
              { state: status.state, message: status.message },
            ]),
          ),
        },
      }));
    } catch {
      // The Session may have just closed; the status event will follow.
    }
  },

  start: async (sessionId, forwardId) => {
    try {
      await ipc.forwardStart(sessionId, forwardId);
    } catch (error) {
      toast.error(tr("Could not start the port forward: {error}", { error: errorMessage(error) }));
    }
  },

  stop: async (sessionId, forwardId) => {
    try {
      await ipc.forwardStop(sessionId, forwardId);
    } catch (error) {
      toast.error(tr("Could not stop the port forward: {error}", { error: errorMessage(error) }));
    }
  },
}));

export function useForwardEventBridge(): void {
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void listenForwardStatus((event) => {
      useForwardsStore.getState().handleStatus(event);
      if (event.state === "failed" && event.message) {
        toast.error(tr("Port forward failed: {message}", { message: event.message }));
      }
    })
      .then((dispose) => {
        if (disposed) {
          dispose();
        } else {
          unlisten = dispose;
        }
      })
      .catch((error: unknown) => {
        console.warn(
          `[teerm] Port forward listener unavailable: ${errorMessage(error)}`,
        );
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
