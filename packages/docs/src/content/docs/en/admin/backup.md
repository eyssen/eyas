---
title: Backup & restore
description: Full restore archives locally, then optional offsite upload (S3/B2, FTP, Dropbox, SSH).
---

**What this is for.** Backup builds a **full restore package** for an empty machine: `data/` (DB, `master.key`, agents, vault…), `config/`, `.env`, `version.json` — not `backups/`, tmp, or runtime logs. Restore onto a **matching product version** empty install. Each archive is written locally first; a **primary** offsite destination then uploads it.

**Route:** `/backup`. Title: **Backup & Recovery**.

## When to use it

- You want a tarball you can unpack on a blank install of the **same** EYAS version.
- Offsite copies should land on S3-compatible storage (AWS, Backblaze B2, R2, MinIO), FTP/FTPS, Dropbox, or SSH/SFTP.
- Self-update requires a working Backup — Settings will block update until this page has produced archives.

## Typical workflow

1. Open **Backup** (`/backup`).
2. Optionally **Add destination** under **Offsite destinations**. Pick type, fill connection settings and secrets (paste keys *or* an env var name), **Save destination**, **Use for uploads** to make it primary.
3. **Create Backup**. The row shows filename, EYAS version, size, and **Uploaded** vs **Local copy**.
4. To restore: install the version from the table (`install.sh --version …`), **stop** the server, `tar -xzf` in the install root, `chmod 600 data/master.key .env`, `eyas start`.
5. In-app **Restore** overwrites current data (confirm). Prefer the empty-system path for a true rebuild.

## Features

| Concept | Meaning |
|---------|---------|
| Local backup | Archive under `data/backups/` |
| Remote destination | Optional upload after the local write |
| Version pin | Install the same version before restore |
| Primary | The destination used for uploads |

Empty: *No backups yet* — *Create a full backup so you can rebuild EYAS on a blank install from the archive alone (plus a git checkout of the code).*

**Empty-system restore** (on-page steps): 1) Install matching version  2) Stop server  3) `tar -xzf <backup>.tar.gz` in install root  4) `chmod 600 data/master.key .env`  5) `eyas start`.

## Fields and controls

<h2 id="archives">Archive table</h2>

| Column | Meaning |
|--------|---------|
| **Filename** | Archive name |
| **EYAS version** | Pin this version to restore |
| **Created** | When |
| **Size** | Bytes |
| **Offsite** | **Uploaded** / **Local copy** |
| **Restore** | Overwrite current data (confirm) |

<h2 id="destinations">Offsite destinations</h2>

Subtitle: *Each backup is written locally first, then uploaded to the primary destination (S3/B2, FTP, Dropbox, or SSH).*

| Type | Settings | Secrets |
|------|----------|---------|
| **S3-compatible (AWS, Backblaze B2, R2, MinIO)** | `endpoint`, `bucket`, `region`, `prefix` | `accessKeyId`, `secretAccessKey` |
| **FTP / FTPS** | `host`, `port`, `path`, `secure` | `username`, `password` |
| **Dropbox** | `path` | `accessToken` |
| **SSH / SFTP** | `host`, `port`, `path` | `username`, `password`, `privateKey`, `passphrase` |

| Control | Meaning |
|---------|---------|
| **Add destination** | Open the form |
| **Display name** | Label |
| **Use for uploads** | Mark primary |
| **Local only** | No offsite |
| Connection settings | Not secret |
| Secrets hint | *Paste the access keys. You can also type an env var name such as BACKUP_S3_ACCESS_KEY.* |

Empty destinations: *No remote destinations — backups stay only in data/backups/.*

## Related

- [Getting started](/docs/en/getting-started/)
- [System update](/docs/en/admin/settings/)
- [Secrets](/docs/en/admin/secrets/)
- [Data import](/docs/en/admin/data-port/)
