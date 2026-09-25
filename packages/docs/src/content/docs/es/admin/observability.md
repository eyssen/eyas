---
title: Observabilidad y ops
description: Telemetría de tokens, trazas, coste, carreras de Modo Dios, coste de contexto del prompt y entrega de memoria por proveedor.
---

**Para qué sirve.** Observabilidad (`/observability`) es la superficie de telemetría de esta instancia: trazas, coste, latencia, anomalías, carreras de conjunto (Modo Dios), lo que el modelo recibió *de verdad* y con qué igualdad recibió cada proveedor la memoria de EYAS. **Ops** (`/ops`) es remediación. Manos, nodos remotos, extensiones y preferencias de notificación **no** están en esta página — tienen capítulos propios.

| Área | Ruta | Significado |
|------|------|-------------|
| Observabilidad | `/observability` | Página **Observabilidad de IA** (barra lateral **Observabilidad**) — pestañas **Uso**, **God Mode**, **Contexto** |
| Ops | `/ops` | Agente ops de Kubernetes — observar → diagnosticar → proponer → aprobar → aplicar. Por defecto **solo proponer**. La URL del clúster, el kubeconfig y el repo GitOps son configuración de la instancia, no valores del producto. |

En otro sitio (no esta página): [Manos](/docs/es/admin/hands/) (`/hands`), [Nodos remotos](/docs/es/admin/nodes/) (`/nodes`) — incluido el invoke SSH vigilado, [Ingress](/docs/es/admin/ingress/) (`/ingress`), [Extensiones](/docs/es/admin/extensions/) (`/extensions`), [Notificaciones](/docs/es/admin/notifications/) (`/notifications-settings`).

## Cuándo usarlo

- Quieres saber cuánto cuestan las llamadas de IA por día y por modelo, y cuáles fueron trabajo en segundo plano del propio EYAS.
- Un turno fue lento, caro o usó herramientas, y quieres su traza.
- Quieres valorar respuestas, o ver cómo se decidió una carrera de Modo Dios.
- Quieres ver qué entró de verdad en el prompt, qué secciones se recortaron y cuánto se desvía la estimación de tokens.
- Quieres comprobar que todos los proveedores — modelos de API y CLIs por igual — recibieron la misma memoria.

## Flujo típico

1. Abre **Observabilidad** en la barra lateral (`/observability`).
2. En **Uso**, acota la tabla de trazas con **Modelo**, **Desde**, **Hasta** y **Propósito**; valora una traza con el pulgar arriba / abajo al final de su fila.
3. Abre **God Mode** para las carreras de conjunto y las tasas de victorias.
4. Abre **Contexto** y empieza por **Entrega de memoria por proveedor**; después, las tarjetas de medias por sección, truncamiento y estimado frente a real.

## Funciones

<h3 id="usage-tab">Pestaña Uso</h3>

**Uso** es telemetría de tokens: las tarjetas **Total de trazas**, **Coste total**, **Latencia media** y **Anomalías**, **Coste diario**, **Distribución de modelos**, **Anomalías activas** y la tabla de trazas — **Marca de tiempo**, **Modelo**, **Proveedor**, **Propósito**, **Tokens**, **Coste**, **Latencia**, **Herramientas**, **Calidad** — con los filtros **Modelo**, **Desde**, **Hasta** y **Propósito** encima.

**Modelo y «respondió».** La columna **Modelo** conserva el id de modelo que elegiste, así que las etiquetas y los precios se mantienen estables. Cuando el proveedor informó de otro modelo concreto — una versión fechada del modelo, la elección de un router como OpenRouter auto, el modelo cargado en Ollama o LM Studio, el modelo que Grok ejecutó de verdad —, una segunda línea muestra *respondió &lt;modelo&gt;*. Las ejecuciones de captura de memoria en segundo plano también se atribuyen a ese modelo concreto.

**Esfuerzo.** La traza de cada llamada de IA registra el esfuerzo de razonamiento pedido, el esfuerzo realmente usado tras ajustarlo al modelo y de dónde vino la petición (conversación, Profundo, colega, conversación que delega, nivel de enrutamiento, predeterminado del modelo…). Ver [Proveedores — Esfuerzo de razonamiento](/docs/es/ai/providers/#reasoning-effort).

**Propósito.** Una llamada al modelo en segundo plano — una que EYAS hace para sí mismo, no un turno de conversación — muestra su grupo de propósito en la columna **Propósito**:

| Etiqueta | Llamadas en segundo plano |
|----------|---------------------------|
| **Memoria** | Captura de memoria, consolidación nocturna, el briefing de reflexión, enriquecimiento de importaciones del Data Port |
| **Aprendizaje** | El heartbeat, Autoaprendizaje, Forge, redacción de skills |
| **Títulos** | Títulos automáticos |
| **Controles de seguridad** | Juez de seguridad, crítico de completitud, planificador de rúbricas |
| **Planificación** | Propuestas de equipo, el replanificador entre fases |
| **Investigación** | Ejecuciones de investigación |
| **Clasificación** | El clasificador del enrutamiento automático |

Un turno de conversación (un turno normal de chat o de agente) muestra *—*, igual que las trazas de versiones que aún no registraban el propósito. El filtro **Propósito** ofrece **Todas las llamadas** (por defecto) o un grupo; un grupo lista solo sus llamadas en segundo plano (los turnos de conversación nunca coinciden), y cambiar el filtro vuelve a la primera página. Cada llamada en segundo plano se traza como un turno de conversación — proveedor, modelo, tokens, coste, latencia, esfuerzo pedido y efectivo (origen *nivel de enrutamiento*) — y su coste cuenta para los límites diario, semanal y mensual del presupuesto, igual que los turnos de conversación. Una llamada en segundo plano que no pudo ejecutarse porque no había ningún modelo elegible no hace ninguna llamada al modelo, no deja traza y no cuesta nada. Las llamadas de título automático se atribuyen a su conversación. Adónde van las llamadas de cada grupo: [Enrutado y presupuesto — Llamadas de modelo en segundo plano](/docs/es/ai/routing-budget/#background-model-calls-card).

**Herramientas.** La columna **Herramientas** cuenta las llamadas a herramientas de una traza igual en todos los proveedores: una llamada que el modelo devolvió a EYAS para que la ejecutara, y una llamada que una CLI ejecutó en su propio bucle — Claude Code, Grok CLI y Kimi Code CLI —, tanto si era una herramienta integrada de la CLI (shell, lectura de archivos…) como una herramienta de EYAS que llamó a través del puente de EYAS. Cada llamada cuenta una vez. Las versiones anteriores mostraban 0 en todos los turnos de CLI.

**Calidad.** La columna **Calidad** es tu propia valoración: el pulgar arriba / abajo al final de una fila marca la traza como *buena* o *mala*. EYAS no puntúa las trazas automáticamente; un número en esta columna procede de una traza registrada por una versión anterior.

**Los recuentos de tokens significan lo mismo en todos los proveedores.** Los tokens de *entrada* son los tokens del prompt que **no** salieron de la caché del proveedor; las lecturas de caché (y, en Anthropic, las escrituras de caché) se cuentan aparte. Las versiones anteriores metían la parte cacheada dentro de la entrada en la familia OpenAI y en Gemini, así que sus cifras de entrada en conversaciones con mucha caché ahora son menores y la parte cacheada aparece como lecturas de caché. Los tokens de razonamiento o thinking forman parte de los tokens de *salida*; antes faltaban los tokens de thinking de Gemini, así que la salida de los modelos de Gemini con thinking es ahora mayor. Los tokens de razonamiento de OpenAI y de thinking de Gemini también se guardan aparte como tokens de razonamiento, solo a título informativo — no se facturan dos veces. Los recuentos de Grok CLI y Kimi Code CLI siguen el mismo significado. Si un proveedor no envía ningún uso (algunos servidores compatibles, un servidor Ollama sin recuentos, una CLI cuyo runtime no informó de nada), el turno se marca como *no informado* en lugar de guardarse como un cero real; la conversación muestra *Uso no informado* y el árbol de ejecución *—* en lugar de 0 $. En la API de Anthropic la caché de prompts es automática, así que en esas llamadas aparecen los tokens de lectura y de escritura de caché (ver [Proveedores — Caché de prompts](/docs/es/ai/providers/#prompt-caching-anthropic-api)).

**Coste.** Cuando un proveedor informa de su propio coste, la traza lo usa. Si no, EYAS lo estima a partir de los recuentos de tokens y cobra cada token del prompt una sola vez: la entrada no cacheada a la tarifa de entrada, las lecturas de caché a la tarifa de lectura de caché del modelo y las escrituras de caché a su tarifa de escritura. Si la tabla de precios (o un override `model.pricing` en la configuración) no tiene tarifa de caché para un modelo, sus tokens cacheados se cobran a la tarifa normal de entrada. Una llamada cuyo uso es *no informado* nunca se valora a partir de recuentos de tokens: su coste es el que informó el propio proveedor, o 0 $. Frente a versiones anteriores:

- Kimi K3 a través de la API de Kimi, y cualquier modelo con tarifa de lectura de caché en un override `model.pricing`: las estimaciones son menores, porque la parte cacheada ya no se cuenta dos veces.
- OpenAI y Gemini con la tabla integrada: el coste de entrada no cambia.
- Modelos de Gemini con thinking: las estimaciones son mayores, porque los tokens de thinking se cobran como salida.
- Endpoints compatibles con Anthropic que no están en la tabla: los tokens cacheados se cobran a la tarifa de entrada de reserva conservadora en lugar de gratis.
- Ejecuciones de Claude Code en las que la CLI no informó de coste pero sí de tokens: los tokens de caché se cobran a las tarifas de caché de Anthropic correspondientes en lugar de gratis.

No hay nada que configurar ni que migrar: las nuevas columnas de trazas se añaden automáticamente.

**API (admins e integradores).** `GET /api/v1/observability/traces` (y `/traces/:id`) necesita permiso de lectura del registro de auditoría (read `AuditEntry`). Además de las columnas de arriba, cada traza lleva:

- `purpose` (el propósito exacto, por ejemplo `capture`, `title`, `security_judge`, `triage`), `auxRoute` (cómo se eligió el modelo: `tier` = el nivel de enrutamiento del propósito, `default` = el predeterminado de la instalación, `api` = un proveedor de API, `isolated-cli` = una CLI que puede ejecutarse aislada) y `purposeGroup` — los tres son null en los turnos de conversación;
- `toolCalls` — una lista JSON de las llamadas, cada una `{name, id}`, más `executedBy` (`provider` o `eyas`) en una llamada que la CLI resolvió en su propio bucle;
- `memoryTiersUsed` — recuentos JSON de la memoria recuperada en ese turno, por capa: `vt` nota del vault, `gs` resumen, `ft` hecho, `en` entidad, `ep` episodio, `rw` registro en bruto, por ejemplo `{"vt":75,"gs":5,"ft":3}`. Es null cuando el turno no llevó memoria, y en las llamadas sin composición de contexto (llamadas en segundo plano).

La lista acepta `purposeGroup=memory|learning|title|safety|planning|research|triage`. La consulta se valida: un `purposeGroup` desconocido, un `limit` no numérico o fuera de rango (1–500), un `offset` negativo o un `minCost` no numérico o negativo devuelven `400` en lugar de ignorarse; los parámetros vacíos cuentan como ausentes.

<h3 id="god-mode-tab">Pestaña God Mode</h3>

La pestaña **God Mode** lista las ejecuciones de conjunto (conversación, ganador, número de modelos, coste, duración, si se deshizo un empate), la tasa de victorias por modelo y el múltiplo de coste medio frente a un solo modelo. Haz clic en una ejecución para abrir la pestaña God de esa conversación (registro de pasos, quién votó a quién y los comentarios de cada modelo sobre los demás).

Cómo se monta una carrera, cómo se elige al ganador y cómo leer la pestaña God de la conversación: [Conversaciones — Modo Dios](/docs/es/daily/conversations/#modo-dios).

<h3 id="context-tab">Pestaña Contexto</h3>

La pestaña **Contexto** muestra lo que el modelo recibió *de verdad*, no lo que se pretendía enviar. Empieza con **Entrega de memoria por proveedor** (abajo), seguida de:

- **Estimado frente a real** — la diferencia entre la estimación de tokens de EYAS y lo que informó el proveedor, con el error absoluto medio;
- **Tokens medios por sección** — el coste medio y máximo en tokens de cada sección del prompt, y en cuántas muestras se basa;
- **Frecuencia de truncamiento** — con qué frecuencia, y qué sección, se recorta para caber en el presupuesto.

Los registros detallados por sección son de vida corta a propósito (7 días por defecto, `observability.contextRetentionDays`); a largo plazo solo sobrevive el resumen diario. Si buscas detalle antiguo y no lo encuentras, es lo esperado, no una pérdida de datos.

<h4 id="memory-delivery-by-provider">Entrega de memoria por proveedor</h4>

Esta tarjeta muestra, por proveedor, si sus turnos recibieron la misma memoria de EYAS — la comprobación de que un modelo de API y una CLI reciben la memoria por igual. Elige el periodo arriba a la derecha: **Últimos 7 días**, **Últimos 30 días** o **Últimos 90 días**. Hay una fila por cada proveedor que respondió turnos en el periodo; tras una conmutación por error, el turno cuenta para el proveedor que respondió de verdad.

| Columna | Significado |
|---------|-------------|
| **Proveedor** | El id del proveedor. Haz clic en él para ver sus últimos turnos |
| **Turnos con memoria** | *N de M*: los turnos cuyo mensaje llevó memoria recuperada, del total de sus turnos |
| **Elementos por capa (media)** | El número medio de elementos de memoria inyectados por capa, sobre los turnos con memoria, como insignias con el código de capa (`vt`, `gs`, `ft`, `en`, `ep`, `rw`); pasa el ratón por una insignia para ver el nombre de la capa |
| **Tokens de memoria (media)** | La media de las estimaciones de tokens propias de los elementos inyectados, sobre los turnos con memoria |
| **Consultas de memoria por turno** | *X llamadas · Y elementos*, en media sobre todos los turnos: las llamadas a `memory_search` / `memory_expand` que el modelo hizo por su cuenta y que leyeron algo, y los elementos de memoria que leyeron esas llamadas |

Al hacer clic en un proveedor se listan sus últimos 10 turnos: la hora (un enlace que abre la conversación), el modelo, los elementos por capa o *sin memoria*, los tokens de memoria y las consultas (*llamadas · elementos*, o solo *elementos* en turnos registrados antes de que se anotaran los números de llamada).

**Cómo comparar proveedores.** Valores parecidos en **Turnos con memoria** y **Elementos por capa (media)** significan que cada modelo recibió la misma memoria. **Consultas de memoria por turno** muestra si un modelo también abre la memoria por su cuenta: una CLI con muchas menos consultas que los modelos de API no está llegando a las herramientas de memoria de EYAS, o no las usa.

La tarjeta se construye a partir del detalle de composición del contexto, así que solo llega tan atrás como `observability.contextRetentionDays` (7 días por defecto): **Últimos 30 días** y **Últimos 90 días** solo muestran más si se amplía esa retención. Un turno cuyo recall no se registró elemento a elemento cuenta como turno, pero sin elementos.

**API.** `GET /api/v1/observability/memory-parity?days=N` — `N` es un entero de 1 a 90 (7 por defecto); necesita el mismo permiso read `AuditEntry` que los demás endpoints de observabilidad, y un `days` no válido devuelve `400`. La respuesta es `{days, since, providers: [{provider, turns, memoryTurns, avgItemsByLayer, avgItems, avgMemoryTokens, drillDownTurns, avgDrillDownCalls, avgDrillDownReads, recentTurns: [{compositionId, createdAt, conversationId, model, hasMemory, itemsByLayer, items, memoryTokens, drillDownCalls, drillDownReads}]}]}`.

<h4 id="single-turn-composition">La composición de un solo turno</h4>

La composición de un solo turno se abre desde la barra de contexto de la conversación — ver [Conversaciones — Composición del contexto](/docs/es/daily/conversations/#context-composition): el llenado de la ventana medido o estimado, las insignias de privacidad por sección y el recuadro **Memoria entregada**. `GET /api/v1/observability/compositions/:id` devuelve lo mismo: `composition.egress` y un `egress` por sección (`{masked, spans, skipped}`) con lo que hizo la capa de privacidad; `composition.delivery` (turnId, profile, budgetTotalTokens, recall — ids, hits, retrieved, expanded, chars, budgetChars, tokens, budgetTokens, withheld — y systemPromptChannel); y `composition.drillDown` (`{calls, reads, limit}`). Cada uno es null cuando no se registró nada; `drillDown` también es null cuando no se puede leer el registro de acceso a la memoria. El endpoint de lista no cambia. En el registro de acceso a la memoria, las filas de recall y las de consulta de un turno comparten un mismo id de turno (el id de la composición), y las filas de consulta registran el número de la llamada dentro del turno.

## Relacionado

- [Mission Control](/docs/es/agents/runs/)
- [Enrutado y presupuesto](/docs/es/ai/routing-budget/)
- [Memoria](/docs/es/knowledge/memory/)
- [Varias instancias](/docs/es/deploy/multi-instance/)
- [Seguridad](/docs/es/admin/security-privacy/)
- [Resumen de ajustes](/docs/es/admin/settings/)
- [Manos](/docs/es/admin/hands/)
- [Nodos remotos](/docs/es/admin/nodes/)
- [Extensiones](/docs/es/admin/extensions/)
- [Notificaciones](/docs/es/admin/notifications/)
