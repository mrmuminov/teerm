import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import {
  ArrowDown,
  ArrowUp,
  CornerLeftUp,
  Download,
  File,
  Folder,
  FolderPlus,
  FolderTree,
  Link2,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Upload,
  WifiOff,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { isDevMock } from "@/lib/env";
import { errorMessage, type SftpEntry } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import type { SessionTab } from "@/stores/sessions";
import { useSettingsStore } from "@/stores/settings";
import { useSftpStore, type TransferRecord } from "@/stores/sftp";
import { useUiStore } from "@/stores/ui";
import { useT } from "@/lib/i18n";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatSize(size: number): string {
  if (!Number.isFinite(size) || size < 0) {
    return "—";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function formatModified(modified: number | null): string {
  if (!modified || !Number.isFinite(modified)) {
    return "—";
  }

  const date = new Date(modified * 1000);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  const now = new Date();
  if (date.getFullYear() !== now.getFullYear()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
      2,
      "0",
    )}-${String(date.getDate()).padStart(2, "0")}`;
  }

  return `${MONTHS[date.getMonth()]} ${String(date.getDate()).padStart(
    2,
    "0",
  )} ${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

function transferPercent(transfer: TransferRecord): number {
  if (transfer.total > 0) {
    return Math.min(
      100,
      Math.max(0, Math.round((transfer.transferred / transfer.total) * 100)),
    );
  }

  return transfer.state === "completed" ? 100 : 0;
}

function FileRow({
  entry,
  onOpen,
  onDownload,
  onRename,
  onRemove,
}: {
  entry: SftpEntry;
  onOpen: () => void;
  onDownload: () => void;
  onRename: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <div
      role="button"
      tabIndex={0}
      title={entry.name}
      onDoubleClick={entry.isDir ? onOpen : onDownload}
      onKeyDown={(event) => {
        if (
          event.key === "Enter" &&
          event.target === event.currentTarget &&
          entry.isDir
        ) {
          event.preventDefault();
          onOpen();
        }
      }}
      className="group grid h-[30px] cursor-default grid-cols-[minmax(0,1fr)_70px_100px] items-center gap-2 rounded-md px-2 text-[11.5px] outline-none transition-colors hover:bg-foreground/[0.035] focus-visible:bg-foreground/[0.04] focus-visible:ring-1 focus-visible:ring-primary/50 focus-visible:ring-inset"
    >
      <div className="flex min-w-0 items-center gap-2">
        {entry.isDir ? (
          <Folder
            className="size-3.5 shrink-0 fill-primary/15 text-primary"
            strokeWidth={1.7}
          />
        ) : (
          <File
            className="size-3.5 shrink-0 text-muted-foreground/80"
            strokeWidth={1.7}
          />
        )}
        <span
          className={cn(
            "truncate",
            entry.isDir ? "text-foreground/95" : "text-foreground/80",
          )}
        >
          {entry.name}
        </span>
        {entry.isSymlink ? (
          <span
            className="flex shrink-0 items-center gap-0.5 rounded border border-border/70 px-1 py-px text-[8px] font-medium tracking-wide text-muted-foreground uppercase"
            title={t("Symbolic link")}
          >
            <Link2 className="size-2" />
            {t("link")}</span>
        ) : null}
      </div>

      <span className="truncate text-right font-mono text-[10px] text-muted-foreground/80 tabular-nums">
        {entry.isDir ? "—" : formatSize(entry.size)}
      </span>

      <div className="flex min-w-0 items-center justify-end gap-0.5">
        <span className="truncate font-mono text-[9.5px] text-muted-foreground/65 tabular-nums group-hover:hidden group-focus-within:hidden">
          {formatModified(entry.modified)}
        </span>
        <div
          className="hidden items-center gap-0.5 group-hover:flex group-focus-within:flex"
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Rename ${entry.name}`}
            title={t("Rename")}
            onClick={(event) => {
              event.stopPropagation();
              onRename();
            }}
          >
            <Pencil />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Delete ${entry.name}`}
            title={t("Delete")}
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 />
          </Button>
          {!entry.isDir ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Download ${entry.name}`}
              title={t("Download")}
              onClick={(event) => {
                event.stopPropagation();
                onDownload();
              }}
            >
              <Download />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TransferRow({
  transfer,
  onCancel,
  onDismiss,
}: {
  transfer: TransferRecord;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  const percent = transferPercent(transfer);
  const running = transfer.state === "running";
  const tone =
    transfer.state === "failed"
      ? "bg-destructive"
      : transfer.state === "cancelled"
        ? "bg-amber-400/80"
        : transfer.state === "completed"
          ? "bg-primary/75"
          : "bg-primary";

  return (
    <div className="group px-3 py-1.5">
      <div className="flex items-center gap-1.5">
        {transfer.direction === "upload" ? (
          <ArrowUp className="size-3 shrink-0 text-primary/80" />
        ) : (
          <ArrowDown className="size-3 shrink-0 text-primary/80" />
        )}
        <span
          className="min-w-0 flex-1 truncate text-[10.5px] text-foreground/85"
          title={`${transfer.name} — ${transfer.state}`}
        >
          {transfer.name}
        </span>
        <span className="shrink-0 font-mono text-[9px] text-muted-foreground tabular-nums">
          {transfer.state === "failed"
            ? "Failed"
            : transfer.state === "cancelled"
              ? "Cancelled"
              : `${percent}%`}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={
            running ? `Cancel ${transfer.name}` : `Dismiss ${transfer.name}`
          }
          title={running ? "Cancel transfer" : "Dismiss"}
          onClick={running ? onCancel : onDismiss}
          className="size-5 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3" />
        </Button>
      </div>
      <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-foreground/[0.06]">
        <div
          className={cn("h-full rounded-full transition-[width]", tone)}
          style={{ width: `${percent}%` }}
        />
      </div>
      {transfer.state === "failed" && transfer.message ? (
        <p className="mt-0.5 truncate text-[9px] text-destructive/80">
          {transfer.message}
        </p>
      ) : null}
    </div>
  );
}

export function SftpPanel({ tab }: { tab: SessionTab }) {
  const t = useT();
  const width = useSftpStore((state) => state.width);
  const tabState = useSftpStore((state) => state.tabs[tab.id]);
  const transfers = useSftpStore((state) => state.transfers);
  const refresh = useSftpStore((state) => state.refresh);
  const navigate = useSftpStore((state) => state.navigate);
  const goUp = useSftpStore((state) => state.goUp);
  const mkdir = useSftpStore((state) => state.mkdir);
  const rename = useSftpStore((state) => state.rename);
  const remove = useSftpStore((state) => state.remove);
  const addUploads = useSftpStore((state) => state.addUploads);
  const addDownload = useSftpStore((state) => state.addDownload);
  const cancelTransfer = useSftpStore((state) => state.cancelTransfer);
  const dismissTransfer = useSftpStore((state) => state.dismissTransfer);
  const clearFinished = useSftpStore((state) => state.clearFinished);
  const setWidth = useSftpStore((state) => state.setWidth);

  const activeSessionId = useUiStore((state) => state.activeSessionId);
  const section = useUiStore((state) => state.section);
  const settings = useSettingsStore((state) => state.settings);
  const showHidden = settings?.sftp_show_hidden ?? false;
  const downloadDir = settings?.download_dir ?? null;
  const devMock = isDevMock();

  const [dragOver, setDragOver] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameTarget, setRenameTarget] = useState<SftpEntry | null>(null);
  const [renameName, setRenameName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SftpEntry | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  const sessionId = tab.status === "connected" ? tab.sshSessionId : null;
  const path = tabState?.path ?? "/";
  const loading = tabState?.loading ?? false;
  const error = tabState?.error ?? null;
  const entries = tabState?.entries ?? [];

  const visibleEntries = useMemo(
    () =>
      showHidden
        ? entries
        : entries.filter((entry) => !entry.name.startsWith(".")),
    [entries, showHidden],
  );

  const tabTransfers = useMemo(
    () => transfers.filter((transfer) => transfer.tabId === tab.id),
    [transfers, tab.id],
  );

  const runningTransfers = useMemo(
    () => tabTransfers.filter((transfer) => transfer.state === "running"),
    [tabTransfers],
  );

  const aggregatePercent = useMemo(() => {
    let transferred = 0;
    let total = 0;

    for (const transfer of runningTransfers) {
      transferred += transfer.transferred;
      total += transfer.total;
    }

    return total > 0 ? Math.round((transferred / total) * 100) : null;
  }, [runningTransfers]);

  const hasFinished = tabTransfers.some(
    (transfer) => transfer.state !== "running",
  );

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [tabState?.path]);

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (
      devMock ||
      section !== "hosts" ||
      !tabState?.visible ||
      activeSessionId !== tab.id ||
      tab.status !== "connected" ||
      !tab.sshSessionId
    ) {
      setDragOver(false);
      return;
    }

    const currentSession = tab.sshSessionId;
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;

        if (payload.type === "enter" || payload.type === "over") {
          setDragOver(true);
          return;
        }

        if (payload.type === "leave") {
          setDragOver(false);
          return;
        }

        if (payload.type === "drop") {
          setDragOver(false);
          if (payload.paths.length > 0) {
            void addUploads(tab.id, currentSession, [...payload.paths]);
          }
        }
      })
      .then((stop) => {
        if (disposed) {
          stop();
        } else {
          unlisten = stop;
        }
      })
      .catch((reason: unknown) => {
        console.warn(
          `[teerm] Drag-drop listener unavailable: ${errorMessage(reason)}`,
        );
      });

    return () => {
      disposed = true;
      setDragOver(false);
      unlisten?.();
    };
  }, [
    activeSessionId,
    addUploads,
    devMock,
    section,
    tab.id,
    tab.sshSessionId,
    tab.status,
    tabState?.visible,
  ]);

  function beginResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    resizeCleanupRef.current?.();

    const startX = event.clientX;
    const startWidth = width;
    const previousSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const move = (moveEvent: PointerEvent) => {
      setWidth(startWidth + (startX - moveEvent.clientX));
    };

    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.style.userSelect = previousSelect;
      document.body.style.cursor = previousCursor;
      resizeCleanupRef.current = null;
    };

    resizeCleanupRef.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  async function requestUpload() {
    if (!sessionId) {
      return;
    }

    if (devMock) {
      fileInputRef.current?.click();
      return;
    }

    try {
      const selected = await openFileDialog({
        multiple: true,
        directory: false,
        title: "Upload files",
      });
      if (!selected) {
        return;
      }

      const paths = Array.isArray(selected) ? selected : [selected];
      await addUploads(tab.id, sessionId, paths);
    } catch (reason) {
      toast.error(t("Could not open file picker"), {
        description: errorMessage(reason),
      });
    }
  }

  async function requestDownload(entry: SftpEntry) {
    if (entry.isDir) {
      toast.info(t("Folder download is not supported yet"));
      return;
    }

    if (!sessionId) {
      return;
    }

    let localDir = downloadDir?.trim() || "";

    if (devMock) {
      localDir = `/home/${tab.username}/Downloads`;
    } else if (!localDir) {
      try {
        const selected = await openFileDialog({
          directory: true,
          multiple: false,
          title: "Choose download folder",
          defaultPath: downloadDir ?? undefined,
        });

        if (typeof selected !== "string" || !selected) {
          return;
        }

        localDir = selected;
        const saved = await useSettingsStore
          .getState()
          .update({ download_dir: selected });

        if (!saved) {
          toast.error(t("Could not save download folder"), {
            description:
              useSettingsStore.getState().error ??
              "The download will use the selected folder anyway.",
          });
        }
      } catch (reason) {
        toast.error(t("Could not open folder picker"), {
          description: errorMessage(reason),
        });
        return;
      }
    }

    if (!localDir) {
      return;
    }

    await addDownload(tab.id, sessionId, entry, localDir);
  }

  async function submitNewFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sessionId || dialogBusy) {
      return;
    }

    setDialogBusy(true);
    const created = await mkdir(tab.id, sessionId, newFolderName);
    setDialogBusy(false);

    if (created) {
      setNewFolderOpen(false);
      setNewFolderName("");
    }
  }

  async function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sessionId || !renameTarget || dialogBusy) {
      return;
    }

    setDialogBusy(true);
    const renamed = await rename(tab.id, sessionId, renameTarget, renameName);
    setDialogBusy(false);

    if (renamed) {
      setRenameTarget(null);
      setRenameName("");
    }
  }

  async function confirmDelete() {
    if (!sessionId || !deleteTarget || dialogBusy) {
      return;
    }

    setDialogBusy(true);
    const deleted = await remove(tab.id, sessionId, deleteTarget);
    setDialogBusy(false);

    if (deleted) {
      setDeleteTarget(null);
    }
  }

  function openRenameDialog(entry: SftpEntry) {
    setRenameTarget(entry);
    setRenameName(entry.name);
  }

  const canRetry = Boolean(sessionId) && !loading;

  return (
    <aside
      aria-label={t("SFTP browser")}
      className="relative flex h-full min-h-0 shrink-0 flex-col border-l border-border/70 bg-sidebar"
      style={{ width }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("Resize SFTP panel")}
        title={t("Drag to resize")}
        onPointerDown={beginResize}
        onDoubleClick={() => setWidth(360)}
        className="absolute top-0 -left-[2px] z-20 h-full w-[4px] cursor-col-resize transition-colors hover:bg-primary/35 active:bg-primary/50"
      />

      <header className="flex h-9 shrink-0 items-center gap-1 border-b border-border/60 bg-sidebar/70 pr-1.5 pl-3">
        <FolderTree className="size-3.5 shrink-0 text-primary/75" />
        <span
          className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted-foreground"
          title={path}
        >
          {path}
        </span>
        {loading ? (
          <Loader2 className="size-3 shrink-0 animate-spin text-primary/75" />
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t("Refresh folder")}
          title={t("Refresh")}
          disabled={!sessionId || loading}
          onClick={() => {
            if (sessionId) {
              void refresh(tab.id, sessionId);
            }
          }}
          className="text-muted-foreground hover:text-foreground"
        >
          <RefreshCw />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t("Upload files")}
          title={t("Upload files")}
          disabled={!sessionId}
          onClick={() => void requestUpload()}
          className="text-muted-foreground hover:text-foreground"
        >
          <Upload />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t("New folder")}
          title={t("New folder")}
          disabled={!sessionId}
          onClick={() => {
            setNewFolderName("");
            setNewFolderOpen(true);
          }}
          className="text-muted-foreground hover:text-foreground"
        >
          <FolderPlus />
        </Button>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        aria-label={t("Upload files")}
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (!sessionId || files.length === 0) {
            return;
          }
          void addUploads(
            tab.id,
            sessionId,
            files.map((file) => file.name),
          );
        }}
      />

      {!sessionId ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted/40 text-muted-foreground ring-1 ring-border/60">
            <WifiOff className="size-4.5" />
          </div>
          <div>
            <p className="text-[12px] font-medium text-foreground/90">
              {t("SFTP unavailable")}</p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
              {t("Reconnect this session to browse remote files.")}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid h-6 shrink-0 grid-cols-[minmax(0,1fr)_70px_100px] items-center gap-2 border-b border-border/45 px-2 text-[8.5px] font-medium tracking-[0.12em] text-muted-foreground/60 uppercase">
            <span>{t("Name")}</span>
            <span className="text-right">{t("Size")}</span>
            <span className="text-right">{t("Modified")}</span>
          </div>

          {error && entries.length > 0 ? (
            <div className="flex shrink-0 items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-2.5 py-1.5">
              <TriangleAlert className="size-3 shrink-0 text-destructive" />
              <span className="min-w-0 flex-1 truncate text-[9.5px] text-destructive/90">
                {error}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={!canRetry}
                onClick={() => {
                  if (sessionId) {
                    void refresh(tab.id, sessionId);
                  }
                }}
                className="h-5 px-1.5 text-[9.5px] text-destructive hover:bg-destructive/15 hover:text-destructive"
              >
                {t("Retry")}</Button>
            </div>
          ) : null}

          <div
            ref={listRef}
            className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-1"
          >
            {loading && entries.length === 0 ? (
              <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-primary" />
                <span className="text-[10.5px]">{t("Loading folder…")}</span>
              </div>
            ) : error && entries.length === 0 ? (
              <div className="flex h-full min-h-[140px] flex-col items-center justify-center gap-2.5 px-5 text-center">
                <TriangleAlert className="size-5 text-destructive/85" />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {error}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={!canRetry}
                  onClick={() => {
                    if (sessionId) {
                      void refresh(tab.id, sessionId);
                    }
                  }}
                >
                  <RefreshCw data-icon="inline-start" />
                  {t("Retry")}</Button>
              </div>
            ) : (
              <>
                {path !== "/" ? (
                  <div
                    role="button"
                    tabIndex={0}
                    title={t("Parent folder")}
                    onDoubleClick={() => {
                      if (sessionId) {
                        void goUp(tab.id, sessionId);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && sessionId) {
                        event.preventDefault();
                        void goUp(tab.id, sessionId);
                      }
                    }}
                    className="group grid h-[30px] grid-cols-[minmax(0,1fr)_70px_100px] items-center gap-2 rounded-md px-2 text-[11.5px] outline-none transition-colors hover:bg-foreground/[0.035] focus-visible:bg-foreground/[0.04] focus-visible:ring-1 focus-visible:ring-primary/50 focus-visible:ring-inset"
                  >
                    <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
                      <CornerLeftUp className="size-3.5 shrink-0" />
                      <span className="font-mono">..</span>
                    </div>
                    <span />
                    <span />
                  </div>
                ) : null}

                {visibleEntries.map((entry) => (
                  <FileRow
                    key={entry.path}
                    entry={entry}
                    onOpen={() => {
                      if (sessionId) {
                        void navigate(tab.id, sessionId, entry.path);
                      }
                    }}
                    onDownload={() => void requestDownload(entry)}
                    onRename={() => openRenameDialog(entry)}
                    onRemove={() => setDeleteTarget(entry)}
                  />
                ))}

                {!loading && !error && visibleEntries.length === 0 ? (
                  <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 px-5 text-center">
                    <Folder className="size-5 text-muted-foreground/45" />
                    <p className="text-[10.5px] text-muted-foreground">
                      {entries.length === 0
                        ? "This folder is empty"
                        : "No visible files"}
                    </p>
                    {entries.length > 0 ? (
                      <p className="max-w-[220px] text-[9.5px] leading-relaxed text-muted-foreground/70">
                        {t("Hidden files are turned off. Enable them in Settings.")}</p>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </>
      )}

      {tabTransfers.length > 0 ? (
        <footer className="shrink-0 border-t border-border/60 bg-sidebar/45">
          <div className="flex h-7 items-center justify-between gap-2 border-b border-border/45 px-3">
            <span className="text-[9.5px] font-medium text-muted-foreground">
              {tabTransfers.length} {t("transfer")}{tabTransfers.length === 1 ? "" : "s"}
              {aggregatePercent !== null ? (
                <span className="ml-2 font-mono text-primary/90 tabular-nums">
                  {aggregatePercent}%
                </span>
              ) : null}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={!hasFinished}
              onClick={() => clearFinished(tab.id)}
              className="h-5 px-1.5 text-[9px] text-muted-foreground hover:text-foreground"
            >
              {t("Clear finished")}</Button>
          </div>
          <div className="max-h-[130px] overflow-y-auto">
            {tabTransfers.map((transfer) => (
              <TransferRow
                key={transfer.id}
                transfer={transfer}
                onCancel={() => void cancelTransfer(transfer.id)}
                onDismiss={() => dismissTransfer(transfer.id)}
              />
            ))}
          </div>
        </footer>
      ) : null}

      {dragOver ? (
        <div className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary/55 bg-primary/10 text-primary backdrop-blur-[1px]">
          <Upload className="size-5" />
          <span className="text-[11px] font-medium">{t("Drop to upload")}</span>
          <span className="max-w-[240px] truncate font-mono text-[9.5px] text-primary/70">
            {path}
          </span>
        </div>
      ) : null}

      <Dialog
        open={newFolderOpen}
        onOpenChange={(open) => {
          if (!open && dialogBusy) {
            return;
          }
          setNewFolderOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-[360px]">
          <form onSubmit={submitNewFolder} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t("New folder")}</DialogTitle>
              <DialogDescription>
                {t("Create a folder inside")}{" "}
                <span className="font-mono text-[12px]">{path}</span>.
              </DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              placeholder={t("Folder name")}
              aria-label={t("Folder name")}
              spellCheck={false}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewFolderOpen(false)}
                disabled={dialogBusy}
              >
                {t("Cancel")}</Button>
              <Button
                type="submit"
                disabled={dialogBusy || !newFolderName.trim()}
              >
                {dialogBusy ? (
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                ) : null}
                {t("Create")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open && !dialogBusy) {
            setRenameTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[360px]">
          <form onSubmit={submitRename} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t("Rename")}</DialogTitle>
              <DialogDescription className="truncate">
                {renameTarget?.name}
              </DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              value={renameName}
              onChange={(event) => setRenameName(event.target.value)}
              aria-label={t("New name")}
              spellCheck={false}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameTarget(null)}
                disabled={dialogBusy}
              >
                {t("Cancel")}</Button>
              <Button
                type="submit"
                disabled={
                  dialogBusy ||
                  !renameName.trim() ||
                  renameName.trim() === renameTarget?.name
                }
              >
                {dialogBusy ? (
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                ) : null}
                {t("Rename")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !dialogBusy) {
            setDeleteTarget(null);
          }
        }}
        title={deleteTarget?.isDir ? t("Delete folder") : t("Delete file")}
        description={
          <>
            <span className="font-medium text-foreground">
              {deleteTarget?.name}
            </span>{" "}
            {t("will be removed from the remote server. This cannot be undone.")}</>
        }
        confirmLabel={t("Delete")}
        destructive
        busy={dialogBusy}
        onConfirm={confirmDelete}
      />
    </aside>
  );
}
