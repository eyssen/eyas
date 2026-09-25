---
title: Dokumente
description: Dateien hochladen, durchsuchen, und Agenten den Inhalt holen lassen.
---

**Wozu das da ist.** Dokumente ist die Dateibibliothek: PDFs, Bilder, Archive und andere Blobs, die du (oder ein Gespräch / eine Wissensseite) anhängst. Lokal gespeichert (optional S3-Sync), für Retrieval verfügbar. Das ist nicht das Wissens-Wiki und keine Speicher-Notiz — es ist die Datei selbst.

## Wann du es brauchst

- Ein PDF, Bild oder Archiv, das der Agent später öffnen können soll.
- Alle Dateien an einem Ort, nach Typ gefiltert, Raster oder Liste.
- Download, Löschen, oder sehen, wo die Datei hängt.
- Lokaler Speicher vs. S3-kompatibler Remote-Sync.

## Typischer Ablauf

1. Öffne **Dokumente** in der Sidebar (**Inhalt**) — Route `/documents`.
2. Dateien kommen von Gespräch **Attach file**, Wissen **Attachments**, oder der Upload-Zone (*Drop files here*).
3. Filter **All / Images / PDFs / Archives / Other**, Dateiname suchen, Raster/Liste.
4. **Einstellungen → Dokumente** (`/documents-settings`) für Stats oder S3. Die Datei sollte in der Bibliothek und in der Suche stehen.

## Funktionen

Leer: *No documents yet.* Raster/Liste, **Search files…**, MIME-Kategorien, Sync-Badges, **Download**, **Delete**. Settings: Storage Statistics, Local Storage, S3 Remote Storage (**Save credentials**).

Nicht verwechseln mit [Suchquellen](/docs/de/daily/search/) oder [Speicher](/docs/de/knowledge/memory/).

## Verwandt

- [Suchquellen](/docs/de/daily/search/)
- [Gespräche — Attach](/docs/de/daily/conversations/)
- [Wissensbasis — Anhänge](/docs/de/knowledge/knowledge-base/)
- [Speicher](/docs/de/knowledge/memory/)
