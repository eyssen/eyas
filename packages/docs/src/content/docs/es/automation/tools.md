---
title: Herramientas
description: Catálogo de capacidades invocables — riesgo, aprobación y asignación.
---

**Para qué sirve.** Las herramientas son las acciones que un agente puede ejecutar. Esta página es el catálogo en vivo. La asignación sigue en **Configuración** del agente; aquí ves nombre, categoría, riesgo y si la llamada espera aprobación.

**Ruta:** `/tools`. Barra: **Herramientas**.

## Cuándo usarlo

- Antes de poner ids en un agente.
- Una llamada se bloqueó: nivel de riesgo y **aprobación requerida**.
- MCP o Conexión cableados y quieres ver las herramientas descubiertas.
- Necesitas el esquema de entrada.

## Flujo típico

1. **Herramientas** (`/tools`).
2. Busca o filtra por **categoría** y **nivel de riesgo**.
3. **Mostrar esquema** para el JSON.
4. Asigna el id en **Configuración** del agente. [Configurar](/docs/es/agents/configure/).
5. Las llamadas peligrosas pasan el [gate de seguridad](/docs/es/admin/security-privacy/).

## Funciones

Cabecera: recuento y cuántas **requieren aprobación**. Categorías `system`/`file`/`network`/`compute`/`data`. El catálogo imprime riesgo **green / yellow / red**. Superficie de código (`read_file`, `edit_file`, `grep`, `glob`, `run_command`), búsqueda/`needsPin`, bloques de memoria + `search_memory`/`save_memory`, email draft→approve→send, Odoo opcional, inventario de conexiones. **Media** (opcional): `media_generate`, `media_wait`, `media_catalog`, `media_balance`, `media_history` — [Media](/docs/es/ai/media/). El pulido de captura de pantalla no es un tool: Recordly es compañero AGPL en [Extensiones](/docs/es/admin/extensions/#recordly) — no hay `recordly_*`. Paridad CLI MCP: [MCP](/docs/es/ai/mcp/).

<h3 id="browser">Navegador</h3>

Playwright headless (`browser_*`): SSRF; índices `browser_snapshot` + `snapshotId` (mueren al navegar); pestañas, back, wait, hover, select, diálogo, upload, `evaluate` solo en la página, descarga → Documentos, `storageState`. `browser_replay` / `browser_action_cache` guardan un locator (JSON en proyecto o vault, sin LLM, sin valores). `browser_totp` (amarillo) lee la semilla en Secretos/Llavero y pasa el código a `browser_fill`. Perfil `data/browser/profile`, nunca el Chrome diario (Chrome 136+). [Browser Use](/docs/es/automation/browser-use/) opcional: recomendado `agent_browser_*`, legado `browser_use_*`.

Vacío: *Aún no hay herramientas registradas.*

## Relacionado

- [Agentes — herramientas](/docs/es/agents/configure/)
- [Gate de seguridad](/docs/es/admin/security-privacy/)
- [Conexiones](/docs/es/admin/connections/)
- [Habilidades](/docs/es/automation/skills/)
- [Servidores MCP](/docs/es/ai/mcp/)
- [Media](/docs/es/ai/media/)
- [Estudio](/docs/es/studio/)
- [Extensiones](/docs/es/admin/extensions/#recordly)
