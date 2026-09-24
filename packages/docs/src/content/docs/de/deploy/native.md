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

## Claude Code auf dem Host

Installiere Claude Code (`claude`) im selben PATH wie EYAS oder setze `EYAS_CLAUDE_CODE_BIN` auf seinen absoluten Pfad — ein Dienst, den launchd oder systemd startet, hat oft einen kürzeren PATH als deine Shell. Der Anbieter ist erst verfügbar, wenn dieses Binary angemeldet ist (`claude auth status`). `eyas doctor` zeigt in seiner Zeile **Claude Code runtime**, welches Binary EYAS ausführt. Siehe [Anbieter — Claude-Code-Laufzeit](/docs/de/ai/providers/#claude-code-runtime).

## Workspaces bei einer Source-Installation

Eine Source-Installation, die aus einem Git-Clone läuft, hat ihr Datenverzeichnis in diesem Checkout; die Gesprächs-Workspaces landen deshalb im Anwendungsdaten-Verzeichnis deines Benutzers (etwa `~/Library/Application Support/eyas/<Instanz>/workspaces` unter macOS). Siehe [Konfiguration — Gesprächs-Workspaces](/docs/de/deploy/configuration/#conversation-workspaces).

## Verwandt

- [Docker](/docs/de/deploy/docker/)
- [Kubernetes](/docs/de/deploy/kubernetes/)
- [CLI](/docs/de/deploy/cli/)
- [Konfiguration](/docs/de/deploy/configuration/)
