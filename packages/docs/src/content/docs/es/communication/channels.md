---
title: Canales — resumen
description: Instancias de mensajería externa — tipos, modos, cola de entrada, emparejamiento. No Conexiones, no Manos.
---

**Para qué sirve.** Los canales son cómo la gente fuera de esta máquina escribe a un agente EYAS: Telegram, Slack, correo y el resto del catálogo. Cada instancia tiene sus secretos y un agente vinculado. **No** es [Conexiones](/docs/es/admin/connections/) ni [Manos](/docs/es/admin/hands/). MCP y A2A viven en sus propias páginas.

**Ruta:** `/communication` → **Canales · Cola de entrada · Emparejamiento**.

## Cuándo usarlo

- Hablar con el agente primario desde Telegram (u otro tipo del catálogo) sin la UI web.
- Dos bots del mismo tipo — segunda instancia.
- Entrada atascada — cola durable, reencolar una fila **dead**.
- Un DM de Telegram espera un código de emparejamiento.

## Flujo típico

1. **Comunicación** → **Canales**.
2. Abre una tarjeta o **Añadir instancia**.
3. Secretos, **Agente para mensajes de entrada**, **Guardar y conectar**.
4. **Autónomo** o **Gestionado**.
5. DMs de Telegram: escribe al bot, aprueba en **Emparejamiento**.

Catálogo (MCP/A2A **no** son canales de chat): Telegram (emparejamiento), Discord, Slack (Socket Mode, `xoxb-`+`xapp-`), Email SMTP/IMAP, Gmail API, Microsoft 365 Graph, WhatsApp Business (webhook `/api/v1/webhooks/whatsapp`), Signal (puente signal-cli; EYAS no embebe Signal), Google Chat, Microsoft Teams.

Cola: pending / delivered / dead / skipped. Emparejamiento: Aprobar/Rechazar, sobrevive reinicios.

## Relacionado

- [Telegram](/docs/es/communication/telegram/)
- [A2A](/docs/es/communication/a2a/)
- [Agentes — canales](/docs/es/agents/configure/)
- [Conexiones](/docs/es/admin/connections/)
- [Manos](/docs/es/admin/hands/)
- [Ingress](/docs/es/admin/ingress/)
