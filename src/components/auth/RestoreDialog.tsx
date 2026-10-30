import { useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { Loader2 } from "lucide-react";

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
import { errorMessage, ipc, isAppError } from "@/lib/ipc";
import { useVaultStore } from "@/stores/vault";

const MIN_PASSWORD_LENGTH = 10;

export function RestoreDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [path, setPath] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [needsPassphrase, setNeedsPassphrase] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirmation.length > 0 && password !== confirmation;
  const canSubmit =
    !!path &&
    !busy &&
    password.length >= MIN_PASSWORD_LENGTH &&
    password === confirmation &&
    (!needsPassphrase || passphrase.length > 0);

  function handleOpenChange(value: boolean) {
    if (busy) {
      return;
    }
    if (!value) {
      setPath(null);
      setPassphrase("");
      setNeedsPassphrase(false);
      setPassword("");
      setConfirmation("");
      setError(null);
    }
    onOpenChange(value);
  }

  async function chooseFile() {
    try {
      const selected = isDevMock()
        ? "/mock/teerm-export.teermvault"
        : await openFileDialog({
            title: "Choose a Teerm export",
            multiple: false,
            directory: false,
            filters: [
              { name: "Teerm export", extensions: ["teermvault", "json"] },
            ],
          });

      if (typeof selected === "string" && selected) {
        setPath(selected);
        setNeedsPassphrase(false);
        setError(null);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function submit() {
    if (!path || !canSubmit) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await ipc.vaultCreateFromExport(path, passphrase || null, password);
      setBusy(false);
      await useVaultStore.getState().init();
    } catch (caught) {
      if (isAppError(caught) && caught.code === "passphrase_required") {
        setNeedsPassphrase(true);
      } else {
        setError(errorMessage(caught));
        if (isAppError(caught) && caught.code === "invalid_password") {
          setNeedsPassphrase(true);
        }
      }
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Restore from an export</DialogTitle>
          <DialogDescription>
            Create this device’s vault from a Teerm export. The Master
            Password you choose here protects the new vault.
          </DialogDescription>
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
            Choose file
          </Button>
        </div>

        {needsPassphrase && (
          <PasswordField
            id="restore-passphrase"
            label="Export passphrase"
            value={passphrase}
            onChange={setPassphrase}
            autoComplete="off"
            disabled={busy}
          />
        )}

        <PasswordField
          id="restore-password"
          label="New master password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          disabled={busy}
        />
        {password.length > 0 && password.length < MIN_PASSWORD_LENGTH && (
          <p className="text-[11px] text-destructive">
            Use at least {MIN_PASSWORD_LENGTH} characters.
          </p>
        )}
        <PasswordField
          id="restore-password-confirm"
          label="Confirm master password"
          value={confirmation}
          onChange={setConfirmation}
          autoComplete="new-password"
          disabled={busy}
          onEnter={() => void submit()}
        />
        {mismatch && (
          <p className="text-[11px] text-destructive">
            The passwords do not match.
          </p>
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
            Restore vault
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
