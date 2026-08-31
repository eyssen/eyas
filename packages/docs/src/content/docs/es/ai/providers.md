---
title: Proveedores
description: Backends de IA — API, CLI del host y runtimes locales. El aislamiento es honesto por proveedor.
---

**Para qué sirve.** Los proveedores son los backends LLM de esta instancia. Aquí se opta por la **config Claude del host** — apagada por defecto — y Grok/Kimi ACP dicen que no se pueden aislar.

**Ruta:** `/providers`. Pestañas: **Niveles de enrutado · Proveedores · Presupuesto · Análisis IA**. Barra: **Proveedores**.

## Cuándo usarlo

- Tras el setup: proveedor **On**, clave, modelos.
- `claude` / `grok` / `kimi` en el host, proveedor CLI sin clave.
- Las conversaciones leían `~/.claude` — **Cargar config Claude del host** **OFF**.
- Grok/Kimi ACP **siempre** cargan su config de máquina — no hay interruptor falso.

## Flujo típico

1. **Proveedores** → pestaña **Proveedores**.
2. Tarjeta On/Off. Autenticación: clave API (en [Secretos](/docs/es/admin/secrets/)) o CLI del host.
3. Activa modelos. Refresh desde API/CLI.
4. Claude Code CLI: deja **Cargar config Claude del host** **OFF** salvo que quieras settings.json, CLAUDE.md, skills del host y `.mcp.json` del proyecto.
5. Niveles y gasto: [Enrutado y presupuesto](/docs/es/ai/routing-budget/).

Default aislado. Opt-in envía `settingSources: ['user','project','local']`. Llamadas aisladas/opt-out también ponen `CLAUDE_CODE_DISABLE_AUTO_MEMORY` y `strictMcpConfig` — `settingSources: []` **solo** no detiene el auto-memory por cwd. ACP no tiene parámetro de aislamiento; grok carga `~/.grok` y demostrablemente `~/.claude`.

## Relacionado

- [Asistente de setup](/docs/es/setup-wizard/)
- [Secretos](/docs/es/admin/secrets/)
- [MCP](/docs/es/ai/mcp/)
- [Memoria](/docs/es/knowledge/memory/)
