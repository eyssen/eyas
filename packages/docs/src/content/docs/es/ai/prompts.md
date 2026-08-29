---
title: Sistema de prompts
description: Prompts en capas — master → tipo de proyecto → proyecto → conversación — más coaches.
---

**Para qué sirve.** Cada ronda apila capas de prompt, no un blob. **Master** es la identidad global (algunas secciones bloqueadas). **Tipo de proyecto** y **Proyecto** refinan. **Conversación** es del hilo. Los agentes tienen **Prompt de sistema**. El **Mejorador de prompts** del compositor es solo para borradores de una vez.

**Rutas:** `/prompts` (barra **Prompts**), `/prompt-settings`.

## Cuándo usarlo

- Voz de casa (**personality** editable) sin tocar reglas bloqueadas.
- Un tipo de proyecto debe llevar un brief heredable.
- Un proyecto necesita convenciones de dominio que no se filtren.
- Borrador débil — Mejorador, no un cambio de capa durable.

## Flujo típico

1. **Prompts** (`/prompts`): **Master / Tipo de proyecto / Proyecto / Conversación**.
2. Bloqueados: **Solo lectura**. Resto: editar, activar/desactivar, borrar.
3. `/prompt-settings`: solo **personality** es editable. Guardar: `PATCH /prompts/master/personality`.
4. Brief durable: **Prompt coach** en el formulario, **Aplicar**.
5. Prompt de usuario de una vez: **Mejorador de prompts** desde el compositor.

## Relacionado

- [Proyectos](/docs/es/daily/projects/)
- [Agentes — prompt de sistema](/docs/es/agents/configure/)
- [Conversaciones](/docs/es/daily/conversations/)
- [Enrutado y presupuesto](/docs/es/ai/routing-budget/)
