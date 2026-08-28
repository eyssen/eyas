---
title: Memoria
description: Memoria híbrida de cinco niveles y memory blocks compartidos.
---

**Ruta:** `/memory`. Acciones: Today's note · Consolidate Now · Refresh. Pestañas: Overview · Working · Episodic · Vault · Archive · Graph · Tags · Review.

Working: TTL 24h. Episodic: salience, invalidated, proveniencia. Vault: markdown + frontmatter. Archive: baja salience.

## Notas duraderas

Una nota duradera es un hecho que permanece, no el registro de algo que pasó:
quién eres, cómo quieres que se trabaje, qué restricciones tiene un proyecto.
Cada una es un archivo markdown en el vault, y el agente recibe en cada turno
un **índice de una línea** — solo los resúmenes; lee la nota entera con
`search_memory` cuando hace falta.

Lo gobiernan dos campos del frontmatter: `kind` (`user`, `feedback`, `project`,
`reference` — también el orden) y `summary` (la línea del índice). `user` y
`feedback` van primero. Sin `kind`, una nota en `procedural/` se lee como
`feedback` y el resto como `reference`, nunca como `user`. Sin `summary` se usa
la primera línea real, así que un archivo escrito a mano funciona sin
frontmatter específico de EYAS.

Ubicación: `data/vault/semantic|procedural|projects/`.

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

---

## Memory blocks compartidos

Además de la UI de cinco niveles, tools de agente para **bloques con scope** (estilo Letta): company / agent / team / run.

Tools: `memory_block_read` · `memory_block_write`.

## Relacionado

- [Base de conocimiento](/docs/es/knowledge/knowledge-base/)
- [Herramientas](/docs/es/automation/tools/)
