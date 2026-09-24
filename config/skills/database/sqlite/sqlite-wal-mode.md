---
name: sqlite-wal-mode
description: SQLite WAL mode configuration for concurrent read/write access
trigger_patterns:
  - "wal mode"
  - "sqlite wal"
  - "write ahead log"
  - "sqlite concurrent"
capabilities:
  - database
version: "1.0.0"
---
# SQLite WAL Mode

## What is WAL?
Write-Ahead Logging (WAL) is a journal mode where writes go to a separate WAL file instead of modifying the database directly. This enables concurrent reads during writes.

## Enabling WAL
```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;  -- safe with WAL, better performance than FULL
```

## How WAL Works
1. Writes append to the WAL file (`database.db-wal`)
2. Readers see a consistent snapshot from before the write started
3. Checkpointing merges WAL changes back into the main database
4. The shared memory file (`database.db-shm`) coordinates access

## Concurrency Model
- **Multiple readers**: unlimited concurrent read transactions
- **Single writer**: only one write transaction at a time
- **Readers do not block writers**: writes proceed while reads are active
- **Writers do not block readers**: existing reads see the pre-write state

## Checkpointing
```sql
-- Manual checkpoint (usually automatic)
PRAGMA wal_checkpoint(TRUNCATE);
```
- **PASSIVE**: checkpoint without blocking (default auto-checkpoint)
- **FULL**: wait for readers to finish, then checkpoint
- **TRUNCATE**: like FULL but also truncates the WAL file
- Auto-checkpoint triggers at 1000 WAL pages by default

## Configuration for Production
```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA wal_autocheckpoint = 1000;  -- pages (default)
PRAGMA busy_timeout = 5000;        -- wait up to 5s for locks
```

## WAL Limitations
- WAL file can grow large under heavy write load — monitor size
- Not suitable for network filesystems (NFS, SMB)
- Requires shared memory support from the OS
- Cannot change journal mode inside a transaction

## Best Practices
- Set WAL mode once at database creation — it persists
- Use `busy_timeout` to handle write contention gracefully
- Monitor WAL file size — trigger manual checkpoint if it grows too large
- Set `synchronous = NORMAL` (not OFF) for crash safety with WAL
- Back up the main DB file plus WAL and SHM files together
