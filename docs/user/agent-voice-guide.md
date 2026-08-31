# Agens hangprofil — felhasználói útmutató

> **Canonical multi-language docs:** `packages/docs/` (Starlight).
> HU page: `packages/docs/src/content/docs/hu/agents/voice.md`
> Built site: main server → `http://localhost:3100/docs/hu/agents/voice/` (or `bun run docs:dev`).
> This file is a legacy snapshot; prefer the docs for new edits.


## Mi a Voice rendszer?

Az EYAS minden ágense két különböző hangprofilban tud kommunikálni: **belső** (_internal_) és **külső** (_external_). A belső hang az, ahogy az ágens veled (és a csapat tagjaival) beszél; a külső hang az, ahogy az ügyfelekkel, ismeretlenekkel kommunikál.

A rendszer automatikusan dönt, melyik hangot kell használni az adott helyzetben — de te bármikor felülírhatod.

---

## 6 dimenzió

Minden hangprofilt 6 dimenzió határoz meg:

| Dimenzió | Lehetséges értékek |
|----------|--------------------|
| **Megszólítás** | `tegező` · `magázó` · `önöző` · `kontextus-érzékeny` |
| **Hang** | `komoly` · `kiegyensúlyozott` · `baráti` · `laza` · `játékos` |
| **Részletesség** | `lényegre törő` · `kiegyensúlyozott` · `részletező` |
| **Direktség** | `nagyon direkt` · `direkt + udvarias` · `diplomatikus` · `körülíró` |
| **Humor** | `nincs` · `száraz/szellemes` · `könnyed` · `csípős/provokatív` |
| **Emoji** | `soha` · `funkcionálisan` · `gyakran` |

---

## Presetek (8 db)

A gyors konfiguráláshoz 8 előre beállított profil érhető el. Mindkét hanghoz (belső/külső) külön presetet választhatsz.

| Preset | Megszólítás | Hang | Humor | Emoji |
|--------|-------------|------|-------|-------|
| `jarvis` | magázó | komoly | nincs | soha |
| `best-buddy` | tegező | baráti | száraz/szellemes | funkcionálisan |
| `senior-ceo` | magázó | komoly | száraz/szellemes | soha |
| `pajtas-dev` | tegező | laza | száraz/szellemes | funkcionálisan |
| `standup` | tegező | játékos | csípős/provokatív | gyakran |
| `diplomata` | önöző | komoly | nincs | soha |
| `coach` | tegező | kiegyensúlyozott | száraz/szellemes | funkcionálisan |
| `tutor` | tegező | baráti | könnyed | funkcionálisan |

Ha egyik sem passzol, válaszd a `custom` módot és állítsd be manuálisan a 6 dimenziót.

---

## Tiltott szófordulatok

Minden hangprofilhoz megadhatsz tiltott szófordulatokat — ezeket az ágensnek soha nem szabad használnia az adott hangban. Például:

- `Természetesen!` — ha túl lelkesnek tartod
- `Sajnálom` — ha nem szereted a felesleges bocsánatkérést
- `Mint egy AI, ...` — általánosan ajánlott tiltani

A tiltott szavakat a _Settings → Agents → [ágensed] → SOUL szerkesztő_ felületen adhatod meg.

---

## Override beállítások

A rendszer automatikusan választja a hangot, de 5 szinten felülírható (prioritás csökkenő sorrendben):

| Szint | Hol állítható be | Hatókör |
|-------|-----------------|---------|
| **per-message** | API paraméter | Csak az adott üzenet |
| **ephemeral-session** | API / eszközből | Időkorlátolt munkamenet (alapérték: 60 perc) |
| **per-conversation** | Beszélgetés fejléce | Az egész beszélgetés |
| **per-channel** | Settings → Csatornák | Az adott csatorna minden üzenete |
| **auto** | Automatikus | Résztvevők alapján dönt |

### Automatikus döntési logika

- Csak a **tulajdonos** vesz részt → `internal`
- Csak **tulajdonos + csapattagok** → `internal`
- Van **külső résztvevő** (known-contact vagy unknown-external) → `external`

---

## Beállítás lépései

1. Lépj a **Settings → Agents** menübe.
2. Válaszd ki az ágenst.
3. Kattints a **Voice & Soul** fülre.
4. Válaszd ki a belső és külső presetet (vagy állítsd be manuálisan).
5. Adj meg tiltott szófordulatokat igény szerint.
6. Kattints a **Mentés** gombra — a változtatás azonnal életbe lép.

> **Megjegyzés:** Ha az ágensnek engedélyezve van az önmódosítás (`identity_self_update`), akkor maga is javasolhat hangprofil-módosítást a `forge_propose_soul_change` eszközön keresztül. Az ilyen javaslatokat a rendszer értesítés formájában jelzi, és a te jóváhagyásod szükséges.
