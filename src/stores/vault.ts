import { create } from "zustand";

import { errorMessage, ipc, type VaultStatus } from "@/lib/ipc";

export type VaultPhase =
  | "loading"
  | "onboarding"
  | "locked"
  | "unlocked"
  | "error";

type VaultStore = {
  phase: VaultPhase;
  status: VaultStatus | null;
  busy: boolean;
  error: string | null;
  init: () => Promise<void>;
  create: (password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  lock: () => Promise<void>;
  clearError: () => void;
};

export const useVaultStore = create<VaultStore>()((set) => ({
  phase: "loading",
  status: null,
  busy: false,
  error: null,

  init: async () => {
    set({ phase: "loading", error: null });

    try {
      const status = await ipc.vaultStatus();
      set({
        status,
        phase: !status.exists
          ? "onboarding"
          : status.unlocked
            ? "unlocked"
            : "locked",
      });
    } catch (error) {
      set({ phase: "error", error: errorMessage(error) });
    }
  },

  create: async (password) => {
    set({ busy: true, error: null });

    try {
      await ipc.vaultCreate(password);
      set({
        busy: false,
        phase: "unlocked",
        status: { exists: true, unlocked: true },
      });
    } catch (error) {
      set({ busy: false, error: errorMessage(error) });
    }
  },

  unlock: async (password) => {
    set({ busy: true, error: null });

    try {
      await ipc.vaultUnlock(password);
      set({
        busy: false,
        phase: "unlocked",
        status: { exists: true, unlocked: true },
      });
    } catch (error) {
      set({ busy: false, error: errorMessage(error) });
    }
  },

  lock: async () => {
    try {
      await ipc.vaultLock();
      set({
        phase: "locked",
        status: { exists: true, unlocked: false },
        error: null,
      });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },

  clearError: () => set({ error: null }),
}));
