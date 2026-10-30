use std::fs;
use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::fsutil::atomic_write;

use super::crypto::VaultEnvelope;

pub const VAULT_FILENAME: &str = "vault.teermvault";

#[derive(Debug, Clone)]
pub struct VaultStore {
    path: PathBuf,
}

impl VaultStore {
    pub fn new(directory: &Path) -> Self {
        Self {
            path: directory.join(VAULT_FILENAME),
        }
    }

    #[allow(dead_code)] // used by backup and export flows
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn exists(&self) -> bool {
        self.path.exists()
    }

    pub fn read(&self) -> Result<VaultEnvelope, AppError> {
        if !self.exists() {
            return Err(AppError::VaultNotFound);
        }

        let contents = fs::read_to_string(&self.path)?;
        serde_json::from_str(&contents)
            .map_err(|error| AppError::CorruptVault(format!("invalid vault file: {error}")))
    }

    pub fn write(&self, envelope: &VaultEnvelope) -> Result<(), AppError> {
        let contents = serde_json::to_vec_pretty(envelope)?;
        atomic_write(&self.path, &contents)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::crypto;

    #[test]
    fn writes_and_reads_a_vault() {
        let directory = tempfile::tempdir().unwrap();
        let store = VaultStore::new(directory.path());

        assert!(!store.exists());

        let envelope = crypto::encrypt_with_password(b"{}", "a long test password").unwrap();
        store.write(&envelope).unwrap();

        assert!(store.exists());
        let read = store.read().unwrap();
        assert_eq!(read.format, envelope.format);
        assert_eq!(read.version, envelope.version);
        assert_eq!(read.payload_b64(), envelope.payload_b64());
    }
}
