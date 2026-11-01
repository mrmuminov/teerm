import { create } from "zustand";

import {
  errorMessage,
  ipc,
  type AppInfo,
  type Settings,
} from "@/lib/ipc";

type SettingsStore = {
  settings: Settings | null;
  appInfo: AppInfo | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  load: (force?: boolean) => Promise<void>;
  update: (patch: Partial<Settings>) => Promise<boolean>;
  clearError: () => void;
};

export const useSettingsStore = create<SettingsStore>()((set, get) => ({
  settings: null,
  appInfo: null,
  loaded: false,
  loading: false,
  error: null,

  load: async (force = false) => {
    if (get().loaded && !force) {
      return;
    }

    set({ loading: true, error: null });

    try {
      const [settings, appInfo] = await Promise.all([
        ipc.settingsGet(),
        ipc.appInfo(),
      ]);
      set({ settings, appInfo, loaded: true, loading: false });
    } catch (error) {
      set({ loading: false, error: errorMessage(error) });
    }
  },

  update: async (patch) => {
    const current = get().settings;
    if (!current) {
      return false;
    }

    const next = { ...current, ...patch };
    set({ settings: next, error: null });

    try {
      const saved = await ipc.settingsUpdate(next);
      set({ settings: saved });
      return true;
    } catch (error) {
      set({ settings: current, error: errorMessage(error) });
      return false;
    }
  },

  clearError: () => set({ error: null }),
}));
