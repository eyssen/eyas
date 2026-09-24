---
title: Search
description: Search everything EYAS indexed — and pin which code tree an agent may use.
---

**What this is for.** Search has two jobs. The top-bar query finds hits across board, memory, documents, and code. **Search Sources** is where you register those trees (one Odoo checkout per source) and reindex them. Conversation and project pins then decide which tree an agent may search, so versions do not silently mix.

## When to use it

- You want a file, a memory note, or a document without knowing which module holds it.
- You are adding an Odoo checkout (or any codebase) so agents can cite it instead of guessing.
- Several Odoo versions are indexed and you must pin 18c vs 18e on a conversation or project.
- An agent returned `needsPin` — you need to select sources before it will search.
- You want to reindex after the tree on disk changed.

## Typical workflow

1. Type in the shell search bar (*Search across all indexed sources…*) or open results — that is global search.
2. To add a tree: **Settings → Search Sources** (sidebar **Settings**, **Modules** group) — route `/search-sources`.
3. **Add Source** (one absolute root, **Label** e.g. `18c`, **Family:** `odoo`) → **Create Source** → **Reindex** until status is **ready**.
4. On a project, check **Default code sources**; open a conversation and confirm the **Sources** tab shows the same pins. Search hits and agent citations should then stay inside those trees.

## Features

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
| **Content-hash reuse** | Reindex reuses embeddings when chunk content is unchanged |
| **Citations** | Agent-facing `search_indexed` results include stable `citationId` / `cite` (`[source:…]`) so answers can cite sources |
| **list_search_sources** | Tool for agents to list configured sources before inventing facts |
| **Grounding** | Completeness critic expects retrieval evidence for research / implement-from-source goals — agents should search before claiming facts |

Add codebases and docs under Search Sources so agents can ground work in **your** material rather than guessing.

---

## Search Sources

**Route:** `/search-sources` (Settings → Search sources).  
Subtitle: *Manage indexed sources for semantic and full-text search.*

**Best practice for multi-version Odoo:** register **one source per checkout** (e.g. Community 18, Enterprise 18, custom addons). Do not dump several Odoo versions into a single path list.

| Field / control | Meaning |
|-----------------|---------|
| Counts **sources / chunks / collections** | Index statistics |
| **Add Source** / **New Source** | Create form |
| **Name** | Display name (e.g. `Odoo 18 Community`) |
| **Type** | Source kind (`code`, filesystem, …) |
| **Indexer** | Pipeline (`code` for source trees) |
| **Paths / URLs (one per line)** | Prefer **one absolute root** per source |
| **Label** | Short pin id for multi-version (e.g. `18c`, `18e`, `eyssen-erp`) |
| **Version** | Free-form version string (e.g. `18`, `19`) |
| **Edition** | Free-form edition (e.g. `community`, `enterprise`) |
| **Family** | Use **`odoo`** for Odoo checkouts so multi-version pin safety applies |
| **Exclude dirs / globs** | Skip noise (`i18n`, `static`, `node_modules`, …). Family `odoo` gets sensible defaults if empty |
| **Create Source** | Persist (status **idle** until reindex) |
| **Last indexed** | Timestamp of last successful index |
| **Reindex** | Crawl in **file batches** (server stays responsive). Unchanged files are skipped by mtime; embeddings reuse content hashes. Chunk count updates live while status is **indexing**. Interrupted runs resume on the next Reindex. |
| **Delete source** | Remove source and its chunks |

Badges on the list show **label**, **version**, **edition**, **family**, and status.

### Index status

| Status | Meaning |
|--------|---------|
| **idle** | Not running / not yet indexed |
| **indexing** | Crawl/embed in progress — chunk count grows as batches persist |
| **ready** | Searchable |
| **error** | Last index failed — check logs / paths |

### Env bootstrap (optional)

| Env | Meaning |
|-----|---------|
| `EYAS_ODOO_SOURCES_JSON` | Preferred: JSON array of `{ path, label?, version?, edition?, family?, name?, tags? }` — creates **idle** named sources on start if missing |
| `EYAS_ODOO_SOURCE_PATHS` | Colon- or semicolon-separated roots; used for lightweight `odoo_search_*` and for bootstrap when no labeled sources exist yet |

After bootstrap, open Search Sources and **Reindex** each source.

---

## Multi-version pin (which tree may the agent use?)

When several **odoo-family** sources are **ready**, EYAS will **not** silently mix versions. Resolution order:

1. **Explicit tool args** (`sourceIds`, `labels`, `version`, `edition` on `search_indexed` / `odoo_search_*`)
2. **Conversation pin** — Context rail → **Sources** tab (checkboxes)
3. **Project default** — Projects → **Default code sources**
4. **Project type** `indexed_sources` (if set)
5. **Fallback** — if multi-version conflict remains, tools return **`needsPin`** and list available labels

### Conversation → Sources tab

On an open conversation, right-hand **context rail**:

**History | Sources | Next | Files**

| Control | Meaning |
|---------|---------|
| Source list | All search sources (name, label, version, status, path, chunk count) |
| Checkboxes | Multi-select which sources this conversation may use |
| **Select all** / **Clear (auto)** | Bulk pin / clear |
| **Auto** badge | No pin — project default / needsPin logic |
| **N pinned** | Active pin count |
| **Manage search sources →** | Link to `/search-sources` |

Saving updates `searchContext: { sourceIds: […] }` on the conversation. Agents call `get_search_context` / `set_search_context` for the same pin.

### Project defaults

Under **Projects** → edit project → **Default code sources**:

| Control | Meaning |
|---------|---------|
| Checkboxes | Search sources to pin by default for this project |
| **N selected** / **Clear** | Summary and reset |

Applied automatically when:

- You **create a conversation** in that project (Board or new chat with project)
- You **change** a conversation’s **Project** field (unless you send an explicit `searchContext` in the same update)

You can still override per conversation on the **Sources** tab.

### Agent tools

| Tool | Purpose |
|------|---------|
| `list_search_sources` | List sources (label, version, family, paths, status) |
| `get_search_context` | Active pin for this conversation |
| `set_search_context` | Pin / clear (`labels`, `sourceIds`, `version`, `edition`, or `clear: true`) |
| `search_indexed` | Hybrid search — respects pin; optional filters override |
| `odoo_search_model` / `field` / `xml_id` | Local Odoo scan on **pinned roots** only; cites `[source:odoo-src:label:file:line]` |

---

## Related

- [Conversations — Sources tab](/docs/en/daily/conversations/#context-rail-chatter)
- [Projects — default code sources](/docs/en/daily/projects/#projects)
- [Configuration — env](/docs/en/deploy/configuration/)
- [Tools — search & Odoo](/docs/en/automation/tools/)
- [Home setup item: Directories to index](/docs/en/daily/home/)
