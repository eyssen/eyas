---
title: Meetings
description: Aufnahmen (Fireflies u. a.) in Transkripte, Zusammenfassungen und Action Items ziehen.
---

**Wozu das da ist.** Meetings ist die Ingest-Fläche für Aufnahmen: Meetings listen, Transkripte und Summaries vom Provider holen, Action Items neben der restlichen Arbeit. Die Produkt-UI ist noch **Coming Soon**; der Backend-Provider (Fireflies) ist verdrahtet und fail-closed ohne API-Key.

## Wann du es brauchst

- Fireflies- (oder künftige Provider-)Meetings in EYAS, nicht nur in der Vendor-App.
- Transkript, Summary oder Action-Item-Liste neben Board-Follow-ups — sobald Ingest fertig ist.
- Warum die Liste leer ist: kein Secret `fireflies-api-key`, oder noch das geplante Banner.

## Typischer Ablauf

1. Öffne **Einstellungen → Besprechungen** (Sidebar **Einstellungen**, Gruppe **Infrastruktur**) — Route `/meetings`.
2. Lies das Banner **Coming Soon** / **Planned**.
3. Liegt ein Fireflies-Key als Secret `fireflies-api-key` (System-Scope), kann die API listen; die Seite zeigt dann eine Tabelle. Ohne Key bleibt der Provider unconfigured und liefert eine leere Liste — er erfindet nie Transkripte.
4. Entweder Leerzustand (*No meetings recorded yet*) oder Zeilen mit Title, Date, Duration, Participants, Status.

## Funktionen

Untertitel: *Meeting recordings, transcripts, and action items.* Banner **Coming Soon** + **Planned**. Spalten: Title, Date, Duration, Participants, Status. Fireflies über festen GraphQL-Host, SSRF-safe Fetch. Unconfigured: leere Liste; Detail-Calls „not configured“. Keine Mock-Daten.

## Verwandt

- [Board](/docs/de/daily/board/)
- [Geheimnisse](/docs/de/admin/secrets/)
- [Speicher](/docs/de/knowledge/memory/)
