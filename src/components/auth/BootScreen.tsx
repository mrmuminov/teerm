import { Logo } from "@/components/Logo";

export function BootScreen() {
  return (
    <div className="auth-backdrop flex h-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-5">
        <div className="animate-pulse">
          <Logo />
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="size-1.5 animate-pulse rounded-full bg-primary" />
          Opening your vault…
        </div>
      </div>
    </div>
  );
}
