import { LockKeyhole } from "lucide-react";

import { useSettingsStore } from "@/stores/settings";

export function StatusBar() {
  const settings = useSettingsStore((state) => state.settings);
  const appInfo = useSettingsStore((state) => state.appInfo);

  const autoLock = settings?.auto_lock_minutes ?? 15;

  return (
    <footer className="flex h-6 shrink-0 items-center justify-between border-t border-border/70 bg-sidebar px-3 text-[10px] text-muted-foreground">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-primary shadow-[0_0_6px_var(--primary)]" />
          Vault unlocked
        </span>
        <span className="text-border">|</span>
        <span className="flex items-center gap-1">
          <LockKeyhole className="size-2.5" />
          Auto-lock {autoLock > 0 ? `${autoLock} min` : "off"}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span>SSH2</span>
        <span className="text-border">|</span>
        <span className="tabular-nums">
          Teerm {appInfo ? `v${appInfo.version}` : ""}
        </span>
      </div>
    </footer>
  );
}
