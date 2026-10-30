import {
  KeyRound,
  LockKeyhole,
  Server,
  Settings2,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Section } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import { useVaultStore } from "@/stores/vault";

type RailItem = {
  id: Section;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
};

const primaryItems: RailItem[] = [
  { id: "hosts", label: "Hosts", icon: Server, shortcut: "1" },
  { id: "keys", label: "Keychain", icon: KeyRound, shortcut: "2" },
  { id: "known-hosts", label: "Known Hosts", icon: ShieldCheck, shortcut: "3" },
];

function RailButton({
  item,
  active,
  onClick,
}: {
  item: RailItem;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={item.label}
          aria-current={active ? "page" : undefined}
          className={cn(
            "group relative flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none",
            "hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60",
            active && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary",
          )}
        >
          {active && (
            <span className="absolute -left-1.5 h-4 w-[2px] rounded-full bg-primary" />
          )}
          <Icon className="size-[18px]" strokeWidth={1.9} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {item.label}
        {item.shortcut && (
          <span className="ml-1.5 text-muted-foreground">⌘{item.shortcut}</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export function IconRail() {
  const section = useUiStore((state) => state.section);
  const setSection = useUiStore((state) => state.setSection);
  const lock = useVaultStore((state) => state.lock);

  return (
    <aside className="flex w-12 shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar py-2">
      <button
        type="button"
        onClick={() => setSection("hosts")}
        aria-label="Teerm home"
        className="mb-1 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <Logo compact />
      </button>

      <div className="my-2 h-px w-6 bg-sidebar-border" />

      <nav className="flex flex-1 flex-col items-center gap-1">
        {primaryItems.map((item) => (
          <RailButton
            key={item.id}
            item={item}
            active={section === item.id}
            onClick={() => setSection(item.id)}
          />
        ))}
      </nav>

      <div className="flex flex-col items-center gap-1">
        <RailButton
          item={{ id: "settings", label: "Settings", icon: Settings2 }}
          active={section === "settings"}
          onClick={() => setSection("settings")}
        />
        <div className="my-1 h-px w-6 bg-sidebar-border" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Lock vault"
              onClick={() => void lock()}
              className="size-9 text-muted-foreground hover:text-foreground"
            >
              <LockKeyhole className="size-[18px]" strokeWidth={1.9} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            Lock vault
            <span className="ml-1.5 text-muted-foreground">⌘L</span>
          </TooltipContent>
        </Tooltip>
      </div>
    </aside>
  );
}
