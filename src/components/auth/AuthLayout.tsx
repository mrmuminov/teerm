import type { ReactNode } from "react";
import { LockKeyhole } from "lucide-react";

import { Logo } from "@/components/Logo";
import { useT } from "@/lib/i18n";

type AuthLayoutProps = {
  children: ReactNode;
};

export function AuthLayout({ children }: AuthLayoutProps) {
  const t = useT();
  return (
    <div className="auth-backdrop h-full overflow-y-auto bg-background">
      <div className="flex min-h-full flex-col">
        <header className="flex h-14 shrink-0 items-center px-8">
          <Logo />
        </header>

        <main className="flex flex-1 items-center justify-center px-6 py-3">
          <div className="w-full max-w-[420px]">{children}</div>
        </main>

        <footer className="auth-footer flex h-10 shrink-0 items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <LockKeyhole className="size-3.5" />
          <span>{t("Local-first · encrypted at rest")}</span>
        </footer>
      </div>
    </div>
  );
}
