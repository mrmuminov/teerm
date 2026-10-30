import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Loader2,
  LockKeyhole,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import { AuthLayout } from "@/components/auth/AuthLayout";
import { PasswordField } from "@/components/auth/PasswordField";
import { RestoreDialog } from "@/components/auth/RestoreDialog";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { MIN_PASSWORD_LENGTH, passwordStrength } from "@/lib/password";
import { cn } from "@/lib/utils";
import { useVaultStore } from "@/stores/vault";

export function OnboardingScreen() {
  const create = useVaultStore((state) => state.create);
  const busy = useVaultStore((state) => state.busy);
  const error = useVaultStore((state) => state.error);
  const clearError = useVaultStore((state) => state.clearError);

  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);

  useEffect(() => {
    clearError();
  }, [clearError]);

  const strength = useMemo(() => passwordStrength(password), [password]);
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirmation.length > 0 && password !== confirmation;
  const canSubmit =
    password.length >= MIN_PASSWORD_LENGTH && password === confirmation && acknowledged && !busy;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (canSubmit) {
      void create(password);
    }
  }

  return (
    <AuthLayout>
      <Card className="border border-border/60 bg-card/80 shadow-2xl shadow-black/40 backdrop-blur">
        <CardHeader className="gap-2 pb-2">
          <div className="mb-1 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
            <LockKeyhole className="size-5" />
          </div>
          <CardTitle className="text-xl">Create your vault</CardTitle>
          <CardDescription>
            Choose a master password. It encrypts every host, key, and password
            stored on this device.
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-2">
          <form onSubmit={handleSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <PasswordField
                id="master-password"
                label="Master password"
                value={password}
                onChange={setPassword}
                placeholder="At least 10 characters"
                autoComplete="new-password"
                autoFocus
                disabled={busy}
              />

              {password.length > 0 && (
                <div className="grid gap-1.5">
                  <div className="flex gap-1">
                    {[0, 1, 2, 3].map((index) => (
                      <div
                        key={index}
                        className={cn(
                          "h-1 flex-1 rounded-full bg-muted transition-colors",
                          index < strength.score &&
                            (strength.score <= 1
                              ? "bg-destructive"
                              : strength.score === 2
                                ? "bg-amber-500"
                                : "bg-primary"),
                        )}
                      />
                    ))}
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    Strength: {strength.label}
                  </span>
                </div>
              )}

              {tooShort && (
                <p className="text-xs text-destructive">
                  Use at least {MIN_PASSWORD_LENGTH} characters.
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <PasswordField
                id="confirm-password"
                label="Confirm master password"
                value={confirmation}
                onChange={setConfirmation}
                placeholder="Repeat your master password"
                autoComplete="new-password"
                disabled={busy}
              />
              {mismatch && (
                <p className="text-xs text-destructive">
                  Passwords do not match.
                </p>
              )}
            </div>

            <Alert className="border-amber-500/25 bg-amber-500/5">
              <TriangleAlert className="text-amber-500" />
              <AlertTitle>There is no password recovery</AlertTitle>
              <AlertDescription>
                If you forget this password, the vault cannot be opened. Keep an
                encrypted export somewhere safe.
              </AlertDescription>
            </Alert>

            <div className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-background/40 p-3">
              <Checkbox
                id="acknowledge"
                checked={acknowledged}
                onCheckedChange={(value) => setAcknowledged(value === true)}
                disabled={busy}
                className="mt-0.5"
              />
              <Label
                htmlFor="acknowledge"
                className="text-xs leading-relaxed font-normal text-muted-foreground"
              >
                I understand that a lost master password cannot be recovered.
              </Label>
            </div>

            {error && (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>Could not create the vault</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              className="mt-1 w-full"
              size="lg"
              disabled={!canSubmit}
            >
              {busy ? (
                <Loader2 className="animate-spin" />
              ) : (
                <LockKeyhole />
              )}
              Create vault
            </Button>
          </form>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 w-full text-muted-foreground"
            disabled={busy}
            onClick={() => setRestoreOpen(true)}
          >
            Restore from an export
          </Button>
        </CardContent>
      </Card>

      <RestoreDialog open={restoreOpen} onOpenChange={setRestoreOpen} />

      <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
        <ShieldCheck className="size-3.5" />
        Your master password never leaves this device.
      </p>
    </AuthLayout>
  );
}
