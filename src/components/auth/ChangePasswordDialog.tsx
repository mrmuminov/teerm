import { useState } from "react";
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
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { errorMessage, ipc } from "@/lib/ipc";

export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirmation.length > 0 && next !== confirmation;
  const canSubmit =
    current.length > 0 &&
    next.length >= MIN_PASSWORD_LENGTH &&
    next === confirmation &&
    !busy;

  function handleOpenChange(value: boolean) {
    if (busy) {
      return;
    }
    if (!value) {
      setCurrent("");
      setNext("");
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
      await ipc.vaultChangePassword(current, next);
      toast.success("Master Password changed");
      setBusy(false);
      handleOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Change Master Password</DialogTitle>
          <DialogDescription>
            The Vault is re-encrypted with the new password. There is no
            recovery if you forget it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <PasswordField
            id="current-password"
            label="Current password"
            value={current}
            onChange={setCurrent}
            autoFocus
            disabled={busy}
          />
          <PasswordField
            id="new-password"
            label="New password"
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            disabled={busy}
          />
          {tooShort && (
            <p className="text-[11px] text-destructive">
              Use at least {MIN_PASSWORD_LENGTH} characters.
            </p>
          )}
          <PasswordField
            id="confirm-password"
            label="Confirm new password"
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
        </div>

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
            Change password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
