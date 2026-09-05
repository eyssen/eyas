---
title: Titkok és API-kulcsok
description: Titkosított vault provider/csatorna kulcsoknak, plusz gép-API-kulcsok az EYAS API-hoz.
---

**Mire való.** Kétféle titok. A **Titkok** (`/secrets`) a titkosított kulcs-érték tár: provider API-kulcsok, csatorna tokenek, mentési cél kulcsai. Az érték sosem kerül logba. Az **API-kulcsok** (`/api-keys`) *az EYAS hívásához* kellenek, nem az Anthropichoz. A setup master jelszava titkosítja a payloadot.

## Mikor használd

- A provider kártya **Nincs API-kulcs**-ot ír — a vaultba (a provider panel is ide ír).
- Csatorna token ne YAML-ben vagy shell historyban legyen.
- CI-nek programozott hozzáférés kell — EYAS API-kulcs, egyszer másolod, később visszavonod.
- Látni akarod, **rendszer / felhasználó / agent** scope-e.

## Tipikus folyamat

1. **Titkok** (`/secrets`). **Rendszer / Felhasználó / Agent** fül.
2. **Titok hozzáadása** — név és érték. Üres: *Nincs titok ebben a hatókörben*.
3. **API-kulcsok** (`/api-keys`). **API-kulcs létrehozása** — név, opcionális lejárat napokban.
4. Másold a bannerből azonnal: *Másold most. Többé nem jelenik meg.*
5. Nem használt kulcs **Visszavonása** (nem visszavonható).

## Funkciók

A [Providerek](/docs/hu/ai/providers/)re beírt kulcs ide kerül. A [Kommunikáció](/docs/hu/communication/channels/) tokenjei is. A mentés offsite kulcsai értéknek *vagy* env névnek is beírhatók (pl. `BACKUP_S3_ACCESS_KEY`).

2FA TOTP-seed is ide (pl. `github-totp`, **Rendszer** hatókör), vagy a macOS Keychainbe (`-s <név>` / `eyas-totp-<név>`). A `browser_totp` csak a 6 jegyű kódot adja; az megy a `browser_fill`-be. A seed nincs az action cache-ben. [Browser Use](/docs/hu/automation/browser-use/).

## Mezők és vezérlők

<h2 id="secrets">Titkok (`/secrets`)</h2>

Alcím: *Titkosított kulcs-érték tár.*

| Fogalom | Jelentés |
|---------|----------|
| Master jelszó | Setup — payload titkosítás |
| Hatókör | **Rendszer / Felhasználó / Agent** |
| **Titok hozzáadása** | Név + érték |
| Oszlopok | **Hatókör**, **Modul**, **Létrehozva** |

<h2 id="api-keys">API-kulcsok (`/api-keys`)</h2>

Alcím: *API-kulcsok programozott hozzáféréshez.*

| Vezérlő | Jelentés |
|---------|----------|
| **API-kulcs létrehozása** | Új kulcs |
| Név | pl. CI/CD, CLI tool |
| Lejárat napokban | Opcionális; üres = nincs lejárat |
| **Kulcs előtag** | Létrehozás után; a teljes kulcs csak egyszer |
| **Utoljára használva / Lejár** | Használat és lejárat |
| Visszavonás | Végleges |

Üres: *Nincs API-kulcs. Hozz létre egyet a programozott hozzáféréshez.*

## Kapcsolódó

- [Setup — master jelszó](/docs/hu/setup-wizard/)
- [Providerek](/docs/hu/ai/providers/)
- [Mentés](/docs/hu/admin/backup/)
- [Csatornák](/docs/hu/communication/channels/)
- [Browser Use](/docs/hu/automation/browser-use/) (`browser_totp`)
