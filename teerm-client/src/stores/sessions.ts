import { useEffect } from "react";
import { toast } from "sonner";
import { create } from "zustand";

import {
  listenSshAuthPrompt,
  listenSshClosed,
  listenSshData,
  type SshAuthPromptEvent,
  type SshClosedEvent,
  type SshDataEvent,
} from "@/lib/events";
import {
  errorMessage,
  ipc,
  isAppError,
  type AppError,
  type Host,
} from "@/lib/ipc";
import {
  clearTerminal,
  pushTerminalData,
  resetTerminalBus,
} from "@/lib/terminal-bus";
import { useInventoryStore } from "@/stores/inventory";
import { useSettingsStore } from "@/stores/settings";
import { useSftpStore } from "@/stores/sftp";
import { useUiStore } from "@/stores/ui";
import { tr } from "@/lib/translate";

export type SessionStatus =
  | "connecting"
  | "authenticating"
  | "connected"
  | "disconnected"
  | "error";

export type SessionTab = {
  id: string;
  sshSessionId: string | null;
  hostId: string;
  label: string;
  address: string;
  port: number;
  username: string;
  status: SessionStatus;
  message: string | null;
  keyType: string | null;
  fingerprint: string | null;
  createdAt: number;
};

export type SessionDialog =
  | {
      kind: "password";
      tabId: string;
      hostId: string;
      label: string;
      username: string;
      address: string;
      port: number;
      error: string | null;
      busy: boolean;
    }
  | {
      kind: "host-key";
      variant: "unknown" | "changed";
      tabId: string;
      hostId: string;
      label: string;
      address: string;
      port: number;
      keyType: string;
      fingerprint: string;
      knownFingerprint: string | null;
      /** Ephemeral password retained only so the retry can reuse it. Never render. */
      password: string | null;
      busy: boolean;
    }
  | {
      kind: "keyboard-interactive";
      tabId: string;
      hostId: string;
      label: string;
      name: string;
      instructions: string;
      prompts: { prompt: string; echo: boolean }[];
      busy: boolean;
    };

type SessionsStore = {
  tabs: SessionTab[];
  dialog: SessionDialog | null;
  connect: (host: Host) => Promise<void>;
  reconnect: (tabId: string) => Promise<void>;
  closeSession: (tabId: string) => Promise<void>;
  submitPassword: (tabId: string, password: string) => Promise<void>;
  acceptHostKey: (tabId: string) => Promise<void>;
  replaceHostKey: (tabId: string) => Promise<void>;
  cancelDialog: () => Promise<void>;
  submitAuthResponses: (tabId: string, responses: string[]) => Promise<void>;
  resetSessions: () => void;
};

type AttemptOptions = {
  host?: Host | null;
  password?: string | null;
  acceptNewHost?: boolean;
  replaceHostKey?: boolean;
  status?: "connecting" | "authenticating";
};

const connectedTabs = new Set<string>();
const terminalEncoder = new TextEncoder();

function displayLabel(host: Host): string {
  return host.label.trim() || host.address;
}

function needsPassword(host: Host): boolean {
  return !host.key_id && !host.has_password;
}

function passwordDialogFor(
  tab: SessionTab,
  error: string | null,
): SessionDialog {
  return {
    kind: "password",
    tabId: tab.id,
    hostId: tab.hostId,
    label: tab.label,
    username: tab.username,
    address: tab.address,
    port: tab.port,
    error,
    busy: false,
  };
}

function hostKeyDialogFor(
  tab: SessionTab,
  error: AppError,
  variant: "unknown" | "changed",
  password: string | null,
): SessionDialog {
  return {
    kind: "host-key",
    variant,
    tabId: tab.id,
    hostId: tab.hostId,
    label: tab.label,
    address: error.address ?? tab.address,
    port: error.port ?? tab.port,
    keyType: error.key_type ?? "unknown",
    fingerprint: error.fingerprint ?? "unknown",
    knownFingerprint:
      variant === "changed" ? (error.known_fingerprint ?? "unknown") : null,
    password,
    busy: false,
  };
}

export const useSessionsStore = create<SessionsStore>()((set, get) => {
  function handleAttemptError(
    tab: SessionTab,
    error: unknown,
    password: string | null,
  ): void {
    if (isAppError(error)) {
      if (error.code === "host_key_unknown" || error.code === "host_key_changed") {
        const variant =
          error.code === "host_key_changed" ? "changed" : "unknown";

        if (
          variant === "unknown" &&
          useSettingsStore.getState().settings?.strict_host_key_checking
        ) {
          const message =
            "Host key is not trusted. Strict host key checking is enabled, so the connection was rejected.";
          set((state) => ({
            tabs: state.tabs.map((item) =>
              item.id === tab.id
                ? {
                    ...item,
                    sshSessionId: null,
                    status: "error",
                    message,
                  }
                : item,
            ),
            dialog: state.dialog?.tabId === tab.id ? null : state.dialog,
          }));
          toast.error(tr("Host key rejected"), { description: message });
          return;
        }

        set((state) => ({
          tabs: state.tabs.map((item) =>
            item.id === tab.id
              ? {
                  ...item,
                  sshSessionId: null,
                  status: "connecting",
                  message: null,
                }
              : item,
          ),
          dialog: hostKeyDialogFor(tab, error, variant, password),
        }));
        return;
      }

      if (error.code === "password_required" || error.code === "auth_failed") {
        set((state) => ({
          tabs: state.tabs.map((item) =>
            item.id === tab.id
              ? {
                  ...item,
                  sshSessionId: null,
                  status: "authenticating",
                  message: null,
                }
              : item,
          ),
          dialog: passwordDialogFor(
            tab,
            error.code === "auth_failed"
              ? "Authentication failed. Check the password and try again."
              : null,
          ),
        }));
        return;
      }
    }

    const message = errorMessage(error);
    set((state) => ({
      tabs: state.tabs.map((item) =>
        item.id === tab.id
          ? {
              ...item,
              sshSessionId: null,
              status: "error",
              message,
            }
          : item,
      ),
      dialog: state.dialog?.tabId === tab.id ? null : state.dialog,
    }));
    toast.error(tr("Could not open session"), { description: message });
  }

  async function runAttempt(
    tabId: string,
    options: AttemptOptions = {},
  ): Promise<void> {
    const tab = get().tabs.find((item) => item.id === tabId);
    if (!tab) {
      return;
    }

    const host =
      options.host ??
      useInventoryStore
        .getState()
        .hosts.find((item) => item.id === tab.hostId) ??
      null;
    const sessionId = crypto.randomUUID();
    const password = options.password ?? null;
    const status = options.status ?? "connecting";
    const identity = host
      ? {
          label: displayLabel(host),
          address: host.address,
          port: host.port,
          username: host.username,
        }
      : {};

    // A new backend session (including a reconnect) owns a fresh SFTP
    // channel; any panel state from the previous one is no longer valid.
    useSftpStore.getState().resetTab(tabId);

    set((state) => ({
      tabs: state.tabs.map((item) =>
        item.id === tabId
          ? {
              ...item,
              ...identity,
              sshSessionId: sessionId,
              status,
              message: null,
            }
          : item,
      ),
    }));

    try {
      const opened = await ipc.sessionOpen({
        sessionId,
        hostId: tab.hostId,
        password,
        acceptNewHost: Boolean(options.acceptNewHost),
        replaceHostKey: Boolean(options.replaceHostKey),
        cols: 120,
        rows: 32,
      });

      const current = get().tabs.find((item) => item.id === tabId);
      if (!current || current.sshSessionId !== sessionId) {
        // A newer attempt or a close won the race. Do not leak this backend
        // session if it finished opening after the tab moved on.
        void ipc.sessionClose(opened.sessionId).catch(() => {});
        return;
      }

      connectedTabs.add(tabId);
      set((state) => ({
        tabs: state.tabs.map((item) =>
          item.id === tabId
            ? {
                ...item,
                sshSessionId: opened.sessionId || sessionId,
                status: "connected",
                message: null,
                keyType: opened.keyType ?? null,
                fingerprint: opened.fingerprint ?? null,
              }
            : item,
        ),
        dialog: state.dialog?.tabId === tabId ? null : state.dialog,
      }));
    } catch (error) {
      const current = get().tabs.find((item) => item.id === tabId);
      if (!current || current.sshSessionId !== sessionId) {
        return;
      }
      handleAttemptError(current, error, password);
    }
  }

  return {
    tabs: [],
    dialog: null,

    connect: async (host) => {
      const tabId = crypto.randomUUID();
      const requiresPassword = needsPassword(host);
      const tab: SessionTab = {
        id: tabId,
        sshSessionId: null,
        hostId: host.id,
        label: displayLabel(host),
        address: host.address,
        port: host.port,
        username: host.username,
        status: requiresPassword ? "authenticating" : "connecting",
        message: null,
        keyType: null,
        fingerprint: null,
        createdAt: Date.now(),
      };

      set((state) => ({ tabs: [...state.tabs, tab] }));
      useUiStore.getState().focusSession(tabId, host.id);

      if (requiresPassword) {
        set({ dialog: passwordDialogFor(tab, null) });
        return;
      }

      await runAttempt(tabId, { host });
    },

    reconnect: async (tabId) => {
      const tab = get().tabs.find((item) => item.id === tabId);
      if (!tab) {
        return;
      }

      const host =
        useInventoryStore
          .getState()
          .hosts.find((item) => item.id === tab.hostId) ?? null;
      const identity = host
        ? {
            label: displayLabel(host),
            address: host.address,
            port: host.port,
            username: host.username,
          }
        : {};

      if (tab.sshSessionId) {
        void ipc.sessionClose(tab.sshSessionId).catch(() => {});
      }

      set((state) => ({
        tabs: state.tabs.map((item) =>
          item.id === tabId
            ? {
                ...item,
                ...identity,
                sshSessionId: null,
                status: "connecting",
                message: null,
              }
            : item,
        ),
        dialog: state.dialog?.tabId === tabId ? null : state.dialog,
      }));

      if (host && needsPassword(host)) {
        const current = get().tabs.find((item) => item.id === tabId);
        if (!current) {
          return;
        }

        set((state) => ({
          tabs: state.tabs.map((item) =>
            item.id === tabId ? { ...item, status: "authenticating" } : item,
          ),
          dialog: passwordDialogFor(current, null),
        }));
        return;
      }

      await runAttempt(tabId, { host });
    },

    closeSession: async (tabId) => {
      const tabs = get().tabs;
      const index = tabs.findIndex((tab) => tab.id === tabId);
      if (index === -1) {
        return;
      }

      const tab = tabs[index];
      if (tab.sshSessionId) {
        void ipc.sessionClose(tab.sshSessionId).catch(() => {});
      }
      useSftpStore.getState().resetTab(tabId);

      const remaining = tabs.filter((item) => item.id !== tabId);

      set((state) => ({
        tabs: state.tabs.filter((item) => item.id !== tabId),
        dialog: state.dialog?.tabId === tabId ? null : state.dialog,
      }));
      clearTerminal(tabId);
      connectedTabs.delete(tabId);

      if (useUiStore.getState().activeSessionId === tabId) {
        const neighbour = remaining[index] ?? remaining[index - 1] ?? null;

        if (neighbour) {
          useUiStore.getState().focusSession(neighbour.id, neighbour.hostId);
        } else {
          useUiStore.getState().selectHost(null);
        }
      }
    },

    submitPassword: async (tabId, password) => {
      const dialog = get().dialog;
      if (
        !dialog ||
        dialog.kind !== "password" ||
        dialog.tabId !== tabId ||
        dialog.busy
      ) {
        return;
      }

      set((state) => {
        const current = state.dialog;
        if (
          !current ||
          current.kind !== "password" ||
          current.tabId !== tabId
        ) {
          return {};
        }
        return { dialog: { ...current, busy: true, error: null } };
      });

      await runAttempt(tabId, { password, status: "authenticating" });
    },

    acceptHostKey: async (tabId) => {
      const dialog = get().dialog;
      if (
        !dialog ||
        dialog.kind !== "host-key" ||
        dialog.variant !== "unknown" ||
        dialog.tabId !== tabId ||
        dialog.busy
      ) {
        return;
      }

      set((state) => {
        const current = state.dialog;
        if (!current || current.kind !== "host-key" || current.tabId !== tabId) {
          return {};
        }
        return { dialog: { ...current, busy: true } };
      });

      await runAttempt(tabId, {
        password: dialog.password,
        acceptNewHost: true,
      });
    },

    replaceHostKey: async (tabId) => {
      const dialog = get().dialog;
      if (
        !dialog ||
        dialog.kind !== "host-key" ||
        dialog.variant !== "changed" ||
        dialog.tabId !== tabId ||
        dialog.busy
      ) {
        return;
      }

      set((state) => {
        const current = state.dialog;
        if (!current || current.kind !== "host-key" || current.tabId !== tabId) {
          return {};
        }
        return { dialog: { ...current, busy: true } };
      });

      await runAttempt(tabId, {
        password: dialog.password,
        replaceHostKey: true,
      });
    },

    cancelDialog: async () => {
      const dialog = get().dialog;
      if (!dialog) {
        return;
      }

      const tab = get().tabs.find((item) => item.id === dialog.tabId) ?? null;
      const wasConnected = connectedTabs.has(dialog.tabId);
      const sessionId = tab?.sshSessionId ?? null;

      if (dialog.kind === "keyboard-interactive" && sessionId) {
        set((state) => ({
          tabs: state.tabs.map((item) => {
            if (item.id !== dialog.tabId || item.status === "connected") {
              return item;
            }
            return {
              ...item,
              sshSessionId: null,
              status: wasConnected ? "disconnected" : "error",
              message: tr("Connection cancelled"),
            };
          }),
          dialog: state.dialog?.tabId === dialog.tabId ? null : state.dialog,
        }));

        try {
          await ipc.sessionAuthRespond(sessionId, null);
        } catch {
          // The session may already be gone; cancellation is still complete.
        }
        return;
      }

      set((state) => ({
        tabs: state.tabs.map((item) => {
          if (item.id !== dialog.tabId || item.status === "connected") {
            return item;
          }
          return {
            ...item,
            sshSessionId: null,
            status: wasConnected ? "disconnected" : "error",
            message: tr("Connection cancelled"),
          };
        }),
        dialog: state.dialog?.tabId === dialog.tabId ? null : state.dialog,
      }));
    },

    submitAuthResponses: async (tabId, responses) => {
      const dialog = get().dialog;
      if (
        !dialog ||
        dialog.kind !== "keyboard-interactive" ||
        dialog.tabId !== tabId ||
        dialog.busy
      ) {
        return;
      }

      const tab = get().tabs.find((item) => item.id === tabId);
      if (!tab?.sshSessionId) {
        set((state) => ({
          tabs: state.tabs.map((item) =>
            item.id === tabId
              ? {
                  ...item,
                  sshSessionId: null,
                  status: "error",
                  message: tr("Authentication cancelled"),
                }
              : item,
          ),
          dialog: state.dialog?.tabId === tabId ? null : state.dialog,
        }));
        return;
      }

      const sessionId = tab.sshSessionId;

      set((state) => {
        const current = state.dialog;
        if (
          !current ||
          current.kind !== "keyboard-interactive" ||
          current.tabId !== tabId
        ) {
          return {};
        }
        return { dialog: { ...current, busy: true } };
      });

      try {
        await ipc.sessionAuthRespond(sessionId, responses);
      } catch (error) {
        const current = get().tabs.find((item) => item.id === tabId);
        if (!current || current.sshSessionId !== sessionId) {
          return;
        }

        const message = errorMessage(error);
        set((state) => ({
          tabs: state.tabs.map((item) =>
            item.id === tabId
              ? {
                  ...item,
                  sshSessionId: null,
                  status: "error",
                  message,
                }
              : item,
          ),
          dialog: state.dialog?.tabId === tabId ? null : state.dialog,
        }));
      }
    },

    resetSessions: () => {
      set({ tabs: [], dialog: null });
      connectedTabs.clear();
      resetTerminalBus();
      useSftpStore.getState().resetAll();
      useUiStore.getState().selectHost(null);
    },
  };
});

function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  } catch {
    return null;
  }
}

function findTabBySession(sessionId: string): SessionTab | undefined {
  if (!sessionId) {
    return undefined;
  }

  return useSessionsStore
    .getState()
    .tabs.find((tab) => tab.sshSessionId === sessionId);
}

function sanitizeReason(reason: string): string {
  return reason
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .trim()
    .slice(0, 160);
}

function handleSshData(event: SshDataEvent): void {
  const tab = findTabBySession(event.sessionId);
  if (!tab) {
    return;
  }

  const bytes = decodeBase64(event.data);
  if (bytes) {
    pushTerminalData(tab.id, bytes);
  }
}

function handleSshClosed(event: SshClosedEvent): void {
  const tab = findTabBySession(event.sessionId);
  if (!tab) {
    return;
  }

  const reason = typeof event.reason === "string" ? event.reason.trim() : "";
  const message = reason || "Connection closed";

  useSessionsStore.setState((state) => ({
    tabs: state.tabs.map((item) =>
      item.id === tab.id
        ? {
            ...item,
            sshSessionId: null,
            status: "disconnected",
            message,
          }
        : item,
    ),
    dialog: state.dialog?.tabId === tab.id ? null : state.dialog,
  }));

  useSftpStore.getState().resetTab(tab.id);

  const safeReason = sanitizeReason(reason);
  const notice = safeReason
    ? `\r\n\x1b[2m● Connection closed — ${safeReason}\x1b[0m\r\n`
    : "\r\n\x1b[2m● Connection closed\x1b[0m\r\n";
  pushTerminalData(tab.id, terminalEncoder.encode(notice));
}

function handleSshAuthPrompt(event: SshAuthPromptEvent): void {
  const tab = findTabBySession(event.sessionId);
  if (!tab) {
    return;
  }

  const prompts = Array.isArray(event.prompts)
    ? event.prompts.map((prompt) => ({
        prompt: typeof prompt?.prompt === "string" ? prompt.prompt : "",
        echo: Boolean(prompt?.echo),
      }))
    : [];

  useSessionsStore.setState((state) => ({
    tabs: state.tabs.map((item) =>
      item.id === tab.id
        ? { ...item, status: "authenticating", message: null }
        : item,
    ),
    dialog: {
      kind: "keyboard-interactive" as const,
      tabId: tab.id,
      hostId: tab.hostId,
      label: tab.label,
      name: typeof event.name === "string" ? event.name : "",
      instructions:
        typeof event.instructions === "string" ? event.instructions : "",
      prompts,
      busy: false,
    },
  }));
}

export function useSessionEventBridge(): void {
  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    function register(subscription: Promise<() => void>) {
      void subscription
        .then((unlisten) => {
          if (disposed) {
            unlisten();
          } else {
            unlisteners.push(unlisten);
          }
        })
        .catch((error: unknown) => {
          console.warn(
            `[teerm] SSH event listener unavailable: ${errorMessage(error)}`,
          );
        });
    }

    register(listenSshData(handleSshData));
    register(listenSshClosed(handleSshClosed));
    register(listenSshAuthPrompt(handleSshAuthPrompt));

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
