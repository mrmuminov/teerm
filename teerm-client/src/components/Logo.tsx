import { Terminal } from "lucide-react";

import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
  compact?: boolean;
};

export function Logo({ className, compact = false }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="relative flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-lg shadow-primary/20">
        <Terminal className="size-[18px]" strokeWidth={2.4} />
      </div>
      {!compact && (
        <div className="flex flex-col gap-0.5 leading-none">
          <span className="text-[15px] font-semibold tracking-tight">Teerm</span>
          <span className="text-[9px] font-medium tracking-[0.22em] text-muted-foreground uppercase">
            SSH workspace
          </span>
        </div>
      )}
    </div>
  );
}
