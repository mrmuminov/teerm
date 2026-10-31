import { useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { PasswordField } from "@/components/auth/PasswordField";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isDevMock } from "@/lib/env";
import {
  errorMessage,
  ipc,
  isAppError,
  type EntityCounts,
  type ImportMode,
  type ImportPreview,
} from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useInventoryStore } from "@/stores/inventory";
import { useT } from "@/lib/i18n";

const ENTITY_LABELS: [keyof EntityCounts, string][] = [
  ["hosts", "Hosts"],
  ["groups", "Host Groups"],
  ["tags", "Tags"],
  ["keys", "Keys"],
  ["port_forwards", "Port Forwards"],
  ["known_hosts", "Known Hosts"],
];

export function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [path, setPath] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [needsPassphrase, setNeedsPassphrase] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setPath(null);
    setPassphrase("");
    setNeedsPassphrase(false);
    setPreview(null);
    setMode("merge");
    setError(null);
  }

  function handleOpenChange(value: boolean) {
    if (busy) {
      return;
    }
    if (!value) {
      reset();
    }
    onOpenChange(value);
  }

  async function loadPreview(selected: string, secret: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await ipc.vaultImportPreview(selected, secret || null);
      setPreview(result);
      setNeedsPassphrase(false);
      setMode("merge");
    } catch (caught) {
      if (isAppError(caught) && caught.code === "passphrase_required") {
        setNeedsPassphrase(true);
      } else {
        setError(errorMessage(caught));
        if (isAppError(caught) && caught.code === "invalid_password") {
          setNeedsPassphrase(true);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function chooseFile() {
    try {
      const selected = isDevMock()
        ? "/mock/teerm-export.teermvault"
        : await openFileDialog({
            title: "Import Vault",
            multiple: false,
            directory: false,
            filters: [
              { name: "Teerm export", extensions: ["teermvault", "json"] },
            ],
          });

      if (typeof selected === "string" && selected) {
        reset();
        setPath(selected);
        await loadPreview(selected, "");
      }
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function apply() {
    if (!path || !preview) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await ipc.vaultImportApply(
        path,
        passphrase || null,
        mode,
      );
      await useInventoryStore.getState().load(true);
      toast.success(
        result.mode === "replace" ? "Vault replaced" : "Import complete",
        {
          description: result.backup_path
            ? `Previous Vault saved to ${result.backup_path}`
            : undefined,
        },
      );
      setBusy(false);
      handleOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t("Import Vault")}</DialogTitle>
          <DialogDescription>
            {t("Load a Teerm export and merge it into this Vault, or replace this Vault with it.")}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <span
            className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted-foreground"
            title={path ?? undefined}
          >
            {path ?? "No file selected"}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void chooseFile()}
          >
            {t("Choose file")}</Button>
        </div>

        {path && needsPassphrase && !preview && (
          <PasswordField
            id="import-passphrase"
            label={t("Export passphrase")}
            value={passphrase}
            onChange={setPassphrase}
            autoComplete="off"
            autoFocus
            disabled={busy}
            onEnter={() => void loadPreview(path, passphrase)}
          />
        )}

        {preview && (
          <div className="grid gap-3">
            <div className="overflow-hidden rounded-lg border border-border/70">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 border-b border-border/60 bg-card/50 px-3 py-1.5 text-[10px] text-muted-foreground uppercase">
                <span>{t("In file")}</span>
                <span>{t("New")}</span>
                <span>{t("Same")}</span>
                <span>{t("Conflict")}</span>
              </div>
              {ENTITY_LABELS.map(([key, label]) => (
                <div
                  key={key}
                  className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-3 py-1 text-[11.5px]"
                >
                  <span>
                    {label}{" "}
                    <span className="text-muted-foreground">
                      ({preview.incoming[key]})
                    </span>
                  </span>
                  <span className="text-right tabular-nums">
                    {preview.merge.added[key]}
                  </span>
                  <span className="text-right tabular-nums text-muted-foreground">
                    {preview.merge.skipped[key]}
                  </span>
                  <span className="text-right tabular-nums text-amber-500/90">
                    {preview.merge.duplicated[key]}
                  </span>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-muted-foreground">
              {preview.includes_secrets
                ? "This export includes Secrets."
                : "This export has no Secrets, so imported Hosts and Keys will need them added again."}
            </p>

            <div className="grid gap-2">
              <ModeOption
                selected={mode === "merge"}
                disabled={busy}
                title={t("Merge")}
                description={t("Keep everything here. Conflicting items are added again with “(imported)” in their name.")}
                onSelect={() => setMode("merge")}
              />
              <ModeOption
                selected={mode === "replace"}
                disabled={busy || !preview.can_replace}
                title={t("Replace")}
                description={
                  preview.can_replace
                    ? "Swap this Vault’s contents for the file. The current Vault is backed up first."
                    : "Only a full export can replace a Vault."
                }
                onSelect={() => setMode("replace")}
              />
            </div>
          </div>
        )}

        {error && <p className="text-[11px] text-destructive">{error}</p>}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => handleOpenChange(false)}
          >
            {t("Cancel")}</Button>
          {path && needsPassphrase && !preview ? (
            <Button
              disabled={busy || passphrase.length === 0}
              onClick={() => void loadPreview(path, passphrase)}
            >
              {busy && (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              )}
              {t("Unlock file")}</Button>
          ) : (
            <Button
              variant={mode === "replace" ? "destructive" : "default"}
              disabled={busy || !preview}
              onClick={() => void apply()}
            >
              {busy && (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              )}
              {mode === "replace" ? "Replace Vault" : "Merge"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeOption({
  selected,
  disabled,
  title,
  description,
  onSelect,
}: {
  selected: boolean;
  disabled: boolean;
  title: string;
  description: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50",
        selected
          ? "border-primary/50 bg-primary/10"
          : "border-border/70 enabled:hover:bg-accent/40",
      )}
    >
      <div className="text-[12px] font-medium">{title}</div>
      <div className="text-[11px] text-muted-foreground">{description}</div>
    </button>
  );
}
