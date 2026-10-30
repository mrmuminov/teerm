# Tauri + Rust SSH core

Teerm is a desktop SSH client that needs raw TCP and precise control over PTY, SFTP, and port forwarding, which a browser cannot provide. We chose Tauri with a Rust core (`russh`, `russh-sftp`) and a React + xterm.js frontend instead of Electron + Node `ssh2`: it ships a single small binary, avoids bundling a Node runtime, and keeps credentials and sockets inside the Rust process. The trade-off is more Rust code and a smaller SSH-library ecosystem than `ssh2`.
