---
title: Teams und Delegation
description: Kollegen, mit denen du sprichst, Spezialisten, die sie starten, und wann noch ein Teamvorschlag erscheint.
---

**Wozu das da ist.** Du sprichst mit **Kollegen** (primären und Team-Agenten). Sie haben klare Rollen. Sie geben Arbeit an einen anderen Kollegen ab oder starten **Spezialisten** aus einem gemeinsamen Pool — automatisch, oft parallel. Eine Teamvorschlags-Karte erscheint nur, wenn ein Spezialist fehlt, du ein Team verlangt hast oder die Arbeit episch ist.

Das ist Zusammenarbeit, nicht God-Modus (mehrere Modelle, die an derselben Aufgabe um die Wette laufen).

## Wann du es brauchst

- Du willst mit dem Persönlichen Assistenten oder dem Systemingenieur wie mit Personen sprechen, nicht über ein verstecktes Dropdown.
- Eine Aufgabe braucht mehrere Spezialisten zugleich (`run_specialist` in einem Zug).
- Git-Worktrees, damit parallele Bearbeiter sich nicht in die Quere kommen (implizite Sessions mit zwei oder mehr schreibenden Spezialisten und epische Teamvorschläge).
- Du willst weiterhin einen sichtbaren Plan zum **Annehmen**, wenn ein Spezialist noch nicht existiert.

## Typischer Ablauf

1. Öffne einen **Kollegen** in der Seitenleiste (**Kollegen**) oder wähle einen in einer neuen Unterhaltung.
2. Bitte ihn um die Arbeit. Er soll `handoff_to_colleague` oder `run_specialist` nutzen, statt die Arbeit einer anderen Rolle zu machen.
3. Spezialistenläufe erscheinen als Unter-Unterhaltungen. Das Team-Gedächtnis funktioniert ohne Vorschlagskarte (implizite Session).
4. Klicke **Team-Dashboard öffnen**, wenn mehrere Spezialisten gleichzeitig arbeiten.
5. Eine Karte **Team-Vorschlag** erscheint weiterhin bei `/team`, „nutze ein Team“ oder epischer Arbeit — **Annehmen** oder **Überspringen**.

## Begriffe

| Begriff | Bedeutung |
|---------|-----------|
| **Kollege** | Primärer oder Team-Agent, dem du direkt schreibst. Hat einen Home-Thread und eine Stimme (SOUL). |
| **Spezialist** | Eng zugeschnittener Arbeiter. Gemeinsamer Pool — jeder Kollege kann jeden aktivierten Spezialisten starten. |
| **`run_specialist`** | Start im Zug; wartet auf eine Zusammenfassung. Grün (kein Klick). Alias: `delegate_to_agent`. |
| **`handoff_to_colleague`** | Öffnet den Home-Thread des anderen Kollegen und startet dort sofort einen Lauf, mit dem Briefing als Ziel. Wird mit einer *busy*-Meldung abgelehnt, solange der Thread beschäftigt ist. Grün. Siehe [Unterhaltungen — Übergabe](/docs/de/daily/conversations/#handoff). |
| **`assign_task`** | Asynchrone Board-Karte. Grün, wenn das Ziel aktiviert ist. |
| **`propose_team`** | Karte für fehlende Rollen / epische Arbeit / ausdrücklichen Wunsch. Gelb. |
| **Home-Thread** | Eine fortlaufende Unterhaltung pro Kollege. |
| **Implizite Arbeitssession** | Entsteht beim ersten Spezialistenstart, damit das Team-Gedächtnis ohne Karte funktioniert. |

## Stufen

| Stufe | Sprichst du mit ihnen? | Typische Aufgabe |
|-------|------------------------|------------------|
| **Primär** | Ja | Die beim Setup angelegten Teamkollegen (Assistent, Ingenieur) |
| **Team** | Ja | Ständige Kollegen (Prüfer, Kritiker, …) |
| **Spezialist** | Nein (nur als Kind / Aufgabe) | Ausführung in einer einzigen Domäne |

## Ein Weg für Spezialisten, bei jedem Anbieter

Spezialisten laufen immer über EYAS. Wenn ein Kollege Arbeit verteilt — in der Orchestrierung **Automatisch** wie **Tief** —, startet er Spezialisten mit `run_specialist`, egal auf welchem Anbieter er läuft: Claude Code, Grok CLI, Kimi CLI oder ein API-Anbieter. Claude Code startet keine eigenen versteckten Subagenten: Sein eingebautes Task/Agent-Tool wird nicht angeboten.

Jeder Spezialist läuft mit seiner EYAS-Agenten-Einrichtung — Persona-Prompt, EYAS-Speicher, konfigurierte Tools — und erscheint als Unter-Unterhaltung, die du öffnen kannst, mit eigenem überwachtem Lauf und Transkript. Der Modus **Tief** kann auf Claude Code länger dauern, weil jeder Spezialist ein vollständiger eigener EYAS-Lauf ist.

**Tief gibt jedem Modell dieselbe Anweisung:** Nicht-triviale Arbeit aufteilen und pro unabhängigem Teil einen Spezialisten starten, parallel, jeden mit einem präzisen, in sich geschlossenen Briefing; mit `handoff_to_colleague` übergeben, wenn ein anderer Kollege für die Aufgabe zuständig ist; ein Team nur vorschlagen, wenn ein benötigter Spezialist noch nicht existiert; wichtige Ergebnisse vor dem Abschluss prüfen; und die Schlusssynthese selbst behalten.

**Sicherheit.** Das Security-Gate gibt den Subagent-Tool-Namen von Claude Code nicht vorab frei. Claude Code bekommt dieses Tool nie angeboten, und ein Aufruf würde als nicht klassifiziert behandelt und zur Freigabe eskaliert statt erlaubt.

<h2 id="which-model-and-effort-a-specialist-or-member-uses">Welches Modell und welchen Aufwand ein Spezialist oder Mitglied nutzt</h2>

**Modell.** Das Modell eines Agenten ist ein Paar aus Anbieter und Modell (siehe [Erstellen & konfigurieren — Modell & Aufwand](/docs/de/agents/configure/#model--effort)). Ist es leer, läuft der Agent auf dem eigenen Modell der Unterhaltung:

- Ein mit `run_specialist` / `delegate_to_agent` gestarteter **Spezialist**, eine mit `assign_task` verteilte Karte und eine mit `create_sub_conversation` angelegte Unter-Unterhaltung laufen auf dem Modell, **auf dem der delegierende Zug tatsächlich lief**. Dieses Paar wird an der neuen Unter-Unterhaltung gespeichert; es wird nicht aus den gespeicherten Einstellungen der Eltern-Unterhaltung kopiert. Bei Claude Code, Grok und Kimi erreicht das Modell des delegierenden Zugs auch die über die Bridge aufgerufenen EYAS-Tools.
- Ein **Teammitglied** läuft auf seinem eigenen Modell, sonst auf dem aktuellen Modell des Leiters (dem Modell, auf dem die Eltern-Unterhaltung gerade läuft; bei einer Unterhaltung mit automatischem Routing ihre Stufe Standard), sonst auf dem Standard der Installation.
- Gibt es nichts davon, gilt der Standard der Installation (Stufe Standard → Standard-Anbieter → erster aktiver Anbieter mit einem aktivierten Modell, CLI-Anbieter eingeschlossen), und er wird beim ersten Lauf an dieser Unterhaltung festgelegt.
- Kann das eigene Modell des Agenten nicht genutzt werden (sein Anbieter ist ausgeschaltet oder das Modell deaktiviert), nutzt der Lauf das gespeicherte Modell der Unterhaltung (das des delegierenden Zugs), sonst den Standard, und die Antwort vermerkt die Notiz `agent-binding-unavailable`. EYAS wählt nie einen anderen Anbieter nach Namen. Ist überhaupt kein Modell eingerichtet, scheitert der Lauf mit *Kein Modell eingerichtet…* und wird nicht wiederholt.

Es gibt keinen Anthropic-exklusiven Team-Modellrouter: Ein Teammitglied ohne Modell läuft nicht auf der Anthropic-API, nur weil ein Anthropic-Schlüssel eingerichtet ist, und Team-Konfigurationen haben kein `modelRouting`.

**Aufwand.** Ein Mitglied oder Spezialist mit eigenem Aufwand behält ihn. Eines ohne erbt die Stufe der Unterhaltung, die die Arbeit delegiert hat, sodass eine **Tief**-Unterhaltung ihre Spezialisten auf *Maximum* schickt — was mehr kostet. Jede Stufe wird dann an das antwortende Modell angepasst, und jede Antwort vermerkt, was angefragt wurde und was lief. Siehe [Anbieter — Denkaufwand](/docs/de/ai/providers/#reasoning-effort).

## Speicher und Tools in Teamläufen

- Spezialisten, delegierte Agenten und Teammitglieder bekommen denselben abgerufenen Speicherblock wie ein Chat-Zug, an ihre Aufgabe oder ihr Briefing angehängt (siehe [Speicher — Wie der Abruf das Modell erreicht](/docs/de/knowledge/memory/#how-recall-reaches-the-model)).
- Das Briefing jedes Teammitglieds wird ebenfalls gemerkt, als Text, den ein Agent geschrieben hat, nicht du.
- Die Erfassung dauerhafter Erinnerungen läuft auch auf jedem Spezialisten, delegierten Agenten und Teammitglied, unter denselben `memory.capture.*`-Einstellungen wie ein Chat-Zug. Die Aufgabe oder das Briefing wird als Anweisung gelesen, die ein Agent geschrieben haben kann: Nur Fakten, die sie über dich, das Projekt oder die Welt aussagt, werden behalten, nie die Schritte der Aufgabe selbst. Jeder läuft in einer eigenen Unterunterhaltung und hat damit seine eigene Obergrenze `maxPerConversation`, und jeder Lauf, dessen Anweisung mindestens `minUserChars` lang ist, kann einen zusätzlichen Modellaufruf im Hintergrund kosten. Siehe [Speicher — Capture ist standardmäßig an](/docs/de/knowledge/memory/#capture-is-on-by-default).
- Jedes Mitglied bekommt die **Tools**-Liste seines Agenten plus die Speicher-Tools ([Erstellen & konfigurieren — Tools](/docs/de/agents/configure/#tools--constraints)), bei jedem Anbieter.
- In einem Teamlauf zeigt jedes Mitglied sein gerade laufendes Tool, egal auf welchem Anbieter.

## Teamvorschlag und Neuplanung

Der Teamvorschlag wird vom Hintergrundmodell von EYAS in einem isolierten Aufruf ohne Tools geschrieben, auf den Planungsstufen: **Schnell**, dann **Standard**, dann der Standard der Installation oder ein anderer Anbieter, der isolierte Aufrufe ausführen kann. Ohne geeignetes Hintergrundmodell — zum Beispiel auf einer Installation, deren einziges Modell eine Grok CLI oder Kimi CLI ist, deren Fähigkeit zu isolierten Aufrufen EYAS noch nicht geprüft hat, oder wenn das Modellbudget erschöpft ist — schlägt die Karte einen einzigen Agenten vor (den ersten aktivierten). Zwischen den Phasen arbeitet der Neuplaner genauso: Ohne geeignetes Hintergrundmodell behält das Team seinen aktuellen Plan. Siehe [Routing & Budget — Das Hintergrundmodell](/docs/de/ai/routing-budget/#background-model).

## Worktrees & Verify

| Verhalten | Wann |
|-----------|------|
| **Git-Worktrees** | Zwei oder mehr schreibende Spezialisten in einer impliziten Session, und Teamvorschläge für **complex** / **epic** Ziele — unter `.eyas-worktrees/` |
| **Verify-Befehle** | Optional `agent.verifyCommands` in YAML — siehe [Konfiguration](/docs/de/deploy/configuration/) |

## In Unterhaltungen

Siehe [Unterhaltungen](/docs/de/daily/conversations/):

- Baum der Unter-Unterhaltungen
- Team-Dashboard (Erkenntnisse, Entscheidungen, Blocker)
- Teamvorschlags-Karte: **Annehmen** / **Überspringen**, und **Jetzt erstellen** für fehlende Spezialisten
- **&lt;Name&gt; öffnen** in der Tool-Zeile, wenn ein Kollege übernimmt

## Einrichtung

Der Setup-Assistent legt zwei primäre Kollegen an. Der optionale Schritt **Team-Agenten** fügt weitere Kollegen und Spezialisten hinzu. Spezialisten kommen auch aus Vorlagen oder über **Agent erstellen**. Später änderst du sie unter **Agenten**.

## Siehe auch

- [Unterhaltungen](/docs/de/daily/conversations/)
- [Läufe & Mission Control](/docs/de/agents/runs/)
- [Agenten — Übersicht](/docs/de/agents/overview/)
