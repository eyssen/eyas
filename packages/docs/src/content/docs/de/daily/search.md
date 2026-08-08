---
title: Suche
description: Hybride Suche, Zitationen und Suchquellen.
---

## Globale Suche

Suchfeld über alle indexierten Quellen · Trefferliste (Board, Speicher, Docs, Code, …) · N results in M files · Preview.

---

## Hybride Retrieval

**FTS (Orama)** + **Vektor**-Cosine-Index, fusioniert mit **RRF**. Ohne Embeddings: ehrlicher Fallback auf **nur FTS**.

| Feature | Bedeutung |
|---------|-----------|
| **Embed-on-index** | Chunks speichern Embeddings, wenn ein Embed-Provider konfiguriert ist |
| **Zitationen** | `search_indexed` liefert stabile `citationId` / `cite` (`[source:…]`) |
| **list_search_sources** | Agent-Tool: Quellen listen, statt Fakten zu erfinden |
| **Grounding** | Completeness-Critic verlangt Retrieval-Evidenz bei Research/Implement-from-source |

---

## Search Sources

**Route:** `/search-sources`. Name, Type, Indexer, Paths/URLs · Create / Reindex / Delete · Last indexed. Status: idle · indexing · ready · error.

## Verwandt

- [Dashboard](/docs/de/daily/dashboard/)
- [Dokumente](/docs/de/knowledge/documents/)
- [Tools](/docs/de/automation/tools/)
