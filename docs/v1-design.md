# Teerm v1 — Technical Design

Status: accepted (2026-10-29). Implementation in progress; Q25–Q30 are resolved in §7.

Scope: desktop SSH client, local-first Vault, SSH2 only, tabs, SFTP, Host Groups/Tags, Keys, local and remote Port Forwards.

## 1. Architecture

- **Shell:** Tauri v2.
- **Core:** Rust (Tokio) — Vault crypto, SSH, SFTP, forwarding, settings.
- **UI:** React + TypeScript + Vite + Tailwind + shadcn/ui + Zustand.
- **Terminal:** `@xterm/xterm` with fit, search, web-links, and webgl addons.
- **SSH:** `russh` 0.65, `russh-sftp` 3.0.1.

The Rust core owns every Secret and every socket. The webview never receives a private key, a passphrase, or a stored login password.

**Engine validation:** `russh` 0.65 exposes `channel_open_direct_tcpip` (local forward), `tcpip_forward` / `cancel_tcpip_forward` (remote forward), and `Handler::server_channel_open_forwarded_tcpip` (incoming remote-forward connections). Keyboard-interactive auth and host-key verification via `check_server_key` are present. No patch or sidecar is required for the v1 protocol set.

## 2. Vault

### 2.1 File

- Location: OS app-data directory via Tauri path API.
  - Linux: `~/.local/share/com.teerm.app/vault.teermvault`
  - macOS: `~/Library/Application Support/com.teerm.app/vault.teermvault`
  - Windows: `%APPDATA%\com.teerm.app\vault.teermvault`
- Settings: separate `settings.json` in the same directory (no Secrets).
- Save: write temp file, `fsync`, atomic rename; keep the previous revision as `vault.teermvault.bak`.
- Extension: `.teermvault`.

### 2.2 Envelope

```json
{
  "format": "teerm-vault",
  "version": 1,
  "kdf": {
    "algorithm": "argon2id",
    "memory_kib": 65536,
    "iterations": 3,
    "parallelism": 1,
    "salt": "<base64, 16 bytes>"
  },
  "cipher": {
    "algorithm": "xchacha20poly1305",
    "nonce": "<base64, 24 bytes>"
  },
  "payload": "<base64 ciphertext>"
}
```

- Key: Argon2id(password, salt) → 32 bytes.
- AEAD: XChaCha20-Poly1305; AAD binds the canonical header (`format`, `version`, `kdf`, `cipher`).
- Plaintext: UTF-8 JSON payload.
- Key material and decrypted payload are zeroized on lock.
- Master Password change: decrypt, new salt + nonce, re-encrypt.

### 2.3 Payload

```json
{
  "schema_version": 1,
  "vault_id": "0190...",
  "revision": 42,
  "created_at": "2026-10-28T10:00:00Z",
  "updated_at": "2026-10-28T10:00:00Z",
  "hosts": [],
  "groups": [],
  "tags": [],
  "keys": [],
  "port_forwards": [],
  "known_hosts": []
}
```

`revision` increments on every mutation. All entities use UUIDv7, RFC 3339 UTC timestamps, and soft deletion (`deleted_at`) so a future sync service can propagate deletions.

### 2.4 Entities

**Host**

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `label` | string | defaults to address |
| `address` | string | hostname or IP |
| `port` | u16 | default 22 |
| `username` | string | |
| `group_id` | UUID? | at most one Group |
| `tag_ids` | UUID[] | many-to-many |
| `key_id` | UUID? | Keychain reference |
| `password` | string? | Secret |
| `jump_host_id` | UUID? | reserved, no UI in v1 |
| `created_at`, `updated_at`, `deleted_at` | RFC3339? | |

Auth order: Key → password → keyboard-interactive prompt.

**Host Group**

`id`, `name`, `parent_id?`, timestamps, `deleted_at`. Nestable, single parent, no cycles, unique name among siblings.

**Tag**

`id`, `name`, `color?`, timestamps, `deleted_at`. Unique name (case-insensitive).

**Key**

`id`, `name`, `key_type`, `public_key`, `private_key` (Secret), `passphrase?` (Secret), `fingerprint`, timestamps, `deleted_at`.

Supported import: OpenSSH ed25519, RSA, ECDSA. Private material is write-only across IPC.

**Port Forward**

`id`, `host_id`, `kind` (`local` | `remote`), `bind_address`, `bind_port`, `target_host`, `target_port`, `auto_start`, timestamps, `deleted_at`.

- Local: listener on the client, target resolved by the server.
- Remote: listener on the server, target resolved by the client.
- One active instance per rule per app; bind errors surface as a non-fatal session warning.

**Known Host**

`id`, `address`, `port`, `key_type`, `public_key`, `fingerprint`, `added_at`, `deleted_at`. Unique `(address, port, key_type)` among live rows.

### 2.5 Vault rules

- Delete Host → cascade its Port Forwards, remove Tag references.
- Delete Group → child Groups and Hosts move to its parent (or root), after confirmation.
- Delete Key referenced by any Host → blocked; show referencing Hosts.
- Delete Tag → removed from all Hosts.
- All deletes are soft.
- `settings.json`: `app_theme`, `language`, `auto_lock_minutes`, `download_dir`, `strict_host_key_checking`, terminal font/size/scrollback/cursor, `sftp_show_hidden`.

### 2.6 Locking

- Auto-lock after 15 minutes without user activity (configurable: 5, 15, 30, or 60 minutes).
- Lock on app close; manual lock (`Ctrl/Cmd+L`).
- The frontend owns the inactivity timer, reset by pointer, keyboard, and scroll activity; it calls `vault_lock` when idle. Future terminal input also counts.
- On lock: zeroize keys, close all Sessions, cancel transfers, clear UI state, show unlock screen.
- No recovery key. Setup warns that a forgotten Master Password means the Vault is unrecoverable; Export is the backup path.

### 2.7 Export / Import

- **Full Export:** same envelope, user-supplied passphrase, includes all Secrets.
- **Metadata-only Export:** plain JSON, no Secrets; includes public key material marked `public_only: true`; Hosts keep `key_id` references.
- **Import preview:** counts per entity, conflicts, whether Secrets are included.
- **Merge (default):** match by UUID; identical rows skip; conflicting rows are kept both (incoming gets a new UUID and `" (imported)"` label suffix), references remapped.
- **Replace:** only for full exports; automatically backs up the current Vault first.
- Metadata-only Export can only be merged, never used to replace.

## 3. IPC

Per-session terminal data uses a Tauri `Channel<SessionEvent>` (base64-encoded binary chunks). SFTP and forwarding data stay in Rust; only progress/status crosses IPC.

### 3.1 Vault

| Command | Arguments | Returns |
|---|---|---|
| `vault_status` | — | `{ exists, unlocked }` |
| `vault_create` | `{ password }` | `{ }` |
| `vault_unlock` | `{ password }` | `{ }` |
| `vault_lock` | — | `{ }` |
| `vault_change_password` | `{ current, new }` | `{ }` |
| `vault_export` | `{ path, mode, passphrase? }` | `{ }` |
| `vault_import_preview` | `{ path, passphrase? }` | `ImportPreview` |
| `vault_import_apply` | `{ path, passphrase?, mode }` | `ImportResult` |

### 3.2 Inventory

| Command | Arguments |
|---|---|
| `hosts_list` / `host_get` / `host_create` / `host_update` / `host_delete` | Host input; `host_get` returns `has_password`, never the password |
| `groups_list` / `group_create` / `group_update` / `group_delete` | Group input |
| `tags_list` / `tag_create` / `tag_update` / `tag_delete` | Tag input |
| `keys_list` / `key_import` / `key_generate` / `key_update` / `key_delete` | `keys_list` and `key_get` return public material only |
| `forwards_list` / `forward_create` / `forward_update` / `forward_delete` | by `host_id` |
| `known_hosts_list` / `known_host_delete` | — |

Password edit semantics: omitted field = keep existing; explicit `clear_password` = remove. Same for Key passphrases.

### 3.3 Session

| Command | Arguments | Returns |
|---|---|---|
| `session_latency` | `{ session_id }` → round-trip time in ms (SSH ping, 5 s timeout); the status bar polls it every 5 s for the active Session |
| `session_open` | `{ host_id, cols, rows, channel }` | `{ session_id }` |
| `session_write` | `{ session_id, data }` | — |
| `session_resize` | `{ session_id, cols, rows }` | — |
| `session_close` | `{ session_id }` | — |
| `hostkey_respond` | `{ prompt_id, decision }` | — |

`SessionEvent`: `connecting`, `hostkey_prompt { prompt_id, address, port, key_type, fingerprint, changed, old_fingerprint? }`, `connected`, `data`, `closed`, `error`, `forward_status`.

Host-key policy:

- Unknown → prompt; accept stores a Known Host.
- Match → connect.
- Changed → block; explicit “replace Known Host” required.
- `strict_host_key_checking` on → unknown hosts are rejected without a prompt.

`session_open` returns immediately; the connection task reports progress through the channel.

### 3.4 SFTP

| Command | Arguments |
|---|---|
| `sftp_open` | `{ session_id }` → home directory |
| `sftp_list` | `{ session_id, path }` → entries |
| `sftp_mkdir` | `{ session_id, path }` |
| `sftp_rename` | `{ session_id, from, to }` |
| `sftp_delete` | `{ session_id, path, is_dir }` |
| `sftp_chmod` | `{ session_id, path, mode }` |
| `sftp_download` / `sftp_upload` | `{ session_id, local_path, remote_path }` → `transfer_id` |
| `transfer_cancel` | `{ transfer_id }` |

Event `transfer://progress { transfer_id, transferred, total, state, message }`;
`state` is `running`, `completed`, `cancelled`, or `failed`. The webview
serializes event fields as camelCase.

### 3.5 Forwarding

| Command | Arguments |
|---|---|
| `forward_start` / `forward_stop` | `{ session_id, forward_id }` |
| `forwards_status` | `{ session_id }` |

Auto-start rules run in `session_open` once the Session is connected; a rule that cannot start (for example, its local port is taken) does not fail the Session and is reported through the status event.

Status event `ssh:forward-status { sessionId, forwardId, state, message }`; `state` is `running`, `stopped`, or `failed`. Closing a Session stops its forwards. A Remote Forward registers its local target on the Session so that connections the server opens (`server_channel_open_forwarded_tcpip`) can be routed to it; the server's reported bind address is matched exactly first, then by port.

### 3.6 Settings

`settings_get` / `settings_update`. The frontend merges partial patches locally and sends the full `Settings` object; the backend validates and persists it.

## 4. UI

### 4.1 Main window

```
┌────┬──────────────────────────┬──────────────────────────────────────────────────────┐
│    │ Search hosts…            │ ● prod-db ×   ● staging ×   +                        │
│ 🖥  ├──────────────────────────┼──────────────────────────────────────────────────────┤
│ 🔑 │ ▾ Production             │                                                      │
│ 🛡  │   ● prod-db              │  $ ssh deploy@prod-db                                │
│ ⚙  │   ● prod-api             │  deploy@prod-db:~$                                   │
│    │ ▸ Staging                │                                                      │
│    │                          │                                                      │
│    │ Tags                     │                                                      │
│    │ #database #web           │                                                      │
│    │                          │                                                      │
│    │ + New Host               ├──────────────────────────────────────────────────────┤
│    │                          │ Connected · ssh-ed25519 · 24 ms            [SFTP]    │
└────┴──────────────────────────┴──────────────────────────────────────────────────────┘
```

- 48 px icon rail: Hosts, Keychain, Known Hosts, Settings.
- 264 px contextual panel; hidden for Settings.
- Tab bar with connection-state dot and close button.
- Terminal fills the main area.
- Status bar: state, host key type, latency, active forwards, transfers.

**SFTP panel** (right, 360 px, resizable 280–600 px, per Tab):

```
┌──────────────────────────────────────┐
│ /var/www/apps          ⟳  ↑  +      │
├──────────────────────────────────────┤
│ Name            Size     Modified    │
│ ..                                    │
│ src/            —        today 10:12 │
│ package.json    1.2 KB   today 09:44 │
├──────────────────────────────────────┤
│ ⇣ 2 transfers · 45%        [Cancel]  │
└──────────────────────────────────────┘
```

Remote pane only; OS drag-and-drop uploads. First download asks for a folder and stores it in `download_dir`.

### 4.2 Host editor

Right-side `Sheet` with tabs: General, Authentication, Port Forwarding.

- General: Label, Address, Port, Username, Group, Tags.
- Authentication: Key select, Password (write-only), “Prompt at connect”.
- Port Forwarding: list + add local/remote rules.

### 4.3 Other views

- **Keychain:** list (name, type, fingerprint), import, generate ed25519, public-key copy, delete.
- **Known Hosts:** address, key type, fingerprint, added date, delete.
- **Settings:** General (theme, language, auto-lock, download folder), Terminal (font, size, scrollback, cursor), Vault (change Master Password, Export, Import), About.
- **Unlock screen:** Master Password, Unlock, Import a vault.
- **First run:** create Master Password + confirmation + strength meter + unrecoverable warning.

### 4.4 Shortcuts

`Ctrl/Cmd+K` search hosts · `Ctrl/Cmd+T` new tab · `Ctrl/Cmd+W` close tab · `Ctrl/Cmd+Shift+S` toggle SFTP · `Ctrl/Cmd+F` terminal search · `Ctrl/Cmd+L` lock Vault · `Ctrl/Cmd+,` settings · `Ctrl/Cmd+±` font size.

### 4.5 Security boundaries

- Private keys and stored passwords never cross IPC to the webview.
- `host_get` exposes `has_password`, not the password.
- Strict CSP; external links open in the system browser.
- Logs redact Secrets and payload contents.
- Tauri capabilities restrict commands to the main window.

## 5. Out of scope for v1

Split panes, Snippets, Mosh/Telnet/Serial, mobile, accounts/sync, AI, Jump Host UI (field reserved), dynamic SOCKS forwarding, SSH agent forwarding, PuTTY `.ppk` import, remote file editing, dual-pane SFTP, auto-reconnect, tab restore, auto-update, Termius import.

## 6. Build order

1. ✅ Scaffold Tauri v2 + React + TS + Vite + Tailwind + shadcn/ui; Rust module skeleton.
2. ✅ Vault crypto, create/unlock/lock, settings, idle auto-lock, app shell (icon rail, sidebar, tabs, settings).
3. ✅ Inventory schema + CRUD commands + sidebar + editor sheets.
4. ✅ SSH sessions, host-key TOFU, xterm.js tabs, resize, reconnect.
5. ✅ SFTP browser and transfer queue.
6. ✅ Local and remote Port Forwards with status.
7. ✅ Export/import (merge + replace) from Settings. Restoring onto a new device uses `vault_create_from_export` from the onboarding screen ("Restore from an export"); the export is opened before the Vault is created.
8. Polish: themes, tests, packaging. Shortcuts from §4.4 are in (`AppShell.tsx`, terminal key handler).

## 7. Resolved decisions

- **Q25 Vault format:** single encrypted JSON envelope, Argon2id (64 MiB, 3 iterations) + XChaCha20-Poly1305.
- **Q26 Lock behavior:** locking closes all Sessions.
- **Q27 Key generation:** ed25519 generation plus OpenSSH import (ed25519, RSA, ECDSA).
- **Q28 SFTP placement:** right-side collapsible panel, remote pane only.
- **Q29 Sidebar:** 48 px icon rail plus a contextual sidebar.
- **Q30 Host editor:** right-side Sheet.

## 8. Development

- `npm run tauri dev` — run the desktop app with the real Rust backend.
- `npm run dev` — run the UI in a browser with the dev IPC mock: `?mock=onboarding`, `?mock=locked`, or `?mock=unlocked` (default).
- `npm run build` — type-check and build the frontend.
- `cd src-tauri && cargo test` — vault crypto and store tests.

The dev mock installs only when `__TAURI_INTERNALS__` is absent and is compiled out of production builds.
