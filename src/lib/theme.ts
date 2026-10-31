import { useEffect, useState } from "react";

import { useSettingsStore } from "@/stores/settings";

export type ThemePreference = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

/** Unknown stored values fall back to dark, the app's original look. */
export function resolveTheme(
  preference: string | undefined,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "light") {
    return "light";
  }
  if (preference === "system") {
    return systemPrefersDark ? "dark" : "light";
  }
  return "dark";
}

function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.(SYSTEM_DARK_QUERY).matches ?? true;
}

/**
 * Applies the saved theme preference to the document and returns the theme
 * that is actually in effect, following the OS setting for `system`.
 */
export function useThemeSync(): ResolvedTheme {
  const preference = useSettingsStore((state) => state.settings?.app_theme);
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);

  useEffect(() => {
    const query = window.matchMedia?.(SYSTEM_DARK_QUERY);
    if (!query) {
      return;
    }

    const onChange = (event: MediaQueryListEvent) =>
      setPrefersDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const resolved = resolveTheme(preference, prefersDark);

  useEffect(() => applyTheme(resolved), [resolved]);

  return resolved;
}
