import { useState } from "react";

import { PhraseCard } from "@/components/auth/PhraseCard";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { errorMessage, ipc } from "@/lib/ipc";

/**
 * Offers a random BIP39 word phrase as the Master Password. The phrase is
 * passed up to fill the password fields and shown so it can be written down.
 */
export function PhraseGenerator({
  onGenerated,
  disabled = false,
}: {
  onGenerated: (phrase: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [phrase, setPhrase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate(words: 12 | 24) {
    setError(null);
    try {
      const generated = await ipc.vaultGeneratePhrase(words);
      setPhrase(generated);
      onGenerated(generated);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>{t("Or use a random word phrase:")}</span>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={disabled}
          onClick={() => void generate(12)}
        >
          {t("12 words")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={disabled}
          onClick={() => void generate(24)}
        >
          {t("24 words")}
        </Button>
      </div>
      {phrase && <PhraseCard phrase={phrase} />}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
