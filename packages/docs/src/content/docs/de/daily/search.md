---
title: Suche
description: Alles Durchsuchen, was EYAS indexiert hat — und pinnen, welchen Codebaum ein Agent nutzen darf.
---

**Wozu das da ist.** Suche hat zwei Jobs. Die Query in der Top-Leiste findet Treffer über Board, Speicher, Dokumente und Code. **Suchquellen** ist, wo du diese Bäume registrierst (ein Odoo-Checkout pro Quelle) und neu indexierst. Gesprächs- und Projekt-Pins entscheiden dann, welchen Baum ein Agent durchsuchen darf, damit Versionen sich nicht still mischen.

## Wann du es brauchst

- Eine Datei, eine Speicher-Notiz oder ein Dokument, ohne zu wissen, welches Modul sie hält.
- Ein Odoo-Checkout (oder irgendeine Codebasis), damit Agenten zitieren statt raten.
- Mehrere Odoo-Versionen sind indexiert, und du musst 18c vs 18e am Gespräch oder Projekt pinnen.
- Ein Agent hat `needsPin` geliefert — Quellen wählen, bevor er sucht.
- Neu indexieren, nachdem der Baum auf der Platte sich geändert hat.

## Typischer Ablauf

1. Tippe in die Shell-Suche (*Search across all indexed sources…*) oder öffne die Treffer — das ist die globale Suche.
2. Baum hinzufügen: **Einstellungen → Suchquellen** (Sidebar **Einstellungen**, Gruppe **Module**) — Route `/search-sources`.
3. **Add Source** (eine absolute Wurzel, **Label** z. B. `18c`, **Family:** `odoo`) → **Create Source** → **Reindex**, bis der Status **ready** ist.
4. Am Projekt **Default code sources** ankreuzen; Gespräch öffnen und den Tab **Sources** prüfen. Treffer und Zitate sollten in diesen Bäumen bleiben.

## Funktionen

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
