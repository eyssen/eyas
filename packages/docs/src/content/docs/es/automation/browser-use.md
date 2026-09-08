---
title: Browser Use
description: Herramientas Playwright headless para páginas públicas y sidecar CLI opcional para el Chrome en el que ya has iniciado sesión.
---

**Para qué sirve.** Dos superficies. Los `browser_*` headless abren páginas públicas en el Chromium de EYAS — controles numerados, formularios, descarga a Documentos. **Browser Use** (`/browser-use`) es el sidecar opcional que controla **tu** Chrome real por CDP cuando las cookies y el 2FA ya están. Sin SDK de LLM ajeno. El modelo sigue siendo EYAS.

**Ruta:** `/browser-use`. Barra: **AI → Browser Use**. Catálogo headless: [Herramientas](/docs/es/automation/tools/) (`/tools`).

## Cuándo usarlo

- El agente debe leer o rellenar una página **pública** sin tu Chrome diario.
- Una descarga debe ir a [Documentos](/docs/es/knowledge/documents/) y a la conversación.
- Necesitas el Chrome **ya con sesión** — eso es el sidecar.
- Una llamada se bloqueó y quieres ver **Listo** / **No listo** y el remedio.

## Flujo típico

1. **Herramientas** (`/tools`). Busca `browser_`. Índices en vez de CSS, `browser_snapshot`.
2. Los ids en la pestaña **Configuración** del agente. [Configurar](/docs/es/agents/configure/).
3. Página pública: navegar, snapshot, clic por índice, otro snapshot tras navegar.
4. Chrome con sesión: **Browser Use** (`/browser-use`). Si **No listo**, instala el check que falta (Python 3.11+, CLI en PATH). Luego `browser_use_status` y `browser_use_exec`.
5. Lo que no es un navegador: [Manos](/docs/es/admin/hands/).

## Funciones

### Cuatro carriles

| Trabajo | Dónde | Tools |
|---------|-------|-------|
| Página pública, headless | [Herramientas](/docs/es/automation/tools/) | `browser_*` — Playwright, índices, perfil EYAS |
| Auth persistente, `@e1` (sidecar recomendado) | esta pantalla, `/browser-use` | `agent_browser_status` y luego `agent_browser_run` (o `mcp_agent_browser_*`) |
| CLI Python heredada | esta pantalla, segunda tarjeta | `browser_use_status` y luego `browser_use_exec` |
| Sidecar MCP a11y-ref / pestaña en vivo | [Conexiones](/docs/es/admin/connections/) + catálogo [MCP](/docs/es/ai/mcp/) | `mcp_playwright_*` cuando Playwright MCP está conectado |
| Coding/debug: consola, red, Lighthouse, WebMCP | [Conexiones](/docs/es/admin/connections/) + catálogo [MCP](/docs/es/ai/mcp/) | `mcp_chrome-devtools_*` cuando Chrome DevTools MCP está conectado — **no** rellenar formularios |
| Escritorio | [Manos](/docs/es/admin/hands/) | Manos |

<h2 id="headless">Playwright headless (browser_*)</h2>

Sin Python. El mismo Chromium que el print de diseño. El **proceso** dura 5 minutos; las cookies viven en `data/browser/profile` (o `EYAS_BROWSER_USER_DATA_DIR`). **Nunca** el perfil diario de Chrome/Edge — Chrome 136+ bloquea CDP en Default; EYAS lo rechaza antes.

| Tool | Qué hace |
|------|----------|
| `browser_navigate` | URL http(s). **SSRF** a hosts privados/metadata |
| `browser_snapshot` | Árbol de accesibilidad + lista numerada + `snapshotId` |
| `browser_click` / `browser_fill` / `browser_hover` / `browser_select` | **Índice** (preferido) o CSS |
| `browser_tabs` | `list` / `open` / `switch` / `close` — no cierra la última |
| `browser_back` | Atrás (invalida índices) |
| `browser_wait` | Selector, URL, load o timeout (máx. 30 s) |
| `browser_dialog` | Accept/dismiss **antes** del clic que abre `alert`/`confirm`/`prompt` |
| `browser_upload` | Input de archivo — rutas del workspace y/o ids de Documentos |
| `browser_evaluate` | JavaScript **en la página**, no en Node. JSON máx. 50k |
| `browser_download` | Siguiente descarga → Documentos, ligada a la conversación |
| `browser_storage` | Guardar/cargar `storageState` de Playwright |
| `browser_replay` / `browser_action_cache` | Rehacer un locator guardado sin LLM. JSON en la carpeta de proyecto del vault, si no `procedural/browser-action-cache.json`. No Stagehand; ni valores ni semillas TOTP |
| `browser_totp` | TOTP de 6 dígitos desde [Secretos](/docs/es/admin/secrets/) (o Llavero de macOS). Pásalo a `browser_fill`. Amarillo. La semilla no se devuelve |
| `browser_screenshot` / `browser_get_content` / `browser_close` | Captura, texto, fin del proceso (el perfil queda) |

Índices y `snapshotId` mueren al navegar. Snapshot otra vez. Un clic/relleno con `intent` guarda un locator CSS/rol; `browser_replay` lo usa en el mismo origen. Descargas en **Documentos** (`/documents`). Las llamadas peligrosas esperan [aprobación](/docs/es/admin/security-privacy/).

<h2 id="agent-browser">Agent Browser (sidecar recomendado)</h2>

Vercel `agent-browser` opcional (Apache-2.0). Sin Rust vendored. Resolución: `EYAS_AGENT_BROWSER_BIN` → PATH. Ruta definida pero ausente = fail-closed. Instala: `npm i -g agent-browser` y `agent-browser install`. El agente: `agent_browser_status` y `agent_browser_run` con `argv` (`["snapshot","-i"]`, `["click","@e1"]`) o `batch`. Perfil: `data/browser/agent-browser/profile`. Nunca Default / Chrome diario (Chrome 136+). Nunca `chat`, nunca `--no-sandbox`. MCP: catálogo **Agent Browser** (`mcp --tools core,state`) → `mcp_agent_browser_*`.

<h2 id="sidecar">CLI Python (heredada)</h2>

El módulo extra sigue envolviendo la **CLI** MIT Browser Use. No vende la lib Python ni SDK de LLM. Telemetría off. La clave Cloud solo si la activas en ajustes. Nunca `--no-sandbox`. Prefiere Agent Browser si está Listo.

Requisitos: Python 3.11+ y `browser-use` en PATH, `uvx` o `EYAS_BROWSER_USE_BIN`.

Si un check está **Falta**, la CLI no está lista — instala el remedio y luego `browser_use_exec`. No inventes una URL CDP.

<h2 id="playwright-mcp">Playwright MCP (Conexiones)</h2>

Microsoft `@playwright/mcp` opcional (Apache-2.0). Instálalo en **Ajustes → Servidores MCP → Catálogo** y, si quieres, rastrealo como fila [Conexiones](/docs/es/admin/connections/) de tipo **Playwright MCP**. **Test** es fail-closed (Node 18+, npx), como la CLI de Hyperframes. Telemetría off (`DO_NOT_TRACK=1`). `--no-sandbox` se elimina y se rechaza.

No hay un segundo bucle LLM. Las herramientas llegan por el puente MCP existente como `mcp_playwright_*` (snapshot a11y + refs). Para una pestaña Chrome/Edge en vivo: extensión Playwright MCP Bridge y `--extension` (sin `--isolated`). Nunca el perfil diario de Chrome.

**No** instales el MCP Python de `browser-use` (`uvx browser-use --mcp`). Pide una clave LLM y expone `retry_with_browser_use_agent`. EYAS lo rechaza en add/connect.

<h2 id="chrome-devtools-mcp">Chrome DevTools MCP (coding / debug)</h2>

Google `chrome-devtools-mcp` opcional (Apache-2.0). Instálalo en **Ajustes → Servidores MCP → Catálogo → Chrome DevTools MCP** y, si quieres, rastrealo como fila [Conexiones](/docs/es/admin/connections/) de tipo **Chrome DevTools MCP**. **Test** es fail-closed (Node 18+, npx). Telemetría off. `--no-sandbox` y `--autoConnect` (Chrome diario, Chrome 136+) se rechazan. El catálogo usa `--isolated`.

**No** es el carril de formularios. No uses `click` / `fill` / `fill_form` de este servidor para formularios — eso es `browser_*`. Las herramientas llegan por el puente MCP como `mcp_chrome-devtools_*` (consola, red, Lighthouse).

**WebMCP es fail-closed.** Catálogo: `--categoryExperimentalWebmcp=true`. `list_webmcp_tools` / `execute_webmcp_tool` aparecen **solo si el sidecar las anuncia** (Chrome 150+, `--enable-features=WebMCP`). Si faltan, EYAS no las inventa.

## Campos y controles

<h2 id="status">Tarjeta de estado</h2>

| Control | Significado |
|---------|-------------|
| Título | **Browser Use** |
| Subtítulo | Sidecar CLI opcional para tu Chrome por CDP |
| Pista de carril | `browser_*` headless en público; sidecar con sesión; Manos para el resto |
| Insignia | **Listo** / **No listo** |
| Vacío | *La CLI de Browser Use no está lista…* |
| Fila de check | Etiqueta + **OK** / **Falta** / **Aviso**, detalle, remedio |
| Ayuda **?** | Abre este capítulo |

Esta pantalla no lanza tareas. El agente llama `browser_use_exec` cuando el estado está listo.

## Relacionado

- [Herramientas](/docs/es/automation/tools/)
- [Conexiones](/docs/es/admin/connections/)
- [Servidores MCP](/docs/es/ai/mcp/)
- [Documentos](/docs/es/knowledge/documents/)
- [Manos](/docs/es/admin/hands/)
- [Seguridad y privacidad](/docs/es/admin/security-privacy/)
- [Configuración](/docs/es/deploy/configuration/) (`EYAS_BROWSER_USER_DATA_DIR`)
