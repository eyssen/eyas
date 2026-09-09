---
title: OpenCode
description: Optionaler MIT-Coding-Engine-Sidecar mit Live-Webterminal in der Unterhaltung.
---

**Wozu das gut ist.** OpenCode ist ein Terminal-Coding-Agent (MIT, [opencode.ai](https://opencode.ai)). EYAS importiert **nicht** den privaten Kern und nicht dessen AI-SDKs. Offizieller Embed: lokaler HTTP-Server (`opencode serve` auf 127.0.0.1) plus POSIX-PTY nach xterm.js. Der Chat hydriert EYAS-Memory, `opencode_run` sendet die Aufgabe. Du kannst die TUI beobachten oder übernehmen.

**Route:** `/opencode`. Seitenleiste: **KI → OpenCode**. In der Unterhaltung das Terminal-Icon in der Kopfzeile.

## Wann

- Eine Coding-Aufgabe soll in OpenCodes eigener Schleife laufen.
- Du willst die TUI **sehen** oder hineintippen.
- OpenCode soll EYAS-Memory lesen und Diffs/Stdout nach L0 schreiben.

## Ablauf

1. **OpenCode** (`/opencode`) öffnen. **Nicht bereit:** CLI installieren oder `EYAS_OPENCODE_BIN`.
2. `opencode_status` / `opencode_run` am Agenten erlauben.
3. In der Unterhaltung das Terminal-Icon. Die PTY hängt an 127.0.0.1.
4. `opencode_run` anstoßen. Memory zuerst, dann Capture.

OpenCode nutzt **eigene Provider-Auth** (`opencode auth login` in der TUI).

## Verwandt

- [Werkzeuge](/docs/de/automation/tools/)
- [Speicher](/docs/de/knowledge/memory/)
- [Unterhaltungen](/docs/de/daily/conversations/)
