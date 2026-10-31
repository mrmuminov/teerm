mod commands;
mod error;
mod forward;
mod fsutil;
mod inventory;
mod monitor;
mod settings;
mod sftp;
mod ssh;
mod state;
mod vault;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let state = state::AppState::new(&data_dir)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::vault_status,
            commands::vault_create,
            commands::vault_unlock,
            commands::vault_lock,
            commands::vault_change_password,
            commands::vault_generate_phrase,
            commands::vault_enable_recovery,
            commands::vault_disable_recovery,
            commands::vault_recover,
            commands::vault_create_from_export,
            commands::vault_export,
            commands::vault_import_preview,
            commands::vault_import_apply,
            commands::settings_get,
            commands::settings_update,
            commands::session_open,
            commands::session_write,
            commands::session_resize,
            commands::session_close,
            commands::session_latency,
            commands::monitor_sample,
            commands::session_auth_respond,
            commands::sftp_open,
            commands::sftp_list,
            commands::sftp_mkdir,
            commands::sftp_rename,
            commands::sftp_delete,
            commands::sftp_chmod,
            commands::sftp_download,
            commands::sftp_upload,
            commands::transfer_cancel,
            commands::app_info,
            commands::hosts_list,
            commands::host_create,
            commands::host_update,
            commands::host_delete,
            commands::groups_list,
            commands::group_create,
            commands::group_update,
            commands::group_delete,
            commands::tags_list,
            commands::tag_create,
            commands::tag_update,
            commands::tag_delete,
            commands::keys_list,
            commands::key_import,
            commands::key_generate,
            commands::key_update,
            commands::key_delete,
            commands::forwards_list,
            commands::forward_create,
            commands::forward_update,
            commands::forward_delete,
            commands::forward_start,
            commands::forward_stop,
            commands::forwards_status,
            commands::known_hosts_list,
            commands::known_host_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
