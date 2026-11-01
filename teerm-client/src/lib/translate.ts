import ru from "@/locales/ru";
import uz from "@/locales/uz";

export type Language = "en" | "uz" | "ru";

type Dictionary = Record<string, string>;
export type Params = Record<string, string | number>;

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

let activeLanguage: Language = "en";

/** Kept in step with the saved setting by `useLanguageSync`. */
export function setActiveLanguage(language: Language): void {
  activeLanguage = language;
}

/** Translator for code outside React, such as store toasts and errors. */
export function tr(text: string, params?: Params): string {
  return translate(activeLanguage, text, params);
}

// Error messages the Rust core builds from a template. Each pattern keeps the
// English template as the dictionary key; captures fill its placeholders.
const MESSAGE_PATTERNS: { pattern: RegExp; template: string; names: string[] }[] = [
  { pattern: /^(.+) is required$/, template: "{field} is required", names: ["field"] },
  {
    pattern: /^(.+) must be at most (\d+) characters$/,
    template: "{field} must be at most {max} characters",
    names: ["field", "max"],
  },
  {
    pattern: /^(.+) must be between 1 and 65535$/,
    template: "{field} must be between 1 and 65535",
    names: ["field"],
  },
  {
    pattern: /^(.+) must not contain spaces$/,
    template: "{field} must not contain spaces",
    names: ["field"],
  },
  {
    pattern: /^master password must be at least (\d+) characters$/,
    template: "master password must be at least {count} characters",
    names: ["count"],
  },
  { pattern: /^not found: (.+)$/, template: "not found: {item}", names: ["item"] },
  {
    pattern: /^a rule already listens on (.+) for this host$/,
    template: "a rule already listens on {address} for this host",
    names: ["address"],
  },
];

const FIELD_NAMES = new Set([
  "address",
  "bind address",
  "bind port",
  "group name",
  "key name",
  "port",
  "tag name",
  "target host",
  "target port",
  "username",
  "label",
  "name",
  "host",
  "host group",
  "key",
  "known host",
  "port forward",
  "running port forward",
  "tag",
  "transfer",
]);

/**
 * Translates a message from the Rust core. Fixed messages are looked up
 * directly, templated ones through `MESSAGE_PATTERNS`, and a trailing
 * `: <detail>` (an OS or library error) is kept as is.
 */
export function translateBackendMessage(message: string): string {
  const input = message.replace(/^invalid input: /, "");

  const direct = translate(activeLanguage, input);
  if (direct !== input) {
    return direct;
  }

  for (const { pattern, template, names } of MESSAGE_PATTERNS) {
    const match = input.match(pattern);
    if (!match) {
      continue;
    }

    const params: Params = {};
    names.forEach((name, index) => {
      const value = match[index + 1];
      params[name] = FIELD_NAMES.has(value) ? tr(value) : value;
    });
    return tr(template, params);
  }

  const detailAt = input.indexOf(": ");
  if (detailAt > 0) {
    const head = input.slice(0, detailAt);
    const translatedHead = tr(head);
    if (translatedHead !== head) {
      return `${translatedHead}${input.slice(detailAt)}`;
    }
  }

  return message;
}
