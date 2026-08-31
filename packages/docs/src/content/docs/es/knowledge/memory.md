---
title: Memoria
description: Lo que EYAS recuerda — notas de vault automáticas, cinco niveles, y qué almacén usar.
---

**Para qué sirve.** La memoria es el almacén a largo plazo de EYAS. Un hecho duradero que dices en una conversación se convierte en nota de vault sin que nadie lo pida, y esa misma nota es lo que leen las conversaciones posteriores. Aquí inspeccionas bloques working, hechos episódicos, archivos de vault y la cola de revisión — no curas un wiki.

## Cuándo usarlo

- Quieres que el asistente recuerde quién eres, cómo trabajas o las restricciones de un proyecto.
- Un hecho se dijo en el chat y quieres confirmar que aterrizó en el vault (o por qué se saltó el capture).
- Revisar, etiquetar, graficar o consolidar — o **Today's note**.
- Eliges entre Memoria, wiki de Conocimiento, Documentos y archivos de vault a mano (abajo).
- Quieres el capture apagado (`memory.capture.enabled: false`).

## Flujo típico

1. Abre **Memoria** en la barra lateral (**Contenido**) — ruta `/memory`. (También en **Ajustes → IA y modelo**.)
2. Mira **Overview**, luego **Vault Files** para notas duraderas.
3. Ten una conversación de más de ~40 caracteres que enuncie un hecho duradero. Vuelve aquí tras la respuesta: una nota nueva (`user`, `feedback`, `domain`, `project` o `reference`).
4. Si no aparece nada: demasiado corto, capture off, o turno God Mode (esos no capturan). Escribe la nota a mano en el vault si aun así la necesitas.

## Qué almacén usar

| Almacén | Trabajo |
|---------|---------|
| **Memoria** (esta página) | Hechos automáticos + escritos por el agente. EYAS inyecta un índice de una línea en prompts posteriores. |
| **Conocimiento** wiki | Páginas que **tú** editas. El capture no escribe aquí. |
| **Documentos** | Archivos subidos para retrieval — no notas de identidad. |
| **Archivos de vault** (markdown a mano) | El mismo vault que el capture (`data/vault/…`). No `~/.claude` / `~/.grok`. |
| **Wiki del proyecto** | Páginas de ticket y decisión de un proyecto, no memoria global. |

La memoria host de Claude / Grok en la máquina **no** es la fuente de verdad. Las llamadas CLI aisladas y `loadClaudeMd` off por defecto evitan que una segunda memoria se adelante al vault.

## Funciones

**Ruta:** `/memory`. Acciones: Today's note · Consolidate Now · Refresh. Pestañas: Overview · Working · Episodic · Vault · Archive · Graph · Tags · Review.

Working: TTL 24h. Episodic: salience, invalidated, proveniencia. Vault: markdown + frontmatter. Archive: baja salience.

## Notas duraderas

Una nota duradera es un hecho que permanece, no el registro de algo que pasó:
quién eres, cómo quieres que se trabaje, qué restricciones tiene un proyecto.
Cada una es un archivo markdown en el vault, y el agente recibe en cada turno
un **índice de una línea** — solo los resúmenes; lee la nota entera con
`search_memory` cuando hace falta.

Lo gobiernan dos campos del frontmatter: `kind` (`user`, `feedback`, `domain`,
`project`, `reference` — también el orden) y `summary` (la línea del índice). `user` y
`feedback` van primero. `domain` es el tipo de proyecto (compartido entre hermanos);
`project` es este cliente. Sin `kind`, una nota en `procedural/` se lee como
`feedback` y el resto como `reference`, nunca como `user`. Sin `summary` se usa
la primera línea real, así que un archivo escrito a mano funciona sin
frontmatter específico de EYAS.

Ubicación: `data/vault/semantic|procedural|projects|project-types/`.

**Se llenan solas.** Una vez entregada la respuesta, una llamada a un modelo
pequeño lee el intercambio y se pregunta si hay en él algo que dentro de un mes
siga siendo cierto y siga sirviendo. Como mucho dos notas por turno, y en la
mayoría de los turnos, con razón, ninguna. Nunca ocurre dentro del camino
crítico de tu respuesta: una captura fallida cuesta una nota, jamás una
respuesta.

Delante de esa llamada solo hay una comprobación de longitud — un mensaje más
corto que `minUserChars` (40 caracteres por defecto) no la paga — y un techo de
`maxPerConversation` (20) llamadas por conversación. No hay lista de palabras
clave en ningún idioma. Se desactiva por completo con
`memory.capture.enabled: false` en `config/default.yaml`; escribir una nota a
mano y `save_memory` siguen funcionando igual.

Un hecho que se repite refuerza la nota que ya existe en vez de crear una
segunda: la nueva redacción se añade como viñeta fechada bajo `## History` y no
sobrescribe nada. El texto pasa por el módulo de privacidad antes de llegar al
disco, no al leerlo.

**Memoria de proyecto.** Lo aprendido dentro de las conversaciones de un
proyecto se guarda en `projects/<id-del-proyecto>/`, se ordena por delante de
las notas `reference` generales mientras trabajas en ese proyecto y no aparece
en ningún otro sitio: las notas de otro proyecto nunca llegan a tu prompt. El
proyecto cajón de sastre **General**, donde arranca cada conversación, no cuenta
como identidad de proyecto: lo que se aprende ahí queda como un hecho sobre ti o
sobre cómo quieres que se trabaje, y por tanto te acompaña a todas partes.

Los agentes recuerdan con `search_memory`. El **`scope` por defecto es `current`**: este proyecto, su tipo y las notas globales user/feedback/reference. `scope: all` para todo el vault. La búsqueda de la página Memoria (`/memory`) no filtra.

### El capture está encendido por defecto

El capture corre en **cada** conversación, en global, salvo `memory.capture.enabled: false` en `config/default.yaml`. Una llamada pequeña al modelo se engancha **después** de entregar la respuesta. Un capture fallido es una nota que falta, nunca una conversación fallida.

| Puerta | Por defecto | Significado |
|--------|-------------|-------------|
| `memory.capture.enabled` | **on** | Interruptor maestro |
| `minUserChars` | 40 | Puntos de código Unicode |
| `maxPerConversation` | 20 | Techo de gasto de modelo |

No hay lista de palabras clave. `{"notes":[]}` es la respuesta habitual y correcta (0–2 notas).

### CLI aislado — solo la memoria de EYAS

La extracción corre en un contexto de modelo **aislado**: sin settings del filesystem del host, sin memoria nativa del CLI, sin herramientas puenteadas, un solo turno. Las conversaciones en Claude Code CLI tienen **`loadClaudeMd` off** por defecto. Las llamadas aisladas y opt-out también ponen `CLAUDE_CODE_DISABLE_AUTO_MEMORY` y `strictMcpConfig`.

Grok / Kimi (ACP) no tienen interruptor de aislamiento; sus paneles lo dicen. Los agentes deben usar solo `search_memory` / `save_memory`; la puerta de escritura niega `~/.claude`, `~/.grok` y `ai-memory`.

Sin aislamiento el extractor leyó una vez la memoria host del dueño, dijo que el hecho «ya estaba grabado» y el vault de EYAS quedó vacío. Eso es el bug que esto cierra.

### Libro mayor de captures

Cada resultado que llega a la puerta escribe una fila `memory_capture_runs`. Dos silencios deliberados: capture apagado no escribe nada, y un run de fondo sin texto del asistente no llega a la puerta. Los turnos **God Mode** no capturan — ni nota, ni fila.

---

## Memory blocks compartidos

Además de la UI de cinco niveles, tools de agente para **bloques con scope** (estilo Letta): company / agent / team / run.

Tools: `memory_block_read` · `memory_block_write`.

## Relacionado

- [Base de conocimiento](/docs/es/knowledge/knowledge-base/)
- [Documentos](/docs/es/knowledge/documents/)
- [Wiki del proyecto](/docs/es/knowledge/client-wiki/)
- [Proveedores](/docs/es/ai/providers/) (aislamiento CLI / `loadClaudeMd`)
- [Herramientas](/docs/es/automation/tools/)
