---
title: Reuniones
description: Ingesta grabaciones (Fireflies y similares) a transcripciones, resúmenes y action items.
---

**Para qué sirve.** Reuniones es la superficie de ingesta de grabaciones: listar reuniones, traer transcripciones y resúmenes de un proveedor, y guardar action items junto al resto del trabajo. La UI del producto sigue marcada **Coming Soon**; el proveedor de backend (Fireflies) ya está cableado y falla cerrado sin clave API.

## Cuándo usarlo

- Quieres reuniones de Fireflies (o un proveedor futuro) listadas en EYAS, no solo en la app del vendor.
- Necesitas transcripción, resumen o lista de action items junto a follow-ups del Tablero — cuando la ingesta esté lista.
- Compruebas por qué la lista está vacía: no hay secret `fireflies-api-key`, o aún está el banner planificado.

## Flujo típico

1. Abre **Ajustes → Reuniones** (barra lateral **Ajustes**, grupo **Infraestructura**) — ruta `/meetings`.
2. Lee el banner **Coming Soon** / **Planned**.
3. Si hay una clave Fireflies como secret `fireflies-api-key` (ámbito system), la API puede listar; la página muestra entonces una tabla. Sin clave el proveedor queda unconfigured y devuelve lista vacía — nunca fabrica transcripciones.
4. Debes ver el vacío (*No meetings recorded yet*) o filas con título, fecha, duración, participantes y estado.

## Funciones

Subtítulo: *Meeting recordings, transcripts, and action items.* Banner **Coming Soon**. Columnas: Title, Date, Duration, Participants, Status. Adaptador Fireflies por GraphQL fijo, fetch seguro frente a SSRF. Sin clave: lista vacía; detalle «not configured». Sin datos inventados.

## Relacionado

- [Tablero](/docs/es/daily/board/)
- [Secretos](/docs/es/admin/secrets/)
- [Memoria](/docs/es/knowledge/memory/)
