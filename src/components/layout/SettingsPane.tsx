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
import { LANGUAGES, normalizeLanguage, useT } from "@/lib/i18n";

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
  const t = useT();
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
      toast.error(t("Could not save settings"), {
        description: reason ?? "Try again in a moment.",
      });
    }
  }

  async function chooseDownloadFolder() {
    if (isDevMock()) {
      toast.info(t("Folder picker is available in the desktop app"), {
        description: t("The SFTP panel uses the mock Downloads folder here."),
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
      toast.error(t("Could not open folder picker"), {
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
            <p className="text-xs">{t("Loading settings…")}</p>
          </div>
        ) : (
          <Alert variant="destructive" className="max-w-md">
            <TriangleAlert />
            <AlertTitle>{t("Could not load settings")}</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              {error ?? "Unknown error."}
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => void load(true)}
              >
                {t("Try again")}</Button>
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
            {t("Preferences")}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {t("Settings")}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {t("Stored on this device only. Nothing is synced anywhere.")}</p>
        </header>

        <div className="mt-6 space-y-4">
          <SettingsSection
            icon={ShieldCheck}
            title={t("Vault & security")}
            description={t("Your encrypted store for hosts, keys, and secrets.")}
          >
            <SettingsRow
              label={t("Vault status")}
              description={t("The master key is held in memory while unlocked.")}
            >
              <Badge className="border border-primary/25 bg-primary/10 text-primary">
                <span className="size-1.5 rounded-full bg-primary" />
                {t("Unlocked")}</Badge>
            </SettingsRow>

            <Separator />

            <SettingsRow
              label={t("Master Password")}
              description={t("Re-encrypt the Vault with a new password.")}
            >
              <Button
                variant="outline"
                size="sm"
                onClick={() => setChangePasswordOpen(true)}
              >
                {t("Change")}</Button>
            </SettingsRow>

            <Separator />

            <SettingsRow
              label={t("Export & import")}
              description={t("Back up the Vault to a file, or load one from another device.")}
            >
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setImportOpen(true)}
                >
                  {t("Import")}</Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setExportOpen(true)}
                >
                  {t("Export")}</Button>
              </div>
            </SettingsRow>

            <Separator />

            <SettingsRow
              label={t("Auto-lock")}
              description={t("Lock the vault after this much inactivity.")}
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
                  <SelectItem value="5">{t("5 minutes")}</SelectItem>
                  <SelectItem value="15">{t("15 minutes")}</SelectItem>
                  <SelectItem value="30">{t("30 minutes")}</SelectItem>
                  <SelectItem value="60">{t("1 hour")}</SelectItem>
                </SelectContent>
              </Select>
            </SettingsRow>

            <Separator />

            <SettingsRow
              label={t("Strict host key checking")}
              description={t("Refuse servers that are not already trusted.")}
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
                  {t("There is no master password recovery. Keep an encrypted export somewhere safe.")}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void lock()}
              >
                <LockKeyhole data-icon="inline-start" />
                {t("Lock now")}</Button>
            </div>
          </SettingsSection>

          <SettingsSection
            icon={Info}
            title={t("Appearance & language")}
            description={t("Interface preferences for this device.")}
          >
            <SettingsRow
              label={t("Theme")}
              description={t("Choose a light or dark interface, or follow the system.")}
            >
              <Select
                value={settings.app_theme}
                onValueChange={(value) =>
                  void save({ app_theme: value }, "Theme updated")
                }
              >
                <SelectTrigger size="sm" className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dark">{t("Dark")}</SelectItem>
                  <SelectItem value="light">{t("Light")}</SelectItem>
                  <SelectItem value="system">{t("System")}</SelectItem>
                </SelectContent>
              </Select>
            </SettingsRow>

            <Separator />

            <SettingsRow
              label={t("Language")}
              description={t("Language of the interface. Untranslated text stays in English.")}
            >
              <Select
                value={normalizeLanguage(settings.language)}
                onValueChange={(value) =>
                  void save({ language: value }, t("Language updated"))
                }
              >
                <SelectTrigger size="sm" className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((language) => (
                    <SelectItem key={language.value} value={language.value}>
                      {language.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection
            icon={FolderTree}
            title={t("SFTP")}
            description={t("Remote file browser and transfer preferences.")}
          >
            <SettingsRow
              label={t("Show hidden files")}
              description={t("Include dotfiles in remote folder listings.")}
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
              label={t("Download folder")}
              description={t("Where files downloaded from the SFTP panel are saved.")}
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
                  {t("Change")}</Button>
              </div>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection
            icon={Info}
            title={t("About")}
            description={t("Build and storage details.")}
          >
            <SettingsRow
              label={t("Version")}
              description={t("Teerm desktop client.")}
            >
              <span className="font-mono text-[11px] text-muted-foreground">
                {appInfo ? `v${appInfo.version}` : "—"}
              </span>
            </SettingsRow>

            <Separator />

            <SettingsRow
              label={t("Platform")}
              description={appInfo?.os ?? "Unknown platform"}
            >
              <span className="font-mono text-[11px] capitalize text-muted-foreground">
                {appInfo?.os ?? "—"}
              </span>
            </SettingsRow>

            <Separator />

            <SettingsRow
              label={t("Vault format")}
              description={t("vault.teermvault · Argon2id · XChaCha20-Poly1305")}
            >
              <span className="font-mono text-[11px] text-muted-foreground">
                v1
              </span>
            </SettingsRow>
          </SettingsSection>
        </div>

        <p className="mt-6 pb-2 text-center text-[10px] text-muted-foreground">
          {t("Teerm is local-first by design. No account, no telemetry.")}</p>
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
