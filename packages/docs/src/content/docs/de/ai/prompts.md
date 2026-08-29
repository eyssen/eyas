---
title: Prompt-System
description: Geschichtete Prompts — Master → Projekttyp → Projekt → Gespräch — plus Coaches.
---

**Wozu das da ist.** Jede Runde stapelt Prompt-Schichten, kein Blob. **Master** ist globale Identität (manche Abschnitte gesperrt). **Projekttyp** und **Projekt** verfeinern. **Gespräch** ist thread-spezifisch. Agenten haben zusätzlich einen **System-Prompt**. Der **Prompt Enhancer** im Composer ist nur für einmalige Entwürfe.

**Routen:** `/prompts` (Sidebar **Prompts**), `/prompt-settings` (Master-Abschnitte).

## Wann du es brauchst

- Hausstimme (editierbare **personality**) ohne gesperrte Plattformregeln anzufassen.
- Ein Projekttyp soll ein vererbbares Brief tragen.
- Ein Projekt braucht Domain-Konventionen, die nicht leaken.
- Schwacher Composer-Draft — Enhancer, keine dauerhafte Schicht.

## Typischer Ablauf

1. **Prompts** (`/prompts`): **Master / Projekttyp / Projekt / Gespräch**.
2. Gesperrte Vorlagen **Nur lesen**. Sonst Inhalt, Aktivieren/Deaktivieren, Löschen.
3. `/prompt-settings`: nur **personality** editierbar; Rest gesperrt. Speichern: `PATCH /prompts/master/personality`.
4. Dauerhaftes Brief: **Prompt-Coach** am Projekt/Agenten, dann **Übernehmen**.
5. Einmaliger User-Prompt: **Prompt Enhancer** aus dem Composer.

Coach: Quality N/10, zwei Alternativen, Apply. Enhancer-Felder: [Unterhaltungen](/docs/de/daily/conversations/#prompt-enhancer-dialog).

## Verwandt

- [Projekte](/docs/de/daily/projects/)
- [Agenten — System-Prompt](/docs/de/agents/configure/)
- [Unterhaltungen](/docs/de/daily/conversations/)
- [Routing & Budget](/docs/de/ai/routing-budget/)
