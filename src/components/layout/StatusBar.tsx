import { ArrowLeftRight, ArrowUpDown, LockKeyhole, Terminal } from "lucide-react";

import { useForwardsStore } from "@/stores/forwards";
import { useSessionsStore } from "@/stores/sessions";
import { useSettingsStore } from "@/stores/settings";
import { useSftpStore } from "@/stores/sftp";
import { useUiStore } from "@/stores/ui";

export function StatusBar() {
  const settings = useSettingsStore((state) => state.settings);
  const appInfo = useSettingsStore((state) => state.appInfo);
  const tabs = useSessionsStore((state) => state.tabs);
  const activeSessionId = useUiStore((state) => state.activeSessionId);
  const forwardsBySession = useForwardsStore((state) => state.bySession);
  const transfers = useSftpStore((state) => state.transfers);

  const autoLock = settings?.auto_lock_minutes ?? 15;
  const connected = tabs.filter((tab) => tab.status === "connected");
  const activeTab = tabs.find((tab) => tab.id === activeSessionId) ?? null;
  const activeForwards = Object.values(forwardsBySession)
    .flatMap((forwards) => Object.values(forwards))
    .filter((forward) => forward.state === "running").length;
  const runningTransfers = transfers.filter(
    (transfer) => transfer.state === "running",
  ).length;

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
        {connected.length > 0 && (
          <span className="flex items-center gap-1 tabular-nums">
            <Terminal className="size-2.5" />
            {connected.length} {connected.length === 1 ? "session" : "sessions"}
          </span>
        )}
        {activeForwards > 0 && (
          <span className="flex items-center gap-1 tabular-nums">
            <ArrowLeftRight className="size-2.5" />
            {activeForwards} {activeForwards === 1 ? "forward" : "forwards"}
          </span>
        )}
        {runningTransfers > 0 && (
          <span className="flex items-center gap-1 tabular-nums">
            <ArrowUpDown className="size-2.5" />
            {runningTransfers}{" "}
            {runningTransfers === 1 ? "transfer" : "transfers"}
          </span>
        )}
        {activeTab?.keyType && (
          <span className="font-mono">{activeTab.keyType}</span>
        )}
        <span>SSH2</span>
        <span className="text-border">|</span>
        <span className="tabular-nums">
          Teerm {appInfo ? `v${appInfo.version}` : ""}
        </span>
      </div>
    </footer>
  );
}
