use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("vault already exists")]
    VaultExists,
    #[error("vault not found")]
    VaultNotFound,
    #[error("vault is locked")]
    VaultLocked,
    #[error("invalid password or corrupted vault")]
    InvalidPassword,
    #[error("vault file is corrupted: {0}")]
    CorruptVault(String),
    #[error("unsupported vault version: {0}")]
    UnsupportedVersion(u32),
    #[error("a passphrase is required to open this export")]
    PassphraseRequired,
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("session not found")]
    SessionNotFound,
    #[error("this Host needs a password to connect")]
    PasswordRequired,
    #[error("authentication failed")]
    AuthFailed,
    #[error("the server host key is not trusted")]
    HostKeyUnknown {
        address: String,
        port: u16,
        key_type: String,
        fingerprint: String,
    },
    #[error("the server host key has changed")]
    HostKeyChanged {
        address: String,
        port: u16,
        key_type: String,
        fingerprint: String,
        known_fingerprint: String,
    },
    #[error("io error: {0}")]
    Io(String),
    #[error("serialization error: {0}")]
    Serialization(String),
    #[error("cryptographic error: {0}")]
    Crypto(String),
    #[error("internal error: {0}")]
    Internal(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::VaultExists => "vault_exists",
            Self::VaultNotFound => "vault_not_found",
            Self::VaultLocked => "vault_locked",
            Self::InvalidPassword => "invalid_password",
            Self::CorruptVault(_) => "corrupt_vault",
            Self::UnsupportedVersion(_) => "unsupported_version",
            Self::PassphraseRequired => "passphrase_required",
            Self::InvalidInput(_) => "invalid_input",
            Self::NotFound(_) => "not_found",
            Self::SessionNotFound => "session_not_found",
            Self::PasswordRequired => "password_required",
            Self::AuthFailed => "auth_failed",
            Self::HostKeyUnknown { .. } => "host_key_unknown",
            Self::HostKeyChanged { .. } => "host_key_changed",
            Self::Io(_) => "io",
            Self::Serialization(_) => "serialization",
            Self::Crypto(_) => "crypto",
            Self::Internal(_) => "internal",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut map = serde_json::Map::new();
        map.insert("code".into(), self.code().into());
        map.insert("message".into(), self.to_string().into());

        match self {
            Self::HostKeyUnknown {
                address,
                port,
                key_type,
                fingerprint,
            } => {
                map.insert("address".into(), address.clone().into());
                map.insert("port".into(), (*port).into());
                map.insert("key_type".into(), key_type.clone().into());
                map.insert("fingerprint".into(), fingerprint.clone().into());
            }
            Self::HostKeyChanged {
                address,
                port,
                key_type,
                fingerprint,
                known_fingerprint,
            } => {
                map.insert("address".into(), address.clone().into());
                map.insert("port".into(), (*port).into());
                map.insert("key_type".into(), key_type.clone().into());
                map.insert("fingerprint".into(), fingerprint.clone().into());
                map.insert("known_fingerprint".into(), known_fingerprint.clone().into());
            }
            _ => {}
        }

        map.serialize(serializer)
    }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(value: serde_json::Error) -> Self {
        Self::Serialization(value.to_string())
    }
}
