type TerminalWriter = (bytes: Uint8Array) => void;

const writers = new Map<string, Set<TerminalWriter>>();
const pending = new Map<string, Uint8Array[]>();

/**
 * Attaches a terminal writer to a session tab and flushes any output that
 * arrived while the tab had no terminal mounted. Returns an unsubscribe
 * function that only removes this particular writer.
 */
export function attachTerminal(
  tabId: string,
  write: TerminalWriter,
): () => void {
  let targets = writers.get(tabId);
  if (!targets) {
    targets = new Set<TerminalWriter>();
    writers.set(tabId, targets);
  }
  targets.add(write);

  const buffered = pending.get(tabId);
  if (buffered) {
    pending.delete(tabId);
    for (const chunk of buffered) {
      try {
        write(chunk);
      } catch {
        // A writer that is already tearing down must not block the others.
      }
    }
  }

  return () => {
    const current = writers.get(tabId);
    if (!current) {
      return;
    }

    current.delete(write);
    if (current.size === 0) {
      writers.delete(tabId);
    }
  };
}

/**
 * Pushes raw terminal bytes to every attached writer, or buffers them for the
 * next attach. The bytes are passed through untouched so xterm can interpret
 * escape sequences itself.
 */
export function pushTerminalData(tabId: string, bytes: Uint8Array): void {
  const targets = writers.get(tabId);

  if (targets && targets.size > 0) {
    for (const write of targets) {
      try {
        write(bytes);
      } catch {
        // Keep delivering to the remaining writers.
      }
    }
    return;
  }

  const buffered = pending.get(tabId);
  if (buffered) {
    buffered.push(bytes);
  } else {
    pending.set(tabId, [bytes]);
  }
}

/**
 * Drops output buffered for a tab that is closing. Attached writers are left
 * alone; they disappear with the unmounting terminal.
 */
export function clearTerminal(tabId: string): void {
  pending.delete(tabId);
}

/** Drops every buffered chunk and every writer, e.g. when the vault locks. */
export function resetTerminalBus(): void {
  writers.clear();
  pending.clear();
}
