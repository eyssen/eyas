---
title: Suche
description: Hybride Suche, Multi-Version-Codequellen und Zitationen.
---

## Globale Suche

Suchfeld über alle indexierten Quellen · Trefferliste (Board, Speicher, Docs, Code, …) · N results in M files · Preview.

---

## Hybride Retrieval

**FTS (Orama)** + **Vektor**-Cosine-Index, fusioniert mit **RRF**. Ohne Embeddings: ehrlicher Fallback auf **nur FTS**.

| Feature | Bedeutung |
|---------|-----------|
| **Embed-on-index** | Chunks speichern Embeddings, wenn ein Embed-Provider konfiguriert ist |
| **Content-hash reuse** | Reindex nutzt Embeddings wieder bei unverändertem Inhalt |
| **Zitationen** | `search_indexed` liefert stabile `citationId` / `cite` (`[source:…]`) |
| **list_search_sources** | Agent-Tool: Quellen listen |
| **Grounding** | Completeness-Critic verlangt Retrieval-Evidenz |

---

## Search Sources

**Route:** `/search-sources`.

**Multi-Version Odoo:** **eine Source = ein Checkout** (z. B. Community 18, Enterprise 18).

| Feld | Bedeutung |
|------|-----------|
| **Name / Type / Indexer** | Anzeigename, Art, Pipeline (`code`) |
| **Paths** | Ein absoluter Root pro Source empfohlen |
| **Label** | Kurze Pin-ID (`18c`, `18e`, …) |
| **Version / Edition / Family** | z. B. `18` / `community` / **`odoo`** |
| **Exclude** | Rauschen filtern (`i18n`, `static`, …) |
| **Create / Reindex / Delete** | Anlegen, neu indexieren, löschen |
| Status | idle · indexing · ready · error. Während **indexing** wächst die Chunk-Zahl batchweise; ein abgebrochener Lauf setzt beim nächsten Reindex bei unveränderten Dateien fort. |

### Env-Bootstrap

| Env | Bedeutung |
|-----|-----------|
| `EYAS_ODOO_SOURCES_JSON` | JSON-Array `{ path, label?, version?, edition?, family? }` — idle Sources beim Start |
| `EYAS_ODOO_SOURCE_PATHS` | `:`/`;`-getrennte Roots für `odoo_search_*` und optionalen Bootstrap |

Danach jede Source **Reindex**en.

---

## Multi-Version-Pin

Auflösung (höchste Priorität zuerst):

1. Tool-Args (`sourceIds` / `labels` / `version` / `edition`)
2. **Gespräch → Reiter Quellen** (Checkboxen)
3. **Projekt → Standard-Codequellen**
4. Project-Type `indexed_sources`
5. Konflikt → Tool-Antwort **`needsPin`**

### Gespräch: Reiter Quellen

Context rail rechts: **Verlauf | Quellen | Als Nächstes | Dateien**

Multi-Select der Search Sources; **Alle** / **Leeren (auto)**; Badge Auto / N gewählt. Neue Gespräche und Projektwechsel übernehmen die Projekt-Defaults.

### Agent-Tools

`list_search_sources` · `get_search_context` · `set_search_context` · `search_indexed` · `odoo_search_model` / `field` / `xml_id` (Cites: `[source:odoo-src:label:file:line]`).

## Verwandt

- [Gespräche](/docs/de/daily/conversations/) · [Projekte](/docs/de/daily/projects/) · [Konfiguration](/docs/de/deploy/configuration/) · [Tools](/docs/de/automation/tools/)
