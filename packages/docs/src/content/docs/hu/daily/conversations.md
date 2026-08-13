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
| **Project** | Tulajdonos projekt (`None` = nincs). Project váltáskor a **project alapértelmezett kódforrásai** kerülnek a Források fülre (ha nincs külön explicit pin a kérésben). |
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

Iteratív coach, ami a **beszélgetés modellcsaládjához** (Claude, OpenAI, Gemini, Grok, Kimi, …) alakítja a promptot küldés előtt.

| Vezérlő | Jelentés |
|---------|----------|
| Draft / cél | *Type a prompt draft or a goal…* |
| **Optimized for …** | Cél modellcsalád badge (Provider/Model alapján) |
| Task type chip-ek | **General · Coding · Research · Analysis · Writing · Agentic · Files / vision** |
| **Attach file** | Enhancer kontextus (vagy carry over) |
| **Send** | Finomítás folytatása |
| **Quality N/10** | Minőségpont; **Gaps** = hiányzó checklist tételek |
| **Propose two alternatives** | **Concise** / **Thorough** / **Recommended** változatok |
| **Suggested final prompt** | Beilleszthető szöveg |
| **carry N files** | Csatolmányok a fő chatbe |
| **Apply** | Végleges (vagy utolsó) prompt a composerbe |

**Tartós** projekt / ágens system promptokhoz: [Prompt Coach](/docs/hu/ai/prompts/) a Projektek és Ágens Configuration oldalon.

---

## Context rail (chatter)

Jobb panel fülek: **Előzmények · Források · Következő · Fájlok**

| Terület | Mezők / vezérlők |
|---------|------------------|
| **Előzmények** | Add note, All/Notes/Changes szűrő, Note/Update badge |
| **Források** | Multi-checkbox a Search Source-okra (label, verzió, status). **Összes** / **Törlés (auto)**. Pin = melyik Odoo/kód fát használhatja az ágens. Project default öröklődik új conversationnél és project váltáskor. Részletek: [Keresés](/docs/hu/daily/search/) |
| **Következő** | Activities: Type, Summary, Deadline, Schedule, Mark as done |
| **Fájlok** | Csatolt fájlok |
| **Runtime** | Futási meta (összecsukható; nem a History része) |

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

- [Keresés — többverziós pin](/docs/hu/daily/search/)
- [Projektek — alap kódforrások](/docs/hu/daily/projects/)
- [Ágensek](/docs/hu/agents/overview/)
- [Tábla](/docs/hu/daily/board/)
- [Hangprofilok](/docs/hu/agents/voice/)
