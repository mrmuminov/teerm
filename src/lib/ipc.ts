import { invoke } from "@tauri-apps/api/core";

import { tr, translateBackendMessage } from "@/lib/translate";

export type VaultStatus = {
  exists: boolean;
  unlocked: boolean;
  recovery_enabled: boolean;
};

export type AppError = {
  code: string;
  message: string;
  address?: string;
  port?: number;
  key_type?: string;
  fingerprint?: string;
  known_fingerprint?: string;
};

export type AppInfo = {
  name: string;
  version: string;
  os: string;
};

export type TerminalSettings = {
  font_family: string;
  font_size: number;
  scrollback: number;
  cursor_style: string;
  cursor_blink: boolean;
  copy_on_select: boolean;
};

export type Settings = {
  app_theme: string;
  language: string;
  auto_lock_minutes: number;
  download_dir: string | null;
  strict_host_key_checking: boolean;
  sftp_show_hidden: boolean;
  terminal: TerminalSettings;
};

export type ForwardKind = "local" | "remote";

export type Host = {
  id: string;
  label: string;
  address: string;
  port: number;
  username: string;
  group_id: string | null;
  tag_ids: string[];
  key_id: string | null;
  has_password: boolean;
  monitoring: boolean;
  created_at: string;
  updated_at: string;
};

export type HostInput = {
  label: string;
  address: string;
  port: number;
  username: string;
  group_id: string | null;
  tag_ids: string[];
  key_id: string | null;
  password?: string | null;
  clear_password?: boolean;
  monitoring?: boolean;
};

export type HostGroup = {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
};

export type GroupInput = {
  name: string;
  parent_id: string | null;
};

export type Tag = {
  id: string;
  name: string;
  color: string | null;
  host_count: number;
  created_at: string;
  updated_at: string;
};

export type TagInput = {
  name: string;
  color: string | null;
};

export type Key = {
  id: string;
  name: string;
  key_type: string;
  public_key: string;
  fingerprint: string;
  created_at: string;
  updated_at: string;
};

export type KeyImportInput = {
  name: string;
  private_key: string;
  passphrase?: string | null;
};

export type KeyGenerateInput = {
  name: string;
};

export type KeyRenameInput = {
  name: string;
};

export type PortForward = {
  id: string;
  host_id: string;
  kind: ForwardKind;
  bind_address: string;
  bind_port: number;
  target_host: string;
  target_port: number;
  auto_start: boolean;
  created_at: string;
  updated_at: string;
};

export type ExportMode = "full" | "metadata";
export type ImportMode = "merge" | "replace";

export type EntityCounts = {
  hosts: number;
  groups: number;
  tags: number;
  keys: number;
  port_forwards: number;
  known_hosts: number;
};

export type MergeOutcome = {
  added: EntityCounts;
  skipped: EntityCounts;
  duplicated: EntityCounts;
};

export type ImportPreview = {
  includes_secrets: boolean;
  can_replace: boolean;
  incoming: EntityCounts;
  merge: MergeOutcome;
};

export type ImportResult = {
  mode: ImportMode;
  merge: MergeOutcome | null;
  backup_path: string | null;
};

export type MemoryUsage = {
  total_kib: number;
  used_kib: number;
  swap_total_kib: number;
  swap_used_kib: number;
};

export type DiskUsage = {
  mount: string;
  filesystem: string;
  size_kib: number;
  used_kib: number;
};

export type GpuUsage = {
  name: string;
  utilization_percent: number;
  memory_used_mib: number;
  memory_total_mib: number;
  temperature_c: number | null;
};

export type NetworkRate = {
  rx_total_bytes: number;
  tx_total_bytes: number;
  rx_bytes_per_sec: number | null;
  tx_bytes_per_sec: number | null;
};

export type MonitorSample = {
  supported: boolean;
  cpu_percent: number | null;
  cores: number | null;
  load: [number, number, number] | null;
  memory: MemoryUsage | null;
  disks: DiskUsage[];
  network: NetworkRate | null;
  gpus: GpuUsage[];
  uptime_secs: number | null;
};

export type ForwardState = "running" | "stopped" | "failed";

export type ForwardStatus = {
  sessionId: string;
  forwardId: string;
  state: ForwardState;
  message: string | null;
};

export type ForwardInput = {
  host_id: string;
  kind: ForwardKind;
  bind_address: string;
  bind_port: number;
  target_host: string;
  target_port: number;
  auto_start: boolean;
};

export type KnownHost = {
  id: string;
  address: string;
  port: number;
  key_type: string;
  fingerprint: string;
  added_at: string;
};

export type OpenedSession = {
  sessionId: string;
  keyType: string;
  fingerprint: string;
  publicKey: string;
  newHostKey: boolean;
};

export type SessionOpenInput = {
  sessionId: string;
  hostId: string;
  password?: string | null;
  acceptNewHost?: boolean;
  replaceHostKey?: boolean;
  cols: number;
  rows: number;
};

export type SshAuthPrompt = {
  prompt: string;
  echo: boolean;
};

export type SftpEntry = {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  modified: number | null;
  permissions: number | null;
};

export type SftpOpenResult = { path: string };

export type TransferState = "running" | "completed" | "cancelled" | "failed";

export type TransferProgress = {
  transferId: string;
  transferred: number;
  total: number;
  state: TransferState;
  message: string | null;
};

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    typeof (value as AppError).message === "string"
  );
}

export function errorMessage(value: unknown): string {
  if (isAppError(value)) {
    return translateBackendMessage(value.message);
  }
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  return tr("Something went wrong. Please try again.");
}

export const ipc = {
  vaultStatus: () => invoke<VaultStatus>("vault_status"),
  vaultCreate: (password: string) =>
    invoke<void>("vault_create", { password }),
  vaultUnlock: (password: string) =>
    invoke<void>("vault_unlock", { password }),
  vaultLock: () => invoke<void>("vault_lock"),
  vaultChangePassword: (current: string, next: string) =>
    invoke<void>("vault_change_password", { current, new: next }),
  vaultGeneratePhrase: (words: 12 | 24) =>
    invoke<string>("vault_generate_phrase", { words }),
  vaultEnableRecovery: (password: string) =>
    invoke<string>("vault_enable_recovery", { password }),
  vaultDisableRecovery: (password: string) =>
    invoke<void>("vault_disable_recovery", { password }),
  vaultRecover: (phrase: string, newPassword: string) =>
    invoke<void>("vault_recover", { phrase, newPassword }),
  vaultCreateFromExport: (
    path: string,
    passphrase: string | null,
    password: string,
  ) => invoke<void>("vault_create_from_export", { path, passphrase, password }),
  vaultExport: (path: string, mode: ExportMode, passphrase: string | null) =>
    invoke<void>("vault_export", { path, mode, passphrase }),
  vaultImportPreview: (path: string, passphrase: string | null) =>
    invoke<ImportPreview>("vault_import_preview", { path, passphrase }),
  vaultImportApply: (
    path: string,
    passphrase: string | null,
    mode: ImportMode,
  ) => invoke<ImportResult>("vault_import_apply", { path, passphrase, mode }),
  settingsGet: () => invoke<Settings>("settings_get"),
  settingsUpdate: (settings: Settings) =>
    invoke<Settings>("settings_update", { settings }),
  appInfo: () => invoke<AppInfo>("app_info"),

  hostsList: () => invoke<Host[]>("hosts_list"),
  hostCreate: (input: HostInput) => invoke<Host>("host_create", { input }),
  hostUpdate: (id: string, input: HostInput) =>
    invoke<Host>("host_update", { id, input }),
  hostDelete: (id: string) => invoke<void>("host_delete", { id }),

  groupsList: () => invoke<HostGroup[]>("groups_list"),
  groupCreate: (input: GroupInput) =>
    invoke<HostGroup>("group_create", { input }),
  groupUpdate: (id: string, input: GroupInput) =>
    invoke<HostGroup>("group_update", { id, input }),
  groupDelete: (id: string) => invoke<void>("group_delete", { id }),

  tagsList: () => invoke<Tag[]>("tags_list"),
  tagCreate: (input: TagInput) => invoke<Tag>("tag_create", { input }),
  tagUpdate: (id: string, input: TagInput) =>
    invoke<Tag>("tag_update", { id, input }),
  tagDelete: (id: string) => invoke<void>("tag_delete", { id }),

  keysList: () => invoke<Key[]>("keys_list"),
  keyImport: (input: KeyImportInput) => invoke<Key>("key_import", { input }),
  keyGenerate: (input: KeyGenerateInput) =>
    invoke<Key>("key_generate", { input }),
  keyUpdate: (id: string, input: KeyRenameInput) =>
    invoke<Key>("key_update", { id, input }),
  keyDelete: (id: string) => invoke<void>("key_delete", { id }),

  forwardsList: (hostId: string) =>
    invoke<PortForward[]>("forwards_list", { hostId }),
  forwardCreate: (input: ForwardInput) =>
    invoke<PortForward>("forward_create", { input }),
  forwardUpdate: (id: string, input: ForwardInput) =>
    invoke<PortForward>("forward_update", { id, input }),
  forwardDelete: (id: string) => invoke<void>("forward_delete", { id }),
  forwardStart: (sessionId: string, forwardId: string) =>
    invoke<void>("forward_start", { sessionId, forwardId }),
  forwardStop: (sessionId: string, forwardId: string) =>
    invoke<void>("forward_stop", { sessionId, forwardId }),
  forwardsStatus: (sessionId: string) =>
    invoke<ForwardStatus[]>("forwards_status", { sessionId }),

  knownHostsList: () => invoke<KnownHost[]>("known_hosts_list"),
  knownHostDelete: (id: string) =>
    invoke<void>("known_host_delete", { id }),

  sessionOpen: (input: SessionOpenInput) =>
    invoke<OpenedSession>("session_open", {
      sessionId: input.sessionId,
      hostId: input.hostId,
      password: input.password ?? null,
      acceptNewHost: input.acceptNewHost ?? false,
      replaceHostKey: input.replaceHostKey ?? false,
      cols: input.cols,
      rows: input.rows,
    }),
  sessionWrite: (sessionId: string, data: string) =>
    invoke<void>("session_write", { sessionId, data }),
  sessionResize: (sessionId: string, cols: number, rows: number) =>
    invoke<void>("session_resize", { sessionId, cols, rows }),
  sessionClose: (sessionId: string) =>
    invoke<void>("session_close", { sessionId }),
  sessionLatency: (sessionId: string) =>
    invoke<number>("session_latency", { sessionId }),
  monitorSample: (sessionId: string) =>
    invoke<MonitorSample>("monitor_sample", { sessionId }),
  sessionAuthRespond: (sessionId: string, responses: string[] | null) =>
    invoke<void>("session_auth_respond", { sessionId, responses }),

  sftpOpen: (sessionId: string) =>
    invoke<SftpOpenResult>("sftp_open", { sessionId }),
  sftpList: (sessionId: string, path: string) =>
    invoke<SftpEntry[]>("sftp_list", { sessionId, path }),
  sftpMkdir: (sessionId: string, path: string) =>
    invoke<void>("sftp_mkdir", { sessionId, path }),
  sftpRename: (sessionId: string, from: string, to: string) =>
    invoke<void>("sftp_rename", { sessionId, from, to }),
  sftpDelete: (sessionId: string, path: string, isDir: boolean) =>
    invoke<void>("sftp_delete", { sessionId, path, isDir }),
  sftpChmod: (sessionId: string, path: string, mode: number) =>
    invoke<void>("sftp_chmod", { sessionId, path, mode }),
  sftpDownload: (sessionId: string, remotePath: string, localPath: string) =>
    invoke<string>("sftp_download", { sessionId, remotePath, localPath }),
  sftpUpload: (sessionId: string, localPath: string, remotePath: string) =>
    invoke<string>("sftp_upload", { sessionId, localPath, remotePath }),
  transferCancel: (transferId: string) =>
    invoke<void>("transfer_cancel", { transferId }),
};
