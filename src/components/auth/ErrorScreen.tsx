import { RefreshCw, ShieldAlert } from "lucide-react";

import { AuthLayout } from "@/components/auth/AuthLayout";
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
import { useT } from "@/lib/i18n";

type ErrorScreenProps = {
  message: string | null;
  onRetry: () => void;
};

export function ErrorScreen({ message, onRetry }: ErrorScreenProps) {
  const t = useT();
  return (
    <AuthLayout>
      <Card className="border border-border/60 bg-card/80 shadow-2xl shadow-black/40 backdrop-blur">
        <CardHeader className="gap-2 pb-2">
          <div className="mb-1 flex size-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive ring-1 ring-destructive/20">
            <ShieldAlert className="size-5" />
          </div>
          <CardTitle className="text-xl">{t("Teerm could not start")}</CardTitle>
          <CardDescription>
            {t("The local vault could not be read. Your data has not been modified.")}</CardDescription>
        </CardHeader>

        <CardContent className="grid gap-4 pt-2">
          <Alert variant="destructive">
            <ShieldAlert />
            <AlertTitle>{t("Startup error")}</AlertTitle>
            <AlertDescription>
              {message ?? "Unknown error. Please restart the app."}
            </AlertDescription>
          </Alert>

          <Button onClick={onRetry} className="w-full" size="lg">
            <RefreshCw />
            {t("Try again")}</Button>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
