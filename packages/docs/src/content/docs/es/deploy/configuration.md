---
title: Configuración
description: YAML por defecto, overlays locales, precedencia de env — después de elegir un camino de instalación.
---

**Para qué sirve.** Dirección de escucha, módulos, autonomía, capture de memoria y verify commands sin reconstruir. `local.yaml` y `EYAS_*` — no `config/default.yaml` si puedes evitarlo.

## Cuándo usarlo

- Host/puerto, nivel de log, desactivar un módulo.
- Capture de memoria durable off (`memory.capture.enabled: false`) — por defecto on.
- Carpetas extra de skills o personas (`skills.importRoots` / `agent.importRoots`) sin encender la config Claude del host.
- `agent.verifyCommands` para que una corrida de código no esté «lista» hasta que pasen los tests.
- Varios checkouts Odoo vía `EYAS_ODOO_SOURCES_JSON`.

## Flujo típico

1. Crea `local.yaml`.
2. Solo las claves que necesitas. `eyas config validate`.
3. `eyas restart` o `eyas config reload`.
4. Ajustes + `eyas doctor`.

Precedencia: flags CLI → `EYAS_*` → YAML local → YAML por defecto.

```yaml
memory:
  capture:
    enabled: true
    minUserChars: 40
    maxPerConversation: 20
```

```yaml
skills:
  importRoots: []
agent:
  importRoots: []
```

La lista enviada está vacía. Rutas en `local.yaml`. Las skills importadas ganan a las copias bundled. El aislamiento sigue activo. Ver [Habilidades](/docs/es/automation/skills/).

`agent.verifyCommands` sin shell. `EYAS_AUTO_FAILOVER` rellena fallbacks de enrutado vacíos. `EYAS_BROWSER_USER_DATA_DIR` es el perfil headless de EYAS (nunca el Chrome diario). `EYAS_AGENT_BROWSER_BIN` apunta a la CLI opcional agent-browser (si no, PATH; ruta definida pero ausente = fail-closed). Ver [Memoria](/docs/es/knowledge/memory/) y [FAQ](/docs/es/reference/faq/).

## Relacionado

- [CLI](/docs/es/deploy/cli/)
- [Proveedores](/docs/es/ai/providers/)
- [Enrutado y presupuesto](/docs/es/ai/routing-budget/)
- [Memoria](/docs/es/knowledge/memory/)
