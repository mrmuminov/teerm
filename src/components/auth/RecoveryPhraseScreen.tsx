import { useState } from "react";
import { ShieldCheck } from "lucide-react";

import { AuthLayout } from "@/components/auth/AuthLayout";
import { PhraseCard } from "@/components/auth/PhraseCard";
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
import { useT } from "@/lib/i18n";
import { useVaultStore } from "@/stores/vault";

/**
 * Shown right after a Vault is created. The Recovery Phrase appears only
 * here, so the app cannot be entered until it is confirmed as written down.
 */
export function RecoveryPhraseScreen({ phrase }: { phrase: string }) {
  const t = useT();
  const dismiss = useVaultStore((state) => state.dismissRecoveryPhrase);
  const [writtenDown, setWrittenDown] = useState(false);

  return (
    <AuthLayout>
      <Card className="border border-border/60 bg-card/80 shadow-2xl shadow-black/40 backdrop-blur">
        <CardHeader className="gap-2 pb-2">
          <div className="mb-1 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
            <ShieldCheck className="size-5" />
          </div>
          <CardTitle className="text-xl">{t("Save your recovery phrase")}</CardTitle>
          <CardDescription>
            {t("If you ever forget your Master Password, these 24 words are the only way to open your Vault and set a new one.")}
          </CardDescription>
        </CardHeader>

        <CardContent className="grid gap-4 pt-2">
          <PhraseCard phrase={phrase} />

          <div className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-background/40 p-3">
            <Checkbox
              id="recovery-saved"
              checked={writtenDown}
              onCheckedChange={(value) => setWrittenDown(value === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor="recovery-saved"
              className="text-xs leading-relaxed font-normal text-muted-foreground"
            >
              {t("I wrote the phrase down and keep it somewhere safe. It will not be shown again.")}
            </Label>
          </div>

          <Button size="lg" disabled={!writtenDown} onClick={dismiss}>
            {t("Continue")}
          </Button>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
