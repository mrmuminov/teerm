import { listen } from "@tauri-apps/api/event";

import type { ForwardStatus, TransferProgress } from "@/lib/ipc";

export type SshDataEvent = {
  sessionId: string;
  data: string;
};

export type SshClosedEvent = {
  sessionId: string;
  reason: string;
};

export type SshAuthPromptEvent = {
  sessionId: string;
  name: string;
  instructions: string;
  prompts: { prompt: string; echo: boolean }[];
};

type DevEventBus = {
  listen: (
    event: string,
    handler: (payload: unknown) => void,
  ) => Promise<() => void>;
  emit: (event: string, payload: unknown) => void;
};

function devEventBus(): DevEventBus | null {
  if (typeof window === "undefined") {
    return null;
  }

  return (
    (window as unknown as { __TEERM_DEV_EVENTS__?: DevEventBus })
      .__TEERM_DEV_EVENTS__ ?? null
  );
}

function subscribe<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  const bus = devEventBus();

  if (bus) {
    return bus.listen(event, (payload) => handler(payload as T));
  }

  return listen<T>(event, (received) => handler(received.payload));
}

export function listenSshData(
  handler: (event: SshDataEvent) => void,
): Promise<() => void> {
  return subscribe("ssh:data", handler);
}

export function listenSshClosed(
  handler: (event: SshClosedEvent) => void,
): Promise<() => void> {
  return subscribe("ssh:closed", handler);
}

export function listenSshAuthPrompt(
  handler: (event: SshAuthPromptEvent) => void,
): Promise<() => void> {
  return subscribe("ssh:auth-prompt", handler);
}

export function listenTransferProgress(
  handler: (event: TransferProgress) => void,
): Promise<() => void> {
  return subscribe("transfer://progress", handler);
}

export function listenForwardStatus(
  handler: (event: ForwardStatus) => void,
): Promise<() => void> {
  return subscribe("ssh:forward-status", handler);
}
