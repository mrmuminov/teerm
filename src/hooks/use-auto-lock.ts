import { useCallback, useEffect, useRef } from "react";

import { useSettingsStore } from "@/stores/settings";
import { useVaultStore } from "@/stores/vault";

/**
 * Locks the Vault after the user has been idle for the configured timeout.
 * Any pointer, keyboard, or scroll activity resets the timer.
 */
export function useAutoLock() {
  const minutes = useSettingsStore(
    (state) => state.settings?.auto_lock_minutes ?? 0,
  );
  const lock = useVaultStore((state) => state.lock);
  const timer = useRef<number | undefined>(undefined);

  const schedule = useCallback(() => {
    window.clearTimeout(timer.current);

    if (minutes <= 0) {
      return;
    }

    timer.current = window.setTimeout(
      () => {
        void lock();
      },
      minutes * 60 * 1000,
    );
  }, [minutes, lock]);

  useEffect(() => {
    schedule();

    const events = ["pointerdown", "keydown", "wheel", "mousemove"] as const;
    for (const event of events) {
      window.addEventListener(event, schedule, { passive: true });
    }

    return () => {
      window.clearTimeout(timer.current);
      for (const event of events) {
        window.removeEventListener(event, schedule);
      }
    };
  }, [schedule]);
}

/** Ctrl/Cmd+L locks the Vault from anywhere in the app. */
export function useLockShortcut() {
  const lock = useVaultStore((state) => state.lock);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isLock =
        event.key.toLowerCase() === "l" && (event.metaKey || event.ctrlKey);

      if (isLock) {
        event.preventDefault();
        void lock();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lock]);
}
