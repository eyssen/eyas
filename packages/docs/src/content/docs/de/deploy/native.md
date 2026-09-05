---
title: Native Installation
description: Bun auf dem Host — Clone oder Installer, dann eyas start. Laptop oder einfacher VPS.
---

**Wozu das da ist.** Native ist einer von drei Wegen (native / Docker / Kubernetes). Wähle **native**, wenn Bun auf der Maschine soll, Host-CLIs (`claude`, `grok`, `kimi`) auf demselben PATH, wenig bewegliche Teile. UI: **http://localhost:3100** — nicht 3000.

Siehe [Erste Schritte](/docs/de/getting-started/).

## Wann du es brauchst

- Entwicklerlaptop oder einzelner VPS mit Bun 1.x (oder Node 22+).
- Host-CLI-Anbieter ohne Container.
- Backup-Restore auf `--version`-gleiche Installation.

## Typischer Ablauf

1. Bun 1.x (oder Node 22+).
2. `git clone` + `bun install` **oder** `scripts/install.sh` / `install.ps1`.
3. `bin/` auf `PATH`.
4. `./bin/eyas start` oder `./bin/eyas serve`.
5. **http://localhost:3100**, [Setup-Assistent](/docs/de/setup-wizard/).

One-liner: `curl -fsSL https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.sh | bash`. Pin: `--version 0.8.16-beta`.

## Verwandt

- [Docker](/docs/de/deploy/docker/)
- [Kubernetes](/docs/de/deploy/kubernetes/)
- [CLI](/docs/de/deploy/cli/)
- [Konfiguration](/docs/de/deploy/configuration/)
