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
| `EYAS_PORT` / `--port` | Listen-Port |
| Compose-Projektname | Mehrere Stacks |

## Verwandt

- [Native](/docs/de/deploy/native/)
- [Docker](/docs/de/deploy/docker/)
- [Planer](/docs/de/automation/scheduler/)
- [CLI](/docs/de/deploy/cli/)
