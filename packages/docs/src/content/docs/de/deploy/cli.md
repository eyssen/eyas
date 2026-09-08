---
title: CLI-Referenz
description: eyas serve/start/stop/doctor/config/module — denselben Install-Pfad bedienen.
---

**Wozu das da ist.** Das Binary `eyas` startet, stoppt, diagnostiziert und schaltet Module. Derselbe Prozess, dasselbe `EYAS_HOME`.

## Wann du es brauchst

- Vordergrund (`serve`) für Logs, Hintergrund (`start` + Pidfile).
- `doctor` vor einem Bugreport.
- Modul ohne YAML-Handarbeit.
- Neuere Version auf GitHub (`eyas update check`).

## Typischer Ablauf

1. [Native](/docs/de/deploy/native/) oder [Docker](/docs/de/deploy/docker/).
2. `eyas doctor`.
3. `eyas serve` oder `eyas start`. `eyas status`.
4. Nach YAML: `eyas config validate`.
5. `eyas stop` / `eyas restart`.

Befehle: serve, start, stop, restart, status, doctor, version, config validate/reload, module list/enable/disable, update check, migrate (v1→v2, kein Daily-Ops). Default-Port **3100**. `EYAS_SKIP_DOCS_BUILD=1` → `/docs` 404. Siehe [FAQ](/docs/de/reference/faq/).

## Was `doctor` prüft

Zwei seiner Zeilen sind neu in 0.8.23-beta, beide betreffen die Rohaufzeichnung des Speichers.

| Zeile | Bedeutung |
|-------|-----------|
| **SQLite** | Ein Selbsttest auf einer flüchtigen In-Memory-Datenbank — deine Datendatei wird nie geöffnet. Meldet die SQLite-Version, ob **FTS5** vorhanden ist (ohne FTS5 ein Fehler: Speicher-, Gesprächs- und Vault-Suche brauchen es) und ob die Erweiterung `sqlite-vec` lädt — geprüft, indem tatsächlich eine Zeile eingefügt und eine Nearest-Neighbour-Abfrage ausgeführt wird, statt nur die Version abzufragen. Eine fehlende Erweiterung ist eine Warnung samt Abhilfe für deine Plattform, kein Fehler. |
| **zstd** | Welche Kompressions-Implementierung die Rohaufzeichnung nutzt: die native von Bun, die von Node (22.15 oder neuer) oder der mitgelieferte WASM-Fallback. Der Fallback ist eine Warnung — er funktioniert und ist etwa doppelt so langsam. Gar keine Implementierung ist ein Fehler; EYAS zeichnet dann nichts auf, statt einen Puffer zu füllen, den es nie schreiben kann. |

## Verwandt

- [Konfiguration](/docs/de/deploy/configuration/)
- [Native](/docs/de/deploy/native/)
- [FAQ](/docs/de/reference/faq/)
