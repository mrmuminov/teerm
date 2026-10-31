import { useState } from "react";
import { Fingerprint, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { KnownHost } from "@/lib/ipc";
import { useInventoryStore } from "@/stores/inventory";
import { useUiStore } from "@/stores/ui";
import { useT } from "@/lib/i18n";

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function KnownHostsPane() {
  const t = useT();
  const knownHosts = useInventoryStore((state) => state.knownHosts);
  const deleteKnownHost = useInventoryStore((state) => state.deleteKnownHost);
  const setSection = useUiStore((state) => state.setSection);
  const [deleting, setDeleting] = useState<KnownHost | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!deleting) {
      return;
    }

    setBusy(true);
    const result = await deleteKnownHost(deleting.id);
    setBusy(false);

    if (!result.ok) {
      toast.error(t("Could not forget host"), { description: result.error });
      return;
    }

    toast.success(t("Fingerprint forgotten"));
    setDeleting(null);
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto w-full max-w-[760px] px-8 py-8">
        <header>
          <p className="text-[10px] font-medium tracking-[0.16em] text-primary uppercase">
            {t("Trust on first use")}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {t("Known Hosts")}</h1>
          <p className="mt-1 max-w-[520px] text-[13px] leading-relaxed text-muted-foreground">
            {t("Server fingerprints you have trusted. A changed fingerprint blocks the connection until you explicitly replace it.")}</p>
        </header>

        {knownHosts.length === 0 ? (
          <div className="mt-8 rounded-xl border border-dashed border-border/70 bg-card/20 px-6 py-14 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
              <ShieldCheck className="size-5" strokeWidth={1.6} />
            </div>
            <h2 className="mt-4 text-[15px] font-semibold">
              {t("No known hosts yet")}</h2>
            <p className="mx-auto mt-1 max-w-[340px] text-[12px] leading-relaxed text-muted-foreground">
              {t("The first time you connect, Teerm shows the server fingerprint and asks you to trust it.")}</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-4"
              onClick={() => setSection("settings")}
            >
              {t("Review security settings")}</Button>
          </div>
        ) : (
          <div className="mt-6 overflow-hidden rounded-xl border border-border/70">
            <div className="grid grid-cols-[1fr_120px_90px_40px] items-center gap-3 border-b border-border/70 bg-card/50 px-4 py-2 text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
              <span>{t("Host")}</span>
              <span>{t("Key type")}</span>
              <span>{t("Added")}</span>
              <span />
            </div>
            {knownHosts.map((known) => (
              <div
                key={known.id}
                className="grid grid-cols-[1fr_120px_90px_40px] items-center gap-3 border-b border-border/50 px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-[12px]">
                    {known.address}
                    {known.port === 22 ? "" : `:${known.port}`}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 truncate font-mono text-[9.5px] text-muted-foreground">
                    <Fingerprint className="size-3 shrink-0" />
                    {known.fingerprint}
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className="h-5 w-fit px-1.5 font-mono text-[9.5px] text-muted-foreground"
                >
                  {known.key_type.replace("ssh-", "")}
                </Badge>
                <span className="text-[11px] text-muted-foreground">
                  {formatDate(known.added_at)}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("Forget {address}", { address: known.address })}
                  onClick={() => setDeleting(known)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        )}

        <p className="mt-6 pb-2 text-center text-[10px] text-muted-foreground">
          {t("Fingerprints live inside the encrypted Vault.")}</p>
      </div>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("Forget {host}?", { host: deleting?.address ?? "this host" })}
        description={t("The next connection will ask you to trust this server again.")}
        confirmLabel={t("Forget")}
        destructive
        busy={busy}
        onConfirm={handleDelete}
      />
    </div>
  );
}
