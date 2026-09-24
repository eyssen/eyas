---
title: Selbstlernen & Skill-Evolution
description: Nutzungs-Insights, Skill-Vorschläge und menschlich geprüfte Kandidaten.
---

**Wozu das da ist.** Zwei Operator-Flächen. **Selbstlernen-Insights** (`/self-learning`) zeigt Token, Kosten, Muster. **Skill-Evolution** (`/skill-evolution`) ist das menschliche Gate für vorgeschlagene neue Skills. Nichts schreibt Verhalten vor Freigabe. Autonomy-Loops nur bei gewünschten Hintergrund-Vorschlägen.

**Routen:** `/self-learning` (Sidebar **Selbstlernen**), `/skill-evolution`.

## Wann du es brauchst

- Wöchentliches Effizienzbild.
- Wiederholte Arbeit soll Skill werden — Vorschlag, kein stilles Auto-Schreiben.
- Pending-Kandidaten: **Freigeben** / **Ablehnen**.
- Skill-Seite neben [Forge](/docs/de/agents/forge/).

## Typischer Ablauf

1. **Selbstlernen**: vier Karten, Insights, Muster, Skill-Vorschläge.
2. **Analyse starten** (`POST /self-learning/analyze`).
3. **Skill-Evolution**: Pending / Approved / Rejected.
4. Details, Reasoning, Inhalt — **Freigeben** (noch Auto-Adoption-Gate) oder **Ablehnen**.
5. Prüfen unter [Skills](/docs/de/automation/skills/) → **Bestand**.

**Welches Modell sie schreibt.** Selbstlernen-Vorschläge, Forge-Beschreibungsvorschläge und das Schreiben von Skills für die Skill-Evolution laufen auf EYAS' Hintergrundmodell, je ein isolierter Aufruf: die **Heartbeat**-Routing-Stufe (Primary, dann Fallback), dann der Installations-Default, dann API-Anbieter, dann CLIs, die isolierte Aufrufe können. Sie gehen nie an einen Anbieter, den das Gateway selbst wählt. Qualifiziert sich kein Modell (etwa eine reine Grok- oder Kimi-Installation, bevor deren Isolation verifiziert ist) oder steht das Budget auf *stop*, gibt es keinen Modellaufruf: Selbstlernen zeigt seine generischen Vorschlagssätze, Forge behält den zusammengesetzten Beschreibungsvorschlag, und die Skill-Evolution schreibt die Vorlagen-`SKILL.md`. Die Autonomy-Feature-Flags steuern diese Aufrufe weiterhin. Siehe [Routing & Budget — Das Hintergrundmodell](/docs/de/ai/routing-budget/#background-model).

## Felder

Insights: Total Tokens, Cost, Sessions, Success Rate; Typen Optimization/Cost/Quality/Speed. Evolution: Suche, Statusfilter, N Sessions, Details, Approve/Reject, Avg Confidence.

## Verwandt

- [Skills](/docs/de/automation/skills/)
- [Forge](/docs/de/agents/forge/)
- [Autonomie](/docs/de/agents/autonomy/)
- [Proaktiv](/docs/de/automation/proactive/)
