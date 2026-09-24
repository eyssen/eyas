---
title: Resumen de ajustes
description: Centro del sistema — apariencia, idioma, tarjetas, enlaces.
---

**Para qué sirve.** La página **Sistema** (`/settings`) es el centro de los ajustes: estadísticas, información del sistema, apariencia e idioma, asignaciones de modelo, la plantilla del Modo Dios y los grupos de la barra lateral que abren todas las demás superficies de administración. [Notificaciones](/docs/es/admin/notifications/), [Extensiones](/docs/es/admin/extensions/), [Nodos remotos](/docs/es/admin/nodes/) y [Manos](/docs/es/admin/hands/) son páginas propias, enlazadas desde la barra lateral — no están aquí.

**Ruta:** `/settings` (barra lateral **Sistema**).

## Estadísticas

**Proveedores** (activos / total) · **Modelos** (habilitados / total) · **Secretos** (cifrados) · **Usuarios** (registrados).

## Resumen de proveedores

La lista de proveedores con un indicador de activo y el número de modelos habilitados / totales. Los nombres son los mismos nombres de producto que en la página de Proveedores (allí está la configuración completa).

## Información del sistema

| Campo | Significado |
|-------|-------------|
| **Versión** | Versión de EYAS |
| **Estado** | Salud |
| **Entorno de ejecución** | Bun |
| **Base de datos** | SQLite (WAL) |

## Tarjetas de esta página

| Tarjeta | Propósito |
|---------|-----------|
| **Actualizaciones** | Buscar y aplicar actualizaciones desde GitHub |
| **Portabilidad de datos** | Asistente de importación ([Importación y exportación de datos](/docs/es/admin/data-port/)) |
| **Apariencia** | **Tema** (claro/oscuro), **Idioma** (en / hu / de / es / fr / tlh) y **Plantilla** |
| **Asignaciones de modelo** | Elección por agente, cada una mostrada y guardada como *Proveedor / modelo*, así que un id de modelo que listan dos proveedores nunca es ambiguo. Ver [Enrutado y presupuesto — Asignaciones de modelo](/docs/es/ai/routing-budget/#model-assignments). El paso Modelos de IA del asistente de configuración sigue las mismas reglas |
| **Modo Dios** | Plantilla de 2–5 modelos que compiten en la misma tarea, más el presidente, el tope de coste y la retención de las carpetas de trabajo. Ver [Conversaciones — Modo Dios](/docs/es/daily/conversations/). |
| **Agentes del equipo** | Selección de especialistas |
| **Autonomía y automejora** | Los bucles de automejora en segundo plano, todos desactivados por defecto — ver [Autonomía](/docs/es/agents/autonomy/) |

## Grupos de ajustes de la barra lateral

| Grupo | Enlaces |
|-------|---------|
| **General** | Sistema, Usuarios, Claves de API, Secretos, [Conexiones](/docs/es/admin/connections/) (`/connections`) |
| **IA y modelo** | Proveedores, Media, Prompts, Memoria, Servidores MCP |
| **Módulos** | Proyectos, Documentos, Fuentes de búsqueda, [Notificaciones](/docs/es/admin/notifications/) (`/notifications-settings`), Proactivo, Autoaprendizaje, [Extensiones](/docs/es/admin/extensions/) (`/extensions`) |
| **Infraestructura** | [Manos](/docs/es/admin/hands/) (`/hands`), [Ingress](/docs/es/admin/ingress/), [Nodos](/docs/es/admin/nodes/) (`/nodes`), Copia de seguridad, Reuniones |

## Relacionado

- [Proveedores](/docs/es/ai/providers/)
- [Autonomía](/docs/es/agents/autonomy/)
- [Conexiones](/docs/es/admin/connections/)
- [Notificaciones](/docs/es/admin/notifications/)
- [Extensiones](/docs/es/admin/extensions/)
- [Nodos remotos](/docs/es/admin/nodes/)
- [Manos](/docs/es/admin/hands/)
