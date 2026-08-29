---
title: Tudásbázis
description: Kurált wiki, amit te szerkesztesz — space-ek, oldalak, verziók — nem automatikus memória.
---

**Mire való.** A tudásbázis a wiki, **amit te tartasz**: space-ek, oldalfa, gazdag szerkesztő, verziók, backlinkek, csatolmányok. A capture ide nem ír. Playbookokra, runbookokra, stabil referenciára való. A Memória/vault azokra a tényekre, amiket az asszisztens magától idézzen.

## Mikor használd

- Kurált oldal kell (hogyan shipelünk, ügyelet, szójegyzék), amit emberek szerkesztenek, nem chatből kinyert jegyzet.
- Space-ek és fa kellenek (mozgatás / átnevezés / törlés), nem lapos vault-fájl.
- Verziók, backlinkek vagy csatolmányok kellenek az oldalon.
- Markdown-export kell.
- A tény egy **ügyfélről** szól — az az [Ügyfél wiki](/docs/hu/knowledge/client-wiki/), nem ide.

## Tipikus munkafolyamat

1. Nyisd a **Tudásbázist** az oldalsávon (**Tartalom** szakasz) — kattints a sorra a fa kinyitásához. Útvonal `/knowledge/:pageId`.
2. **New space**, ha kell, majd **New page** alatta. A címre kattintva nevezd át.
3. Írj a szerkesztőben (eszköztár: címsorok, listák, checklist, táblázat, callout, …). Rövid szünet után autosave; a **vN** badge lép.
4. Csatolj fájlt az **Attachments** sávból, ha kell. Az oldalnak a fában és a globális keresésben kell megjelennie.

## Funkciók

**Útvonal:** `/knowledge`. Ez **explicit** tudás. Az automatikus tartós tények a [Memóriában](/docs/hu/knowledge/memory/) vannak.

### Oldalsáv fa

| Vezérlő | Jelentés |
|---------|----------|
| **Tudásbázis** | Fa kinyitása/behajtása |
| **New space** | Space létrehozása (név prompt) |
| **Search pages…** | Fa szűrése |
| **New page** | Gyermekoldal |
| **Rename / Move to… / Delete** | Oldal- vagy space-műveletek (space törlése a lapjait is viszi) |

### Oldal

| Vezérlő | Jelentés |
|---------|----------|
| Cím mező | Kattints az átnevezéshez (Enter ment, Escape visszavon) |
| **vN** | Jelenlegi verzió |
| **AI edited** | Az utolsó író a rendszer volt |
| **Export** | Markdown letöltés |
| **Width** | Teljes szélesség |
| Törlés | *Move this page to trash?* |
| Szerkesztő | BlockNote / Saker eszköztár — autosave |
| **Attachments** | Fájlok az oldalon (összecsukható) |
| **Backlinks (N)** | Ide mutató oldalak / vault-jegyzetek |
| **Versions** | Utolsó öt — **You** vs **AI**, dátum |

## Kapcsolódó

- [Memória](/docs/hu/knowledge/memory/)
- [Dokumentumok](/docs/hu/knowledge/documents/)
- [Ügyfél wiki](/docs/hu/knowledge/client-wiki/)
