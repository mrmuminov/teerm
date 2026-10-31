import { useState } from "react";
import { Loader2 } from "lucide-react";

import { PasswordField } from "@/components/auth/PasswordField";
import { PhraseGenerator } from "@/components/auth/PhraseGenerator";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n";
import { errorMessage, ipc } from "@/lib/ipc";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { useVaultStore } from "@/stores/vault";

/** Opens a locked Vault with its Recovery Phrase and sets a new password. */
export function RecoverDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirmation.length > 0 && password !== confirmation;
  const canSubmit =
    phrase.trim().length > 0 &&
    password.length >= MIN_PASSWORD_LENGTH &&
    password === confirmation &&
    !busy;

  function handleOpenChange(value: boolean) {
    if (busy) {
      return;
    }
    if (!value) {
      setPhrase("");
      setPassword("");
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
      await ipc.vaultRecover(phrase, password);
      setBusy(false);
      await useVaultStore.getState().init();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t("Recover with your phrase")}</DialogTitle>
          <DialogDescription>
            {t("Enter your 24-word recovery phrase and choose a new Master Password.")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-1.5">
          <Label htmlFor="recovery-phrase">{t("Recovery phrase")}</Label>
          <Textarea
            id="recovery-phrase"
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            rows={3}
            autoFocus
            disabled={busy}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            className="font-mono text-[12px]"
          />
        </div>

        <PasswordField
          id="recover-password"
          label={t("New master password")}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          disabled={busy}
        />
        <PasswordField
          id="recover-password-confirm"
          label={t("Confirm master password")}
          value={confirmation}
          onChange={setConfirmation}
          autoComplete="new-password"
          disabled={busy}
          onEnter={() => void submit()}
        />
        {mismatch && (
          <p className="text-[11px] text-destructive">
            {t("The passwords do not match.")}
          </p>
        )}
        <PhraseGenerator
          disabled={busy}
          onGenerated={(generated) => {
            setPassword(generated);
            setConfirmation(generated);
          }}
        />

        {error && <p className="text-[11px] text-destructive">{error}</p>}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => handleOpenChange(false)}
          >
            {t("Cancel")}
          </Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            {busy && <Loader2 className="animate-spin" data-icon="inline-start" />}
            {t("Recover vault")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
