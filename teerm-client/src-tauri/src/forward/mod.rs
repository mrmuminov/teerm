use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use tokio::task::{JoinHandle, JoinSet};
use uuid::Uuid;

use crate::error::AppError;
use crate::ssh::{ForwardLink, SshManager};
use crate::vault::model::{ForwardKind, PortForward};

const CLOSED_CHECK_INTERVAL: Duration = Duration::from_secs(2);
const REMOTE_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Local endpoints that the server may reach through active Remote Forwards,
/// keyed by the address and port the server listens on.
pub type RemoteTargets = Arc<StdMutex<HashMap<(String, u32), (String, u16)>>>;

pub fn new_remote_targets() -> RemoteTargets {
    Arc::new(StdMutex::new(HashMap::new()))
}

/// Finds the local endpoint for a connection the server forwarded to us.
///
/// Servers do not always echo the bind address verbatim (`""`, `localhost`
/// and `0.0.0.0` are common), so an exact match is preferred and the port
/// alone is the fallback.
pub fn lookup_remote_target(
    targets: &HashMap<(String, u32), (String, u16)>,
    address: &str,
    port: u32,
) -> Option<(String, u16)> {
    if let Some(target) = targets.get(&(address.to_string(), port)) {
        return Some(target.clone());
    }

    targets
        .iter()
        .find(|((_, bound_port), _)| *bound_port == port)
        .map(|(_, target)| target.clone())
}

/// Connects a server-initiated forwarded connection to its local target and
/// pumps bytes in both directions until either side closes.
pub async fn serve_remote_connection<S>(
    targets: RemoteTargets,
    connected_address: String,
    connected_port: u32,
    stream: S,
) where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let target = targets
        .lock()
        .ok()
        .and_then(|targets| lookup_remote_target(&targets, &connected_address, connected_port));

    let Some((host, port)) = target else {
        return;
    };

    let connect = TcpStream::connect((host.as_str(), port));
    if let Ok(Ok(local)) = tokio::time::timeout(REMOTE_CONNECT_TIMEOUT, connect).await {
        bridge(local, stream).await;
    }
}

/// Copies bytes between two streams until one side closes.
pub async fn bridge<A, B>(mut first: A, mut second: B)
where
    A: AsyncRead + AsyncWrite + Unpin,
    B: AsyncRead + AsyncWrite + Unpin,
{
    let _ = tokio::io::copy_bidirectional(&mut first, &mut second).await;
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardStatus {
    pub session_id: Uuid,
    pub forward_id: Uuid,
    /// `running`, `stopped` or `failed`.
    pub state: &'static str,
    pub message: Option<String>,
}

type ForwardKey = (Uuid, Uuid);

enum Running {
    Local(JoinHandle<()>),
    Remote { bind_address: String, bind_port: u32 },
}

#[derive(Default)]
pub struct ForwardManager {
    running: Arc<Mutex<HashMap<ForwardKey, Running>>>,
}

impl ForwardManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn start(
        &self,
        app: &AppHandle,
        ssh: &SshManager,
        session_id: Uuid,
        forward: &PortForward,
    ) -> Result<(), AppError> {
        let key = (session_id, forward.id);
        if self.running.lock().await.contains_key(&key) {
            return Ok(());
        }

        let link = ssh.forward_link(session_id).await?;
        let entry = match forward.kind {
            ForwardKind::Local => self.start_local(app, link, key, forward).await?,
            ForwardKind::Remote => start_remote(&link, forward).await?,
        };

        self.running.lock().await.insert(key, entry);
        emit_status(app, session_id, forward.id, "running", None);
        Ok(())
    }

    pub async fn stop(
        &self,
        app: &AppHandle,
        ssh: &SshManager,
        session_id: Uuid,
        forward_id: Uuid,
    ) -> Result<(), AppError> {
        let entry = self
            .running
            .lock()
            .await
            .remove(&(session_id, forward_id))
            .ok_or_else(|| AppError::NotFound("running port forward".into()))?;

        match entry {
            Running::Local(task) => task.abort(),
            Running::Remote {
                bind_address,
                bind_port,
            } => {
                if let Ok(link) = ssh.forward_link(session_id).await {
                    let _ = link
                        .handle
                        .lock()
                        .await
                        .cancel_tcpip_forward(bind_address.clone(), bind_port)
                        .await;
                    if let Ok(mut targets) = link.remote_targets.lock() {
                        targets.remove(&(bind_address, bind_port));
                    }
                }
            }
        }

        emit_status(app, session_id, forward_id, "stopped", None);
        Ok(())
    }

    /// Drops every forward owned by a Session that is going away.
    pub async fn stop_session(&self, app: &AppHandle, session_id: Uuid) {
        let mut running = self.running.lock().await;
        let keys: Vec<ForwardKey> = running
            .keys()
            .filter(|(owner, _)| *owner == session_id)
            .copied()
            .collect();

        for key in keys {
            if let Some(Running::Local(task)) = running.remove(&key) {
                task.abort();
            }
            emit_status(app, session_id, key.1, "stopped", None);
        }
    }

    pub fn report_failure(
        &self,
        app: &AppHandle,
        session_id: Uuid,
        forward_id: Uuid,
        message: String,
    ) {
        emit_status(app, session_id, forward_id, "failed", Some(message));
    }

    pub async fn status(&self, session_id: Uuid) -> Vec<ForwardStatus> {
        self.running
            .lock()
            .await
            .keys()
            .filter(|(owner, _)| *owner == session_id)
            .map(|(_, forward_id)| ForwardStatus {
                session_id,
                forward_id: *forward_id,
                state: "running",
                message: None,
            })
            .collect()
    }

    async fn start_local(
        &self,
        app: &AppHandle,
        link: ForwardLink,
        key: ForwardKey,
        forward: &PortForward,
    ) -> Result<Running, AppError> {
        let listener = TcpListener::bind((forward.bind_address.as_str(), forward.bind_port))
            .await
            .map_err(|error| {
                AppError::Io(format!(
                    "could not listen on {}:{}: {error}",
                    forward.bind_address, forward.bind_port
                ))
            })?;

        let task = tokio::spawn(accept_local(
            listener,
            link,
            forward.target_host.clone(),
            forward.target_port,
            Arc::clone(&self.running),
            app.clone(),
            key,
        ));

        Ok(Running::Local(task))
    }
}

async fn start_remote(link: &ForwardLink, forward: &PortForward) -> Result<Running, AppError> {
    let bind_port = u32::from(forward.bind_port);

    link.handle
        .lock()
        .await
        .tcpip_forward(forward.bind_address.clone(), bind_port)
        .await
        .map_err(|error| {
            AppError::Internal(format!(
                "the server refused to listen on {}:{}: {error}",
                forward.bind_address, forward.bind_port
            ))
        })?;

    if let Ok(mut targets) = link.remote_targets.lock() {
        targets.insert(
            (forward.bind_address.clone(), bind_port),
            (forward.target_host.clone(), forward.target_port),
        );
    }

    Ok(Running::Remote {
        bind_address: forward.bind_address.clone(),
        bind_port,
    })
}

/// Accepts local connections and tunnels each one to the remote target.
/// Ends, and unregisters itself, once the SSH connection has gone away.
async fn accept_local(
    listener: TcpListener,
    link: ForwardLink,
    target_host: String,
    target_port: u16,
    running: Arc<Mutex<HashMap<ForwardKey, Running>>>,
    app: AppHandle,
    key: ForwardKey,
) {
    let mut connections = JoinSet::new();
    let mut interval = tokio::time::interval(CLOSED_CHECK_INTERVAL);

    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let Ok((socket, peer)) = accepted else { continue };
                let handle = Arc::clone(&link.handle);
                let target_host = target_host.clone();
                connections.spawn(async move {
                    let channel = handle
                        .lock()
                        .await
                        .channel_open_direct_tcpip(
                            target_host,
                            u32::from(target_port),
                            peer.ip().to_string(),
                            u32::from(peer.port()),
                        )
                        .await;
                    if let Ok(channel) = channel {
                        bridge(socket, channel.into_stream()).await;
                    }
                });
            }
            _ = interval.tick() => {
                while connections.try_join_next().is_some() {}
                if link.handle.lock().await.is_closed() {
                    break;
                }
            }
        }
    }

    running.lock().await.remove(&key);
    emit_status(&app, key.0, key.1, "stopped", Some("session ended".into()));
}

fn emit_status(
    app: &AppHandle,
    session_id: Uuid,
    forward_id: Uuid,
    state: &'static str,
    message: Option<String>,
) {
    let _ = app.emit(
        "ssh:forward-status",
        ForwardStatus {
            session_id,
            forward_id,
            state,
            message,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn targets(entries: &[(&str, u32, &str, u16)]) -> HashMap<(String, u32), (String, u16)> {
        entries
            .iter()
            .map(|(address, port, host, target)| {
                ((address.to_string(), *port), (host.to_string(), *target))
            })
            .collect()
    }

    #[test]
    fn lookup_prefers_the_exact_bind_address() {
        let map = targets(&[
            ("127.0.0.1", 8080, "localhost", 3000),
            ("0.0.0.0", 8080, "localhost", 4000),
        ]);

        assert_eq!(
            lookup_remote_target(&map, "0.0.0.0", 8080),
            Some(("localhost".into(), 4000))
        );
    }

    #[test]
    fn lookup_falls_back_to_the_port_when_the_server_rewrites_the_address() {
        let map = targets(&[("localhost", 8080, "127.0.0.1", 3000)]);

        assert_eq!(
            lookup_remote_target(&map, "", 8080),
            Some(("127.0.0.1".into(), 3000))
        );
    }

    #[test]
    fn lookup_ignores_unknown_ports() {
        let map = targets(&[("localhost", 8080, "127.0.0.1", 3000)]);

        assert_eq!(lookup_remote_target(&map, "localhost", 9090), None);
    }

    #[tokio::test]
    async fn bridge_pumps_bytes_both_ways_and_ends_when_one_side_closes() {
        let (client, client_side) = tokio::io::duplex(64);
        let (server, server_side) = tokio::io::duplex(64);
        let pump = tokio::spawn(bridge(client_side, server_side));

        let (mut client, mut server) = (client, server);
        client.write_all(b"ping").await.unwrap();
        let mut buffer = [0u8; 4];
        server.read_exact(&mut buffer).await.unwrap();
        assert_eq!(&buffer, b"ping");

        server.write_all(b"pong").await.unwrap();
        client.read_exact(&mut buffer).await.unwrap();
        assert_eq!(&buffer, b"pong");

        // `copy_bidirectional` only returns once both directions have ended.
        drop(client);
        drop(server);
        pump.await.unwrap();
    }

    #[tokio::test]
    async fn remote_connection_is_dropped_when_no_target_is_registered() {
        let (_client, server_side) = tokio::io::duplex(64);

        tokio::time::timeout(
            Duration::from_secs(1),
            serve_remote_connection(new_remote_targets(), "localhost".into(), 8080, server_side),
        )
        .await
        .expect("must return immediately without a registered target");
    }

    #[tokio::test]
    async fn remote_connection_reaches_the_registered_local_target() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let local_port = listener.local_addr().unwrap().port();
        let echo = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = [0u8; 5];
            socket.read_exact(&mut buffer).await.unwrap();
            socket.write_all(&buffer).await.unwrap();
        });

        let registered = new_remote_targets();
        registered
            .lock()
            .unwrap()
            .insert(("localhost".into(), 8080), ("127.0.0.1".into(), local_port));

        let (mut client, server_side) = tokio::io::duplex(64);
        tokio::spawn(serve_remote_connection(
            registered,
            "localhost".into(),
            8080,
            server_side,
        ));

        client.write_all(b"hello").await.unwrap();
        let mut buffer = [0u8; 5];
        client.read_exact(&mut buffer).await.unwrap();
        assert_eq!(&buffer, b"hello");
        echo.await.unwrap();
    }
}
