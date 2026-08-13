---
title: Erste Schritte
description: EYAS installieren, Server starten, Setup-Assistent, UI öffnen.
---

## Ablauf

1. EYAS installieren (nativ oder Docker)
2. Server starten
3. [Setup-Assistent](/docs/de/setup-wizard/) durchlaufen
4. Web-UI öffnen und arbeiten

## Voraussetzungen

| Anforderung | Hinweis |
|-------------|---------|
| **Bun 1.x** (empfohlen) oder **Node.js 22+** | Primäre Runtime: Bun |
| Speicherplatz | SQLite, Vault, Agent-Workspaces unter `data/` |
| Optional: Docker Compose | Container-Betrieb |
| Optional: Host-CLIs | `claude`, `grok`, `kimi` für keyless lokale Provider |

## Native Installation

```bash
git clone https://github.com/eyssen/eyas.git
cd eyas
bun install
./bin/eyas start
```

**http://localhost:3100** (Default-Port aus `config/default.yaml` — **3100**, nicht 3000).

Vordergrund (Logs im Terminal):

```bash
./bin/eyas serve
```

### One-Line-Installer

```bash
curl -fsSL https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.sh | bash
```

Nicht-interaktiv: `bash -s -- --yes`. Version pinnen: `--version 0.8.8-beta`. Windows: `scripts/install.ps1`.

## Docker

```bash
git clone https://github.com/eyssen/eyas.git
cd eyas
docker compose up -d
```

GPU + Ollama: `docker compose --profile gpu up -d`.

## Lebenszyklus-Befehle

| Befehl | Funktion |
|--------|----------|
| `eyas serve` | HTTP-Server im Vordergrund |
| `eyas start` | Hintergrund (Pidfile + Log) |
| `eyas stop` | Stoppen |
| `eyas restart` | Neu starten |
| `eyas status` | Health + PID |
| `eyas doctor` | Lokale Diagnose |
| `eyas version` | Version |

Beim Start werden **Frontend** und **Produktdocs** bei Bedarf neu gebaut (`build:web`, `docs:build`), außer `EYAS_SKIP_WEB_BUILD=1` / `EYAS_SKIP_DOCS_BUILD=1`.

## Erster Login

| Schritt | Ergebnis |
|---------|----------|
| Browser → `/setup` | [Setup-Assistent](/docs/de/setup-wizard/) |
| Nach Setup | Login als **Root-Owner** |
| Home | [Dashboard](/docs/de/daily/dashboard/) |
| Docs | **`/docs/`** auf demselben Host/Port |

## Datenablage

Unter `$EYAS_HOME` bzw. Startverzeichnis:

| Pfad | Inhalt |
|------|--------|
| `data/sqlite/` | Hauptdatenbank (WAL) |
| `data/vault/` | Semantic/procedural Markdown |
| `data/agents/<id>/` | Agent-Workspace |
| `data/backups/` | Backups |
| `config/` | YAML + lokale Overlays |

## Weiter

- [Setup-Assistent](/docs/de/setup-wizard/)
- [Grundkonzepte](/docs/de/concepts/)
- [CLI](/docs/de/deploy/cli/)
