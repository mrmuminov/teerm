# Local-first vault, no account in v1

The first release is a free personal tool, while the long-term direction is a SaaS product. We chose a local-first, encrypted Vault unlocked by a Master Password, with no account or server in v1; portability comes from Export/Import rather than sync. This avoids server cost and trust in v1 while keeping the door open: stable IDs, timestamps, and tombstone-friendly deletion let a sync service be added later without changing the core model. The trade-off is no multi-device sync and no password recovery.
