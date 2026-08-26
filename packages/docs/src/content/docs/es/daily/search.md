---
title: Búsqueda
description: Búsqueda híbrida, fuentes de código multi-versión y citas.
---

## Búsqueda global

Cuadro de búsqueda sobre fuentes indexadas · lista de resultados · N results in M files · preview.

---

## Recuperación híbrida

**FTS (Orama)** + índice **vectorial** coseno fusionados con **RRF**. Sin embeddings: fallback honesto a **solo FTS**.

| Función | Significado |
|---------|-------------|
| **Embed-on-index** | Los chunks guardan embedding si hay proveedor de embed |
| **Content-hash reuse** | Al reindexar se reutilizan embeddings si el contenido no cambió |
| **Citas** | `search_indexed` devuelve `citationId` / `cite` estables (`[source:…]`) |
| **list_search_sources** | Tool de agente: listar fuentes |
| **Grounding** | El critic exige evidencia de retrieval |

---

## Search Sources

**Ruta:** `/search-sources`.

**Multi-versión Odoo:** **una fuente = un checkout** (p. ej. Community 18, Enterprise 18).

| Campo | Significado |
|-------|-------------|
| **Name / Type / Indexer** | Nombre, tipo, pipeline (`code`) |
| **Paths** | Preferible **una raíz absoluta** por fuente |
| **Label** | Id corto de pin (`18c`, `18e`, …) |
| **Version / Edition / Family** | p. ej. `18` / `community` / **`odoo`** |
| **Exclude** | Filtrar ruido (`i18n`, `static`, …) |
| **Create / Reindex / Delete** | Crear, reindexar, borrar |
| Estado | idle · indexing · ready · error. Durante **indexing** el recuento de chunks crece por lotes; un corte se reanuda en el siguiente Reindex (archivos sin cambios se omiten). |

### Bootstrap por env

| Env | Significado |
|-----|-------------|
| `EYAS_ODOO_SOURCES_JSON` | Array JSON `{ path, label?, version?, edition?, family? }` — crea fuentes idle al arrancar |
| `EYAS_ODOO_SOURCE_PATHS` | Raíces separadas por `:`/`;` para `odoo_search_*` y bootstrap opcional |

Luego **Reindex** cada fuente.

---

## Pin multi-versión

Orden de resolución:

1. Args del tool (`sourceIds` / `labels` / `version` / `edition`)
2. **Conversación → pestaña Fuentes** (checkboxes)
3. **Proyecto → fuentes de código por defecto**
4. Project type `indexed_sources`
5. Conflicto → respuesta **`needsPin`**

### Conversación: pestaña Fuentes

Rail derecho: **Historial | Fuentes | Siguiente | Archivos**

Multi-selección de Search Sources; **Todas** / **Vaciar (auto)**; badge Auto / N elegidas. Las conversaciones nuevas y el cambio de proyecto heredan los defaults del proyecto.

### Tools de agente

`list_search_sources` · `get_search_context` · `set_search_context` · `search_indexed` · `odoo_search_model` / `field` / `xml_id` (citas `[source:odoo-src:label:file:line]`).

## Relacionado

- [Conversaciones](/docs/es/daily/conversations/) · [Proyectos](/docs/es/daily/projects/) · [Configuración](/docs/es/deploy/configuration/) · [Herramientas](/docs/es/automation/tools/)
