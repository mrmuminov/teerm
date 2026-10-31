import { FolderTree } from "lucide-react";

import { ForwardsMenu } from "@/components/terminal/ForwardsMenu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SessionStatus, SessionTab } from "@/stores/sessions";
import { useSftpStore } from "@/stores/sftp";
import { useT } from "@/lib/i18n";

const STATUS_DOT: Record<SessionStatus, string> = {
  connecting: "bg-amber-400/90 animate-pulse",
  authenticating: "bg-amber-400/90 animate-pulse",
  connected: "bg-primary shadow-[0_0_6px_var(--primary)]",
  disconnected: "bg-muted-foreground/50",
  error: "bg-destructive",
};

const STATUS_LABEL: Record<SessionStatus, string> = {
  connecting: "Connecting…",
  authenticating: "Authenticating…",
  connected: "Connected",
  disconnected: "Disconnected",
  error: "Error",
};

export function SessionHeader({
  tab,
  active,
}: {
  tab: SessionTab;
  active: boolean;
}) {
  const t = useT();
  const sftpVisible = useSftpStore(
    (state) => state.tabs[tab.id]?.visible ?? false,
  );
  const toggle = useSftpStore((state) => state.toggle);
  const connected = tab.status === "connected" && Boolean(tab.sshSessionId);
  const endpoint = `${tab.username}@${tab.address}${
    tab.port === 22 ? "" : `:${tab.port}`
  }`;

  return (
    <div
      data-active={active}
      className="flex h-[30px] shrink-0 items-center gap-3 border-b border-border/60 bg-sidebar px-3"
    >
      <div
        className="flex min-w-0 shrink-0 items-center gap-1.5"
        title={tab.message ?? STATUS_LABEL[tab.status]}
      >
        <span
          aria-hidden="true"
          className={cn("size-1.5 rounded-full", STATUS_DOT[tab.status])}
        />
        <span
          className={cn(
            "text-[10.5px] font-medium whitespace-nowrap",
            tab.status === "error"
              ? "text-destructive"
              : tab.status === "disconnected"
                ? "text-muted-foreground"
                : "text-foreground/90",
          )}
        >
          {STATUS_LABEL[tab.status]}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden font-mono text-[10.5px] text-muted-foreground">
        {tab.keyType ? (
          <span className="shrink-0 rounded border border-border/70 bg-background/50 px-1.5 py-px text-[9.5px] text-muted-foreground/90">
            {tab.keyType}
          </span>
        ) : null}
        <span className="truncate" title={endpoint}>
          {endpoint}
        </span>
      </div>

      {tab.sshSessionId ? (
        <ForwardsMenu
          hostId={tab.hostId}
          sessionId={tab.sshSessionId}
          connected={connected}
        />
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="xs"
        aria-label={t("Toggle SFTP")}
        aria-pressed={sftpVisible}
        title={t("Toggle SFTP (Ctrl/Cmd+Shift+S)")}
        disabled={!connected}
        onClick={() => {
          if (tab.sshSessionId) {
            void toggle(tab.id, tab.sshSessionId);
          }
        }}
        className={cn(
          "h-6 gap-1.5 rounded-md px-2 text-[10.5px] font-medium",
          sftpVisible
            ? "bg-primary/10 text-primary ring-1 ring-primary/25 hover:bg-primary/15 hover:text-primary"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <FolderTree data-icon="inline-start" />
        {t("SFTP")}</Button>
    </div>
  );
}
