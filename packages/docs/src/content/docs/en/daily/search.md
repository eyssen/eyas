---
title: Search
description: Unified search and search sources — every field.
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
