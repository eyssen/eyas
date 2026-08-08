---
title: Búsqueda
description: Búsqueda híbrida, citas y fuentes de búsqueda.
---

## Búsqueda global

Cuadro de búsqueda sobre fuentes indexadas · lista de resultados · N results in M files · preview.

---

## Recuperación híbrida

**FTS (Orama)** + índice **vectorial** coseno fusionados con **RRF**. Sin embeddings: fallback honesto a **solo FTS**.

| Función | Significado |
|---------|-------------|
| **Embed-on-index** | Los chunks guardan embedding si hay proveedor de embed |
| **Citas** | `search_indexed` devuelve `citationId` / `cite` estables (`[source:…]`) |
| **list_search_sources** | Tool de agente: listar fuentes antes de inventar hechos |
| **Grounding** | El critic de completitud exige evidencia de retrieval en research / implementar-desde-fuente |

---

## Search Sources

**Ruta:** `/search-sources`. Name, Type, Indexer, Paths/URLs · Create / Reindex / Delete · Last indexed. Estado: idle · indexing · ready · error.

## Relacionado

- [Panel](/docs/es/daily/dashboard/)
- [Documentos](/docs/es/knowledge/documents/)
- [Herramientas](/docs/es/automation/tools/)
