---
title: Referencia CLI
description: eyas serve/start/stop/doctor/config/module — opera el camino de instalación que hayas elegido.
---

**Para qué sirve.** Con el binario `eyas` arrancas, paras y diagnosticas una instalación nativa o en contenedor, y conmutas módulos. No es un segundo producto — el mismo proceso, el mismo `EYAS_HOME`. En cuanto `bin/` está en el `PATH` (instalador nativo) o estás dentro de la imagen (`docker compose exec`), estos comandos se aplican.

## Cuándo usarlo

- Arrancar en primer plano (`serve`) para ver los logs, o en segundo plano (`start` + pidfile).
- `doctor` antes de un informe de error: una CLI que falta, qué binario de Claude Code corre y si tiene la sesión iniciada, si cada CLI de IA instalada es una versión que la comprobación de aislamiento de EYAS ya ha demostrado, si su home de EYAS está intacto, si el sandbox de archivos del kernel de las CLIs está disponible, dónde está el vault, qué embedder de memoria usa el recall, raíces de importación omitidas, puerto ocupado, dist de docs/web.
- Conmutar un módulo sin editar YAML a mano.
- Buscar una versión más nueva en GitHub (familia `eyas update`, el mismo servicio que Ajustes → Actualizaciones).

## Flujo típico

1. Instala en [nativo](/docs/es/deploy/native/) o con [Docker](/docs/es/deploy/docker/).
2. `eyas doctor` — corrige lo que señale.
3. `eyas serve` (primer plano) o `eyas start` (segundo plano). Confirma con `eyas status`.
4. Tras editar YAML, `eyas config validate` y luego `eyas restart`: `default.yaml` y `local.yaml` se leen una sola vez al arrancar.
5. `eyas stop` / `eyas restart` según haga falta.

## Funciones

| Comando | Descripción |
|---------|-------------|
| `eyas serve` | Servidor HTTP en primer plano |
| `eyas start` | En segundo plano (pidfile + log) |
| `eyas stop` | Parar el proceso en segundo plano |
| `eyas restart` | Reiniciar |
| `eyas status` | Health + PID |
| `eyas doctor` | Diagnóstico |
| `eyas version` | Versión |
| `eyas config validate` | Validar YAML |
| `eyas config reload` | **No** recarga `default.yaml` / `local.yaml` — reinicia en su lugar |
| `eyas module list` | Listar módulos |
| `eyas module enable/disable <id>` | Conmutar un módulo |
| `eyas update check` | Buscar en GitHub (`eyssen/eyas`) una versión más nueva; para aplicarla, la copia de seguridad debe estar lista |
| `eyas migrate …` | Migración única v1→v2 de prompts/workspace (`run` / `rollback` / `drop-cols`) — no es operación diaria |

<h3 id="what-doctor-checks">Qué comprueba <code>doctor</code></h3>

Cada línea es *ok* (✓), un *aviso* (⚠) o un *fallo* (✗). Doctor termina con el número de problemas o avisos, y sale con estado 1 si alguna línea falló; los avisos por sí solos no cambian el estado de salida. Solo lee: no repara, no copia ni crea nada, y arranca las CLIs instaladas solo para leer su versión (`--version`) y, en Claude Code, si tiene la sesión iniciada (`claude auth status`).

Una selección de sus líneas:

| Línea | Significado |
|-------|-------------|
| **Claude Code runtime** | Qué binario de Claude Code ejecuta EYAS: el origen (`EYAS_CLAUDE_CODE_BIN` / `claude on PATH` / `SDK-bundled`), su ruta y versión, si su versión difiere de aquella para la que se construyó el cliente SDK de EYAS (*version skew*) y **signed in** sí/no. Un `EYAS_CLAUDE_CODE_BIN` inválido es un fallo. El último recurso incluido en el SDK, el desfase de versión y un runtime sin sesión iniciada son avisos. Un `claude` en el PATH que el override tapa se muestra como información (*not used by EYAS*). Ver [Proveedores — Runtime de Claude Code](/docs/es/ai/providers/#claude-code-runtime). |
| **CLI isolation (Claude Code)**, **CLI isolation (Grok CLI)**, **CLI isolation (Kimi Code CLI)** | Una línea por proveedor CLI. Muestra el binario que ejecuta EYAS — cómo se encontró (`EYAS_CLAUDE_CODE_BIN` / `EYAS_GROK_BIN` / `EYAS_KIMI_BIN`, `claude on PATH` / `grok on PATH` / `kimi on PATH`, o `SDK-bundled`), su ruta y su versión — y si la comprobación de aislamiento de EYAS previa a cada versión ha demostrado esa versión: ok *isolation proven on this version (&lt;fecha&gt;)*. Avisa cuando la versión difiere de la última demostrada, cuando el binario no informa de ninguna versión y cuando la CLI nunca se ha demostrado en un equipo (por ahora, Kimi Code CLI); el aviso añade que EYAS sigue comprobando cada sesión al arrancar. Una CLI que no está instalada muestra *not installed* (ok). Un `EYAS_*_BIN` inválido es un fallo, con el remedio. Para Grok CLI y Kimi Code CLI, la línea también comprueba su home de EYAS, `<data dir>/cli-homes/<proveedor>` — ver la tabla siguiente. Las últimas versiones demostradas, y cómo: [Seguridad y privacidad — Cómo se demuestra el aislamiento](/docs/es/admin/security-privacy/#how-isolation-is-proven). |
| **CLI sandbox** | El modo de `security.cliSandbox` y, para cada CLI instalada (Claude Code, Grok CLI, Kimi Code CLI), si sus propias herramientas se ejecutan en el sandbox de archivos del kernel: *active*, *unavailable* con el motivo y el remedio (instalar bubblewrap; instalar socat — Claude Code lo necesita junto a bubblewrap; permitir los user namespaces sin privilegios, también en un contenedor), o *none* para Kimi, que no tiene sandbox del kernel. Un sandbox ausente es un aviso, no un fallo: con `auto` la CLI se ejecuta sin él, con `required` sus turnos con herramientas se rechazan. Ver [Proveedores — Sandbox de archivos del kernel](/docs/es/ai/providers/#kernel-file-sandbox). |
| **Vault** | La ruta del vault de memoria, `<data dir>/vault` (ok). Avisa cuando unas notas de un antiguo `<EYAS home>/data/vault` se van a copiar en el siguiente arranque y — con un remedio — cuando esa carpeta antigua ya no se usa porque el vault del directorio de datos ya tiene notas. Doctor nunca copia nada por sí mismo. Ver [Configuración — Directorio de datos y vault](/docs/es/deploy/configuration/#data-directory-and-vault). |
| **SQLite** | Un autotest en vivo sobre una base de datos temporal en memoria — tu archivo de datos no se abre nunca. Informa de la versión de SQLite, de si está **FTS5** (sin él es un fallo: la búsqueda de memoria, de conversaciones y del vault lo necesitan) y de si carga la extensión `sqlite-vec`, insertando de verdad una fila y lanzando una consulta de vecino más cercano en vez de limitarse a preguntar la versión. Que falte la extensión es un aviso, con el remedio para tu plataforma, no un fallo. |
| **Import roots** | Si `skills.importRoots` / `agent.importRoots` se pueden usar: ok cuando no hay nada configurado o cada raíz es una carpeta normal; un aviso que nombra el ajuste y la carpeta cuando una raíz está dentro de, o contiene, las carpetas propias de otro asistente o app de notas (`~/.claude`, `~/.grok`, una bóveda de Obsidian, …) y por eso no se escanea. Ver [Configuración — Raíces adicionales de skills y personas](/docs/es/deploy/configuration/#extra-skill-and-persona-roots). |
| **Memory embedder** | Qué embedder usa el recall de memoria. Ok: *multilingual-e5-small, local (weights in &lt;carpeta&gt;)* cuando `@huggingface/transformers` está instalado y los pesos están en `data/models`. Aviso: el embedder hash de raíces (`stem5-fnv-384`) porque `@huggingface/transformers` no está instalado — remedio: ejecuta `bun add @huggingface/transformers` (o `bun install`) en la carpeta de EYAS y reinicia. Aviso: el paquete está instalado pero los pesos aún no se han descargado — el siguiente arranque los descarga (unos 130 MB) de Hugging Face a `data/models`, y hasta entonces el recall usa el embedder de reserva. Ver [Memoria — La búsqueda vectorial siempre corre en local](/docs/es/knowledge/memory/#vector-search-always-runs-locally). |
| **zstd** | Qué implementación de compresión usará el registro en bruto: la nativa de Bun, la de Node (22.15 o posterior) o el fallback WASM incluido. El fallback es un aviso — funciona y es unas dos veces más lento. No tener ninguna implementación es un fallo, y entonces EYAS no graba nada en vez de llenar un búfer que nunca podrá escribir. |

La comprobación del home de EYAS en las líneas **CLI isolation (Grok CLI)** y **CLI isolation (Kimi Code CLI)**:

| Lo que doctor encuentra en `<data dir>/cli-homes/<proveedor>` | Resultado |
|---------------------------------------------------------------|-----------|
| Aún no se ha creado | ok — la primera ejecución lo crea |
| Un enlace simbólico, o algo que no es una carpeta | fallo — EYAS se niega a ejecutar la CLI desde ahí. Remedio: elimínalo; la siguiente ejecución lo vuelve a crear |
| Una carpeta que otros usuarios pueden leer | aviso — contiene el inicio de sesión de la CLI. Remedio: `chmod 700 <carpeta>` |
| Un archivo que EYAS gestiona ahí falta o ha cambiado desde que EYAS lo escribió (Grok: `config.toml`, `requirements.toml`, `trusted_folders.toml`; Kimi: `mcp.json` y los ajustes de EYAS en `config.toml`) | aviso — EYAS reescribe esos archivos antes de la siguiente ejecución, así que un cambio entre ejecuciones significa que otra cosa edita esa carpeta |
| Todo tal como lo escribió EYAS | ok — *EYAS home and managed files intact* |

<h3 id="environment">Entorno</h3>

`EYAS_PORT`, `EYAS_HOST`, `EYAS_HOME`, `EYAS_DATA_DIR`, `EYAS_WORKSPACES_DIR`, `EYAS_CLAUDE_CODE_BIN`, `EYAS_GROK_BIN`, `EYAS_KIMI_BIN`, `EYAS_INSTALL_ROOT`, `EYAS_SKIP_WEB_BUILD`, `EYAS_SKIP_DOCS_BUILD`, `EYAS_FORCE_WEB_BUILD`, `EYAS_FORCE_DOCS_BUILD`. Qué hacen las variables de rutas y de runtime: [Configuración](/docs/es/deploy/configuration/).

El puerto por defecto es **3100**. Con `EYAS_SKIP_DOCS_BUILD=1`, `/docs` devuelve 404 — ver [FAQ](/docs/es/reference/faq/).

## Relacionado

- [Configuración](/docs/es/deploy/configuration/)
- [Nativo](/docs/es/deploy/native/)
- [Proveedores](/docs/es/ai/providers/)
- [Seguridad y privacidad](/docs/es/admin/security-privacy/)
- [FAQ](/docs/es/reference/faq/)
- [Ajustes — Actualizaciones](/docs/es/admin/settings/)
