---
title: Conexiones
description: Inventario de sistemas externos — salud, secretos, propuestas de agentes.
---

**Para qué sirve.** Conexiones (`/connections`) es el inventario con nombre de *sistemas externos* (Odoo, GitHub, MCP, …) que los agentes pueden usar tras tu aprobación. No son [Canales](/docs/es/communication/channels/) (cuentas de mensajería como Telegram) ni el [vault de secretos](/docs/es/admin/secrets/) (donde se guardan las credenciales). El sistema aquí; la contraseña o el token en Secretos; el bot de chat bajo Canales.

**Ruta:** `/connections`.  
Subtítulo: *Sistemas externos que EYAS puede usar — inventario, salud y propuestas de agentes.*

Las Connections son un **inventario con nombre** de sistemas externos (Odoo, GitHub, MCP, …). Las credenciales van al [vault de secretos](/docs/es/admin/secrets/); los agentes pueden **proponer** una conexión para aprobación humana en lugar de repartir la config entre MCP, skills y secretos sueltos.

---

## Pestañas

| Pestaña | Propósito |
|---------|-----------|
| **Connections** | Inventario activo (connected / error / disabled / unknown) |
| **Catalog** | Tipos de sistema conocidos — elige uno para crear |
| **Pending** | Propuestas de agentes: **Approve** / **Reject** |

---

## Lista

| Control / campo | Significado |
|-----------------|-------------|
| **N connections** | Número de filas |
| **Add connection** | Crear (o Catalog → **Use**) |
| **Name** | Etiqueta de la instancia |
| **System** | Tipo de catálogo |
| **Status** | Pending / Disabled / Connected / Error / Unknown |
| **Adapter** | `native` / `http` / `mcp` |
| **Last check / Error** | Última prueba / mensaje de error |
| **Source** | **User** / **Agent** / **System** |
| **Test / Edit / Delete** | Probar / editar / eliminar |

---

## Formulario

| Campo | Significado |
|-------|-------------|
| **Name** | Nombre visible |
| **System type** | Entrada del catálogo |
| **Configuration** | Campos no secretos (URL, db, org, …) |
| **Secrets** | Campos sensibles en el vault como `conn-{id}-{field}` — *no se vuelven a mostrar tras guardar* |
| **Save / Cancel** | Guardar / descartar |

---

## Tipos del catálogo

Odoo (native) · GitHub / GitLab · Linear · Notion · Jira · Slack (API) · **MCP server** (enlace a [MCP](/docs/es/ai/mcp/)) · **Playwright MCP** (opcional, Apache-2.0 npx) · **Agent Browser** (opcional, Apache-2.0 CLI+MCP, `mcp_agent_browser_*`) · **Chrome DevTools MCP** (opcional, Apache-2.0 npx, coding/debug, `mcp_chrome-devtools_*`, no formularios) · Custom HTTP.

### Playwright MCP (opcional)

Instala desde **Ajustes → Servidores MCP → Catálogo → Playwright MCP**, luego una fila de Connections de este tipo (`mcpServerName` = `playwright`) para que **Test** ejecute el doctor.

- Las herramientas del agente llegan por el puente MCP existente como `mcp_playwright_*` (snapshot a11y + refs). No hay un segundo bucle LLM.
- Pestaña en vivo: extensión Playwright MCP Bridge, `--extension` en lugar de `--isolated`. Nunca el perfil diario de Chrome/Edge.
- El doctor es fail-closed como la CLI de Hyperframes: falta Node 18+ o npx → Test falla con remedio. Telemetría off (`DO_NOT_TRACK=1`).
- Nunca `--no-sandbox` / `PLAYWRIGHT_MCP_NO_SANDBOX`. Nunca el MCP Python de `browser-use` (`uvx browser-use --mcp`): pide una clave LLM y expone `retry_with_browser_use_agent`.

### Chrome DevTools MCP (opcional, coding / debug)

Instala desde **Ajustes → Servidores MCP → Catálogo → Chrome DevTools MCP**, luego una fila Connections (`mcpServerName` = `chrome-devtools`).

- Herramientas: `mcp_chrome-devtools_*`. **No** rellenar formularios — eso es `browser_*`.
- Catálogo: `--isolated`, telemetría off, `--categoryExperimentalWebmcp=true`.
- WebMCP solo si el sidecar las anuncia (Chrome 150+). No se inventan.
- `--autoConnect` y `--no-sandbox` hacen fallar Test. Nunca el perfil diario de Chrome.

Headless `browser_*`, sidecars CLI y este MCP de coding/debug: [Browser Use](/docs/es/automation/browser-use/).

---

## Herramientas de agente

`connections_list` · `connections_catalog` · `connections_test` · `connections_propose`.

## Relacionado

- [Secretos](/docs/es/admin/secrets/)
- [Servidores MCP](/docs/es/ai/mcp/)
- [Browser Use](/docs/es/automation/browser-use/)
- [Herramientas](/docs/es/automation/tools/)
