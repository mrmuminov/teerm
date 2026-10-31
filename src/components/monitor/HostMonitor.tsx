import {
  Activity,
  ArrowDown,
  ArrowUp,
  Cpu,
  HardDrive,
  MemoryStick,
  Network,
  Play,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";

import { Sparkline } from "@/components/monitor/Sparkline";
import { Button } from "@/components/ui/button";
import {
  formatKiB,
  formatPercent,
  formatRate,
  formatUptime,
  percentOf,
} from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useMonitorPolling, useMonitorStore } from "@/stores/monitor";

function Bar({ percent }: { percent: number }) {
  const tone =
    percent >= 90
      ? "bg-destructive"
      : percent >= 75
        ? "bg-[oklch(0.78_0.15_75)]"
        : "bg-primary";

  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", tone)}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

function Card({
  icon: Icon,
  title,
  aside,
  children,
}: {
  icon: typeof Cpu;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/50 p-3.5">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
          <Icon className="size-3.5 text-primary" strokeWidth={1.8} />
          {title}
        </div>
        {aside && (
          <div className="font-mono text-[10px] text-muted-foreground">{aside}</div>
        )}
      </div>
      <div className="grid gap-2">{children}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

/** Live server resource use, read over the connected Session. */
export function HostMonitor({
  sshSessionId,
  onConnect,
}: {
  sshSessionId: string | null;
  onConnect: () => void;
}) {
  const t = useT();
  useMonitorPolling(sshSessionId);
  const entry = useMonitorStore((state) =>
    sshSessionId ? state.bySession[sshSessionId] : undefined,
  );

  const sample = entry?.latest ?? null;
  const history = entry?.history;

  return (
    <section className="mt-4">
      <header className="mb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-primary" strokeWidth={1.8} />
          <h2 className="text-[12px] font-semibold">{t("Monitoring")}</h2>
        </div>
        {sample?.uptime_secs != null && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {t("Up {time}", { time: formatUptime(sample.uptime_secs) })}
          </span>
        )}
      </header>

      {!sshSessionId ? (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-dashed border-border/70 px-4 py-5">
          <p className="text-[11px] text-muted-foreground">
            {t("Connect to this Host to see live CPU, memory, disk and network use.")}
          </p>
          <Button size="sm" onClick={onConnect}>
            <Play data-icon="inline-start" />
            {t("Connect")}
          </Button>
        </div>
      ) : !sample ? (
        <p className="rounded-xl border border-border/70 px-4 py-5 text-center text-[11px] text-muted-foreground">
          {entry?.error ?? t("Reading the server…")}
        </p>
      ) : !sample.supported ? (
        <p className="rounded-xl border border-border/70 px-4 py-5 text-center text-[11px] text-muted-foreground">
          {t("This server does not expose /proc, so monitoring is not available. Linux servers are supported.")}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Card
            icon={Cpu}
            title={t("CPU")}
            aside={sample.cores ? t("{count} cores", { count: sample.cores }) : undefined}
          >
            <div className="flex items-end justify-between gap-3">
              <span className="font-mono text-2xl leading-none tabular-nums">
                {formatPercent(sample.cpu_percent)}
              </span>
              <Sparkline
                values={history?.cpu ?? []}
                max={100}
                className="w-28 text-primary"
              />
            </div>
            <Bar percent={sample.cpu_percent ?? 0} />
            {sample.load && (
              <Stat
                label={t("Load average")}
                value={sample.load.map((value) => value.toFixed(2)).join("  ")}
              />
            )}
          </Card>

          {sample.memory && (
            <Card
              icon={MemoryStick}
              title={t("Memory")}
              aside={formatPercent(percentOf(sample.memory.used_kib, sample.memory.total_kib))}
            >
              <Bar percent={percentOf(sample.memory.used_kib, sample.memory.total_kib)} />
              <Stat
                label={t("Used")}
                value={`${formatKiB(sample.memory.used_kib)} / ${formatKiB(sample.memory.total_kib)}`}
              />
              {sample.memory.swap_total_kib > 0 && (
                <Stat
                  label={t("Swap")}
                  value={`${formatKiB(sample.memory.swap_used_kib)} / ${formatKiB(sample.memory.swap_total_kib)}`}
                />
              )}
            </Card>
          )}

          {sample.disks.length > 0 && (
            <Card icon={HardDrive} title={t("Disk")}>
              {sample.disks.map((disk) => (
                <div key={disk.filesystem} className="grid gap-1">
                  <div className="flex items-baseline justify-between gap-3 text-[11px]">
                    <span className="min-w-0 truncate font-mono" title={disk.filesystem}>
                      {disk.mount}
                    </span>
                    <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
                      {formatKiB(disk.used_kib)} / {formatKiB(disk.size_kib)}
                    </span>
                  </div>
                  <Bar percent={percentOf(disk.used_kib, disk.size_kib)} />
                </div>
              ))}
            </Card>
          )}

          {sample.network && (
            <Card icon={Network} title={t("Network")}>
              <div className="flex items-center justify-between gap-3">
                <div className="grid gap-1 text-[11px]">
                  <span className="flex items-center gap-1.5 font-mono tabular-nums">
                    <ArrowDown className="size-3 text-primary" />
                    {formatRate(sample.network.rx_bytes_per_sec)}
                  </span>
                  <span className="flex items-center gap-1.5 font-mono tabular-nums">
                    <ArrowUp className="size-3 text-[oklch(0.78_0.13_85)]" />
                    {formatRate(sample.network.tx_bytes_per_sec)}
                  </span>
                </div>
                <div className="grid gap-0.5">
                  <Sparkline values={history?.rx ?? []} className="w-28 text-primary" />
                  <Sparkline
                    values={history?.tx ?? []}
                    className="w-28 text-[oklch(0.78_0.13_85)]"
                  />
                </div>
              </div>
            </Card>
          )}

          {sample.gpus.map((gpu) => (
            <Card
              key={gpu.name}
              icon={Zap}
              title={gpu.name}
              aside={gpu.temperature_c != null ? `${Math.round(gpu.temperature_c)}°C` : undefined}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[11px] text-muted-foreground">{t("GPU")}</span>
                <span className="font-mono text-[11px] tabular-nums">
                  {formatPercent(gpu.utilization_percent)}
                </span>
              </div>
              <Bar percent={gpu.utilization_percent} />
              <Stat
                label={t("Video memory")}
                value={`${Math.round(gpu.memory_used_mib)} / ${Math.round(gpu.memory_total_mib)} MiB`}
              />
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
