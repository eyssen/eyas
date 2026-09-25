---
title: A2A y agentes externos
description: Protocolo agente-a-agente — agent card, tareas de entrada, federación opcional.
---

**Para qué sirve.** A2A es cómo otro runtime de agentes descubre esta EYAS y le entrega una tarea — no una persona en Telegram, ni una [Mano](/docs/es/admin/hands/). Agent Card en `/.well-known/agent-card.json`. `tasks/send` crea una conversación y ejecuta `executeAgent`. La federación de pares existe como API; **no** hay pestaña de Comunicación.

## Cuándo usarlo

- Un cliente A2A debe descubrir esta instancia y enviar tareas.
- EYAS detrás de [Ingress](/docs/es/admin/ingress/) — URL well-known y esquema de auth.
- Dos instancias EYAS federadas (`/api/v1/federation/peers`).

## Flujo típico

1. Decide el límite de confianza. Solo con exposición de red intencional, detrás de auth/ingress.
2. `GET /.well-known/agent-card.json` (`authentication.schemes` por defecto `bearer`).
3. El par envía `tasks/send` — conversación + `executeAgent`.
4. Opcional: `POST /api/v1/federation/peers`. Comparte el token inbound una vez; rota con `POST …/rotate-inbound`. Dirección `peerId/agentId`.

**Sin memoria del propietario para los pares.** Una tarea que otro agente envía por A2A recibe la fecha y la hora actuales, pero no se le inyecta ninguna memoria recordada del propietario — el bloque de memoria recordada que recibe toda ejecución interna se retiene. Las herramientas de memoria (`memory_search` / `memory_expand`) no cambian y siguen gobernadas por el security gate. Lo que envía un par se recuerda como texto de *par*, no como tuyo. Ver [Memoria — Cómo llega el recall al modelo](/docs/es/knowledge/memory/#how-recall-reaches-the-model).

**Captura de memoria en las tareas A2A.** Una tarea A2A ahora también ejecuta el capture de memoria duradera de EYAS, con los mismos ajustes `memory.capture.*` que un turno de chat. La tarea del par se lee como palabras de un tercero: nunca crea una nota sobre quién eres ni una regla sobre cómo debe trabajar EYAS, solo notas `reference`, `project` o `domain` guardadas con confianza de par (`trust: peer`), y nunca se suma a una de tus propias notas. Solo las palabras propias del par cuentan para `minUserChars`. Ver [Memoria — El capture está encendido por defecto](/docs/es/knowledge/memory/#capture-is-on-by-default).

**Modelo y esfuerzo.** Una tarea A2A se ejecuta como una conversación del agente vinculado: sigue el modelo y el esfuerzo de ese agente; si el agente no tiene modelo, el predeterminado de la instalación se fija en la conversación con su primera respuesta.

**El texto del par va enmarcado.** La descripción de la tarea llega al modelo dentro de un bloque de entrada no confiable (fuente `a2a`), como los mensajes de canal, con sus etiquetas de control neutralizadas — así un par no puede empezar su tarea con texto que parezca el bloque propio de fecha y hora o de memoria recuperada de EYAS.

Skills por defecto en la card: `research`, `code-review`. El catálogo de canales excluye MCP/A2A como tarjetas de chat.

## Relacionado

- [Ingress](/docs/es/admin/ingress/)
- [Canales](/docs/es/communication/channels/)
- [Agentes](/docs/es/agents/overview/)
- [Herramientas](/docs/es/automation/tools/)
