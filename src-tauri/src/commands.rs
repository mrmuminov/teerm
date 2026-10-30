use std::path::PathBuf;

use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::error::AppError;
use crate::forward::ForwardStatus;
use crate::inventory::{
    self, ForwardInput, ForwardView, GroupInput, GroupView, HostInput, HostView, KeyGenerateInput,
    KeyImportInput, KeyRenameInput, KeyView, KnownHostView, TagInput, TagView,
};
use crate::settings::Settings;
use crate::sftp::{SftpEntry, SftpOpenResult};
use crate::ssh::{self, ConnectProfile, KnownKeySnapshot, OpenedSession};
use crate::state::AppState;
use crate::vault::manager::VaultStatus;
use crate::vault::model::PortForward;

fn vault_lock_error() -> AppError {
    AppError::Internal("vault state is unavailable".into())
}

fn settings_lock_error() -> AppError {
    AppError::Internal("settings state is unavailable".into())
}

#[tauri::command]
pub fn vault_status(state: State<'_, AppState>) -> Result<VaultStatus, AppError> {
    let vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    Ok(vault.status())
}

#[tauri::command]
pub fn vault_create(state: State<'_, AppState>, password: String) -> Result<(), AppError> {
    let mut vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    vault.create(&password)
}

#[tauri::command]
pub fn vault_unlock(state: State<'_, AppState>, password: String) -> Result<(), AppError> {
    let mut vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    vault.unlock(&password)
}

#[tauri::command]
pub async fn vault_lock(state: State<'_, AppState>) -> Result<(), AppError> {
    state.sftp.close_all().await;
    state.ssh.close_all().await;

    let mut vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    vault.lock();
    Ok(())
}

#[tauri::command]
pub fn vault_change_password(
    state: State<'_, AppState>,
    current: String,
    new: String,
) -> Result<(), AppError> {
    let mut vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    vault.change_password(&current, &new)
}

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> Result<Settings, AppError> {
    let settings = state.settings.lock().map_err(|_| settings_lock_error())?;
    Ok(settings.clone())
}

#[tauri::command]
pub fn settings_update(
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<Settings, AppError> {
    settings.validate()?;

    {
        let mut stored = state.settings.lock().map_err(|_| settings_lock_error())?;
        *stored = settings.clone();
    }

    settings.save(&state.settings_path)?;
    Ok(settings)
}

#[derive(Debug, Serialize)]
pub struct AppInfo {
    pub name: &'static str,
    pub version: &'static str,
    pub os: &'static str,
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "Teerm",
        version: env!("CARGO_PKG_VERSION"),
        os: std::env::consts::OS,
    }
}


#[tauri::command]
pub async fn session_open(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    session_id: Uuid,
    host_id: Uuid,
    password: Option<String>,
    accept_new_host: bool,
    replace_host_key: bool,
    cols: u32,
    rows: u32,
) -> Result<OpenedSession, AppError> {
    let (profile, address, port) = {
        let vault = state.vault.lock().map_err(|_| vault_lock_error())?;
        let payload = vault.payload()?;
        let host = payload
            .hosts
            .iter()
            .find(|host| host.id == host_id && host.deleted_at.is_none())
            .ok_or_else(|| AppError::NotFound("host".into()))?;

        let key = host
            .key_id
            .and_then(|id| {
                payload
                    .keys
                    .iter()
                    .find(|key| key.id == id && key.deleted_at.is_none())
            });

        let password = password
            .filter(|value| !value.is_empty())
            .or_else(|| host.password.clone());

        if key.is_none() && password.is_none() {
            return Err(AppError::PasswordRequired);
        }

        let known_hosts = payload
            .known_hosts
            .iter()
            .filter(|known| {
                known.deleted_at.is_none()
                    && known.address == host.address
                    && known.port == host.port
            })
            .map(|known| KnownKeySnapshot {
                key_type: known.key_type.clone(),
                fingerprint: known.fingerprint.clone(),
            })
            .collect();

        let private_key = key
            .map(|key| zeroize::Zeroizing::new(key.private_key.clone()));
        let passphrase = key
            .and_then(|key| key.passphrase.clone())
            .map(zeroize::Zeroizing::new);

        let profile = ConnectProfile {
            address: host.address.clone(),
            port: host.port,
            username: host.username.clone(),
            password: password.map(zeroize::Zeroizing::new),
            private_key,
            passphrase,
            known_hosts,
            accept_new_host,
            replace_host_key,
            cols,
            rows,
        };

        (profile, host.address.clone(), host.port)
    };

    let opened = state.ssh.open(app.clone(), session_id, profile).await?;

    if opened.new_host_key {
        let result = {
            let mut vault = state.vault.lock().map_err(|_| vault_lock_error())?;
            vault.mutate(|payload| {
                inventory::upsert_known_host(
                    payload,
                    &address,
                    port,
                    &opened.key_type,
                    &opened.public_key,
                    &opened.fingerprint,
                );
                Ok(())
            })
        };

        if let Err(error) = result {
            state.ssh.close(opened.session_id).await;
            return Err(error);
        }
    }

    start_auto_forwards(&app, &state, opened.session_id, host_id).await;

    Ok(opened)
}

/// Starts the Host's auto-start Port Forwards. A rule that cannot start (for
/// example, its local port is taken) must not fail the Session, so errors are
/// reported through the forward status event instead.
async fn start_auto_forwards(
    app: &tauri::AppHandle,
    state: &AppState,
    session_id: Uuid,
    host_id: Uuid,
) {
    let forwards: Vec<PortForward> = match state.vault.lock() {
        Ok(vault) => vault
            .payload()
            .map(|payload| {
                payload
                    .port_forwards
                    .iter()
                    .filter(|forward| {
                        forward.host_id == host_id
                            && forward.auto_start
                            && forward.deleted_at.is_none()
                    })
                    .cloned()
                    .collect()
            })
            .unwrap_or_default(),
        Err(_) => return,
    };

    for forward in forwards {
        if let Err(error) = state
            .forwards
            .start(app, &state.ssh, session_id, &forward)
            .await
        {
            state
                .forwards
                .report_failure(app, session_id, forward.id, error.to_string());
        }
    }
}

#[tauri::command]
pub async fn session_write(
    state: State<'_, AppState>,
    session_id: Uuid,
    data: String,
) -> Result<(), AppError> {
    let bytes = ssh::decode_input(&data)?;
    state.ssh.write(session_id, bytes).await
}

#[tauri::command]
pub async fn session_resize(
    state: State<'_, AppState>,
    session_id: Uuid,
    cols: u32,
    rows: u32,
) -> Result<(), AppError> {
    state.ssh.resize(session_id, cols, rows).await
}

#[tauri::command]
pub async fn session_close(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    session_id: Uuid,
) -> Result<(), AppError> {
    state.forwards.stop_session(&app, session_id).await;
    state.sftp.close_session(session_id).await;
    state.ssh.close(session_id).await;
    Ok(())
}

#[tauri::command]
pub async fn session_auth_respond(
    state: State<'_, AppState>,
    session_id: Uuid,
    responses: Option<Vec<String>>,
) -> Result<(), AppError> {
    state.ssh.respond_auth(session_id, responses).await
}

#[tauri::command]
pub async fn sftp_open(
    state: State<'_, AppState>,
    session_id: Uuid,
) -> Result<SftpOpenResult, AppError> {
    state.sftp.open(&state.ssh, session_id).await
}

#[tauri::command]
pub async fn sftp_list(
    state: State<'_, AppState>,
    session_id: Uuid,
    path: String,
) -> Result<Vec<SftpEntry>, AppError> {
    state.sftp.list(&state.ssh, session_id, &path).await
}

#[tauri::command]
pub async fn sftp_mkdir(
    state: State<'_, AppState>,
    session_id: Uuid,
    path: String,
) -> Result<(), AppError> {
    state.sftp.mkdir(&state.ssh, session_id, &path).await
}

#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, AppState>,
    session_id: Uuid,
    from: String,
    to: String,
) -> Result<(), AppError> {
    state.sftp.rename(&state.ssh, session_id, &from, &to).await
}

#[tauri::command]
pub async fn sftp_delete(
    state: State<'_, AppState>,
    session_id: Uuid,
    path: String,
    is_dir: bool,
) -> Result<(), AppError> {
    state.sftp.delete(&state.ssh, session_id, &path, is_dir).await
}

#[tauri::command]
pub async fn sftp_chmod(
    state: State<'_, AppState>,
    session_id: Uuid,
    path: String,
    mode: u32,
) -> Result<(), AppError> {
    state.sftp.chmod(&state.ssh, session_id, &path, mode).await
}

#[tauri::command]
pub async fn sftp_download(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    session_id: Uuid,
    remote_path: String,
    local_path: String,
) -> Result<Uuid, AppError> {
    state
        .sftp
        .start_download(
            app,
            &state.ssh,
            session_id,
            remote_path,
            PathBuf::from(local_path),
        )
        .await
}

#[tauri::command]
pub async fn sftp_upload(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    session_id: Uuid,
    local_path: String,
    remote_path: String,
) -> Result<Uuid, AppError> {
    state
        .sftp
        .start_upload(
            app,
            &state.ssh,
            session_id,
            PathBuf::from(local_path),
            remote_path,
        )
        .await
}

#[tauri::command]
pub async fn transfer_cancel(
    state: State<'_, AppState>,
    transfer_id: Uuid,
) -> Result<(), AppError> {
    state.sftp.cancel_transfer(transfer_id).await
}

#[tauri::command]
pub fn hosts_list(state: State<'_, AppState>) -> Result<Vec<HostView>, AppError> {
    let vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    Ok(inventory::list_hosts(vault.payload()?))
}

#[tauri::command]
pub fn host_create(
    state: State<'_, AppState>,
    input: HostInput,
) -> Result<HostView, AppError> {
    let mut vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    vault.mutate(|payload| inventory::create_host(payload, input))
}

#[tauri::command]
pub fn host_update(
    state: State<'_, AppState>,
    id: Uuid,
    input: HostInput,
) -> Result<HostView, AppError> {
    let mut vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    vault.mutate(|payload| inventory::update_host(payload, id, input))
}

#[tauri::command]
pub fn host_delete(state: State<'_, AppState>, id: Uuid) -> Result<(), AppError> {
    let mut vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    vault.mutate(|payload| inventory::delete_host(payload, id))
}

#[tauri::command]
pub fn groups_list(state: State<'_, AppState>) -> Result<Vec<GroupView>, AppError> {
    let vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    Ok(inventory::list_groups(vault.payload()?))
}

#[tauri::command]
pub fn group_create(
    state: State<'_, AppState>,
    input: GroupInput,
) -> Result<GroupView, AppError> {
    let mut vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    vault.mutate(|payload| inventory::create_group(payload, input))
}

#[tauri::command]
pub fn group_update(
    state: State<'_, AppState>,
    id: Uuid,
    input: GroupInput,
) -> Result<GroupView, AppError> {
    let mut vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    vault.mutate(|payload| inventory::update_group(payload, id, input))
}

#[tauri::command]
pub fn group_delete(state: State<'_, AppState>, id: Uuid) -> Result<(), AppError> {
    let mut vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    vault.mutate(|payload| inventory::delete_group(payload, id))
}

#[tauri::command]
pub fn tags_list(state: State<'_, AppState>) -> Result<Vec<TagView>, AppError> {
    let vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    Ok(inventory::list_tags(vault.payload()?))
}

#[tauri::command]
pub fn tag_create(state: State<'_, AppState>, input: TagInput) -> Result<TagView, AppError> {
    let mut vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    vault.mutate(|payload| inventory::create_tag(payload, input))
}

#[tauri::command]
pub fn tag_update(
    state: State<'_, AppState>,
    id: Uuid,
    input: TagInput,
) -> Result<TagView, AppError> {
    let mut vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    vault.mutate(|payload| inventory::update_tag(payload, id, input))
}

#[tauri::command]
pub fn tag_delete(state: State<'_, AppState>, id: Uuid) -> Result<(), AppError> {
    let mut vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    vault.mutate(|payload| inventory::delete_tag(payload, id))
}

#[tauri::command]
pub fn keys_list(state: State<'_, AppState>) -> Result<Vec<KeyView>, AppError> {
    let vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    Ok(inventory::list_keys(vault.payload()?))
}

#[tauri::command]
pub fn key_import(
    state: State<'_, AppState>,
    input: KeyImportInput,
) -> Result<KeyView, AppError> {
    let mut vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    vault.mutate(|payload| inventory::import_key(payload, input))
}

#[tauri::command]
pub fn key_generate(
    state: State<'_, AppState>,
    input: KeyGenerateInput,
) -> Result<KeyView, AppError> {
    let mut vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    vault.mutate(|payload| inventory::generate_key(payload, input))
}

#[tauri::command]
pub fn key_update(
    state: State<'_, AppState>,
    id: Uuid,
    input: KeyRenameInput,
) -> Result<KeyView, AppError> {
    let mut vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    vault.mutate(|payload| inventory::rename_key(payload, id, input))
}

#[tauri::command]
pub fn key_delete(state: State<'_, AppState>, id: Uuid) -> Result<(), AppError> {
    let mut vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    vault.mutate(|payload| inventory::delete_key(payload, id))
}

#[tauri::command]
pub fn forwards_list(
    state: State<'_, AppState>,
    host_id: Uuid,
) -> Result<Vec<ForwardView>, AppError> {
    let vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    inventory::list_forwards(vault.payload()?, host_id)
}

#[tauri::command]
pub fn forward_create(
    state: State<'_, AppState>,
    input: ForwardInput,
) -> Result<ForwardView, AppError> {
    let mut vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    vault.mutate(|payload| inventory::create_forward(payload, input))
}

#[tauri::command]
pub fn forward_update(
    state: State<'_, AppState>,
    id: Uuid,
    input: ForwardInput,
) -> Result<ForwardView, AppError> {
    let mut vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    vault.mutate(|payload| inventory::update_forward(payload, id, input))
}

#[tauri::command]
pub async fn forward_start(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    session_id: Uuid,
    forward_id: Uuid,
) -> Result<(), AppError> {
    let forward = {
        let vault = state.vault.lock().map_err(|_| vault_lock_error())?;
        vault
            .payload()?
            .port_forwards
            .iter()
            .find(|forward| forward.id == forward_id && forward.deleted_at.is_none())
            .cloned()
            .ok_or_else(|| AppError::NotFound("port forward".into()))?
    };

    state
        .forwards
        .start(&app, &state.ssh, session_id, &forward)
        .await
}

#[tauri::command]
pub async fn forward_stop(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    session_id: Uuid,
    forward_id: Uuid,
) -> Result<(), AppError> {
    state
        .forwards
        .stop(&app, &state.ssh, session_id, forward_id)
        .await
}

#[tauri::command]
pub async fn forwards_status(
    state: State<'_, AppState>,
    session_id: Uuid,
) -> Result<Vec<ForwardStatus>, AppError> {
    Ok(state.forwards.status(session_id).await)
}

#[tauri::command]
pub fn forward_delete(state: State<'_, AppState>, id: Uuid) -> Result<(), AppError> {
    let mut vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    vault.mutate(|payload| inventory::delete_forward(payload, id))
}

#[tauri::command]
pub fn known_hosts_list(state: State<'_, AppState>) -> Result<Vec<KnownHostView>, AppError> {
    let vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    Ok(inventory::list_known_hosts(vault.payload()?))
}

#[tauri::command]
pub fn known_host_delete(state: State<'_, AppState>, id: Uuid) -> Result<(), AppError> {
    let mut vault = state.vault.lock().map_err(|_| vault_lock_error())?;
    vault.mutate(|payload| inventory::delete_known_host(payload, id))
}
