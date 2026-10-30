import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type PlaceholderPaneProps = {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  actionLabel?: string;
  actionIcon?: LucideIcon;
  onAction?: () => void;
  tips?: string[];
};

export function PlaceholderPane({
  icon: Icon,
  eyebrow,
  title,
  description,
  actionLabel,
  actionIcon: ActionIcon,
  onAction,
  tips = [],
}: PlaceholderPaneProps) {
  return (
    <div className="welcome-backdrop h-full overflow-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[640px] flex-col items-center justify-center px-8 py-12 text-center">
        <div className="relative flex size-16 items-center justify-center rounded-2xl border border-border/70 bg-card/70 shadow-xl shadow-black/20">
          <div className="absolute inset-0 rounded-2xl bg-primary/5" />
          <Icon className="relative size-7 text-primary" strokeWidth={1.5} />
        </div>

        <Badge
          variant="outline"
          className="mt-5 rounded-full border-border/70 text-[10px] tracking-[0.14em] text-muted-foreground uppercase"
        >
          {eyebrow}
        </Badge>

        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 max-w-[430px] text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>

        {actionLabel && onAction && (
          <Button className="mt-5" onClick={onAction}>
            {ActionIcon && <ActionIcon data-icon="inline-start" />}
            {actionLabel}
          </Button>
        )}

        {tips.length > 0 && (
          <div className="mt-8 w-full max-w-[440px] rounded-lg border border-border/60 bg-card/40 p-4 text-left">
            <p className="mb-2 text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
              What lands here
            </p>
            <ul className="space-y-2">
              {tips.map((tip) => (
                <li
                  key={tip}
                  className="flex items-start gap-2 text-[12px] leading-relaxed text-muted-foreground"
                >
                  <span className="mt-[7px] size-1 shrink-0 rounded-full bg-primary/70" />
                  {tip}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
