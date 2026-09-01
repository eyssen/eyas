---
title: FAQ
description: Häufige Probleme.
---

### Port belegt
`EYAS_PORT=3200 ./bin/eyas start` oder den Prozess freigeben.

### Die UI liegt nicht auf Port 3000
Default-Listen-Port ist **3100**, damit Grafana/CRA auf :3000 frei bleiben. Öffne **http://localhost:3100**. Override: `EYAS_PORT` oder `server.port`. Docker: `"${EYAS_PORT:-3100}:3100"`.

### Keine UI
`bun run build:web` (automatisch beim Start, außer `EYAS_SKIP_WEB_BUILD=1`).

### /docs 404
`bun run docs:build` oder Neustart ohne `EYAS_SKIP_DOCS_BUILD`. Paket: `packages/docs`. Nicht `generate-full-docs.mjs` / `bun run full-docs` — überschreibt Prosa.

### Provider-Auth-Fehler
Key unter Anbieter/Geheimnisse neu eingeben; CLIs `claude`/`grok`/`kimi` in derselben Umgebung.

### Gespräche lesen ~/.claude / ~/.grok
Claude Code CLI: **Host-Claude-Config laden** **AUS** (Default). Isolierte Aufrufe setzen auch `CLAUDE_CODE_DISABLE_AUTO_MEMORY`. Grok/Kimi ACP **können nicht** isoliert werden. Siehe [Anbieter](/docs/de/ai/providers/).

### Dauerhafte Notizen werden geschrieben — ich will das aus
`memory.capture.enabled: false` in `local.yaml` (Default **true**). Aus = keine `memory_capture_runs`-Zeile. Siehe [Speicher](/docs/de/knowledge/memory/) und [Konfiguration](/docs/de/deploy/configuration/).

### Wo liegen Daten?
`$EYAS_HOME` oder cwd: `data/sqlite`, `data/vault`, `data/agents`, Backups, Logs.

### Wizard hängt nach Reload
Als Owner einloggen, `/setup` für optionale Restschritte.
