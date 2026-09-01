---
title: Telegram
description: Token de BotFather, vault de secretos, vínculo de agente y emparejamiento de DMs.
---

**Para qué sirve.** Telegram es el canal de chat de primera clase: un bot de BotFather cuyos DMs (tras el emparejamiento) ejecutan un agente EYAS vinculado. El secreto va al vault, no a YAML.

**Ruta:** `/communication` → **Canales** → Telegram. Emparejamiento: **Comunicación → Emparejamiento**.

## Cuándo usarlo

- Escribir al asistente desde el teléfono.
- Un segundo bot (trabajo vs personal) como otra instancia.
- Los DMs se ignoran — aún no aprobaste el emparejamiento.
- Una herramienta amarilla o roja espera y quieres **Aprobar** / **Denegar** en Telegram.
- Un hilo nuevo desde el mismo chat (`/new` o `/start`).

## Flujo típico

1. Telegram → **@BotFather** → `/newbot`.
2. Copia el token HTTP API.
3. En EYAS pégalo, elige **Agente para mensajes de entrada**, **Guardar y conectar**.
4. Escribe al bot. Aprueba el código en **Emparejamiento**.
5. Los DMs siguientes de ese remitente siguen la misma conversación. Un campo de token vacío conserva el valor guardado. `/new` o `/start` abre un hilo nuevo.

Campo: **Token de bot de @BotFather** (cifrado, clave `telegram-bot-token`). Badge **Emparejamiento**. Varios bots = varias instancias.

Tras el emparejamiento, el **primer mensaje** crea una conversación; los siguientes la continúan. `/new`, `/start` y `/new@bot` sueltan el mapeo — el bot responde *Started a new conversation. Send a message to begin.* El comando slash **no** va al modelo.

Herramienta amarilla/roja: ping de Telegram con **Approve** / **Deny** al chat de la conversación (o un emparejamiento aprobado). Misma ruta `decide()` que [Autonomía](/docs/es/agents/autonomy/). El ping nombra la herramienta y un motivo corto — **nunca** argumentos crudos.

## Relacionado

- [Canales](/docs/es/communication/channels/)
- [Secretos](/docs/es/admin/secrets/)
- [Agentes — canales](/docs/es/agents/configure/)
- [Autonomía](/docs/es/agents/autonomy/)
