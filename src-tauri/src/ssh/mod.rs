use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use russh::client;
use russh::keys::{HashAlg, PrivateKey, PrivateKeyWithHashAlg};
use russh::{ChannelMsg, Disconnect};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot, Mutex};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::error::AppError;
use crate::forward::{new_remote_targets, serve_remote_connection, RemoteTargets};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const AUTH_PROMPT_TIMEOUT: Duration = Duration::from_secs(120);
const PING_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_WRITE_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone)]
pub struct KnownKeySnapshot {
    pub key_type: String,
    pub fingerprint: String,
}

pub struct ConnectProfile {
    pub address: String,
    pub port: u16,
    pub username: String,
    pub password: Option<Zeroizing<String>>,
    pub private_key: Option<Zeroizing<String>>,
    pub passphrase: Option<Zeroizing<String>>,
    pub known_hosts: Vec<KnownKeySnapshot>,
    pub accept_new_host: bool,
    pub replace_host_key: bool,
    pub cols: u32,
    pub rows: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedSession {
    pub session_id: Uuid,
    pub key_type: String,
    pub fingerprint: String,
    pub public_key: String,
    /// True when this connection trusted and stored a previously unknown key.
    pub new_host_key: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionDataEvent {
    session_id: Uuid,
    data: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionClosedEvent {
    session_id: Uuid,
    reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthPrompt {
    prompt: String,
    echo: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthPromptEvent {
    session_id: Uuid,
    name: String,
    instructions: String,
    prompts: Vec<AuthPrompt>,
}

enum SessionCommand {
    Data(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
}

#[derive(Debug, Clone)]
struct OfferedKey {
    key_type: String,
    fingerprint: String,
    public_key: String,
}

pub struct ClientHandler {
    known_hosts: Vec<KnownKeySnapshot>,
    accept_new_host: bool,
    replace_host_key: bool,
    offered: Arc<StdMutex<Option<OfferedKey>>>,
    remote_targets: RemoteTargets,
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: russh::Channel<client::Msg>,
        connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: client::ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        tokio::spawn(serve_remote_connection(
            Arc::clone(&self.remote_targets),
            connected_address.to_string(),
            connected_port,
            channel.into_stream(),
        ));
        Ok(())
    }

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let key = server_public_key.public_key();
        let offered = OfferedKey {
            key_type: key.algorithm().as_str().to_string(),
            fingerprint: key.fingerprint(HashAlg::Sha256).to_string(),
            public_key: key.to_openssh().unwrap_or_default(),
        };

        let matches_known = self
            .known_hosts
            .iter()
            .any(|known| known.fingerprint == offered.fingerprint);

        if let Ok(mut current) = self.offered.lock() {
            *current = Some(offered);
        }

        if matches_known {
            return Ok(true);
        }

        if self.known_hosts.is_empty() {
            return Ok(self.accept_new_host);
        }

        Ok(self.replace_host_key)
    }
}

#[derive(Default)]
pub struct SshManager {
    sessions: Arc<Mutex<HashMap<Uuid, SessionEntry>>>,
    pending_auth: Arc<Mutex<HashMap<Uuid, oneshot::Sender<Option<Vec<String>>>>>>,
}

#[derive(Clone)]
struct SessionEntry {
    sender: mpsc::UnboundedSender<SessionCommand>,
    handle: Arc<Mutex<client::Handle<ClientHandler>>>,
    remote_targets: RemoteTargets,
}

/// What a Port Forward needs from a live Session.
#[derive(Clone)]
pub struct ForwardLink {
    pub handle: Arc<Mutex<client::Handle<ClientHandler>>>,
    pub remote_targets: RemoteTargets,
}

impl SshManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn open(
        &self,
        app: AppHandle,
        session_id: Uuid,
        profile: ConnectProfile,
    ) -> Result<OpenedSession, AppError> {
        let offered = Arc::new(StdMutex::new(None));
        let remote_targets = new_remote_targets();
        let handler = ClientHandler {
            known_hosts: profile.known_hosts.clone(),
            accept_new_host: profile.accept_new_host,
            replace_host_key: profile.replace_host_key,
            offered: Arc::clone(&offered),
            remote_targets: Arc::clone(&remote_targets),
        };

        let config = Arc::new(client::Config {
            keepalive_interval: Some(Duration::from_secs(30)),
            keepalive_max: 3,
            nodelay: true,
            ..Default::default()
        });

        let connect = client::connect(
            config,
            (profile.address.as_str(), profile.port),
            handler,
        );

        let mut handle = match tokio::time::timeout(CONNECT_TIMEOUT, connect).await {
            Err(_) => {
                return Err(AppError::Internal(format!(
                    "connecting to {}:{} timed out",
                    profile.address, profile.port
                )))
            }
            Ok(Ok(handle)) => handle,
            Ok(Err(russh::Error::UnknownKey)) => {
                return Err(host_key_error(&profile, &offered))
            }
            Ok(Err(error)) => {
                return Err(AppError::Internal(format!(
                    "could not connect to {}:{}: {error}",
                    profile.address, profile.port
                )))
            }
        };

        self.authenticate(&mut handle, &app, session_id, &profile)
            .await?;

        let channel = handle
            .channel_open_session()
            .await
            .map_err(|error| AppError::Internal(format!("could not open a shell: {error}")))?;

        let cols = profile.cols.max(1);
        let rows = profile.rows.max(1);

        channel
            .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
            .await
            .map_err(|error| AppError::Internal(format!("could not request a terminal: {error}")))?;
        channel
            .request_shell(true)
            .await
            .map_err(|error| AppError::Internal(format!("could not start the shell: {error}")))?;

        let offered_key = offered
            .lock()
            .ok()
            .and_then(|current| current.clone())
            .ok_or_else(|| AppError::Internal("the server did not present a host key".into()))?;

        let new_host_key = !profile
            .known_hosts
            .iter()
            .any(|known| known.fingerprint == offered_key.fingerprint);

        let (read_half, write_half) = channel.split();
        let (commands, mut command_rx) = mpsc::unbounded_channel();
        let task_sender = commands.clone();
        let handle = Arc::new(Mutex::new(handle));
        let task_handle = Arc::clone(&handle);
        self.sessions.lock().await.insert(
            session_id,
            SessionEntry {
                sender: commands,
                handle,
                remote_targets,
            },
        );

        let sessions = Arc::clone(&self.sessions);
        let app_handle = app.clone();

        tauri::async_runtime::spawn(async move {
            let mut read_half = read_half;
            let mut write_half = Some(write_half);
            let reason: String;

            loop {
                tokio::select! {
                    message = read_half.wait() => {
                        match message {
                            Some(ChannelMsg::Data { data }) => {
                                let event = SessionDataEvent {
                                    session_id,
                                    data: BASE64.encode(&data[..]),
                                };
                                let _ = app_handle.emit("ssh:data", event);
                            }
                            Some(ChannelMsg::ExtendedData { data, .. }) => {
                                let event = SessionDataEvent {
                                    session_id,
                                    data: BASE64.encode(&data[..]),
                                };
                                let _ = app_handle.emit("ssh:data", event);
                            }
                            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                                reason = "session ended".to_string();
                                break;
                            }
                            _ => {}
                        }
                    }
                    command = command_rx.recv() => {
                        match command {
                            Some(SessionCommand::Data(bytes)) => {
                                if let Some(writer) = write_half.as_ref() {
                                    if writer.data_bytes(bytes).await.is_err() {
                                        reason = "could not send data".to_string();
                                        break;
                                    }
                                }
                            }
                            Some(SessionCommand::Resize { cols, rows }) => {
                                if let Some(writer) = write_half.as_ref() {
                                    let _ = writer.window_change(cols, rows, 0, 0).await;
                                }
                            }
                            Some(SessionCommand::Close) | None => {
                                reason = "closed".to_string();
                                break;
                            }
                        }
                    }
                }
            }

            if let Some(writer) = write_half.take() {
                let _ = writer.eof().await;
                let _ = writer.close().await;
            }

            let _ = task_handle
                .lock()
                .await
                .disconnect(Disconnect::ByApplication, "", "en")
                .await;

            {
                let mut sessions = sessions.lock().await;
                let is_current = sessions
                    .get(&session_id)
                    .is_some_and(|entry| entry.sender.same_channel(&task_sender));
                if is_current {
                    sessions.remove(&session_id);
                }
            }

            let _ = app_handle.emit(
                "ssh:closed",
                SessionClosedEvent {
                    session_id,
                    reason,
                },
            );
        });

        Ok(OpenedSession {
            session_id,
            key_type: offered_key.key_type,
            fingerprint: offered_key.fingerprint,
            public_key: offered_key.public_key,
            new_host_key,
        })
    }

    async fn authenticate(
        &self,
        handle: &mut client::Handle<ClientHandler>,
        app: &AppHandle,
        session_id: Uuid,
        profile: &ConnectProfile,
    ) -> Result<(), AppError> {
        let mut authenticated = false;

        if let Some(private_key) = profile.private_key.as_deref() {
            let key = PrivateKey::from_openssh(private_key.as_str()).map_err(|error| {
                AppError::InvalidInput(format!("stored private key is invalid: {error}"))
            })?;

            let key = if key.is_encrypted() {
                let passphrase = profile
                    .passphrase
                    .as_deref()
                    .ok_or_else(|| AppError::InvalidInput("the stored key needs a passphrase".into()))?;
                key.decrypt(passphrase.as_str()).map_err(|_| {
                    AppError::InvalidInput("could not decrypt the stored private key".into())
                })?
            } else {
                key
            };

            let hash_alg = handle
                .best_supported_rsa_hash()
                .await
                .ok()
                .flatten()
                .flatten();

            let result = handle
                .authenticate_publickey(
                    profile.username.as_str(),
                    PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg),
                )
                .await
                .map_err(|error| AppError::Internal(format!("key authentication failed: {error}")))?;

            authenticated = result.success();
        }

        if !authenticated {
            if let Some(password) = profile.password.as_deref() {
                let result = handle
                    .authenticate_password(profile.username.as_str(), password.as_str())
                    .await
                    .map_err(|error| {
                        AppError::Internal(format!("password authentication failed: {error}"))
                    })?;

                authenticated = result.success();
            }
        }

        if !authenticated {
            authenticated = self
                .keyboard_interactive(handle, app, session_id, profile)
                .await?;
        }

        if !authenticated {
            return Err(AppError::AuthFailed);
        }

        Ok(())
    }

    async fn keyboard_interactive(
        &self,
        handle: &mut client::Handle<ClientHandler>,
        app: &AppHandle,
        session_id: Uuid,
        profile: &ConnectProfile,
    ) -> Result<bool, AppError> {
        let mut response = handle
            .authenticate_keyboard_interactive_start(profile.username.as_str(), None::<String>)
            .await
            .map_err(|error| {
                AppError::Internal(format!("keyboard-interactive authentication failed: {error}"))
            })?;

        loop {
            match response {
                client::KeyboardInteractiveAuthResponse::Success => return Ok(true),
                client::KeyboardInteractiveAuthResponse::Failure { .. } => return Ok(false),
                client::KeyboardInteractiveAuthResponse::InfoRequest {
                    name,
                    instructions,
                    prompts,
                } => {
                    let responses = if let Some(password) = profile.password.as_deref() {
                        if prompts.iter().all(|prompt| !prompt.echo) {
                            Some(vec![password.to_string(); prompts.len()])
                        } else {
                            None
                        }
                    } else {
                        None
                    };

                    let responses = match responses {
                        Some(responses) => responses,
                        None => {
                            let (sender, receiver) = oneshot::channel();
                            self.pending_auth.lock().await.insert(session_id, sender);

                            let _ = app.emit(
                                "ssh:auth-prompt",
                                AuthPromptEvent {
                                    session_id,
                                    name,
                                    instructions,
                                    prompts: prompts
                                        .iter()
                                        .map(|prompt| AuthPrompt {
                                            prompt: prompt.prompt.clone(),
                                            echo: prompt.echo,
                                        })
                                        .collect(),
                                },
                            );

                            let result =
                                tokio::time::timeout(AUTH_PROMPT_TIMEOUT, receiver).await;
                            self.pending_auth.lock().await.remove(&session_id);

                            match result {
                                Ok(Ok(Some(responses))) => responses,
                                _ => return Ok(false),
                            }
                        }
                    };

                    response = handle
                        .authenticate_keyboard_interactive_respond(responses)
                        .await
                        .map_err(|error| {
                            AppError::Internal(format!(
                                "keyboard-interactive authentication failed: {error}"
                            ))
                        })?;
                }
            }
        }
    }

    pub async fn respond_auth(
        &self,
        session_id: Uuid,
        responses: Option<Vec<String>>,
    ) -> Result<(), AppError> {
        let sender = self.pending_auth.lock().await.remove(&session_id);
        match sender {
            Some(sender) => {
                let _ = sender.send(responses);
                Ok(())
            }
            None => Err(AppError::SessionNotFound),
        }
    }

    pub async fn write(&self, session_id: Uuid, data: Vec<u8>) -> Result<(), AppError> {
        if data.len() > MAX_WRITE_BYTES {
            return Err(AppError::InvalidInput("input chunk is too large".into()));
        }

        let sessions = self.sessions.lock().await;
        let sender = &sessions
            .get(&session_id)
            .ok_or(AppError::SessionNotFound)?
            .sender;

        sender
            .send(SessionCommand::Data(data))
            .map_err(|_| AppError::SessionNotFound)
    }

    pub async fn resize(
        &self,
        session_id: Uuid,
        cols: u32,
        rows: u32,
    ) -> Result<(), AppError> {
        if cols == 0 || rows == 0 || cols > 1000 || rows > 1000 {
            return Err(AppError::InvalidInput("invalid terminal size".into()));
        }

        let sessions = self.sessions.lock().await;
        let sender = &sessions
            .get(&session_id)
            .ok_or(AppError::SessionNotFound)?
            .sender;

        sender
            .send(SessionCommand::Resize { cols, rows })
            .map_err(|_| AppError::SessionNotFound)
    }

    /// Opens an SSH channel and starts `subsystem` on it.
    ///
    /// The returned channel is not registered anywhere: the caller owns it and
    /// is responsible for closing it. Neither the session map lock nor the
    /// connection handle lock is held while the subsystem request is in
    /// flight.
    pub async fn open_subsystem(
        &self,
        session_id: Uuid,
        subsystem: &str,
    ) -> Result<russh::Channel<russh::client::Msg>, AppError> {
        let handle = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(&session_id)
                .map(|entry| Arc::clone(&entry.handle))
                .ok_or(AppError::SessionNotFound)?
        };

        let channel = {
            let handle = handle.lock().await;
            handle.channel_open_session().await.map_err(|error| {
                AppError::Internal(format!("could not open a {subsystem} channel: {error}"))
            })?
        };

        channel
            .request_subsystem(true, subsystem.to_string())
            .await
            .map_err(|error| {
                AppError::Internal(format!("could not start the {subsystem} subsystem: {error}"))
            })?;

        Ok(channel)
    }

    pub async fn forward_link(&self, session_id: Uuid) -> Result<ForwardLink, AppError> {
        let sessions = self.sessions.lock().await;
        let entry = sessions.get(&session_id).ok_or(AppError::SessionNotFound)?;
        Ok(ForwardLink {
            handle: Arc::clone(&entry.handle),
            remote_targets: Arc::clone(&entry.remote_targets),
        })
    }

    /// Round-trip time of an SSH ping, in milliseconds.
    pub async fn latency_ms(&self, session_id: Uuid) -> Result<u64, AppError> {
        let link = self.forward_link(session_id).await?;
        let started = Instant::now();

        let ping = async { link.handle.lock().await.send_ping().await };
        tokio::time::timeout(PING_TIMEOUT, ping)
            .await
            .map_err(|_| AppError::Internal("the server did not answer in time".into()))?
            .map_err(|error| AppError::Internal(format!("could not ping the server: {error}")))?;

        Ok(started.elapsed().as_millis() as u64)
    }

    pub async fn close(&self, session_id: Uuid) {
        let entry = self.sessions.lock().await.remove(&session_id);
        if let Some(entry) = entry {
            let _ = entry.sender.send(SessionCommand::Close);
        }
        self.pending_auth.lock().await.remove(&session_id);
    }

    pub async fn close_all(&self) {
        let mut sessions = self.sessions.lock().await;
        for (_, entry) in sessions.drain() {
            let _ = entry.sender.send(SessionCommand::Close);
        }
        self.pending_auth.lock().await.clear();
    }
}

fn host_key_error(
    profile: &ConnectProfile,
    offered: &Arc<StdMutex<Option<OfferedKey>>>,
) -> AppError {
    let offered = offered
        .lock()
        .ok()
        .and_then(|current| current.clone())
        .unwrap_or(OfferedKey {
            key_type: "unknown".into(),
            fingerprint: "unknown".into(),
            public_key: String::new(),
        });

    if profile.known_hosts.is_empty() {
        AppError::HostKeyUnknown {
            address: profile.address.clone(),
            port: profile.port,
            key_type: offered.key_type,
            fingerprint: offered.fingerprint,
        }
    } else {
        let known_fingerprint = profile
            .known_hosts
            .iter()
            .find(|known| known.key_type == offered.key_type)
            .or_else(|| profile.known_hosts.first())
            .map(|known| known.fingerprint.clone())
            .unwrap_or_else(|| "unknown".into());

        AppError::HostKeyChanged {
            address: profile.address.clone(),
            port: profile.port,
            key_type: offered.key_type,
            fingerprint: offered.fingerprint,
            known_fingerprint,
        }
    }
}

/// Decodes the base64 payload sent by the webview for terminal input.
pub fn decode_input(data: &str) -> Result<Vec<u8>, AppError> {
    BASE64
        .decode(data)
        .map_err(|_| AppError::InvalidInput("terminal input is not valid base64".into()))
}

/// Used by tests for the same encoding the read loop emits.
#[cfg(test)]
pub fn encode_output(data: &[u8]) -> String {
    BASE64.encode(data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_roundtrip_for_terminal_data() {
        let data = b"ls -la\r\n\x1b[32mok\x1b[0m";
        assert_eq!(decode_input(&encode_output(data)).unwrap(), data);
    }

    #[test]
    fn invalid_base64_is_rejected() {
        assert!(decode_input("not base64!!").is_err());
    }

    #[test]
    fn host_key_error_distinguishes_unknown_and_changed() {
        let offered = Arc::new(StdMutex::new(Some(OfferedKey {
            key_type: "ssh-ed25519".into(),
            fingerprint: "SHA256:new".into(),
            public_key: "AAAA".into(),
        })));

        let mut profile = ConnectProfile {
            address: "example.com".into(),
            port: 22,
            username: "root".into(),
            password: None,
            private_key: None,
            passphrase: None,
            known_hosts: vec![],
            accept_new_host: false,
            replace_host_key: false,
            cols: 80,
            rows: 24,
        };

        assert!(matches!(
            host_key_error(&profile, &offered),
            AppError::HostKeyUnknown { .. }
        ));

        profile.known_hosts.push(KnownKeySnapshot {
            key_type: "ssh-ed25519".into(),
            fingerprint: "SHA256:old".into(),
        });

        assert!(matches!(
            host_key_error(&profile, &offered),
            AppError::HostKeyChanged { .. }
        ));
    }
}
