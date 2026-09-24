---
title: Proaktiver Assistent
description: Heartbeat-Alerts, Insights und gelernte Lektionen — der Assistent, der Arbeit hochholt.
---

**Wozu das da ist.** Der proaktive Assistent achtet auf Arbeit, die dich braucht: überfällige Gespräche, stale Threads, Anomalien, Chancen, Erinnerungen. Er ersetzt Board und Start nicht. Die Kachel **Aufmerksamkeit** kann dieselben Alerts zeigen; hier ist die volle Liste plus **Gelernte Lektionen**. Heartbeat **aus**, bis du Freigabe und Kosten verstehst — bezahlte Modellaufrufe im Takt.

**Route:** `/proactive`. Sidebar: **Proaktiv**.

## Wann du es brauchst

- Nudge bei Overdue/Stale.
- **Proaktiver Heartbeat** unter Autonomie an, Operator-Oberfläche nötig.
- Einmal **Jetzt prüfen** statt auf den nächsten Heartbeat.
- Lektionen aus früheren Alerts.

## Typischer Ablauf

1. **Proaktiver Heartbeat** unter [Autonomie](/docs/de/agents/autonomy/) nur bei gewünschtem Hintergrund-Spend.
2. **Proaktiv** (`/proactive`).
3. **Aktive Alerts**. Priorität **Dringend / Hoch / Normal / Niedrig**. Typen: Anomalie, Chance, Erinnerung, Insight.
4. **Jetzt prüfen**. Leer: *Alles klar — keine aktiven Alerts*.
5. **Gelernte Lektionen** (Konfidenz %).

**Der Briefing-Text** stammt von EYAS' Hintergrundmodell in einem isolierten Aufruf: die **Heartbeat**-Routing-Stufe (Primary, dann Fallback), dann der Installations-Default, dann API-Anbieter, dann CLIs, die isolierte Aufrufe können — nie ein Anbieter, den das Gateway selbst wählt, und nie eine CLI mit ihren eigenen Werkzeugen und ihrem eigenen Speicher. Qualifiziert sich kein Modell (etwa eine reine Grok- oder Kimi-Installation, bevor deren Isolation verifiziert ist) oder steht das Budget auf *stop*, macht EYAS keinen Modellaufruf und schickt den vorgefertigten Alert *Heartbeat: items may need your attention* mit der Liste der Gründe. Siehe [Routing & Budget — Das Hintergrundmodell](/docs/de/ai/routing-budget/#background-model).

**Hintergrundläufe bekommen denselben Speicher wie der Chat.** Startet der Heartbeat oder eine Board-Karte einen Hintergrundlauf, bekommt dieser Lauf denselben Abrufblock mit Datum und Uhrzeit wie ein Chat-Zug (siehe [Speicher — Wie der Abruf das Modell erreicht](/docs/de/knowledge/memory/#how-recall-reaches-the-model)). Auch das Ziel einer Karte wird gespeichert — einmal pro unterschiedlichem Ziel, egal wie oft der Lauf wiederholt wird — als Text, den EYAS geschrieben hat, nicht du.

**Ein Runner für Hintergrundläufe.** Karten in Bot-Listen- oder Auto-Assignee-Stufen und `assign_task`-Karten laufen mit derselben Ausstattung wie eine Wiederholung derselben Karte, eine [geplante Agent-Routine](/docs/de/automation/scheduler/#agent-routines-run-in-a-conversation) und ein per Übergabe gestarteter Kollege: überwacht, autonom und durch die Autonomie-Leiter abgesichert, auf dem Modell der Karte, mit Speicherabruf, angehängten Designs, Dokumenten, dauerhafter Speichererfassung und dem Vollständigkeitskritiker. Board-Läufe bekommen jetzt auch Designs, Dokumente und dauerhafte Speichererfassung, die ihnen vorher fehlten. Eine Hintergrundkarte nimmt Anbieter und Modell immer aus einer einzigen Bindung — nie den Anbieter einer Karte kombiniert mit dem Modell eines Agenten von einem anderen Anbieter.

## Funktionen / Felder

SLA-Signale: **Overdue**, **Stale**. Check Now = `POST /proactive/check`. Optionaler Action-Button (`actionLabel`).

## Verwandt

- [Autonomie](/docs/de/agents/autonomy/)
- [Start](/docs/de/daily/home/)
- [Unterhaltungen](/docs/de/daily/conversations/)
- [Selbstlernen](/docs/de/automation/self-learning/)
- [Planer](/docs/de/automation/scheduler/)
