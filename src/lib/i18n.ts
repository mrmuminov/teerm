import { useSettingsStore } from "@/stores/settings";
import ru from "@/locales/ru";
import uz from "@/locales/uz";

export type Language = "en" | "uz" | "ru";

export const LANGUAGES: { value: Language; label: string }[] = [
  { value: "en", label: "English" },
  { value: "uz", label: "O‘zbekcha" },
  { value: "ru", label: "Русский" },
];

type Dictionary = Record<string, string>;
type Params = Record<string, string | number>;

const DICTIONARIES: Record<Language, Dictionary | null> = {
  en: null,
  uz,
  ru,
};

export function normalizeLanguage(value: string | undefined): Language {
  return value === "uz" || value === "ru" ? value : "en";
}

/**
 * Translates an English source string. The English text is the key, so a
 * string without a translation simply stays English. `{name}` placeholders
 * are filled from `params`.
 */
export function translate(
  language: Language,
  text: string,
  params?: Params,
): string {
  const translated = DICTIONARIES[language]?.[text] ?? text;
  if (!params) {
    return translated;
  }

  return translated.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in params ? String(params[name]) : placeholder,
  );
}

export type Translate = (text: string, params?: Params) => string;

/** Translator for the saved language, for React components. */
export function useT(): Translate {
  const language = useSettingsStore((state) => state.settings?.language);
  const resolved = normalizeLanguage(language);

  return (text, params) => translate(resolved, text, params);
}

/** Translator for code outside React, such as store toasts. */
export function currentT(): Translate {
  const language = normalizeLanguage(
    useSettingsStore.getState().settings?.language,
  );

  return (text, params) => translate(language, text, params);
}
