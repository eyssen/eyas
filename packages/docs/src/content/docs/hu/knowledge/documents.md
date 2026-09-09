---
title: Dokumentumok
description: Fájlok feltöltése, böngészése, és hogy az agentek vissza tudják keresni a tartalmat.
---

**Mire való.** A Dokumentumok a fájlkönyvtár: PDF-ek, képek, archívumok és más blobok, amiket te (vagy egy beszélgetés / tudásoldal) csatolsz. Helyben tárolódnak (opcionális S3-szinkron), és retrievalre elérhetők. Ez nem a Tudásbázis-wiki és nem Memória-jegyzet — maga a fájl.

## Mikor használd

- PDF, kép vagy archívum van, amit az agentnek később meg kell tudnia nyitni.
- Egy headless `browser_download` épp most húzott be egy webes fájlt — itt jelenik meg, a beszélgetéshez kapcsolva. [Browser Use](/docs/hu/automation/browser-use/).
- Egy helyen akarod látni az összes fájlt, típus szerint szűrve, rács- vagy listanézetben.
- Letölteni vagy törölni akarsz, vagy látni, hol használják.
- Helyi tár vs S3-kompatibilis távoli szinkron beállítása.

## Tipikus munkafolyamat

1. Nyisd a **Dokumentumokat** az oldalsávon (**Tartalom** szakasz) — útvonal `/documents`.
2. A fájlok a beszélgetés **Attach file**, a tudás **Attachments**, vagy a feltöltőzóna (*Drop files here* / *or click to browse*) felől érkeznek.
3. Szűrj **All / Images / PDFs / Archives / Other**, keress fájlnévre, válts rács/lista nézetet.
4. Nyisd a **Beállítások → Dokumentumok** (`/documents-settings`) oldalt statisztikához vagy S3-hitelesítőkhöz. A fájlnak a könyvtárban és a keresésben kell lennie; az agent akkor tudja retrievalzni, ha a beszélgetéshez csatolva vagy indexelve van.

## Funkciók

Üres: *No documents yet.* Hint: *Files are attached from conversations and knowledge articles.*

### Könyvtár

| Vezérlő | Jelentés |
|---------|----------|
| **Grid view / List view** | Elrendezés |
| **Search files…** | Fájlnév szűrő |
| **All · Images · PDFs · Archives · Other** | MIME kategóriák |
| **Used in N location(s)** / **Unlinked** | Hol van csatolva |
| Szinkron badge | **Synced · Sync pending · Sync error · Remote storage not configured** |
| **Download** | Letöltés |
| **Delete** | Második kattintás megerősít |

### Beállítások (`/documents-settings`)

Alcím: *Storage configuration and statistics.* **Storage Statistics**, **Top File Types**, **Local Storage** (a könyvtár az EYAS data root relatív, itt csak olvasható), **S3 Remote Storage** (endpoint, bucket, region, kulcsok, **Save credentials**).

Ne keverd a [Keresési forrásokkal](/docs/hu/daily/search/) (kód/doksi fák a lemezen) vagy a [Memóriával](/docs/hu/knowledge/memory/) (tartós jegyzetek).

## Kapcsolódó

- [Keresési források](/docs/hu/daily/search/)
- [Beszélgetések — fájlcsatolás](/docs/hu/daily/conversations/)
- [Tudásbázis — csatolmányok](/docs/hu/knowledge/knowledge-base/)
- [Memória](/docs/hu/knowledge/memory/)
