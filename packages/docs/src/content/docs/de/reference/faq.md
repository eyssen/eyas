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
Key unter Anbieter/Geheimnisse neu eingeben. Für Claude Code: `claude` in derselben Umgebung angemeldet. Grok und Kimi werden im jeweiligen Anbieter-Panel für EYAS angemeldet, nicht auf dem Host.

### Gespräche lesen ~/.claude / ~/.grok
Das geht nicht mehr. Claude Code läuft immer isoliert — keine Host-`CLAUDE.md`, Einstellungen, Hooks, Skills, MCP-Server oder Auto-Memory und keine Transkripte unter `~/.claude/projects`; der alte Schalter **Host-Claude-Config laden** ist weg. Grok CLI und Kimi Code CLI laufen in ihrem eigenen EYAS-Home und sehen `~/.grok`, `~/.kimi` oder `~/.claude` nie. Das Security-Gate verweigert jedem Modell Lesen wie Schreiben im Speicher anderer Werkzeuge, und Speicher-MCP-Server sind gesperrt. Um dieses Wissen in EYAS zu holen, importiere es einmal über **Einstellungen → System → Datenportabilität → Daten importieren**. Siehe [Anbieter — Claude-Code-Isolation](/docs/de/ai/providers/#claude-code-isolation) und [Speicher](/docs/de/knowledge/memory/#memory-outside-eyas-is-refused).

### Grok oder Kimi antworten nach dem Upgrade nicht mehr
Grok CLI und Kimi Code CLI laufen jetzt in EYAS' eigenem Home, die Anmeldung der CLI auf dem Rechner wird also nicht genutzt. Melde dich einmal für EYAS an: **Anbieter → Grok CLI / Kimi Code CLI → Für EYAS anmelden** (Gerätecode; Grok nimmt auch einen xAI-API-Schlüssel). Bis dahin zeigt die Karte **Anmeldung erforderlich**, und Züge scheitern mit *… ist nicht für EYAS angemeldet*. Siehe [Anbieter — Grok und Kimi für EYAS anmelden](/docs/de/ai/providers/#sign-in-grok-and-kimi-for-eyas).

### Ein Zug scheiterte mit „konnte nicht bestätigen, dass es isoliert läuft"
EYAS hat auf dem Host etwas gefunden, das die Isolation der CLI brechen würde — etwa einen zusätzlichen MCP-Server, Hook, ein Plugin oder einen Skill, eine systemweite Grok-Konfiguration oder eine verwaltete Claude-Code-Policy, die einen anderen Berechtigungsmodus erzwingt. Entferne die Ursache und schicke die Nachricht erneut; der Zug wird nie an ein anderes Modell übergeben. Siehe [Anbieter — Isolationsprüfung](/docs/de/ai/providers/#isolation-check-before-every-turn) und [Claude-Code-Isolation](/docs/de/ai/providers/#claude-code-isolation).

### Ein MCP-Server zeigt „Gesperrt: Speicher"
Er führt einen zweiten Speicher außerhalb von EYAS (Memory, Qdrant, Obsidian, MCPVault, …) oder zeigt auf einen geschützten Ordner, deshalb startet EYAS ihn nie. Bearbeite ihn so, dass er woandershin zeigt, oder lösche ihn, und hole diesen Speicher mit dem Datenimport herein. Siehe [MCP](/docs/de/ai/mcp/#memory-store-servers-are-blocked).

### Claude Code ist installiert, aber der Anbieter ist nicht verfügbar
EYAS braucht das Claude-Code-Binary **angemeldet**, nicht nur im PATH: claude.ai-Login, `ANTHROPIC_API_KEY` oder ein Bedrock-/Vertex-Setup. Prüfe `eyas doctor` — die Zeile **Claude Code runtime** zeigt, welches Binary EYAS ausführt und ob es angemeldet ist. Dem PATH eines Dienstes kann `claude` fehlen; setze `EYAS_CLAUDE_CODE_BIN` auf seinen absoluten Pfad. Nach der Anmeldung den Anbieter unter Anbieter aus- und wieder einschalten oder neu starten. Siehe [Anbieter — Claude-Code-Laufzeit](/docs/de/ai/providers/#claude-code-runtime).

### Dauerhafte Notizen werden geschrieben — ich will das aus
`memory.capture.enabled: false` in `local.yaml` (Default **true**). Aus = keine `memory_capture_runs`-Zeile. Siehe [Speicher](/docs/de/knowledge/memory/) und [Konfiguration](/docs/de/deploy/configuration/).

### Wo liegen Daten?
`$EYAS_HOME` oder cwd: `data/sqlite`, `data/vault`, `data/agents`, Backups, Logs. `EYAS_DATA_DIR` verschiebt das ganze Datenverzeichnis; der Vault zieht mit (`<Datenverzeichnis>/vault`). Gesprächs-Workspaces einer Source-Installation aus einem Git-Clone liegen im Anwendungsdaten-Verzeichnis deines Benutzers — siehe [Konfiguration](/docs/de/deploy/configuration/#conversation-workspaces).

### Ich habe EYAS_DATA_DIR gesetzt, und meine Speicher-Notizen fehlen
Frühere Versionen ließen den Vault in `<EYAS-Home>/data/vault`, selbst wenn `EYAS_DATA_DIR` woandershin zeigte. Der erste Start nach dem Upgrade kopiert diese Notizen einmal nach `<Datenverzeichnis>/vault`, aber nur, solange der neue Vault keine Notiz enthält. Führe `eyas doctor` aus: Seine Zeile **Vault** sagt, ob eine Kopie aussteht oder ob der alte Ordner nicht mehr genutzt wird, weil beide Notizen enthalten — dann kopiere jede Notiz, die du noch brauchst, von Hand. Siehe [Konfiguration — Datenverzeichnis und Vault](/docs/de/deploy/configuration/#data-directory-and-vault).

### Das Modell bekommt die falsche Ortszeit
`i18n.timezone` (ein IANA-Name wie `Europe/Berlin`) in `local.yaml` setzen und neu starten. Nicht gesetzt nutzt EYAS die Zone des Servers — `TZ`, sonst das Betriebssystem; Container laufen meist in UTC. Siehe [Konfiguration](/docs/de/deploy/configuration/#time-zone-of-the-models-clock).

### Wizard hängt nach Reload
Als Owner einloggen, `/setup` für optionale Restschritte.
