---
title: Habilidades
description: Catálogo de habilidades — fuentes, filtros, inventario, auto-adopción y la propuesta en conversación.
---

**Para qué sirve.** Una habilidad es un paquete de procedimiento en markdown que el agente carga cuando el trabajo coincide con sus patrones. Esta página es el catálogo. No es una herramienta: las herramientas se invocan; las habilidades dicen *cómo*.

**Ruta:** `/skills`. Pestañas: **Explorar** · **Inventario**. Barra: **Habilidades**.

## Cuándo usarlo

- Un playbook repetible (cadena Odoo, runbook, estilo de casa).
- Importaste de otro asistente y quieres ver qué copia de un id carga.
- Una conversación propuso una habilidad: rechazarla o apagarla en global.
- Habilidades generadas aparecen y quieres saber por qué entraron o no.

## Flujo típico

1. **Habilidades** (`/skills`).
2. **Explorar**: busca o filtra **Todas / Skills propias / Integradas**, luego **Crear habilidad**.
3. **Nombre de la habilidad**, **Patrones de activación**, **Contenido / plantilla**.
4. **Inventario**: qué copia ganó, usos, si está activa.
5. En conversación la ronda espera. **Úsala**, **Ahora no**, o (owner/admin) **Desactivar**.

## Funciones

Una habilidad coincidente es una **propuesta a la que la ronda espera**. Nada corre hasta que respondes. **Úsala** / **Ahora no** (solo esta conversación) / **Desactivar** (global; solo owner/admin). Cambio 0.8.15: el tercer botón es global. Ver [Conversaciones](/docs/es/daily/conversations/).

Auto-adopción: las generadas/evolucionadas **no** entran vivas sin un snapshot de benchmark privado con **pass ratio** y **puntuación media** mínimos. Crear/activar a mano no pasa por esa puerta.

**Inventario:** una fila por id. Precedencia **User > Generated > Imported (`skills.importRoots`) > Bundled (extensión) > Bundled (EYAS)**. El detector **solo propone**: huérfana, sombreada, nunca usada (0, >90 días), inactiva (180+). [Cola de autonomía](/docs/es/agents/autonomy/). **Desactiva, no borra.** Huérfana/sombreada al instante; nunca usada/inactiva tras 30 días; las user skills quedan fuera de las reglas de tiempo.

<h3 id="import-roots">Importar raíces de skills adicionales</h3>

Las skills del host **no** las carga Claude Code — siempre corre aislado. Carpetas extra en `local.yaml` (`skills.importRoots` / `agent.importRoots`, lista **vacía** por defecto). Estas raíces se leen en **cada arranque**, así que son una fuente en vivo — solo para carpetas normales, como una carpeta de equipo tipo `/opt/team-skills`. Una raíz que está dentro de, o contiene, las carpetas propias de otro asistente o app de notas se **omite**: `~/.claude` (skills, agentes, plugins), `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium`, `~/.copilot`, `~/.agents`, `~/.config/agents`, las carpetas de OpenCode, los ajustes y bóvedas de Obsidian, `security.foreignMemoryPaths` y los directorios personales de CLI propios de EYAS. Una raíz como tu carpeta personal entera también se omite, porque los contiene. Cada raíz omitida deja un aviso en el log al arrancar y aparece como aviso **Import roots** en `eyas doctor`.

Las skills ya importadas desde esa carpeta se quedan en EYAS; solo dejan de refrescarse desde ella. Para traer ese contenido, o refrescarlo, haz una vez una [Importación de datos](/docs/es/admin/data-port/) de la carpeta — se copia a EYAS con su origen registrado — y luego quita la entrada de `local.yaml`. Ver [Configuración — Raíces adicionales de skills y personas](/docs/es/deploy/configuration/#extra-skill-and-persona-roots).

## Relacionado

- [Herramientas](/docs/es/automation/tools/)
- [Autoaprendizaje](/docs/es/automation/self-learning/)
- [Autonomía](/docs/es/agents/autonomy/)
- [Conversaciones](/docs/es/daily/conversations/)
- [Investigación](/docs/es/automation/research/)
