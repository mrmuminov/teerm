import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Loader2, RefreshCw, TriangleAlert, WifiOff, X } from "lucide-react";

import { TerminalSearchBar } from "@/components/terminal/TerminalSearchBar";
import { Button } from "@/components/ui/button";
import { isDevMock } from "@/lib/env";
import { ipc } from "@/lib/ipc";
import { attachTerminal } from "@/lib/terminal-bus";
import { cn } from "@/lib/utils";
import { useSessionsStore, type SessionTab } from "@/stores/sessions";
import { useSettingsStore } from "@/stores/settings";
import { useSftpStore } from "@/stores/sftp";

const TERMINAL_THEME: ITheme = {
  background: "#0b0e11",
  foreground: "#d9e3df",
  cursor: "#7ee2a8",
  cursorAccent: "#0b0e11",
  selectionBackground: "#7ee2a83d",
  selectionForeground: "#f5fffa",
  selectionInactiveBackground: "#7ee2a826",
  scrollbarSliderBackground: "#ffffff1f",
  scrollbarSliderHoverBackground: "#ffffff33",
  scrollbarSliderActiveBackground: "#ffffff45",
  black: "#171b20",
  red: "#f28b82",
  green: "#7ee2a8",
  yellow: "#e8c879",
  blue: "#8ab4f8",
  magenta: "#c79bf0",
  cyan: "#77d5c8",
  white: "#d9e3df",
  brightBlack: "#65707a",
  brightRed: "#ff9e95",
  brightGreen: "#9cf0bd",
  brightYellow: "#f6d896",
  brightBlue: "#a6c8ff",
  brightMagenta: "#d9b3ff",
  brightCyan: "#93e8dc",
  brightWhite: "#ffffff",
};

const FALLBACK_FONT_STACK =
  "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, monospace";

function terminalFontFamily(family: string | undefined): string {
  const trimmed = family?.trim();
  if (!trimmed) {
    return FALLBACK_FONT_STACK;
  }

  if (trimmed.includes(",")) {
    return `${trimmed}, ${FALLBACK_FONT_STACK}`;
  }

  return `'${trimmed.replace(/'/g, "")}', ${FALLBACK_FONT_STACK}`;
}

function normalizeCursorStyle(
  style: string | undefined,
): "block" | "underline" | "bar" {
  return style === "bar" || style === "underline" ? style : "block";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export function TerminalPane({
  tab,
  active,
}: {
  tab: SessionTab;
  active: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const doFitRef = useRef<((forceResize?: boolean) => void) | null>(null);
  const sessionIdRef = useRef(tab.sshSessionId);
  const searchRef = useRef<SearchAddon | null>(null);
  const activeRef = useRef(active);
  const [searchOpen, setSearchOpen] = useState(false);

  sessionIdRef.current = tab.sshSessionId;
  activeRef.current = active;

  const settings = useSettingsStore((state) => state.settings);
  const reconnect = useSessionsStore((state) => state.reconnect);
  const closeSession = useSessionsStore((state) => state.closeSession);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const terminalSettings = useSettingsStore.getState().settings?.terminal;
    const terminal = new Terminal({
      cursorBlink: terminalSettings?.cursor_blink ?? true,
      cursorStyle: normalizeCursorStyle(terminalSettings?.cursor_style),
      cursorInactiveStyle: "outline",
      cursorWidth: 2,
      fontFamily: terminalFontFamily(terminalSettings?.font_family),
      fontSize: terminalSettings?.font_size ?? 13,
      fontWeight: "400",
      fontWeightBold: "600",
      letterSpacing: 0,
      lineHeight: 1.2,
      scrollback: terminalSettings?.scrollback ?? 10000,
      theme: TERMINAL_THEME,
      allowTransparency: false,
      drawBoldTextInBrightColors: true,
      macOptionIsMeta: true,
      minimumContrastRatio: 1,
      rightClickSelectsWord: true,
      smoothScrollDuration: 0,
    });
    const fitAddon = new FitAddon();
    const encoder = new TextEncoder();

    const searchAddon = new SearchAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(
      new WebLinksAddon((_event, uri) => {
        if (isDevMock()) {
          window.open(uri, "_blank", "noopener");
        } else {
          void openUrl(uri).catch(() => {});
        }
      }),
    );
    terminal.open(host);
    searchRef.current = searchAddon;

    // The renderer falls back to the DOM one if WebGL is unavailable or the
    // context is lost.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      terminal.loadAddon(webgl);
    } catch {
      // Keep the default renderer.
    }

    if (terminal.element) {
      terminal.element.style.padding = "10px 14px";
      terminal.element.style.background = "#0b0e11";
    }

    terminalRef.current = terminal;

    let resizeTimer: number | null = null;

    const scheduleResize = (cols: number, rows: number) => {
      if (cols < 1 || rows < 1) {
        return;
      }

      if (resizeTimer !== null) {
        window.clearTimeout(resizeTimer);
      }

      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        const sessionId = sessionIdRef.current;
        if (!sessionId) {
          return;
        }

        void ipc.sessionResize(sessionId, cols, rows).catch(() => {});
      }, 80);
    };

    const fit = (forceResize = false) => {
      if (!host.isConnected) {
        return;
      }

      const rect = host.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) {
        return;
      }

      try {
        fitAddon.fit();
      } catch {
        return;
      }

      if (forceResize) {
        scheduleResize(terminal.cols, terminal.rows);
      }
    };

    doFitRef.current = fit;

    const resizeObserver = new ResizeObserver(() => fit());
    resizeObserver.observe(host);

    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      scheduleResize(cols, rows);
    });

    const dataDisposable = terminal.onData((data) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) {
        return;
      }

      const bytes = encoder.encode(data);
      void ipc.sessionWrite(sessionId, encodeBase64(bytes)).catch(() => {});
    });

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") {
        return true;
      }

      // App-level shortcuts handled in AppShell must not reach the shell.
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        ["k", "t", "w", "+", "=", "-", "_"].includes(event.key.toLowerCase())
      ) {
        return false;
      }

      if (
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        setSearchOpen(true);
        return false;
      }

      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) {
        return true;
      }

      const key = event.key.toLowerCase();

      if (key === "s") {
        const sessionId = sessionIdRef.current;
        if (!sessionId) {
          return true;
        }

        event.preventDefault();
        if (!event.repeat) {
          void useSftpStore.getState().toggle(tab.id, sessionId);
        }
        return false;
      }

      if (key === "c") {
        const selection = terminal.getSelection();
        if (!selection) {
          return true;
        }

        event.preventDefault();
        void navigator.clipboard.writeText(selection).catch(() => {});
        return false;
      }

      if (key === "v") {
        event.preventDefault();
        void navigator.clipboard
          .readText()
          .then((text) => {
            if (text) {
              terminal.paste(text);
            }
          })
          .catch(() => {});
        return false;
      }

      return true;
    });

    const detach = attachTerminal(tab.id, (bytes) => terminal.write(bytes));

    let disposed = false;
    const frame = requestAnimationFrame(() => {
      if (disposed) {
        return;
      }

      fit(true);
      if (activeRef.current) {
        terminal.focus();
      }
    });

    void document.fonts?.ready.then(() => {
      if (!disposed) {
        fit();
      }
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);

      if (resizeTimer !== null) {
        window.clearTimeout(resizeTimer);
      }

      resizeObserver.disconnect();
      resizeDisposable.dispose();
      dataDisposable.dispose();
      detach();
      doFitRef.current = null;
      searchRef.current = null;
      terminalRef.current = null;
      terminal.dispose();
      host.replaceChildren();
    };
  }, [tab.id]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !settings) {
      return;
    }

    const terminalSettings = settings.terminal;
    const fontSize = Number.isFinite(terminalSettings.font_size)
      ? clamp(terminalSettings.font_size, 8, 36)
      : 13;
    const scrollback = Number.isFinite(terminalSettings.scrollback)
      ? clamp(Math.floor(terminalSettings.scrollback), 0, 200_000)
      : 10000;

    terminal.options.fontFamily = terminalFontFamily(
      terminalSettings.font_family,
    );
    terminal.options.fontSize = fontSize;
    terminal.options.scrollback = scrollback;
    terminal.options.cursorStyle = normalizeCursorStyle(
      terminalSettings.cursor_style,
    );
    terminal.options.cursorBlink = terminalSettings.cursor_blink;

    doFitRef.current?.();
  }, [settings]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      doFitRef.current?.();
      terminalRef.current?.focus();
    });

    return () => cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => {
    if (tab.status !== "connected" || !tab.sshSessionId) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      doFitRef.current?.(true);
      if (activeRef.current) {
        terminalRef.current?.focus();
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [tab.status, tab.sshSessionId]);

  const showStatusPill =
    tab.status === "connecting" || tab.status === "authenticating";
  const showOverlay =
    tab.status === "disconnected" || tab.status === "error";

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-[#0b0e11]">
      <div ref={hostRef} className="h-full w-full" />

      {searchOpen && (
        <TerminalSearchBar
          search={searchRef.current}
          onClose={() => {
            setSearchOpen(false);
            terminalRef.current?.focus();
          }}
        />
      )}

      {showStatusPill && (
        <div className="pointer-events-none absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-full border border-primary/20 bg-background/75 px-2.5 py-1 text-[10px] font-medium text-primary shadow-lg shadow-black/30 backdrop-blur">
          <Loader2 className="size-3 animate-spin" />
          {tab.status === "connecting" ? "Connecting…" : "Authenticating…"}
        </div>
      )}

      {showOverlay && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0b0e11]/85 p-6 backdrop-blur-[2px]">
          <div className="w-full max-w-[360px] rounded-xl border border-border/80 bg-card/95 p-5 text-center shadow-2xl shadow-black/50 ring-1 ring-black/30">
            <div
              className={cn(
                "mx-auto flex size-10 items-center justify-center rounded-full ring-1",
                tab.status === "error"
                  ? "bg-destructive/10 text-destructive ring-destructive/20"
                  : "bg-muted/60 text-muted-foreground ring-border/70",
              )}
            >
              {tab.status === "error" ? (
                <TriangleAlert className="size-5" />
              ) : (
                <WifiOff className="size-5" />
              )}
            </div>

            <h2 className="mt-3 text-[13px] font-semibold text-foreground">
              {tab.status === "error"
                ? "Session failed"
                : "Session disconnected"}
            </h2>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              {tab.message ??
                (tab.status === "error"
                  ? "The connection could not be established."
                  : "The connection to this host has ended.")}
            </p>
            <p className="mt-3 truncate font-mono text-[10px] text-muted-foreground/80">
              {tab.username}@{tab.address}
              {tab.port === 22 ? "" : `:${tab.port}`}
            </p>

            <div className="mt-4 flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void closeSession(tab.id)}
              >
                <X data-icon="inline-start" />
                Close
              </Button>
              <Button size="sm" onClick={() => void reconnect(tab.id)}>
                <RefreshCw data-icon="inline-start" />
                Reconnect
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
