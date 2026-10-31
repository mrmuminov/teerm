import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Fingerprint,
  KeyRound,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  TriangleAlert,
} from "lucide-react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useSessionsStore, type SessionDialog } from "@/stores/sessions";
import { useT } from "@/lib/i18n";

type PasswordDialogState = Extract<SessionDialog, { kind: "password" }>;
type HostKeyDialogState = Extract<SessionDialog, { kind: "host-key" }>;
type KeyboardDialogState = Extract<
  SessionDialog,
  { kind: "keyboard-interactive" }
>;

function addressLabel(address: string, port: number): string {
  return port === 22 ? address : `${address}:${port}`;
}

function DialogIcon({
  tone = "primary",
  children,
}: {
  tone?: "primary" | "warning" | "danger";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ring-1",
        tone === "danger" &&
          "bg-destructive/10 text-destructive ring-destructive/20",
        tone === "warning" &&
          "bg-amber-400/10 text-amber-300 ring-amber-400/20",
        tone === "primary" && "bg-primary/10 text-primary ring-primary/15",
      )}
    >
      {children}
    </span>
  );
}

function DetailLine({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 text-[11px]">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 break-all text-right text-foreground/90",
          mono && "font-mono text-[10.5px]",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function FingerprintBlock({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  const t = useT();
  return (
    <div className="space-y-1">
      <p className="text-[9.5px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
        {label}
      </p>
      <p
        className={cn(
          "break-all rounded-md border px-2 py-1.5 font-mono text-[10.5px] leading-relaxed",
          danger
            ? "border-destructive/25 bg-destructive/5 text-destructive"
            : "border-border/60 bg-background/60 text-foreground/90",
        )}
      >
        {value || t("Unknown")}
      </p>
    </div>
  );
}

function PasswordDialogContent({ dialog }: { dialog: PasswordDialogState }) {
  const t = useT();
  const submitPassword = useSessionsStore((state) => state.submitPassword);
  const cancelDialog = useSessionsStore((state) => state.cancelDialog);
  const [password, setPassword] = useState("");

  function submit() {
    if (dialog.busy || password.length === 0) {
      return;
    }
    void submitPassword(dialog.tabId, password);
  }

  return (
    <>
      <DialogHeader className="flex-row items-start gap-3">
        <DialogIcon>
          <LockKeyhole className="size-4" />
        </DialogIcon>
        <div className="min-w-0 flex-1 space-y-1">
          <DialogTitle>{t("Password required")}</DialogTitle>
          <DialogDescription className="truncate">
            {dialog.label} ·{" "}
            <span className="font-mono text-[11px]">
              {dialog.username}@{addressLabel(dialog.address, dialog.port)}
            </span>
          </DialogDescription>
        </div>
      </DialogHeader>

      <div className="grid gap-3">
        <PasswordField
          id={`session-password-${dialog.tabId}`}
          label={t("Password")}
          value={password}
          onChange={setPassword}
          onEnter={submit}
          autoFocus
          disabled={dialog.busy}
          placeholder={t("Password for {username}", { username: dialog.username })}
        />

        {dialog.error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/25 bg-destructive/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-destructive"
          >
            {dialog.error}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          onClick={() => void cancelDialog()}
          disabled={dialog.busy}
        >
          {t("Cancel")}</Button>
        <Button
          onClick={submit}
          disabled={dialog.busy || password.length === 0}
        >
          {dialog.busy ? (
            <Loader2 className="animate-spin" data-icon="inline-start" />
          ) : (
            <KeyRound data-icon="inline-start" />
          )}
          {dialog.busy ? t("Connecting…") : t("Connect")}
        </Button>
      </DialogFooter>
    </>
  );
}

function HostKeyDialogContent({ dialog }: { dialog: HostKeyDialogState }) {
  const t = useT();
  const acceptHostKey = useSessionsStore((state) => state.acceptHostKey);
  const replaceHostKey = useSessionsStore((state) => state.replaceHostKey);
  const cancelDialog = useSessionsStore((state) => state.cancelDialog);
  const changed = dialog.variant === "changed";
  const primaryAction = changed ? replaceHostKey : acceptHostKey;

  return (
    <>
      <DialogHeader className="flex-row items-start gap-3">
        <DialogIcon tone={changed ? "danger" : "warning"}>
          {changed ? (
            <ShieldAlert className="size-4" />
          ) : (
            <ShieldQuestion className="size-4" />
          )}
        </DialogIcon>
        <div className="min-w-0 flex-1 space-y-1">
          <DialogTitle>
            {changed ? t("Host key changed") : t("Unrecognized host key")}
          </DialogTitle>
          <DialogDescription>
            {changed
              ? t("Verify this change before connecting to the server.")
              : t("Trust this server only after checking its fingerprint.")}
          </DialogDescription>
        </div>
      </DialogHeader>

      <div
        className={cn(
          "rounded-lg border p-3",
          changed
            ? "border-destructive/30 bg-destructive/10"
            : "border-amber-400/25 bg-amber-400/[0.06]",
        )}
      >
        <p
          className={cn(
            "flex items-center gap-2 text-[12px]",
            changed
              ? "font-semibold text-destructive"
              : "font-medium text-amber-200",
          )}
        >
          <TriangleAlert className="size-3.5 shrink-0" />
          {changed ? (
            <span>{t("The server's host key has changed")}</span>
          ) : (
            <span>{t("This server is not trusted yet")}</span>
          )}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {changed
            ? t("This can happen when a server is reinstalled, but it can also mean someone is intercepting the connection. Only replace the key if you know why it changed.")
            : t("Compare this fingerprint with the one provided by the server administrator through a separate, trusted channel.")}
        </p>
      </div>

      <div className="grid gap-2.5 rounded-lg border border-border/70 bg-background/40 p-3">
        <DetailLine label={t("Host")} value={dialog.label} />
        <DetailLine
          label={t("Address")}
          value={addressLabel(dialog.address, dialog.port)}
          mono
        />
        <DetailLine label={t("Key type")} value={dialog.keyType} mono />

        {changed && (
          <FingerprintBlock
            label={t("Known fingerprint")}
            value={dialog.knownFingerprint ?? "Unknown"}
          />
        )}
        <FingerprintBlock
          label={changed ? t("New fingerprint") : t("Fingerprint")}
          value={dialog.fingerprint}
          danger={changed}
        />
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          onClick={() => void cancelDialog()}
          disabled={dialog.busy}
        >
          {t("Cancel")}</Button>
        <Button
          variant={changed ? "destructive" : "default"}
          onClick={() => void primaryAction(dialog.tabId)}
          disabled={dialog.busy}
        >
          {dialog.busy ? (
            <Loader2 className="animate-spin" data-icon="inline-start" />
          ) : changed ? (
            <RefreshCw data-icon="inline-start" />
          ) : (
            <ShieldCheck data-icon="inline-start" />
          )}
          {dialog.busy
            ? t("Connecting…")
            : changed
              ? t("Replace & Connect")
              : t("Trust & Connect")}
        </Button>
      </DialogFooter>
    </>
  );
}

function KeyboardInteractiveContent({
  dialog,
}: {
  dialog: KeyboardDialogState;
}) {
  const t = useT();
  const submitAuthResponses = useSessionsStore(
    (state) => state.submitAuthResponses,
  );
  const cancelDialog = useSessionsStore((state) => state.cancelDialog);
  const [responses, setResponses] = useState<string[]>(() =>
    dialog.prompts.map(() => ""),
  );

  useEffect(() => {
    setResponses(dialog.prompts.map(() => ""));
  }, [dialog.prompts]);

  function updateResponse(index: number, value: string) {
    setResponses((current) =>
      current.map((response, position) =>
        position === index ? value : response,
      ),
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dialog.busy) {
      return;
    }

    void submitAuthResponses(
      dialog.tabId,
      dialog.prompts.map((_, index) => responses[index] ?? ""),
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader className="flex-row items-start gap-3">
        <DialogIcon>
          <KeyRound className="size-4" />
        </DialogIcon>
        <div className="min-w-0 flex-1 space-y-1">
          <DialogTitle>
            {dialog.name.trim() || t("Authentication required")}
          </DialogTitle>
          <DialogDescription>
            {dialog.instructions.trim() ||
              t("Additional verification requested by {label}.", { label: dialog.label })}
          </DialogDescription>
        </div>
      </DialogHeader>

      <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background/40 px-3 py-2 text-[10px] text-muted-foreground">
        <Fingerprint className="size-3 shrink-0" />
        <span className="truncate font-mono">{dialog.label}</span>
      </div>

      <div className="grid gap-3">
        {dialog.prompts.map((prompt, index) => {
          const id = `session-auth-${dialog.tabId}-${index}`;

          return (
            <div key={id} className="grid gap-1.5">
              <Label htmlFor={id}>
                {prompt.prompt.trim() || t("Response {value}", { value: index + 1 })}
              </Label>
              <Input
                id={id}
                type={prompt.echo ? "text" : "password"}
                value={responses[index] ?? ""}
                onChange={(event) => updateResponse(index, event.target.value)}
                autoFocus={index === 0}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                disabled={dialog.busy}
                className="h-9 bg-background/60"
              />
            </div>
          );
        })}

        {dialog.prompts.length === 0 && (
          <p className="rounded-md border border-border/60 bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
            {t("The server did not provide any prompts. Continue to finish authentication.")}</p>
        )}
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => void cancelDialog()}
          disabled={dialog.busy}
        >
          {t("Cancel")}</Button>
        <Button type="submit" disabled={dialog.busy}>
          {dialog.busy ? (
            <Loader2 className="animate-spin" data-icon="inline-start" />
          ) : (
            <KeyRound data-icon="inline-start" />
          )}
          {dialog.busy ? t("Verifying…") : t("Continue")}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function SessionDialogs() {
  const dialog = useSessionsStore((state) => state.dialog);
  const cancelDialog = useSessionsStore((state) => state.cancelDialog);

  return (
    <Dialog
      open={dialog !== null}
      onOpenChange={(open) => {
        if (!open && dialog && !dialog.busy) {
          void cancelDialog();
        }
      }}
    >
      <DialogContent
        className={cn(
          dialog?.kind === "host-key"
            ? "sm:max-w-[460px]"
            : "sm:max-w-[400px]",
        )}
        showCloseButton={!dialog?.busy}
      >
        {dialog?.kind === "password" && (
          <PasswordDialogContent
            key={`password:${dialog.tabId}`}
            dialog={dialog}
          />
        )}

        {dialog?.kind === "host-key" && (
          <HostKeyDialogContent
            key={`host-key:${dialog.tabId}:${dialog.variant}`}
            dialog={dialog}
          />
        )}

        {dialog?.kind === "keyboard-interactive" && (
          <KeyboardInteractiveContent
            key={`keyboard-interactive:${dialog.tabId}:${dialog.name}`}
            dialog={dialog}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
