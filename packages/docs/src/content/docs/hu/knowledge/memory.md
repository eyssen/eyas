---
title: Memória
description: Amire az EYAS emlékszik — automatikus vault-jegyzetek, öt szint, és melyik tárat mikor használd.
---

**Mire való.** A memória az EYAS saját hosszú távú tára. Egy tartós tényt, amit a beszélgetésben kimondasz, vault-jegyzet lesz belőle kérés nélkül, és ugyanezt a jegyzetet olvassa vissza minden későbbi beszélgetés. Ezen az oldalon a working blokkokat, az epizodikus tényeket, a vault-fájlokat és a review sort nézed — nem wiki-t szerkesztesz.

## Mikor használd

- Az asszisztensnek emlékeznie kell rád, a munkamódodra, vagy egy projekt korlátaira.
- Tény hangzott el a chatben, és ellenőrizni akarod, bekerült-e a vaultba (vagy miért maradt ki a capture).
- Review, tag, gráf vagy konszolidáció kell — vagy a **Today's note**.
- Választanod kell Memória, Tudásbázis-wiki, Dokumentumok és kézzel írt vault-fájl között (lásd alább).
- Erre a példányra ki akarod kapcsolni a capture-t (`memory.capture.enabled: false`).

## Tipikus munkafolyamat

1. Nyisd a **Memóriát** az oldalsávon (**Tartalom** szakasz) — útvonal `/memory`. (Szerepel a **Beállítások → AI és modell** alatt is.)
2. Nézd az **Overview**-t (számok, salience, friss epizodikus), majd a **Vault Files**-t a tartós jegyzetekhez.
3. Folytass egy ~40 karakternél hosszabb beszélgetést, ami tartós tényt mond. A válasz után ide vissza: új vault-jegyzetet kell látnod (`user`, `feedback`, `domain`, `project` vagy `reference`).
4. Ha semmi nem jelent meg: túl rövid volt, a capture ki van, vagy God Mode kör volt (azok nem capture-ölnek). Írj jegyzetet kézzel a vaultba, ha akkor is kell.

## Melyik tárat használd

| Tár | Feladat |
|-----|---------|
| **Memória** (ez az oldal) | Automatikus + agent-írta tények. Az EYAS egy-soros indexet tesz a későbbi promptokba. Ez a forrás, „mit tud rólad az asszisztens.” |
| **Tudásbázis** wiki | Kurált oldalak, **te** szerkeszted (space-ek, fa, verziók). A capture ide nem ír. |
| **Dokumentumok** | Feltöltött fájlok (PDF, kép, …) retrievalhez — nem identitás-jegyzetek. |
| **Vault-fájlok** (kézzel írt markdown) | Ugyanaz a vault, mint a capture (`data/vault/…`). Írj egyet magad; az EYAS felveszi. **Ne** a `~/.claude` vagy `~/.grok` legyen ez a tár. |
| **Projekt-wiki** | Projektenkénti ticket- és döntésoldalak, nem globális memória. |

A gép host Claude / Grok memóriája **nem** a forrás. Az izolált CLI-hívások és az alapból ki `loadClaudeMd` azért vannak, hogy egy második memória ne előzze meg a vaultot.

## Funkciók

Alcím az appban: *5-tier hybrid memory — working, episodic, semantic/procedural vault, archive.*

## Műveletek

Today's note · Consolidate Now · Refresh.

## Tabok

Overview · Working · Episodic · Vault Files · Archive · Graph · Tags · Review.

## Working

24h TTL blokkok: chars, accessed, expires.

## Episodic

salience, invalidated, source, agent, access/conversation count, dátumok, embedding hash.

## Vault

Fájllista, frontmatter, tags/links, content, backlinks.

## Archive

Alacsony salience, consolidator menti ide. Promotion → vault, demotion → archive az Overview-n.

## Tartós jegyzetek

A tartós jegyzet egy megmaradó tény, nem egy esemény feljegyzése: ki vagy,
hogyan szeretnéd, hogy dolgozzanak, mik egy projekt megszorításai. Mindegyik
egy-egy markdown fájl a vaultban, és az ügynök minden fordulóban egy
**egysoros indexet** kap belőlük — csak az összefoglalókat. A teljes jegyzetet
`search_memory`-val olvassa el, ha a sor érdekesnek bizonyul.

Egy második, fordulónkénti blokk **kapcsolódó korábbi munkát** hoz be a vaultból,
az epizodikus memóriából és a korábbi beszélgetésüzenetekből — a mostani üzenet
a lekérdezés. A modellnek nem kell `search_memory`-t hívnia ahhoz, hogy ezek a
találatok megjelenjenek. A törzsek továbbra is a `search_memory`-n keresztül
töltődnek. A korábbi üzenetek azért kereshetők, mert már tárolva vannak; ez
nem egy második másolat.

Két frontmatter-mező vezérli:

| Mező | Mit csinál |
|------|------------|
| `kind` | `user`, `feedback`, `domain`, `project` vagy `reference` — egyben a rangsor is |
| `summary` | Az az egy sor, ami az indexben megjelenik |

A `user` és a `feedback` van elöl, mert ezek minden válasz elkészítését
befolyásolják. A `domain` a projekttípus (az azonos típusú ügyfelek osztoznak
rajta); a `project` ez az egy ügyfél. A `kind` nélküli jegyzet `feedback`, ha a `procedural/` alatt
van, egyébként `reference` — **soha nem `user`**: egy be nem sorolt jegyzetet
rólad szóló ténynek nyilvánítani annyi, mint minden prompt elejére tenni.
`summary` híján a jegyzet első valódi sora kerül be, tehát egy bármilyen
szerkesztőben kézzel írt fájl EYAS-specifikus frontmatter nélkül is működik.

Hol vannak: `data/vault/semantic/`, `data/vault/procedural/`,
`data/vault/projects/`, `data/vault/project-types/`. Írj bele egyet, és az EYAS felveszi.

**Ezek maguktól töltődnek.** Miután a válasz már megérkezett, egy kis
modellhívás elolvassa a fordulót, és megkérdezi: van-e benne bármi, ami egy
hónap múlva is igaz és hasznos lesz. Legfeljebb két jegyzetet adhat vissza, és a
fordulók többségén helyesen egyet sem. Mindez soha nem a válaszod kritikus
útján történik, és egy elbukott rögzítés egy hiányzó jegyzetbe kerül, nem a
válaszodba.

A hívás előtt egyetlen hosszellenőrzés áll — a `minUserChars`-nál (alapból 40
karakter) rövidebb üzenet soha nem ér modellhívást —, plusz beszélgetésenként
legfeljebb `maxPerConversation` (20) hívás. Kulcsszólista egyik nyelven sincs.
Az egészet a `config/default.yaml`-ben a `memory.capture.enabled: false`
kapcsolja ki. A kézzel írt jegyzet és a `save_memory`-t hívó ügynök változatlanul
működik.

Ha egy tényt megismételsz, az a már meglévő jegyzetet erősíti meg, nem csinál
mellé másodikat: az új megfogalmazás dátumozott felsorolásként kerül a
`## History` alá, a régit soha nem írja felül. A szöveg még lemezre írás előtt
átmegy a privacy modulon, nem visszaolvasáskor.

**Projektmemória.** Egy projekt beszélgetéseiben tanult tény a
`projects/<projekt-id>/` alá kerül, abban a projektben az általános
referencia-jegyzetek elé sorolódik, és máshol meg sem jelenik — egy másik
projekt jegyzetei soha nem jutnak el a promptodig. A gyűjtő **General**
projekt, amelyben minden beszélgetés alapból indul, nem projektidentitás: az ott
tanult tények rólad vagy a munkamódszerről szóló tényként maradnak meg, tehát
mindenhová veled tartanak, nem tűnnek el egy gyűjtőprojektben.

Az ágensek a `search_memory`-val emlékeznek. Alap **`scope` = `current`**: ez a projekt, a típusa, plusz a globális user / feedback / reference jegyzetek — más projektek nem. `scope: all`, ha a teljes vault kell. A Memória oldal keresése (`/memory`) szűretlen.

### A capture alapból be van kapcsolva

A capture **minden** beszélgetésen fut, globálisan, hacsak a
`memory.capture.enabled: false` nincs a `config/default.yaml`-ben. Egy kis
modellhívás **a válasz kézbesítése után** csatlakozik — soha nem a kritikus
úton. A sikertelen capture hiányzó jegyzet, soha nem sikertelen beszélgetés.

| Kapu | Alap | Jelentés |
|------|------|----------|
| `memory.capture.enabled` | **be** | Főkapcsoló |
| `minUserChars` | 40 | Unicode kódpontok; rövidebb üzenet kihagyja a modellhívást |
| `maxPerConversation` | 20 | Modell-költési plafon (sikeres, unparsable és error számít; too-short skip nem) |

Nincs kulcsszólista egyik nyelven sem. A `{"notes":[]}` a gyakori és helyes
extractor-válasz (0–2 jegyzet).

### Izolált CLI — csak az EYAS memóriája

Az extraction **izolált** modellkontextusban fut: nincs host filesystem-settings,
nincs CLI-natív memória, nincsenek bridgelt toolok, egyetlen kör. A Claude Code
CLI-s beszélgetések alapból **`loadClaudeMd` ki** — nem töltik a `~/.claude`
settings-t, CLAUDE.md-t, host skilleket, projekt `.mcp.json`-t. Az izolált és
opt-out hívások `CLAUDE_CODE_DISABLE_AUTO_MEMORY` és `strictMcpConfig` flaget is
állítanak.

A Grok / Kimi (ACP) nem ad izolációs kapcsolót; a provider paneljük ezt mondja,
nem tettet. Az agenteknek csak `search_memory` / `save_memory` jár, a
fájlíró kapu tiltja a `~/.claude`, `~/.grok` és `ai-memory` utakat.

Izoláció nélkül az extractor egyszer a tulajdonos host-memóriáját olvasta,
„már rögzítve” választ adott, és az EYAS vault üres maradt. Ezt a hibát zárja.

### Capture-futás napló

Minden kimenetel, ami a kapuig eljut, `memory_capture_runs` sort ír: skip okkal,
extraction a kindokkal, plusz `provider` oszlop (`provider/model`, vagy null ha
nem hívtak modellt). Két csend szándékos: kikapcsolt capture semmit nem ír, és a
háttérfutás assistant-szöveg nélkül nem éri el a kaput. A **God Mode** körök a
saját streamjükkel térnek vissza a post-turn blokk előtt, ezért sem jegyzetet,
sem sort nem írnak.

---

## Shared memory blockok (ágens toolok)

Az öt szintű UI mellett az ágensek **scoped memory blockokat** használhatnak (Letta-stílus):

| Scope | Kik között |
|-------|------------|
| **company** | Egész instance |
| **agent** | Egy ágens |
| **team** | Csapat orchestráció |
| **run** | Egyetlen run |

Toolok: `memory_block_read` / `memory_block_write` (append vagy replace).

## Kapcsolódó

- [Tudásbázis](/docs/hu/knowledge/knowledge-base/)
- [Dokumentumok](/docs/hu/knowledge/documents/)
- [Projekt-wiki](/docs/hu/knowledge/client-wiki/)
- [Providerek](/docs/hu/ai/providers/) (CLI-izoláció / `loadClaudeMd`)
- [Toolok](/docs/hu/automation/tools/)
