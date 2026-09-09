---
title: Wiki del proyecto
description: Wiki por proyecto — páginas de ticket y decisión de un proyecto, no el árbol global de Conocimiento.
---

**Para qué sirve.** La wiki del proyecto es un árbol de páginas **por proyecto**: tickets cerrados, decisiones de team session, playbooks y hechos de delivery que no deben filtrarse al wiki global de Conocimiento ni a Memoria. Cada wiki se clavea por id de proyecto. La UI es pequeña: búsqueda, árbol, vista/edición markdown.

## Cuándo usarlo

- La página es de **un proyecto** (un ticket cerrado, una decisión, notas de entorno).
- No quieres ese texto en el árbol global **Conocimiento** ni en una nota `user` del vault que ve cada prompt.
- Un árbol buscable con tags, breadcrumb y marca **Auto-generated**.
- Elección: wiki global → Conocimiento; identidad duradera → Memoria; archivos → Documentos; solo este proyecto → aquí.

## Flujo típico

1. Abre la wiki desde la tarjeta del proyecto (ruta `/projects/:projectId/wiki` — **no** hay ítem global en la barra; esto no es **Conocimiento**).
2. Usa **Search this wiki…** o el árbol izquierdo. Las páginas autogeneradas llevan prefijo de robot y una insignia **Generado automáticamente**.
3. **Edit**, cambia el markdown, **Save** (o **Cancel**). Al guardar tomas la página: los auto-updates posteriores no la sobrescriben. Vacío: *Aún no hay páginas.* / *Selecciona una página para verla.*
4. Debes ver breadcrumb, resumen y tags opcionales, y el markdown guardado. Conocimiento global y Memoria no cambian.

Cerrar una tarjeta del tablero escribe `ticket-<id>`. Findings/decisiones de un team session escriben `decision-<id>` en la wiki del proyecto (no en el vault). El proyecto catch-all de semilla no recibe páginas.

## Funciones

La UI actual es un stub: el cuerpo es markdown en bloque monoespaciado (vista) o textarea (edición). El HTML del servidor existe (`?render=html`) pero no es la vista por defecto.

## Relacionado

- [Base de conocimiento](/docs/es/knowledge/knowledge-base/)
- [Memoria](/docs/es/knowledge/memory/)
- [Proyectos](/docs/es/daily/projects/)
