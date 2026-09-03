---
title: Szójegyzék
description: Termék fogalmak.
---

| Fogalom | Definíció |
|---------|-----------|
| Ágens | Konfigurált AI szereplő |
| Primary | Mindig elérhető setup társ |
| Skill | Markdown eljárás-csomag |
| Készségjavaslat | Illeszkedő készség, amire a beszélgetés fordulója vár — **Használd**, **Most ne**, vagy tulajdonos/admin **Kapcsold ki** |
| Tool | Hívható képesség |
| Coding surface | Modellfüggetlen file toolok (`read_file`, `edit_file`, `grep`, …) az EYAS-ban, nem egy vendor SDK-ban |
| Worktree | Izolált git working tree párhuzamos team agentnek (`.eyas-worktrees/`) |
| Verify commands | Lint/test a run után, a critic előtt |
| Tool hook | PreToolUse / PostToolUse minden tool végrehajtásnál |
| Tábla | Munkakövető felület |
| Beszélgetés | Chat szál |
| Memória szint | Working→episodic→vault→archive |
| Memory block | Scoped megosztott jegyzet (company/agent/team/run) |
| Vault | Markdown hosszú távú tudás |
| Capture run | Egy post-turn tartós-memória kinyerés; minden kimenetel `memory_capture_runs` sort ír. Kapcsoló: `memory.capture.enabled` |
| Design canvas | Több artboardos `.dc.html` + `canvas.json`, Claude Design fájlformátum EYAS runtime-mal |
| Provider | LLM backend |
| MCP | Model Context Protocol |
| Connection | Névvel ellátott külső rendszer leltár (Odoo, GitHub, MCP, …) health + vault titkok |
| Csatorna | Külső üzenetküldő connector (Telegram, Slack, e-mail, …) — nem Connection, nem Kéz |
| Kéz (Hand) | Párosított helyi kliens OS/CLI/asztali toolokkal ([Kezek](/docs/hu/admin/hands/)) |
| Stúdió | Helyi gyártómotorok (HTML vagy felvétel → fájl). Nem a Média. ([Stúdió](/docs/hu/studio/)) |
| Video Use | Stúdió-motor: nyers felvétel vágása EDL-ből ([Video Use](/docs/hu/studio/videouse/)) |
| Browser Use | Opcionális CLI-sidecar belépett Chrome-hoz CDP-n ([Browser Use](/docs/hu/automation/browser-use/)) |
| Távoli csomópont | Másik gép, amit ez a példány elér (SSH és társai) ([Csomópontok](/docs/hu/admin/nodes/)) |
| Bővítménycsomag | Harmadik feles skill pack a katalógusból, MIT-kompatibilis licencellenőrzés ([Bővítmények](/docs/hu/admin/extensions/)) |
| Recordly | AGPL asztali képernyőrögzítő; harmadik feles kísérő a Bővítményekben, nincs csomagolva, nem Stúdió-motor ([Recordly](/docs/hu/admin/extensions/#recordly)) |
| Grounding | Indexelt forrásból retrieval, mielőtt tényt állít |
| Hybrid search | FTS + vektor (RRF) |
| Search source | Névvel indexelt fa (path + opcionális label/version/edition/family) |
| Code source pin | Conversation vagy project kijelölése, mely search source-okat használhat az ágens |
| Working directories | Elnevezett mappák (`név` + abszolút path), ahol a beszélgetés olvashat/írhat; az első a primary cwd. Típuson és/vagy projekten; a beszélgetés örökli. A fájl-eszközök ide vannak zárva — üres lista nem futtat |
| Először terv | Composer mód: a modell tervet ír, és **Jóváhagyás** / **Terv kihagyása** / **Elutasítás**ra vár, mielőtt tool futna |
| Skill import roots | Példány `skills.importRoots` / `agent.importRoots` a `local.yaml`-ban. Alap üres. Az izoláció marad |
| Projekt-wiki | Projektenkénti oldalak (`/projects/:id/wiki`); opcionális auto-update lezárt ticketekből és csapatdöntésekből |
| needsPin | Tool válasz, ha több odoo-family verzió ready, de nincs pin |
| Prompt Enhancer | Beszélgetés draft coach (modellcsalád-tudatos) |
| Prompt Coach | Tartós project / agent system prompt coach |
| Forge | Jóváhagyott soul/identity változások |
| God Mode | Ugyanazt a feladatot a Beállítások roster modelljei versenyeztetik; páros számnál chair dönt |
| Security gate | Pre-action policy |
| CASL | Authorization library |
| Orchestration | Solo/Auto/Deep sub-agent policy (plusz God Mode) |
| Effort | Gondolkodási mélység |
| SLA breach | Overdue / stale work jel a proactive heartbeatből |
| A2A | Agent-to-agent protokoll (card + task execution) |
