use serde::Serialize;
use zeroize::Zeroizing;

use crate::error::AppError;

use super::crypto::{self, KdfParams};
use super::model::{VaultPayload, SCHEMA_VERSION};
use super::store::VaultStore;

pub const MIN_MASTER_PASSWORD_LEN: usize = 10;
const MAX_MASTER_PASSWORD_LEN: usize = 1024;

#[derive(Debug, Clone, Serialize)]
pub struct VaultStatus {
    pub exists: bool,
    pub unlocked: bool,
}

pub struct UnlockedVault {
    payload: VaultPayload,
    key: Zeroizing<[u8; crypto::KEY_LEN]>,
    kdf: KdfParams,
}

impl UnlockedVault {
    pub fn payload(&self) -> &VaultPayload {
        &self.payload
    }

}

pub struct VaultManager {
    store: VaultStore,
    unlocked: Option<UnlockedVault>,
}

impl VaultManager {
    pub fn new(store: VaultStore) -> Self {
        Self {
            store,
            unlocked: None,
        }
    }

    pub fn status(&self) -> VaultStatus {
        VaultStatus {
            exists: self.store.exists(),
            unlocked: self.unlocked.is_some(),
        }
    }

    pub fn create(&mut self, password: &str) -> Result<(), AppError> {
        validate_master_password(password)?;

        if self.store.exists() {
            return Err(AppError::VaultExists);
        }

        let kdf = crypto::new_kdf()?;
        let key = crypto::derive_key(password, &kdf)?;
        let payload = VaultPayload::new();
        let plaintext = serde_json::to_vec(&payload)?;
        let envelope = crypto::encrypt_with_key(&plaintext, &key[..], &kdf)?;

        self.store.write(&envelope)?;
        self.unlocked = Some(UnlockedVault { payload, key, kdf });

        Ok(())
    }

    pub fn unlock(&mut self, password: &str) -> Result<(), AppError> {
        if self.unlocked.is_some() {
            return Ok(());
        }

        let envelope = self.store.read()?;
        let (plaintext, key) = crypto::decrypt(&envelope, password)?;
        let payload: VaultPayload = serde_json::from_slice(&plaintext[..])?;

        if payload.schema_version > SCHEMA_VERSION {
            return Err(AppError::UnsupportedVersion(payload.schema_version));
        }

        self.unlocked = Some(UnlockedVault {
            payload,
            key,
            kdf: envelope.kdf,
        });

        Ok(())
    }

    pub fn lock(&mut self) {
        self.unlocked = None;
    }

    pub fn payload(&self) -> Result<&VaultPayload, AppError> {
        self.unlocked
            .as_ref()
            .map(UnlockedVault::payload)
            .ok_or(AppError::VaultLocked)
    }

    pub fn save(&mut self) -> Result<(), AppError> {
        let envelope = {
            let unlocked = self.unlocked.as_mut().ok_or(AppError::VaultLocked)?;
            unlocked.payload.touch();
            let plaintext = serde_json::to_vec(&unlocked.payload)?;
            crypto::encrypt_with_key(&plaintext, &unlocked.key[..], &unlocked.kdf)?
        };

        self.store.write(&envelope)
    }

    /// Applies a change and persists it atomically from the caller's point of
    /// view: if validation or the write fails, the in-memory payload is
    /// restored to its previous state.
    pub fn mutate<T>(
        &mut self,
        apply: impl FnOnce(&mut VaultPayload) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let unlocked = self.unlocked.as_mut().ok_or(AppError::VaultLocked)?;
        let backup = unlocked.payload.clone();

        let value = match apply(&mut unlocked.payload) {
            Ok(value) => value,
            Err(error) => {
                if let Some(unlocked) = self.unlocked.as_mut() {
                    unlocked.payload = backup;
                }
                return Err(error);
            }
        };

        match self.save() {
            Ok(()) => Ok(value),
            Err(error) => {
                if let Some(unlocked) = self.unlocked.as_mut() {
                    unlocked.payload = backup;
                }
                Err(error)
            }
        }
    }

    pub fn change_password(&mut self, current: &str, new: &str) -> Result<(), AppError> {
        validate_master_password(new)?;

        let envelope = self.store.read()?;
        let (plaintext, _) = crypto::decrypt(&envelope, current)?;
        let new_kdf = crypto::new_kdf()?;
        let new_key = crypto::derive_key(new, &new_kdf)?;
        let new_envelope = crypto::encrypt_with_key(&plaintext[..], &new_key[..], &new_kdf)?;
        self.store.write(&new_envelope)?;

        if let Some(unlocked) = self.unlocked.as_mut() {
            unlocked.key = new_key;
            unlocked.kdf = new_kdf;
        }

        Ok(())
    }

}

pub fn validate_master_password(password: &str) -> Result<(), AppError> {
    if password.chars().count() < MIN_MASTER_PASSWORD_LEN {
        return Err(AppError::InvalidInput(format!(
            "master password must be at least {MIN_MASTER_PASSWORD_LEN} characters"
        )));
    }
    if password.len() > MAX_MASTER_PASSWORD_LEN {
        return Err(AppError::InvalidInput(
            "master password is too long".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manager() -> (tempfile::TempDir, VaultManager) {
        let directory = tempfile::tempdir().unwrap();
        let manager = VaultManager::new(VaultStore::new(directory.path()));
        (directory, manager)
    }

    #[test]
    fn create_writes_and_unlocks_the_vault() {
        let (_directory, mut manager) = manager();

        manager.create("a long test password").unwrap();

        let status = manager.status();
        assert!(status.exists);
        assert!(status.unlocked);
        assert!(manager.payload().unwrap().hosts.is_empty());
    }

    #[test]
    fn short_master_passwords_are_rejected() {
        let (_directory, mut manager) = manager();

        let error = manager.create("short").unwrap_err();

        assert!(matches!(error, AppError::InvalidInput(_)));
        assert!(!manager.status().exists);
    }

    #[test]
    fn lock_and_unlock_roundtrip() {
        let (_directory, mut manager) = manager();
        manager.create("a long test password").unwrap();

        manager.lock();
        assert!(manager.status().exists);
        assert!(!manager.status().unlocked);
        assert!(matches!(manager.payload(), Err(AppError::VaultLocked)));

        assert!(matches!(
            manager.unlock("the wrong password"),
            Err(AppError::InvalidPassword)
        ));

        manager.unlock("a long test password").unwrap();
        assert!(manager.status().unlocked);
        assert!(manager.payload().is_ok());
    }

    #[test]
    fn save_increments_the_revision_and_persists() {
        let (_directory, mut manager) = manager();
        manager.create("a long test password").unwrap();

        let before = manager.payload().unwrap().revision;
        manager.save().unwrap();
        let after = manager.payload().unwrap().revision;

        assert_eq!(after, before + 1);

        manager.lock();
        manager.unlock("a long test password").unwrap();
        assert_eq!(manager.payload().unwrap().revision, after);
    }

    #[test]
    fn inventory_survives_lock_and_unlock() {
        use crate::inventory::{self, HostInput};

        let (_directory, mut manager) = manager();
        manager.create("a long test password").unwrap();

        let host = manager
            .mutate(|payload| {
                inventory::create_host(
                    payload,
                    HostInput {
                        label: "Web".into(),
                        address: "web.example.com".into(),
                        port: 22,
                        username: "deploy".into(),
                        password: Some("server secret".into()),
                        ..HostInput::default()
                    },
                )
            })
            .unwrap();

        manager.lock();
        manager.unlock("a long test password").unwrap();

        let payload = manager.payload().unwrap();
        let stored = inventory::list_hosts(payload);
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].id, host.id);
        assert!(stored[0].has_password);
    }

    #[test]
    fn change_password_rewraps_the_vault() {
        let (_directory, mut manager) = manager();
        manager.create("a long test password").unwrap();

        assert!(matches!(
            manager.change_password("wrong password", "a different long password"),
            Err(AppError::InvalidPassword)
        ));

        manager
            .change_password("a long test password", "a different long password")
            .unwrap();
        manager.lock();

        assert!(matches!(
            manager.unlock("a long test password"),
            Err(AppError::InvalidPassword)
        ));
        manager.unlock("a different long password").unwrap();
        assert!(manager.status().unlocked);
    }
}
