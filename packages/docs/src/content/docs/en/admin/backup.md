---
title: Backup & restore
description: Create archives and restore onto a clean install.
---

**Route:** `/backup`.

Create backups of data (SQLite, vault, keys metadata as packaged). Restore onto a **matching product version** empty install — see README “Backup & empty-system restore”.

| Concept | Meaning |
|---------|---------|
| Local backup | Archive under `data/backups/` |
| Remote destination | Optional S3-compatible upload (paste keys or env var names) |
| Version pin | Install same version before restore |

## Related

- [Getting started](/docs/en/getting-started/)
- [System update](/docs/en/admin/settings/)
