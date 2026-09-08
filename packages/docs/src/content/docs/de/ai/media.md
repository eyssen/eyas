---
title: Medien
description: Magnific, Higgsfield oder fal verbinden. Agenten erzeugen über fünf gemeinsame Tools. Backends vergleichen und eines — oder mehrere — wählen.
---

**Wozu das da ist.** Medien ist, wie EYAS Bilder, Video, Audio, Edits und 3D erzeugt, hochskaliert und abwartet. Du wählst die Backends; der Agent nutzt **einen Tool-Satz**. Keiner der drei Vendoren ist Default. Null verbundene Provider = leer, fail-closed — niemals Mock-Pixel.

**Route:** `/media`. Sidebar: **Medien** (nach Anbieter). Titel: **Medien**.

## Wann du es brauchst

- Der Agent soll ein Bild erzeugen oder hochskalieren, ein Video machen oder auf einen langen Job warten.
- Du hast ein Magnific-, Higgsfield- oder fal-Konto und willst **nicht** fünfzig Vendor-Tools auf das Modell schütten.
- Credits kosten Geld — tägliche/monatliche Deckel oder ein Default pro Art.
- Fertige Dateien sollen in [Dokumente](/docs/de/knowledge/documents/) und an den erzeugenden Chat-Turn.

## Typischer Ablauf

1. Öffne **Medien** (`/media`).
2. Lies **Welches Backend?** auf der Seite, dann **Verbinden** (eins oder mehrere). Magnific und Higgsfield: OAuth im Browser; fal: API-Schlüssel.
3. Status **Verbunden**. Setze **Routing** (Standard / Fallback / Auch ausführen auf) pro Art und optional **Budget**.
4. Frag in einem Gespräch. Der Agent soll `media_catalog`, dann `media_generate`, dann `media_wait` rufen.
5. Ist der Job fertig, kopiert EYAS die Datei nach Dokumente und hängt sie an den Turn. Vendor-CDN-URLs laufen ab — verlass dich auf das gespeicherte Dokument.

## Welches Backend? {#compare}

Marketing-Tabellen reden von „Zielgruppe“ und „Web-UI vs. API“. In EYAS zählen andere Fragen: **wofür es am besten ist, wie du dich anmeldest, wie Credits laufen, und was mit der Datei passiert.**

| Kriterium | Magnific | Higgsfield | fal |
|-----------|----------|------------|-----|
| **Stärke** | Fotorealistische Stills, promptgeführtes **Creative**-Upscale, treues **Precision**-Upscale | Filmische Videos, Charakter-Konsistenz (Soul) | Riesiger Modellkatalog, Preischeck vor dem Lauf |
| **Arten in EYAS** | Upscale, Bild, Edit (auch Video / Audio / 3D) | Video, Bild (auch Audio) | Bild, Video, Audio, 3D, Upscale |
| **Anmeldung** | OAuth (Magnific-Konto) | OAuth (Higgsfield-Konto) | Bearer-API-Schlüssel (`fal-api-key`) |
| **Credits** | Dasselbe Guthaben wie auf der Magnific-Website. Web-**Unlimited gilt nicht** für MCP/API | MCP **zieht immer** Credits, auch bei Unlimited-Webplan | MCP selbst ist kostenlos; du zahlst den Modelllauf |
| **Ergebnis** | CDN-URL — EYAS kopiert die Bytes | URLs laufen in etwa **sieben Tagen** ab — Ingest ist Pflicht | CDN-URL — wird trotzdem kopiert |
| **Zuerst verbinden, wenn…** | Du hochskalierst, retuschierst oder Stills brauchst | Du Clips oder einen festen Charakter brauchst | Du viele Modelle oder erst den Preis wissen willst |

**Empfehlung**

1. **Verbinde ein Backend für den Job, den du wirklich hast.** Stills und Upscale → Magnific. Video / Charakter-Lock → Higgsfield. Breiter Katalog oder „was kostet das?“ → fal.
2. **Ein zweites Backend, wenn die Art wechselt**, nicht „für alle Fälle“. **Standard / Fallback** deckt Ausfälle; **Auch ausführen auf** schickt *denselben* Prompt extra und **verdoppelt Credits**. Leer lassen, außer du willst einen Vergleich.
3. **Rohe Vendor-MCP-Tools aus lassen**, außer beim Debuggen. Sonst landet die Vendor-Toolliste beim Agenten und Ingest entfällt.

Bilder und Prompts **verlassen diese Maschine** zum verbundenen Vendor. Wie jede andere SaaS behandeln.

## Fünf Tools

| Tool | Zweck | Risiko |
|------|-------|--------|
| `media_generate` | Job starten (`image`, `video`, `audio`, `upscale`, `edit`, `3d`) | gelb |
| `media_wait` | Warten, bis der Job terminal ist (Standard 180s, max. 600s) | gelb |
| `media_catalog` | Modelle einer Art — bevor du IDs erfindest | grün |
| `media_balance` | Verbleibende Credits | grün |
| `media_history` | Lokale, kürzliche Jobs | grün |

Keine verbundenen Provider oder Pin auf einen unverbundenen: strukturierter Fehler mit Hinweis auf `/media`.

## Einstellungen auf `/media`

**Routing.** Eine Zeile pro Art. **Standard**, wenn der Agent keinen Provider nennt. **Fallback**, wenn der Standard nicht verbunden ist. **Auch ausführen auf** nur für Fan-out.

Vorgeschlagene Defaults (nur wenn der Provider verbunden ist und die Zeile nicht gepinnt): Upscale / Bild / Edit → Magnific; Video → Higgsfield; Audio / 3D → fal.

**Budget.** Optionale Tages- und Monatslimits **pro Provider**. Ein Limit, das überschritten würde, scheitert **vor** dem Vendor-Aufruf. Unbekannte Credit-Beträge blockieren nicht.

**Rohe Vendor-MCP-Tools.** Standard aus. An = der Agent sieht auch `mcp_magnific_*` / `mcp_higgsfield_*` / `mcp_fal_*`. Aus lassen.

## Credits und Ingest

Fertige Jobs mit Ergebnis-URLs werden geholt (bis 200 MB, **kein JPEG-Rekompress**) nach Dokumente, als KI an die Konversation gebunden und an den erzeugenden Turn gehängt. `documentIds` statt Vendor-URLs.

Beim Upscale die **Originaldatei** senden (`documentId` oder URL). Kein JPEG vom Canvas-Screenshot.

## Fehlersuche

| Symptom | Versuch |
|---------|---------|
| Status bleibt **Nicht verbunden** nach OAuth | Anmeldung im Browser beenden, nach `/media` zurück. **Testen**. |
| Agent: kein Provider für diese Art | Ein Backend verbinden, das die Art listet, oder Routing-Default setzen. |
| Job fertig, kein Bild im Chat | **Letzte Aufträge** und [Dokumente](/docs/de/knowledge/documents/). Die Vendor-URL kann abgelaufen sein. |
| Credits schwinden zu schnell | **Auch ausführen auf** ist an, oder zwei Provider sind gepinnt. Budget prüfen. |
| Redirect landet bei MCP-Servern | `/media` öffnen und die Karte **testen**. Von Medien verbinden, nicht nur vom MCP-Katalog. |

## Verwandt

- [MCP-Server](/docs/de/ai/mcp/) — von Medien verwaltete Zeilen: *Verwaltet unter Einstellungen → Medien*
- [Tools](/docs/de/automation/tools/)
- [Dokumente](/docs/de/knowledge/documents/)
- [Verbindungen](/docs/de/admin/connections/)
- [Anbieter](/docs/de/ai/providers/) — Sprachmodelle, keine Bild-Backends
