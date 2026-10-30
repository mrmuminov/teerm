import type {
  AppInfo,
  ForwardKind,
  Host,
  HostGroup,
  Key,
  KnownHost,
  OpenedSession,
  PortForward,
  Settings,
  Tag,
} from "@/lib/ipc";

type MockMode = "onboarding" | "locked" | "unlocked";

type DevEventBus = {
  listen: (
    event: string,
    handler: (payload: unknown) => void,
  ) => Promise<() => void>;
  emit: (event: string, payload: unknown) => void;
};

const MOCK_KEY_TYPE = "ssh-ed25519";
const MOCK_PUBLIC_KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITeermMockHostKey";

const STAGING_ADDRESS = "staging.teerm.dev";
const STAGING_FINGERPRINT =
  "SHA256:TeermMockNewHostKeyStagingWebEd25519a1B2c3D4e5F6g7H8i9J0kL";
const PI_ADDRESS = "192.168.1.40";
const PI_OLD_FINGERPRINT =
  "SHA256:TeermMockOldRaspberryPiHostKey0pQ4sV7xL2nR9tY5uE1aD6gJ3kM";
const PI_NEW_FINGERPRINT =
  "SHA256:TeermMockNewRaspberryPiHostKey5uE1aD6gJ3kM0pQ4sV7xL2nR9tY";
const GENERIC_FINGERPRINT =
  "SHA256:TeermMockKnownHostKeyEd25519Z9yX8wV7uT6sR5qP4oN3mL2kJ1hG0fE";

/** Encode UTF-8 text so xterm can consume it as raw terminal bytes. */
function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...Array.from(bytes.subarray(offset, offset + chunkSize)),
    );
  }
  return btoa(binary);
}

/** Decode base64 produced by xterm's UTF-8 encoder. */
function decodeBase64(data: string): string {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

const defaultSettings: Settings = {
  app_theme: "dark",
  language: "en",
  auto_lock_minutes: 15,
  download_dir: null,
  strict_host_key_checking: false,
  sftp_show_hidden: false,
  terminal: {
    font_family: "JetBrains Mono",
    font_size: 13,
    scrollback: 10000,
    cursor_style: "block",
    cursor_blink: true,
    copy_on_select: false,
  },
};

const appInfo: AppInfo = {
  name: "Teerm",
  version: "0.1.0",
  os: "linux",
};

const now = "2026-10-29T09:00:00.000Z";

function uuid(): string {
  return crypto.randomUUID();
}

type MockSftpEntry = {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  modified: number | null;
  permissions: number | null;
};

type MockSftpNode = {
  isDir: boolean;
  size: number;
  modified: number | null;
  permissions: number;
};

type MockSftpSession = {
  home: string;
  nodes: Map<string, MockSftpNode>;
};

type MockTransferState = "running" | "completed" | "cancelled" | "failed";

type MockTransfer = {
  id: string;
  sessionId: string;
  total: number;
  transferred: number;
  timers: number[];
  onCompleted: (() => void) | null;
};

/** Normalize an absolute POSIX path. Mock-only: never touches a real disk. */
function normalizeMockRemotePath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

function mockRemoteParent(path: string): string {
  if (path === "/") {
    return "/";
  }
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function mockRemoteBasename(path: string): string {
  if (path === "/") {
    return "/";
  }
  return path.slice(path.lastIndexOf("/") + 1);
}

function mockRemoteJoin(parent: string, name: string): string {
  const base = normalizeMockRemotePath(parent);
  return normalizeMockRemotePath(base === "/" ? `/${name}` : `${base}/${name}`);
}

function mockLocalBasename(path: string): string {
  const parts = path.split(/[\\/]/);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index]) {
      return parts[index];
    }
  }
  return "";
}

type HostInputShape = {
  label: string;
  address: string;
  port: number;
  username: string;
  group_id: string | null;
  tag_ids: string[];
  key_id: string | null;
  password?: string | null;
  clear_password?: boolean;
};

/**
 * Browser-only IPC stand-in. It lets `npm run dev` render the real UI in a
 * normal browser for design work and screenshots. It never installs inside
 * Tauri because the real `__TAURI_INTERNALS__` bridge is already present.
 */
export function installDevMock() {
  if ("__TAURI_INTERNALS__" in window) {
    return;
  }

  const mode = (
    new URLSearchParams(window.location.search).get("mock") ?? "unlocked"
  ) as MockMode;

  let exists = mode !== "onboarding";
  let unlocked = mode === "unlocked";
  let settings = { ...defaultSettings };

  const groupProd: HostGroup = {
    id: "7f0d8a20-0000-4000-8000-000000000001",
    name: "Production",
    parent_id: null,
    created_at: now,
    updated_at: now,
  };
  const groupProdEu: HostGroup = {
    id: "7f0d8a20-0000-4000-8000-000000000002",
    name: "EU",
    parent_id: groupProd.id,
    created_at: now,
    updated_at: now,
  };
  const groupLab: HostGroup = {
    id: "7f0d8a20-0000-4000-8000-000000000003",
    name: "Homelab",
    parent_id: null,
    created_at: now,
    updated_at: now,
  };

  let groups: HostGroup[] = [groupProd, groupProdEu, groupLab];

  let tags: Tag[] = [
    {
      id: "7f0d8a20-0000-4000-8000-000000000011",
      name: "production",
      color: "#f28b82",
      host_count: 0,
      created_at: now,
      updated_at: now,
    },
    {
      id: "7f0d8a20-0000-4000-8000-000000000012",
      name: "database",
      color: "#7ee2a8",
      host_count: 0,
      created_at: now,
      updated_at: now,
    },
    {
      id: "7f0d8a20-0000-4000-8000-000000000013",
      name: "staging",
      color: "#8ab4f8",
      host_count: 0,
      created_at: now,
      updated_at: now,
    },
  ];

  const seedKey: Key = {
    id: "7f0d8a20-0000-4000-8000-000000000021",
    name: "Work laptop",
    key_type: "ssh-ed25519",
    public_key:
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDevMockPublicKeyMaterialForDesignPreviewOnly teerm",
    fingerprint: "SHA256:6J2s0mJ9X2cQfV0k9u3aB4z8pE1yR7tL5nW2hG4dK8s",
    created_at: now,
    updated_at: now,
  };

  const seedKeyTwo: Key = {
    id: "7f0d8a20-0000-4000-8000-000000000022",
    name: "Deploy RSA",
    key_type: "ssh-rsa",
    public_key:
      "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDMockRsaPublicKeyMaterialForPreview teerm",
    fingerprint: "SHA256:Qb7Vx3kP0nD8sL2fH5mW1jR4tY6uE9cA0gI3oZ8bN1k",
    created_at: now,
    updated_at: now,
  };

  let keys: Key[] = [seedKey, seedKeyTwo];

  const seedHosts: Host[] = [
    {
      id: "7f0d8a20-0000-4000-8000-000000000031",
      label: "API",
      address: "api.teerm.dev",
      port: 22,
      username: "deploy",
      group_id: groupProdEu.id,
      tag_ids: [tags[0].id],
      key_id: seedKey.id,
      has_password: false,
      created_at: now,
      updated_at: now,
    },
    {
      id: "7f0d8a20-0000-4000-8000-000000000032",
      label: "Postgres primary",
      address: "10.0.12.4",
      port: 2222,
      username: "postgres",
      group_id: groupProd.id,
      tag_ids: [tags[0].id, tags[1].id],
      key_id: null,
      has_password: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: "7f0d8a20-0000-4000-8000-000000000033",
      label: "Raspberry Pi",
      address: "192.168.1.40",
      port: 22,
      username: "pi",
      group_id: groupLab.id,
      tag_ids: [],
      key_id: seedKey.id,
      has_password: false,
      created_at: now,
      updated_at: now,
    },
    {
      id: "7f0d8a20-0000-4000-8000-000000000034",
      label: "Staging web",
      address: "staging.teerm.dev",
      port: 22,
      username: "ubuntu",
      group_id: null,
      tag_ids: [tags[2].id],
      key_id: seedKeyTwo.id,
      has_password: false,
      created_at: now,
      updated_at: now,
    },
  ];

  let hosts: Host[] = [...seedHosts];

  const mockRunningForwards: Record<string, Set<string>> = {};
  let forwards: PortForward[] = [
    {
      id: "7f0d8a20-0000-4000-8000-000000000041",
      host_id: seedHosts[1].id,
      kind: "local",
      bind_address: "127.0.0.1",
      bind_port: 5433,
      target_host: "localhost",
      target_port: 5432,
      auto_start: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: "7f0d8a20-0000-4000-8000-000000000042",
      host_id: seedHosts[1].id,
      kind: "remote",
      bind_address: "0.0.0.0",
      bind_port: 8080,
      target_host: "localhost",
      target_port: 3000,
      auto_start: false,
      created_at: now,
      updated_at: now,
    },
  ];

  let knownHosts: KnownHost[] = [
    {
      id: "7f0d8a20-0000-4000-8000-000000000051",
      address: "api.teerm.dev",
      port: 22,
      key_type: "ssh-ed25519",
      fingerprint: "SHA256:6J2s0mJ9X2cQfV0k9u3aB4z8pE1yR7tL5nW2hG4dK8s",
      added_at: now,
    },
    {
      id: "7f0d8a20-0000-4000-8000-000000000052",
      address: "10.0.12.4",
      port: 2222,
      key_type: "ssh-ed25519",
      fingerprint: "SHA256:Qb7Vx3kP0nD8sL2fH5mW1jR4tY6uE9cA0gI3oZ8bN1k",
      added_at: now,
    },
    {
      id: "7f0d8a20-0000-4000-8000-000000000053",
      address: PI_ADDRESS,
      port: 22,
      key_type: MOCK_KEY_TYPE,
      fingerprint: PI_OLD_FINGERPRINT,
      added_at: now,
    },
  ];

  function withTagCounts(list: Tag[]): Tag[] {
    return list.map((tag) => ({
      ...tag,
      host_count: hosts.filter((host) => host.tag_ids.includes(tag.id)).length,
    }));
  }

  type MockSession = {
    id: string;
    host: Host;
    cols: number;
    rows: number;
    line: string;
    welcomeTimer: number | null;
  };

  type PendingAuth = {
    respond: (responses: string[] | null) => void;
    cancel: () => void;
  };

  const eventHandlers = new Map<string, Set<(payload: unknown) => void>>();

  function emitEvent(event: string, payload: unknown): void {
    const handlers = eventHandlers.get(event);
    if (!handlers) {
      return;
    }
    for (const handler of Array.from(handlers)) {
      try {
        handler(payload);
      } catch (error) {
        console.error(
          `[teerm] dev mock event handler for "${event}" failed`,
          error,
        );
      }
    }
  }

  const devEventBus: DevEventBus = {
    listen: async (event, handler) => {
      let handlers = eventHandlers.get(event);
      if (!handlers) {
        handlers = new Set();
        eventHandlers.set(event, handlers);
      }
      const eventSet = handlers;
      eventSet.add(handler);
      return () => {
        eventSet.delete(handler);
        if (eventSet.size === 0 && eventHandlers.get(event) === eventSet) {
          eventHandlers.delete(event);
        }
      };
    },
    emit: emitEvent,
  };

  const mockSessions = new Map<string, MockSession>();
  const pendingAuth = new Map<string, PendingAuth>();
  const mockSftpSessions = new Map<string, MockSftpSession>();
  const mockTransfers = new Map<string, MockTransfer>();

  function findKnownHost(
    address: string,
    port: number,
  ): KnownHost | undefined {
    return knownHosts.find(
      (known) => known.address === address && known.port === port,
    );
  }

  function rememberKnownHost(
    address: string,
    port: number,
    fingerprint: string,
  ): void {
    const existing = findKnownHost(address, port);
    if (existing) {
      knownHosts = knownHosts.map((known) =>
        known.id === existing.id
          ? { ...known, key_type: MOCK_KEY_TYPE, fingerprint }
          : known,
      );
      return;
    }
    knownHosts = [
      ...knownHosts,
      {
        id: uuid(),
        address,
        port,
        key_type: MOCK_KEY_TYPE,
        fingerprint,
        added_at: new Date().toISOString(),
      },
    ];
  }

  function fingerprintForHost(host: Host): string {
    if (host.address === STAGING_ADDRESS) {
      return STAGING_FINGERPRINT;
    }
    if (host.address === PI_ADDRESS) {
      return PI_NEW_FINGERPRINT;
    }
    return (
      findKnownHost(host.address, host.port)?.fingerprint ??
      GENERIC_FINGERPRINT
    );
  }

  function hostKeyUnknown(host: Host, fingerprint: string) {
    return {
      code: "host_key_unknown",
      message: "the server host key is not trusted",
      address: host.address,
      port: host.port,
      key_type: MOCK_KEY_TYPE,
      fingerprint,
    };
  }

  function hostKeyChanged(
    host: Host,
    fingerprint: string,
    knownFingerprint: string,
  ) {
    return {
      code: "host_key_changed",
      message: "the server host key has changed",
      address: host.address,
      port: host.port,
      key_type: MOCK_KEY_TYPE,
      fingerprint,
      known_fingerprint: knownFingerprint,
    };
  }

  function authFailed() {
    return { code: "auth_failed", message: "authentication failed" };
  }

  function shellPrompt(host: Host): string {
    return (
      `\x1b[38;2;125;226;168m${host.username}@${host.address}\x1b[0m` +
      `:\x1b[38;2;138;180;248m~\x1b[0m$ `
    );
  }

  function welcomeBanner(host: Host): string {
    const teal = "\x1b[1;38;2;94;234;212m";
    const mint = "\x1b[38;2;125;226;168m";
    const reset = "\x1b[0m";
    return (
      `\r\n${teal}╭─ Teerm dev session ─────────────────────────────╮${reset}\r\n` +
      `${teal}╰─ ${mint}${host.label}${reset}${teal} · ` +
      `${host.username}@${host.address}:${host.port}${reset}\r\n\r\n` +
      shellPrompt(host)
    );
  }

  function emitSessionData(sessionId: string, text: string): void {
    emitEvent("ssh:data", { sessionId, data: encodeBase64(text) });
  }

  function startMockSession(
    sessionId: string,
    host: Host,
    cols: number,
    rows: number,
    newHostKey: boolean,
  ): OpenedSession {
    const session: MockSession = {
      id: sessionId,
      host,
      cols: cols > 0 ? cols : 120,
      rows: rows > 0 ? rows : 32,
      line: "",
      welcomeTimer: null,
    };
    mockSessions.set(sessionId, session);
    session.welcomeTimer = window.setTimeout(() => {
      session.welcomeTimer = null;
      if (!mockSessions.has(sessionId)) {
        return;
      }
      emitSessionData(sessionId, welcomeBanner(host));
    }, 250);

    return {
      sessionId,
      keyType: MOCK_KEY_TYPE,
      fingerprint: fingerprintForHost(host),
      publicKey: MOCK_PUBLIC_KEY,
      newHostKey,
    };
  }

  function closeMockSession(sessionId: string, reason: string): void {
    const session = mockSessions.get(sessionId);
    if (!session) {
      return;
    }
    if (session.welcomeTimer !== null) {
      window.clearTimeout(session.welcomeTimer);
      session.welcomeTimer = null;
    }
    clearMockSftpSession(sessionId);
    mockSessions.delete(sessionId);
    emitEvent("ssh:closed", { sessionId, reason });
  }

  const MOCK_UPLOAD_SIZE = 64 * 1024;
  const MOCK_TRANSFER_STEPS: Array<{
    delay: number;
    fraction: number;
    state: MockTransferState;
  }> = [
    { delay: 40, fraction: 0, state: "running" },
    { delay: 260, fraction: 0.25, state: "running" },
    { delay: 560, fraction: 0.6, state: "running" },
    { delay: 920, fraction: 1, state: "completed" },
  ];

  function sftpError(code: string, message: string) {
    return { code, message };
  }

  function requireMockSshSession(sessionId: string): MockSession {
    const session = mockSessions.get(sessionId);
    if (!session) {
      throw sftpError("session_not_found", "session is not connected");
    }
    return session;
  }

  function seedMockSftp(session: MockSession): MockSftpSession {
    const modified = Math.floor(Date.now() / 1000);
    const home = `/home/${session.host.username}`;
    const nodes = new Map<string, MockSftpNode>();

    const add = (
      path: string,
      isDir: boolean,
      size: number,
      permissions: number,
    ): void => {
      nodes.set(path, { isDir, size, modified, permissions });
    };

    add("/", true, 0, 0o755);
    add("/home", true, 0, 0o755);
    add(home, true, 0, 0o755);
    for (const name of ["Desktop", "Documents", "Downloads", "projects"]) {
      add(mockRemoteJoin(home, name), true, 0, 0o755);
    }
    add(mockRemoteJoin(home, "README.md"), false, 1200, 0o644);
    add(mockRemoteJoin(home, "package.json"), false, 1024, 0o644);
    add(mockRemoteJoin(home, ".bashrc"), false, 220, 0o600);

    const fs: MockSftpSession = { home, nodes };
    mockSftpSessions.set(session.id, fs);
    return fs;
  }

  function ensureMockSftp(sessionId: string): MockSftpSession {
    const session = requireMockSshSession(sessionId);
    return mockSftpSessions.get(sessionId) ?? seedMockSftp(session);
  }

  function requireMockRemotePath(raw: unknown): string {
    const path = typeof raw === "string" ? raw : "";
    if (!path || !path.startsWith("/") || path.includes("\0")) {
      throw sftpError(
        "invalid_input",
        "remote path must be an absolute POSIX path",
      );
    }
    return normalizeMockRemotePath(path);
  }

  function toMockSftpEntry(path: string, node: MockSftpNode): MockSftpEntry {
    return {
      name: mockRemoteBasename(path),
      path,
      isDir: node.isDir,
      isSymlink: false,
      size: node.isDir ? 0 : node.size,
      modified: node.modified,
      permissions: node.permissions,
    };
  }

  function listMockDirectory(
    fs: MockSftpSession,
    path: string,
  ): MockSftpEntry[] {
    const node = fs.nodes.get(path);
    if (!node || !node.isDir) {
      throw sftpError("not_found", `no such directory: ${path}`);
    }

    const entries: MockSftpEntry[] = [];
    for (const [childPath, child] of fs.nodes) {
      if (childPath === "/" || mockRemoteParent(childPath) !== path) {
        continue;
      }
      entries.push(toMockSftpEntry(childPath, child));
    }

    entries.sort((left, right) => {
      if (left.isDir !== right.isDir) {
        return left.isDir ? -1 : 1;
      }
      return left.name.toLowerCase().localeCompare(right.name.toLowerCase());
    });
    return entries;
  }

  function createMockDirectory(fs: MockSftpSession, path: string): void {
    if (path === "/") {
      throw sftpError("already_exists", "file already exists: /");
    }
    const parentPath = mockRemoteParent(path);
    const parent = fs.nodes.get(parentPath);
    if (!parent || !parent.isDir) {
      throw sftpError("not_found", `no such directory: ${parentPath}`);
    }
    if (fs.nodes.has(path)) {
      throw sftpError("already_exists", `file already exists: ${path}`);
    }
    fs.nodes.set(path, {
      isDir: true,
      size: 0,
      modified: Math.floor(Date.now() / 1000),
      permissions: 0o755,
    });
  }

  function renameMockEntry(
    fs: MockSftpSession,
    from: string,
    to: string,
  ): void {
    if (from === "/" || to === "/") {
      throw sftpError("invalid_input", "cannot rename the root directory");
    }
    const node = fs.nodes.get(from);
    if (!node) {
      throw sftpError("not_found", `no such file or directory: ${from}`);
    }
    if (from === to) {
      return;
    }
    if (node.isDir && to.startsWith(`${from}/`)) {
      throw sftpError("invalid_input", "cannot move a directory into itself");
    }
    const parentPath = mockRemoteParent(to);
    const parent = fs.nodes.get(parentPath);
    if (!parent || !parent.isDir) {
      throw sftpError("not_found", `no such directory: ${parentPath}`);
    }
    if (fs.nodes.has(to)) {
      throw sftpError("already_exists", `file already exists: ${to}`);
    }

    const moves: Array<{ from: string; to: string; node: MockSftpNode }> = [];
    for (const [path, entry] of Array.from(fs.nodes.entries())) {
      if (path === from || path.startsWith(`${from}/`)) {
        moves.push({
          from: path,
          to: `${to}${path.slice(from.length)}`,
          node: entry,
        });
      }
    }
    for (const move of moves) {
      fs.nodes.delete(move.from);
    }
    for (const move of moves) {
      fs.nodes.set(move.to, move.node);
    }
  }

  function deleteMockEntry(fs: MockSftpSession, path: string): void {
    if (path === "/") {
      throw sftpError("invalid_input", "cannot delete the root directory");
    }
    const node = fs.nodes.get(path);
    if (!node) {
      throw sftpError("not_found", `no such file or directory: ${path}`);
    }
    if (node.isDir) {
      for (const childPath of fs.nodes.keys()) {
        if (childPath !== path && mockRemoteParent(childPath) === path) {
          throw sftpError("not_empty", `directory not empty: ${path}`);
        }
      }
    }
    fs.nodes.delete(path);
  }

  function chmodMockEntry(
    fs: MockSftpSession,
    path: string,
    mode: number,
  ): void {
    const node = fs.nodes.get(path);
    if (!node) {
      throw sftpError("not_found", `no such file or directory: ${path}`);
    }
    node.permissions = mode & 0o7777;
  }

  function emitTransferProgress(
    transfer: MockTransfer,
    state: MockTransferState,
  ): void {
    emitEvent("transfer://progress", {
      transferId: transfer.id,
      transferred: transfer.transferred,
      total: transfer.total,
      state,
      message: null,
    });
  }

  function clearMockTransferTimers(transfer: MockTransfer): void {
    for (const timer of transfer.timers) {
      window.clearTimeout(timer);
    }
    transfer.timers = [];
  }

  function startMockTransfer(
    sessionId: string,
    total: number,
    onCompleted: (() => void) | null = null,
  ): string {
    const transfer: MockTransfer = {
      id: uuid(),
      sessionId,
      total,
      transferred: 0,
      timers: [],
      onCompleted,
    };
    mockTransfers.set(transfer.id, transfer);

    for (const step of MOCK_TRANSFER_STEPS) {
      const timer = window.setTimeout(() => {
        if (mockTransfers.get(transfer.id) !== transfer) {
          return;
        }
        if (!mockSessions.has(transfer.sessionId)) {
          clearMockTransferTimers(transfer);
          mockTransfers.delete(transfer.id);
          return;
        }

        transfer.transferred =
          step.state === "completed"
            ? transfer.total
            : Math.round(transfer.total * step.fraction);

        if (step.state === "completed") {
          try {
            transfer.onCompleted?.();
          } catch (error) {
            console.error("[teerm] dev mock upload failed", error);
          }
          clearMockTransferTimers(transfer);
          mockTransfers.delete(transfer.id);
        }
        emitTransferProgress(transfer, step.state);
      }, step.delay);
      transfer.timers.push(timer);
    }

    return transfer.id;
  }

  function cancelMockTransfer(transferId: string): void {
    const transfer = mockTransfers.get(transferId);
    if (!transfer) {
      return;
    }
    mockTransfers.delete(transferId);
    clearMockTransferTimers(transfer);
    emitTransferProgress(transfer, "cancelled");
  }

  function clearMockSftpSession(sessionId: string): void {
    for (const transfer of Array.from(mockTransfers.values())) {
      if (transfer.sessionId !== sessionId) {
        continue;
      }
      clearMockTransferTimers(transfer);
      mockTransfers.delete(transfer.id);
    }
    mockSftpSessions.delete(sessionId);
  }

  function clearMockSftpState(): void {
    for (const transfer of Array.from(mockTransfers.values())) {
      clearMockTransferTimers(transfer);
    }
    mockTransfers.clear();
    mockSftpSessions.clear();
  }

  /** Returns true when the command closed the session. */
  function handleMockCommand(
    session: MockSession,
    command: string,
  ): boolean {
    const prompt = shellPrompt(session.host);
    const trimmed = command.trim();

    if (!trimmed) {
      emitSessionData(session.id, prompt);
      return false;
    }

    const [name, ...rest] = trimmed.split(/\s+/);
    const lowered = name.toLowerCase();

    if (lowered === "exit" || lowered === "logout") {
      closeMockSession(session.id, "exit");
      return true;
    }

    if (lowered === "clear") {
      emitSessionData(session.id, `\x1b[2J\x1b[3J\x1b[H${prompt}`);
      return false;
    }

    let output: string;
    switch (lowered) {
      case "help":
        output = [
          "Available mock commands:",
          "  help        show this message",
          "  ls          list files",
          "  pwd         print the working directory",
          "  whoami      print the current user",
          "  uname -a    print system information",
          "  echo <txt>  print text",
          "  clear       clear the screen",
          "  exit        close the session",
        ].join("\r\n");
        break;
      case "ls":
        output = "Desktop  Documents  Downloads  projects  README.md";
        break;
      case "pwd":
        output = `/home/${session.host.username}`;
        break;
      case "whoami":
        output = session.host.username;
        break;
      case "uname":
        output =
          `Linux ${session.host.address} 6.6.0-teerm-mock #1 SMP ` +
          "PREEMPT_DYNAMIC x86_64 GNU/Linux";
        break;
      case "echo":
        output = rest.join(" ");
        break;
      default:
        output = `bash: ${name}: command not found`;
        break;
    }

    emitSessionData(session.id, `${output}\r\n${prompt}`);
    return false;
  }

  function findHost(id: string): Host {
    const host = hosts.find((candidate) => candidate.id === id);
    if (!host) {
      throw { code: "not_found", message: "host" };
    }
    return host;
  }

  function makeHost(input: HostInputShape): Host {
    return {
      id: uuid(),
      label: input.label.trim() || input.address,
      address: input.address.trim(),
      port: input.port,
      username: input.username.trim(),
      group_id: input.group_id,
      tag_ids: input.tag_ids,
      key_id: input.key_id,
      has_password: Boolean(input.password),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  const internals = {
    invoke: async (command: string, args?: Record<string, unknown>) => {
      await new Promise((resolve) => window.setTimeout(resolve, 80));

      switch (command) {
        case "vault_status":
          return { exists, unlocked };
        case "vault_create":
          exists = true;
          unlocked = true;
          return null;
        case "vault_unlock":
          unlocked = true;
          return null;
        case "vault_lock":
          unlocked = false;
          clearMockSftpState();
          return null;
        case "vault_change_password":
          return null;
        case "settings_get":
          return settings;
        case "settings_update":
          settings = args?.settings as Settings;
          return settings;
        case "app_info":
          return appInfo;

        case "hosts_list":
          return [...hosts];

        case "host_create": {
          const host = makeHost(args?.input as HostInputShape);
          hosts = [...hosts, host];
          return host;
        }

        case "host_update": {
          const id = args?.id as string;
          const input = args?.input as HostInputShape;
          const current = findHost(id);
          const updated: Host = {
            ...current,
            label: input.label.trim() || input.address,
            address: input.address.trim(),
            port: input.port,
            username: input.username.trim(),
            group_id: input.group_id,
            tag_ids: input.tag_ids,
            key_id: input.key_id,
            has_password: input.clear_password
              ? false
              : current.has_password || Boolean(input.password),
            updated_at: new Date().toISOString(),
          };
          hosts = hosts.map((host) => (host.id === id ? updated : host));
          return updated;
        }

        case "host_delete": {
          const id = args?.id as string;
          hosts = hosts.filter((host) => host.id !== id);
          forwards = forwards.filter((forward) => forward.host_id !== id);
          return null;
        }

        case "groups_list":
          return [...groups];

        case "group_create": {
          const input = args?.input as { name: string; parent_id: string | null };
          const group: HostGroup = {
            id: uuid(),
            name: input.name.trim(),
            parent_id: input.parent_id,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          groups = [...groups, group];
          return group;
        }

        case "group_update": {
          const id = args?.id as string;
          const input = args?.input as { name: string; parent_id: string | null };
          const current = groups.find((group) => group.id === id);
          if (!current) {
            throw { code: "not_found", message: "host group" };
          }
          const updated: HostGroup = {
            ...current,
            name: input.name.trim(),
            parent_id: input.parent_id,
            updated_at: new Date().toISOString(),
          };
          groups = groups.map((group) => (group.id === id ? updated : group));
          return updated;
        }

        case "group_delete": {
          const id = args?.id as string;
          const target = groups.find((group) => group.id === id);
          const parentId = target?.parent_id ?? null;
          groups = groups
            .filter((group) => group.id !== id)
            .map((group) =>
              group.parent_id === id ? { ...group, parent_id: parentId } : group,
            );
          hosts = hosts.map((host) =>
            host.group_id === id ? { ...host, group_id: parentId } : host,
          );
          return null;
        }

        case "tags_list":
          return withTagCounts(tags);

        case "tag_create": {
          const input = args?.input as { name: string; color: string | null };
          const tag: Tag = {
            id: uuid(),
            name: input.name.trim(),
            color: input.color,
            host_count: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          tags = [...tags, tag];
          return tag;
        }

        case "tag_update": {
          const id = args?.id as string;
          const input = args?.input as { name: string; color: string | null };
          const current = tags.find((tag) => tag.id === id);
          if (!current) {
            throw { code: "not_found", message: "tag" };
          }
          const updated: Tag = {
            ...current,
            name: input.name.trim(),
            color: input.color,
            updated_at: new Date().toISOString(),
          };
          tags = tags.map((tag) => (tag.id === id ? updated : tag));
          return {
            ...updated,
            host_count: hosts.filter((host) => host.tag_ids.includes(id)).length,
          };
        }

        case "tag_delete": {
          const id = args?.id as string;
          tags = tags.filter((tag) => tag.id !== id);
          hosts = hosts.map((host) =>
            host.tag_ids.includes(id)
              ? { ...host, tag_ids: host.tag_ids.filter((tagId) => tagId !== id) }
              : host,
          );
          return null;
        }

        case "keys_list":
          return [...keys];

        case "key_import": {
          const input = args?.input as { name: string; private_key: string };
          if (!input.private_key.trim()) {
            throw { code: "invalid_input", message: "invalid OpenSSH private key" };
          }
          const key: Key = {
            id: uuid(),
            name: input.name.trim(),
            key_type: "ssh-ed25519",
            public_key:
              "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIImportedMockPublicKeyMaterialForPreview teerm",
            fingerprint: `SHA256:${uuid().replace(/-/g, "").slice(0, 43)}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          keys = [...keys, key];
          return key;
        }

        case "key_generate": {
          const input = args?.input as { name: string };
          const key: Key = {
            id: uuid(),
            name: input.name.trim(),
            key_type: "ssh-ed25519",
            public_key:
              "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGeneratedMockPublicKeyMaterialForPreview teerm",
            fingerprint: `SHA256:${uuid().replace(/-/g, "").slice(0, 43)}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          keys = [...keys, key];
          return key;
        }

        case "key_update": {
          const id = args?.id as string;
          const input = args?.input as { name: string };
          const current = keys.find((key) => key.id === id);
          if (!current) {
            throw { code: "not_found", message: "key" };
          }
          const updated: Key = {
            ...current,
            name: input.name.trim(),
            updated_at: new Date().toISOString(),
          };
          keys = keys.map((key) => (key.id === id ? updated : key));
          return updated;
        }

        case "key_delete": {
          const id = args?.id as string;
          const users = hosts.filter((host) => host.key_id === id);
          if (users.length > 0) {
            throw {
              code: "invalid_input",
              message: `this key is used by ${users.length} host(s)`,
            };
          }
          keys = keys.filter((key) => key.id !== id);
          return null;
        }

        case "forwards_list": {
          const hostId = (args?.hostId ?? args?.host_id) as string;
          findHost(hostId);
          return forwards.filter((forward) => forward.host_id === hostId);
        }

        case "forward_create": {
          const input = args?.input as {
            host_id: string;
            kind: ForwardKind;
            bind_address: string;
            bind_port: number;
            target_host: string;
            target_port: number;
            auto_start: boolean;
          };
          const forward: PortForward = {
            id: uuid(),
            ...input,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          forwards = [...forwards, forward];
          return forward;
        }

        case "forward_update": {
          const id = args?.id as string;
          const input = args?.input as {
            host_id: string;
            kind: ForwardKind;
            bind_address: string;
            bind_port: number;
            target_host: string;
            target_port: number;
            auto_start: boolean;
          };
          const current = forwards.find((forward) => forward.id === id);
          if (!current) {
            throw { code: "not_found", message: "port forward" };
          }
          const updated: PortForward = {
            ...current,
            ...input,
            updated_at: new Date().toISOString(),
          };
          forwards = forwards.map((forward) =>
            forward.id === id ? updated : forward,
          );
          return updated;
        }

        case "forward_start":
        case "forward_stop": {
          const sessionId = args?.sessionId as string;
          const forwardId = args?.forwardId as string;
          const running = command === "forward_start";
          mockRunningForwards[sessionId] ??= new Set();
          if (running) {
            mockRunningForwards[sessionId].add(forwardId);
          } else {
            mockRunningForwards[sessionId].delete(forwardId);
          }
          emitEvent("ssh:forward-status", {
            sessionId,
            forwardId,
            state: running ? "running" : "stopped",
            message: null,
          });
          return null;
        }

        case "forwards_status": {
          const sessionId = args?.sessionId as string;
          return [...(mockRunningForwards[sessionId] ?? [])].map(
            (forwardId) => ({
              sessionId,
              forwardId,
              state: "running",
              message: null,
            }),
          );
        }

        case "forward_delete": {
          const id = args?.id as string;
          forwards = forwards.filter((forward) => forward.id !== id);
          return null;
        }

        case "known_hosts_list":
          return [...knownHosts];

        case "known_host_delete": {
          const id = args?.id as string;
          knownHosts = knownHosts.filter((known) => known.id !== id);
          return null;
        }

        case "session_open": {
          const sessionId = args?.sessionId as string;
          const hostId = args?.hostId as string;
          const acceptNewHost = args?.acceptNewHost === true;
          const replaceHostKey = args?.replaceHostKey === true;
          const cols = Number(args?.cols ?? 120);
          const rows = Number(args?.rows ?? 32);

          await new Promise((resolve) => window.setTimeout(resolve, 450));

          const host = findHost(hostId);
          let newHostKey = false;

          if (host.address === STAGING_ADDRESS) {
            const known = findKnownHost(host.address, host.port);
            if (!known) {
              if (!acceptNewHost) {
                throw hostKeyUnknown(host, STAGING_FINGERPRINT);
              }
              newHostKey = true;
            }

            await new Promise<void>((resolve, reject) => {
              pendingAuth.set(sessionId, {
                respond: (responses) => {
                  if (responses === null) {
                    reject(authFailed());
                  } else {
                    resolve();
                  }
                },
                cancel: () => {
                  reject({
                    code: "cancelled",
                    message: "connection cancelled",
                  });
                },
              });
              emitEvent("ssh:auth-prompt", {
                sessionId,
                name: "Two-factor authentication",
                instructions:
                  "Enter the verification code from your authenticator app. " +
                  "Any code is accepted in the Teerm dev mock.",
                prompts: [{ prompt: "Verification code:", echo: false }],
              });
            }).finally(() => {
              pendingAuth.delete(sessionId);
            });
          } else if (host.address === PI_ADDRESS) {
            const known = findKnownHost(host.address, host.port);
            if (known && known.fingerprint !== PI_NEW_FINGERPRINT) {
              if (!replaceHostKey) {
                throw hostKeyChanged(
                  host,
                  PI_NEW_FINGERPRINT,
                  known.fingerprint,
                );
              }
              newHostKey = true;
            } else if (!known) {
              if (!acceptNewHost) {
                throw hostKeyUnknown(host, PI_NEW_FINGERPRINT);
              }
              newHostKey = true;
            }
          }

          // Match the Rust backend: a new/replaced host key is only persisted
          // once authentication and shell setup succeed.
          if (newHostKey) {
            rememberKnownHost(
              host.address,
              host.port,
              fingerprintForHost(host),
            );
          }

          clearMockSftpSession(sessionId);
          return startMockSession(sessionId, host, cols, rows, newHostKey);
        }

        case "session_write": {
          const sessionId = args?.sessionId as string;
          const data = typeof args?.data === "string" ? args.data : "";
          const session = mockSessions.get(sessionId);
          if (!session) {
            return null;
          }

          let text: string;
          try {
            text = decodeBase64(data);
          } catch {
            return null;
          }

          const cleaned = text
            .replace(/\r\n/g, "\r")
            .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
            .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
            .replace(/\x1bO[A-Za-z]/g, "")
            .replace(/\x1b/g, "");

          for (const char of cleaned) {
            if (char === "\r" || char === "\n") {
              emitSessionData(sessionId, "\r\n");
              const command = session.line;
              session.line = "";
              if (handleMockCommand(session, command)) {
                return null;
              }
              continue;
            }

            if (char === "\x7f" || char === "\b") {
              if (session.line.length > 0) {
                const chars = Array.from(session.line);
                chars.pop();
                session.line = chars.join("");
                emitSessionData(sessionId, "\b \b");
              }
              continue;
            }

            if (char === "\x03") {
              session.line = "";
              emitSessionData(
                sessionId,
                `^C\r\n${shellPrompt(session.host)}`,
              );
              continue;
            }

            if (/[\x00-\x1f]/.test(char)) {
              continue;
            }

            session.line += char;
            emitSessionData(sessionId, char);
          }

          return null;
        }

        case "session_resize": {
          const sessionId = args?.sessionId as string;
          const session = mockSessions.get(sessionId);
          if (session) {
            const cols = Number(args?.cols);
            const rows = Number(args?.rows);
            if (Number.isFinite(cols) && cols > 0) {
              session.cols = cols;
            }
            if (Number.isFinite(rows) && rows > 0) {
              session.rows = rows;
            }
          }
          return null;
        }

        case "session_close": {
          const sessionId = args?.sessionId as string;
          clearMockSftpSession(sessionId);
          const pending = pendingAuth.get(sessionId);
          if (pending) {
            pendingAuth.delete(sessionId);
            pending.cancel();
          }
          if (mockSessions.has(sessionId)) {
            closeMockSession(sessionId, "closed");
          } else if (pending) {
            emitEvent("ssh:closed", { sessionId, reason: "closed" });
          }
          return null;
        }

        case "session_auth_respond": {
          const sessionId = args?.sessionId as string;
          const rawResponses = args?.responses;
          const responses = Array.isArray(rawResponses)
            ? rawResponses.map((response) => String(response))
            : null;
          const pending = pendingAuth.get(sessionId);
          if (pending) {
            pendingAuth.delete(sessionId);
            pending.respond(responses);
          }
          return null;
        }

        case "sftp_open": {
          const sessionId = args?.sessionId as string;
          return { path: ensureMockSftp(sessionId).home };
        }

        case "sftp_list": {
          const sessionId = args?.sessionId as string;
          const fs = ensureMockSftp(sessionId);
          const path = requireMockRemotePath(args?.path);
          return listMockDirectory(fs, path);
        }

        case "sftp_mkdir": {
          const sessionId = args?.sessionId as string;
          const fs = ensureMockSftp(sessionId);
          const path = requireMockRemotePath(args?.path);
          createMockDirectory(fs, path);
          return null;
        }

        case "sftp_rename": {
          const sessionId = args?.sessionId as string;
          const fs = ensureMockSftp(sessionId);
          const from = requireMockRemotePath(args?.from);
          const to = requireMockRemotePath(args?.to);
          renameMockEntry(fs, from, to);
          return null;
        }

        case "sftp_delete": {
          const sessionId = args?.sessionId as string;
          const fs = ensureMockSftp(sessionId);
          const path = requireMockRemotePath(args?.path);
          deleteMockEntry(fs, path);
          return null;
        }

        case "sftp_chmod": {
          const sessionId = args?.sessionId as string;
          const fs = ensureMockSftp(sessionId);
          const path = requireMockRemotePath(args?.path);
          const mode = Number(args?.mode);
          if (!Number.isFinite(mode) || mode < 0) {
            throw sftpError("invalid_input", "invalid permissions mode");
          }
          chmodMockEntry(fs, path, mode);
          return null;
        }

        case "sftp_download": {
          const sessionId = args?.sessionId as string;
          const fs = ensureMockSftp(sessionId);
          const remotePath = requireMockRemotePath(args?.remotePath);
          const localPath =
            typeof args?.localPath === "string" ? args.localPath : "";
          if (!localPath.startsWith("/")) {
            throw sftpError("invalid_input", "local path must be absolute");
          }
          const node = fs.nodes.get(remotePath);
          if (!node) {
            throw sftpError("not_found", `no such file: ${remotePath}`);
          }
          if (node.isDir) {
            throw sftpError("invalid_input", "cannot download a directory");
          }
          return startMockTransfer(sessionId, node.size);
        }

        case "sftp_upload": {
          const sessionId = args?.sessionId as string;
          const fs = ensureMockSftp(sessionId);
          const remotePath = requireMockRemotePath(args?.remotePath);
          const localPath =
            typeof args?.localPath === "string" ? args.localPath : "";
          const name = mockLocalBasename(localPath);
          if (!name) {
            throw sftpError("invalid_input", "invalid local path");
          }
          const parentPath = mockRemoteParent(remotePath);
          const parent = fs.nodes.get(parentPath);
          if (!parent || !parent.isDir) {
            throw sftpError("not_found", `no such directory: ${parentPath}`);
          }
          const targetPath = mockRemoteJoin(parentPath, name);
          const current = fs.nodes.get(targetPath);
          if (current?.isDir) {
            throw sftpError(
              "already_exists",
              `directory already exists: ${targetPath}`,
            );
          }

          const uploadSession = sessionId;
          return startMockTransfer(uploadSession, MOCK_UPLOAD_SIZE, () => {
            if (!mockSessions.has(uploadSession)) {
              return;
            }
            if (mockSftpSessions.get(uploadSession) !== fs) {
              return;
            }
            const existing = fs.nodes.get(targetPath);
            if (existing?.isDir) {
              return;
            }
            fs.nodes.set(targetPath, {
              isDir: false,
              size: MOCK_UPLOAD_SIZE,
              modified: Math.floor(Date.now() / 1000),
              permissions: existing?.permissions ?? 0o644,
            });
          });
        }

        case "transfer_cancel": {
          const transferId = args?.transferId as string;
          if (typeof transferId === "string") {
            cancelMockTransfer(transferId);
          }
          return null;
        }

        default:
          throw new Error(`dev mock: unknown command "${command}"`);
      }
    },
  };

  (window as unknown as { __TEERM_DEV_EVENTS__?: DevEventBus }).__TEERM_DEV_EVENTS__ =
    devEventBus;

  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: internals,
    configurable: true,
  });

  console.info(
    `[teerm] dev IPC mock active (?mock=onboarding|locked|unlocked). mode=${mode}`,
  );
}
