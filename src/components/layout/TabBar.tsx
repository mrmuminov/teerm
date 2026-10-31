import { useMemo, useState } from "react";
import { Plus, Server, Terminal, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { hostConnectionLabel, sortHosts } from "@/lib/inventory-helpers";
import { cn } from "@/lib/utils";
import { useInventoryStore } from "@/stores/inventory";
import { useSessionsStore, type SessionStatus } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import { useT } from "@/lib/i18n";

const STATUS_DOT: Record<SessionStatus, string> = {
  connecting: "bg-amber-400/90 animate-pulse",
  authenticating: "bg-amber-400/90 animate-pulse",
  connected: "bg-primary shadow-[0_0_6px_var(--primary)]",
  disconnected: "bg-muted-foreground/50",
  error: "bg-destructive",
};

const STATUS_LABEL: Record<SessionStatus, string> = {
  connecting: "Connecting",
  authenticating: "Authenticating",
  connected: "Connected",
  disconnected: "Disconnected",
  error: "Error",
};

export function TabBar() {
  const t = useT();
  const selectedHostId = useUiStore((state) => state.selectedHostId);
  const selectHost = useUiStore((state) => state.selectHost);
  const activeSessionId = useUiStore((state) => state.activeSessionId);
  const focusSession = useUiStore((state) => state.focusSession);

  const hosts = useInventoryStore((state) => state.hosts);
  const selectedHost = useInventoryStore((state) =>
    state.hosts.find((host) => host.id === selectedHostId) ?? null,
  );
  const tabs = useSessionsStore((state) => state.tabs);
  const connect = useSessionsStore((state) => state.connect);
  const closeSession = useSessionsStore((state) => state.closeSession);

  const [menuOpen, setMenuOpen] = useState(false);

  const sortedHosts = useMemo(() => sortHosts(hosts), [hosts]);
  const activeTab = tabs.find((tab) => tab.id === activeSessionId) ?? null;
  const welcomeActive = !selectedHost && !activeTab;
  const hostTabVisible = selectedHost !== null && !activeTab;

  function handleNewSessionOpen(open: boolean) {
    if (open && sortedHosts.length === 0) {
      toast.info(t("No Hosts to connect"), {
        description: t("Create a Host first, then open a session from here."),
      });
      return;
    }

    setMenuOpen(open);
  }

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/70 bg-sidebar px-1.5">
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={() => selectHost(null)}
          className={cn(
            "flex h-7 min-w-0 shrink-0 items-center gap-2 rounded-md px-2.5 text-[12px] transition-colors",
            welcomeActive
              ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
              : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
          )}
        >
          <Terminal
            className={cn(
              "size-3.5 shrink-0",
              welcomeActive ? "text-primary" : "text-muted-foreground",
            )}
            strokeWidth={2}
          />
          <span className="truncate">{t("Welcome")}</span>
          <span className="ml-1 text-[10px] text-muted-foreground">
            {t("pinned")}</span>
        </button>

        {hostTabVisible && (
          <div className="group flex h-7 min-w-0 shrink-0 items-center gap-2 rounded-md bg-background px-2.5 text-[12px] text-foreground shadow-sm ring-1 ring-border/60">
            <Terminal
              className="size-3.5 shrink-0 text-primary"
              strokeWidth={2}
            />
            <span className="max-w-[180px] truncate">{selectedHost.label}</span>
            <button
              type="button"
              aria-label={t("Close tab")}
              onClick={() => selectHost(null)}
              className="ml-1 rounded p-0.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </div>
        )}

        {tabs.map((tab) => {
          const active = tab.id === activeTab?.id;
          const status = tab.message ?? STATUS_LABEL[tab.status];

          return (
            <div
              key={tab.id}
              data-status={tab.status}
              className={cn(
                "group flex h-7 min-w-0 shrink-0 items-center rounded-md border transition-colors",
                active
                  ? "border-transparent bg-background text-foreground shadow-sm ring-1 ring-border/60"
                  : "border-transparent text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
              )}
            >
              <button
                type="button"
                onClick={() => focusSession(tab.id, tab.hostId)}
                title={`${tab.label} — ${status}`}
                className="flex min-w-0 flex-1 items-center gap-2 py-1 pr-1 pl-2.5 text-left outline-none"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    STATUS_DOT[tab.status],
                  )}
                />
                <span className="max-w-[180px] truncate text-[12px]">
                  {tab.label}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Close ${tab.label}`}
                onClick={() => void closeSession(tab.id)}
                className="mr-1 rounded p-0.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}

        <DropdownMenu open={menuOpen} onOpenChange={handleNewSessionOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("New session")}
                  className="ml-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <Plus />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {t("New session")}</TooltipContent>
          </Tooltip>

          <DropdownMenuContent align="start" sideOffset={6} className="w-64">
            <DropdownMenuLabel>{t("Connect to Host")}</DropdownMenuLabel>
            {sortedHosts.map((host) => (
              <DropdownMenuItem
                key={host.id}
                onSelect={() => void connect(host)}
                className="gap-2 py-1.5"
              >
                <Server
                  className="size-3.5 text-muted-foreground"
                  strokeWidth={1.8}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px]">
                    {host.label}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-muted-foreground">
                    {hostConnectionLabel(host)}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2 pr-1 text-[10px] whitespace-nowrap text-muted-foreground">
        <span
          className={cn(
            "size-1.5 rounded-full",
            tabs.length > 0
              ? "bg-primary shadow-[0_0_6px_var(--primary)]"
              : "bg-muted-foreground/40",
          )}
        />
        {tabs.length > 0
          ? t(tabs.length === 1 ? "{count} active session" : "{count} active sessions", {
              count: tabs.length,
            })
          : t("No active sessions")}
      </div>
    </div>
  );
}
