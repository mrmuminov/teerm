import { describe, expect, it } from "vitest";

import { normalizeLanguage, translate } from "@/lib/i18n";
import ru from "@/locales/ru";
import uz from "@/locales/uz";

describe("translate", () => {
  it("returns the English text for English and for missing translations", () => {
    expect(translate("en", "Lock now")).toBe("Lock now");
    expect(translate("uz", "A string nobody translated")).toBe(
      "A string nobody translated",
    );
  });

  it("fills placeholders", () => {
    expect(translate("en", "Use at least {count} characters.", { count: 10 })).toBe(
      "Use at least 10 characters.",
    );
  });

  it("leaves unknown placeholders untouched", () => {
    expect(translate("en", "Hello {name}", {})).toBe("Hello {name}");
  });
});

describe("normalizeLanguage", () => {
  it("accepts supported languages and falls back to English", () => {
    expect(normalizeLanguage("uz")).toBe("uz");
    expect(normalizeLanguage("ru")).toBe("ru");
    expect(normalizeLanguage("de")).toBe("en");
    expect(normalizeLanguage(undefined)).toBe("en");
  });
});

describe("dictionaries", () => {
  const placeholders = (text: string) =>
    [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

  it("translate the same strings in both languages", () => {
    expect(Object.keys(uz).sort()).toEqual(Object.keys(ru).sort());
  });

  it("keep every placeholder of the English source", () => {
    for (const [name, dictionary] of [["uz", uz], ["ru", ru]] as const) {
      for (const [source, translated] of Object.entries(dictionary)) {
        expect(placeholders(translated), `${name}: ${source}`).toEqual(
          placeholders(source),
        );
      }
    }
  });
});

describe("translateBackendMessage", () => {
  it("translates fixed and templated messages from the Rust core", async () => {
    const { setActiveLanguage, translateBackendMessage } = await import(
      "@/lib/translate"
    );
    setActiveLanguage("uz");

    expect(translateBackendMessage("vault is locked")).toBe("Vault qulflangan");
    expect(translateBackendMessage("invalid input: label is required")).toBe(
      "nomi majburiy",
    );
    expect(translateBackendMessage("not found: port forward")).toBe(
      "Topilmadi: port yo‘naltirish",
    );

    setActiveLanguage("en");
  });

  it("keeps unknown messages as they are", async () => {
    const { setActiveLanguage, translateBackendMessage } = await import(
      "@/lib/translate"
    );
    setActiveLanguage("ru");

    expect(translateBackendMessage("something unexpected")).toBe(
      "something unexpected",
    );

    setActiveLanguage("en");
  });
});
