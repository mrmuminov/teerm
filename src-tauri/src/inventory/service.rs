use chrono::Utc;
use ssh_key::{Algorithm, HashAlg, LineEnding, PrivateKey};
use uuid::Uuid;
use zeroize::Zeroize;

use crate::error::AppError;
use crate::vault::model::{
    Host, HostGroup, KnownHost, PortForward, SshKey, Tag, VaultPayload,
};

use super::dto::{
    ForwardInput, ForwardView, GroupInput, GroupView, HostInput, HostView, KeyGenerateInput,
    KeyImportInput, KeyRenameInput, KeyView, KnownHostView, TagInput, TagView,
};

const MAX_LABEL: usize = 120;
const MAX_ADDRESS: usize = 255;
const MAX_USERNAME: usize = 128;
const MAX_GROUP_NAME: usize = 64;
const MAX_TAG_NAME: usize = 32;
const MAX_KEY_NAME: usize = 120;
const MAX_HINT: usize = 255;

fn required(value: &str, field: &str, max: usize) -> Result<String, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput(format!("{field} is required")));
    }
    if trimmed.chars().count() > max {
        return Err(AppError::InvalidInput(format!(
            "{field} must be at most {max} characters"
        )));
    }
    Ok(trimmed.to_string())
}

fn validate_port(port: u16, field: &str) -> Result<(), AppError> {
    if port == 0 {
        return Err(AppError::InvalidInput(format!(
            "{field} must be between 1 and 65535"
        )));
    }
    Ok(())
}

fn no_whitespace(value: &str, field: &str) -> Result<(), AppError> {
    if value.chars().any(char::is_whitespace) {
        return Err(AppError::InvalidInput(format!(
            "{field} must not contain spaces"
        )));
    }
    Ok(())
}

fn host_label(label: &str, address: &str) -> String {
    let trimmed = label.trim();
    if trimmed.is_empty() {
        address.to_string()
    } else {
        trimmed.chars().take(MAX_LABEL).collect()
    }
}

fn find_host(payload: &VaultPayload, id: Uuid) -> Result<&Host, AppError> {
    payload
        .hosts
        .iter()
        .find(|host| host.id == id && host.deleted_at.is_none())
        .ok_or_else(|| AppError::NotFound("host".into()))
}

fn find_host_mut(payload: &mut VaultPayload, id: Uuid) -> Result<&mut Host, AppError> {
    payload
        .hosts
        .iter_mut()
        .find(|host| host.id == id && host.deleted_at.is_none())
        .ok_or_else(|| AppError::NotFound("host".into()))
}

fn find_group(payload: &VaultPayload, id: Uuid) -> Result<&HostGroup, AppError> {
    payload
        .groups
        .iter()
        .find(|group| group.id == id && group.deleted_at.is_none())
        .ok_or_else(|| AppError::NotFound("host group".into()))
}

fn require_group_ref(
    payload: &VaultPayload,
    group_id: Option<Uuid>,
) -> Result<Option<Uuid>, AppError> {
    match group_id {
        Some(id) => {
            find_group(payload, id)?;
            Ok(Some(id))
        }
        None => Ok(None),
    }
}

fn require_key_ref(payload: &VaultPayload, key_id: Option<Uuid>) -> Result<Option<Uuid>, AppError> {
    match key_id {
        Some(id) => {
            let exists = payload
                .keys
                .iter()
                .any(|key| key.id == id && key.deleted_at.is_none());
            if !exists {
                return Err(AppError::NotFound("key".into()));
            }
            Ok(Some(id))
        }
        None => Ok(None),
    }
}

fn normalize_tag_ids(payload: &VaultPayload, ids: &[Uuid]) -> Result<Vec<Uuid>, AppError> {
    let mut normalized = Vec::with_capacity(ids.len());
    for id in ids {
        let exists = payload
            .tags
            .iter()
            .any(|tag| tag.id == *id && tag.deleted_at.is_none());
        if !exists {
            return Err(AppError::NotFound("tag".into()));
        }
        if !normalized.contains(id) {
            normalized.push(*id);
        }
    }
    Ok(normalized)
}

fn validate_new_password(password: Option<&str>) -> Option<String> {
    password
        .map(str::trim)
        .filter(|password| !password.is_empty())
        .map(str::to_string)
}

pub fn list_hosts(payload: &VaultPayload) -> Vec<HostView> {
    payload
        .hosts
        .iter()
        .filter(|host| host.deleted_at.is_none())
        .map(HostView::from)
        .collect()
}

pub fn create_host(payload: &mut VaultPayload, input: HostInput) -> Result<HostView, AppError> {
    let address = required(&input.address, "address", MAX_ADDRESS)?;
    no_whitespace(&address, "address")?;
    let username = required(&input.username, "username", MAX_USERNAME)?;
    no_whitespace(&username, "username")?;
    validate_port(input.port, "port")?;

    let group_id = require_group_ref(payload, input.group_id)?;
    let key_id = require_key_ref(payload, input.key_id)?;
    let tag_ids = normalize_tag_ids(payload, &input.tag_ids)?;
    let now = Utc::now();

    let host = Host {
        id: Uuid::now_v7(),
        label: host_label(&input.label, &address),
        address,
        port: input.port,
        username,
        group_id,
        tag_ids,
        key_id,
        password: validate_new_password(input.password.as_deref()),
        jump_host_id: None,
        created_at: now,
        updated_at: now,
        deleted_at: None,
    };

    let view = HostView::from(&host);
    payload.hosts.push(host);
    Ok(view)
}

pub fn update_host(
    payload: &mut VaultPayload,
    id: Uuid,
    input: HostInput,
) -> Result<HostView, AppError> {
    let address = required(&input.address, "address", MAX_ADDRESS)?;
    no_whitespace(&address, "address")?;
    let username = required(&input.username, "username", MAX_USERNAME)?;
    no_whitespace(&username, "username")?;
    validate_port(input.port, "port")?;

    let group_id = require_group_ref(payload, input.group_id)?;
    let key_id = require_key_ref(payload, input.key_id)?;
    let tag_ids = normalize_tag_ids(payload, &input.tag_ids)?;
    let label = host_label(&input.label, &address);
    let now = Utc::now();

    let host = find_host_mut(payload, id)?;
    host.label = label;
    host.address = address;
    host.port = input.port;
    host.username = username;
    host.group_id = group_id;
    host.tag_ids = tag_ids;
    host.key_id = key_id;

    if input.clear_password {
        host.password = None;
    } else if let Some(password) = validate_new_password(input.password.as_deref()) {
        host.password = Some(password);
    }

    host.updated_at = now;
    Ok(HostView::from(&*host))
}

pub fn delete_host(payload: &mut VaultPayload, id: Uuid) -> Result<(), AppError> {
    let now = Utc::now();

    let host = find_host_mut(payload, id)?;
    host.deleted_at = Some(now);
    host.updated_at = now;
    host.password = None;
    host.tag_ids.clear();
    host.group_id = None;

    for forward in payload.port_forwards.iter_mut() {
        if forward.host_id == id && forward.deleted_at.is_none() {
            forward.deleted_at = Some(now);
            forward.updated_at = now;
        }
    }

    Ok(())
}

pub fn list_groups(payload: &VaultPayload) -> Vec<GroupView> {
    payload
        .groups
        .iter()
        .filter(|group| group.deleted_at.is_none())
        .map(GroupView::from)
        .collect()
}

fn ensure_unique_group_name(
    payload: &VaultPayload,
    name: &str,
    parent_id: Option<Uuid>,
    exclude: Option<Uuid>,
) -> Result<(), AppError> {
    let lower = name.to_lowercase();
    let duplicate = payload.groups.iter().any(|group| {
        group.deleted_at.is_none()
            && Some(group.id) != exclude
            && group.parent_id == parent_id
            && group.name.to_lowercase() == lower
    });

    if duplicate {
        return Err(AppError::InvalidInput(format!(
            "a group named \"{name}\" already exists at this level"
        )));
    }

    Ok(())
}

pub fn create_group(
    payload: &mut VaultPayload,
    input: GroupInput,
) -> Result<GroupView, AppError> {
    let name = required(&input.name, "group name", MAX_GROUP_NAME)?;
    let parent_id = require_group_ref(payload, input.parent_id)?;
    ensure_unique_group_name(payload, &name, parent_id, None)?;

    let now = Utc::now();
    let group = HostGroup {
        id: Uuid::now_v7(),
        name,
        parent_id,
        created_at: now,
        updated_at: now,
        deleted_at: None,
    };

    let view = GroupView::from(&group);
    payload.groups.push(group);
    Ok(view)
}

fn would_create_cycle(payload: &VaultPayload, group_id: Uuid, parent_id: Option<Uuid>) -> bool {
    let mut current = parent_id;
    let mut steps = 0;

    while let Some(id) = current {
        if id == group_id {
            return true;
        }
        current = payload
            .groups
            .iter()
            .find(|group| group.id == id && group.deleted_at.is_none())
            .and_then(|group| group.parent_id);
        steps += 1;
        if steps > 512 {
            return true;
        }
    }

    false
}

pub fn update_group(
    payload: &mut VaultPayload,
    id: Uuid,
    input: GroupInput,
) -> Result<GroupView, AppError> {
    let name = required(&input.name, "group name", MAX_GROUP_NAME)?;
    let parent_id = require_group_ref(payload, input.parent_id)?;

    if would_create_cycle(payload, id, parent_id) {
        return Err(AppError::InvalidInput(
            "a group cannot be its own parent or descendant".into(),
        ));
    }
    ensure_unique_group_name(payload, &name, parent_id, Some(id))?;

    let now = Utc::now();
    let group = payload
        .groups
        .iter_mut()
        .find(|group| group.id == id && group.deleted_at.is_none())
        .ok_or_else(|| AppError::NotFound("host group".into()))?;

    group.name = name;
    group.parent_id = parent_id;
    group.updated_at = now;

    Ok(GroupView::from(&*group))
}

pub fn delete_group(payload: &mut VaultPayload, id: Uuid) -> Result<(), AppError> {
    let parent_id = find_group(payload, id)?.parent_id;
    let now = Utc::now();

    for group in payload.groups.iter_mut() {
        if group.deleted_at.is_none() && group.parent_id == Some(id) {
            group.parent_id = parent_id;
            group.updated_at = now;
        }
    }

    for host in payload.hosts.iter_mut() {
        if host.deleted_at.is_none() && host.group_id == Some(id) {
            host.group_id = parent_id;
            host.updated_at = now;
        }
    }

    let group = payload
        .groups
        .iter_mut()
        .find(|group| group.id == id && group.deleted_at.is_none())
        .ok_or_else(|| AppError::NotFound("host group".into()))?;
    group.deleted_at = Some(now);
    group.updated_at = now;

    Ok(())
}

pub fn list_tags(payload: &VaultPayload) -> Vec<TagView> {
    payload
        .tags
        .iter()
        .filter(|tag| tag.deleted_at.is_none())
        .map(|tag| {
            let host_count = payload
                .hosts
                .iter()
                .filter(|host| {
                    host.deleted_at.is_none() && host.tag_ids.contains(&tag.id)
                })
                .count();
            TagView::from_tag(tag, host_count)
        })
        .collect()
}

fn normalize_color(color: Option<String>) -> Result<Option<String>, AppError> {
    let Some(value) = color else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }

    let hex = value.strip_prefix('#').unwrap_or(value);
    if hex.len() != 6 || !hex.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err(AppError::InvalidInput(
            "tag color must be a hex value like #7ee2a8".into(),
        ));
    }

    Ok(Some(format!("#{}", hex.to_ascii_lowercase())))
}

fn ensure_unique_tag_name(
    payload: &VaultPayload,
    name: &str,
    exclude: Option<Uuid>,
) -> Result<(), AppError> {
    let lower = name.to_lowercase();
    let duplicate = payload.tags.iter().any(|tag| {
        tag.deleted_at.is_none()
            && Some(tag.id) != exclude
            && tag.name.to_lowercase() == lower
    });

    if duplicate {
        return Err(AppError::InvalidInput(format!(
            "a tag named \"{name}\" already exists"
        )));
    }

    Ok(())
}

pub fn create_tag(payload: &mut VaultPayload, input: TagInput) -> Result<TagView, AppError> {
    let name = required(&input.name, "tag name", MAX_TAG_NAME)?;
    let color = normalize_color(input.color)?;
    ensure_unique_tag_name(payload, &name, None)?;

    let now = Utc::now();
    let tag = Tag {
        id: Uuid::now_v7(),
        name,
        color,
        created_at: now,
        updated_at: now,
        deleted_at: None,
    };

    let view = TagView::from_tag(&tag, 0);
    payload.tags.push(tag);
    Ok(view)
}

pub fn update_tag(
    payload: &mut VaultPayload,
    id: Uuid,
    input: TagInput,
) -> Result<TagView, AppError> {
    let name = required(&input.name, "tag name", MAX_TAG_NAME)?;
    let color = normalize_color(input.color)?;
    ensure_unique_tag_name(payload, &name, Some(id))?;
    let now = Utc::now();

    let tag = payload
        .tags
        .iter_mut()
        .find(|tag| tag.id == id && tag.deleted_at.is_none())
        .ok_or_else(|| AppError::NotFound("tag".into()))?;

    tag.name = name;
    tag.color = color;
    tag.updated_at = now;

    let host_count = payload
        .hosts
        .iter()
        .filter(|host| host.deleted_at.is_none() && host.tag_ids.contains(&id))
        .count();

    Ok(TagView::from_tag(&*tag, host_count))
}

pub fn delete_tag(payload: &mut VaultPayload, id: Uuid) -> Result<(), AppError> {
    let now = Utc::now();

    for host in payload.hosts.iter_mut() {
        if host.deleted_at.is_none() && host.tag_ids.contains(&id) {
            host.tag_ids.retain(|tag_id| *tag_id != id);
            host.updated_at = now;
        }
    }

    let tag = payload
        .tags
        .iter_mut()
        .find(|tag| tag.id == id && tag.deleted_at.is_none())
        .ok_or_else(|| AppError::NotFound("tag".into()))?;
    tag.deleted_at = Some(now);
    tag.updated_at = now;

    Ok(())
}

pub fn list_keys(payload: &VaultPayload) -> Vec<KeyView> {
    payload
        .keys
        .iter()
        .filter(|key| key.deleted_at.is_none())
        .map(KeyView::from)
        .collect()
}

fn key_material(private_key: &PrivateKey) -> Result<(String, String, String), AppError> {
    let key_type = private_key.algorithm().as_str().to_string();
    let public_key = private_key
        .public_key()
        .to_openssh()
        .map_err(|error| AppError::InvalidInput(format!("could not encode public key: {error}")))?;
    let fingerprint = private_key.fingerprint(HashAlg::Sha256).to_string();
    Ok((key_type, public_key, fingerprint))
}

fn store_key(
    payload: &mut VaultPayload,
    name: String,
    private_key: ssh_key::PrivateKey,
) -> Result<KeyView, AppError> {
    let (key_type, public_key, fingerprint) = key_material(&private_key)?;

    if payload
        .keys
        .iter()
        .any(|key| key.deleted_at.is_none() && key.fingerprint == fingerprint)
    {
        return Err(AppError::InvalidInput(
            "this key is already in the Keychain".into(),
        ));
    }

    let secret = private_key
        .to_openssh(LineEnding::LF)
        .map_err(|error| AppError::InvalidInput(format!("could not encode private key: {error}")))?
        .to_string();

    let now = Utc::now();
    let key = SshKey {
        id: Uuid::now_v7(),
        name,
        key_type,
        public_key,
        private_key: secret,
        passphrase: None,
        fingerprint,
        created_at: now,
        updated_at: now,
        deleted_at: None,
    };

    let view = KeyView::from(&key);
    payload.keys.push(key);
    Ok(view)
}

pub fn import_key(payload: &mut VaultPayload, input: KeyImportInput) -> Result<KeyView, AppError> {
    let name = required(&input.name, "key name", MAX_KEY_NAME)?;
    let mut private_key = PrivateKey::from_openssh(input.private_key.trim())
        .map_err(|error| AppError::InvalidInput(format!("invalid OpenSSH private key: {error}")))?;

    if private_key.is_encrypted() {
        let passphrase = input.passphrase.as_deref().unwrap_or("");
        if passphrase.is_empty() {
            return Err(AppError::InvalidInput(
                "this key is encrypted; a passphrase is required".into(),
            ));
        }
        private_key = private_key.decrypt(passphrase.as_bytes()).map_err(|_| {
            AppError::InvalidInput("could not decrypt the key: wrong passphrase".into())
        })?;
    }

    if !matches!(
        private_key.algorithm(),
        Algorithm::Ed25519 | Algorithm::Rsa { .. } | Algorithm::Ecdsa { .. }
    ) {
        return Err(AppError::InvalidInput(
            "only ed25519, RSA, and ECDSA keys are supported".into(),
        ));
    }

    store_key(payload, name, private_key)
}

pub fn generate_key(
    payload: &mut VaultPayload,
    input: KeyGenerateInput,
) -> Result<KeyView, AppError> {
    let name = required(&input.name, "key name", MAX_KEY_NAME)?;
    let mut rng = ssh_key::rand_core::OsRng;
    let private_key = PrivateKey::random(&mut rng, Algorithm::Ed25519)
        .map_err(|error| AppError::Crypto(format!("could not generate key: {error}")))?;
    store_key(payload, name, private_key)
}

pub fn rename_key(
    payload: &mut VaultPayload,
    id: Uuid,
    input: KeyRenameInput,
) -> Result<KeyView, AppError> {
    let name = required(&input.name, "key name", MAX_KEY_NAME)?;
    let now = Utc::now();

    let key = payload
        .keys
        .iter_mut()
        .find(|key| key.id == id && key.deleted_at.is_none())
        .ok_or_else(|| AppError::NotFound("key".into()))?;

    key.name = name;
    key.updated_at = now;
    Ok(KeyView::from(&*key))
}

pub fn delete_key(payload: &mut VaultPayload, id: Uuid) -> Result<(), AppError> {
    let users: Vec<String> = payload
        .hosts
        .iter()
        .filter(|host| host.deleted_at.is_none() && host.key_id == Some(id))
        .map(|host| host.label.clone())
        .collect();

    if !users.is_empty() {
        let list = users.join(", ");
        return Err(AppError::InvalidInput(format!(
            "this key is used by {} host(s): {list}",
            users.len()
        )));
    }

    let now = Utc::now();
    let key = payload
        .keys
        .iter_mut()
        .find(|key| key.id == id && key.deleted_at.is_none())
        .ok_or_else(|| AppError::NotFound("key".into()))?;

    key.deleted_at = Some(now);
    key.updated_at = now;
    key.private_key.zeroize();
    key.passphrase = None;

    Ok(())
}

fn validate_forward(
    payload: &VaultPayload,
    input: &ForwardInput,
    exclude: Option<Uuid>,
) -> Result<(String, String), AppError> {
    find_host(payload, input.host_id)?;
    validate_port(input.bind_port, "bind port")?;
    validate_port(input.target_port, "target port")?;

    let bind_address = {
        let trimmed = input.bind_address.trim();
        if trimmed.is_empty() {
            "127.0.0.1".to_string()
        } else {
            required(trimmed, "bind address", MAX_ADDRESS)?
        }
    };
    no_whitespace(&bind_address, "bind address")?;

    let target_host = required(&input.target_host, "target host", MAX_HINT)?;
    no_whitespace(&target_host, "target host")?;

    let duplicate = payload.port_forwards.iter().any(|forward| {
        forward.deleted_at.is_none()
            && Some(forward.id) != exclude
            && forward.host_id == input.host_id
            && forward.kind == input.kind
            && forward.bind_address == bind_address
            && forward.bind_port == input.bind_port
    });

    if duplicate {
        return Err(AppError::InvalidInput(format!(
            "a rule already listens on {bind_address}:{} for this host",
            input.bind_port
        )));
    }

    Ok((bind_address, target_host))
}

pub fn list_forwards(payload: &VaultPayload, host_id: Uuid) -> Result<Vec<ForwardView>, AppError> {
    find_host(payload, host_id)?;
    Ok(payload
        .port_forwards
        .iter()
        .filter(|forward| forward.host_id == host_id && forward.deleted_at.is_none())
        .map(ForwardView::from)
        .collect())
}

pub fn create_forward(
    payload: &mut VaultPayload,
    input: ForwardInput,
) -> Result<ForwardView, AppError> {
    let (bind_address, target_host) = validate_forward(payload, &input, None)?;
    let now = Utc::now();

    let forward = PortForward {
        id: Uuid::now_v7(),
        host_id: input.host_id,
        kind: input.kind,
        bind_address,
        bind_port: input.bind_port,
        target_host,
        target_port: input.target_port,
        auto_start: input.auto_start,
        created_at: now,
        updated_at: now,
        deleted_at: None,
    };

    let view = ForwardView::from(&forward);
    payload.port_forwards.push(forward);
    Ok(view)
}

pub fn update_forward(
    payload: &mut VaultPayload,
    id: Uuid,
    input: ForwardInput,
) -> Result<ForwardView, AppError> {
    let (bind_address, target_host) = validate_forward(payload, &input, Some(id))?;
    let now = Utc::now();

    let forward = payload
        .port_forwards
        .iter_mut()
        .find(|forward| forward.id == id && forward.deleted_at.is_none())
        .ok_or_else(|| AppError::NotFound("port forward".into()))?;

    forward.host_id = input.host_id;
    forward.kind = input.kind;
    forward.bind_address = bind_address;
    forward.bind_port = input.bind_port;
    forward.target_host = target_host;
    forward.target_port = input.target_port;
    forward.auto_start = input.auto_start;
    forward.updated_at = now;

    Ok(ForwardView::from(&*forward))
}

pub fn delete_forward(payload: &mut VaultPayload, id: Uuid) -> Result<(), AppError> {
    let now = Utc::now();
    let forward = payload
        .port_forwards
        .iter_mut()
        .find(|forward| forward.id == id && forward.deleted_at.is_none())
        .ok_or_else(|| AppError::NotFound("port forward".into()))?;

    forward.deleted_at = Some(now);
    forward.updated_at = now;
    Ok(())
}

pub fn list_known_hosts(payload: &VaultPayload) -> Vec<KnownHostView> {
    payload
        .known_hosts
        .iter()
        .filter(|known| known.deleted_at.is_none())
        .map(KnownHostView::from)
        .collect()
}

pub fn delete_known_host(payload: &mut VaultPayload, id: Uuid) -> Result<(), AppError> {
    let known = payload
        .known_hosts
        .iter_mut()
        .find(|known| known.id == id && known.deleted_at.is_none())
        .ok_or_else(|| AppError::NotFound("known host".into()))?;

    known.deleted_at = Some(Utc::now());
    Ok(())
}

/// Records a trusted server key. Used by the SSH TOFU flow.
pub fn upsert_known_host(
    payload: &mut VaultPayload,
    address: &str,
    port: u16,
    key_type: &str,
    public_key: &str,
    fingerprint: &str,
) -> KnownHostView {
    let now = Utc::now();

    if let Some(known) = payload.known_hosts.iter_mut().find(|known| {
        known.deleted_at.is_none()
            && known.address == address
            && known.port == port
            && known.key_type == key_type
    }) {
        known.public_key = public_key.to_string();
        known.fingerprint = fingerprint.to_string();
        known.added_at = now;
        return KnownHostView::from(&*known);
    }

    let known = KnownHost {
        id: Uuid::now_v7(),
        address: address.to_string(),
        port,
        key_type: key_type.to_string(),
        public_key: public_key.to_string(),
        fingerprint: fingerprint.to_string(),
        added_at: now,
        deleted_at: None,
    };

    let view = KnownHostView::from(&known);
    payload.known_hosts.push(known);
    view
}

#[allow(dead_code)]
pub fn known_host_by_address<'a>(
    payload: &'a VaultPayload,
    address: &str,
    port: u16,
    key_type: &str,
) -> Option<&'a KnownHost> {
    payload.known_hosts.iter().find(|known| {
        known.deleted_at.is_none()
            && known.address == address
            && known.port == port
            && known.key_type == key_type
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::model::ForwardKind;

    fn payload() -> VaultPayload {
        VaultPayload::new()
    }

    fn host_input(address: &str) -> HostInput {
        HostInput {
            label: String::new(),
            address: address.into(),
            port: 22,
            username: "root".into(),
            ..HostInput::default()
        }
    }

    #[test]
    fn creates_and_lists_hosts() {
        let mut payload = payload();
        let view = create_host(&mut payload, host_input("example.com")).unwrap();

        assert_eq!(view.label, "example.com");
        assert_eq!(view.port, 22);
        assert!(!view.has_password);
        assert_eq!(list_hosts(&payload).len(), 1);
    }

    #[test]
    fn host_password_is_write_only_and_kept_on_update() {
        let mut payload = payload();
        let mut input = host_input("example.com");
        input.password = Some("secret".into());
        let created = create_host(&mut payload, input).unwrap();
        assert!(created.has_password);

        let mut update = host_input("example.com");
        update.label = "Web".into();
        let updated = update_host(&mut payload, created.id, update).unwrap();
        assert!(updated.has_password);

        let mut clear = host_input("example.com");
        clear.clear_password = true;
        let cleared = update_host(&mut payload, created.id, clear).unwrap();
        assert!(!cleared.has_password);
    }

    #[test]
    fn host_validation_rejects_empty_address_and_port_zero() {
        let mut payload = payload();
        assert!(create_host(&mut payload, host_input("  ")).is_err());

        let mut input = host_input("example.com");
        input.port = 0;
        assert!(create_host(&mut payload, input).is_err());
    }

    #[test]
    fn deleting_a_host_cascades_forwards_and_tags() {
        let mut payload = payload();
        let tag = create_tag(
            &mut payload,
            TagInput {
                name: "prod".into(),
                color: None,
            },
        )
        .unwrap();
        let mut input = host_input("example.com");
        input.tag_ids = vec![tag.id];
        let host = create_host(&mut payload, input).unwrap();

        create_forward(
            &mut payload,
            ForwardInput {
                host_id: host.id,
                kind: ForwardKind::Local,
                bind_address: "127.0.0.1".into(),
                bind_port: 8080,
                target_host: "db.internal".into(),
                target_port: 5432,
                auto_start: true,
            },
        )
        .unwrap();

        delete_host(&mut payload, host.id).unwrap();

        assert!(list_hosts(&payload).is_empty());
        assert!(list_forwards(&payload, host.id).is_err());
        assert_eq!(list_tags(&payload)[0].host_count, 0);
        assert_eq!(
            payload
                .port_forwards
                .iter()
                .filter(|forward| forward.deleted_at.is_none())
                .count(),
            0
        );
    }

    #[test]
    fn deleting_a_group_reparents_children_and_hosts() {
        let mut payload = payload();
        let parent = create_group(
            &mut payload,
            GroupInput {
                name: "Prod".into(),
                parent_id: None,
            },
        )
        .unwrap();
        let child = create_group(
            &mut payload,
            GroupInput {
                name: "EU".into(),
                parent_id: Some(parent.id),
            },
        )
        .unwrap();
        let mut input = host_input("example.com");
        input.group_id = Some(child.id);
        let host = create_host(&mut payload, input).unwrap();

        delete_group(&mut payload, child.id).unwrap();

        let groups = list_groups(&payload);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].id, parent.id);
        assert_eq!(list_hosts(&payload)[0].group_id, Some(parent.id));

        delete_group(&mut payload, parent.id).unwrap();
        assert_eq!(list_hosts(&payload)[0].group_id, None);
        let _ = host;
    }

    #[test]
    fn groups_reject_duplicate_siblings_and_cycles() {
        let mut payload = payload();
        let a = create_group(
            &mut payload,
            GroupInput {
                name: "A".into(),
                parent_id: None,
            },
        )
        .unwrap();
        let b = create_group(
            &mut payload,
            GroupInput {
                name: "B".into(),
                parent_id: Some(a.id),
            },
        )
        .unwrap();

        assert!(
            create_group(
                &mut payload,
                GroupInput {
                    name: "a".into(),
                    parent_id: None,
                },
            )
            .is_err()
        );

        assert!(
            update_group(
                &mut payload,
                a.id,
                GroupInput {
                    name: "A".into(),
                    parent_id: Some(b.id),
                },
            )
            .is_err()
        );
    }

    #[test]
    fn tag_delete_removes_references() {
        let mut payload = payload();
        let tag = create_tag(
            &mut payload,
            TagInput {
                name: "prod".into(),
                color: Some("#7EE2A8".into()),
            },
        )
        .unwrap();
        assert_eq!(tag.color.as_deref(), Some("#7ee2a8"));

        let mut input = host_input("example.com");
        input.tag_ids = vec![tag.id];
        let host = create_host(&mut payload, input).unwrap();

        delete_tag(&mut payload, tag.id).unwrap();
        assert!(list_tags(&payload).is_empty());
        assert_eq!(
            payload
                .hosts
                .iter()
                .find(|candidate| candidate.id == host.id)
                .unwrap()
                .tag_ids
                .len(),
            0
        );
    }

    #[test]
    fn imports_and_generates_keys() {
        let mut payload = payload();
        let mut rng = ssh_key::rand_core::OsRng;
        let source = PrivateKey::random(&mut rng, Algorithm::Ed25519).unwrap();
        let openssh = source.to_openssh(LineEnding::LF).unwrap().to_string();

        let imported = import_key(
            &mut payload,
            KeyImportInput {
                name: "laptop".into(),
                private_key: openssh,
                passphrase: None,
            },
        )
        .unwrap();
        assert_eq!(imported.key_type, "ssh-ed25519");
        assert!(imported.fingerprint.starts_with("SHA256:"));

        assert!(
            import_key(
                &mut payload,
                KeyImportInput {
                    name: "duplicate".into(),
                    private_key: source.to_openssh(LineEnding::LF).unwrap().to_string(),
                    passphrase: None,
                },
            )
            .is_err()
        );

        let generated = generate_key(
            &mut payload,
            KeyGenerateInput {
                name: "new".into(),
            },
        )
        .unwrap();
        assert_eq!(generated.key_type, "ssh-ed25519");
        assert_eq!(list_keys(&payload).len(), 2);
    }

    #[test]
    fn deleting_a_key_in_use_is_blocked() {
        let mut payload = payload();
        let key = generate_key(
            &mut payload,
            KeyGenerateInput {
                name: "new".into(),
            },
        )
        .unwrap();
        let mut input = host_input("example.com");
        input.key_id = Some(key.id);
        create_host(&mut payload, input).unwrap();

        assert!(delete_key(&mut payload, key.id).is_err());

        payload.hosts.clear();
        delete_key(&mut payload, key.id).unwrap();
        assert!(list_keys(&payload).is_empty());
    }

    #[test]
    fn forwards_reject_duplicate_listeners() {
        let mut payload = payload();
        let host = create_host(&mut payload, host_input("example.com")).unwrap();
        let input = ForwardInput {
            host_id: host.id,
            kind: ForwardKind::Local,
            bind_address: "127.0.0.1".into(),
            bind_port: 8080,
            target_host: "db.internal".into(),
            target_port: 5432,
            auto_start: false,
        };

        create_forward(&mut payload, input.clone()).unwrap();
        assert!(create_forward(&mut payload, input).is_err());
    }

    #[test]
    fn known_hosts_are_listed_and_removed() {
        let mut payload = payload();
        let known = upsert_known_host(
            &mut payload,
            "example.com",
            22,
            "ssh-ed25519",
            "AAAA",
            "SHA256:abc",
        );
        assert_eq!(list_known_hosts(&payload).len(), 1);

        delete_known_host(&mut payload, known.id).unwrap();
        assert!(list_known_hosts(&payload).is_empty());
    }
}
