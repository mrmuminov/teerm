use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::vault::model::{
    ForwardKind, Host, HostGroup, KnownHost, PortForward, SshKey, Tag,
};

fn default_port() -> u16 {
    22
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct HostInput {
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub address: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub group_id: Option<Uuid>,
    #[serde(default)]
    pub tag_ids: Vec<Uuid>,
    #[serde(default)]
    pub key_id: Option<Uuid>,
    /// Write-only. `None` keeps any stored password when updating.
    #[serde(default)]
    pub password: Option<String>,
    /// Explicitly removes the stored password when updating.
    #[serde(default)]
    pub clear_password: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct HostView {
    pub id: Uuid,
    pub label: String,
    pub address: String,
    pub port: u16,
    pub username: String,
    pub group_id: Option<Uuid>,
    pub tag_ids: Vec<Uuid>,
    pub key_id: Option<Uuid>,
    pub has_password: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<&Host> for HostView {
    fn from(host: &Host) -> Self {
        Self {
            id: host.id,
            label: host.label.clone(),
            address: host.address.clone(),
            port: host.port,
            username: host.username.clone(),
            group_id: host.group_id,
            tag_ids: host.tag_ids.clone(),
            key_id: host.key_id,
            has_password: host
                .password
                .as_ref()
                .is_some_and(|password| !password.is_empty()),
            created_at: host.created_at,
            updated_at: host.updated_at,
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct GroupInput {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GroupView {
    pub id: Uuid,
    pub name: String,
    pub parent_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<&HostGroup> for GroupView {
    fn from(group: &HostGroup) -> Self {
        Self {
            id: group.id,
            name: group.name.clone(),
            parent_id: group.parent_id,
            created_at: group.created_at,
            updated_at: group.updated_at,
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct TagInput {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TagView {
    pub id: Uuid,
    pub name: String,
    pub color: Option<String>,
    pub host_count: usize,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl TagView {
    pub fn from_tag(tag: &Tag, host_count: usize) -> Self {
        Self {
            id: tag.id,
            name: tag.name.clone(),
            color: tag.color.clone(),
            host_count,
            created_at: tag.created_at,
            updated_at: tag.updated_at,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct KeyImportInput {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub private_key: String,
    #[serde(default)]
    pub passphrase: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct KeyGenerateInput {
    #[serde(default)]
    pub name: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct KeyRenameInput {
    #[serde(default)]
    pub name: String,
}

/// Public key material only. The private key never crosses IPC.
#[derive(Debug, Clone, Serialize)]
pub struct KeyView {
    pub id: Uuid,
    pub name: String,
    pub key_type: String,
    pub public_key: String,
    pub fingerprint: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<&SshKey> for KeyView {
    fn from(key: &SshKey) -> Self {
        Self {
            id: key.id,
            name: key.name.clone(),
            key_type: key.key_type.clone(),
            public_key: key.public_key.clone(),
            fingerprint: key.fingerprint.clone(),
            created_at: key.created_at,
            updated_at: key.updated_at,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ForwardInput {
    pub host_id: Uuid,
    pub kind: ForwardKind,
    #[serde(default)]
    pub bind_address: String,
    pub bind_port: u16,
    #[serde(default)]
    pub target_host: String,
    pub target_port: u16,
    #[serde(default)]
    pub auto_start: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ForwardView {
    pub id: Uuid,
    pub host_id: Uuid,
    pub kind: ForwardKind,
    pub bind_address: String,
    pub bind_port: u16,
    pub target_host: String,
    pub target_port: u16,
    pub auto_start: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<&PortForward> for ForwardView {
    fn from(forward: &PortForward) -> Self {
        Self {
            id: forward.id,
            host_id: forward.host_id,
            kind: forward.kind,
            bind_address: forward.bind_address.clone(),
            bind_port: forward.bind_port,
            target_host: forward.target_host.clone(),
            target_port: forward.target_port,
            auto_start: forward.auto_start,
            created_at: forward.created_at,
            updated_at: forward.updated_at,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct KnownHostView {
    pub id: Uuid,
    pub address: String,
    pub port: u16,
    pub key_type: String,
    pub fingerprint: String,
    pub added_at: DateTime<Utc>,
}

impl From<&KnownHost> for KnownHostView {
    fn from(known: &KnownHost) -> Self {
        Self {
            id: known.id,
            address: known.address.clone(),
            port: known.port,
            key_type: known.key_type.clone(),
            fingerprint: known.fingerprint.clone(),
            added_at: known.added_at,
        }
    }
}
