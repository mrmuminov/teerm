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
  /**
   * The Recovery Phrase of a Vault that was just created. It is shown once
   * and held only until the user confirms they wrote it down.
   */
  recoveryPhrase: string | null;
  init: () => Promise<void>;
  create: (password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  lock: () => Promise<void>;
  /** Re-reads the status, e.g. after the Recovery Phrase was set up. */
  refreshStatus: () => Promise<void>;
  /** Shows the Recovery Phrase of a freshly created Vault. */
  showRecoveryPhrase: (phrase: string) => void;
  dismissRecoveryPhrase: () => void;
  clearError: () => void;
};

async function readStatus(fallback: VaultStatus): Promise<VaultStatus> {
  try {
    return await ipc.vaultStatus();
  } catch {
    return fallback;
  }
}

export const useVaultStore = create<VaultStore>()((set) => ({
  phase: "loading",
  status: null,
  busy: false,
  error: null,
  recoveryPhrase: null,

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
      const recoveryPhrase = await ipc.vaultCreate(password);
      set({
        busy: false,
        recoveryPhrase,
        phase: "unlocked",
        status: await readStatus({
          exists: true,
          unlocked: true,
          recovery_enabled: false,
        }),
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
        status: await readStatus({
          exists: true,
          unlocked: true,
          recovery_enabled: false,
        }),
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
        status: await readStatus({
          exists: true,
          unlocked: false,
          recovery_enabled: false,
        }),
        error: null,
      });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },

  refreshStatus: async () => {
    const current = useVaultStore.getState().status;
    if (current) {
      set({ status: await readStatus(current) });
    }
  },

  showRecoveryPhrase: (phrase) => set({ recoveryPhrase: phrase }),

  dismissRecoveryPhrase: () => set({ recoveryPhrase: null }),

  clearError: () => set({ error: null }),
}));
