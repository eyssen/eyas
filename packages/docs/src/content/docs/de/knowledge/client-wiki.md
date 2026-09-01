---
title: Projekt-Wiki
description: Wiki pro Projekt — Ticket- und Entscheidungsseiten eines Projekts, nicht der globale Wissensbaum.
---

**Wozu das da ist.** Das Projekt-Wiki ist ein **pro-Projekt**-Seitenbaum: geschlossene Tickets, Team-Session-Entscheidungen, Playbooks und Delivery-Fakten, die nicht ins globale Wissens-Wiki oder in den Speicher sickern dürfen. Jedes Wiki ist an eine Projekt-Id gebunden. Die UI ist klein: Suche, Baum, Markdown Ansicht/Edit.

## Wann du es brauchst

- Die Seite betrifft **ein Projekt** (ein geschlossenes Ticket, eine Entscheidung, Umgebungsnotizen).
- Der Text soll nicht im globalen **Wissen**-Baum stehen und nicht in einer Vault-`user`-Notiz, die jeder Prompt sieht.
- Ein durchsuchbarer Baum mit Tags, Breadcrumb und **Auto-generated** auf maschinell geschriebenen Seiten.
- Wahl: globales Wiki → Wissen; dauerhafte Identität → Speicher; Dateien → Dokumente; nur dieses Projekt → hier.

## Typischer Ablauf

1. Öffne das Wiki über die Projektkarte (Route `/projects/:projectId/wiki` — **kein** globales Sidebar-Item; das ist nicht **Wissen**).
2. **Search this wiki…** oder den linken Baum. Auto-generierte Seiten haben ein Roboter-Präfix und ein **Automatisch generiert**-Badge.
3. **Edit**, Markdown ändern, **Save** (oder **Cancel**). Speichern übernimmt die Seite: spätere Auto-Updates überschreiben sie nicht. Leer: *Noch keine Seiten.* / *Wähle eine Seite zum Ansehen aus.*
4. Breadcrumb, optionale Summary und Tags, gespeichertes Markdown. Globales Wissen und Speicher bleiben unverändert.

Eine geschlossene Board-Karte schreibt `ticket-<id>`. Team-Session-Findings/Entscheidungen schreiben `decision-<id>` ins Projekt-Wiki (nicht in den Vault). Das Catch-all-Seed-Projekt bekommt keine Wiki-Seiten.

## Funktionen

Die aktuelle UI ist ein Stub: Body als Markdown im Monospace (Ansicht) oder Textarea (Edit). Server-HTML existiert (`?render=html`), ist aber nicht die Default-Ansicht.

Suche, Baum, Breadcrumb, **Edit / Cancel / Save**, **Auto-generated**, Summary, Tags. History/Backlinks stecken eher in API/Locales als in dieser Stub-UI.

## Verwandt

- [Wissensbasis](/docs/de/knowledge/knowledge-base/)
- [Speicher](/docs/de/knowledge/memory/)
- [Projekte](/docs/de/daily/projects/)
