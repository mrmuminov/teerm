# Teerm

Teerm is a local-first desktop SSH client. This document is the project's shared language: the terms for saved inventory, live connections, and local storage.

## Language

### Inventory

**Host**:
A saved connection profile for one SSH server: address, port, and username. A Host is stored data, not a live connection.
_Avoid_: Server, machine, connection, profile

**Jump Host**:
A Host that Teerm connects through before reaching another Host.
_Avoid_: Bastion, proxy, gateway

**Host Group**:
A named, nestable container for Hosts. A Host belongs to at most one Host Group.
_Avoid_: Folder, workspace, project

**Tag**:
A label attached to any number of Hosts; a Host may carry any number of Tags.
_Avoid_: Label, category

**Key**:
An SSH key pair used to authenticate to a Host; its private half is secret.
_Avoid_: Identity, credential, certificate

**Keychain**:
The user's collection of Keys.
_Avoid_: Key store, key vault

**Port Forward**:
A saved rule owned by a Host that tunnels TCP traffic through a Session between a local and a remote endpoint.
_Avoid_: Tunnel, proxy, forwarding rule

**Local Forward**:
A Port Forward that makes a remote endpoint reachable on the local machine.
_Avoid_: Local tunnel, -L tunnel

**Remote Forward**:
A Port Forward that makes a local endpoint reachable on the remote machine.
_Avoid_: Reverse tunnel, -R tunnel

### Runtime

**Session**:
A live, authenticated SSH connection created from exactly one Host.
_Avoid_: Connection, terminal, instance

**Tab**:
A workspace in the main window dedicated to exactly one Session, or the pinned Welcome Tab.
_Avoid_: Window, pane, workspace

**Welcome Tab**:
The pinned, non-Session Tab shown in the main window. It holds first-run actions and stays available when Sessions are open.
_Avoid_: Home, start page, dashboard

**Terminal**:
The emulated character display inside a Tab where the remote shell runs.
_Avoid_: Console, shell, tty

**SFTP Browser**:
The file manager view for a Session that lists and transfers remote files.
_Avoid_: File manager, explorer

### Security

**Master Password**:
The single passphrase the user enters to unlock the Vault.
_Avoid_: Vault password, encryption key, login password

**Recovery Phrase**:
An optional 24-word BIP39 phrase that can open the Vault and reset the Master Password. It is shown once and never stored.
_Avoid_: Seed phrase, recovery key, backup code

**Secret**:
A sensitive value stored in the Vault, such as a login password or a Key passphrase.
_Avoid_: Credential, token

**Known Host**:
A remote SSH server identity whose host key fingerprint the user has approved and Teerm remembers.
_Avoid_: Trusted host, fingerprint record

**Locked Vault**:
A Vault whose contents cannot be read until the Master Password is entered.
_Avoid_: Closed vault, locked account

**Unlocked Vault**:
A Vault whose contents are available during the current app session.
_Avoid_: Open vault

### Storage

**Vault**:
The user's complete local Teerm data set, encrypted at rest and unlocked with the Master Password; the unit of export and import.
_Avoid_: Database, account, storage

**Export**:
A portable file containing a snapshot of a Vault, optionally including Secrets protected by a passphrase.
_Avoid_: Backup, dump

**Import**:
The act of loading an Export into a Vault, either by merging with it or by replacing it.
_Avoid_: Restore, upload
