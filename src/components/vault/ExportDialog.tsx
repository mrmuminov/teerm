import { useState } from "react";
import { save as saveFileDialog } from "@tauri-apps/plugin-dialog";
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
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { errorMessage, ipc, type ExportMode } from "@/lib/ipc";
import { cn } from "@/lib/utils";

const MODES: { value: ExportMode; title: string; description: string }[] = [
  {
    value: "full",
    title: "Full export",
    description:
      "Encrypted with a passphrase. Includes passwords and private keys.",
  },
  {
    value: "metadata",
    title: "Metadata only",
    description:
      "Plain JSON without any Secrets. It can be merged but never replace a Vault.",
  },
];

export function ExportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [mode, setMode] = useState<ExportMode>("full");
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const full = mode === "full";
  const mismatch = confirmation.length > 0 && passphrase !== confirmation;
  const canSubmit =
    !busy &&
    (!full ||
      (passphrase.length >= MIN_PASSWORD_LENGTH &&
        passphrase === confirmation));

  function handleOpenChange(value: boolean) {
    if (busy) {
      return;
    }
    if (!value) {
      setPassphrase("");
      setConfirmation("");
      setError(null);
    }
    onOpenChange(value);
  }

  async function submit() {
    if (!canSubmit) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const extension = full ? "teermvault" : "json";
      const defaultName = `teerm-${full ? "export" : "metadata"}.${extension}`;
      const path = isDevMock()
        ? `/mock/${defaultName}`
        : await saveFileDialog({
            title: "Export Vault",
            defaultPath: defaultName,
            filters: [{ name: "Teerm export", extensions: [extension] }],
          });

      if (!path) {
        setBusy(false);
        return;
      }

      await ipc.vaultExport(path, mode, full ? passphrase : null);
      toast.success("Vault exported", { description: path });
      setBusy(false);
      handleOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Export Vault</DialogTitle>
          <DialogDescription>
            Keep a copy of your Hosts, Keys and settings outside Teerm.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          {MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={busy}
              onClick={() => setMode(option.value)}
              aria-pressed={mode === option.value}
              className={cn(
                "rounded-lg border px-3 py-2 text-left transition-colors",
                mode === option.value
                  ? "border-primary/50 bg-primary/10"
                  : "border-border/70 hover:bg-accent/40",
              )}
            >
              <div className="text-[12px] font-medium">{option.title}</div>
              <div className="text-[11px] text-muted-foreground">
                {option.description}
              </div>
            </button>
          ))}
        </div>

        {full && (
          <div className="grid gap-3">
            <PasswordField
              id="export-passphrase"
              label="Export passphrase"
              value={passphrase}
              onChange={setPassphrase}
              autoComplete="new-password"
              disabled={busy}
            />
            <PasswordField
              id="export-passphrase-confirm"
              label="Confirm passphrase"
              value={confirmation}
              onChange={setConfirmation}
              autoComplete="new-password"
              disabled={busy}
              onEnter={() => void submit()}
            />
            {passphrase.length > 0 &&
              passphrase.length < MIN_PASSWORD_LENGTH && (
                <p className="text-[11px] text-destructive">
                  Use at least {MIN_PASSWORD_LENGTH} characters.
                </p>
              )}
            {mismatch && (
              <p className="text-[11px] text-destructive">
                The passphrases do not match.
              </p>
            )}
          </div>
        )}

        {error && <p className="text-[11px] text-destructive">{error}</p>}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            {busy && <Loader2 className="animate-spin" data-icon="inline-start" />}
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
