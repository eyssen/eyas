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

## Flujo típico

1. Telegram → **@BotFather** → `/newbot`.
2. Copia el token HTTP API.
3. En EYAS pégalo, elige **Agente para mensajes de entrada**, **Guardar y conectar**.
4. Escribe al bot. Aprueba el código en **Emparejamiento**.
5. Los DMs siguientes de ese remitente ejecutan el agente. Un campo de token vacío conserva el valor guardado.

Campo: **Token de bot de @BotFather** (cifrado, clave `telegram-bot-token`). Badge **Emparejamiento**. Varios bots = varias instancias.

## Relacionado

- [Canales](/docs/es/communication/channels/)
- [Secretos](/docs/es/admin/secrets/)
- [Agentes — canales](/docs/es/agents/configure/)
