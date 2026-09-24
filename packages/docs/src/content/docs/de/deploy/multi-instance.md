---
title: Mehrere Instanzen
description: Getrenntes EYAS_HOME und Ports — nie zwei Schreiber auf einer SQLite-Datei.
---

**Wozu das da ist.** Eine Maschine kann mehrere EYAS laufen lassen. Isolation ist **Datenverzeichnis + Port**, nicht „zwei Prozesse, eine DB“. SQLite ist kein Multi-Writer-Cluster.

## Wann du es brauchst

- Zweite Instanz auf demselben Laptop ohne Vault-Mix.
- Docker: zweiter Compose-Projektname und Host-Port.
- Scheduler-Health **Leader / Follower**.

## Typischer Ablauf

1. Neues `EYAS_HOME` und freies `EYAS_PORT` (z. B. 3200).
2. Native: `EYAS_HOME=… EYAS_PORT=3200 eyas start`.
3. Docker: `EYAS_PORT=3200 docker compose -p eyas-dev up -d`.
4. Jede UI auf ihrem Port. **Nie** zwei Live-Instanzen auf dieselbe SQLite-Datei.

| Hebel | Zweck |
|-------|-------|
| `EYAS_HOME` | Getrennte data, pid, local.yaml |
| `EYAS_DATA_DIR` | Optional: das Datenverzeichnis einer Instanz woanders ablegen. Datenbank **und Speicher-Vault** (`<Datenverzeichnis>/vault`) ziehen mit |
| `EYAS_WORKSPACES_DIR` | Optional: wo die Gesprächs-Workspaces dieser Instanz liegen |
| `EYAS_PORT` / `--port` | Listen-Port |
| Compose-Projektname | Mehrere Stacks |

**Vaults und Workspaces bleiben getrennt.** Der Vault jeder Instanz ist `<Datenverzeichnis>/vault`; getrennte Datenverzeichnisse heißen also getrennte Vaults. Bei einer Source-Installation, die aus einem Git-Clone läuft, liegen die Gesprächs-Workspaces in einem Ordner pro Instanz, benannt nach dem EYAS-Home-Ordner plus einem kurzen Hash des Datenverzeichnisses — eine Dev- und eine Live-Instanz auf einer Maschine teilen sich also nie Workspaces. Setzt du `EYAS_WORKSPACES_DIR`, gib jeder Instanz einen eigenen Pfad. Siehe [Konfiguration — Gesprächs-Workspaces](/docs/de/deploy/configuration/#conversation-workspaces).

## Verwandt

- [Native](/docs/de/deploy/native/)
- [Docker](/docs/de/deploy/docker/)
- [Planer](/docs/de/automation/scheduler/)
- [CLI](/docs/de/deploy/cli/)
- [Konfiguration](/docs/de/deploy/configuration/)
