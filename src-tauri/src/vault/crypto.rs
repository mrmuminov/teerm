use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use chacha20poly1305::aead::{Aead, Payload};
use chacha20poly1305::{KeyInit, XChaCha20Poly1305, XNonce};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::error::AppError;

pub const VAULT_FORMAT: &str = "teerm-vault";
pub const VAULT_VERSION: u32 = 1;
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultEnvelope {
    pub format: String,
    pub version: u32,
    pub kdf: KdfParams,
    pub cipher: CipherParams,
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
    if envelope.version != VAULT_VERSION {
        return Err(AppError::UnsupportedVersion(envelope.version));
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

pub fn encrypt_with_key(
    plaintext: &[u8],
    key: &[u8],
    kdf: &KdfParams,
) -> Result<VaultEnvelope, AppError> {
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::fill(&mut nonce).map_err(|error| AppError::Crypto(error.to_string()))?;

    let mut envelope = VaultEnvelope {
        format: VAULT_FORMAT.into(),
        version: VAULT_VERSION,
        kdf: kdf.clone(),
        cipher: CipherParams {
            algorithm: "xchacha20poly1305".into(),
            nonce: STANDARD.encode(nonce),
        },
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

pub fn decrypt(
    envelope: &VaultEnvelope,
    password: &str,
) -> Result<(Zeroizing<Vec<u8>>, Zeroizing<[u8; KEY_LEN]>), AppError> {
    let key = derive_key(password, &envelope.kdf)?;
    let plaintext = decrypt_with_key(envelope, &key[..])?;
    Ok((plaintext, key))
}

#[allow(dead_code)] // used by password-protected export
pub fn encrypt_with_password(
    plaintext: &[u8],
    password: &str,
) -> Result<VaultEnvelope, AppError> {
    let kdf = new_kdf()?;
    let key = derive_key(password, &kdf)?;
    encrypt_with_key(plaintext, &key[..], &kdf)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_kdf() -> KdfParams {
        KdfParams {
            algorithm: "argon2id".into(),
            memory_kib: 8,
            iterations: 1,
            parallelism: 1,
            salt: STANDARD.encode([7u8; 16]),
        }
    }

    fn encrypt(value: &[u8], password: &str) -> VaultEnvelope {
        let kdf = test_kdf();
        let key = derive_key(password, &kdf).unwrap();
        encrypt_with_key(value, &key[..], &kdf).unwrap()
    }

    #[test]
    fn roundtrip() {
        let envelope = encrypt(b"top secret", "correct horse battery staple");
        let (plaintext, key) = decrypt(&envelope, "correct horse battery staple").unwrap();

        assert_eq!(&plaintext[..], b"top secret");
        assert_eq!(key.len(), KEY_LEN);
    }

    #[test]
    fn wrong_password_is_rejected() {
        let envelope = encrypt(b"top secret", "correct horse battery staple");
        let error = decrypt(&envelope, "wrong password").unwrap_err();

        assert!(matches!(error, AppError::InvalidPassword));
    }

    #[test]
    fn tampered_payload_is_rejected() {
        let mut envelope = encrypt(b"top secret", "correct horse battery staple");
        let mut ciphertext = STANDARD.decode(envelope.payload_b64()).unwrap();
        ciphertext[0] ^= 0x01;
        envelope.payload = STANDARD.encode(ciphertext);

        let error = decrypt(&envelope, "correct horse battery staple").unwrap_err();
        assert!(matches!(error, AppError::InvalidPassword));
    }

    #[test]
    fn tampered_header_is_rejected() {
        let mut envelope = encrypt(b"top secret", "correct horse battery staple");
        envelope.kdf.salt = STANDARD.encode([9u8; 16]);

        let error = decrypt(&envelope, "correct horse battery staple").unwrap_err();
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

        let (plaintext, _) = decrypt(&parsed, "correct horse battery staple").unwrap();
        assert_eq!(&plaintext[..], b"top secret");
    }
}
