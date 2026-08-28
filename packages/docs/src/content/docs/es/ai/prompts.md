---
title: Sistema de prompts
description: Capas de prompts, Prompt Enhancer y Prompt Coaches.
---

**Rutas:** Ajustes → Prompts · **Prompt Enhancer** en conversación · **Prompt coach** en Proyectos / Agentes.

## Capas

Master (parcialmente bloqueado) → project type → project → conversation · más **Agent System Prompt**. Las capas inferiores refinan las superiores.

---

## Prompt Enhancer (borradores de conversación)

Desde el composer: optimiza prompts **puntuales** para la **familia de modelo** del hilo (tipos de tarea, quality score, alternativas). Detalles: [Conversaciones](/docs/es/daily/conversations/).

---

## Prompt Coach (capas duraderas)

| Ámbito | Dónde | Qué optimiza |
|--------|-------|--------------|
| **Project type** | Projects → Types → Prompt | Defaults reutilizables del tipo |
| **Project** | Projects → Project → Prompt | Brief operativo del proyecto |
| **Agent system** | Agents → Configuration → System Prompt | Protocolo del agente (no voz, no dominio de proyecto) |

Controles: badge de scope · Send · Quality N/10 · Propose two alternatives · Apply.

## Relacionado

- [Proyectos](/docs/es/daily/projects/)
- [Configurar agentes](/docs/es/agents/configure/)
