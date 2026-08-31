---
title: Búsqueda
description: Busca todo lo indexado por EYAS — y fija qué árbol de código puede usar un agente.
---

**Para qué sirve.** La búsqueda tiene dos trabajos. La consulta de la barra superior encuentra aciertos en tablero, memoria, documentos y código. **Fuentes de búsqueda** es donde registras esos árboles (un checkout Odoo por fuente) y los reindexas. Los pines de conversación y proyecto deciden qué árbol puede buscar un agente, para que las versiones no se mezclen en silencio.

## Cuándo usarlo

- Quieres un archivo, una nota de memoria o un documento sin saber qué módulo lo guarda.
- Añades un checkout Odoo (o cualquier código) para que los agentes citen en vez de adivinar.
- Hay varias versiones Odoo indexadas y debes fijar 18c vs 18e en una conversación o proyecto.
- Un agente devolvió `needsPin` — hay que elegir fuentes antes de que busque.
- Reindexar después de que el árbol en disco haya cambiado.

## Flujo típico

1. Escribe en la barra de búsqueda del shell (*Search across all indexed sources…*) o abre resultados — esa es la búsqueda global.
2. Para añadir un árbol: **Ajustes → Fuentes de búsqueda** (barra lateral **Ajustes**, grupo **Módulos**) — ruta `/search-sources`.
3. **Add Source** (una raíz absoluta, **Label** p. ej. `18c`, **Family:** `odoo`) → **Create Source** → **Reindex** hasta **ready**.
4. En el proyecto marca **Default code sources**; abre una conversación y confirma la pestaña **Sources**. Los aciertos y las citas deben quedarse en esos árboles.

## Funciones

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
