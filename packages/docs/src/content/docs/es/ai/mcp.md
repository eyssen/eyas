---
title: Servidores MCP
description: Model Context Protocol — servidores activos, catálogo e igualdad de herramientas CLI.
---

**Para qué sirve.** MCP conecta *cajas de herramientas externas*. Las herramientas descubiertas se asignan como las integradas. No es un [canal](/docs/es/communication/channels/) de chat ni una [Conexión](/docs/es/admin/connections/) — aunque puedes registrar un servidor MCP como Conexión.

**Ruta:** `/mcp-settings`. Pestañas: **Activos** · **Catálogo**. Barra: **Servidores MCP**.

## Cuándo usarlo

- Herramientas que EYAS no envía.
- Instalación de un clic (clave API) en vez de escribir un comando.
- CLI Grok/Kimi debe ver la misma superficie ToolExecutor.
- Servidor desconectado — **Probar**.

## Flujo típico

1. **Servidores MCP**.
2. **Catálogo**: listo / un clic / manual.
3. **Instalar** o **Añadir servidor MCP** (stdio/HTTP/SSE).
4. **Activos**: connected, **Probar**, herramientas/recursos/prompts descubiertos.
5. Ids en **Configuración** del agente.

Copyleft/proprietary corren como **proceso aparte** — EYAS sigue MIT. Paridad CLI: Claude Code MCP in-process; Grok/Kimi stdio MCP + puente `/api/v1/internal/cli-mcp/*`.

**Autenticación:** ninguna / Bearer (clave API) / OAuth (navegador). El transporte **SSE** es Streamable HTTP: no añadas el sufijo `/sse`; EYAS gestiona la cabecera de sesión.

Magnific, Higgsfield y fal se conectan en [Media](/docs/es/ai/media/); el agente usa cinco herramientas `media_*` en vez de los catálogos MCP crudos del vendor.

**Chrome DevTools MCP** (Google, Apache-2.0) es una fila de catálogo **DevTools**: `npx -y chrome-devtools-mcp@latest --isolated`, telemetría off, `--categoryExperimentalWebmcp=true`. Solo coding/debug (consola, red, Lighthouse, WebMCP) — **no** rellenar formularios. Herramientas: `mcp_chrome-devtools_*`. WebMCP solo si el sidecar las anuncia. `--autoConnect` y el perfil diario de Chrome están prohibidos. Véase [Browser Use](/docs/es/automation/browser-use/#chrome-devtools-mcp).

## Relacionado

- [Herramientas](/docs/es/automation/tools/)
- [Media](/docs/es/ai/media/)
- [Configurar agentes](/docs/es/agents/configure/)
- [Conexiones](/docs/es/admin/connections/)
- [Proveedores](/docs/es/ai/providers/)
