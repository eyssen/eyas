---
title: Memória
description: Öt szintű hibrid memória — tabok, mezők és shared memory blockok.
---

**Útvonal:** `/memory`.

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

Két frontmatter-mező vezérli:

| Mező | Mit csinál |
|------|------------|
| `kind` | `user`, `feedback`, `project` vagy `reference` — egyben a rangsor is |
| `summary` | Az az egy sor, ami az indexben megjelenik |

A `user` és a `feedback` van elöl, mert ezek minden válasz elkészítését
befolyásolják. A `kind` nélküli jegyzet `feedback`, ha a `procedural/` alatt
van, egyébként `reference` — **soha nem `user`**: egy be nem sorolt jegyzetet
rólad szóló ténynek nyilvánítani annyi, mint minden prompt elejére tenni.
`summary` híján a jegyzet első valódi sora kerül be, tehát egy bármilyen
szerkesztőben kézzel írt fájl EYAS-specifikus frontmatter nélkül is működik.

Hol vannak: `data/vault/semantic/`, `data/vault/procedural/`,
`data/vault/projects/`. Írj bele egyet, és az EYAS felveszi.

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
- [Toolok](/docs/hu/automation/tools/)
