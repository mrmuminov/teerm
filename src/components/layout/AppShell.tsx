import { useEffect } from "react";

import { HostDetailPane } from "@/components/hosts/HostDetailPane";
import { HostSheet } from "@/components/hosts/HostSheet";
import { KeyDialog } from "@/components/keys/KeyDialog";
import { KeychainPane } from "@/components/keys/KeychainPane";
import { KnownHostsPane } from "@/components/known-hosts/KnownHostsPane";
import { IconRail } from "@/components/layout/IconRail";
import { SettingsPane } from "@/components/layout/SettingsPane";
import { Sidebar } from "@/components/layout/Sidebar";
import { StatusBar } from "@/components/layout/StatusBar";
import { TabBar } from "@/components/layout/TabBar";
import { WelcomePane } from "@/components/layout/WelcomePane";
import { SessionDialogs } from "@/components/terminal/SessionDialogs";
import { SessionStack } from "@/components/terminal/SessionStack";
import { useAutoLock, useLockShortcut } from "@/hooks/use-auto-lock";
import { cn } from "@/lib/utils";
import { useInventoryStore } from "@/stores/inventory";
import { useSessionEventBridge, useSessionsStore } from "@/stores/sessions";
import { useSettingsStore } from "@/stores/settings";
import { useForwardEventBridge } from "@/stores/forwards";
import { useSftpEventBridge } from "@/stores/sftp";
import { useUiStore } from "@/stores/ui";

export function AppShell() {
  useSessionEventBridge();
  useSftpEventBridge();
  useForwardEventBridge();

  const section = useUiStore((state) => state.section);
  const setSection = useUiStore((state) => state.setSection);
  const selectedHostId = useUiStore((state) => state.selectedHostId);
  const activeSessionId = useUiStore((state) => state.activeSessionId);
  const loadSettings = useSettingsStore((state) => state.load);
  const loadInventory = useInventoryStore((state) => state.load);
  const tabs = useSessionsStore((state) => state.tabs);
  const resetSessions = useSessionsStore((state) => state.resetSessions);
  const selectedHost = useInventoryStore((state) =>
    state.hosts.find((host) => host.id === selectedHostId) ?? null,
  );
  const activeTab = tabs.find((tab) => tab.id === activeSessionId) ?? null;

  useEffect(() => {
    void loadSettings();
    void loadInventory();
  }, [loadSettings, loadInventory]);

  useEffect(() => {
    return () => {
      resetSessions();
    };
  }, [resetSessions]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }

      const sections = {
        "1": "hosts",
        "2": "keys",
        "3": "known-hosts",
        ",": "settings",
      } as const;
      const next = sections[event.key as keyof typeof sections];

      if (next) {
        event.preventDefault();
        setSection(next);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setSection]);

  useAutoLock();
  useLockShortcut();

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 flex-1">
        <IconRail />
        <Sidebar />

        <div className="flex min-w-0 flex-1 flex-col">
          {section === "hosts" && <TabBar />}

          <main className="min-h-0 flex-1">
            {section === "hosts" &&
              !activeTab &&
              (selectedHost ? (
                <HostDetailPane host={selectedHost} />
              ) : (
                <WelcomePane />
              ))}

            {section === "keys" && <KeychainPane />}
            {section === "known-hosts" && <KnownHostsPane />}
            {section === "settings" && <SettingsPane />}

            {tabs.length > 0 && (
              <div
                className={cn(
                  "h-full min-h-0",
                  (section !== "hosts" || !activeTab) && "hidden",
                )}
              >
                <SessionStack />
              </div>
            )}
          </main>
        </div>
      </div>

      <StatusBar />

      <HostSheet />
      <KeyDialog />
      <SessionDialogs />
    </div>
  );
}
