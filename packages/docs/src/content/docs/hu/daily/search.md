---
title: Keresés
description: Hibrid keresés, citációk és keresési források.
---

## Globális keresés

| Vezérlő | Jelentés |
|---------|----------|
| Keresőmező | Minden indexelt forrás |
| Találatlista | Board, memória, doksi, kód, … |
| N results in M files | Összesítő |
| Preview | Kijelölt találat fájltartalma |

---

## Hibrid retrieval

Az EYAS **FTS (Orama)** + **vektor** cosine indexet fuzionál **RRF**-fel. Ha nincs embedding, **csak FTS** marad (őszinte degradáció).

| Funkció | Jelentés |
|---------|----------|
| **Embed-on-index** | Chunkok embeddinget tárolnak, ha van embed provider |
| **Citációk** | `search_indexed` → stabil `citationId` / `cite` (`[source:…]`) |
| **list_search_sources** | Ágens tool: források listázása találgatás helyett |
| **Grounding** | Completeness critic: kutatás / forrásból implementálás előtt retrieval bizonyíték kell |

Indexeld a kódbázist és a doksikat, hogy az ágensek **a te anyagodból** dolgozzanak.

---

## Search Sources

**Útvonal:** `/search-sources`.

| Mező | Jelentés |
|------|----------|
| **Name** | Forrás neve |
| **Type** | Forrás típusa |
| **Indexer** | Indexelő pipeline |
| **Paths / URLs** | Bejárandó gyökerek (soronként) |
| **Create / Reindex / Delete** | Létrehozás, újraindexelés, törlés |
| **Last indexed** | Utolsó sikeres index időpontja |

Státusz: **idle · indexing · ready · error**.

## Kapcsolódó

- [Irányítópult setup](/docs/hu/daily/dashboard/)
- [Dokumentumok](/docs/hu/knowledge/documents/)
- [Toolok — keresés](/docs/hu/automation/tools/)
