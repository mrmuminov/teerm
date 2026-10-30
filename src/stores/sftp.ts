import { useEffect } from "react";
import { toast } from "sonner";
import { create } from "zustand";

import { listenTransferProgress } from "@/lib/events";
import {
  errorMessage,
  ipc,
  type SftpEntry,
  type TransferProgress,
  type TransferState,
} from "@/lib/ipc";

export type SftpTabState = {
  visible: boolean;
  sessionId: string | null;
  path: string;
  entries: SftpEntry[];
  loading: boolean;
  error: string | null;
};

export type TransferRecord = {
  id: string;
  tabId: string;
  sessionId: string;
  direction: "upload" | "download";
  name: string;
  localPath: string;
  remotePath: string;
  transferred: number;
  total: number;
  state: TransferState;
  message: string | null;
  startedAt: number;
};

type SftpStore = {
  tabs: Record<string, SftpTabState>;
  transfers: TransferRecord[];
  width: number;

  toggle: (tabId: string, sessionId: string) => Promise<void>;
  show: (tabId: string, sessionId: string) => Promise<void>;
  hide: (tabId: string) => void;
  refresh: (tabId: string, sessionId: string) => Promise<void>;
  navigate: (tabId: string, sessionId: string, path: string) => Promise<void>;
  goUp: (tabId: string, sessionId: string) => Promise<void>;
  mkdir: (tabId: string, sessionId: string, name: string) => Promise<boolean>;
  rename: (
    tabId: string,
    sessionId: string,
    entry: SftpEntry,
    name: string,
  ) => Promise<boolean>;
  remove: (
    tabId: string,
    sessionId: string,
    entry: SftpEntry,
  ) => Promise<boolean>;
  addUploads: (
    tabId: string,
    sessionId: string,
    localPaths: string[],
  ) => Promise<void>;
  addDownload: (
    tabId: string,
    sessionId: string,
    entry: SftpEntry,
    localDir: string,
  ) => Promise<void>;
  cancelTransfer: (transferId: string) => Promise<void>;
  dismissTransfer: (transferId: string) => void;
  handleProgress: (event: TransferProgress) => void;
  clearFinished: (tabId?: string) => void;
  setWidth: (width: number) => void;
  resetTab: (tabId: string) => void;
  resetAll: () => void;
};

const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 280;
const MAX_WIDTH = 600;
const MAX_PENDING_PROGRESS = 200;

/**
 * Transfers can finish before the `invoke` that created them resolves, so the
 * first `transfer://progress` events may arrive while no record exists yet.
 * Keep the latest event per id and replay it once the record is inserted.
 */
const pendingProgress = new Map<string, TransferProgress>();

function rememberPendingProgress(event: TransferProgress): void {
  if (!event?.transferId) {
    return;
  }

  pendingProgress.delete(event.transferId);
  pendingProgress.set(event.transferId, event);

  while (pendingProgress.size > MAX_PENDING_PROGRESS) {
    const oldest = pendingProgress.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    pendingProgress.delete(oldest);
  }
}

function takePendingProgress(transferId: string): TransferProgress | null {
  const event = pendingProgress.get(transferId);
  if (!event) {
    return null;
  }
  pendingProgress.delete(transferId);
  return event;
}

/**
 * Per-tab request generation. A late response is only committed when its
 * generation is still the newest one for that tab.
 */
const requestTokens = new Map<string, number>();

function nextToken(tabId: string): number {
  const next = (requestTokens.get(tabId) ?? 0) + 1;
  requestTokens.set(tabId, next);
  return next;
}

function isCurrentToken(tabId: string, token: number): boolean {
  return requestTokens.get(tabId) === token;
}

function clampWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return DEFAULT_WIDTH;
  }

  return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)));
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function dirname(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  if (!trimmed || trimmed === "/") {
    return "/";
  }

  const index = trimmed.lastIndexOf("/");
  return index <= 0 ? "/" : trimmed.slice(0, index);
}

function joinRemote(base: string, name: string): string {
  const directory = base.startsWith("/") ? base : `/${base}`;
  return `${directory === "/" ? "" : directory.replace(/\/+$/, "")}/${name}`;
}

function joinLocal(directory: string, name: string): string {
  const separator = directory.includes("\\") && !directory.includes("/")
    ? "\\"
    : "/";
  return `${directory.replace(/[\\/]+$/, "")}${separator}${name}`;
}

function cleanName(name: string): string | null {
  const trimmed = name.trim();
  if (
    !trimmed ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("/") ||
    trimmed.includes("\0")
  ) {
    return null;
  }
  return trimmed;
}

function terminalState(state: TransferState): boolean {
  return state === "completed" || state === "cancelled" || state === "failed";
}

export const useSftpStore = create<SftpStore>()((set, get) => ({
  tabs: {},
  transfers: [],
  width: DEFAULT_WIDTH,

  toggle: async (tabId, sessionId) => {
    if (get().tabs[tabId]?.visible) {
      get().hide(tabId);
      return;
    }

    await get().show(tabId, sessionId);
  },

  show: async (tabId, sessionId) => {
    if (!sessionId) {
      return;
    }

    const existing = get().tabs[tabId];
    const sameSession = existing?.sessionId === sessionId;
    const token = nextToken(tabId);

    if (!sameSession) {
      set((state) => ({
        tabs: {
          ...state.tabs,
          [tabId]: {
            visible: true,
            sessionId,
            path: "/",
            entries: [],
            loading: true,
            error: null,
          },
        },
      }));
    } else {
      set((state) => {
        const current = state.tabs[tabId];
        if (!current) {
          return {};
        }
        return {
          tabs: {
            ...state.tabs,
            [tabId]: { ...current, visible: true, loading: true, error: null },
          },
        };
      });
    }

    try {
      let path = existing?.path || "/";

      if (!sameSession) {
        const opened = await ipc.sftpOpen(sessionId);
        if (!isCurrentToken(tabId, token)) {
          return;
        }
        path = opened?.path?.trim() || "/";

        // Make the canonical home path visible before the first listing so a
        // failed list retries against the home directory, not "/".
        set((state) => {
          const current = state.tabs[tabId];
          if (
            !current ||
            !current.visible ||
            current.sessionId !== sessionId
          ) {
            return {};
          }
          return {
            tabs: {
              ...state.tabs,
              [tabId]: { ...current, path },
            },
          };
        });
      }

      const entries = await ipc.sftpList(sessionId, path);
      if (!isCurrentToken(tabId, token)) {
        return;
      }

      set((state) => {
        const current = state.tabs[tabId];
        if (
          !current ||
          !current.visible ||
          current.sessionId !== sessionId
        ) {
          return {};
        }
        return {
          tabs: {
            ...state.tabs,
            [tabId]: {
              ...current,
              path,
              entries,
              loading: false,
              error: null,
            },
          },
        };
      });
    } catch (error) {
      if (!isCurrentToken(tabId, token)) {
        return;
      }

      set((state) => {
        const current = state.tabs[tabId];
        if (!current || current.sessionId !== sessionId) {
          return {};
        }
        return {
          tabs: {
            ...state.tabs,
            [tabId]: {
              ...current,
              loading: false,
              error: errorMessage(error),
            },
          },
        };
      });
    }
  },

  hide: (tabId) => {
    nextToken(tabId);
    set((state) => {
      const current = state.tabs[tabId];
      if (!current) {
        return {};
      }
      return {
        tabs: {
          ...state.tabs,
          [tabId]: { ...current, visible: false },
        },
      };
    });
  },

  refresh: async (tabId, sessionId) => {
    const current = get().tabs[tabId];
    if (!current || current.sessionId !== sessionId) {
      return;
    }

    const path = current.path || "/";
    const token = nextToken(tabId);

    set((state) => {
      const tab = state.tabs[tabId];
      if (!tab) {
        return {};
      }
      return {
        tabs: {
          ...state.tabs,
          [tabId]: { ...tab, loading: true, error: null },
        },
      };
    });

    try {
      const entries = await ipc.sftpList(sessionId, path);
      if (!isCurrentToken(tabId, token)) {
        return;
      }

      set((state) => {
        const tab = state.tabs[tabId];
        if (!tab || tab.sessionId !== sessionId || tab.path !== path) {
          return {};
        }
        return {
          tabs: {
            ...state.tabs,
            [tabId]: {
              ...tab,
              entries,
              loading: false,
              error: null,
            },
          },
        };
      });
    } catch (error) {
      if (!isCurrentToken(tabId, token)) {
        return;
      }

      set((state) => {
        const tab = state.tabs[tabId];
        if (!tab || tab.sessionId !== sessionId) {
          return {};
        }
        return {
          tabs: {
            ...state.tabs,
            [tabId]: {
              ...tab,
              loading: false,
              error: errorMessage(error),
            },
          },
        };
      });
    }
  },

  navigate: async (tabId, sessionId, path) => {
    const current = get().tabs[tabId];
    if (!current || current.sessionId !== sessionId) {
      return;
    }

    const target = path.startsWith("/") ? path : `/${path}`;
    if (target === current.path) {
      await get().refresh(tabId, sessionId);
      return;
    }

    const token = nextToken(tabId);

    set((state) => {
      const tab = state.tabs[tabId];
      if (!tab) {
        return {};
      }
      return {
        tabs: {
          ...state.tabs,
          [tabId]: { ...tab, loading: true, error: null },
        },
      };
    });

    try {
      const entries = await ipc.sftpList(sessionId, target);
      if (!isCurrentToken(tabId, token)) {
        return;
      }

      set((state) => {
        const tab = state.tabs[tabId];
        if (!tab || tab.sessionId !== sessionId) {
          return {};
        }
        return {
          tabs: {
            ...state.tabs,
            [tabId]: {
              ...tab,
              path: target,
              entries,
              loading: false,
              error: null,
            },
          },
        };
      });
    } catch (error) {
      if (!isCurrentToken(tabId, token)) {
        return;
      }

      set((state) => {
        const tab = state.tabs[tabId];
        if (!tab || tab.sessionId !== sessionId) {
          return {};
        }
        return {
          tabs: {
            ...state.tabs,
            [tabId]: {
              ...tab,
              loading: false,
              error: errorMessage(error),
            },
          },
        };
      });
    }
  },

  goUp: async (tabId, sessionId) => {
    const tab = get().tabs[tabId];
    if (!tab || tab.sessionId !== sessionId || tab.path === "/") {
      return;
    }

    await get().navigate(tabId, sessionId, dirname(tab.path));
  },

  mkdir: async (tabId, sessionId, name) => {
    const tab = get().tabs[tabId];
    const clean = cleanName(name);
    if (!tab || tab.sessionId !== sessionId || !clean) {
      if (!clean) {
        toast.error("Invalid folder name", {
          description: "Use a name without slashes.",
        });
      }
      return false;
    }

    try {
      await ipc.sftpMkdir(sessionId, joinRemote(tab.path, clean));
      await get().refresh(tabId, sessionId);
      return true;
    } catch (error) {
      toast.error("Could not create folder", {
        description: errorMessage(error),
      });
      return false;
    }
  },

  rename: async (tabId, sessionId, entry, name) => {
    const clean = cleanName(name);
    if (!clean) {
      toast.error("Invalid name", {
        description: "Use a name without slashes.",
      });
      return false;
    }

    if (clean === entry.name) {
      return true;
    }

    try {
      await ipc.sftpRename(
        sessionId,
        entry.path,
        joinRemote(dirname(entry.path), clean),
      );
      await get().refresh(tabId, sessionId);
      return true;
    } catch (error) {
      toast.error("Could not rename item", {
        description: errorMessage(error),
      });
      return false;
    }
  },

  remove: async (tabId, sessionId, entry) => {
    try {
      await ipc.sftpDelete(sessionId, entry.path, entry.isDir);
      await get().refresh(tabId, sessionId);
      return true;
    } catch (error) {
      toast.error(entry.isDir ? "Could not delete folder" : "Could not delete file", {
        description: errorMessage(error),
      });
      return false;
    }
  },

  addUploads: async (tabId, sessionId, localPaths) => {
    const tab = get().tabs[tabId];
    if (!tab || tab.sessionId !== sessionId) {
      return;
    }

    const directory = tab.path || "/";

    for (const localPath of localPaths) {
      if (!localPath?.trim()) {
        continue;
      }

      const name = basename(localPath);
      if (!name) {
        continue;
      }

      const remotePath = joinRemote(directory, name);

      try {
        const id = await ipc.sftpUpload(sessionId, localPath, remotePath);
        const current = get().tabs[tabId];
        if (!current || current.sessionId !== sessionId) {
          continue;
        }

        set((state) => ({
          transfers: [
            ...state.transfers,
            {
              id,
              tabId,
              sessionId,
              direction: "upload",
              name,
              localPath,
              remotePath,
              transferred: 0,
              total: 0,
              state: "running",
              message: null,
              startedAt: Date.now(),
            },
          ],
        }));

        const pending = takePendingProgress(id);
        if (pending) {
          get().handleProgress(pending);
        }
      } catch (error) {
        toast.error(`Could not upload ${name}`, {
          description: errorMessage(error),
        });
      }
    }
  },

  addDownload: async (tabId, sessionId, entry, localDir) => {
    const tab = get().tabs[tabId];
    if (!tab || tab.sessionId !== sessionId) {
      return;
    }

    if (entry.isDir) {
      toast.info("Folder download is not supported yet");
      return;
    }

    if (!localDir?.trim()) {
      toast.error("Choose a download folder first");
      return;
    }

    const localPath = joinLocal(localDir, entry.name);

    try {
      const id = await ipc.sftpDownload(sessionId, entry.path, localPath);
      set((state) => ({
        transfers: [
          ...state.transfers,
          {
            id,
            tabId,
            sessionId,
            direction: "download",
            name: entry.name,
            localPath,
            remotePath: entry.path,
            transferred: 0,
            total: entry.size,
            state: "running",
            message: null,
            startedAt: Date.now(),
          },
        ],
      }));

      const pending = takePendingProgress(id);
      if (pending) {
        get().handleProgress(pending);
      }
    } catch (error) {
      toast.error(`Could not download ${entry.name}`, {
        description: errorMessage(error),
      });
    }
  },

  cancelTransfer: async (transferId) => {
    try {
      await ipc.transferCancel(transferId);
    } catch (error) {
      toast.error("Could not cancel transfer", {
        description: errorMessage(error),
      });
    }
  },

  dismissTransfer: (transferId) => {
    pendingProgress.delete(transferId);
    set((state) => ({
      transfers: state.transfers.filter((transfer) => transfer.id !== transferId),
    }));
  },

  handleProgress: (event) => {
    const id = typeof event?.transferId === "string" ? event.transferId : "";
    if (!id) {
      return;
    }

    const existing = get().transfers.find((transfer) => transfer.id === id);
    if (!existing) {
      rememberPendingProgress(event);
      return;
    }

    if (terminalState(existing.state) && event.state === "running") {
      return;
    }

    const wasRunning = existing.state === "running";
    const transferred =
      Number.isFinite(event.transferred) && event.transferred >= 0
        ? event.transferred
        : existing.transferred;
    const total =
      Number.isFinite(event.total) && event.total >= 0
        ? event.total
        : existing.total;

    set((state) => ({
      transfers: state.transfers.map((transfer) =>
        transfer.id === id
          ? {
              ...transfer,
              transferred,
              total,
              state: event.state,
              message: event.message ?? null,
            }
          : transfer,
      ),
    }));

    if (!terminalState(event.state) || !wasRunning) {
      return;
    }

    const tab = get().tabs[existing.tabId];
    if (
      tab &&
      tab.sessionId === existing.sessionId &&
      tab.path === dirname(existing.remotePath)
    ) {
      void get().refresh(existing.tabId, existing.sessionId);
    }

    if (event.state === "failed") {
      toast.error("Transfer failed", {
        description: event.message?.trim() || existing.name,
      });
    }
  },

  clearFinished: (tabId) => {
    set((state) => ({
      transfers: state.transfers.filter(
        (transfer) =>
          transfer.state === "running" ||
          (tabId !== undefined && transfer.tabId !== tabId),
      ),
    }));
  },

  setWidth: (width) => {
    set({ width: clampWidth(width) });
  },

  resetTab: (tabId) => {
    requestTokens.delete(tabId);
    for (const transfer of get().transfers) {
      if (transfer.tabId === tabId) {
        pendingProgress.delete(transfer.id);
      }
    }
    set((state) => {
      const tabs = { ...state.tabs };
      delete tabs[tabId];
      return {
        tabs,
        transfers: state.transfers.filter(
          (transfer) => transfer.tabId !== tabId,
        ),
      };
    });
  },

  resetAll: () => {
    requestTokens.clear();
    pendingProgress.clear();
    set({ tabs: {}, transfers: [], width: DEFAULT_WIDTH });
  },
}));

export function useSftpEventBridge(): void {
  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    void listenTransferProgress((event) => {
      useSftpStore.getState().handleProgress(event);
    })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          unlisteners.push(unlisten);
        }
      })
      .catch((error: unknown) => {
        console.warn(
          `[teerm] SFTP transfer listener unavailable: ${errorMessage(error)}`,
        );
      });

    return () => {
      disposed = true;
      for (const unlisten of unlisteners.splice(0)) {
        try {
          unlisten();
        } catch {
          // Listener cleanup must never break unmounting.
        }
      }
    };
  }, []);
}
