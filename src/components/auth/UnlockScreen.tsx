import { useEffect, useState, type FormEvent } from "react";
import { Loader2, LockKeyhole, ShieldCheck, TriangleAlert } from "lucide-react";

import { AuthLayout } from "@/components/auth/AuthLayout";
import { PasswordField } from "@/components/auth/PasswordField";
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
import { useVaultStore } from "@/stores/vault";
import { useT } from "@/lib/i18n";

export function UnlockScreen() {
  const t = useT();
  const unlock = useVaultStore((state) => state.unlock);
  const busy = useVaultStore((state) => state.busy);
  const error = useVaultStore((state) => state.error);
  const clearError = useVaultStore((state) => state.clearError);

  const [password, setPassword] = useState("");

  useEffect(() => {
    clearError();
  }, [clearError]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (password.length > 0 && !busy) {
      void unlock(password);
    }
  }

  return (
    <AuthLayout>
      <Card className="border border-border/60 bg-card/80 shadow-2xl shadow-black/40 backdrop-blur">
        <CardHeader className="gap-2 pb-2">
          <div className="mb-1 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
            <LockKeyhole className="size-5" />
          </div>
          <CardTitle className="text-xl">{t("Unlock your vault")}</CardTitle>
          <CardDescription>
            {t("Enter your master password to open Teerm.")}</CardDescription>
        </CardHeader>

        <CardContent className="pt-2">
          <form onSubmit={handleSubmit} className="grid gap-4">
            <PasswordField
              id="master-password"
              label={t("Master password")}
              value={password}
              onChange={setPassword}
              placeholder={t("Your master password")}
              autoComplete="current-password"
              autoFocus
              disabled={busy}
            />

            {error && (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>{t("Could not unlock")}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              className="mt-1 w-full"
              size="lg"
              disabled={password.length === 0 || busy}
            >
              {busy ? <Loader2 className="animate-spin" /> : <LockKeyhole />}
              {t("Unlock")}</Button>
          </form>
        </CardContent>
      </Card>

      <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
        <ShieldCheck className="size-3.5" />
        {t("No account. Your vault stays on this device.")}</p>
    </AuthLayout>
  );
}
