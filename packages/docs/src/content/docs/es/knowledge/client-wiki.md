---
title: Wiki de cliente
description: Wiki por cliente — notas de delivery de un cliente, no el árbol global de Conocimiento.
---

**Para qué sirve.** La wiki de cliente es un árbol de páginas **por cliente**: playbooks, notas de entorno y hechos de delivery que no deben filtrarse al wiki global de Conocimiento ni a Memoria. Cada wiki se clavea por id de cliente. La UI es pequeña: búsqueda, árbol, vista/edición markdown.

## Cuándo usarlo

- La página es de **un cliente** (URL de staging, quién firma, sus convenciones).
- No quieres ese texto en el árbol global **Conocimiento** ni en una nota `user` del vault que ve cada prompt.
- Un árbol buscable con tags, breadcrumb y marca **Auto-generated**.
- Elección: wiki global → Conocimiento; identidad duradera → Memoria; archivos → Documentos; solo este cliente → aquí.

## Flujo típico

1. Abre la wiki de ese cliente (API `/api/v1/client-wiki/:clientId/…` — **no** hay ítem global en la barra; esto no es **Conocimiento**).
2. Usa **Search this wiki…** o el árbol izquierdo. Las páginas autogeneradas llevan prefijo de robot.
3. **Edit**, cambia el markdown, **Save** (o **Cancel**). Vacío: *No pages yet.* / *Select a page to view.*
4. Debes ver breadcrumb, resumen y tags opcionales, y el markdown guardado. Conocimiento global y Memoria no cambian.

## Funciones

La UI actual es un stub: el cuerpo es markdown en bloque monoespaciado (vista) o textarea (edición). El HTML del servidor existe (`?render=html`) pero no es la vista por defecto.

## Relacionado

- [Base de conocimiento](/docs/es/knowledge/knowledge-base/)
- [Memoria](/docs/es/knowledge/memory/)
- [Proyectos](/docs/es/daily/projects/)
