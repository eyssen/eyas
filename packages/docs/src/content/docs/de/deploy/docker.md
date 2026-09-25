---
title: Docker
description: Compose ein Container (plus optionales GPU-Ollama). Port 3100. data/ persistieren.
---

**Wozu das da ist.** Zweiter Install-Pfad: ein `eyas`-Service, `data/`-Volume, optionales **gpu**-Profil für Ollama. Wenn Docker da ist und Bun nicht auf den Host soll. Image: Backend, Frontend-Dist, Docs unter `/docs/`. Listen-Port **3100**.

## Wann du es brauchst

- Server hat Docker, kein Host-Bun.
- Zweiter Stack (`-p eyas-dev` + `EYAS_PORT=3200`).
- Optionales lokales Ollama mit NVIDIA (`--profile gpu`).

## Typischer Ablauf

1. Clonen. Optional `.env`.
2. `docker compose up -d`. **http://localhost:3100**.
3. Volume `eyas-data`. `./config` read-only wie geliefert.
4. `docker compose logs -f` / `down`.
5. GPU: `docker compose --profile gpu up -d`.

Mapping: `"${EYAS_PORT:-3100}:3100"` — 3100, damit Grafana/CRA auf :3000 frei bleibt. Mehrere Stacks: [Mehrere Instanzen](/docs/de/deploy/multi-instance/).

## Claude Code im Container

Das Image enthält die Claude-Code-CLI nicht. Ohne eine greift EYAS auf die ältere Kopie zurück, die in seiner Agent-SDK-Abhängigkeit steckt (derzeit 2.1.89), und `eyas doctor` warnt davor. Für ein aktuelles Claude Code installierst du es in einem abgeleiteten Image oder mountest es und setzt `EYAS_CLAUDE_CODE_BIN` auf seinen absoluten Pfad. Melde dich mit `ANTHROPIC_API_KEY` oder einem bereitgestellten Login an: Der Anbieter ist erst verfügbar, wenn dieses Binary angemeldet ist. Siehe [Anbieter — Claude-Code-Laufzeit](/docs/de/ai/providers/#claude-code-runtime).

<h2 id="grok-and-kimi-in-a-container">Grok und Kimi im Container</h2>

Grok CLI und Kimi Code CLI laufen in EYAS' eigenem Home im Datenvolume (`data/cli-homes/…`), also werden sie **für EYAS** angemeldet, nicht mit einem Login, der ins Image gebacken ist. Nutze **Mit Gerätecode anmelden** im Anbieter-Panel: EYAS zeigt einen Link und einen Code, und du bestätigst ihn in einem Browser auf einem beliebigen anderen Gerät — im Container ist kein Browser nötig. Grok akzeptiert auch einen xAI-API-Schlüssel, der in den Geheimnissen gespeichert wird. Die Anmeldungen liegen im Volume `eyas-data` und überleben Container-Neustarts. Ein Binary, das nicht im PATH des Containers liegt, gibst du EYAS mit `EYAS_GROK_BIN` / `EYAS_KIMI_BIN` an. Siehe [Anbieter — Grok und Kimi für EYAS anmelden](/docs/de/ai/providers/#sign-in-grok-and-kimi-for-eyas).

<h2 id="kernel-file-sandbox-in-a-container">Kernel-Datei-Sandbox im Container</h2>

Das EYAS-Image enthält bubblewrap **nicht**: Es steht unter LGPL, die Installation ist also deine Entscheidung. Ohne bubblewrap laufen die eigenen Werkzeuge der CLI-Anbieter (die Shell von Claude Code, die Werkzeuge von Grok CLI) ohne Kernel-Datei-Sandbox; EYAS lehnt trotzdem jede Anfrage ab, die es sieht, das Anbieter-Panel zeigt die Sandbox als *Auf diesem Server nicht verfügbar*, und mit `security.cliSandbox: required` werden CLI-Züge mit Werkzeugen abgelehnt. Für die Kernel-Schicht installierst du bubblewrap (`bwrap`) — für Claude Code zusätzlich `socat` — in einem abgeleiteten Image und startest den Container mit aktivierten unprivilegierten User-Namespaces. `eyas doctor` (`docker compose exec eyas eyas doctor`) zeigt das Ergebnis in seiner Zeile **CLI sandbox**. Siehe [Anbieter — Kernel-Datei-Sandbox](/docs/de/ai/providers/#kernel-file-sandbox).

## Zeitzone

Container laufen meist in UTC. Datum und Uhrzeit, die EYAS dem Modell nennt, folgen `i18n.timezone`, sonst dem `TZ` des Containers — siehe [Konfiguration — Zeitzone](/docs/de/deploy/configuration/#time-zone-of-the-models-clock).

## Verwandt

- [Native](/docs/de/deploy/native/)
- [Kubernetes](/docs/de/deploy/kubernetes/)
- [Mehrere Instanzen](/docs/de/deploy/multi-instance/)
