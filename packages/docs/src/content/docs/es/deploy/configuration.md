---
title: Configuración
description: YAML por defecto, overlays locales, precedencia de env — después de elegir un camino de instalación.
---

**Para qué sirve.** Dirección de escucha, módulos, autonomía, capture de memoria y verify commands sin reconstruir. `local.yaml` y `EYAS_*` — no `config/default.yaml` si puedes evitarlo.

## Cuándo usarlo

- Host/puerto, nivel de log, desactivar un módulo.
- Capture de llamada al modelo off (`memory.capture.enabled: false`) — por defecto on. Esto **no** para el capture en bruto: `memory.l0.enabled` es un interruptor aparte, también on por defecto.
- Capture en bruto off (`memory.l0.enabled: false`) si no quieres una segunda copia literal de cada mensaje guardada en disco.
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

### Capture en bruto (0.8.23-beta)

```yaml
memory:
  engine: legacy           # 'legacy' o 'v2'; la recuperación es la misma en ambos casos
  l0:
    enabled: true          # false = no guardar ninguna copia en bruto
    captureToolResults: false
    toolResultMaxBytes: 8192
    idleFlushMinutes: 30
    chunkTokens: 8000
    extractInLegacy: true
```

No es el mismo interruptor que `memory.capture` de arriba. El capture escribe notas de vault y cuesta una pequeña llamada al modelo; el capture en bruto guarda una **segunda copia literal de cada mensaje persistido** — comprimida y direccionada por contenido — **sin llamada al modelo y sin coste de API**. Está on por defecto.

| Clave | Por defecto | Significado |
|-------|-------------|-------------|
| `memory.l0.enabled` | **`true`** | Interruptor maestro del capture en bruto. `false` no graba nada y no acumula nada en búfer. |
| `memory.l0.extractInLegacy` | **`true`** | Ejecuta la pasada determinista (hechos, resumen, entidades, temas, importancia) tras cada volcado mientras `engine` siga en `legacy`. `false` conserva el texto en bruto y no deduce nada de él. |
| `memory.engine` | **`legacy`** | `legacy` o `v2`. Hoy solo controla la extracción: `v2` hace que la pasada determinista corra incluso con `extractInLegacy` en `false`. **No** cambia lo que recuerda una conversación. |
| `memory.l0.chunkTokens` | **`8000`** | Disparador de volcado por tamaño: el búfer de una conversación se escribe en cuanto su recuento estimado de tokens llega a esta cifra. |
| `memory.l0.idleFlushMinutes` | **`30`** | Disparador de volcado por tiempo: un barrido cada minuto escribe cualquier búfer que lleve inactivo este tiempo. Cerrar la conversación y parar EYAS también vuelcan, así que un reinicio limpio no pierde nada. |
| `memory.l0.captureToolResults` | **`false`** | Capturar también la salida de herramientas. **Lee el párrafo siguiente antes de encenderlo.** |
| `memory.l0.toolResultMaxBytes` | **`8192`** | Tope en bytes de un resultado de herramienta capturado, recortado en un límite UTF-8 y con marca de truncado visible. Solo resultados de herramientas; los mensajes no tienen tope. |

**`captureToolResults` está apagado por algo.** Un resultado de herramienta capturado es la salida entera, literal y sin censurar, más 2048 caracteres recortados de los argumentos de la llamada: el stdout de `run_command`, el contenido que devuelve `read_file` y un código de un solo uso vivo de `browser_totp` acaban todos en la capa en bruto como texto plano. Nada los censura y nada los cifra en reposo — comprimir no es confidencialidad. Con el flag encendido, cada arranque escribe en el log un aviso que dice exactamente eso. Enciéndelo solo donde eso sea aceptable para esta máquina.

**Todavía nada lee estas filas.** 0.8.23-beta es solo camino de escritura: no hay recuperación, ni página en la UI, ni endpoint de API, ni comando `eyas memory`. Los prompts se siguen componiendo del vault y de las conversaciones anteriores igual que antes, así que poner `memory.engine: v2` hoy no cambia nada que puedas ver.

**El capture en bruto crece y nada lo poda.** En esta versión no hay ajuste de retención ni tarea de limpieza; un mensaje capturado cuesta unos 5 KB en disco contando índices. Si prefieres no pagar eso todavía, pon `memory.l0.enabled: false`. Ver [Memoria](/docs/es/knowledge/memory/).

### Índice de memoria y recall

| Clave | Por defecto | Significado |
|-------|-------------|-------------|
| `memory.index.budgetChars` | **`2400`** | Caracteres del índice permanente de memoria por turno (≈ 600 tokens). Súbelo a unos 8000 cuando tus notas `user` y `feedback` ya no quepan. Requiere reinicio. |
| `memory.recall.includeSecrets` | **`false`** | Si las notas, filas episódicas y skills etiquetadas `contains-secrets` (archivos en los que el importador encontró credenciales, guardados literales) se muestran al modelo en el índice de memoria, el trabajo relacionado y `search_memory`. Desactivado, quedan guardadas y visibles en la página de Memoria, pero nunca llegan a un prompt. Requiere reinicio. |

### Durabilidad de la base de datos

Desde 0.8.23-beta cada conexión de base de datos de EYAS ejecuta `PRAGMA synchronous = NORMAL` en vez del `FULL` por defecto de SQLite. Junto con WAL, que EYAS siempre ha usado, esto significa:

- Una caída del **proceso** — EYAS matado, un error no controlado — no pierde nada ya confirmado.
- Una caída del **SO** o un corte de corriente justo en el instante de un commit puede perder la última transacción.

Es el trato estándar de WAL y vale para **todos** los módulos, no solo la memoria. Si tu instancia guarda trabajo que no podrías volver a introducir, la durabilidad la da el [Backup](/docs/es/admin/backup/), no el modo de commit.

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
