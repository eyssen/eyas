---
title: Skills
description: Skill-Katalog und Auto-Adoption-Gate.
---

**Route:** `/skills`. Create Skill · Suche · Filter All / Own / Bundled. Quellen: Bundled, User, Generated, Own. Felder: Name, Trigger patterns, Content.

### Coding-Skill (Beispiel)

`coding/odoo/odoo-dev-chain` — Odoo-Implementierung mit `odoo_search_*` + File-Tools vor dem Schreiben.

### Auto-Adoption (Skill Curator)

Generierte/evolvierte Skills werden **nicht automatisch** übernommen, solange ein privates Benchmark-Snapshot die Mindest-**Pass-Ratio** und den **Durchschnittsscore** nicht erreicht. Manuelles Erstellen/Aktivieren in der UI bleibt möglich.

### Skill-Inventar & Erkennung toter Skills

Der **Bestand**-Tab zeigt pro Skill: gewinnende Quelle, was sie überschattet, Herkunft, Nutzung, Status. Bei gleicher Skill-ID entscheidet eine feste Rangfolge — nie die Dateisystem-Reihenfolge: **User > Generated > Integriert (Extension) > Integriert (EYAS)**; bei Gleichstand alphabetisch zuerst nach Quellwurzel, dann nach Pfad. Verlierer werden nicht verworfen, sondern als „überschattet" angezeigt.

Der Detektor **schlägt nur vor, er handelt nie**: ein Hintergrund-Scan markiert aktivierte Skills als verwaist (Quelldatei fehlt), überschattet, nie genutzt (0 Nutzungen, älter als 90 Tage) oder inaktiv (180+ Tage ungenutzt) und legt dafür einen Vorschlag in der [Autonomy-Warteschlange](/docs/de/agents/autonomy/) an. **Er deaktiviert, er löscht nie** — und selbst das erst nach Ihrer Freigabe. Verwaist/überschattet sind Fakten und werden sofort vorgeschlagen; nie genutzt/inaktiv sind Vermutungen und gelten erst ab 30 Tagen Alter, und eigene (User-)Skills sind von beiden zeitbasierten Regeln ausgenommen.

## Verwandt

- [Tools](/docs/de/automation/tools/)
- [Self-learning](/docs/de/automation/self-learning/)
- [Autonomie](/docs/de/agents/autonomy/)
