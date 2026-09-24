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
Kulcs újra a Providerek/Titkok alatt. Claude Code-nál a `claude` legyen bejelentkezve ugyanabban a környezetben. A Grokot és a Kimit a provider paneljükön kell bejelentkeztetni az EYAS számára, nem a hoston.

### A beszélgetések a ~/.claude / ~/.grok memóriámat olvassák
Már nem tudják. A Claude Code mindig izoláltan fut — nincs host `CLAUDE.md`, beállítások, hookok, skillek, MCP szerverek vagy auto-memória, és nincs átirat a `~/.claude/projects` alatt; a régi **Gépszintű Claude-konfig betöltése** kapcsoló megszűnt. A Grok CLI és a Kimi Code CLI a saját EYAS home-jában fut, és soha nem látja a `~/.grok`, a `~/.kimi` vagy a `~/.claude` mappát. A biztonsági kapu minden modell számára elutasítja más eszközök memóriájának olvasását és írását is, a memóriatár MCP szerverek pedig tiltottak. Ha ezt a tudást be akarod hozni az EYAS-ba, importáld egyszer a **Beállítások → Rendszer → Adat hordozhatóság → Adatok importálása** alatt. Lásd [Providerek — Claude Code izoláció](/docs/hu/ai/providers/#claude-code-isolation) és [Memória](/docs/hu/knowledge/memory/#memory-outside-eyas-is-refused).

### A Grok vagy a Kimi a frissítés után nem válaszol
A Grok CLI és a Kimi Code CLI most az EYAS saját home-jában fut, ezért a CLI gépen lévő bejelentkezését az EYAS nem használja. Jelentkezz be egyszer az EYAS számára: **Providerek → Grok CLI / Kimi Code CLI → Bejelentkezés az EYAS számára** (eszközkód; a Grok xAI API-kulcsot is elfogad). Addig a kártya **Bejelentkezés szükséges** jelzést mutat, a körök pedig *… nincs bejelentkezve az EYAS számára* hibával buknak el. Lásd [Providerek — Bejelentkezés a Grokba és a Kimibe az EYAS számára](/docs/hu/ai/providers/#sign-in-grok-and-kimi-for-eyas).

### Egy kör azzal bukott el, hogy „nem tudta megerősíteni, hogy elszigetelten fut”
Az EYAS talált valamit a hoston, ami megtörné a CLI izolációját — például egy extra MCP szervert, hookot, plugint vagy skillt, egy rendszerszintű Grok-konfigot, vagy egy menedzselt Claude Code policyt, amely más jogosultsági módot kényszerít. Szüntesd meg az okot, és küldd el újra az üzenetet; a kör soha nem kerül át másik modellhez. Lásd [Providerek — Izolációs ellenőrzés](/docs/hu/ai/providers/#isolation-check-before-every-turn) és [Claude Code izoláció](/docs/hu/ai/providers/#claude-code-isolation).

### Egy MCP szerver „Tiltva: memóriatár” jelzést mutat
Egy második memóriát tart az EYAS-on kívül (Memory, Qdrant, Obsidian, MCPVault, …), vagy védett mappára mutat, ezért az EYAS soha nem indítja el. Szerkeszd úgy, hogy máshová mutasson, vagy töröld, és hozd be azt a memóriát az adatimporttal. Lásd [MCP](/docs/hu/ai/mcp/#memory-store-servers-are-blocked).

### A Claude Code telepítve van, de a provider nem érhető el
Az EYAS-nak az kell, hogy a Claude Code bináris **be legyen jelentkezve**, nem elég, ha a PATH-on van: claude.ai login, `ANTHROPIC_API_KEY` vagy Bedrock/Vertex beállítás. Nézd meg az `eyas doctor`-t — a **Claude Code runtime** sor mutatja, melyik binárist futtatja az EYAS, és be van-e jelentkezve. Egy szolgáltatás PATH-járól hiányozhat a `claude`; állítsd az `EYAS_CLAUDE_CODE_BIN`-t az abszolút útvonalára. Bejelentkezés után a Providerek alatt kapcsold ki, majd be a providert, vagy indíts újra. Lásd [Providerek — Claude Code runtime](/docs/hu/ai/providers/#claude-code-runtime).

### Tartós jegyzetek íródnak, és ezt ki akarom kapcsolni
`memory.capture.enabled: false` a `local.yaml`-ban (kulcsútvonal `memory.capture.enabled`, alap **true**). Ha ki van kapcsolva, a kihagyott capture **nem** ír `memory_capture_runs` sort. Lásd [Memória](/docs/hu/knowledge/memory/) és [Konfiguráció](/docs/hu/deploy/configuration/).

### Hol az adat?
`$EYAS_HOME` vagy cwd: `data/sqlite`, `data/vault`, `data/agents`, mentések, logok. Az `EYAS_DATA_DIR` az egész adatkönyvtárat áthelyezi; a vault vele költözik (`<data dir>/vault`). A git clone-ból futó forrástelepítés beszélgetés-workspace-ei a felhasználód alkalmazásadat-könyvtárában vannak — lásd [Konfiguráció](/docs/hu/deploy/configuration/#conversation-workspaces).

### Beállítottam az EYAS_DATA_DIR-t, és eltűntek a memóriajegyzeteim
A korábbi verziók a vaultot akkor is a `<EYAS home>/data/vault` alatt tartották, ha az `EYAS_DATA_DIR` máshová mutatott. A frissítés utáni első indulás egyszer átmásolja ezeket a jegyzeteket a `<data dir>/vault`-ba, de csak akkor, ha az új vaultban még nincs jegyzet. Futtasd az `eyas doctor`-t: a **Vault** sora megmondja, függőben van-e a másolás, vagy hogy a régi mappa már nincs használatban, mert mindkettőben vannak jegyzetek — ilyenkor a még szükséges jegyzeteket kézzel másold át. Lásd [Konfiguráció — Adatkönyvtár és vault](/docs/hu/deploy/configuration/#data-directory-and-vault).

### A modell rossz helyi időt kap
Állítsd be az `i18n.timezone`-t (IANA név, például `Europe/Berlin`) a `local.yaml`-ban, és indíts újra. Beállítás nélkül az EYAS a szerver zónáját használja — a `TZ`-t, különben az operációs rendszerét; a konténerek általában UTC-ben futnak. Lásd [Konfiguráció](/docs/hu/deploy/configuration/#time-zone-of-the-models-clock).

### A varázsló beragad reload után
Jelentkezz be tulajdonosként, nyisd a `/setup`-ot a maradék opcionális lépésekhez.
