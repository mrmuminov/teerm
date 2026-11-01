import { useSettingsStore } from "@/stores/settings";
import {
  normalizeLanguage,
  setActiveLanguage,
  translate,
  tr,
  type Language,
  type Params,
} from "@/lib/translate";

export const LANGUAGES: { value: Language; label: string }[] = [
  { value: "en", label: "English" },
  { value: "uz", label: "O‘zbekcha" },
  { value: "ru", label: "Русский" },
];

export { normalizeLanguage, translate, tr };
export type { Language };

export type Translate = (text: string, params?: Params) => string;

/** Translator for the saved language, for React components. */
export function useT(): Translate {
  const language = useSettingsStore((state) => state.settings?.language);
  const resolved = normalizeLanguage(language);

  return (text, params) => translate(resolved, text, params);
}

/** Keeps the non-React translator in step with the saved language. */
export function useLanguageSync(): void {
  const language = useSettingsStore((state) => state.settings?.language);
  const resolved = normalizeLanguage(language);

  // Set during render so children translate with the new language at once.
  setActiveLanguage(resolved);
}
