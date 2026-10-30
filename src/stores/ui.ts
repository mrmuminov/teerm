import { create } from "zustand";

import type { Section } from "@/lib/navigation";

type UiStore = {
  section: Section;
  setSection: (section: Section) => void;
  selectedHostId: string | null;
  selectHost: (id: string | null) => void;
  activeSessionId: string | null;
  focusSession: (sessionId: string, hostId?: string | null) => void;
  activateSession: (sessionId: string | null) => void;
  hostSheet: { open: boolean; hostId: string | null };
  openHostSheet: (hostId?: string | null) => void;
  closeHostSheet: () => void;
  keyDialog: { open: boolean; mode: "import" | "generate" };
  openKeyDialog: (mode: "import" | "generate") => void;
  closeKeyDialog: () => void;
};

export const useUiStore = create<UiStore>()((set) => ({
  section: "hosts",
  setSection: (section) => set({ section }),
  selectedHostId: null,
  selectHost: (selectedHostId) =>
    set({ selectedHostId, activeSessionId: null }),
  activeSessionId: null,
  focusSession: (activeSessionId, hostId) =>
    set(
      hostId === undefined
        ? { activeSessionId }
        : { activeSessionId, selectedHostId: hostId },
    ),
  activateSession: (activeSessionId) => set({ activeSessionId }),
  hostSheet: { open: false, hostId: null },
  openHostSheet: (hostId = null) =>
    set({ hostSheet: { open: true, hostId } }),
  closeHostSheet: () => set({ hostSheet: { open: false, hostId: null } }),
  keyDialog: { open: false, mode: "import" },
  openKeyDialog: (mode) => set({ keyDialog: { open: true, mode } }),
  closeKeyDialog: () =>
    set({ keyDialog: { open: false, mode: "import" } }),
}));
