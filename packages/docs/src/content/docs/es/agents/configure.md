---
title: Crear y configurar
description: Nombre, modelo, herramientas, presupuesto y canales de un agente.
---

**Para qué sirve.** La pestaña **Configuración** es la identidad guardada de un agente: nombre, rol, modelo, esfuerzo, herramientas, restricciones y presupuesto mensual de tokens. Los archivos del espacio de trabajo y los perfiles de voz son pestañas aparte. Esto es lo que rellenas al crear a alguien y lo que cambias cuando su trabajo cambia.

## Cuándo usarlo

- Estás creando un agente y necesitas nombre, tipo, modelo y lista de herramientas.
- Un agente de código con un modelo de API debe tener `read_file` / `edit_file` / `grep` sin depender de una CLI.
- Un tope mensual de tokens debe frenar el gasto, o quieres quitarlo (`0` = ilimitado).
- Telegram (u otro canal) de entrada debe llegar a este agente.
- Quieres que el prompt coach ajuste el prompt del sistema — no la voz, no el dominio del proyecto.

## Flujo típico

1. Abre **Agentes** → haz clic en el agente (o **Crear agente**) — ruta `/agents/:id`, pestaña **Configuración**. La conversación del asistente **Crear agente** no nombra ningún modelo: usa el predeterminado de la instalación, fijado con su primer mensaje.
2. Rellena **Nombre**, **Rol**, **Nivel**, **Tipo de agente**, **Modelo** (un proveedor + modelo, o **Modelo propio de la conversación**), **Esfuerzo**, **Herramientas (separadas por comas)**, **Restricciones (una por línea)**.
3. Define un **Presupuesto mensual de tokens** si quieres un tope. En la pestaña **Canales**, vincula un canal si los mensajes entrantes deben llegar aquí.
4. **Guardar cambios**. Una conversación nueva con este agente usa este modelo, esta lista de herramientas y este prompt.

## Funciones

La cabecera muestra el resumen **Presupuesto de tokens** y, mientras hay una ejecución activa, **Ejecutando…**. Pestañas: **Configuración**, **Recuerdos**, **Voz**, **Espacio de trabajo**, **Canales**.

## Clasificación

| Campo | Significado |
|-------|-------------|
| **Nivel** | **Principal** / **Equipo** = colegas con los que hablas; **Especialista** = grupo compartido que se lanza bajo demanda (ver [vista general](/docs/es/agents/overview/)) |
| **Tipo de agente** | **Asistente**, **Ingeniero**, **Desarrollador**, **Revisor**, **Crítico**, **Investigador**, **Planificador**, **Coordinador**, **Observador** |

## Personaje

| Campo | Significado |
|-------|-------------|
| **Nombre** | Nombre visible |
| **Rol** | Línea breve de rol |
| **Descripción** | Descripción más larga |
| **Objetivo** | Qué guía las decisiones (*Qué guía las decisiones de este agente*) |
| **Trasfondo** | Contexto que da forma al enfoque (*Contexto que da forma al enfoque y la perspectiva del agente*) |
| **Avatar** | Emoji que se muestra en la interfaz |
| **Prompt del sistema** | Instrucciones a nivel de agente (combinadas con los prompts por capas) |
| **Prompt coach** | Coach de IA para el prompt del sistema (solo el protocolo operativo — no la voz, no el dominio del proyecto) — [Prompts](/docs/es/ai/prompts/#prompt-coach) |

<h2 id="model--effort">Modelo y esfuerzo</h2>

| Campo | Significado |
|-------|-------------|
| **Modelo** | Un proveedor más un modelo, elegido de una lista agrupada por proveedor — o **Modelo propio de la conversación** (vacío): el colega usa entonces el modelo de la conversación — el del turno que delega, o el predeterminado de la instalación fijado en el primer uso (ver [Equipos y delegación](/docs/es/agents/teams/#which-model-and-effort-a-specialist-or-member-uses)) |
| Botón de reinicio | *Usar el modelo propio de la conversación* — borra el modelo; guardar lo borra de verdad |
| Nota roja | *&lt;proveedor&gt; / &lt;modelo&gt; no es un modelo activado de un proveedor activo. Hasta que vuelva, este colega usa el modelo propio de la conversación.* |
| **Esfuerzo** | El mismo selector de esfuerzo que en las conversaciones: solo los niveles que ofrece el modelo del agente (entre **Ninguno**, **Mínimo**, **Bajo**, **Medio**, **Alto**, **Muy alto**, **Máximo**; **Activado** / **Desactivado** para un modelo de encendido/apagado), con **Automático** primero, que muestra el predeterminado del modelo (*Automático · predeterminado del modelo (Medio)*). Si eliges un modelo que no ofrece el nivel guardado, se cambia antes de guardar y se indica (*Esfuerzo ajustado de Muy alto a Alto: el modelo elegido no ofrece Muy alto.*); un modelo sin control de esfuerzo lo pasa a Automático. Un nivel que el modelo no admite no se guarda, y un mensaje nombra los niveles que sí admite — tus demás cambios siguen en el formulario. Sin modelo fijo, el selector ofrece todo nivel que acepte un modelo de un nivel del enrutamiento automático. El esfuerzo del colega se aplica dondequiera que se ejecute — su chat, su hilo propio, las respuestas de canal, y como nivel heredado de los especialistas en los que delega. Ver [Proveedores — Esfuerzo de razonamiento](/docs/es/ai/providers/#reasoning-effort). |
| Pista de esfuerzo | *Esfuerzo de razonamiento de este colega — solo se muestran los niveles que ofrece su modelo, y al cambiar de modelo se ajusta un nivel que el nuevo modelo no ofrece. Automático = el valor predeterminado del propio modelo.* |
| **Turnos máx.** | Tope estricto de idas y vueltas con el modelo por ejecución — para los turnos de chat de este colega y para sus ejecuciones en segundo plano, de especialista, de equipo y de canal. En Claude Code, Grok y Kimi es también el tope de turnos propio de la CLI. En un agente sin valor guardado el campo muestra 10, y guardar almacena el número que se ve. Sin valor guardado, un turno de chat permite 25 idas y vueltas, una ejecución en segundo plano, de equipo o de canal 20, y una ejecución de especialista 10. |

Guardar otros campos (nombre, prompt…) no vuelve a enviar el modelo, así que una edición nunca falla porque el modelo se haya desactivado entretanto.

**Actualización.** En el primer arranque tras actualizar, cada agente existente cuyo id de modelo aparece bajo exactamente un proveedor en el catálogo de modelos recibe ese proveedor automáticamente. Los ids de modelo listados bajo varios proveedores, los ids desconocidos y los nombres de nivel como `sonnet` quedan sin proveedor; se asignan a su propietario en tiempo de ejecución y, si no es posible, se usa el modelo propio de la conversación.

<h2 id="tools--constraints">Herramientas y restricciones</h2>

| Campo | Significado |
|-------|-------------|
| **Herramientas (separadas por comas)** | Nombres de las herramientas que este agente puede llamar. Marcador: *Vacío = todas las herramientas · p. ej. read_file, grep, research*. Pista: *Vacío = todas las herramientas. Se aplica en el chat y con todos los proveedores, también a las herramientas propias de escritura, shell y web de un modelo CLI. La búsqueda en memoria siempre está disponible; con un modelo CLI, también leer archivos en las carpetas de la conversación.* |
| **Capacidades (separadas por comas)** | Etiquetas de capacidad (p. ej. `research, coding`) |
| **Restricciones (una por línea)** | Reglas estrictas (p. ej. sin operaciones destructivas) |

### Qué significa la lista de herramientas

La lista se aplica igual en todos los caminos por los que corre un agente: chat interactivo, ejecuciones programadas y de tablero de una conversación, especialistas lanzados con `run_specialist` / `delegate_to_agent`, miembros de un equipo y respuestas de canal (Telegram, Slack, correo y los demás canales) — y con todos los proveedores: modelos de API y los modelos CLI Claude Code, Grok y Kimi.

- **Una lista vacía significa todas las herramientas.**
- Si no, al agente se le ofrecen **exactamente las herramientas de la lista, más `memory_search` y `memory_expand`**. Todo agente recibe siempre estas dos herramientas de memoria de EYAS, aunque su lista no las incluya.
- En una conversación **Solo** también se quitan `run_specialist`, `delegate_to_agent`, `handoff_to_colleague` y `propose_team`; `memory_search`, `memory_expand` y `assign_task` (trabajo de tablero) se mantienen.
- El inventario de herramientas del prompt del sistema del agente nombra solo las herramientas que realmente se ofrecen a la ejecución.
- **Un modelo solo puede usar una herramienta que se le ofreció.** Si un modelo nombra una herramienta fuera de la lista, o una que no existe, EYAS rechaza la llamada con *'&lt;tool&gt;' is not in this agent's toolset* y no la ejecuta. No hay solicitud de aprobación; se rechaza directamente, con todos los proveedores.
- **Los nombres desconocidos se descartan.** Un nombre que no es una herramienta instalada (una errata, un módulo desactivado, un servidor MCP que no está conectado) no se ofrece, y el log del servidor muestra un aviso por agente y nombre de herramienta.
- **En los modelos CLI (Claude Code, Grok, Kimi) la lista también limita las herramientas integradas propias de la CLI**, de la misma forma en todas las CLI:
  - **Escribir archivos** (Write, Edit y NotebookEdit de Claude Code; las herramientas de edición y de movimiento de Grok y Kimi, y las escrituras de archivos que EYAS sirve a la CLI): solo cuando la lista contiene `write_file` o `edit_file`.
  - **Comandos de shell** (Bash de Claude Code; las herramientas de ejecución de Grok y Kimi; un borrado cuenta como comando de shell, tal como lo clasifica la puerta de seguridad): solo cuando la lista contiene `run_command`. `git_status` y `git_diff` no conceden el shell; en una lista sin `run_command` se ofrecen a la CLI como herramientas de EYAS por el puente.
  - **Búsqueda y descarga web** (WebFetch y WebSearch de Claude Code; las herramientas de descarga de Grok y Kimi, web_fetch y web_search de Grok): solo cuando la lista contiene una herramienta web — `research`, `browser_navigate`, `agent_browser_run` o `browser_use_exec`.
  - **Leer archivos** (Read, Glob y Grep de Claude Code; las herramientas de lectura, búsqueda y listado de Grok y Kimi) siempre está permitido, diga lo que diga la lista. Se queda dentro de las carpetas de la conversación bajo la política de memoria y el sandbox de archivos del kernel. La búsqueda en memoria también sigue disponible.
  - Una lista vacía sigue significando todas las herramientas, incluidas las propias de la CLI.

  En Claude Code, las herramientas retenidas ni siquiera se ofrecen al modelo. En Grok y Kimi, EYAS rechaza una herramienta retenida que la CLI intenta usar antes de preguntar a la puerta de seguridad: sin petición de aprobación, y la fila de la herramienta muestra **Denegado**. Las peticiones de permiso de Kimi no dicen qué tipo de herramienta pregunta (según el código fuente de Kimi 1.52.0; aún sin verificar en un equipo), así que un agente cuya lista no tiene las herramientas de escritura de archivos o `run_command` no puede usar ninguna de las herramientas de Kimi que preguntan (escribir o reemplazar archivos, shell, tareas en segundo plano). La búsqueda y la descarga web de Kimi nunca preguntan a EYAS, así que no se pueden permitir por agente; la comprobación de aislamiento de EYAS sigue deteniendo un turno que las usa. Ver [Proveedores — Aislamiento de Claude Code](/docs/es/ai/providers/#claude-code-isolation).
- Por el puente de EYAS — tanto el servidor en proceso de Claude Code como el puente MCP de Grok/Kimi — la lista gobierna las herramientas de EYAS a las que llega la CLI. Las herramientas de EYAS para las que la CLI tiene un equivalente propio concedido (`read_file`, `grep`, `glob` siempre; `write_file`, `edit_file` mientras pueda escribir; `run_command`, `git_status`, `git_diff` mientras pueda usar su shell) no pasan por el puente: la CLI usa sus propias herramientas bajo la puerta de seguridad, la política de memoria y el sandbox de archivos del kernel. Las herramientas de EYAS de navegador, agent-browser, browser-use y OpenCode también llegan a los modelos CLI. Ver [MCP — Paridad de herramientas en las CLI](/docs/es/ai/mcp/#cli-mcp-tool-parity-grok--kimi).

**Cambio de comportamiento para agentes existentes:** una lista estrecha se respeta en todas partes. Por ejemplo, el **Asistente personal** no recibe `run_command` / `write_file` en ejecuciones de chat, en segundo plano, de especialista o de equipo, como indica su plantilla — y en Claude Code, Grok y Kimi ya tampoco puede escribir archivos ni ejecutar comandos con Write, Edit o Bash propios de la CLI. Para conceder una herramienta, añádela a la lista (`write_file` / `edit_file` para escribir, `run_command` para el shell), o vacía la lista para permitir todas. Los agentes cuya lista nombra herramientas que no existen pierden esos nombres (con un aviso en el log), y un modelo que llama a una herramienta fuera de su lista ofrecida recibe un rechazo.

### Agentes de código (superficie independiente del modelo)

Para trabajo de implementación, corrección o revisión con un modelo de API, concede las herramientas de archivo de primera clase para que el modelo pueda editar sin shell:

```
read_file, write_file, edit_file, grep, glob, git_status, git_diff, run_command, search_indexed, list_search_sources
```

| Herramienta | Uso |
|-------------|-----|
| `read_file` / `edit_file` / `write_file` | Leer y editar de forma dirigida en las carpetas de trabajo o el worktree |
| `grep` / `glob` | Encontrar símbolos y archivos |
| `git_status` / `git_diff` | Ayudas de revisión (solo lectura) |
| `run_command` | Tests/lint (nivel rojo — aprobación / autonomía) |

Los modelos CLI (Claude Code, Grok, Kimi) usan en su lugar sus propias herramientas de archivo y shell, y estos nombres de la lista son los que se las permiten: `write_file` / `edit_file` desbloquean las escrituras de archivos propias de la CLI y `run_command` su shell. Sin `run_command`, `git_status` y `git_diff` llegan a una CLI por el puente como herramientas de EYAS.

El **Asistente personal** (principal, tipo asistente) coordina — no le des `write_file` / `edit_file` / `run_command`. El **Ingeniero de sistemas** y los especialistas de código poseen esas herramientas. Ver [Equipos y delegación](/docs/es/agents/teams/).

Los **agentes existentes** creados antes de 0.8.6 **no** reciben las herramientas nuevas automáticamente — añádelas aquí (o vuelve a cargarlos desde una plantilla actualizada). Catálogo completo: [Herramientas](/docs/es/automation/tools/).

<h2 id="imported-personas">Personas importadas</h2>

Los agentes pueden venir de archivos de persona en las carpetas listadas en `agent.importRoots` de `local.yaml` (ver [Configuración — Raíces adicionales de skills y personas](/docs/es/deploy/configuration/#extra-skill-and-persona-roots)). Un agente que editas en EYAS **nunca se sobrescribe** con su archivo:

- En el primer arranque, un archivo crea su agente.
- Los cambios posteriores del archivo actualizan ese agente solo mientras su **nombre, rol, descripción, prompt del sistema y herramientas** estén exactamente como los dejó la última importación. En cuanto editas cualquiera de esos cinco aquí, el archivo deja de cambiar el agente.
- Cambiar solo su modelo, esfuerzo, interruptor de activación, avatar, etiquetas o presupuesto no detiene las actualizaciones, porque la importación nunca escribe esos campos.
- Un agente importado que borras no se vuelve a crear. Para recuperarlo, importa el archivo con la [Importación de datos](/docs/es/admin/data-port/).
- Un agente existente con el mismo id que la importación no creó — una plantilla integrada, uno creado en la interfaz o uno de la importación de datos — nunca se sobrescribe. Si ya coincide exactamente con el archivo, se adopta y sigue los cambios posteriores del archivo.
- Si dos carpetas de importación contienen una persona con el mismo id, gana la carpeta listada primero; si ese archivo se elimina, toma el relevo el archivo de la siguiente carpeta.

**Actualización.** Los agentes importados por versiones anteriores y no editados desde entonces se adoptan automáticamente. Los que editaste se quedan exactamente como están.

## API (integradores)

- `PATCH /api/v1/agents/:id` valida su cuerpo como la creación: los campos desconocidos como `source` o `id` se ignoran, los valores no válidos devuelven `400` con detalles (un esfuerzo no admitido devuelve el código `EFFORT_UNSUPPORTED` con los `levels` que admite el modelo), y un agente desconocido devuelve `404`.
- `POST` / `PATCH /api/v1/agents` aceptan `provider` junto con `model`. El par debe ser un modelo activado de un proveedor activo; si no, la respuesta es `400` con `code: model_binding_unavailable`, `providerId` y `modelId`, y no se guarda nada. `provider` sin `model` → `400`.
- `model` solo (la forma anterior) se sigue aceptando; su proveedor se completa cuando exactamente un proveedor lista ese id de modelo.
- `provider: null, model: null` (o un modelo vacío) borra ambos. Las respuestas `GET` incluyen `provider`.

## Presupuesto

| Campo | Significado |
|-------|-------------|
| **Presupuesto mensual de tokens** | Tope del mes; **`0` = ilimitado** |
| Consumo de tokens | Usado frente a presupuesto en la lista y en la cabecera |

## Acciones

| Control | Significado |
|---------|-------------|
| **Guardar cambios** | Guardar la configuración |

## Pestaña Recuerdos (lista de solo lectura)

| Elemento | Significado |
|----------|-------------|
| **Episódico / De trabajo** | Filtro por nivel de memoria |
| *N recuerdos* | Recuento |
| *relevancia: N* | Puntuación de importancia |
| *consultado N×* | Número de accesos |
| *Primeros N de M caracteres — el recuerdo entero está guardado* | Un recuerdo largo solo se acorta en la lista |
| Pista vacía | *Los recuerdos aparecerán aquí a medida que el agente interactúa y aprende.* |

## Pestaña Canales (resumen)

Vincula instancias de canal para que los mensajes entrantes lleguen a este agente. Lista completa de campos: [Canales — vista general](/docs/es/communication/channels/).

| Control | Significado |
|---------|-------------|
| **Vincular instancia de canal** | Elegir una instancia existente de Telegram/… |
| **Vincular a este agente** | Vincular |
| **Desvincular** | Desvincular |
| Estado **Conectado / Error / Credenciales definidas / Sin configurar** | Salud de la instancia |
| Modo **Autónomo** | El canal puede iniciar un tratamiento autónomo |

## Relacionado

- [Identidad y espacio de trabajo](/docs/es/agents/identity-workspace/)
- [Equipos y delegación](/docs/es/agents/teams/)
- [Perfiles de voz](/docs/es/agents/voice/)
- [Proveedores](/docs/es/ai/providers/)
