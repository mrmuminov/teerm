use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use chacha20poly1305::aead::{Aead, Payload};
use chacha20poly1305::{KeyInit, XChaCha20Poly1305, XNonce};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::error::AppError;

pub const VAULT_FORMAT: &str = "teerm-vault";
/// Version written by this build. Version 1 (payload encrypted directly with
/// the password-derived key) is still readable and upgraded on the next save.
pub const VAULT_VERSION: u32 = 2;
const LEGACY_VAULT_VERSION: u32 = 1;
const WRAP_CONTEXT_PASSWORD: &[u8] = b"teerm-key-wrap/password";
const WRAP_CONTEXT_RECOVERY: &[u8] = b"teerm-key-wrap/recovery";
pub const KEY_LEN: usize = 32;
pub const SALT_LEN: usize = 16;
pub const NONCE_LEN: usize = 24;

pub const DEFAULT_KDF_MEMORY_KIB: u32 = 64 * 1024;
pub const DEFAULT_KDF_ITERATIONS: u32 = 3;
pub const DEFAULT_KDF_PARALLELISM: u32 = 1;

// Upper bounds protect against a malicious Vault file requesting an
// unreasonable amount of memory or CPU.
const MAX_KDF_MEMORY_KIB: u32 = 1024 * 1024;
const MAX_KDF_ITERATIONS: u32 = 10;
const MAX_KDF_PARALLELISM: u32 = 8;
const MAX_SALT_LEN: usize = 64;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct KdfParams {
    pub algorithm: String,
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
    pub salt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CipherParams {
    pub algorithm: String,
    pub nonce: String,
}

/// The data-encryption key, encrypted by a key derived from a password or a
/// recovery phrase.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct KeyWrap {
    pub nonce: String,
    pub wrapped: String,
}

/// Lets the recovery phrase open the Vault: the same data-encryption key,
/// wrapped by a key derived from the phrase under its own salt.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecoveryBlock {
    pub kdf: KdfParams,
    pub key_wrap: KeyWrap,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultEnvelope {
    pub format: String,
    pub version: u32,
    pub kdf: KdfParams,
    pub cipher: CipherParams,
    /// Present from version 2: the data-encryption key wrapped by the
    /// password-derived key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_wrap: Option<KeyWrap>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery: Option<RecoveryBlock>,
    payload: String,
}

impl VaultEnvelope {
    #[allow(dead_code)] // used by Vault export
    pub fn payload_b64(&self) -> &str {
        &self.payload
    }
}

#[derive(Serialize)]
struct Header<'a> {
    format: &'a str,
    version: u32,
    kdf: &'a KdfParams,
    cipher: &'a CipherParams,
}

fn header_aad(envelope: &VaultEnvelope) -> Result<Vec<u8>, AppError> {
    Ok(serde_json::to_vec(&Header {
        format: &envelope.format,
        version: envelope.version,
        kdf: &envelope.kdf,
        cipher: &envelope.cipher,
    })?)
}

pub fn new_kdf() -> Result<KdfParams, AppError> {
    let mut salt = [0u8; SALT_LEN];
    getrandom::fill(&mut salt).map_err(|error| AppError::Crypto(error.to_string()))?;

    Ok(KdfParams {
        algorithm: "argon2id".into(),
        memory_kib: DEFAULT_KDF_MEMORY_KIB,
        iterations: DEFAULT_KDF_ITERATIONS,
        parallelism: DEFAULT_KDF_PARALLELISM,
        salt: STANDARD.encode(salt),
    })
}

pub fn derive_key(password: &str, kdf: &KdfParams) -> Result<Zeroizing<[u8; KEY_LEN]>, AppError> {
    validate_kdf(kdf)?;

    let salt = STANDARD
        .decode(&kdf.salt)
        .map_err(|error| AppError::CorruptVault(format!("invalid salt: {error}")))?;

    let params = Params::new(
        kdf.memory_kib,
        kdf.iterations,
        kdf.parallelism,
        Some(KEY_LEN),
    )
    .map_err(|error| AppError::Crypto(error.to_string()))?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    argon2
        .hash_password_into(password.as_bytes(), &salt, &mut key[..])
        .map_err(|error| AppError::Crypto(error.to_string()))?;

    Ok(key)
}

fn validate_kdf(kdf: &KdfParams) -> Result<(), AppError> {
    if kdf.algorithm != "argon2id" {
        return Err(AppError::CorruptVault(format!(
            "unsupported KDF: {}",
            kdf.algorithm
        )));
    }
    if kdf.memory_kib < 8 || kdf.memory_kib > MAX_KDF_MEMORY_KIB {
        return Err(AppError::CorruptVault("KDF memory out of range".into()));
    }
    if kdf.iterations == 0 || kdf.iterations > MAX_KDF_ITERATIONS {
        return Err(AppError::CorruptVault("KDF iterations out of range".into()));
    }
    if kdf.parallelism == 0 || kdf.parallelism > MAX_KDF_PARALLELISM {
        return Err(AppError::CorruptVault(
            "KDF parallelism out of range".into(),
        ));
    }

    let salt_len = STANDARD
        .decode(&kdf.salt)
        .map_err(|error| AppError::CorruptVault(format!("invalid salt: {error}")))?
        .len();
    if salt_len < 8 || salt_len > MAX_SALT_LEN {
        return Err(AppError::CorruptVault("salt length out of range".into()));
    }

    Ok(())
}

fn validate_envelope(envelope: &VaultEnvelope) -> Result<(), AppError> {
    if envelope.format != VAULT_FORMAT {
        return Err(AppError::CorruptVault("unexpected file format".into()));
    }
    if envelope.version != VAULT_VERSION && envelope.version != LEGACY_VAULT_VERSION {
        return Err(AppError::UnsupportedVersion(envelope.version));
    }
    if envelope.version == VAULT_VERSION && envelope.key_wrap.is_none() {
        return Err(AppError::CorruptVault("missing key wrap".into()));
    }
    if envelope.cipher.algorithm != "xchacha20poly1305" {
        return Err(AppError::CorruptVault(format!(
            "unsupported cipher: {}",
            envelope.cipher.algorithm
        )));
    }
    if envelope.payload.is_empty() {
        return Err(AppError::CorruptVault("empty payload".into()));
    }
    validate_kdf(&envelope.kdf)
}

fn encrypt_payload(
    plaintext: &[u8],
    key: &[u8],
    kdf: &KdfParams,
    version: u32,
    key_wrap: Option<KeyWrap>,
    recovery: Option<RecoveryBlock>,
) -> Result<VaultEnvelope, AppError> {
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::fill(&mut nonce).map_err(|error| AppError::Crypto(error.to_string()))?;

    let mut envelope = VaultEnvelope {
        format: VAULT_FORMAT.into(),
        version,
        kdf: kdf.clone(),
        cipher: CipherParams {
            algorithm: "xchacha20poly1305".into(),
            nonce: STANDARD.encode(nonce),
        },
        key_wrap,
        recovery,
        payload: String::new(),
    };

    let aad = header_aad(&envelope)?;
    let cipher = XChaCha20Poly1305::new_from_slice(key)
        .map_err(|error| AppError::Crypto(error.to_string()))?;
    let ciphertext = cipher
        .encrypt(
            &XNonce::from(nonce),
            Payload {
                msg: plaintext,
                aad: &aad,
            },
        )
        .map_err(|error| AppError::Crypto(error.to_string()))?;

    envelope.payload = STANDARD.encode(ciphertext);
    Ok(envelope)
}

/// Everything needed to write the Vault file of an unlocked Vault: the
/// data-encryption key that encrypts the payload, and how it is wrapped.
#[derive(Clone)]
pub struct KeyMaterial {
    pub dek: Zeroizing<[u8; KEY_LEN]>,
    pub kdf: KdfParams,
    pub key_wrap: KeyWrap,
    pub recovery: Option<RecoveryBlock>,
}

fn random_key() -> Result<Zeroizing<[u8; KEY_LEN]>, AppError> {
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    getrandom::fill(&mut key[..]).map_err(|error| AppError::Crypto(error.to_string()))?;
    Ok(key)
}

fn wrap_key(dek: &[u8], kek: &[u8], context: &[u8]) -> Result<KeyWrap, AppError> {
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::fill(&mut nonce).map_err(|error| AppError::Crypto(error.to_string()))?;

    let cipher = XChaCha20Poly1305::new_from_slice(kek)
        .map_err(|error| AppError::Crypto(error.to_string()))?;
    let wrapped = cipher
        .encrypt(
            &XNonce::from(nonce),
            Payload {
                msg: dek,
                aad: context,
            },
        )
        .map_err(|error| AppError::Crypto(error.to_string()))?;

    Ok(KeyWrap {
        nonce: STANDARD.encode(nonce),
        wrapped: STANDARD.encode(wrapped),
    })
}

/// A key that does not open the wrap is reported as a wrong password; the
/// caller maps it to a more specific error where that helps.
fn unwrap_key(
    wrap: &KeyWrap,
    kek: &[u8],
    context: &[u8],
) -> Result<Zeroizing<[u8; KEY_LEN]>, AppError> {
    let nonce = STANDARD
        .decode(&wrap.nonce)
        .map_err(|error| AppError::CorruptVault(format!("invalid key wrap: {error}")))?;
    let nonce = XNonce::try_from(nonce.as_slice())
        .map_err(|_| AppError::CorruptVault("invalid key wrap nonce".into()))?;
    let wrapped = STANDARD
        .decode(&wrap.wrapped)
        .map_err(|error| AppError::CorruptVault(format!("invalid key wrap: {error}")))?;

    let cipher = XChaCha20Poly1305::new_from_slice(kek)
        .map_err(|error| AppError::Crypto(error.to_string()))?;
    let dek = cipher
        .decrypt(
            &nonce,
            Payload {
                msg: &wrapped,
                aad: context,
            },
        )
        .map_err(|_| AppError::InvalidPassword)?;
    let dek = Zeroizing::new(dek);

    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    if dek.len() != KEY_LEN {
        return Err(AppError::CorruptVault("invalid wrapped key length".into()));
    }
    key.copy_from_slice(&dek);
    Ok(key)
}

/// Wraps `dek` for a password under a fresh salt.
pub fn wrap_for_password(
    dek: &[u8],
    password: &str,
) -> Result<(KdfParams, KeyWrap), AppError> {
    let kdf = new_kdf()?;
    let wrap = wrap_with_kdf(dek, password, &kdf)?;
    Ok((kdf, wrap))
}

fn wrap_with_kdf(dek: &[u8], password: &str, kdf: &KdfParams) -> Result<KeyWrap, AppError> {
    let kek = derive_key(password, kdf)?;
    wrap_key(dek, &kek[..], WRAP_CONTEXT_PASSWORD)
}

/// Fresh key material for a new Vault.
pub fn new_key_material(password: &str) -> Result<KeyMaterial, AppError> {
    let dek = random_key()?;
    let (kdf, key_wrap) = wrap_for_password(&dek[..], password)?;
    Ok(KeyMaterial {
        dek,
        kdf,
        key_wrap,
        recovery: None,
    })
}

/// Encrypts the payload and writes the wraps into a version 2 envelope.
pub fn seal(plaintext: &[u8], material: &KeyMaterial) -> Result<VaultEnvelope, AppError> {
    encrypt_payload(
        plaintext,
        &material.dek[..],
        &material.kdf,
        VAULT_VERSION,
        Some(material.key_wrap.clone()),
        material.recovery.clone(),
    )
}

/// Opens a Vault with its password. A version 1 file has no data-encryption
/// key, so one is created here and written on the next save.
pub fn open(
    envelope: &VaultEnvelope,
    password: &str,
) -> Result<(Zeroizing<Vec<u8>>, KeyMaterial), AppError> {
    validate_envelope(envelope)?;
    let kek = derive_key(password, &envelope.kdf)?;

    if envelope.version == LEGACY_VAULT_VERSION {
        let plaintext = decrypt_with_key(envelope, &kek[..])?;
        let dek = random_key()?;
        let key_wrap = wrap_key(&dek[..], &kek[..], WRAP_CONTEXT_PASSWORD)?;
        return Ok((
            plaintext,
            KeyMaterial {
                dek,
                kdf: envelope.kdf.clone(),
                key_wrap,
                recovery: None,
            },
        ));
    }

    let wrap = envelope
        .key_wrap
        .as_ref()
        .ok_or_else(|| AppError::CorruptVault("missing key wrap".into()))?;
    let dek = unwrap_key(wrap, &kek[..], WRAP_CONTEXT_PASSWORD)?;
    let plaintext = decrypt_with_key(envelope, &dek[..])?;

    Ok((
        plaintext,
        KeyMaterial {
            dek,
            kdf: envelope.kdf.clone(),
            key_wrap: wrap.clone(),
            recovery: envelope.recovery.clone(),
        },
    ))
}

/// Opens a Vault with its recovery phrase.
pub fn open_with_recovery(
    envelope: &VaultEnvelope,
    phrase: &str,
) -> Result<(Zeroizing<Vec<u8>>, Zeroizing<[u8; KEY_LEN]>, RecoveryBlock), AppError> {
    validate_envelope(envelope)?;
    let block = envelope
        .recovery
        .as_ref()
        .ok_or(AppError::RecoveryNotEnabled)?;

    let kek = derive_key(phrase, &block.kdf)?;
    let dek = unwrap_key(&block.key_wrap, &kek[..], WRAP_CONTEXT_RECOVERY)
        .map_err(|error| match error {
            AppError::InvalidPassword => AppError::InvalidRecoveryPhrase,
            other => other,
        })?;
    let plaintext = decrypt_with_key(envelope, &dek[..])?;

    Ok((plaintext, dek, block.clone()))
}

/// Wraps `dek` for a recovery phrase under its own salt.
pub fn new_recovery_block(dek: &[u8], phrase: &str) -> Result<RecoveryBlock, AppError> {
    let kdf = new_kdf()?;
    let kek = derive_key(phrase, &kdf)?;
    let key_wrap = wrap_key(dek, &kek[..], WRAP_CONTEXT_RECOVERY)?;
    Ok(RecoveryBlock { kdf, key_wrap })
}

pub fn decrypt_with_key(
    envelope: &VaultEnvelope,
    key: &[u8],
) -> Result<Zeroizing<Vec<u8>>, AppError> {
    validate_envelope(envelope)?;

    let nonce = STANDARD
        .decode(&envelope.cipher.nonce)
        .map_err(|error| AppError::CorruptVault(format!("invalid nonce: {error}")))?;
    let nonce = XNonce::try_from(nonce.as_slice())
        .map_err(|_| AppError::CorruptVault("invalid nonce length".into()))?;

    let ciphertext = STANDARD
        .decode(&envelope.payload)
        .map_err(|error| AppError::CorruptVault(format!("invalid payload: {error}")))?;
    let aad = header_aad(envelope)?;

    let cipher = XChaCha20Poly1305::new_from_slice(key)
        .map_err(|error| AppError::Crypto(error.to_string()))?;
    let plaintext = cipher
        .decrypt(
            &nonce,
            Payload {
                msg: &ciphertext,
                aad: &aad,
            },
        )
        .map_err(|_| AppError::InvalidPassword)?;

    Ok(Zeroizing::new(plaintext))
}

/// A password-protected envelope without recovery, used by Full Exports.
pub fn encrypt_with_password(
    plaintext: &[u8],
    password: &str,
) -> Result<VaultEnvelope, AppError> {
    seal(plaintext, &new_key_material(password)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_kdf(salt: u8) -> KdfParams {
        KdfParams {
            algorithm: "argon2id".into(),
            memory_kib: 8,
            iterations: 1,
            parallelism: 1,
            salt: STANDARD.encode([salt; 16]),
        }
    }

    /// Key material with a cheap KDF so the tests stay fast.
    fn material(password: &str) -> KeyMaterial {
        let dek = random_key().unwrap();
        let kdf = test_kdf(7);
        let key_wrap = wrap_with_kdf(&dek[..], password, &kdf).unwrap();
        KeyMaterial {
            dek,
            kdf,
            key_wrap,
            recovery: None,
        }
    }

    fn encrypt(value: &[u8], password: &str) -> VaultEnvelope {
        seal(value, &material(password)).unwrap()
    }

    /// A version 1 file: the payload encrypted directly by the password key.
    fn legacy_envelope(value: &[u8], password: &str) -> VaultEnvelope {
        let kdf = test_kdf(5);
        let key = derive_key(password, &kdf).unwrap();
        encrypt_payload(value, &key[..], &kdf, LEGACY_VAULT_VERSION, None, None).unwrap()
    }

    #[test]
    fn roundtrip() {
        let envelope = encrypt(b"top secret", "correct horse battery staple");
        let (plaintext, material) = open(&envelope, "correct horse battery staple").unwrap();

        assert_eq!(&plaintext[..], b"top secret");
        assert_eq!(material.dek.len(), KEY_LEN);
        assert_eq!(envelope.version, VAULT_VERSION);
    }

    #[test]
    fn wrong_password_is_rejected() {
        let envelope = encrypt(b"top secret", "correct horse battery staple");
        let error = open(&envelope, "wrong password").err().unwrap();

        assert!(matches!(error, AppError::InvalidPassword));
    }

    #[test]
    fn tampered_payload_is_rejected() {
        let mut envelope = encrypt(b"top secret", "correct horse battery staple");
        let mut ciphertext = STANDARD.decode(envelope.payload_b64()).unwrap();
        ciphertext[0] ^= 0x01;
        envelope.payload = STANDARD.encode(ciphertext);

        let error = open(&envelope, "correct horse battery staple").err().unwrap();
        assert!(matches!(error, AppError::InvalidPassword));
    }

    #[test]
    fn tampered_header_is_rejected() {
        let mut envelope = encrypt(b"top secret", "correct horse battery staple");
        envelope.kdf.salt = STANDARD.encode([9u8; 16]);

        let error = open(&envelope, "correct horse battery staple").err().unwrap();
        assert!(matches!(
            error,
            AppError::InvalidPassword | AppError::CorruptVault(_)
        ));
    }

    #[test]
    fn envelope_json_roundtrip() {
        let envelope = encrypt(b"top secret", "correct horse battery staple");
        let json = serde_json::to_string(&envelope).unwrap();
        let parsed: VaultEnvelope = serde_json::from_str(&json).unwrap();

        let (plaintext, _) = open(&parsed, "correct horse battery staple").unwrap();
        assert_eq!(&plaintext[..], b"top secret");
    }

    #[test]
    fn a_version_1_vault_opens_and_is_upgraded_on_seal() {
        let legacy = legacy_envelope(b"old data", "correct horse battery staple");
        assert_eq!(legacy.version, 1);
        assert!(legacy.key_wrap.is_none());

        let (plaintext, material) = open(&legacy, "correct horse battery staple").unwrap();
        assert_eq!(&plaintext[..], b"old data");

        let upgraded = seal(&plaintext[..], &material).unwrap();
        assert_eq!(upgraded.version, VAULT_VERSION);
        let (again, _) = open(&upgraded, "correct horse battery staple").unwrap();
        assert_eq!(&again[..], b"old data");
    }

    #[test]
    fn the_recovery_phrase_opens_the_vault_without_the_password() {
        let mut material = material("correct horse battery staple");
        material.recovery = Some(new_recovery_block(&material.dek[..], "the recovery phrase").unwrap());
        let envelope = seal(b"top secret", &material).unwrap();

        let (plaintext, dek, _) = open_with_recovery(&envelope, "the recovery phrase").unwrap();

        assert_eq!(&plaintext[..], b"top secret");
        assert_eq!(&dek[..], &material.dek[..]);
    }

    #[test]
    fn a_wrong_recovery_phrase_is_rejected() {
        let mut material = material("correct horse battery staple");
        material.recovery = Some(new_recovery_block(&material.dek[..], "the recovery phrase").unwrap());
        let envelope = seal(b"top secret", &material).unwrap();

        let error = open_with_recovery(&envelope, "another phrase").err().unwrap();

        assert!(matches!(error, AppError::InvalidRecoveryPhrase));
    }

    #[test]
    fn recovery_is_reported_missing_when_never_set_up() {
        let envelope = encrypt(b"top secret", "correct horse battery staple");

        let error = open_with_recovery(&envelope, "the recovery phrase").err().unwrap();

        assert!(matches!(error, AppError::RecoveryNotEnabled));
    }

    #[test]
    fn rewrapping_for_a_new_password_keeps_the_recovery_phrase_valid() {
        let mut material = material("old password value");
        material.recovery = Some(new_recovery_block(&material.dek[..], "the recovery phrase").unwrap());

        // A password change re-wraps the same data-encryption key.
        let kdf = test_kdf(11);
        material.key_wrap = wrap_with_kdf(&material.dek[..], "new password value", &kdf).unwrap();
        material.kdf = kdf;
        let envelope = seal(b"top secret", &material).unwrap();

        assert!(open(&envelope, "old password value").is_err());
        assert!(open(&envelope, "new password value").is_ok());
        assert!(open_with_recovery(&envelope, "the recovery phrase").is_ok());
    }
}
