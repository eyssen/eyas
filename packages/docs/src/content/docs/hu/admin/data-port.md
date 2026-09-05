---
title: Adatimport és -export
description: Import varázsló memóriához, készségekhez és workspace-szabályokhoz — scan, kijelölés, jóváhagyás.
---

**Mire való.** Az adatport az **import varázsló**. Szerverútvonalat vagy feltöltött zip/markdownot szkennel másik asszisztensből (Claude Code, Cursor, Obsidian, chat-export, korábbi EYAS-export), és javasolja, hova kerüljön. A memória alkalmazódhat; a workspace-szabályok és az identity **csak javaslat**, amíg nem hagyod jóvá a merge-t. Nem teljes DB-dump — helyreállításhoz [Mentés](/docs/hu/admin/backup/). Az export még **Hamarosan**.

**Helye:** Beállítások → **Adathordozhatóság** kártya. *Memória, készségek és szabályok importja korábbi AI-rendszerekből. Az export később jön.*

## Mikor használd

- Tartós jegyzeteket hozol `~/.claude`-ból vagy Obsidian `ai-memory` vaultból az EYAS-ba (az egyetlen memória, amit a későbbi fordulók olvasnak).
- Egyedi készségek Claude/Cursorban — itt **saját** kategória.
- Agent workspace-szabályok/identity merge-javaslatként, soha auto-felülírva.
- Korábbi export zip, fájlmásolás nélkül.

## Tipikus folyamat

1. **Beállítások** → **Adathordozhatóság** → **Adat importálása…**
2. **Forrásrendszer** (**Automatikus felismerés**, Claude Code, Cursor, Obsidian, generic markdown, chat-export, eyas-export).
3. **Szerverútvonal** (abszolút ezen a gépen) **vagy** **Fájl választása…**. Opcionális **Utasítások**.
4. **Szkennelés**. Csoportok (Memória, Készségek, Szabályok, Identitás, Tudás, Ismeretlen, Kihagyott/zaj). Jelöld, mit tartasz.
5. **N tétel importálása**. Memória/készségek alkalmazódnak; szabályok/identity **Workspace-változási javaslatok** — **Merge jóváhagyása** vagy **Elutasítás**.

## Funkciók

| Képesség | Jelentés |
|----------|----------|
| Import | Szerverútvonal és/vagy feltöltés (zip) |
| Célok | Memória (többszintű), készségek, agent workspace szabályok/identity |
| Merge | Szabályok/identity **csak javaslat** |
| Nyelv | Az importált memória megtartja a forrásnyelvet |
| Készség kategória | Importált → **saját** |
| Export | **Hamarosan** — `eyas-export-v1` csomag (vault, készségek, workspace-ek) |

Nem kell tökéletes mappát választani. **Home** scanen az importer az asszisztens-mappákban és a **Documents**-ben marad (így eléri az Obsidian `ai-memory`-t). A `GitHub` és más forrásfákat **nem** járja be — azok kimerítenék a walkert a Documents előtt. Amit bejár, ott továbbra is **kihagyja** az egysoros `MEMORY.md` indexeket, a session-dumpokat, a termékdoksit és a repo-`AGENTS.md`-t. Az `ai-memory` / `.grok/memory` / `.claude/skills` tartós jegyzetei bemásolódnak. A vault-másolat `kind: reference`, hacsak a jegyzet egyértelműen feedback/user/project. A forrásútvonalat utána a runtime nem olvassa.

A read toolok nyitva maradnak a host memória-pathokon, hogy ez az importer bemásolhassa őket; írás/shell `~/.claude` / `~/.grok` / `ai-memory` felé tiltva. Lásd [Memória](/docs/hu/knowledge/memory/).

## Mezők és vezérlők

<h2 id="wizard">Import varázsló</h2>

Lépések: **forrás → átnézés → fut → kész**.

| Vezérlő | Jelentés |
|---------|----------|
| **Forrásrendszer** | Fenti profilok |
| **Szerverútvonal** | Abszolút. Hint: Obsidian `ai-memory`, `~/.claude/skills`, `~/.grok/memory` |
| **Archívum vagy fájl feltöltése** | ZIP vagy egy markdown/JSON |
| **Utasítások** | Opcionális |
| **Szkennelés** | Jelöltlista |
| Típus szűrő | **Összes / Memória / Készségek / Szabályok / Identitás / Tudás / Ismeretlen / Kihagyott / zaj** |
| **Mind / semmi / csoport** | Tömeges kijelölés |
| **N tétel importálása** | Háttérjob |
| Stat | **Alkalmazva / Javaslatok / Kihagyva / Hibák** |
| **Merge jóváhagyása / Elutasítás** | Workspace-javaslatok — soha auto-merge |

Üres scan: *Ebben a helyen nincs importálható.*

## Kapcsolódó

- [Memória](/docs/hu/knowledge/memory/)
- [Készségek](/docs/hu/automation/skills/)
- [Mentés](/docs/hu/admin/backup/)
- [Agentek — workspace](/docs/hu/agents/identity-workspace/)
