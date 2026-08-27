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

**Todavía no las escribe nada de forma automática**: el vault contiene
exactamente lo que se puso en él a propósito.

---

## Memory blocks compartidos

Además de la UI de cinco niveles, tools de agente para **bloques con scope** (estilo Letta): company / agent / team / run.

Tools: `memory_block_read` · `memory_block_write`.

## Relacionado

- [Base de conocimiento](/docs/es/knowledge/knowledge-base/)
- [Herramientas](/docs/es/automation/tools/)
