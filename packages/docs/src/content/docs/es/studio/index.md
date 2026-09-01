---
title: Estudio
description: Motores locales que convierten HTML escrito en vídeo. No es Media.
---

**Para qué.** Estudio ejecuta **motores de producción locales**: el agente escribe HTML y esta máquina genera un archivo. El primero es Hyperframes. [Media](/docs/es/ai/media/) es la otra vía: prompt→píxeles. No las mezcles.

**Ruta:** `/studio`. Barra: **Contenido → Estudio**.

## Cuándo

- Motion graphic, título o explainer en HTML, MP4 determinista.
- No un vídeo generativo a partir de un prompt — eso es Media.

## Flujo

1. Abre **Estudio** (`/studio`).
2. Tarjeta Hyperframes: Node.js 22+, FFmpeg, CLI.
3. En el chat: `hyperframes_status` → create → write → lint → render.
4. El MP4 llega a Documentos y a ese turno.

Ver [Hyperframes](/docs/es/studio/hyperframes/) y [Video Use](/docs/es/studio/videouse/).

## Relacionado

- [Hyperframes](/docs/es/studio/hyperframes/)
- [Video Use](/docs/es/studio/videouse/)
- [Media](/docs/es/ai/media/)
- [Extensiones](/docs/es/admin/extensions/#recordly) — Recordly (grabador AGPL) es un compañero de terceros, no un motor de Estudio
