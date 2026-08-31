---
title: Skills
description: Skill-Katalog — Quellen, Filter, Inventar, Auto-Adoption und das Gesprächs-Proposal.
---

**Wozu das da ist.** Ein Skill ist ein Markdown-Verfahrenspaket, das der Agent lädt, wenn die Arbeit zu seinen Trigger-Mustern passt. Diese Seite ist der Katalog: erstellen, aktivieren, deaktivieren, prüfen — integriert, selbst geschrieben, importiert oder generiert. Kein Werkzeug. Werkzeuge sind aufrufbar; Skills sagen *wie*.

**Route:** `/skills`. Untertitel: *Skill-Vorlagen, Trigger-Muster und generierte Skills verwalten.* Tabs: **Durchsuchen** · **Bestand**.

## Wann du es brauchst

- Wiederholbares Playbook (Odoo-Kette, Runbook, Hausstil).
- Import aus einem anderen Assistenten — welche Kopie einer Id lädt wirklich.
- Ein Gespräch hat einen Skill vorgeschlagen; ablehnen oder global abschalten.
- Generierte Skills tauchen auf und du willst wissen, warum sie live gingen oder nicht.

## Typischer Ablauf

1. **Skills** in der Sidebar (`/skills`).
2. **Durchsuchen**: suchen oder **Alle / Eigene Skills / Integriert**, dann **Skill erstellen**.
3. **Skill-Name**, **Trigger-Muster (durch Komma getrennt)**, **Skill-Inhalt / Vorlage**.
4. **Bestand**: welche Kopie gewann, Nutzung, aktiviert.
5. Im Gespräch wartet die Runde. **Verwenden**, **Diesmal nicht**, oder (Owner/Admin) **Abschalten**.

## Funktionen

### Skill-Vorschlag (Gesprächstor)

Ein passender Skill ist ein **Vorschlag, auf den die Runde wartet**. Nichts davon läuft, bis du antwortest. Karte: Name, Score, auslösendes Muster.

| Steuerung | Bedeutung |
|-----------|-----------|
| **Verwenden** | Für dieses Gespräch annehmen; die Runde läuft mit dem Skill weiter |
| **Diesmal nicht** | Nur hier ablehnen; der Skill bleibt anderswo an |
| **Abschalten** | Hier ablehnen **und** global deaktivieren, bis jemand ihn unter Skills wieder einschaltet. Nur Owner/Admin |

Die Antwort gilt für dieses Gespräch. Der dritte Knopf (0.8.15) ist global.

Siehe [Unterhaltungen](/docs/de/daily/conversations/).

### Auto-Adoption (Skill Curator)

Generierte/evolvierte Skills werden **nicht automatisch** übernommen, solange ein privates Benchmark-Snapshot die Mindest-**Pass-Ratio** und den **Durchschnittsscore** nicht erreicht. Manuelles Erstellen/Aktivieren bleibt möglich.

## Felder und Steuerelemente

| Steuerung | Bedeutung |
|-----------|-----------|
| **aktiviert** | Wie viele Skills an sind |
| **Skill erstellen** | Formular |
| Suche | *Nach Name oder Trigger-Muster suchen…* |
| Filter **Alle / Eigene Skills / Integriert** | Quelle |
| **Integriert / Eigene / Generiert / Eigene** (Kategorie) | Herkunft |
| **Inhalt anzeigen / ausblenden** | Markdown |

Leer: *Keine Skills gefunden.*

Beispiel: `coding/odoo/odoo-dev-chain` — erst `odoo_search_*` + File-Tools. Tools kommen von der Agentenliste ([Konfigurieren](/docs/de/agents/configure/), [Werkzeuge](/docs/de/automation/tools/)).

## Inventar & Erkennung toter Skills

Der **Bestand**-Tab: eine Zeile pro Skill-Id, gewinnende Quelle, was sie überschattet, Herkunft, Nutzung, Status.

Reihenfolge bei gleicher Id — nie Dateisystemreihenfolge: **User > Generated > Imported (`skills.importRoots`) > Bundled (Extension) > Bundled (EYAS)**; Gleichstand alphabetisch nach Wurzel, dann Pfad. Verlierer stehen unter **Überschattet**.

Host-Skills kommen **nicht** über Claude `settingSources`. Extra-Ordner in `local.yaml` (`skills.importRoots` / `agent.importRoots`, Default **leere Liste**). Siehe [Konfiguration](/docs/de/deploy/configuration/).

Der Detektor **schlägt nur vor**: Waise (Quelldatei fehlt), überschattet, nie genutzt (0, älter als 90 Tage), inaktiv (180+ Tage). Vorschlag in der [Autonomy-Warteschlange](/docs/de/agents/autonomy/). **Deaktiviert, löscht nie** — und erst nach Freigabe. Waise/überschattet sofort; nie genutzt/inaktiv erst ab 30 Tagen, eigene User-Skills von Zeitregeln ausgenommen.

## Verwandt

- [Werkzeuge](/docs/de/automation/tools/)
- [Selbstlernen](/docs/de/automation/self-learning/)
- [Autonomie](/docs/de/agents/autonomy/)
- [Unterhaltungen](/docs/de/daily/conversations/)
- [Recherche](/docs/de/automation/research/)
