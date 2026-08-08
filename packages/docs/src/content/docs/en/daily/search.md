---
title: Search
description: Unified hybrid search, citations, and search sources.
---

## Global search (top bar / results page)

| Control | Meaning |
|---------|---------|
| **Search across all indexed sources…** | Query box (also in the shell search bar) |
| Results list | Hits across board, memory, docs, code, … |
| **No results for "…"** | Empty result set |
| **Type to search…** | Empty query hint |
| Footer **N results in M files** | Aggregate counts |
| **Select a result to view the file** | Preview pane empty state |
| **N lines** | Size of a hit file preview |

---

## Hybrid retrieval (how search works)

EYAS fuses **full-text (FTS / Orama)** with an **in-memory vector** cosine index using **RRF** (reciprocal rank fusion) and query-adaptive weights. When embeddings are unavailable, search **degrades to FTS only** (honest fallback — not silent empty results).

| Feature | Meaning |
|---------|---------|
| **Embed-on-index** | Chunks store embeddings when an embed provider (Ollama / OpenAI, …) is configured; vectors reload on startup |
| **Citations** | Agent-facing `search_indexed` results include stable `citationId` / `cite` (`[source:…]`) so answers can cite sources |
| **list_search_sources** | Tool for agents to list configured sources before inventing facts |
| **Grounding** | Completeness critic expects retrieval evidence for research / implement-from-source goals — agents should search before claiming facts |

Add codebases and docs under Search Sources so agents can ground work in **your** material rather than guessing.

---

## Search Sources

**Route:** `/search-sources` (Settings → Search sources).  
Subtitle: *Manage indexed sources for semantic and full-text search.*

| Field / control | Meaning |
|-----------------|---------|
| Counts **sources / chunks / collections** | Index statistics |
| **Add Source** / **New Source** | Create form |
| **Name** | Source label (e.g. `My codebase`) |
| **Type** | Source kind (filesystem, URL, … — as offered by the indexer) |
| **Indexer** | Which indexer pipeline to use |
| **Paths / URLs (one per line)** | Roots to crawl |
| **Create Source** | Persist and start indexing |
| **Last indexed** | Timestamp of last successful index |
| **Reindex** | Force re-crawl |
| **Delete source** | Remove source and its chunks |

### Index status

| Status | Meaning |
|--------|---------|
| **idle** | Not running |
| **indexing** | Crawl/embed in progress |
| **ready** | Searchable |
| **error** | Last index failed — check logs / paths |

## Related

- [Dashboard setup item: Directories to index](/docs/en/daily/dashboard/)
- [Documents](/docs/en/knowledge/documents/)
- [Tools — search tools](/docs/en/automation/tools/)
