---
title: Üdvözlet
description: EYAS felhasználói kézikönyv — saját gépen futó személyes AI operációs rendszer, a te szabályiddal.
---

Az **EYAS** egy self-hosted személyes AI operációs rendszer. Elnevezett ágensek, tartós memória, munkatábla és csatornák a **te** gépeden futnak — nem valaki más felhőjében mint termék.

Ez a könyv az **üzemeltetőnek** szól, aki telepíti és életben tartja a példányt, és a **napi felhasználónak**, aki ágensekkel beszél, munkát követ, és elolvassa, mit jegyzett meg a rendszer. A mély architektúra és a fejlesztői specek a repó `docs/` könyvtárában maradnak (lásd [Architektúra mutató](/docs/hu/reference/architecture/)).

## Hogyan olvasd ezt a könyvet

Az oldalsáv a terméket követi, nem egy tankönyves Tutorial / How-to / Reference felosztást. Négy feladatod van; sorban élnek:

| Erre van szükséged… | Ide menj |
|---------------------|----------|
| **Tanulni csinálva** | Kezdés: [Első lépések](/docs/hu/getting-started/), [Setup varázsló](/docs/hu/setup-wizard/), [Az első órád](/docs/hu/first-hour/) |
| **Megérteni, miért** | [Alapfogalmak](/docs/hu/concepts/) és minden fejezet *Mire való* bevezetője |
| **Elvégezni egy munkát** | Napi munka, Ágensek, Skillek és automatizálás, Tudás, Kommunikáció, AI, Adminisztráció |
| **Kikeresni egy tényt** | Üzemeltetés és CLI, [Szójegyzék](/docs/hu/reference/glossary/), [GYIK](/docs/hu/reference/faq/), a how-to oldalak alján a mezőtáblák |

**Ajánlott út:** [Első lépések](/docs/hu/getting-started/) → [Setup varázsló](/docs/hu/setup-wizard/) → **[Az első órád](/docs/hu/first-hour/)** → [Alapfogalmak](/docs/hu/concepts/) → aztán az a terület, amire tényleg szükséged van.

A termékben a **?** ikonok a megfelelő fejezetet nyitják a **`/docs/`** alatt, ugyanazon a hoston, a használt nyelven.

## A dokumentáció térképe

| Szekció | Kezdd itt |
|---------|-----------|
| **Kezdés** | [Első lépések](/docs/hu/getting-started/) · [Setup varázsló](/docs/hu/setup-wizard/) · [Az első órád](/docs/hu/first-hour/) · [Alapfogalmak](/docs/hu/concepts/) |
| **Napi munka** | [Kezdőlap](/docs/hu/daily/home/) · [Beszélgetések](/docs/hu/daily/conversations/) · [Tábla](/docs/hu/daily/board/) · [Projektek](/docs/hu/daily/projects/) · [Keresés](/docs/hu/daily/search/) |
| **Ágensek** | [Áttekintés](/docs/hu/agents/overview/) · [Hang](/docs/hu/agents/voice/) · [Csapatok](/docs/hu/agents/teams/) · [Futtatások](/docs/hu/agents/runs/) |
| **Skillek és automatizálás** | [Skillek](/docs/hu/automation/skills/) · [Ütemező](/docs/hu/automation/scheduler/) · [Pipeline-ok](/docs/hu/automation/pipelines/) |
| **Tudás és memória** | [Memória](/docs/hu/knowledge/memory/) · [Tudásbázis](/docs/hu/knowledge/knowledge-base/) · [Design](/docs/hu/knowledge/design/) · [Dokumentumok](/docs/hu/knowledge/documents/) |
| **Kommunikáció** | [Csatornák](/docs/hu/communication/channels/) · [Telegram](/docs/hu/communication/telegram/) |
| **AI modellek és prompok** | [Providerek](/docs/hu/ai/providers/) · [Routing és budget](/docs/hu/ai/routing-budget/) · [Prompok](/docs/hu/ai/prompts/) · [MCP](/docs/hu/ai/mcp/) |
| **Adminisztráció** | [Felhasználók](/docs/hu/admin/users/) · [Értesítések](/docs/hu/admin/notifications/) · [Bővítmények](/docs/hu/admin/extensions/) · [Csomópontok](/docs/hu/admin/nodes/) · [Kezek](/docs/hu/admin/hands/) · [Backup](/docs/hu/admin/backup/) · [Biztonság](/docs/hu/admin/security-privacy/) |
| **Üzemeltetés és CLI** | [Docker](/docs/hu/deploy/docker/) · [CLI](/docs/hu/deploy/cli/) · [Konfiguráció](/docs/hu/deploy/configuration/) |
| **Referencia** | [Szójegyzék](/docs/hu/reference/glossary/) · [GYIK](/docs/hu/reference/faq/) |

Minden fejezet **mire való** és **mikor használd** bevezetővel nyit, aztán a munkafolyamat, aztán a mezők, ha segítenek.

## Nyelvek

Angol, magyar, német, spanyol, francia, klingon (tlhIngan Hol) — a fejlécben válthatsz. Hiányzó szöveg esetén angol fallback.

## A termékben

Ugyanez a site az EYAS fő folyamatában fut: **`/docs/`** (külön docs szerver nem kell).

## Támogatás

Az EYAS-t ugyanazok az AI modellek fejlesztik, amiket vezényel, és ez az inferencia
a projekt legnagyobb folyó költsége. A **[támogatás](https://github.com/sponsors/eyssen)**
ezt fedezi; a jelenlegi cél **$1000/hó** a modellszámlára.

Minden, amit az EYAS kiad, MIT-licencű és self-hosted marad, támogatással vagy anélkül,
és egyik csomag sem support szerződés. Csomagok és a teljes lista:
[SPONSORS.md](https://github.com/eyssen/eyas/blob/main/SPONSORS.md).
