---
title: Documentos
description: Sube archivos, explóralos y deja que los agentes recuperen el contenido.
---

**Para qué sirve.** Documentos es la biblioteca de archivos: PDF, imágenes, archivos y otros blobs que tú (o una conversación / página de conocimiento) adjuntas. Se guardan en local (S3 opcional) y están disponibles para retrieval. No es el wiki de Conocimiento ni una nota de Memoria — es el archivo en sí.

## Cuándo usarlo

- Un PDF, imagen o archivo que el agente deba poder abrir más tarde.
- Ver todos los archivos en un sitio, filtrados por tipo, en cuadrícula o lista.
- Descargar o borrar, o ver dónde se usa.
- Configurar almacenamiento local vs sync remoto S3.

## Flujo típico

1. Abre **Documentos** en la barra lateral (**Contenido**) — ruta `/documents`.
2. Los archivos llegan de **Attach file** en conversación, **Attachments** en conocimiento, o la zona de subida.
3. Filtra **All / Images / PDFs / Archives / Other**, busca por nombre, cambia cuadrícula/lista.
4. **Ajustes → Documentos** (`/documents-settings`) para estadísticas o credenciales S3.

## Funciones

Vacío: *No documents yet.* Cuadrícula/lista, **Search files…**, categorías MIME, badges de sync, **Download**, **Delete**. Ajustes: estadísticas, almacenamiento local, S3 (**Save credentials**).

No confundir con [Fuentes de búsqueda](/docs/es/daily/search/) ni [Memoria](/docs/es/knowledge/memory/).

## Relacionado

- [Fuentes de búsqueda](/docs/es/daily/search/)
- [Conversaciones — adjuntar archivo](/docs/es/daily/conversations/)
- [Base de conocimiento](/docs/es/knowledge/knowledge-base/)
- [Memoria](/docs/es/knowledge/memory/)
