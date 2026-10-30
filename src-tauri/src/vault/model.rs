use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::Zeroize;

pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultPayload {
    pub schema_version: u32,
    pub vault_id: Uuid,
    pub revision: u64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub hosts: Vec<Host>,
    #[serde(default)]
    pub groups: Vec<HostGroup>,
    #[serde(default)]
    pub tags: Vec<Tag>,
    #[serde(default)]
    pub keys: Vec<SshKey>,
    #[serde(default)]
    pub port_forwards: Vec<PortForward>,
    #[serde(default)]
    pub known_hosts: Vec<KnownHost>,
}

impl VaultPayload {
    pub fn new() -> Self {
        let now = Utc::now();
        Self {
            schema_version: SCHEMA_VERSION,
            vault_id: Uuid::now_v7(),
            revision: 0,
            created_at: now,
            updated_at: now,
            hosts: Vec::new(),
            groups: Vec::new(),
            tags: Vec::new(),
            keys: Vec::new(),
            port_forwards: Vec::new(),
            known_hosts: Vec::new(),
        }
    }

    pub fn touch(&mut self) {
        self.updated_at = Utc::now();
        self.revision = self.revision.saturating_add(1);
    }
}

impl Default for VaultPayload {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for VaultPayload {
    fn drop(&mut self) {
        for host in &mut self.hosts {
            if let Some(password) = host.password.as_mut() {
                password.zeroize();
            }
        }

        for key in &mut self.keys {
            key.private_key.zeroize();
            if let Some(passphrase) = key.passphrase.as_mut() {
                passphrase.zeroize();
            }
        }
    }
}

fn default_port() -> u16 {
    22
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Host {
    pub id: Uuid,
    pub label: String,
    pub address: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub group_id: Option<Uuid>,
    #[serde(default)]
    pub tag_ids: Vec<Uuid>,
    #[serde(default)]
    pub key_id: Option<Uuid>,
    #[serde(default)]
    pub password: Option<String>,
    /// Reserved for the Jump Host feature (v1.1). No UI in v1.
    #[serde(default)]
    pub jump_host_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostGroup {
    pub id: Uuid,
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: Uuid,
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshKey {
    pub id: Uuid,
    pub name: String,
    pub key_type: String,
    pub public_key: String,
    /// Secret. Never send this across IPC to the webview.
    pub private_key: String,
    #[serde(default)]
    pub passphrase: Option<String>,
    pub fingerprint: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ForwardKind {
    Local,
    Remote,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortForward {
    pub id: Uuid,
    pub host_id: Uuid,
    pub kind: ForwardKind,
    pub bind_address: String,
    pub bind_port: u16,
    pub target_host: String,
    pub target_port: u16,
    #[serde(default)]
    pub auto_start: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnownHost {
    pub id: Uuid,
    pub address: String,
    pub port: u16,
    pub key_type: String,
    pub public_key: String,
    pub fingerprint: String,
    pub added_at: DateTime<Utc>,
    #[serde(default)]
    pub deleted_at: Option<DateTime<Utc>>,
}
