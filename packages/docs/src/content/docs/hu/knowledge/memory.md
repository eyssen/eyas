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

**Ezeket még semmi nem írja automatikusan.** A vault ma pontosan azt
tartalmazza, amit szándékosan tettek bele — kézzel, vagy egy `save_memory`-t
hívó ügynökkel. Az automatikus rögzítés külön munka.

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
