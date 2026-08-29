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

Skills por defecto en la card: `research`, `code-review`. El catálogo de canales excluye MCP/A2A como tarjetas de chat.

## Relacionado

- [Ingress](/docs/es/admin/ingress/)
- [Canales](/docs/es/communication/channels/)
- [Agentes](/docs/es/agents/overview/)
- [Herramientas](/docs/es/automation/tools/)
