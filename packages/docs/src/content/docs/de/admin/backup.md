---
title: Sicherung & Wiederherstellung
description: Volles Restore-Archiv lokal, dann optionales Offsite (S3/B2, FTP, Dropbox, SSH).
---

**Wozu das da ist.** Backup baut ein **volles Restore-Paket** für eine leere Maschine: `data/` (DB, `master.key`, Agenten, Vault…), `config/`, `.env`, `version.json` — nicht `backups/`, tmp, Runtime-Logs. Restore auf **gleiche Produktversion**. Lokal zuerst, dann Upload zum **Primary**-Ziel.

**Route:** `/backup`. Sidebar: **Sicherung**.

## Wann du es brauchst

- Tarball für eine leere, **gleiche** EYAS-Version.
- Offsite: S3-kompatibel (AWS, Backblaze B2, R2, MinIO), FTP/FTPS, Dropbox, SSH/SFTP.
- Self-Update verlangt funktionierendes Backup.

## Typischer Ablauf

1. **Sicherung**.
2. Optional **Ziel hinzufügen**, Typ, Settings, Secrets (Key *oder* Env-Name), **Als Upload-Ziel**.
3. **Sicherung erstellen**. Zeile: Dateiname, Version, Größe, **Hochgeladen** / **Nur lokal**.
4. Restore: Version aus der Tabelle installieren, Server stoppen, `tar -xzf`, `chmod 600 data/master.key .env`, `eyas start`.
5. In-App **Wiederherstellen** überschreibt (Bestätigen).

Typen: S3 (`endpoint`, `bucket`, `region`, `prefix` + Keys), FTP, Dropbox, SSH/SFTP.

## Verwandt

- [Erste Schritte](/docs/de/getting-started/)
- [System-Update](/docs/de/admin/settings/)
- [Geheimnisse](/docs/de/admin/secrets/)
- [Datenimport](/docs/de/admin/data-port/)
