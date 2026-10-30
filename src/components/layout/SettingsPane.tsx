import { useState, type ReactNode } from "react";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
import {
  FolderTree,
  Info,
  Loader2,
  type LucideIcon,
  LockKeyhole,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { ChangePasswordDialog } from "@/components/auth/ChangePasswordDialog";
import { ExportDialog } from "@/components/vault/ExportDialog";
import { ImportDialog } from "@/components/vault/ImportDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { isDevMock } from "@/lib/env";
import { errorMessage, type Settings } from "@/lib/ipc";
import { useSettingsStore } from "@/stores/settings";
import { useVaultStore } from "@/stores/vault";

function SettingsSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border/70 bg-card/50">
      <header className="flex items-start gap-3 border-b border-border/60 px-4 py-3.5">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
          <Icon className="size-4" strokeWidth={1.8} />
        </div>
        <div>
          <h2 className="text-[13px] font-semibold">{title}</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {description}
          </p>
        </div>
      </header>
      <div>{children}</div>
    </section>
  );
}

function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium">{label}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SettingsPane() {
  const settings = useSettingsStore((state) => state.settings);
  const appInfo = useSettingsStore((state) => state.appInfo);
  const loading = useSettingsStore((state) => state.loading);
  const error = useSettingsStore((state) => state.error);
  const load = useSettingsStore((state) => state.load);
  const update = useSettingsStore((state) => state.update);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const lock = useVaultStore((state) => state.lock);

  async function save(patch: Partial<Settings>, message: string) {
    const saved = await update(patch);
    if (saved) {
      toast.success(message);
    } else {
      const reason = useSettingsStore.getState().error;
      toast.error("Could not save settings", {
        description: reason ?? "Try again in a moment.",
      });
    }
  }

  async function chooseDownloadFolder() {
    if (isDevMock()) {
      toast.info("Folder picker is available in the desktop app", {
        description: "The SFTP panel uses the mock Downloads folder here.",
      });
      return;
    }

    try {
      const selected = await openFolderDialog({
        directory: true,
        multiple: false,
        title: "Choose download folder",
        defaultPath: settings?.download_dir ?? undefined,
      });

      if (typeof selected === "string" && selected) {
        await save({ download_dir: selected }, "Download folder updated");
      }
    } catch (reason) {
      toast.error("Could not open folder picker", {
        description: errorMessage(reason),
      });
    }
  }

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center">
        {loading ? (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="size-5 animate-spin text-primary" />
            <p className="text-xs">Loading settings…</p>
          </div>
        ) : (
          <Alert variant="destructive" className="max-w-md">
            <TriangleAlert />
            <AlertTitle>Could not load settings</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              {error ?? "Unknown error."}
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => void load(true)}
              >
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto w-full max-w-[720px] px-8 py-8">
        <header>
          <p className="text-[10px] font-medium tracking-[0.16em] text-primary uppercase">
            Preferences
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Settings
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Stored on this device only. Nothing is synced anywhere.
          </p>
        </header>

        <div className="mt-6 space-y-4">
          <SettingsSection
            icon={ShieldCheck}
            title="Vault & security"
            description="Your encrypted store for hosts, keys, and secrets."
          >
            <SettingsRow
              label="Vault status"
              description="The master key is held in memory while unlocked."
            >
              <Badge className="border border-primary/25 bg-primary/10 text-primary">
                <span className="size-1.5 rounded-full bg-primary" />
                Unlocked
              </Badge>
            </SettingsRow>

            <Separator />

            <SettingsRow
              label="Master Password"
              description="Re-encrypt the Vault with a new password."
            >
              <Button
                variant="outline"
                size="sm"
                onClick={() => setChangePasswordOpen(true)}
              >
                Change
              </Button>
            </SettingsRow>

            <Separator />

            <SettingsRow
              label="Export & import"
              description="Back up the Vault to a file, or load one from another device."
            >
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setImportOpen(true)}
                >
                  Import
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setExportOpen(true)}
                >
                  Export
                </Button>
              </div>
            </SettingsRow>

            <Separator />

            <SettingsRow
              label="Auto-lock"
              description="Lock the vault after this much inactivity."
            >
              <Select
                value={String(settings.auto_lock_minutes)}
                onValueChange={(value) =>
                  void save(
                    { auto_lock_minutes: Number(value) },
                    "Auto-lock updated",
                  )
                }
              >
                <SelectTrigger size="sm" className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 minutes</SelectItem>
                  <SelectItem value="15">15 minutes</SelectItem>
                  <SelectItem value="30">30 minutes</SelectItem>
                  <SelectItem value="60">1 hour</SelectItem>
                </SelectContent>
              </Select>
            </SettingsRow>

            <Separator />

            <SettingsRow
              label="Strict host key checking"
              description="Refuse servers that are not already trusted."
            >
              <Switch
                checked={settings.strict_host_key_checking}
                onCheckedChange={(checked) =>
                  void save(
                    { strict_host_key_checking: checked },
                    checked
                      ? "Strict host key checking enabled"
                      : "Strict host key checking disabled",
                  )
                }
              />
            </SettingsRow>

            <Separator />

            <div className="flex items-center justify-between gap-6 px-4 py-3">
              <div className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500/90" />
                <p className="max-w-[360px] text-[11px] leading-relaxed text-muted-foreground">
                  There is no master password recovery. Keep an encrypted
                  export somewhere safe.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void lock()}
              >
                <LockKeyhole data-icon="inline-start" />
                Lock now
              </Button>
            </div>
          </SettingsSection>

          <SettingsSection
            icon={Info}
            title="Appearance & language"
            description="Interface preferences for this device."
          >
            <SettingsRow
              label="Theme"
              description="Teerm ships with a purpose-built dark terminal theme."
            >
              <Badge variant="secondary" className="text-muted-foreground">
                Dark
              </Badge>
            </SettingsRow>

            <Separator />

            <SettingsRow
              label="Language"
              description="Uzbek and Russian are planned; the UI is i18n-ready."
            >
              <Badge variant="secondary" className="text-muted-foreground">
                English
              </Badge>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection
            icon={FolderTree}
            title="SFTP"
            description="Remote file browser and transfer preferences."
          >
            <SettingsRow
              label="Show hidden files"
              description="Include dotfiles in remote folder listings."
            >
              <Switch
                checked={settings.sftp_show_hidden}
                onCheckedChange={(checked) =>
                  void save(
                    { sftp_show_hidden: checked },
                    checked ? "Hidden files shown" : "Hidden files hidden",
                  )
                }
              />
            </SettingsRow>

            <Separator />

            <SettingsRow
              label="Download folder"
              description="Where files downloaded from the SFTP panel are saved."
            >
              <div className="flex max-w-[320px] items-center gap-2">
                <span
                  className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted-foreground"
                  title={settings.download_dir ?? undefined}
                >
                  {settings.download_dir ?? "Ask on first download"}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void chooseDownloadFolder()}
                >
                  Change
                </Button>
              </div>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection
            icon={Info}
            title="About"
            description="Build and storage details."
          >
            <SettingsRow
              label="Version"
              description="Teerm desktop client."
            >
              <span className="font-mono text-[11px] text-muted-foreground">
                {appInfo ? `v${appInfo.version}` : "—"}
              </span>
            </SettingsRow>

            <Separator />

            <SettingsRow
              label="Platform"
              description={appInfo?.os ?? "Unknown platform"}
            >
              <span className="font-mono text-[11px] capitalize text-muted-foreground">
                {appInfo?.os ?? "—"}
              </span>
            </SettingsRow>

            <Separator />

            <SettingsRow
              label="Vault format"
              description="vault.teermvault · Argon2id · XChaCha20-Poly1305"
            >
              <span className="font-mono text-[11px] text-muted-foreground">
                v1
              </span>
            </SettingsRow>
          </SettingsSection>
        </div>

        <p className="mt-6 pb-2 text-center text-[10px] text-muted-foreground">
          Teerm is local-first by design. No account, no telemetry.
        </p>
      </div>

      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <ChangePasswordDialog
        open={changePasswordOpen}
        onOpenChange={setChangePasswordOpen}
      />
    </div>
  );
}
