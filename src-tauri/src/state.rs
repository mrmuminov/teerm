use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::error::AppError;
use crate::forward::ForwardManager;
use crate::settings::Settings;
use crate::sftp::SftpManager;
use crate::ssh::SshManager;
use crate::vault::manager::VaultManager;
use crate::vault::store::VaultStore;

pub struct AppState {
    pub vault: Mutex<VaultManager>,
    pub ssh: SshManager,
    pub sftp: SftpManager,
    pub forwards: ForwardManager,
    pub settings: Mutex<Settings>,
    pub settings_path: PathBuf,
}

impl AppState {
    pub fn new(data_dir: &Path) -> Result<Self, AppError> {
        std::fs::create_dir_all(data_dir)?;

        let store = VaultStore::new(data_dir);
        let settings_path = data_dir.join("settings.json");
        let settings = Settings::load(&settings_path);

        Ok(Self {
            vault: Mutex::new(VaultManager::new(store)),
            ssh: SshManager::new(),
            sftp: SftpManager::new(),
            forwards: ForwardManager::new(),
            settings: Mutex::new(settings),
            settings_path,
        })
    }
}
