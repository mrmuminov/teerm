import {
  ArrowLeftRight,
  FolderSync,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useInventoryStore } from "@/stores/inventory";
import { useUiStore } from "@/stores/ui";
import { useT } from "@/lib/i18n";

const features = [
  {
    icon: ShieldCheck,
    title: "Encrypted vault",
    detail: "Argon2id + XChaCha20",
  },
  {
    icon: FolderSync,
    title: "SFTP browser",
    detail: "Drag & drop transfers",
  },
  {
    icon: ArrowLeftRight,
    title: "Port forwarding",
    detail: "Local & remote tunnels",
  },
];

function TerminalPreview({ hostCount }: { hostCount: number }) {
  const t = useT();
  return (
    <div className="dark overflow-hidden rounded-xl border border-border/70 bg-[oklch(0.115_0.008_260)] shadow-2xl shadow-black/50">
      <div className="flex h-9 items-center gap-2 border-b border-foreground/5 bg-foreground/[0.025] px-3">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-[oklch(0.65_0.19_25)]/80" />
          <span className="size-2.5 rounded-full bg-[oklch(0.78_0.15_85)]/80" />
          <span className="size-2.5 rounded-full bg-[oklch(0.72_0.15_155)]/80" />
        </div>
        <span className="ml-1 text-[10px] text-muted-foreground">
          {t("you@teerm — ~")}</span>
        <span className="ml-auto rounded bg-foreground/5 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
          {t("zsh")}</span>
      </div>

      <div className="space-y-1.5 px-4 py-4 font-mono text-[11px] leading-relaxed">
        <p>
          <span className="text-primary">❯</span>{" "}
          <span className="text-foreground/90">{t("teerm init")}</span>
        </p>
        <p className="pl-4 text-muted-foreground">
          <span className="text-primary/80">✓</span> {t("vault")}{" "}
          <span className="ml-4 text-foreground/60">
            {t("sealed · xchacha20-poly1305")}</span>
        </p>
        <p className="pl-4 text-muted-foreground">
          <span className="text-primary/80">✓</span> {t("keychain")}{" "}
          <span className="ml-1 text-foreground/60">{t("ready")}</span>
        </p>
        <p className="pl-4 text-muted-foreground">
          <span className="text-muted-foreground/60">·</span> {t("hosts")}{" "}
          <span className="ml-4 text-foreground/60">
            {hostCount === 0
              ? "waiting for your first host"
              : t(hostCount === 1 ? "{count} host ready" : "{count} hosts ready", { count: hostCount })}
          </span>
        </p>
        <p className="pt-2">
          <span className="text-primary">❯</span>{" "}
          <span className="text-foreground/90">{t("ssh you@your-server")}</span>
        </p>
        <p className="pl-4 text-muted-foreground">
          {hostCount === 0
            ? "add a Host to open your first Session"
            : "pick a Host to open your first Session"}
          <span className="caret-blink ml-1 inline-block h-3 w-[6px] translate-y-0.5 bg-primary/80" />
        </p>
      </div>
    </div>
  );
}

export function WelcomePane() {
  const t = useT();
  const setSection = useUiStore((state) => state.setSection);
  const openHostSheet = useUiStore((state) => state.openHostSheet);
  const hostCount = useInventoryStore((state) => state.hosts.length);

  return (
    <div className="welcome-backdrop relative h-full overflow-auto">
      <div className="relative mx-auto flex min-h-full w-full max-w-[760px] flex-col justify-center px-8 py-10">
        <div className="flex flex-col items-center text-center">
          <Badge
            variant="outline"
            className="gap-1.5 rounded-full border-primary/25 bg-primary/5 px-2.5 py-1 text-[10px] font-medium tracking-[0.14em] text-primary uppercase"
          >
            <Sparkles className="size-3" />
            {t("Local-first SSH workspace")}</Badge>

          <h1 className="mt-5 text-[30px] leading-[1.15] font-semibold tracking-tight text-balance">
            {t("Every server, one quiet")}<span className="text-primary"> {t("terminal.")}</span>
          </h1>

          <p className="mt-3 max-w-[460px] text-[13px] leading-relaxed text-muted-foreground">
            {t("Hosts, keys, and tunnels live in a single encrypted vault on this device. No account, no cloud, no noise.")}</p>

          <div className="mt-6 flex items-center gap-2">
            <Button size="lg" onClick={() => openHostSheet()}>
              <Plus data-icon="inline-start" />
              {t("New Host")}</Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => setSection("settings")}
            >
              <Settings2 data-icon="inline-start" />
              {t("Settings")}</Button>
          </div>
        </div>

        <div className="mt-9">
          <TerminalPreview hostCount={hostCount} />
        </div>

        <div className="mt-6 grid grid-cols-3 divide-x divide-border/70 overflow-hidden rounded-lg border border-border/70 bg-card/40">
          {features.map((feature) => (
            <div
              key={t(feature.title)}
              className="flex items-center justify-center gap-2.5 px-3 py-3"
            >
              <feature.icon
                className="size-4 shrink-0 text-primary/80"
                strokeWidth={1.7}
              />
              <div className="min-w-0">
                <p className="truncate text-[11px] font-medium">
                  {t(feature.title)}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {t(feature.detail)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
