import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

/** A BIP39 phrase laid out as numbered words, with a copy button. */
export function PhraseCard({ phrase }: { phrase: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const words = phrase.split(" ");

  async function copy() {
    try {
      await navigator.clipboard.writeText(phrase);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // The words stay selectable on screen.
    }
  }

  return (
    <div className="rounded-lg border border-border/70 bg-background/50 p-3">
      <ol className="grid grid-cols-3 gap-x-3 gap-y-1 font-mono text-[11.5px]">
        {words.map((word, index) => (
          <li key={`${index}-${word}`} className="flex gap-1.5 select-all">
            <span className="w-5 text-right text-muted-foreground/70 tabular-nums">
              {index + 1}
            </span>
            <span>{word}</span>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-[10.5px] leading-snug text-muted-foreground">
          {t("Write these words down in order. Anyone who has them can open your Vault.")}
        </p>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="shrink-0"
          onClick={() => void copy()}
        >
          {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
          {copied ? t("Copied") : t("Copy")}
        </Button>
      </div>
    </div>
  );
}
