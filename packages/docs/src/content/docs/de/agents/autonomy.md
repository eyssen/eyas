---
title: Autonomie
description: Festlegen, wie viel Agenten ohne Nachfrage tun dürfen — Freigabe-Warteschlange und drei Stufen.
---

**Wozu das da ist.** Autonomie ist der Sicherheitsregler. Pro Aktionsklasse wählst du **Hinweis** (erst fragen), **Freigeben** (Vorschlag + ein Klick) oder **Auto** (erledigen und berichten). Ausgehende und unumkehrbare Aktionen bleiben auf Hinweis gesperrt. Dieselbe Seite ist die Warteschlange **Ausstehende Freigaben**, die einen Lauf parkt, bis du entscheidest.

## Wann du es brauchst

- Eine Unterhaltung **Wartet auf Freigabe**, und du willst **Freigeben** oder **Ablehnen**, ohne zu raten, was geparkt ist.
- Umkehrbare Arbeit (Dateibearbeitung, Recherche) soll auf **Auto** laufen, aber eine gesperrte ausgehende Klasse willst du nie anheben.
- Ein Fortsetzen scheiterte, obwohl du schon freigegeben hast — die hängende Zeile braucht dich noch.
- Du willst die Selbstverbesserungs-Schleifen im Hintergrund ein- oder ausschalten (proaktiver Heartbeat, nächtliche Reflexion, Forge-Vorschläge, Selbstlernen, Skill-Übernahme).

## Typischer Ablauf

1. Öffne **Autonomie** in der Seitenleiste (Bereich **Überwachung**) — Route `/autonomy`. Die Selbstverbesserungs-Schleifen stehen unter **Einstellungen → System**, Karte **Autonomie & Selbstverbesserung**.
2. Lies **Ausstehende Freigaben**. Für jede Zeile **Freigeben** oder **Ablehnen**. Folge **Wartender Lauf** in die Unterhaltung, wenn du Kontext brauchst.
3. Setze unter **Umkehrbar** eine Kategorie auf **Hinweis / Freigeben / Auto** (gesperrte Kategorien können nicht über Hinweis gehen).
4. Der geparkte Lauf läuft weiter (oder bleibt bei Ablehnung gestoppt). **Braucht Aufmerksamkeit** auf der Startseite und das Badge **Wartet auf Freigabe** in der Unterhaltung verschwinden.

## Funktionen

Autonomie steuert **unbeaufsichtigtes** Verhalten: wie viel ein Agent pro Aktionsklasse tun darf und was eine **menschliche Freigabe** braucht.

## Grundsätze

1. Die Selbstverbesserungs-Schleifen im Hintergrund sind **standardmäßig aus**; sie einzuschalten ist deine Entscheidung.
2. Freigaben erscheinen auf der Startseite unter **Braucht Aufmerksamkeit** und als Badge **Wartet auf Freigabe** in der Unterhaltung.
3. Ob ein Agent seine eigene IDENTITY direkt bearbeiten darf, ist eine YAML-Einstellung: `autonomy.identitySelfUpdate` (standardmäßig an). Ist sie aus, laufen Identitätsänderungen über Forge-Vorschläge.

## Freigabe-Warteschlange und Stufen

**Route:** `/autonomy`. Der Untertitel erklärt, dass unumkehrbare / ausgehende Aktionen auf **Hinweis** gesperrt sind und nicht erhöht werden können — eine Sicherheitsuntergrenze.

### Ausstehende Freigaben

| Element | Bedeutung |
|---------|-----------|
| **Ausstehende Freigaben** | Warteschlange der geparkten Anfragen |
| *Nichts wartet auf Freigabe.* | Leere Warteschlange |
| Kategorie · Tool | Worum gebeten wird |
| Grund | Warum das Gate angeschlagen hat |
| **Wartender Lauf** | Link zum geparkten Lauf / zur Unterhaltung |
| **Freigeben / Ablehnen** | Entscheiden — Freigeben versucht, den Lauf fortzusetzen |
| *Fortsetzen fehlgeschlagen: …* | Die Freigabe ist entschieden, aber der Lauf ist nicht neu gestartet (hängendes Fortsetzen) |

**Was in die Warteschlange kommt.** Ein gelber oder roter Tool-Aufruf wartet hier, wenn das Security-Gate einen Menschen verlangt, bei jedem Anbieter — auch Aufrufe, die eine CLI (Claude Code, Grok, Kimi) mit ihren eigenen Werkzeugen machen will, und EYAS-Tools, die Grok oder Kimi über die Tool-Bridge aufrufen. In einem überwachten autonomen Lauf pausiert eine solche Freigabe den Lauf (**Wartet auf Freigabe**); nach der Freigabe läuft er weiter, und genau der freigegebene Aufruf ist einmal erlaubt.

**Dieselben Entscheidungen bei jedem Anbieter.** EYAS-Tools, die Grok und Kimi über die Tool-Bridge erreichen, werden genauso entschieden wie bei den API-Anbietern und Claude Code. In einem Chat, den du begleitest, oder in einer Kanal-Unterhaltung läuft ein Aufruf, den das Gate erlaubt: Die Stufen auf dieser Seite gelten nicht für begleitete Chats, und ein als freigabepflichtig markiertes Tool wartet hier nicht mehr nur deshalb, weil das Modell Grok oder Kimi ist. In Hintergrundläufen (geplant, Team, Pipeline oder jeder Lauf, der nicht als begleitet gekennzeichnet ist) gelten die Stufen: Ein Aufruf in einer Kategorie auf **Hinweis** oder **Freigeben** wartet hier, und ein Aufruf, den das Gate eskaliert, wartet immer auf einen Menschen, auch wenn seine Kategorie auf **Auto** steht — früher lief ein solcher Aufruf auf Grok und Kimi ungefragt. Ein Tool außerhalb der **Tools**-Liste des Agenten wird abgelehnt, bevor das Gate gefragt wird, und landet deshalb nie hier. Kann die KI-Prüfung des Gates nicht laufen — kein geeignetes Hintergrundmodell, ein gestopptes Budget oder jeder Versuch scheitert —, wird der Aufruf hierher eskaliert statt blockiert (siehe [Sicherheit & Datenschutz — Sicherheitsprüfer](/docs/de/admin/security-privacy/#security-judge)).

**Ein Shell-Befehl, der die Sandbox verlassen will.** Mit `security.cliSandbox: auto` kann Claude Code darum bitten, einen Befehl außerhalb der Kernel-Datei-Sandbox auszuführen (zum Beispiel einen, der `~/.npm` braucht). Ein solcher Befehl landet immer hier und wartet auf einen Menschen — nie auf den KI-Prüfer, nie auf die Autonomie-Leiter, egal welche Stufe die Kategorie hat. Sein Grund lautet: *Ein Shell-Befehl will außerhalb der Kernel-Datei-Sandbox laufen. Das kann nur ein Mensch erlauben; die Freigabe lässt genau diesen Befehl einmal ohne Sandbox laufen.* Autonome Läufe parken daran. Siehe [Anbieter — Kernel-Datei-Sandbox](/docs/de/ai/providers/#kernel-file-sandbox).

**Aus der Unterhaltung entscheiden.** Ein Aufruf, der auf Freigabe wartet, wird als *Freigabe nötig* gezeigt, nie als erfolgreich, und in der Unterhaltung erscheint eine Freigabekarte mit **Freigeben**, **Ablehnen** und **Freigaben öffnen**. Die Karte nutzt dieselbe Berechtigung wie diese Warteschlange (Freigeben unter Autonomie); ein Benutzer ohne sie erfährt, dass ein Owner oder Admin hier entscheiden kann. Siehe [Unterhaltungen — Freigaben im Chat](/docs/de/daily/conversations/#approvals-in-the-chat).

### Stufen (pro Kategorie)

| Stufe | Bezeichnung | Hinweis |
|-------|-------------|---------|
| 1 | **Hinweis** | Erst fragen |
| 2 | **Freigeben** | Vorschlag + Freigabe mit einem Klick |
| 3 | **Auto** | Autonom + Bericht danach |

Die Kategorien teilen sich in **Umkehrbar** (du darfst die Stufe anheben) und **Ausgehend / unumkehrbar (gesperrt)** (nicht über Hinweis — eine Sicherheitsuntergrenze).

## Einstellungen (Karte Autonomie & Selbstverbesserung)

**Einstellungen → System** hat die Karte **Autonomie & Selbstverbesserung**. Jede eingeschaltete Schleife löst geplant (oder ausgelöst) kostenpflichtige Modellaufrufe aus, und alle sind standardmäßig aus:

| Schalter | Bedeutung |
|----------|-----------|
| **Proaktiver Heartbeat** | Stellt proaktive Briefings zusammen, wenn etwas deine Aufmerksamkeit braucht |
| **Nächtliche Reflexion** | Ein nächtlicher Selbstreflexions-Durchlauf, der Verbesserungen in der Arbeitsweise des Assistenten findet |
| **Forge-Vorschläge** | Schlägt aus Reibungspunkten gelernte Tool-/Skill-Verbesserungen vor — deine Freigabe bleibt nötig |
| **Selbstlernen** | Schlägt aus Nutzungsmetriken gelernte Prompt-/Routing-Anpassungen vor — deine Freigabe bleibt nötig |
| **Skill-Übernahme** | Schlägt aus wiederkehrenden Mustern gelernte neue Skills vor — deine Freigabe bleibt nötig |

Jeder Schalter ist nur ein Feature-Flag — er löscht keine Daten. Zum Ändern braucht es die Berechtigung **update Autonomy**.

## Flächen auf der Startseite

| Fläche | Bedeutung |
|--------|-----------|
| Einrichtungspunkt der Startseite **Autonomie & Selbstverbesserung** | Erklärung zum Einschalten + Link zur Einstellungskarte |
| Startseite **Braucht Aufmerksamkeit** | Ausstehende Freigaben und hängende Fortsetzungen |
| Unterhaltung **Wartet auf Freigabe** | Lauf wartet auf dich |
| Telegram **Approve / Deny** | Derselbe Entscheidungsweg wie diese Warteschlange, für gelbe/rote Tools. Die Benachrichtigung geht an die Telegram-Zuordnung des Threads, sonst an eine freigegebene Kopplung. Keine rohen Tool-Argumente. Siehe [Telegram](/docs/de/communication/telegram/) |

## Siehe auch

- [Start](/docs/de/daily/home/)
- [Forge](/docs/de/agents/forge/)
- [Proaktiver Assistent](/docs/de/automation/proactive/)
- [Sicherheit & Datenschutz](/docs/de/admin/security-privacy/)
- [Telegram](/docs/de/communication/telegram/)
