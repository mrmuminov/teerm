import { useState } from "react";
import {
  Copy,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Key } from "@/lib/ipc";
import { useInventoryStore } from "@/stores/inventory";
import { useUiStore } from "@/stores/ui";
import { useT } from "@/lib/i18n";

function KeyCard({
  item,
  onRename,
  onDelete,
}: {
  item: Key;
  onRename: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  return (
    <div className="rounded-xl border border-border/70 bg-card/50 p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
          <KeyRound className="size-4" strokeWidth={1.8} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[13px] font-semibold">{item.name}</h3>
            <Badge
              variant="secondary"
              className="h-5 shrink-0 px-1.5 font-mono text-[9.5px] text-muted-foreground"
            >
              {item.key_type.replace("ssh-", "")}
            </Badge>
          </div>
          <p className="mt-1 truncate font-mono text-[10.5px] text-muted-foreground">
            {item.fingerprint}
          </p>
          <p className="mt-1 line-clamp-2 font-mono text-[9.5px] leading-relaxed break-all text-muted-foreground/70">
            {item.public_key}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("Copy public key")}
            onClick={() => {
              void navigator.clipboard.writeText(item.public_key);
              toast.success(t("Public key copied"));
            }}
          >
            <Copy />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Rename ${item.name}`}
            onClick={onRename}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${item.name}`}
            onClick={onDelete}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function KeychainPane() {
  const t = useT();
  const keys = useInventoryStore((state) => state.keys);
  const renameKey = useInventoryStore((state) => state.renameKey);
  const deleteKey = useInventoryStore((state) => state.deleteKey);
  const openKeyDialog = useUiStore((state) => state.openKeyDialog);

  const [renaming, setRenaming] = useState<Key | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Key | null>(null);

  async function handleRename(event: React.FormEvent) {
    event.preventDefault();
    if (!renaming) {
      return;
    }

    setBusy(true);
    const result = await renameKey(renaming.id, renameValue);
    setBusy(false);

    if (!result.ok) {
      toast.error(t("Could not rename Key"), { description: result.error });
      return;
    }

    toast.success(t("Key renamed"));
    setRenaming(null);
  }

  async function handleDelete() {
    if (!deleting) {
      return;
    }

    setBusy(true);
    const result = await deleteKey(deleting.id);
    setBusy(false);

    if (!result.ok) {
      toast.error(t("Could not delete Key"), { description: result.error });
      return;
    }

    toast.success(t("Key deleted"));
    setDeleting(null);
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto w-full max-w-[720px] px-8 py-8">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-medium tracking-[0.16em] text-primary uppercase">
              {t("SSH Keychain")}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t("Keys")}</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {t("Private material stays in the Rust core. Only public keys are shown here.")}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={() => openKeyDialog("generate")}>
              <Sparkles data-icon="inline-start" />
              {t("Generate")}</Button>
            <Button onClick={() => openKeyDialog("import")}>
              <Plus data-icon="inline-start" />
              {t("Import Key")}</Button>
          </div>
        </header>

        {keys.length === 0 ? (
          <div className="mt-8 rounded-xl border border-dashed border-border/70 bg-card/20 px-6 py-14 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
              <KeyRound className="size-5" strokeWidth={1.6} />
            </div>
            <h2 className="mt-4 text-[15px] font-semibold">{t("No keys yet")}</h2>
            <p className="mx-auto mt-1 max-w-[340px] text-[12px] leading-relaxed text-muted-foreground">
              {t("Import an existing OpenSSH private key or generate a fresh ed25519 pair. Both are sealed inside the Vault.")}</p>
            <div className="mt-4 flex justify-center gap-2">
              <Button size="sm" onClick={() => openKeyDialog("import")}>
                <Plus data-icon="inline-start" />
                {t("Import Key")}</Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openKeyDialog("generate")}
              >
                <Sparkles data-icon="inline-start" />
                {t("Generate ed25519")}</Button>
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-2.5">
            {keys.map((item) => (
              <KeyCard
                key={item.id}
                item={item}
                onRename={() => {
                  setRenaming(item);
                  setRenameValue(item.name);
                }}
                onDelete={() => setDeleting(item)}
              />
            ))}
          </div>
        )}

        <p className="mt-6 pb-2 text-center text-[10px] text-muted-foreground">
          {t("Keys are exported only through a full encrypted Vault export.")}</p>
      </div>

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
      >
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>{t("Rename Key")}</DialogTitle>
            <DialogDescription>
              {t("The key material and fingerprint stay unchanged.")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRename} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="rename-key">{t("Name")}</Label>
              <Input
                id="rename-key"
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                required
                autoFocus
                maxLength={120}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenaming(null)}
                disabled={busy}
              >
                {t("Cancel")}</Button>
              <Button type="submit" disabled={busy || !renameValue.trim()}>
                {busy && (
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                )}
                {t("Save")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete Key "${deleting?.name ?? ""}"?`}
        description={t("Hosts using this Key must be reassigned first. The private material is wiped from the Vault.")}
        confirmLabel={t("Delete key")}
        destructive
        busy={busy}
        onConfirm={handleDelete}
      />
    </div>
  );
}
