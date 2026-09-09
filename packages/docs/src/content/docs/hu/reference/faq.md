---
title: GYIK
description: Gyakori problémák.
---

### Port foglalt
`EYAS_PORT=3200 ./bin/eyas start` vagy szabadítsd a processt.

### A UI nem a 3000-es porton van
Az alap listen port **3100**, hogy ne ütközzön a Grafanával vagy a Create React App :3000-jével. Nyisd: **http://localhost:3100**. Felülírás: `EYAS_PORT` vagy `server.port`. Docker: `"${EYAS_PORT:-3100}:3100"`.

### Nincs UI
`bun run build:web` (induláskor automatikus, hacsak `EYAS_SKIP_WEB_BUILD=1`).

### /docs 404
`bun run docs:build` vagy újraindítás `EYAS_SKIP_DOCS_BUILD` nélkül. Csomag: `packages/docs`. Ne futtasd a `generate-full-docs.mjs`-t / `bun run full-docs`-t — felülírja a prózát.

### Provider hitelesítési hiba
Kulcs újra a Providerek/Titkok alatt; CLI-hez a `claude`/`grok`/`kimi` menjen ugyanabban a környezetben.

### A beszélgetések a ~/.claude / ~/.grok memóriámat olvassák
Claude Code CLI: **Gépszintű Claude-konfig betöltése** maradjon **KI** (alap). Az izolált hívások `CLAUDE_CODE_DISABLE_AUTO_MEMORY`-t is beállítanak. Grok/Kimi ACP **nem** izolálható — a paneljeik ezt mondják. Lásd [Providerek](/docs/hu/ai/providers/).

### Tartós jegyzetek íródnak, és ezt ki akarom kapcsolni
`memory.capture.enabled: false` a `local.yaml`-ban (kulcsútvonal `memory.capture.enabled`, alap **true**). Ha ki van kapcsolva, a kihagyott capture **nem** ír `memory_capture_runs` sort. Lásd [Memória](/docs/hu/knowledge/memory/) és [Konfiguráció](/docs/hu/deploy/configuration/).

### Hol az adat?
`$EYAS_HOME` vagy cwd: `data/sqlite`, `data/vault`, `data/agents`, mentések, logok.

### A varázsló beragad reload után
Jelentkezz be tulajdonosként, nyisd a `/setup`-ot a maradék opcionális lépésekhez.
