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

## Funktionen / Felder

SLA-Signale: **Overdue**, **Stale**. Check Now = `POST /proactive/check`. Optionaler Action-Button (`actionLabel`).

## Verwandt

- [Autonomie](/docs/de/agents/autonomy/)
- [Start](/docs/de/daily/home/)
- [Unterhaltungen](/docs/de/daily/conversations/)
- [Selbstlernen](/docs/de/automation/self-learning/)
- [Planer](/docs/de/automation/scheduler/)
