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

**CLI-Anmeldungen sind im Archiv.** Die Anmeldungen von Grok CLI und Kimi Code CLI für EYAS liegen in `data/cli-homes/grok-cli/.grok/auth.json` und `data/cli-homes/kimi-cli/.kimi/credentials/kimi-code.json`, ein Backup des Datenverzeichnisses enthält sie also. Behandle das Archiv wie ein Zugangsdatum, genau wie `master.key`. Siehe [Anbieter — Grok und Kimi für EYAS anmelden](/docs/de/ai/providers/#sign-in-grok-and-kimi-for-eyas).

## Was das Archiv auslässt

| Nicht im Archiv | Warum / was tun |
|-----------------|-----------------|
| `backups/`, tmp, Runtime-Pid und -Log | Für den Wiederaufbau nicht nötig |
| CLI-Session-Stores unter `data/cli-homes/*/sessions` | Wegwerf-Transkripte der CLIs, die EYAS nie fortsetzt (EYAS löscht sie außerdem nach jedem Zug) |
| Gesprächs-Workspaces außerhalb des Datenverzeichnisses | Bei einer Source-Installation aus einem Git-Clone oder mit gesetztem `EYAS_WORKSPACES_DIR` liegen Workspaces außerhalb von `data/` (siehe [Konfiguration — Gesprächs-Workspaces](/docs/de/deploy/configuration/#conversation-workspaces)). Ausgabedateien von Agenten bleiben trotzdem erhalten: Sie werden als Gesprächsanhänge in die Dokumente kopiert, und die sind gesichert. |
| Ein mit `EYAS_DATA_DIR` verschobenes Datenverzeichnis | Das Archiv deckt `<EYAS-Home>/data` ab. Zeigt `EYAS_DATA_DIR` woandershin, nimm diesen Ordner — er enthält Datenbank und Speicher-Vault — in deine eigenen Backups auf. |

## Verwandt

- [Erste Schritte](/docs/de/getting-started/)
- [System-Update](/docs/de/admin/settings/)
- [Geheimnisse](/docs/de/admin/secrets/)
- [Datenimport](/docs/de/admin/data-port/)
