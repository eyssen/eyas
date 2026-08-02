---
title: Beszélgetések
description: Chat munkaterület — minden mező, sáv és vezérlő az ágensekkel való beszélgetéshez.
---

**Belépés:** oldalsáv **Új beszélgetés** (`POST /conversations`) vagy meglévő szál a Tábláról / Recentből.

Elrendezés: **üzenetek + composer** (fő) és **context rail** (chatter: jegyzetek, mezők, aktivitások, fájlok, runtime).

---

## Beszélgetés státusz

| Státusz | Jelentés |
|---------|----------|
| **Idle** | Nincs aktív run |
| **Working…** | Ágens fut |
| **Waiting** | Vár inputra |
| **Waiting approval** | Emberi jóváhagyásra vár |
| **Archived** | Archivált |

---

## Header / modell sáv

| Vezérlő | Jelentés |
|---------|----------|
| **Provider…** | Provider felülírás ehhez a szálhoz |
| **Model…** | Modell felülírás (különben ágens default / auto-routing) |
| **Auto-routing** | A router választ |

---

## Prioritás (top bar)

**Low / Normal / High / Urgent** — üzleti prioritás (a Táblán is látszik).

---

## Beszélgetés mezők

| Mező | Jelentés |
|------|----------|
| **Project** | Tulajdonos projekt (`None` = nincs) |
| **Stage** | Stage a projekt pipeline-ban |
| **Agent** | Hozzárendelt ágens — **az első üzenet után zárolt** |
| **Effort** | Off / Low / Medium / High / Max — gondolkodási mélység vs költség |
| **Orchestration** | **Solo** = nincs sub-agent; **Auto** = a modell dönt; **Deep** = agresszív fan-out |

---

## Üzenetfolyam

| Vezérlő | Jelentés |
|---------|----------|
| **Start a conversation…** | Üres állapot |
| **Thinking… / Composing…** | Modell dolgozik / streamel |
| **Stop** | Run megszakítása |
| **Background working…** | Elhagytad az oldalt; a válasz később jelenik meg |
| Tool **Input / Output / Error** | Tool hívás részletei |
| **Turn N / Max**, **tokens**, **Cancel** | Agent progress |
| **Simple / Managed / Autonomous / Wizard** | Komplexitás jelző |
| **Voice INTERNAL/EXTERNAL/AUTO** | Hangprofil scope (+ force override) |

---

## Composer

| Vezérlő | Jelentés |
|---------|----------|
| **Type a message…** | Üzenet (`Shift+Enter` = új sor) |
| **Attach file** | Csatolmány a következő üzenethez |
| **Prompt Enhancer** | Iteratív prompt finomítás Apply előtt |

### Prompt Enhancer

Cél leírása, opcionális fájlok, **Send** a finomításhoz, **Suggested final prompt**, **carry N files**, **Apply** a fő composerbe.

---

## Context rail (chatter)

| Terület | Mezők / vezérlők |
|---------|------------------|
| **Notes / History** | Add note, All/Notes/Changes szűrő, Note/Update badge |
| **Business fields** | Stage, Project, Priority, Status, Due date |
| **Activities** | Type, Summary, Deadline, Schedule, Mark as done, Overdue/Today/Planned |
| **Files / Attachments** | Csatolt fájlok |
| **Runtime / Next** | Futási meta, következő lépések |

---

## Team funkciók

| Elem | Jelentés |
|------|----------|
| **Sub-conversations** | Többágenses gyerek szálak |
| **Team Dashboard** | Phase, tokens, Finding/Decision/Blocker/…, View chat |
| **Team proposal** | Approve / Skip / Create missing specialists |
| **Run tree / Workflow** | Hierarchikus run nézet |

---

## Kapcsolódó

- [Ágensek](/docs/hu/agents/overview/)
- [Tábla](/docs/hu/daily/board/)
- [Hangprofilok](/docs/hu/agents/voice/)
