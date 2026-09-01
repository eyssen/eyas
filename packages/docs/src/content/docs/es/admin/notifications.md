---
title: Notificaciones
description: Quién se entera, por qué canal y con qué volumen — en la app, correo, Telegram, webhook.
---

**Para qué sirve.** Ajustes de notificaciones es donde decides qué eventos te llegan, por qué canal y con qué volumen. Cada preferencia es una fila patrón-de-evento × canal. Así los avisos de presupuesto, eventos de agentes y similares llegan al timbre, al correo, a Telegram o a un webhook — sin despertarte por ruido. La severidad **Crítico** omite siempre las horas de silencio y el agrupamiento.

## Cuándo usarlo

- Quieres el timbre de la app para unos eventos y **Telegram** o **Correo** para otros.
- Solo quieres **Advertencia** y superior, no cada **Info**.
- Quieres una ventana de silencio (también de noche), excepto **Crítico**.
- Quieres un resumen en lugar de un aluvión de correos o POSTs de webhook.
- Necesitas un webhook HTTPS firmado para automatización (n8n, Zapier, Home Assistant y similares).

## Flujo típico

1. Abre en la barra lateral **Ajustes** → grupo **Módulos** → **Notificaciones** (`/notifications-settings`).
2. En **Añadir preferencia**, escribe un **Patrón de evento** (por ejemplo `agent.*`, `budget.warning` o `*`).
3. Elige **Canal**, **Severidad mínima** y **Modo de entrega**.
4. Opcionalmente **Silencio desde** y **Silencio hasta**. Los rangos nocturnos como 22:00–07:00 funcionan.
5. **Añadir**. La fila aparece en **Preferencias activas**.
6. Si el canal es **Webhook**, rellena **Endpoint de webhook** y **Guardar webhook**.

Debes ver la fila nueva con patrón, canal, ≥ severidad y, si aplica, las insignias **resumen** / silencio.

## Funciones

Una fila por patrón-de-evento × canal. Los patrones son globs por segmento: `*` lo cubre todo; `agent.*` un segmento tras `agent`; `budget.warning` solo ese evento.

**Canal:** **Web** (en la app / WebSocket), **Correo**, **Telegram**, **Webhook**. Correo y Telegram solo entregan si la integración está configurada de verdad (SMTP en Secretos / bot de Telegram emparejado). Elegir el canal aquí no crea esa integración.

**Inmediato** envía ahora. **Agrupado** encola un resumen (correo y webhook; ventana por defecto cinco minutos). **Web** y **Telegram** omiten el agrupamiento. **Crítico** siempre sale al momento e ignora las horas de silencio.

Las horas de silencio usan `HH:MM` y cruzan la medianoche.

Un POST de webhook es JSON (`event`, `severity`, `title`, `body`, `data`, `createdAt`, `notificationId`). Un secreto compartido opcional añade `X-EYAS-Signature: sha256=…` (HMAC-SHA256). Se pueden guardar cabeceras HTTP extra en el endpoint (API); el formulario tiene URL, secreto y **Activado**. La pista de la página: solo URLs https; los hosts loopback y de metadatos (`169.254.169.254`, `.internal`) están bloqueados.

Los envíos fallidos van a la cola de reintentos (tres intentos, retroceso exponencial desde 30 segundos). Después **Fallidos (cola muerta)**. **Cola de reintentos** se muestra cuando los reintentos están activos.

El timbre de la cabecera lista notificaciones y marcar como leído. Esta página es solo preferencias.

## Campos y controles

<h2 id="preferences">Preferencias activas</h2>

| Control | Significado |
|---------|-------------|
| **Preferencias activas** | Filas existentes. Vacío: *Aún no hay preferencias. Añade una abajo.* |
| Insignia de patrón | Glob que coincidió, p. ej. `agent.*` |
| Insignia de canal | **Web** / **Correo** / **Telegram** / **Webhook** |
| ≥ severidad | Severidad mínima de esta fila |
| **resumen** | Cuando **Modo de entrega** es **Agrupado** |
| silencio `desde`–`hasta` | Horas de silencio de esta fila |
| Papelera | Borrar esa fila patrón × canal |

<h2 id="add-preference">Añadir preferencia</h2>

| Control | Significado |
|---------|-------------|
| **Patrón de evento** | Marcador: `agent.* o budget.warning o *` |
| **Canal** | **Web**, **Correo**, **Telegram**, **Webhook** |
| **Severidad mínima** | **Info**, **Advertencia**, **Error**, **Crítico** |
| **Modo de entrega** | **Inmediato** o **Agrupado** |
| **Silencio desde** / **Silencio hasta** | Horas. Ambos hacen falta para guardar silencio; vacío = ninguno |
| **Añadir** | Guardar la fila (desactivado si el patrón está vacío) |

<h2 id="webhook">Endpoint de webhook</h2>

| Control | Significado |
|---------|-------------|
| **URL** | Destino. Marcador `https://hooks.example.com/eyas` |
| **Secreto compartido (opcional — habilita firmas HMAC-SHA256)** | Campo de contraseña. Si ya hay secreto: *(sin cambios — déjalo en blanco para conservar el existente)* |
| **Activado** | Sin marcar, el webhook se guarda pero no se usa |
| **Guardar webhook** | Persistir URL / secreto / activado (desactivado sin URL) |
| **Quitar** | Borrar el webhook guardado (solo si existe) |

<h2 id="retry-queue">Cola de reintentos</h2>

| Control | Significado |
|---------|-------------|
| **Pendientes** | Reintentos aún programados |
| **Fallidos (cola muerta)** | Intentos agotados |
| **Actualizar** | Recargar preferencias, webhook y estadísticas de reintento |

## Relacionado

- [Resumen de ajustes](/docs/es/admin/settings/)
- [Extensiones](/docs/es/admin/extensions/)
- [Nodos remotos](/docs/es/admin/nodes/)
- [Manos](/docs/es/admin/hands/)
- [Canales](/docs/es/communication/channels/)
- [Telegram](/docs/es/communication/telegram/)
- [Secretos](/docs/es/admin/secrets/)
