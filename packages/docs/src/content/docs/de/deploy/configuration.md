---
title: Konfiguration
description: YAML-Defaults, lokale Overlays, Env-Rangfolge — nach gewähltem Install-Pfad.
---

**Wozu das da ist.** Listen-Adresse, Module, Autonomie, Memory-Capture und Verify-Commands ohne Rebuild. `local.yaml` und `EYAS_*` — nicht `config/default.yaml` wenn vermeidbar.

## Wann du es brauchst

- Host/Port, Log-Level, Modul aus.
- Durable-Memory-Capture aus (`memory.capture.enabled: false`) — Default an.
- `agent.verifyCommands`, damit ein Coding-Lauf nicht „fertig“ ist bevor Tests laufen.
- Mehrere Odoo-Checkouts via `EYAS_ODOO_SOURCES_JSON`.

## Typischer Ablauf

1. `local.yaml` anlegen.
2. Nur nötige Keys. `eyas config validate`.
3. `eyas restart` oder `eyas config reload`.
4. Einstellungen + `eyas doctor`.

Rangfolge: CLI-Flags → `EYAS_*` → local YAML → default YAML.

```yaml
memory:
  capture:
    enabled: true
    minUserChars: 40
    maxPerConversation: 20
```

`agent.verifyCommands` ohne Shell. `EYAS_AUTO_FAILOVER` füllt leere Routing-Fallbacks. `EYAS_BROWSER_USER_DATA_DIR` ist das EYAS-eigene Headless-Profil (nie das tägliche Chrome-Profil). `EYAS_AGENT_BROWSER_BIN` zeigt auf die optionale agent-browser-CLI (sonst PATH; gesetzter fehlender Pfad = fail-closed). Siehe [Speicher](/docs/de/knowledge/memory/), [FAQ](/docs/de/reference/faq/).

## Verwandt

- [CLI](/docs/de/deploy/cli/)
- [Anbieter](/docs/de/ai/providers/)
- [Routing & Budget](/docs/de/ai/routing-budget/)
- [Speicher](/docs/de/knowledge/memory/)
