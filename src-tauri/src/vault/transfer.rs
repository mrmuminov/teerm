//! Vault Export and Import: encrypted full exports, plain metadata-only
//! exports, and merging an incoming data set into the current Vault.

use std::collections::HashMap;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;

use super::crypto::{self, VaultEnvelope, VAULT_FORMAT};
use super::manager::validate_master_password;
use super::model::{KnownHost, VaultPayload, SCHEMA_VERSION};

pub const METADATA_FORMAT: &str = "teerm-export-metadata";
const METADATA_VERSION: u32 = 1;
const IMPORTED_SUFFIX: &str = " (imported)";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportMode {
    Full,
    Metadata,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportMode {
    Merge,
    Replace,
}

#[derive(Serialize, Deserialize)]
struct MetadataExport {
    format: String,
    version: u32,
    public_only: bool,
    payload: VaultPayload,
}

/// A parsed export file whose contents are not yet decrypted.
pub enum ExportFile {
    Full(VaultEnvelope),
    Metadata(VaultPayload),
}

/// The decrypted contents of an export, ready to preview or apply.
pub struct Incoming {
    pub payload: VaultPayload,
    pub includes_secrets: bool,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct EntityCounts {
    pub hosts: usize,
    pub groups: usize,
    pub tags: usize,
    pub keys: usize,
    pub port_forwards: usize,
    pub known_hosts: usize,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct MergeOutcome {
    pub added: EntityCounts,
    pub skipped: EntityCounts,
    pub duplicated: EntityCounts,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportPreview {
    pub includes_secrets: bool,
    pub can_replace: bool,
    pub incoming: EntityCounts,
    pub merge: MergeOutcome,
}

fn live_only(mut payload: VaultPayload) -> VaultPayload {
    payload.hosts.retain(|item| item.deleted_at.is_none());
    payload.groups.retain(|item| item.deleted_at.is_none());
    payload.tags.retain(|item| item.deleted_at.is_none());
    payload.keys.retain(|item| item.deleted_at.is_none());
    payload.port_forwards.retain(|item| item.deleted_at.is_none());
    payload.known_hosts.retain(|item| item.deleted_at.is_none());
    payload
}

/// Removes every Secret in place, leaving public material and structure.
fn without_secrets(payload: &mut VaultPayload) {
    for host in &mut payload.hosts {
        host.password = None;
    }
    for key in &mut payload.keys {
        key.private_key = String::new();
        key.passphrase = None;
    }
}

pub fn counts(payload: &VaultPayload) -> EntityCounts {
    EntityCounts {
        hosts: payload.hosts.len(),
        groups: payload.groups.len(),
        tags: payload.tags.len(),
        keys: payload.keys.len(),
        port_forwards: payload.port_forwards.len(),
        known_hosts: payload.known_hosts.len(),
    }
}

/// Serializes a Full Export: the same envelope as the Vault file, protected
/// by a user-supplied passphrase and including every Secret.
pub fn export_full(payload: &VaultPayload, passphrase: &str) -> Result<Vec<u8>, AppError> {
    validate_master_password(passphrase)
        .map_err(|_| AppError::InvalidInput("the export passphrase must be at least 10 characters".into()))?;

    let plaintext = serde_json::to_vec(&live_only(payload.clone()))?;
    let envelope = crypto::encrypt_with_password(&plaintext, passphrase)?;
    Ok(serde_json::to_vec_pretty(&envelope)?)
}

/// Serializes a Metadata-only Export: plain JSON with every Secret removed.
pub fn export_metadata(payload: &VaultPayload) -> Result<Vec<u8>, AppError> {
    let mut stripped = live_only(payload.clone());
    without_secrets(&mut stripped);

    Ok(serde_json::to_vec_pretty(&MetadataExport {
        format: METADATA_FORMAT.into(),
        version: METADATA_VERSION,
        public_only: true,
        payload: stripped,
    })?)
}

pub fn parse_export(bytes: &[u8]) -> Result<ExportFile, AppError> {
    let value: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|_| AppError::InvalidInput("this is not a Teerm export file".into()))?;

    match value.get("format").and_then(|format| format.as_str()) {
        Some(VAULT_FORMAT) => Ok(ExportFile::Full(serde_json::from_value(value)?)),
        Some(METADATA_FORMAT) => {
            let export: MetadataExport = serde_json::from_value(value)?;
            if export.version != METADATA_VERSION {
                return Err(AppError::UnsupportedVersion(export.version));
            }
            Ok(ExportFile::Metadata(export.payload))
        }
        _ => Err(AppError::InvalidInput(
            "this is not a Teerm export file".into(),
        )),
    }
}

impl ExportFile {
    pub fn needs_passphrase(&self) -> bool {
        matches!(self, ExportFile::Full(_))
    }

    pub fn open(self, passphrase: Option<&str>) -> Result<Incoming, AppError> {
        let (payload, includes_secrets) = match self {
            ExportFile::Metadata(payload) => (payload, false),
            ExportFile::Full(envelope) => {
                let passphrase = passphrase
                    .filter(|value| !value.is_empty())
                    .ok_or(AppError::PassphraseRequired)?;
                let (plaintext, _) = crypto::decrypt(&envelope, passphrase)?;
                (serde_json::from_slice(&plaintext[..])?, true)
            }
        };

        if payload.schema_version > SCHEMA_VERSION {
            return Err(AppError::UnsupportedVersion(payload.schema_version));
        }

        Ok(Incoming {
            payload: live_only(payload),
            includes_secrets,
        })
    }
}

enum RowOutcome {
    Add,
    Skip,
    Duplicate,
}

/// Decides, per incoming row, whether it is new, identical to an existing
/// row with the same id, or in conflict with one. Conflicting rows get a
/// fresh id recorded in `remap`.
fn classify<T: Serialize>(
    existing: &[T],
    incoming: &[T],
    id: fn(&T) -> Uuid,
    remap: &mut HashMap<Uuid, Uuid>,
) -> Vec<RowOutcome> {
    incoming
        .iter()
        .map(|row| {
            let Some(current) = existing.iter().find(|current| id(current) == id(row)) else {
                return RowOutcome::Add;
            };
            if serde_json::to_value(current).ok() == serde_json::to_value(row).ok() {
                RowOutcome::Skip
            } else {
                remap.insert(id(row), Uuid::now_v7());
                RowOutcome::Duplicate
            }
        })
        .collect()
}

/// A Known Host is identified by where it lives and which kind of key it
/// holds, so the same endpoint is never added twice. An existing entry always
/// wins: an incoming key that disagrees with it is not silently trusted.
fn classify_known_hosts(
    existing: &[KnownHost],
    incoming: &[KnownHost],
    remap: &mut HashMap<Uuid, Uuid>,
) -> Vec<RowOutcome> {
    incoming
        .iter()
        .map(|row| {
            let same_endpoint = existing.iter().any(|current| {
                current.address == row.address
                    && current.port == row.port
                    && current.key_type == row.key_type
            });
            if same_endpoint {
                RowOutcome::Skip
            } else if existing.iter().any(|current| current.id == row.id) {
                remap.insert(row.id, Uuid::now_v7());
                RowOutcome::Duplicate
            } else {
                RowOutcome::Add
            }
        })
        .collect()
}

fn tally(outcomes: &[RowOutcome]) -> (usize, usize, usize) {
    outcomes.iter().fold((0, 0, 0), |(add, skip, dup), outcome| match outcome {
        RowOutcome::Add => (add + 1, skip, dup),
        RowOutcome::Skip => (add, skip + 1, dup),
        RowOutcome::Duplicate => (add, skip, dup + 1),
    })
}

fn mapped(remap: &HashMap<Uuid, Uuid>, id: Uuid) -> Uuid {
    remap.get(&id).copied().unwrap_or(id)
}

fn relabel(label: &str) -> String {
    format!("{label}{IMPORTED_SUFFIX}")
}

/// Merges `incoming` into `current` by UUID. Identical rows are skipped;
/// conflicting rows are kept both, the incoming one under a new UUID and an
/// " (imported)" label, with references remapped.
///
/// `compare_secrets` is false for a Metadata-only Export: its rows have no
/// Secrets, so they are compared against the existing rows without theirs.
/// Otherwise every Host and Key would look edited and be duplicated.
pub fn merge(
    current: &mut VaultPayload,
    incoming: &VaultPayload,
    compare_secrets: bool,
) -> MergeOutcome {
    let public_view = (!compare_secrets).then(|| {
        let mut view = current.clone();
        without_secrets(&mut view);
        view
    });
    let existing = public_view.as_ref().unwrap_or(current);

    let mut remap = HashMap::new();
    let groups = classify(&current.groups, &incoming.groups, |row| row.id, &mut remap);
    let tags = classify(&current.tags, &incoming.tags, |row| row.id, &mut remap);
    let keys = classify(&existing.keys, &incoming.keys, |row| row.id, &mut remap);
    let hosts = classify(&existing.hosts, &incoming.hosts, |row| row.id, &mut remap);
    let forwards = classify(
        &current.port_forwards,
        &incoming.port_forwards,
        |row| row.id,
        &mut remap,
    );
    let known_hosts =
        classify_known_hosts(&current.known_hosts, &incoming.known_hosts, &mut remap);

    for (row, outcome) in incoming.groups.iter().zip(&groups) {
        let mut row = row.clone();
        match outcome {
            RowOutcome::Skip => continue,
            RowOutcome::Duplicate => {
                row.id = mapped(&remap, row.id);
                row.name = relabel(&row.name);
            }
            RowOutcome::Add => {}
        }
        row.parent_id = row.parent_id.map(|parent| mapped(&remap, parent));
        current.groups.push(row);
    }

    for (row, outcome) in incoming.tags.iter().zip(&tags) {
        let mut row = row.clone();
        match outcome {
            RowOutcome::Skip => continue,
            RowOutcome::Duplicate => {
                row.id = mapped(&remap, row.id);
                row.name = relabel(&row.name);
            }
            RowOutcome::Add => {}
        }
        current.tags.push(row);
    }

    for (row, outcome) in incoming.keys.iter().zip(&keys) {
        let mut row = row.clone();
        match outcome {
            RowOutcome::Skip => continue,
            RowOutcome::Duplicate => {
                row.id = mapped(&remap, row.id);
                row.name = relabel(&row.name);
            }
            RowOutcome::Add => {}
        }
        current.keys.push(row);
    }

    for (row, outcome) in incoming.hosts.iter().zip(&hosts) {
        let mut row = row.clone();
        match outcome {
            RowOutcome::Skip => continue,
            RowOutcome::Duplicate => {
                row.id = mapped(&remap, row.id);
                row.label = relabel(&row.label);
            }
            RowOutcome::Add => {}
        }
        row.group_id = row.group_id.map(|group| mapped(&remap, group));
        row.key_id = row.key_id.map(|key| mapped(&remap, key));
        row.jump_host_id = row.jump_host_id.map(|jump| mapped(&remap, jump));
        row.tag_ids = row.tag_ids.iter().map(|tag| mapped(&remap, *tag)).collect();
        current.hosts.push(row);
    }

    for (row, outcome) in incoming.port_forwards.iter().zip(&forwards) {
        let mut row = row.clone();
        match outcome {
            RowOutcome::Skip => continue,
            RowOutcome::Duplicate => row.id = mapped(&remap, row.id),
            RowOutcome::Add => {}
        }
        row.host_id = mapped(&remap, row.host_id);
        current.port_forwards.push(row);
    }

    for (row, outcome) in incoming.known_hosts.iter().zip(&known_hosts) {
        let mut row = row.clone();
        match outcome {
            RowOutcome::Skip => continue,
            RowOutcome::Duplicate => row.id = mapped(&remap, row.id),
            RowOutcome::Add => {}
        }
        current.known_hosts.push(row);
    }

    let outcome = |select: fn((usize, usize, usize)) -> usize| MergeOutcome {
        added: EntityCounts {
            hosts: select(tally(&hosts)),
            groups: select(tally(&groups)),
            tags: select(tally(&tags)),
            keys: select(tally(&keys)),
            port_forwards: select(tally(&forwards)),
            known_hosts: select(tally(&known_hosts)),
        },
        ..Default::default()
    };
    let added = outcome(|(add, _, _)| add).added;
    let skipped = outcome(|(_, skip, _)| skip).added;
    let duplicated = outcome(|(_, _, dup)| dup).added;

    MergeOutcome {
        added,
        skipped,
        duplicated,
    }
}

/// Replaces every collection of `current` with the incoming ones. The Vault
/// keeps its own identity and revision history.
pub fn replace(current: &mut VaultPayload, incoming: VaultPayload) {
    let mut incoming = incoming;
    current.hosts = std::mem::take(&mut incoming.hosts);
    current.groups = std::mem::take(&mut incoming.groups);
    current.tags = std::mem::take(&mut incoming.tags);
    current.keys = std::mem::take(&mut incoming.keys);
    current.port_forwards = std::mem::take(&mut incoming.port_forwards);
    current.known_hosts = std::mem::take(&mut incoming.known_hosts);
    current.updated_at = Utc::now();
}

pub fn preview(current: &VaultPayload, incoming: &Incoming) -> ImportPreview {
    let mut scratch = current.clone();
    ImportPreview {
        includes_secrets: incoming.includes_secrets,
        can_replace: incoming.includes_secrets,
        incoming: counts(&incoming.payload),
        merge: merge(&mut scratch, &incoming.payload, incoming.includes_secrets),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::model::{Host, HostGroup, PortForward, SshKey, ForwardKind};

    fn host(label: &str) -> Host {
        let now = Utc::now();
        Host {
            id: Uuid::now_v7(),
            label: label.into(),
            address: "example.com".into(),
            port: 22,
            username: "root".into(),
            group_id: None,
            tag_ids: vec![],
            key_id: None,
            password: Some("hunter2-secret".into()),
            jump_host_id: None,
            created_at: now,
            updated_at: now,
            deleted_at: None,
        }
    }

    fn group(name: &str) -> HostGroup {
        let now = Utc::now();
        HostGroup {
            id: Uuid::now_v7(),
            name: name.into(),
            parent_id: None,
            created_at: now,
            updated_at: now,
            deleted_at: None,
        }
    }

    fn key(name: &str) -> SshKey {
        let now = Utc::now();
        SshKey {
            id: Uuid::now_v7(),
            name: name.into(),
            key_type: "ssh-ed25519".into(),
            public_key: "ssh-ed25519 AAAA".into(),
            private_key: "PRIVATE-KEY-MATERIAL".into(),
            passphrase: Some("key-passphrase".into()),
            fingerprint: "SHA256:abc".into(),
            created_at: now,
            updated_at: now,
            deleted_at: None,
        }
    }

    fn forward(host_id: Uuid) -> PortForward {
        let now = Utc::now();
        PortForward {
            id: Uuid::now_v7(),
            host_id,
            kind: ForwardKind::Local,
            bind_address: "127.0.0.1".into(),
            bind_port: 8080,
            target_host: "localhost".into(),
            target_port: 80,
            auto_start: false,
            created_at: now,
            updated_at: now,
            deleted_at: None,
        }
    }

    const PASSPHRASE: &str = "export passphrase 1";

    #[test]
    fn full_export_roundtrips_with_secrets() {
        let mut payload = VaultPayload::new();
        payload.hosts.push(host("web"));
        payload.keys.push(key("laptop"));

        let bytes = export_full(&payload, PASSPHRASE).unwrap();
        let file = parse_export(&bytes).unwrap();
        assert!(file.needs_passphrase());

        let incoming = file.open(Some(PASSPHRASE)).unwrap();
        assert!(incoming.includes_secrets);
        assert_eq!(incoming.payload.hosts[0].password.as_deref(), Some("hunter2-secret"));
        assert_eq!(incoming.payload.keys[0].private_key, "PRIVATE-KEY-MATERIAL");
    }

    #[test]
    fn full_export_needs_the_right_passphrase() {
        let bytes = export_full(&VaultPayload::new(), PASSPHRASE).unwrap();

        assert!(matches!(
            parse_export(&bytes).unwrap().open(None),
            Err(AppError::PassphraseRequired)
        ));
        assert!(matches!(
            parse_export(&bytes).unwrap().open(Some("wrong passphrase!")),
            Err(AppError::InvalidPassword)
        ));
    }

    #[test]
    fn full_export_rejects_a_short_passphrase() {
        assert!(matches!(
            export_full(&VaultPayload::new(), "short"),
            Err(AppError::InvalidInput(_))
        ));
    }

    #[test]
    fn metadata_export_contains_no_secrets() {
        let mut payload = VaultPayload::new();
        payload.hosts.push(host("web"));
        payload.keys.push(key("laptop"));

        let bytes = export_metadata(&payload).unwrap();
        let text = String::from_utf8(bytes.clone()).unwrap();
        assert!(!text.contains("hunter2-secret"));
        assert!(!text.contains("PRIVATE-KEY-MATERIAL"));
        assert!(!text.contains("key-passphrase"));
        assert!(text.contains("\"public_only\": true"));

        let incoming = parse_export(&bytes).unwrap().open(None).unwrap();
        assert!(!incoming.includes_secrets);
        assert_eq!(incoming.payload.hosts.len(), 1);
    }

    #[test]
    fn exports_leave_out_deleted_rows() {
        let mut payload = VaultPayload::new();
        let mut deleted = host("gone");
        deleted.deleted_at = Some(Utc::now());
        payload.hosts.push(deleted);
        payload.hosts.push(host("kept"));

        let bytes = export_metadata(&payload).unwrap();
        let incoming = parse_export(&bytes).unwrap().open(None).unwrap();

        assert_eq!(incoming.payload.hosts.len(), 1);
        assert_eq!(incoming.payload.hosts[0].label, "kept");
    }

    #[test]
    fn unrelated_files_are_rejected() {
        assert!(parse_export(b"not json").is_err());
        assert!(parse_export(br#"{"format":"other"}"#).is_err());
    }

    #[test]
    fn merge_adds_new_rows_and_skips_identical_ones() {
        let shared = host("shared");
        let mut current = VaultPayload::new();
        current.hosts.push(shared.clone());
        let mut incoming = VaultPayload::new();
        incoming.hosts.push(shared);
        incoming.hosts.push(host("fresh"));

        let outcome = merge(&mut current, &incoming, true);

        assert_eq!(current.hosts.len(), 2);
        assert_eq!(outcome.added.hosts, 1);
        assert_eq!(outcome.skipped.hosts, 1);
        assert_eq!(outcome.duplicated.hosts, 0);
    }

    #[test]
    fn merge_keeps_both_rows_on_conflict_and_remaps_references() {
        let original_group = group("prod");
        let mut original_host = host("web");
        original_host.group_id = Some(original_group.id);
        let original_forward = forward(original_host.id);

        let mut current = VaultPayload::new();
        current.groups.push(original_group.clone());
        current.hosts.push(original_host.clone());

        // The same ids, edited elsewhere.
        let mut incoming = VaultPayload::new();
        let mut changed_group = original_group.clone();
        changed_group.name = "production".into();
        let mut changed_host = original_host.clone();
        changed_host.address = "other.example.com".into();
        incoming.groups.push(changed_group);
        incoming.hosts.push(changed_host);
        incoming.port_forwards.push(original_forward);

        let outcome = merge(&mut current, &incoming, true);

        assert_eq!(outcome.duplicated.groups, 1);
        assert_eq!(outcome.duplicated.hosts, 1);
        assert_eq!(current.groups.len(), 2);
        assert_eq!(current.hosts.len(), 2);

        let imported_group = current.groups.iter().find(|row| row.name == "production (imported)").unwrap();
        let imported_host = current.hosts.iter().find(|row| row.label == "web (imported)").unwrap();
        assert_ne!(imported_group.id, original_group.id);
        assert_ne!(imported_host.id, original_host.id);
        assert_eq!(imported_host.group_id, Some(imported_group.id));
        assert_eq!(current.port_forwards[0].host_id, imported_host.id);
        // The existing rows are untouched.
        assert_eq!(current.hosts[0].label, "web");
    }

    #[test]
    fn merging_a_metadata_export_back_into_its_vault_changes_nothing() {
        let mut current = VaultPayload::new();
        current.keys.push(key("laptop"));
        let mut web = host("web");
        web.key_id = Some(current.keys[0].id);
        current.hosts.push(web);

        let exported = export_metadata(&current).unwrap();
        let incoming = parse_export(&exported).unwrap().open(None).unwrap();
        assert!(!incoming.includes_secrets);

        let outcome = merge(&mut current, &incoming.payload, incoming.includes_secrets);

        assert_eq!(outcome.skipped.hosts, 1);
        assert_eq!(outcome.skipped.keys, 1);
        assert_eq!(outcome.duplicated, EntityCounts::default());
        assert_eq!(current.hosts.len(), 1);
        assert_eq!(current.hosts[0].password.as_deref(), Some("hunter2-secret"));
        assert_eq!(current.keys[0].private_key, "PRIVATE-KEY-MATERIAL");
    }

    #[test]
    fn a_metadata_export_still_duplicates_a_genuinely_edited_host() {
        let mut current = VaultPayload::new();
        let original = host("web");
        current.hosts.push(original.clone());

        let mut edited = original;
        edited.address = "other.example.com".into();
        let mut remote = VaultPayload::new();
        remote.hosts.push(edited);
        let exported = export_metadata(&remote).unwrap();
        let incoming = parse_export(&exported).unwrap().open(None).unwrap();

        let outcome = merge(&mut current, &incoming.payload, false);

        assert_eq!(outcome.duplicated.hosts, 1);
        assert_eq!(current.hosts.len(), 2);
    }

    fn known_host(address: &str, fingerprint: &str) -> KnownHost {
        KnownHost {
            id: Uuid::now_v7(),
            address: address.into(),
            port: 22,
            key_type: "ssh-ed25519".into(),
            public_key: "ssh-ed25519 AAAA".into(),
            fingerprint: fingerprint.into(),
            added_at: Utc::now(),
            deleted_at: None,
        }
    }

    #[test]
    fn merge_never_adds_a_second_known_host_for_the_same_endpoint() {
        let mut current = VaultPayload::new();
        current.known_hosts.push(known_host("example.com", "SHA256:trusted"));
        let mut incoming = VaultPayload::new();
        incoming.known_hosts.push(known_host("example.com", "SHA256:different"));
        incoming.known_hosts.push(known_host("other.com", "SHA256:new"));

        let outcome = merge(&mut current, &incoming, true);

        assert_eq!(outcome.skipped.known_hosts, 1);
        assert_eq!(outcome.added.known_hosts, 1);
        assert_eq!(current.known_hosts.len(), 2);
        assert_eq!(current.known_hosts[0].fingerprint, "SHA256:trusted");
    }

    #[test]
    fn replace_swaps_the_data_but_keeps_the_vault_identity() {
        let mut current = VaultPayload::new();
        current.hosts.push(host("old"));
        let vault_id = current.vault_id;
        let mut incoming = VaultPayload::new();
        incoming.hosts.push(host("new"));

        replace(&mut current, incoming);

        assert_eq!(current.vault_id, vault_id);
        assert_eq!(current.hosts.len(), 1);
        assert_eq!(current.hosts[0].label, "new");
    }

    #[test]
    fn preview_reports_the_merge_without_changing_the_vault() {
        let mut current = VaultPayload::new();
        current.hosts.push(host("existing"));
        let mut payload = VaultPayload::new();
        payload.hosts.push(host("incoming"));
        let incoming = Incoming {
            payload,
            includes_secrets: true,
        };

        let preview = preview(&current, &incoming);

        assert_eq!(preview.incoming.hosts, 1);
        assert_eq!(preview.merge.added.hosts, 1);
        assert!(preview.can_replace);
        assert_eq!(current.hosts.len(), 1);
    }
}
