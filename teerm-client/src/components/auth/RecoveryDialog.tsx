import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { PasswordField } from "@/components/auth/PasswordField";
import { PhraseCard } from "@/components/auth/PhraseCard";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n";
import { errorMessage, ipc } from "@/lib/ipc";
import { useVaultStore } from "@/stores/vault";

export type RecoveryMode = "enable" | "disable";

/** Sets up, replaces, or turns off the Recovery Phrase. */
export function RecoveryDialog({
  open,
  mode,
  onOpenChange,
}: {
  open: boolean;
  mode: RecoveryMode;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState<string | null>(null);
  const [writtenDown, setWrittenDown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The phrase is shown once; it cannot be closed away before it is noted.
  const mustConfirm = phrase !== null && !writtenDown;

  function handleOpenChange(value: boolean) {
    if (busy || (!value && mustConfirm)) {
      return;
    }
    if (!value) {
      setPassword("");
      setPhrase(null);
      setWrittenDown(false);
      setError(null);
    }
    onOpenChange(value);
  }

  async function submit() {
    if (!password || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "enable") {
        setPhrase(await ipc.vaultEnableRecovery(password));
        setPassword("");
      } else {
        await ipc.vaultDisableRecovery(password);
        toast.success(t("Recovery phrase turned off"));
        await useVaultStore.getState().refreshStatus();
        setBusy(false);
        handleOpenChange(false);
        return;
      }
      await useVaultStore.getState().refreshStatus();
    } catch (caught) {
      setError(errorMessage(caught));
    }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>
            {mode === "enable" ? t("Recovery phrase") : t("Turn off recovery phrase")}
          </DialogTitle>
          <DialogDescription>
            {mode === "enable"
              ? t("A 24-word phrase that can open your Vault if you forget the Master Password. Setting it up again replaces the old phrase.")
              : t("The current recovery phrase will stop working. Your Master Password is not affected.")}
          </DialogDescription>
        </DialogHeader>

        {phrase ? (
          <div className="grid gap-3">
            <PhraseCard phrase={phrase} />
            <div className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-background/40 p-3">
              <Checkbox
                id="recovery-written"
                checked={writtenDown}
                onCheckedChange={(value) => setWrittenDown(value === true)}
                className="mt-0.5"
              />
              <Label
                htmlFor="recovery-written"
                className="text-xs leading-relaxed font-normal text-muted-foreground"
              >
                {t("I wrote the phrase down and keep it somewhere safe. It will not be shown again.")}
              </Label>
            </div>
          </div>
        ) : (
          <PasswordField
            id="recovery-password"
            label={t("Current password")}
            value={password}
            onChange={setPassword}
            autoFocus
            disabled={busy}
            onEnter={() => void submit()}
          />
        )}

        {error && <p className="text-[11px] text-destructive">{error}</p>}

        <DialogFooter>
          {phrase ? (
            <Button disabled={!writtenDown} onClick={() => handleOpenChange(false)}>
              {t("Done")}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => handleOpenChange(false)}
              >
                {t("Cancel")}
              </Button>
              <Button
                variant={mode === "disable" ? "destructive" : "default"}
                disabled={!password || busy}
                onClick={() => void submit()}
              >
                {busy && <Loader2 className="animate-spin" data-icon="inline-start" />}
                {mode === "enable" ? t("Create recovery phrase") : t("Turn off")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
