---
title: Media
description: Conecta Magnific, Higgsfield o fal. Los agentes generan con cinco herramientas compartidas. Compara backends y elige uno — o varios.
---

**Para qué sirve.** Media es cómo EYAS genera, amplia y espera imágenes, vídeo, audio, ediciones y 3D. Tú eliges los backends; el agente usa **un solo conjunto de herramientas**. Ninguno de los tres proveedores es el predeterminado. Cero conectados = vacío, fail-closed — nunca píxeles inventados.

**Ruta:** `/media`. Barra: **Media** (después de Proveedores). Título: **Media**.

## Cuándo usarlo

- Quieres que el agente genere o amplíe una imagen, haga un vídeo o espere un trabajo largo.
- Tienes cuenta Magnific, Higgsfield o fal y **no** quieres cincuenta herramientas del vendedor en el modelo.
- Los créditos cuestan dinero y necesitas techos diarios/mensuales o un valor por tipo.
- Los archivos terminados deben ir a [Documentos](/docs/es/knowledge/documents/) y al turno de chat que los produjo.

## Flujo típico

1. Abre **Media** (`/media`).
2. Lee **¿Qué backend?** en esa página y **Conecta** uno (o varios). Magnific y Higgsfield: OAuth en el navegador; fal: clave API.
3. El estado debe decir **Conectado**. Configura **Enrutamiento** y, si quieres, **Presupuesto**.
4. Pregunta en una conversación. El agente debe llamar `media_catalog`, luego `media_generate`, luego `media_wait`.
5. Al terminar, EYAS copia el archivo a Documentos y lo adjunta a ese turno. Las URL del CDN caducan — confía en el documento guardado.

## ¿Qué backend? {#compare}

Las tablas de marketing hablan de «público objetivo» y «web vs API». En EYAS importan otras cosas: **en qué es mejor, cómo entras, cómo van los créditos y qué pasa con el archivo.**

| Criterio | Magnific | Higgsfield | fal |
|----------|----------|------------|-----|
| **Mejor en** | Fotos fotorrealistas, upscale **Creative** guiado por prompt, upscale fiel **Precision** | Vídeo cinematográfico, consistencia de personaje (Soul) | Catálogo enorme, comprobar el precio antes de ejecutar |
| **Tipos en EYAS** | Ampliación, imagen, edición (también vídeo / audio / 3D) | Vídeo, imagen (también audio) | Imagen, vídeo, audio, 3D, ampliación |
| **Acceso** | OAuth (cuenta Magnific) | OAuth (cuenta Higgsfield) | Clave API Bearer (`fal-api-key`) |
| **Créditos** | El mismo saldo que el sitio Magnific. El **Unlimited web no cubre** MCP/API | MCP **siempre** gasta créditos, aunque el plan web sea ilimitado | El MCP es gratis; pagas la ejecución del modelo |
| **Resultado** | URL CDN — EYAS copia los bytes | Las URL caducan en unos **siete días** — el ingest es obligatorio | URL CDN — igual se copia |
| **Conéctalo primero si…** | Amplías, retocas o necesitas stills | Necesitas clips o un personaje fijo | Quieres muchos modelos o el precio primero |

**Recomendación**

1. **Conecta un backend para el trabajo que realmente tienes.** Stills y ampliación → Magnific. Vídeo / personaje → Higgsfield. Catálogo amplio o «¿cuánto cuesta?» → fal.
2. **Añade un segundo cuando cambie el tipo**, no «por si acaso». **Predeterminado / reserva** cubre una caída; **También ejecutar en** manda *el mismo* prompt a extra vendedores y **duplica créditos**. Déjalo vacío salvo que pidas una comparativa.
3. **No actives las herramientas MCP crudas** salvo para depurar. Eso vuelca la lista del vendedor en el agente y se salta el ingest.

Imágenes y prompts **salen de esta máquina** hacia el vendedor conectado. Trátalo como cualquier otro SaaS.

## Cinco herramientas

| Herramienta | Para qué | Riesgo |
|-------------|----------|--------|
| `media_generate` | Iniciar un trabajo (`image`, `video`, `audio`, `upscale`, `edit`, `3d`) | amarillo |
| `media_wait` | Esperar a que el trabajo termine (180s por defecto, máx. 600s) | amarillo |
| `media_catalog` | Modelos de un tipo — antes de inventar ids | verde |
| `media_balance` | Créditos restantes | verde |
| `media_history` | Trabajos locales recientes | verde |

Cero proveedores, o un pin a uno no conectado: error estructurado hacia `/media`.

## Ajustes en `/media`

**Enrutamiento.** Una fila por tipo. **Predeterminado** si el agente no nombra proveedor. **Reserva** si el predeterminado no está conectado. **También ejecutar en** solo para fan-out.

Valores sugeridos (solo si ese proveedor está conectado y no has fijado la fila): ampliación / imagen / edición → Magnific; vídeo → Higgsfield; audio / 3D → fal.

**Presupuesto.** Techos diarios y mensuales opcionales **por proveedor**. Si se superarían, falla **antes** de llamar al vendedor. Cantidades desconocidas no bloquean.

**Exponer herramientas MCP crudas.** Desactivado por defecto. Déjalo así.

## Créditos e ingest

Los trabajos completos con URL se descargan (hasta 200 MB, **sin recomprimir a JPEG**) a Documentos, se enlazan a la conversación como IA y se fusionan en los adjuntos del turno. Prefiere `documentIds` a las URL del vendedor.

Para ampliar, envía el **archivo original** (`documentId` o URL). No un JPEG de captura del canvas.

## Resolución de problemas

| Síntoma | Qué probar |
|---------|------------|
| Sigue **No conectado** tras OAuth | Termina el inicio de sesión en el navegador y vuelve a `/media`. **Probar**. |
| El agente dice que no hay proveedor para ese tipo | Conecta un backend que liste el tipo, o fija el predeterminado. |
| Trabajo listo pero no hay imagen en el chat | Mira **Trabajos recientes** y [Documentos](/docs/es/knowledge/documents/). La URL puede haber caducado. |
| Los créditos bajan más de lo esperado | **También ejecutar en** está activo, o hay dos proveedores fijados. Revisa Presupuesto. |
| La redirección acaba en Servidores MCP | Abre `/media` y **Prueba** la tarjeta. Conecta desde Media, no solo desde el catálogo MCP. |

## Relacionado

- [Servidores MCP](/docs/es/ai/mcp/) — las filas de media muestran *Gestionado en Ajustes → Media*
- [Herramientas](/docs/es/automation/tools/)
- [Documentos](/docs/es/knowledge/documents/)
- [Conexiones](/docs/es/admin/connections/)
- [Proveedores](/docs/es/ai/providers/) — modelos de lenguaje, no backends de imagen
