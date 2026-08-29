---
title: Kunden-Wiki
description: Wiki pro Kunde — Delivery-Notizen eines Kunden, nicht der globale Wissensbaum.
---

**Wozu das da ist.** Das Kunden-Wiki ist ein **pro-Kunde**-Seitenbaum: Playbooks, Umgebungsnotizen und Delivery-Fakten, die nicht ins globale Wissens-Wiki oder in den Speicher sickern dürfen. Jedes Wiki ist an eine Client-Id gebunden. Die UI ist klein: Suche, Baum, Markdown Ansicht/Edit.

## Wann du es brauchst

- Die Seite betrifft **einen Kunden** (Staging-URL, wer unterschreibt, ihre Konventionen).
- Der Text soll nicht im globalen **Wissen**-Baum stehen und nicht in einer Vault-`user`-Notiz, die jeder Prompt sieht.
- Ein durchsuchbarer Baum mit Tags, Breadcrumb und **Auto-generated** auf maschinell geschriebenen Seiten.
- Wahl: globales Wiki → Wissen; dauerhafte Identität → Speicher; Dateien → Dokumente; nur dieser Kunde → hier.

## Typischer Ablauf

1. Öffne das Wiki dieses Kunden (API `/api/v1/client-wiki/:clientId/…` — **kein** globales Sidebar-Item; das ist nicht **Wissen**).
2. **Search this wiki…** oder den linken Baum. Auto-generierte Seiten haben ein Roboter-Präfix.
3. **Edit**, Markdown ändern, **Save** (oder **Cancel**). Leer: *No pages yet.* / *Select a page to view.*
4. Breadcrumb, optionale Summary und Tags, gespeichertes Markdown. Globales Wissen und Speicher bleiben unverändert.

## Funktionen

Die aktuelle UI ist ein Stub: Body als Markdown im Monospace (Ansicht) oder Textarea (Edit). Server-HTML existiert (`?render=html`), ist aber nicht die Default-Ansicht.

Suche, Baum, Breadcrumb, **Edit / Cancel / Save**, **Auto-generated**, Summary, Tags. History/Backlinks stecken eher in API/Locales als in dieser Stub-UI.

## Verwandt

- [Wissensbasis](/docs/de/knowledge/knowledge-base/)
- [Speicher](/docs/de/knowledge/memory/)
- [Projekte](/docs/de/daily/projects/)
