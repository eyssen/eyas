---
title: Mentés és visszaállítás
description: Teljes restore-archívum helyben, majd opcionális offsite feltöltés (S3/B2, FTP, Dropbox, SSH).
---

**Mire való.** A mentés **teljes restore-csomagot** épít üres gépre: `data/` (DB, `master.key`, agentek, vault…), `config/`, `.env`, `version.json` — nem `backups/`, tmp, runtime log. Visszaállítás **ugyanarra a termékverzióra**, üres telepítésre. Az archívum először helyben íródik; a **elsődleges** offsite cél aztán feltölti.

**Útvonal:** `/backup`. Cím: **Mentés és helyreállítás.** Menü: **Mentés**.

## Mikor használd

- Tarball, amit üres, **azonos** EYAS verziójú telepítésre kicsomagolhatsz.
- Offsite: S3-kompatibilis (AWS, Backblaze B2, R2, MinIO), FTP/FTPS, Dropbox vagy SSH/SFTP.
- Az önfrissítés működő Mentést követel — a Beállítások blokkol, amíg nincs archívum.

## Tipikus folyamat

1. **Mentés** (`/backup`).
2. Opcionális **Cél hozzáadása** **Offsite célok** alatt. Típus, kapcsolat, titkok (kulcs *vagy* env név), **Cél mentése**, **Feltöltéshez** elsődlegesnek.
3. **Mentés készítése**. Sor: fájlnév, EYAS verzió, méret, **Feltöltve** vs **Csak helyi**.
4. Restore: a táblában lévő verzió (`install.sh --version …`), **stop**, `tar -xzf` a telepítés gyökerében, `chmod 600 data/master.key .env`, `eyas start`.
5. In-app **Visszaállítás** felülírja a jelenlegi adatot (megerősítés). Teljes újjáépítéshez az üres-rendszeres út.

## Funkciók

| Fogalom | Jelentés |
|---------|----------|
| Helyi mentés | Archívum `data/backups/` alatt |
| Távoli cél | Feltöltés a helyi írás után |
| Verziópin | Ugyanaz a verzió restore előtt |
| Elsődleges | A feltöltéshez használt cél |

**A CLI-bejelentkezések benne vannak az archívumban.** A Grok CLI és a Kimi Code CLI EYAS-os bejelentkezése a `data/cli-homes/grok-cli/.grok/auth.json` és a `data/cli-homes/kimi-cli/.kimi/credentials/kimi-code.json` fájlban van, így az adatkönyvtár mentése ezeket is tartalmazza. Kezeld az archívumot hitelesítő adatként, mint a `master.key`-t. Lásd [Providerek — Bejelentkezés a Grokba és a Kimibe az EYAS számára](/docs/hu/ai/providers/#sign-in-grok-and-kimi-for-eyas).

Üres: *Még nincs mentés.*

### Ami kimarad az archívumból

| Nincs az archívumban | Miért / mi a teendő |
|----------------------|---------------------|
| `backups/`, tmp, futási pid és log | Az újjáépítéshez nem kell |
| CLI session-tárak a `data/cli-homes/*/sessions` alatt | Eldobható CLI-átiratok, amelyeket az EYAS soha nem folytat (és minden kör után törli is őket) |
| Beszélgetés-workspace-ek az adatkönyvtáron kívül | Git clone-ból futó forrástelepítésen, vagy beállított `EYAS_WORKSPACES_DIR` mellett a workspace-ek a `data/`-n kívül vannak (lásd [Konfiguráció — Beszélgetés-workspace-ek](/docs/hu/deploy/configuration/#conversation-workspaces)). Az agentek kimeneti fájljai ettől még megmaradnak: beszélgetés-csatolmányként a Dokumentumokba másolódnak, azok pedig mentésre kerülnek. |
| `EYAS_DATA_DIR`-rel áthelyezett adatkönyvtár | Az archívum a `<EYAS home>/data`-t fedi le. Ha az `EYAS_DATA_DIR` máshová mutat, azt a mappát — benne az adatbázissal és a memória-vaulttal — vedd fel a saját mentéseid közé. |

**Üres rendszeres visszaállítás:** 1) azonos verzió  2) szerver leállítás  3) `tar -xzf`  4) `chmod 600 data/master.key .env`  5) `eyas start`.

## Mezők és vezérlők

<h2 id="archives">Archívum tábla</h2>

| Oszlop | Jelentés |
|--------|----------|
| **Fájlnév** | Archívum |
| **EYAS verzió** | Erre pindd a restore-t |
| **Létrehozva** | Mikor |
| **Méret** | Bájt |
| **Offsite** | **Feltöltve** / **Csak helyi** |
| **Visszaállítás** | Jelenlegi adat felülírása |

<h2 id="destinations">Offsite célok</h2>

Alcím: *Minden mentés először helyben íródik, aztán az elsődleges célra töltődik (S3/B2, FTP, Dropbox vagy SSH).*

| Típus | Beállítások | Titkok |
|-------|-------------|--------|
| **S3-kompatibilis (AWS, Backblaze B2, R2, MinIO)** | `endpoint`, `bucket`, `region`, `prefix` | `accessKeyId`, `secretAccessKey` |
| **FTP / FTPS** | `host`, `port`, `path`, `secure` | `username`, `password` |
| **Dropbox** | `path` | `accessToken` |
| **SSH / SFTP** | `host`, `port`, `path` | `username`, `password`, `privateKey`, `passphrase` |

| Vezérlő | Jelentés |
|---------|----------|
| **Cél hozzáadása** | Űrlap |
| **Megjelenő név** | Címke |
| **Feltöltéshez** | Elsődleges |
| **Csak helyi** | Nincs offsite |
| Kapcsolati beállítások | Nem titok |
| Titkok hint | *Illeszd be a kulcsokat. Env név is lehet, pl. BACKUP_S3_ACCESS_KEY.* |

Üres célok: *Nincs távoli cél — a mentések csak a data/backups/-ban maradnak.*

## Kapcsolódó

- [Első lépések](/docs/hu/getting-started/)
- [Rendszerfrissítés](/docs/hu/admin/settings/)
- [Titkok](/docs/hu/admin/secrets/)
- [Adatimport](/docs/hu/admin/data-port/)
