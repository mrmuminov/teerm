/**
 * True when the browser-only IPC mock is installed. The mock is loaded in Vite
 * dev mode before React mounts; the real Tauri webview never exposes this
 * marker.
 */
export function isDevMock(): boolean {
  return (
    typeof window !== "undefined" && "__TEERM_DEV_EVENTS__" in window
  );
}
