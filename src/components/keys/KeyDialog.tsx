import { useEffect, useState } from "react";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";
import { useInventoryStore } from "@/stores/inventory";
import { useUiStore } from "@/stores/ui";
import { useT } from "@/lib/i18n";

export function KeyDialog() {
  const t = useT();
  const dialog = useUiStore((state) => state.keyDialog);
  const closeKeyDialog = useUiStore((state) => state.closeKeyDialog);
  const importKey = useInventoryStore((state) => state.importKey);
  const generateKey = useInventoryStore((state) => state.generateKey);

  const [name, setName] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (dialog.open) {
      setName("");
      setPrivateKey("");
      setPassphrase("");
      setBusy(false);
    }
  }, [dialog.open, dialog.mode]);

  const isImport = dialog.mode === "import";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);

    const result = isImport
      ? await importKey({
          name,
          private_key: privateKey,
          passphrase: passphrase.length > 0 ? passphrase : null,
        })
      : await generateKey({ name });

    setBusy(false);

    if (!result.ok) {
      toast.error(isImport ? "Could not import Key" : "Could not generate Key", {
        description: result.error,
      });
      return;
    }

    toast.success(isImport ? "Key imported" : "ed25519 key generated", {
      description: `${result.value.key_type} · ${result.value.fingerprint}`,
    });
    closeKeyDialog();
  }

  return (
    <Dialog
      open={dialog.open}
      onOpenChange={(open) => !open && closeKeyDialog()}
    >
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{isImport ? "Import Key" : "Generate Key"}</DialogTitle>
          <DialogDescription>
            {isImport
              ? "Paste an OpenSSH private key. It is sealed inside the Vault and never reaches the webview again."
              : "Creates an ed25519 key pair inside the Vault. Copy the public key to your server."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="key-name">{t("Name")}</Label>
            <Input
              id="key-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={isImport ? "Work laptop" : "Teerm ed25519"}
              required
              autoFocus
              maxLength={120}
            />
          </div>

          {isImport ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="key-material">{t("Private key")}</Label>
                <Textarea
                  id="key-material"
                  value={privateKey}
                  onChange={(event) => setPrivateKey(event.target.value)}
                  placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----"}
                  required
                  spellCheck={false}
                  className="min-h-[140px] font-mono text-[11px]"
                />
                <p className="text-[10px] text-muted-foreground">
                  {t("ed25519, RSA, and ECDSA are supported. PuTTY .ppk files are not.")}</p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="key-passphrase">
                  {t("Passphrase")}{" "}
                  <span className="text-muted-foreground">{t("(if encrypted)")}</span>
                </Label>
                <Input
                  id="key-passphrase"
                  type="password"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  autoComplete="off"
                />
                <p className="text-[10px] text-muted-foreground">
                  {t("The key is decrypted once, then stored inside the encrypted Vault.")}</p>
              </div>
            </>
          ) : (
            <div className="flex items-start gap-2.5 rounded-lg border border-border/70 bg-card/40 px-3 py-3">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
              <div>
                <p className="text-[12px] font-medium">{t("ed25519")}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  {t("Modern, fast, and supported by every current OpenSSH server. The public key will be available to copy after creation.")}</p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeKeyDialog}
              disabled={busy}
            >
              {t("Cancel")}</Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : (
                <KeyRound data-icon="inline-start" />
              )}
              {isImport ? "Import Key" : "Generate Key"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
