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
