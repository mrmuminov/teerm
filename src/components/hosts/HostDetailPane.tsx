import { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  KeyRound,
  LockKeyhole,
  Pencil,
  Play,
  Server,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Host, PortForward } from "@/lib/ipc";
import { hostConnectionLabel } from "@/lib/inventory-helpers";
import { useInventoryStore } from "@/stores/inventory";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import { useT } from "@/lib/i18n";

const EMPTY_FORWARDS: PortForward[] = [];

function InfoRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-2.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span
        className={`min-w-0 truncate text-right text-[12px] ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export function HostDetailPane({ host }: { host: Host }) {
  const t = useT();
  const groups = useInventoryStore((state) => state.groups);
  const tags = useInventoryStore((state) => state.tags);
  const keys = useInventoryStore((state) => state.keys);
  const forwards = useInventoryStore(
    (state) => state.forwards[host.id] ?? EMPTY_FORWARDS,
  );
  const loadForwards = useInventoryStore((state) => state.loadForwards);
  const deleteHost = useInventoryStore((state) => state.deleteHost);
  const connect = useSessionsStore((state) => state.connect);
  const openHostSheet = useUiStore((state) => state.openHostSheet);
  const selectHost = useUiStore((state) => state.selectHost);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadForwards(host.id);
  }, [host.id, loadForwards]);

  const group = groups.find((candidate) => candidate.id === host.group_id);
  const key = keys.find((candidate) => candidate.id === host.key_id);
  const hostTags = tags.filter((tag) => host.tag_ids.includes(tag.id));

  async function handleDelete() {
    setBusy(true);
    const result = await deleteHost(host.id);
    setBusy(false);

    if (!result.ok) {
      toast.error(t("Could not delete Host"), { description: result.error });
      return;
    }

    toast.success(t("Host deleted"));
    setConfirmDelete(false);
    selectHost(null);
  }

  return (
    <div className="welcome-backdrop h-full overflow-auto">
      <div className="mx-auto w-full max-w-[760px] px-8 py-8">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-medium tracking-[0.16em] text-primary uppercase">
              {t("Host")}</p>
            <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight">
              {host.label}
            </h1>
            <p className="mt-1 truncate font-mono text-[12px] text-muted-foreground">
              {hostConnectionLabel(host)}
            </p>
            {hostTags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {hostTags.map((tag) => (
                  <Badge
                    key={tag.id}
                    variant="secondary"
                    className="h-5 gap-1.5 px-2 text-[10px] font-normal text-muted-foreground"
                  >
                    <span
                      className="size-1.5 rounded-full"
                      style={{ background: tag.color ?? "var(--muted-foreground)" }}
                    />
                    {tag.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              onClick={() => openHostSheet(host.id)}
            >
              <Pencil data-icon="inline-start" />
              {t("Edit")}</Button>
            <Button onClick={() => void connect(host)}>
              <Play data-icon="inline-start" />
              {t("Connect")}</Button>
          </div>
        </header>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <section className="overflow-hidden rounded-xl border border-border/70 bg-card/50">
            <header className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
              <Server className="size-3.5 text-primary" />
              <h2 className="text-[12px] font-semibold">{t("Connection")}</h2>
            </header>
            <div className="divide-y divide-border/50">
              <InfoRow label={t("Address")} value={host.address} mono />
              <InfoRow label={t("Port")} value={host.port} mono />
              <InfoRow label={t("Username")} value={host.username} mono />
              <InfoRow label={t("Group")} value={group?.name ?? "—"} />
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-border/70 bg-card/50">
            <header className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
              <ShieldCheck className="size-3.5 text-primary" />
              <h2 className="text-[12px] font-semibold">{t("Authentication")}</h2>
            </header>
            <div className="divide-y divide-border/50">
              <InfoRow
                label={t("Key")}
                value={
                  key ? (
                    <span className="inline-flex items-center gap-1.5">
                      <KeyRound className="size-3" />
                      {key.name}
                    </span>
                  ) : (
                    "None"
                  )
                }
              />
              <InfoRow
                label={t("Password")}
                value={
                  host.has_password ? (
                    <span className="inline-flex items-center gap-1.5 text-primary">
                      <LockKeyhole className="size-3" />
                      {t("Stored")}</span>
                  ) : (
                    "Prompt on connect"
                  )
                }
              />
              <InfoRow label={t("Jump Host")} value="Not in this version" />
            </div>
          </section>
        </div>

        <section className="mt-4 overflow-hidden rounded-xl border border-border/70 bg-card/50">
          <header className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="size-3.5 text-primary" />
              <h2 className="text-[12px] font-semibold">{t("Port forwards")}</h2>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openHostSheet(host.id)}
            >
              {t("Manage")}</Button>
          </header>

          {forwards.length === 0 ? (
            <p className="px-4 py-6 text-center text-[11px] text-muted-foreground">
              {t("No saved rules. Add local (-L) or remote (-R) tunnels in the Host editor.")}</p>
          ) : (
            <div className="divide-y divide-border/50">
              {forwards.map((forward) => (
                <div
                  key={forward.id}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <Badge
                    variant="secondary"
                    className="h-5 w-9 shrink-0 justify-center px-1 text-[9px] uppercase"
                  >
                    {forward.kind}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                    {forward.bind_address}:{forward.bind_port}
                    <ArrowLeftRight className="mx-1 inline size-3 opacity-60" />
                    {forward.target_host}:{forward.target_port}
                  </span>
                  {forward.auto_start && (
                    <span className="text-[9px] tracking-wide text-primary uppercase">
                      {t("auto")}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="mt-6 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmDelete(true)}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 data-icon="inline-start" />
            {t("Delete Host")}</Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("Delete {label}?", { label: host.label })}
        description={t("Its Port Forwards are removed too, and the stored password is wiped.")}
        confirmLabel={t("Delete Host")}
        destructive
        busy={busy}
        onConfirm={handleDelete}
      />
    </div>
  );
}
