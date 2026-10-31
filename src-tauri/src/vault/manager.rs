use serde::Serialize;

use crate::error::AppError;

use super::crypto::{self, KeyMaterial, VaultEnvelope};
use super::model::{VaultPayload, SCHEMA_VERSION};
use super::phrase;
use super::store::VaultStore;
use zeroize::Zeroizing;

pub const MIN_MASTER_PASSWORD_LEN: usize = 10;
const MAX_MASTER_PASSWORD_LEN: usize = 1024;

#[derive(Debug, Clone, Serialize)]
pub struct VaultStatus {
    pub exists: bool,
    pub unlocked: bool,
    /// Whether a Recovery Phrase can open this Vault. Readable while locked,
    /// so the unlock screen can offer recovery.
    pub recovery_enabled: bool,
}

pub struct UnlockedVault {
    payload: VaultPayload,
    material: KeyMaterial,
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
        let recovery_enabled = match self.unlocked.as_ref() {
            Some(unlocked) => unlocked.material.recovery.is_some(),
            None => self
                .store
                .read()
                .map(|envelope| envelope.recovery.is_some())
                .unwrap_or(false),
        };

        VaultStatus {
            exists: self.store.exists(),
            unlocked: self.unlocked.is_some(),
            recovery_enabled,
        }
    }

    pub fn create(&mut self, password: &str) -> Result<(), AppError> {
        let password = phrase::canonical_password(password);
        validate_master_password(&password)?;

        if self.store.exists() {
            return Err(AppError::VaultExists);
        }

        let material = crypto::new_key_material(&password)?;
        let payload = VaultPayload::new();
        let plaintext = serde_json::to_vec(&payload)?;
        let envelope = crypto::seal(&plaintext, &material)?;

        self.store.write(&envelope)?;
        self.unlocked = Some(UnlockedVault { payload, material });

        Ok(())
    }

    pub fn unlock(&mut self, password: &str) -> Result<(), AppError> {
        if self.unlocked.is_some() {
            return Ok(());
        }

        let envelope = self.store.read()?;
        let (plaintext, material) = open_with_password(&envelope, password)?;
        let payload: VaultPayload = serde_json::from_slice(&plaintext[..])?;

        if payload.schema_version > SCHEMA_VERSION {
            return Err(AppError::UnsupportedVersion(payload.schema_version));
        }

        self.unlocked = Some(UnlockedVault { payload, material });

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
            crypto::seal(&plaintext, &unlocked.material)?
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

    pub fn backup_vault_file(&self) -> Result<std::path::PathBuf, AppError> {
        self.store.backup_copy()
    }

    pub fn change_password(&mut self, current: &str, new: &str) -> Result<(), AppError> {
        let new = phrase::canonical_password(new);
        validate_master_password(&new)?;

        let envelope = self.store.read()?;
        let opened = open_with_password(&envelope, current)?;

        // An unlocked Vault keeps using its in-memory key material, so a
        // version 1 file is not given a second, different data key here.
        let (plaintext, mut material) = match self.unlocked.as_ref() {
            Some(unlocked) => (
                Zeroizing::new(serde_json::to_vec(&unlocked.payload)?),
                unlocked.material.clone(),
            ),
            None => opened,
        };

        let (kdf, key_wrap) = crypto::wrap_for_password(&material.dek[..], &new)?;
        material.kdf = kdf;
        material.key_wrap = key_wrap;
        self.store.write(&crypto::seal(&plaintext[..], &material)?)?;

        if let Some(unlocked) = self.unlocked.as_mut() {
            unlocked.material = material;
        }

        Ok(())
    }

    /// Sets up (or replaces) the Recovery Phrase and returns it. The phrase is
    /// not stored anywhere: this is the only time it is available.
    pub fn enable_recovery(&mut self, password: &str) -> Result<String, AppError> {
        self.require_password(password)?;

        let recovery_phrase = phrase::generate_recovery_phrase()?;
        let unlocked = self.unlocked.as_mut().ok_or(AppError::VaultLocked)?;
        let block = crypto::new_recovery_block(&unlocked.material.dek[..], &recovery_phrase)?;
        let previous = unlocked.material.recovery.replace(block);

        if let Err(error) = self.save() {
            if let Some(unlocked) = self.unlocked.as_mut() {
                unlocked.material.recovery = previous;
            }
            return Err(error);
        }

        Ok(recovery_phrase)
    }

    pub fn disable_recovery(&mut self, password: &str) -> Result<(), AppError> {
        self.require_password(password)?;

        let unlocked = self.unlocked.as_mut().ok_or(AppError::VaultLocked)?;
        let previous = unlocked.material.recovery.take();

        if let Err(error) = self.save() {
            if let Some(unlocked) = self.unlocked.as_mut() {
                unlocked.material.recovery = previous;
            }
            return Err(error);
        }

        Ok(())
    }

    /// Opens the Vault with its Recovery Phrase and sets a new Master
    /// Password. The Recovery Phrase stays valid.
    pub fn recover(&mut self, recovery_phrase: &str, new_password: &str) -> Result<(), AppError> {
        let new_password = phrase::canonical_password(new_password);
        validate_master_password(&new_password)?;
        let recovery_phrase = phrase::canonical_recovery_phrase(recovery_phrase)?;

        let envelope = self.store.read()?;
        let (plaintext, dek, recovery) = crypto::open_with_recovery(&envelope, &recovery_phrase)?;
        let payload: VaultPayload = serde_json::from_slice(&plaintext[..])?;

        if payload.schema_version > SCHEMA_VERSION {
            return Err(AppError::UnsupportedVersion(payload.schema_version));
        }

        let (kdf, key_wrap) = crypto::wrap_for_password(&dek[..], &new_password)?;
        let material = KeyMaterial {
            dek,
            kdf,
            key_wrap,
            recovery: Some(recovery),
        };
        self.store.write(&crypto::seal(&plaintext[..], &material)?)?;
        self.unlocked = Some(UnlockedVault { payload, material });

        Ok(())
    }

    /// Re-checks the Master Password before a sensitive change.
    fn require_password(&self, password: &str) -> Result<(), AppError> {
        if self.unlocked.is_none() {
            return Err(AppError::VaultLocked);
        }
        open_with_password(&self.store.read()?, password).map(|_| ())
    }
}

/// A password typed as a BIP39 phrase is tried in its canonical form first,
/// then as typed, so a Vault created before phrases were normalized still
/// opens.
fn open_with_password(
    envelope: &VaultEnvelope,
    password: &str,
) -> Result<(Zeroizing<Vec<u8>>, KeyMaterial), AppError> {
    let canonical = phrase::canonical_password(password);
    match crypto::open(envelope, &canonical) {
        Err(AppError::InvalidPassword) if canonical != password => {
            crypto::open(envelope, password)
        }
        other => other,
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

    const PASSWORD: &str = "a long test password";

    #[test]
    fn recovery_is_off_until_it_is_set_up() {
        let (_directory, mut manager) = manager();
        manager.create(PASSWORD).unwrap();

        assert!(!manager.status().recovery_enabled);
        manager.lock();
        assert!(!manager.status().recovery_enabled);
    }

    #[test]
    fn enabling_recovery_needs_the_current_password() {
        let (_directory, mut manager) = manager();
        manager.create(PASSWORD).unwrap();

        assert!(matches!(
            manager.enable_recovery("the wrong password"),
            Err(AppError::InvalidPassword)
        ));
        assert!(!manager.status().recovery_enabled);
    }

    #[test]
    fn the_recovery_phrase_resets_a_forgotten_password() {
        let (_directory, mut manager) = manager();
        manager.create(PASSWORD).unwrap();
        manager.mutate(|payload| {
            payload.vault_id = uuid::Uuid::nil();
            Ok(())
        }).unwrap();
        let recovery_phrase = manager.enable_recovery(PASSWORD).unwrap();
        assert_eq!(recovery_phrase.split(' ').count(), 24);
        manager.lock();
        assert!(manager.status().recovery_enabled);

        manager.recover(&recovery_phrase, "a brand new password").unwrap();

        assert!(manager.status().unlocked);
        assert_eq!(manager.payload().unwrap().vault_id, uuid::Uuid::nil());
        manager.lock();
        assert!(matches!(manager.unlock(PASSWORD), Err(AppError::InvalidPassword)));
        manager.unlock("a brand new password").unwrap();
    }

    #[test]
    fn recovery_accepts_the_phrase_in_any_case_and_spacing() {
        let (_directory, mut manager) = manager();
        manager.create(PASSWORD).unwrap();
        let recovery_phrase = manager.enable_recovery(PASSWORD).unwrap();
        manager.lock();

        let messy = format!(" {} ", recovery_phrase.to_uppercase().replace(' ', "  "));
        manager.recover(&messy, "a brand new password").unwrap();
    }

    #[test]
    fn a_wrong_or_missing_recovery_phrase_is_rejected() {
        let (_directory, mut manager) = manager();
        manager.create(PASSWORD).unwrap();

        assert!(matches!(
            manager.recover("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", "a brand new password"),
            Err(AppError::RecoveryNotEnabled)
        ));

        manager.enable_recovery(PASSWORD).unwrap();
        manager.lock();

        assert!(matches!(
            manager.recover("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", "a brand new password"),
            Err(AppError::InvalidRecoveryPhrase)
        ));
        assert!(matches!(
            manager.recover("not a phrase", "a brand new password"),
            Err(AppError::InvalidRecoveryPhrase)
        ));
        assert!(!manager.status().unlocked);
    }

    #[test]
    fn changing_the_password_keeps_the_recovery_phrase_working() {
        let (_directory, mut manager) = manager();
        manager.create(PASSWORD).unwrap();
        let recovery_phrase = manager.enable_recovery(PASSWORD).unwrap();

        manager.change_password(PASSWORD, "the changed password").unwrap();
        manager.lock();

        assert!(manager.unlock(PASSWORD).is_err());
        manager.unlock("the changed password").unwrap();
        manager.lock();
        manager.recover(&recovery_phrase, "recovered password").unwrap();
    }

    #[test]
    fn disabling_recovery_invalidates_the_phrase() {
        let (_directory, mut manager) = manager();
        manager.create(PASSWORD).unwrap();
        let recovery_phrase = manager.enable_recovery(PASSWORD).unwrap();

        manager.disable_recovery(PASSWORD).unwrap();
        manager.lock();

        assert!(!manager.status().recovery_enabled);
        assert!(matches!(
            manager.recover(&recovery_phrase, "a brand new password"),
            Err(AppError::RecoveryNotEnabled)
        ));
    }

    #[test]
    fn regenerating_recovery_replaces_the_old_phrase() {
        let (_directory, mut manager) = manager();
        manager.create(PASSWORD).unwrap();
        let first = manager.enable_recovery(PASSWORD).unwrap();
        let second = manager.enable_recovery(PASSWORD).unwrap();
        manager.lock();

        assert_ne!(first, second);
        assert!(matches!(
            manager.recover(&first, "a brand new password"),
            Err(AppError::InvalidRecoveryPhrase)
        ));
        manager.recover(&second, "a brand new password").unwrap();
    }

    #[test]
    fn a_word_phrase_password_works_in_any_case_and_spacing() {
        let (_directory, mut manager) = manager();
        let words = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        manager.create(words).unwrap();
        manager.lock();

        manager.unlock(&format!("  {}  ", words.to_uppercase().replace(' ', "   "))).unwrap();
    }

    #[test]
    fn a_vault_stored_with_a_non_canonical_phrase_password_still_opens() {
        let (_directory, mut manager) = manager();
        // Written by an older build, which kept the password exactly as typed.
        let typed = "Abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon About";
        let material = crypto::new_key_material(typed).unwrap();
        let envelope = crypto::seal(&serde_json::to_vec(&VaultPayload::new()).unwrap(), &material).unwrap();
        manager.store.write(&envelope).unwrap();

        manager.unlock(typed).unwrap();
    }
}
