---
title: Üdvözlet
description: EYAS felhasználói dokumentáció — saját gépen futó személyes AI, a te szabályiddal.
---

Az **EYAS** egy self-hosted személyes AI platform: ágensek, memória, tábla, többcsatornás kommunikáció és még sok más — a te gépeden, a te irányításod alatt.

Ez a dokumentáció **üzemeltetőknek és felhasználóknak** szól. A mély architektúra és a fejlesztői specek a repó `docs/` fájában vannak (lásd [Architektúra mutató](/docs/hu/reference/architecture/)).

## A dokumentáció térképe

| Szekció | Kezdd itt |
|---------|-----------|
| **Kezdés** | [Első lépések](/docs/hu/getting-started/) · [Setup varázsló](/docs/hu/setup-wizard/) · [Alapfogalmak](/docs/hu/concepts/) |
| **Napi munka** | [Kezdőlap](/docs/hu/daily/home/) · [Beszélgetések](/docs/hu/daily/conversations/) · [Tábla](/docs/hu/daily/board/) · [Projektek](/docs/hu/daily/projects/) · [Keresés](/docs/hu/daily/search/) |
| **Ágensek** | [Áttekintés](/docs/hu/agents/overview/) · [Hang](/docs/hu/agents/voice/) · [Csapatok](/docs/hu/agents/teams/) · [Futtatások](/docs/hu/agents/runs/) |
| **Skillek és automatizálás** | [Skillek](/docs/hu/automation/skills/) · [Ütemező](/docs/hu/automation/scheduler/) · [Pipeline-ok](/docs/hu/automation/pipelines/) |
| **Tudás és memória** | [Memória](/docs/hu/knowledge/memory/) · [Tudásbázis](/docs/hu/knowledge/knowledge-base/) · [Dokumentumok](/docs/hu/knowledge/documents/) |
| **Kommunikáció** | [Csatornák](/docs/hu/communication/channels/) · [Telegram](/docs/hu/communication/telegram/) |
| **AI modellek és prompok** | [Providerek](/docs/hu/ai/providers/) · [Routing és budget](/docs/hu/ai/routing-budget/) · [Prompok](/docs/hu/ai/prompts/) · [MCP](/docs/hu/ai/mcp/) |
| **Adminisztráció** | [Felhasználók](/docs/hu/admin/users/) · [Backup](/docs/hu/admin/backup/) · [Biztonság](/docs/hu/admin/security-privacy/) |
| **Üzemeltetés és CLI** | [Docker](/docs/hu/deploy/docker/) · [CLI](/docs/hu/deploy/cli/) · [Konfiguráció](/docs/hu/deploy/configuration/) |
| **Referencia** | [Szójegyzék](/docs/hu/reference/glossary/) · [GYIK](/docs/hu/reference/faq/) |

Minden fejezet tartalmaz **Áttekintést** és egy **Mezők és vezérlők** táblázatot a termék UI locale fájljaiból (az adott képernyő összes felirata), magyarázattal és stabil i18n kulccsal az in-app súgóhoz.

## Nyelvek

Angol, magyar, német, spanyol, francia, klingon (tlhIngan Hol) — a fejlécben válthatsz. Hiányzó szöveg esetén angol fallback.

## A termékben

Ugyanez a site az EYAS fő folyamatában fut: **`/docs/`** (külön docs szerver nem kell). Később a UI `?` ikonjai a `help-map.json` alapján ide fognak mutatni.
