---
title: Autonomie
description: Wie viel Agenten ohne Fragen dürfen — Freigabe-Warteschlange und drei Stufen.
---

**Wozu das da ist.** Autonomie ist der Sicherheitsregler. Pro Aktionsklasse **Hinweis** (erst fragen), **Freigeben** (Vorschlag + ein Klick) oder **Auto** (tun und danach berichten). Ausgehende und unumkehrbare Aktionen bleiben auf Hinweis gesperrt. Dieselbe Seite ist die Warteschlange **Ausstehende Freigaben**, die einen Lauf parkt, bis du entscheidest.

## Wann du es brauchst

- Ein Gespräch ist **Waiting approval**, und du brauchst **Freigeben** oder **Ablehnen**, ohne zu raten, was parkt.
- Umkehrbare Arbeit (Datei-Edits, Recherche) auf **Auto**, aber nie eine gesperrte ausgehende Klasse anheben.
- Ein Resume ist nach schon erteilter Freigabe gescheitert — die hängende Zeile braucht dich noch.
- Heartbeats, Forge-Vorschläge oder Identity-Self-Update als Feature-Flags.

## Typischer Ablauf

1. Öffne **Autonomie** in der Sidebar (**Überwachung**) — Route `/autonomy`. Feature-Flags unter **Einstellungen → System** (Karte Autonomy features).
2. Lies **Ausstehende Freigaben**. Pro Zeile **Freigeben** oder **Ablehnen**. **Wartender Lauf** führt ins Gespräch.
3. Unter **Umkehrbar** eine Kategorie auf **Hinweis / Freigeben / Auto** setzen (gesperrte bleiben auf Hinweis).
4. Der geparkte Lauf sollte fortsetzen (oder bei Ablehnung stehen bleiben). Start **Braucht Aufmerksamkeit** und das Gesprächs-Badge **Waiting approval** sollten verschwinden.

## Funktionen

Stufen: **Hinweis** (erst fragen) · **Freigeben** (Vorschlag + ein Klick) · **Auto** (autonom + Bericht danach). Gruppen: **Umkehrbar** und **Ausgehend / unumkehrbar (gesperrt)**. Leer: *Nichts wartet auf Freigabe.*

Feature-Flags (standard **aus**): Heartbeat, Reflection/Briefing, Forge, Self-Learning, Identity self-update. YAML: `autonomy.identitySelfUpdate`. Approvals auch unter Start **Braucht Aufmerksamkeit** und Gespräch **Waiting approval**.

## Verwandt

- [Start](/docs/de/daily/home/)
- [Forge](/docs/de/agents/forge/)
- [Proaktiver Assistent](/docs/de/automation/proactive/)
