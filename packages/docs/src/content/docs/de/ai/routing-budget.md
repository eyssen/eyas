---
title: Routing & Budget
description: Auto-Routing-Stufen, Fallbacks, Ausgabenlimits und Modellzuweisungen.
---

**Wozu das da ist.** Routing wählt *welches* Modell antwortet. Budget begrenzt *wie viel* du ausgibst (Warn, Downgrade, Hard-Stop). Modellzuweisungen pinnen Default-Modelle auf Seed-Agenten nach dem Setup.

**Route:** `/providers` → **Routing-Stufen** und **Budget**. Zuweisungen: Einstellungen → **Modellzuweisungen**.

## Wann du es brauchst

- Billig für Triage, stärker für Code.
- Primärer Cloud/CLI wackelt — expliziter **Fallback** oder opt-in Auto-Failover (`EYAS_AUTO_FAILOVER=1`, überschreibt gesetzte Fallbacks **nie**).
- Tages-/Wochen-/Monats-Caps.
- Seed-Agenten ohne Modell nach dem Wizard.

## Typischer Ablauf

1. **Anbieter** → **Routing-Stufen**.
2. **Auto-Routing An** für Auswahl aus Nachrichtenanalyse.
3. Pro Stufe **Primary** + optional **Fallback**.
4. **Budget**: Daily/Weekly/Monthly, Warn / Downgrade / Hard stop.
5. **Einstellungen** → **Modellzuweisungen** → **Zuweisungen speichern**.

Stufen: Triage, Quick, Standard, Complex, Code Execution, Heartbeat (auch Capture-Kandidat, wenn der Provider wirklich da und kein CLI ist), Embedding, Prompt Enhancer. Die Zuweisungskarte blendet sich aus, wenn keine Seed-Agenten oder Modelle da sind.

## Verwandt

- [Anbieter](/docs/de/ai/providers/)
- [Agenten — Tokenbudget](/docs/de/agents/configure/)
- [Prompts](/docs/de/ai/prompts/)
- [Proaktiv](/docs/de/automation/proactive/)
