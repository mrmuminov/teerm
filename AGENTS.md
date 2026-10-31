# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Teerm is a local-first desktop SSH client: Tauri v2 shell, Rust core (`russh`, `russh-sftp`), React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui (radix-nova) + Zustand frontend, xterm.js terminal.

Read `CONTEXT.md` before naming things: it defines the domain vocabulary (Host, Host Group, Tag, Key, Keychain, Port Forward, Session, Tab, Vault, Master Password, Secret, Known Host, ...) and lists terms to avoid (e.g. say "Host", not "server"/"profile"). `docs/v1-design.md` is the accepted technical design (vault envelope, entities, IPC); `docs/adr/` holds the decisions (Tauri + Rust core; local-first vault, no account in v1).

## Commands

- `npm run tauri dev` — run the full desktop app (starts Vite on fixed port 1420 via `beforeDevCommand`).
- `npm run dev` — Vite only, in a plain browser. In dev mode `src/main.tsx` installs `src/lib/dev-mock.ts`, a browser-only IPC/event mock (modes: onboarding / locked / unlocked), so the UI works without Rust. `isDevMock()` in `src/lib/env.ts` detects it.
- `npm run build` — `tsc` typecheck + `vite build` (the only frontend type check; no ESLint is configured).
- `npm test` — Vitest (node environment) for `src/**/*.test.ts`; `npx vitest run <file>` for a single file. Covers pure `lib/` helpers and stores; there are no component tests.
- `npm run tauri build` — production bundle.
- Rust (run in `src-tauri/`): `cargo test` for all tests, `cargo test <name>` for a single test, `cargo clippy`. Tests are inline `#[cfg(test)]` modules (ssh, sftp, forward, inventory/service, vault/{store,crypto,manager,transfer}); `tempfile` is the dev-dependency for filesystem tests.

## Architecture

**Security boundary:** the Rust core owns every Secret and every socket. The webview must never receive a private key, key passphrase, or stored login password. The frontend only sees DTOs such as `Host.has_password: boolean`; secrets go in via `*Input` types (`password`, `clear_password`) and are never returned.

**Rust (`src-tauri/src`):**
- `lib.rs` registers every Tauri command in `generate_handler!`; adding a command means writing it in `commands.rs` *and* listing it there. `commands.rs` is a thin layer over the modules below.
- `state.rs` `AppState` holds `Mutex<VaultManager>`, `SshManager`, `SftpManager`, `ForwardManager`, `Mutex<Settings>`; constructed in `setup` from the OS app-data dir.
- `vault/` — encrypted-at-rest data set: `crypto.rs` (Argon2id → XChaCha20-Poly1305, header bound as AAD), `store.rs` (atomic temp-write + rename, `.bak` of previous revision), `model.rs` (payload entities), `manager.rs` (lock/unlock state; key material zeroized on lock). `transfer.rs` holds Export/Import (encrypted full export, secret-free metadata export, UUID-based merge with conflict duplication and reference remapping, replace). Entities use UUIDv7, RFC 3339 timestamps and soft deletion (`deleted_at`) so sync can be added later.
- `inventory/` — `service.rs` implements Host/Group/Tag/Key/Port Forward/Known Host CRUD against the unlocked vault; `dto.rs` is the shape exposed to the frontend.
- `ssh/` and `sftp/` — live Session management (PTY, auth prompts, host-key verification) and SFTP operations/transfers. They push data to the UI via Tauri events.
- `forward/` — runtime for Port Forwards on a live Session (`ForwardManager`): local forwards bind a listener and open `direct-tcpip` channels; remote forwards register a target in the Session's `RemoteTargets` (shared with the SSH client handler) and ask the server to listen. Auto-start rules are launched from `session_open`; status goes out as `ssh:forward-status`.
- `settings.rs` — non-secret `settings.json` beside the vault.
- `error.rs` — `AppError` serialized to the frontend as `{ code, message, ... }` (host-key errors also carry `address`, `port`, `key_type`, `fingerprint`, `known_fingerprint`).

**Frontend (`src`):**
- `lib/ipc.ts` is the single typed wrapper around `invoke` and mirrors the Rust DTOs/commands by hand — keep it in sync with `commands.rs` and the DTOs. `lib/events.ts` wraps Tauri event listeners (`ssh` data / closed / auth-prompt, transfer progress) and falls back to the dev-mock event bus.
- Terminal addons (fit, search, web-links via `tauri-plugin-opener`, webgl) are wired in `components/terminal/TerminalPane.tsx`; `Ctrl/Cmd+F` opens `TerminalSearchBar`.
- `stores/` — Zustand stores per concern (`vault`, `inventory`, `sessions`, `sftp`, `settings`, `ui`). `sessions.ts` coordinates Session lifecycle with the other stores; terminal bytes flow through `lib/terminal-bus.ts` rather than React state.
- `components/`: `auth/` (boot/onboarding/unlock/error screens gated on vault status), `layout/` (AppShell, IconRail, Sidebar, TabBar, panes), `hosts/`, `keys/`, `known-hosts/`, `terminal/`, `sftp/`, `ui/` (shadcn-generated primitives). Path alias `@/` → `src/`.
- When adding a backend feature, update the dev mock too, otherwise browser-only `npm run dev` breaks.

The UI is dark-only (`main.tsx` forces the `dark` class).
