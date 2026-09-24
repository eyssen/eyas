---
title: Canales — resumen
description: Instancias de mensajería externa — tipos, modos, cola de entrada, emparejamiento. No Conexiones, no Manos.
---

**Para qué sirve.** Los canales son la vía por la que la gente fuera de esta máquina escribe a un agente de EYAS: Telegram, Slack, correo y el resto del catálogo. Cada instancia tiene sus propios secretos y un agente vinculado. **No** es [Conexiones](/docs/es/admin/connections/) (Odoo, GitHub, inventario MCP) ni [Manos](/docs/es/admin/hands/) (un dispositivo local que ofrece herramientas de sistema o de CLI). MCP y A2A son integraciones de otra forma y tienen sus propias páginas.

**Ruta:** `/communication` → pestañas **Canales · Cola de entrada · Emparejamiento**. Subtítulo: *Conecta canales de mensajería y asígnalos a tu agente principal.*

## Cuándo usarlo

- Quieres hablar con tu agente principal desde Telegram (u otro tipo del catálogo) sin abrir la UI web.
- Tienes dos bots del mismo tipo (trabajo + personal) y necesitas una segunda instancia.
- Los mensajes entrantes están atascados y necesitas la cola duradera (reintentar una fila **muerto**).
- Un DM de Telegram espera un código de emparejamiento.

## Flujo típico

1. Abre **Comunicación** (`/communication`) en la pestaña **Canales**.
2. Despliega una tarjeta del catálogo, o **Añadir instancia** para otra cuenta del mismo tipo.
3. Pega los secretos, elige el **Agente para mensajes entrantes** y pulsa **Guardar y conectar**.
4. Elige **Autónomo** (sin supervisión, aún controlado por la escala de autonomía) o **Gestionado** (el gate de seguridad en cada llamada a herramienta).
5. Para DMs de Telegram: escribe al bot y aprueba el código en **Emparejamiento**. Vigila la **Cola de entrada** si fallan las entregas.

## Funciones

Puedes tener **varias cuentas del mismo tipo** (p. ej. dos bots de Telegram), cada una con sus credenciales y su agente. Usa **Añadir instancia** o, en la tarjeta, **Añadir instancia …**.

### Tipos de canal (catálogo) {#channel-types}

Estos son los tipos de mensajería que ofrece EYAS. MCP / A2A **no** son canales de chat.

| Tipo | Qué conectas | Emparejamiento | Extra |
|------|--------------|----------------|-------|
| **Telegram** | Token de la API HTTP de BotFather | Sí — DMs desconocidos | De primera clase; ver [Telegram](/docs/es/communication/telegram/) |
| **Discord** | Token del bot de la aplicación | No | Necesita `discord.js` en tiempo de ejecución |
| **Slack** | Token del bot (`xoxb-`) + token de nivel de app (`xapp-`) | No | Socket Mode — sin webhook público |
| **Email (SMTP/IMAP)** | SMTP (obligatorio) + IMAP opcional | No | Cualquier buzón |
| **Gmail (API)** | Id y secreto de cliente OAuth, refresh token, buzón | No | API de Gmail |
| **Microsoft 365 (Graph)** | Tenant, id y secreto de cliente, UPN del buzón | No | Credenciales de app de Graph |
| **WhatsApp Business** | Id del número de teléfono, token de acceso, token de verificación, secreto de la app | No | Webhook `/api/v1/webhooks/whatsapp` |
| **Signal** | Número E.164 del bot + URL del puente HTTP de signal-cli | No | EYAS no incluye Signal |
| **Google Chat** | Id de proyecto/app, token de envío y espacio por defecto opcionales | No | Webhook `/api/v1/channels/googlechat/webhook` |
| **Microsoft Teams** | Id de app, contraseña de app, tenant opcional | No | Webhook `/api/v1/channels/teams/webhook` |

Cada tarjeta despliega **Cómo configurarlo** con pasos numerados antes del formulario de credenciales. Los tipos con webhook muestran además **Rutas de webhook a exponer**.

## Campos y controles

### Crear instancia {#create-instance}

| Campo | Significado |
|-------|-------------|
| **Tipo de canal** | Plantilla del catálogo |
| **Nombre visible** | p. ej. Signal trabajo, Telegram personal |
| **Crear y conectar** | Crea la instancia e inicia la conexión |
| **Eliminar instancia** | Elimina la instancia y sus credenciales (con confirmación) |

### Estado de la instancia {#status}

| Estado | Significado |
|--------|-------------|
| **Conectado** | Conexión activa |
| **Desconectado** | Sin conexión |
| **Credenciales definidas** | Secretos guardados; puede hacer falta conectar |
| **Sin configurar** | Faltan secretos |
| **Error** | Último error |
| Salud **Conflicto / Error de autenticación / Degradado** | Estado operativo |

### Modo {#mode}

| Modo | Significado |
|------|-------------|
| **Autónomo** | Se ejecuta sin supervisión; la escala de autonomía gradual sigue controlando cada acción |
| **Gestionado** | El gate de seguridad controla cada llamada a herramienta |

Un clic alterna entre los modos (los tooltips explican cada uno).

### Memoria en las respuestas de canal {#memory-in-replies}

Una respuesta dada con la voz **interna** del propietario recibe el mismo bloque de memoria recordada, con la fecha y la hora actuales, que un turno de chat (ver [Memoria — Cómo llega el recall al modelo](/docs/es/knowledge/memory/#how-recall-reaches-the-model)). Una respuesta cuyo ámbito de voz es **Externo** — **Forzar: Externo** fijado en la conversación, o una anulación temporal — solo recibe la fecha y la hora: no se inyecta memoria recordada del propietario a un lector externo. Si EYAS no puede determinar el ámbito de voz de una respuesta, esta también sale sin memoria recordada. Las herramientas de memoria no cambian y siguen gobernadas por el gate de seguridad.

La lista **Tools** del agente vinculado se aplica a las respuestas de canal como en cualquier otro camino, más `memory_search` y `memory_expand` ([Configurar — Herramientas](/docs/es/agents/configure/#tools--constraints)). Lo que escriben los remitentes de un canal se recuerda como texto de *par*, no como tuyo.

**Captura de memoria en las respuestas de canal.** Cada respuesta de canal ahora también ejecuta el capture de memoria duradera de EYAS, con los mismos ajustes `memory.capture.*` que un turno de chat. El mensaje del remitente se lee como palabras de un tercero: nunca puede crear una nota sobre quién eres ni una regla sobre cómo debe trabajar EYAS, solo puede producir notas `reference`, `project` o `domain`, que llevan `trust: peer` y se guardan con confianza de par, y una nota así nunca se suma a una de tus propias notas. La comprobación de longitud solo cuenta las palabras del remitente, así que un «ok» corto no paga ninguna llamada al modelo, y una conversación de canal comparte un único techo `maxPerConversation` entre todos sus mensajes. Ver [Memoria — El capture está encendido por defecto](/docs/es/knowledge/memory/#capture-is-on-by-default).

**Modelo y esfuerzo.** Una conversación de canal sigue el modelo del agente vinculado; si el agente no tiene ninguno, el predeterminado de la instalación se fija en la conversación con su primera respuesta. También se aplica el esfuerzo de razonamiento propio del agente. Cada respuesta de canal registra el proveedor y el modelo que respondieron, y el esfuerzo con el que se ejecutó.

### Mensajes rechazados (privacidad) {#refused-messages}

Un canal siempre cuenta como destino remoto. Un mensaje entrante que lleva un valor que la política de privacidad pone en **Bloquear** — por defecto un IBAN, un número de cuenta bancaria, un número fiscal, un número de documento de identidad, un número de tarjeta o un SSN de EE. UU., más cualquier patrón personalizado en Bloquear — se rechaza antes de guardar nada:

- El remitente recibe una respuesta automática en el idioma en que escribió (inglés, húngaro, alemán, español, francés o klingon; inglés si no está claro). Nombra los tipos, nunca los valores, y le pide que vuelva a enviarlo sin esos valores.
- No se crea ninguna conversación, mensaje ni ejecución de agente. En la **Cola de entrada**, el evento aparece con el estado **omitido** y el error `privacy_blocked`, y solo se conserva su texto enmascarado. Si falla el envío del aviso, el evento se reintenta como cualquier entrega.
- Los mensajes ya guardados antes de un cambio de política no se rechazan después. Las direcciones de correo y los números de teléfono (clase Enmascarar) y los valores de clase Avisar nunca se rechazan.

Cada rechazo se audita como `privacy.inbound_refused` (los tipos y el id del evento de entrada, nunca un valor). Ver [Seguridad y privacidad — Mensajes rechazados](/docs/es/admin/security-privacy/#refused-messages).

### Credenciales y vinculación del agente {#credentials}

| Campo | Significado |
|-------|-------------|
| Campos secretos | Propios de cada canal (ver la tarjeta o el capítulo de Telegram) |
| *Deja en blanco para conservar el valor actual* | Marcador al editar |
| Distintivo **definido** | El secreto ya está guardado |
| **Agente para mensajes entrantes** | Qué agente responde; por defecto el asistente principal |
| **— ninguno (mensaje guardado, sin respuesta automática) —** | Solo guardar |
| **Agente vinculado** | Agente vinculado actualmente |
| **Guardar y conectar** | Guarda los secretos y conecta |
| **Probar / Conectar / Desconectar / Reconectar / Configurar** | Acciones del ciclo de vida |

### Pestaña Cola de entrada {#inbound}

Cola duradera de al menos una entrega para los mensajes entrantes de los canales. Las entregas fallidas se reintentan con espera y acaban en la cola de mensajes muertos; las filas **muerto** pueden reencolarse.

| Columna | Significado |
|---------|-------------|
| **Origen** | Instancia del canal |
| **Remitente** | Id / nombre del remitente |
| **Mensaje** | Cuerpo |
| **Intentos** | Intentos de entrega |
| **Recibido** | Antigüedad (*hace Ns / hace N min / hace N h*) |

La columna **Estado** muestra **pendiente**, **entregado**, **muerto** u **omitido**; el motivo de una fila fallida u omitida aparece bajo el mensaje (por ejemplo `privacy_blocked`, ver [arriba](#refused-messages)). **Reintentar** en una fila **muerto** la vuelve a encolar; **Actualizar** recarga la lista.

### Pestaña Emparejamiento {#pairing}

Los remitentes desconocidos reciben un código de emparejamiento y esperan aquí. Aprobar concede al canal acceso a su agente vinculado; los emparejamientos sobreviven a los reinicios. Telegram es el tipo del catálogo con **supportsPairing**.

| Control | Significado |
|---------|-------------|
| Distintivo **Emparejamiento** | En la tarjeta del canal cuando se requiere emparejamiento |
| **Aprobar / Rechazar** | Decisión sobre una solicitud pendiente |
| Columnas | Origen, Remitente, Código, Solicitado |

Vacío: *No hay solicitudes de emparejamiento pendientes.*

## Relacionado

- [Telegram](/docs/es/communication/telegram/)
- [A2A](/docs/es/communication/a2a/)
- [Agentes — canales](/docs/es/agents/configure/)
- [Conexiones](/docs/es/admin/connections/)
- [Manos](/docs/es/admin/hands/)
- [Ingress](/docs/es/admin/ingress/)
