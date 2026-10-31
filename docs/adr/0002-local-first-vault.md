# Local-first vault, no account in v1

The first release is a free personal tool, while the long-term direction is a SaaS product. We chose a local-first, encrypted Vault unlocked by a Master Password, with no account or server in v1; portability comes from Export/Import rather than sync. This avoids server cost and trust in v1 while keeping the door open: stable IDs, timestamps, and tombstone-friendly deletion let a sync service be added later without changing the core model. The trade-off is no multi-device sync, and password recovery only through an optional Recovery Phrase (see below).

## Amendment: optional Recovery Phrase

Recovery was originally ruled out. A forgotten Master Password is now recoverable if the user opted into a 24-word BIP39 Recovery Phrase. The payload is encrypted by a random data key that the Master Password wraps (format version 2); the Recovery Phrase wraps the same key under its own salt, so it survives password changes. The phrase is generated locally, shown once, and never stored, so the no-account, no-server property is unchanged. The trade-off is that the phrase is a second secret that opens the Vault: anyone who holds it has full access, and losing both it and the password still loses the Vault.
