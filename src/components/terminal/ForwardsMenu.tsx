import { ArrowLeftRight } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PortForward } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useForwardsStore, type ForwardRuntime } from "@/stores/forwards";
import { useInventoryStore } from "@/stores/inventory";
import { useT } from "@/lib/i18n";

const EMPTY_FORWARDS: PortForward[] = [];
const EMPTY_RUNTIME: Record<string, ForwardRuntime> = {};

function describe(forward: PortForward): string {
  const bind = `${forward.bind_address}:${forward.bind_port}`;
  const target = `${forward.target_host}:${forward.target_port}`;
  return forward.kind === "local" ? `${bind} → ${target}` : `${target} ← ${bind}`;
}

export function ForwardsMenu({
  hostId,
  sessionId,
  connected,
}: {
  hostId: string;
  sessionId: string;
  connected: boolean;
}) {
  const t = useT();
  const forwards = useInventoryStore(
    (state) => state.forwards[hostId] ?? EMPTY_FORWARDS,
  );
  const loadForwards = useInventoryStore((state) => state.loadForwards);
  const runtime = useForwardsStore(
    (state) => state.bySession[sessionId] ?? EMPTY_RUNTIME,
  );
  const refresh = useForwardsStore((state) => state.refresh);
  const start = useForwardsStore((state) => state.start);
  const stop = useForwardsStore((state) => state.stop);

  useEffect(() => {
    void loadForwards(hostId);
  }, [hostId, loadForwards]);

  useEffect(() => {
    if (connected) {
      void refresh(sessionId);
    }
  }, [connected, refresh, sessionId]);

  if (forwards.length === 0) {
    return null;
  }

  const activeCount = forwards.filter(
    (forward) => runtime[forward.id]?.state === "running",
  ).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label={t("Port forwards")}
          disabled={!connected}
          className={cn(
            "h-6 gap-1.5 rounded-md px-2 text-[10.5px] font-medium",
            activeCount > 0
              ? "bg-primary/10 text-primary ring-1 ring-primary/25 hover:bg-primary/15 hover:text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <ArrowLeftRight data-icon="inline-start" />
          {t("Forwards")}{activeCount > 0 ? ` (${activeCount})` : ""}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuLabel>{t("Port forwards")}</DropdownMenuLabel>
        {forwards.map((forward) => {
          const current = runtime[forward.id];
          return (
            <DropdownMenuCheckboxItem
              key={forward.id}
              checked={current?.state === "running"}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) =>
                void (checked
                  ? start(sessionId, forward.id)
                  : stop(sessionId, forward.id))
              }
              title={current?.message ?? undefined}
            >
              <span className="font-mono text-[11px]">{describe(forward)}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {forward.kind}
              </span>
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
