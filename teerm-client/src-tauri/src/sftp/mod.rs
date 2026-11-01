use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use russh_sftp::client::SftpSession;
use russh_sftp::client::fs::Metadata;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::error::AppError;
use crate::ssh::SshManager;

const TRANSFER_EVENT: &str = "transfer://progress";
const CHUNK_SIZE: usize = 64 * 1024;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);
const PROGRESS_BYTES: u64 = 512 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified: Option<u64>,
    pub permissions: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpOpenResult {
    pub path: String,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferState {
    Running,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransferProgressEvent {
    transfer_id: Uuid,
    transferred: u64,
    total: u64,
    state: TransferState,
    message: Option<String>,
}

struct TransferEntry {
    session_id: Uuid,
    cancel: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct SftpManager {
    sessions: Arc<Mutex<HashMap<Uuid, Arc<SftpSession>>>>,
    transfers: Arc<Mutex<HashMap<Uuid, TransferEntry>>>,
}

impl SftpManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns the cached SFTP session for `session_id`, opening the
    /// subsystem on the existing SSH connection when needed.
    ///
    /// The session map lock is held while the subsystem is being set up so
    /// concurrent callers cannot open duplicate channels. It is never held
    /// while listing or transferring.
    pub async fn ensure(
        &self,
        ssh: &SshManager,
        session_id: Uuid,
    ) -> Result<Arc<SftpSession>, AppError> {
        let mut sessions = self.sessions.lock().await;

        if let Some(session) = sessions.get(&session_id) {
            return Ok(Arc::clone(session));
        }

        let channel = ssh.open_subsystem(session_id, "sftp").await?;
        let stream = channel.into_stream();
        let session = SftpSession::new(stream)
            .await
            .map_err(|error| AppError::Internal(format!("could not start SFTP: {error}")))?;

        let session = Arc::new(session);
        sessions.insert(session_id, Arc::clone(&session));
        Ok(session)
    }

    pub async fn open(
        &self,
        ssh: &SshManager,
        session_id: Uuid,
    ) -> Result<SftpOpenResult, AppError> {
        let session = self.ensure(ssh, session_id).await?;

        let path = match session.canonicalize(".").await {
            Ok(path) if path.starts_with('/') => path,
            _ => "/".to_string(),
        };

        Ok(SftpOpenResult { path })
    }

    pub async fn list(
        &self,
        ssh: &SshManager,
        session_id: Uuid,
        path: &str,
    ) -> Result<Vec<SftpEntry>, AppError> {
        validate_remote_path(path, false)?;

        let session = self.ensure(ssh, session_id).await?;
        let read_dir = self
            .call(
                session_id,
                "could not list the folder",
                session.read_dir(path.to_string()),
            )
            .await?;

        let mut entries = Vec::new();

        for entry in read_dir {
            let file_type = entry.file_type();
            let metadata = entry.metadata();

            entries.push(SftpEntry {
                name: entry.file_name(),
                path: entry.path(),
                is_dir: file_type.is_dir(),
                is_symlink: file_type.is_symlink(),
                size: metadata.size.unwrap_or(0),
                modified: metadata.modified().ok().and_then(to_unix_seconds),
                permissions: metadata.permissions.map(|mode| mode & 0o7777),
            });
        }

        entries.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
                .then_with(|| a.name.cmp(&b.name))
        });

        Ok(entries)
    }

    pub async fn mkdir(
        &self,
        ssh: &SshManager,
        session_id: Uuid,
        path: &str,
    ) -> Result<(), AppError> {
        validate_remote_path(path, true)?;

        let session = self.ensure(ssh, session_id).await?;
        self.call(
            session_id,
            "could not create the folder",
            session.create_dir(path.to_string()),
        )
        .await
    }

    pub async fn rename(
        &self,
        ssh: &SshManager,
        session_id: Uuid,
        from: &str,
        to: &str,
    ) -> Result<(), AppError> {
        validate_remote_path(from, true)?;
        validate_remote_path(to, true)?;

        if from == "/" || to == "/" {
            return Err(AppError::InvalidInput(
                "the root folder cannot be renamed".into(),
            ));
        }

        let session = self.ensure(ssh, session_id).await?;
        self.call(
            session_id,
            "could not rename the entry",
            session.rename(from.to_string(), to.to_string()),
        )
        .await
    }

    pub async fn delete(
        &self,
        ssh: &SshManager,
        session_id: Uuid,
        path: &str,
        is_dir: bool,
    ) -> Result<(), AppError> {
        validate_remote_path(path, true)?;

        if path == "/" {
            return Err(AppError::InvalidInput(
                "the root folder cannot be deleted".into(),
            ));
        }

        let session = self.ensure(ssh, session_id).await?;

        if is_dir {
            self.call(
                session_id,
                "could not delete the folder",
                session.remove_dir(path.to_string()),
            )
            .await
        } else {
            self.call(
                session_id,
                "could not delete the file",
                session.remove_file(path.to_string()),
            )
            .await
        }
    }

    pub async fn chmod(
        &self,
        ssh: &SshManager,
        session_id: Uuid,
        path: &str,
        mode: u32,
    ) -> Result<(), AppError> {
        validate_remote_path(path, true)?;

        let metadata = Metadata {
            permissions: Some(mode & 0o7777),
            ..Metadata::default()
        };

        let session = self.ensure(ssh, session_id).await?;
        self.call(
            session_id,
            "could not change the permissions",
            session.set_metadata(path.to_string(), metadata),
        )
        .await
    }

    /// Drops the cached SFTP session and asks every transfer that belongs to
    /// it to stop. No network I/O is awaited here.
    pub async fn close_session(&self, session_id: Uuid) {
        let session = self.sessions.lock().await.remove(&session_id);
        drop(session);

        let transfers = self.transfers.lock().await;
        for entry in transfers.values() {
            if entry.session_id == session_id {
                entry.cancel.store(true, Ordering::Relaxed);
            }
        }
    }

    pub async fn close_all(&self) {
        let mut sessions = self.sessions.lock().await;
        sessions.clear();
        drop(sessions);

        let transfers = self.transfers.lock().await;
        for entry in transfers.values() {
            entry.cancel.store(true, Ordering::Relaxed);
        }
    }

    pub async fn start_upload(
        &self,
        app: AppHandle,
        ssh: &SshManager,
        session_id: Uuid,
        local_path: PathBuf,
        remote_path: String,
    ) -> Result<Uuid, AppError> {
        validate_remote_path(&remote_path, true)?;

        let metadata = tokio::fs::metadata(&local_path)
            .await
            .map_err(|error| AppError::Io(format!("could not read the local file: {error}")))?;

        if !metadata.is_file() {
            return Err(AppError::InvalidInput(
                "the local path is not a file".into(),
            ));
        }

        let total = metadata.len();
        let session = self.ensure(ssh, session_id).await?;
        let transfer_id = Uuid::new_v4();
        let cancel = Arc::new(AtomicBool::new(false));

        self.transfers.lock().await.insert(
            transfer_id,
            TransferEntry {
                session_id,
                cancel: Arc::clone(&cancel),
            },
        );

        let app_handle = app.clone();
        let transfers = Arc::clone(&self.transfers);

        tauri::async_runtime::spawn(async move {
            let report = upload_copy(
                &app_handle,
                &session,
                transfer_id,
                &cancel,
                &local_path,
                &remote_path,
                total,
            )
            .await;
            finish_transfer(&app_handle, &transfers, transfer_id, total, &cancel, report).await;
        });

        Ok(transfer_id)
    }

    pub async fn start_download(
        &self,
        app: AppHandle,
        ssh: &SshManager,
        session_id: Uuid,
        remote_path: String,
        local_path: PathBuf,
    ) -> Result<Uuid, AppError> {
        validate_remote_path(&remote_path, true)?;

        if !local_path.is_absolute() {
            return Err(AppError::InvalidInput(
                "the download path must be absolute".into(),
            ));
        }

        let session = self.ensure(ssh, session_id).await?;
        let metadata = self
            .call(
                session_id,
                "could not read the remote file",
                session.metadata(remote_path.clone()),
            )
            .await?;

        if metadata.is_dir() {
            return Err(AppError::InvalidInput(
                "folders cannot be downloaded".into(),
            ));
        }

        let total = metadata.size.unwrap_or(0);
        let transfer_id = Uuid::new_v4();
        let cancel = Arc::new(AtomicBool::new(false));

        self.transfers.lock().await.insert(
            transfer_id,
            TransferEntry {
                session_id,
                cancel: Arc::clone(&cancel),
            },
        );

        let app_handle = app.clone();
        let transfers = Arc::clone(&self.transfers);

        tauri::async_runtime::spawn(async move {
            let report = download_copy(
                &app_handle,
                &session,
                transfer_id,
                &cancel,
                &remote_path,
                &local_path,
                total,
            )
            .await;
            finish_transfer(&app_handle, &transfers, transfer_id, total, &cancel, report).await;
        });

        Ok(transfer_id)
    }

    pub async fn cancel_transfer(&self, transfer_id: Uuid) -> Result<(), AppError> {
        let transfers = self.transfers.lock().await;
        let entry = transfers
            .get(&transfer_id)
            .ok_or_else(|| AppError::NotFound("transfer".into()))?;

        entry.cancel.store(true, Ordering::Relaxed);
        Ok(())
    }

    /// Runs one SFTP operation and evicts the cached session when the channel
    /// itself looks broken, so the next command can open a fresh subsystem.
    async fn call<T, F>(&self, session_id: Uuid, context: &str, future: F) -> Result<T, AppError>
    where
        F: Future<Output = Result<T, russh_sftp::client::error::Error>>,
    {
        match future.await {
            Ok(value) => Ok(value),
            Err(error) => {
                if is_broken_channel(&error) {
                    self.sessions.lock().await.remove(&session_id);
                }
                Err(AppError::Internal(format!("{context}: {error}")))
            }
        }
    }
}

struct TransferReport {
    transferred: u64,
    outcome: TransferOutcome,
}

enum TransferOutcome {
    Completed,
    Cancelled,
    Failed(String),
}

#[allow(clippy::too_many_arguments)]
async fn upload_copy(
    app: &AppHandle,
    session: &SftpSession,
    transfer_id: Uuid,
    cancel: &AtomicBool,
    local_path: &Path,
    remote_path: &str,
    total: u64,
) -> TransferReport {
    emit_progress(app, transfer_id, 0, total, TransferState::Running, None);

    let mut local = match tokio::fs::File::open(local_path).await {
        Ok(file) => file,
        Err(error) => {
            return failed(0, format!("could not open the local file: {error}"));
        }
    };

    let mut remote = match session.create(remote_path.to_string()).await {
        Ok(file) => file,
        Err(error) => {
            return failed(0, format!("could not create the remote file: {error}"));
        }
    };

    let mut reporter = ProgressReporter::new(app.clone(), transfer_id, total);
    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut transferred = 0u64;

    loop {
        if cancel.load(Ordering::Relaxed) {
            drop(remote);
            let _ = session.remove_file(remote_path.to_string()).await;
            return TransferReport {
                transferred,
                outcome: TransferOutcome::Cancelled,
            };
        }

        let read = match local.read(&mut buffer).await {
            Ok(0) => break,
            Ok(read) => read,
            Err(error) => {
                drop(remote);
                let _ = session.remove_file(remote_path.to_string()).await;
                return failed(
                    transferred,
                    format!("could not read the local file: {error}"),
                );
            }
        };

        if let Err(error) = remote.write_all(&buffer[..read]).await {
            drop(remote);
            let _ = session.remove_file(remote_path.to_string()).await;
            return failed(
                transferred,
                format!("could not write the remote file: {error}"),
            );
        }

        transferred += read as u64;
        reporter.report(transferred);
    }

    if let Err(error) = remote.flush().await {
        drop(remote);
        let _ = session.remove_file(remote_path.to_string()).await;
        return failed(
            transferred,
            format!("could not flush the remote file: {error}"),
        );
    }

    if let Err(error) = remote.close().await {
        let _ = session.remove_file(remote_path.to_string()).await;
        return failed(
            transferred,
            format!("could not finish the remote file: {error}"),
        );
    }

    TransferReport {
        transferred,
        outcome: TransferOutcome::Completed,
    }
}

#[allow(clippy::too_many_arguments)]
async fn download_copy(
    app: &AppHandle,
    session: &SftpSession,
    transfer_id: Uuid,
    cancel: &AtomicBool,
    remote_path: &str,
    local_path: &Path,
    total: u64,
) -> TransferReport {
    emit_progress(app, transfer_id, 0, total, TransferState::Running, None);

    let mut remote = match session.open(remote_path.to_string()).await {
        Ok(file) => file,
        Err(error) => {
            return failed(0, format!("could not open the remote file: {error}"));
        }
    };

    if let Some(parent) = local_path.parent()
        && !parent.as_os_str().is_empty()
        && let Err(error) = tokio::fs::create_dir_all(parent).await
    {
        return failed(0, format!("could not create the download folder: {error}"));
    }

    let mut local = match tokio::fs::File::create(local_path).await {
        Ok(file) => file,
        Err(error) => {
            return failed(0, format!("could not create the local file: {error}"));
        }
    };

    let mut reporter = ProgressReporter::new(app.clone(), transfer_id, total);
    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut transferred = 0u64;

    loop {
        if cancel.load(Ordering::Relaxed) {
            drop(local);
            let _ = tokio::fs::remove_file(local_path).await;
            return TransferReport {
                transferred,
                outcome: TransferOutcome::Cancelled,
            };
        }

        let read = match remote.read(&mut buffer).await {
            Ok(0) => break,
            Ok(read) => read,
            Err(error) => {
                drop(local);
                let _ = tokio::fs::remove_file(local_path).await;
                return failed(
                    transferred,
                    format!("could not read the remote file: {error}"),
                );
            }
        };

        if let Err(error) = local.write_all(&buffer[..read]).await {
            drop(local);
            let _ = tokio::fs::remove_file(local_path).await;
            return failed(
                transferred,
                format!("could not write the local file: {error}"),
            );
        }

        transferred += read as u64;
        reporter.report(transferred);
    }

    if let Err(error) = local.flush().await {
        drop(local);
        let _ = tokio::fs::remove_file(local_path).await;
        return failed(
            transferred,
            format!("could not flush the local file: {error}"),
        );
    }

    TransferReport {
        transferred,
        outcome: TransferOutcome::Completed,
    }
}

fn failed(transferred: u64, message: String) -> TransferReport {
    TransferReport {
        transferred,
        outcome: TransferOutcome::Failed(message),
    }
}

async fn finish_transfer(
    app: &AppHandle,
    transfers: &Arc<Mutex<HashMap<Uuid, TransferEntry>>>,
    transfer_id: Uuid,
    total: u64,
    cancel: &AtomicBool,
    report: TransferReport,
) {
    let (state, message) = match report.outcome {
        TransferOutcome::Completed => (TransferState::Completed, None),
        TransferOutcome::Cancelled => (TransferState::Cancelled, None),
        TransferOutcome::Failed(_) if cancel.load(Ordering::Relaxed) => {
            (TransferState::Cancelled, None)
        }
        TransferOutcome::Failed(message) => (TransferState::Failed, Some(message)),
    };

    emit_progress(app, transfer_id, report.transferred, total, state, message);

    transfers.lock().await.remove(&transfer_id);
}

struct ProgressReporter {
    app: AppHandle,
    transfer_id: Uuid,
    total: u64,
    last_emit: Instant,
    last_bytes: u64,
}

impl ProgressReporter {
    fn new(app: AppHandle, transfer_id: Uuid, total: u64) -> Self {
        Self {
            app,
            transfer_id,
            total,
            last_emit: Instant::now(),
            last_bytes: 0,
        }
    }

    fn report(&mut self, transferred: u64) {
        let now = Instant::now();

        if now.duration_since(self.last_emit) < PROGRESS_INTERVAL
            && transferred.saturating_sub(self.last_bytes) < PROGRESS_BYTES
        {
            return;
        }

        self.last_emit = now;
        self.last_bytes = transferred;

        emit_progress(
            &self.app,
            self.transfer_id,
            transferred,
            self.total,
            TransferState::Running,
            None,
        );
    }
}

fn emit_progress(
    app: &AppHandle,
    transfer_id: Uuid,
    transferred: u64,
    total: u64,
    state: TransferState,
    message: Option<String>,
) {
    let _ = app.emit(
        TRANSFER_EVENT,
        TransferProgressEvent {
            transfer_id,
            transferred,
            total,
            state,
            message,
        },
    );
}

fn is_broken_channel(error: &russh_sftp::client::error::Error) -> bool {
    use russh_sftp::client::error::Error;
    use russh_sftp::protocol::StatusCode;

    match error {
        Error::IO(_) | Error::Timeout | Error::UnexpectedPacket | Error::UnexpectedBehavior(_) => {
            true
        }
        Error::Status(status) => matches!(
            status.status_code,
            StatusCode::NoConnection | StatusCode::ConnectionLost | StatusCode::Eof
        ),
        Error::Limited(_) => false,
    }
}

fn validate_remote_path(path: &str, require_absolute: bool) -> Result<(), AppError> {
    if path.is_empty() {
        return Err(AppError::InvalidInput("the remote path is empty".into()));
    }

    if path.contains('\0') {
        return Err(AppError::InvalidInput(
            "the remote path contains an invalid character".into(),
        ));
    }

    if require_absolute && !path.starts_with('/') {
        return Err(AppError::InvalidInput(
            "the remote path must be absolute".into(),
        ));
    }

    Ok(())
}

fn to_unix_seconds(time: SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_paths_are_validated() {
        assert!(validate_remote_path("", false).is_err());
        assert!(validate_remote_path("bad\0path", false).is_err());
        assert!(validate_remote_path("relative", true).is_err());
        assert!(validate_remote_path("/absolute", true).is_ok());
        assert!(validate_remote_path("relative", false).is_ok());
    }

    #[test]
    fn permissions_are_masked_to_mode_bits() {
        let mode = 0o100_644u32;
        assert_eq!(mode & 0o7777, 0o644);
    }

    #[test]
    fn unix_seconds_roundtrip() {
        let time = UNIX_EPOCH + Duration::from_secs(1_700_000_000);
        assert_eq!(to_unix_seconds(time), Some(1_700_000_000));
    }
}
