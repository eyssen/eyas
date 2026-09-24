---
title: Ütemező
description: Ismétlődő feladatok, agent rutinok, naptár és Gantt, és a nem futtatható feladatok.
---

**Mire való.** Az ütemező az óra: ismétlődő rendszer handlerek (mentés, karbantartás) és agent rutinok (egy agent egy prompttal, cronon). Feladatokat hozol létre, látod, mikor futottak utoljára, és elkapod azokat, amelyek soha nem fognak elindulni. Nem a Tábla — a Tábla munkaelemeket követ, ez az oldal időzítőket.

**Útvonal:** `/scheduler`. Cím: **Ütemező**. Alcím: *Ismétlődő feladatok, agent rutinok és futástörténet.* Menü: **Ütemező**.

## Mikor használd

- Azt akarod, hogy egy agent minden reggel lefuttasson egy promptot, beszélgetés megnyitása nélkül.
- Egy mentésnek vagy más rendszer handlernek cronon kell futnia, és látnod kell az utolsó/következő futást.
- Egy feladat áll, és a **Nincs handler / Soha nem indul / Nincs ütemezve** badge kell, nem egy csendes kimaradás.
- Egy rutin gondolkodjon mélyebben (vagy olcsóbban), mint az agentje szokott — állítsd be az **Erőfeszítés**t.
- Több példányos telepítésen a cluster-vezetést, a lejárt feladatokat vagy a dead-lettert nézed.

## Tipikus folyamat

1. Nyisd meg az **Ütemező** menüpontot (`/scheduler`).
2. Válaszd a **Lista**, **Gantt** vagy **Naptár** nézetet. Az idővonalas nézeteken **Nap / Hét / Hónap** zoom.
3. **Új feladat** — válaszd a **Rendszer handler** vagy **Agent rutin** típust, töltsd ki a **Név** és az **Ütemezés (cron)** mezőt, aztán a **Handler**t, agent rutinnál pedig az **Agent ID**-t, a **Prompt**ot és opcionálisan az **Erőfeszítés**t — majd **Létrehozás**.
4. Figyeld a health sávot. A **nem futtatható** badge azt jelenti, hogy a feladat a beállítása szerint nem fog lefutni; vidd fölé az egeret az okért.
5. A **Futtatás most** azonnal elindítja (egy Esemény feladat csak így fut). A **Szünet / Folytatás** az élő feladatot állítja; kattints egy feladatra az **Átütemezés**hez vagy az **Erőfeszítés** módosításához.

## Funkciók

Három nézet mutatja ugyanazokat a feladatokat: egy tábla, a múltbeli/következő futások Gantt-sávjai és egy naptár. Az **Infrastruktúra feladatok** a belső infrastruktúra-feladatokat is mutatja, de soha nem rejt el nem futtatható feladatot — egy hibás rendszerfeladat kikapcsolt szűrővel is látható marad.

**Ütemezések.** Egy feladat cron kifejezésre, fix intervallumra vagy busz-eseményre indul. Az űrlap cron kifejezést vagy egy rövidítést fogad el: `hourly`, `daily` (09:00), `weekdays` (hétfőtől péntekig 09:00), `weekly` (hétfő 09:00) és `monthly` (a hónap 1-je, 09:00). Intervallum vagy esemény triggert az API-n vagy a `schedule_create` toollal lehet beállítani; az **Átütemezés** intervallumos feladattá alakítja a feladatot, ha egész számú ezredmásodpercet adsz meg. A sor ikonja a trigger típusát mutatja.

<h3 id="agent-routines-run-in-a-conversation">Az agent rutinok beszélgetésben futnak</h3>

Egy agent rutin (**Agent rutin** típus, vagy a `schedule_create` toollal létrehozott feladat) minden végrehajtása létrehoz egy beszélgetést, és abban felügyelt, autonóm háttérfutásként futtatja a kiválasztott agentet — ugyanazzal a futtatóval, mint a táblakártyák és az újrapróbálások: az agent saját modelljén, a feladat promptjára kulcsolt teljes EYAS memória-felidézéssel, csatolt designokkal, dokumentumokkal, tartós memória-rögzítéssel és a teljességi kritikussal. Az érzékeny toolokat az [autonómia](/docs/hu/agents/autonomy/)-létra kapuzza.

- A beszélgetés azé a felhasználóé, aki a feladatot létrehozta; ha egy agent vagy a rendszer hozta létre, akkor az owneré. A címe a feladat neve, vagy *Scheduled: &lt;prompt&gt;*.
- A feladat részletpaneljén a **Korábbi futások** minden futásnál **Beszélgetés megnyitása** linket mutat, a sikertelen futásoknál is.
- Ha egy futás nem tud elindulni, az adott végrehajtás egy kóddal kezdődő okkal bukik el: `agent_unavailable` (az agent hiányzik vagy ki van kapcsolva), `over_budget`, `invalid_config`, `conversation_busy`, `conversation_forbidden`, `runner_unavailable`, `owner_unavailable`. A hibák beszámítanak a feladat egymást követő hibáinak / dead-letter korlátjába.
- **Erőfeszítés.** Egy agent rutinnak saját **Erőfeszítés**e lehet (lásd [Feladat létrehozása](#create-job)). Minden futás a feladat erőfeszítését a futás beszélgetésére írja, így a válasz erőfeszítés-chipje a feladat szintjét *beszélgetés* forrással mutatja. Az **Automatikus**ra állított feladat semmit nem ír oda: a futás az agent erőfeszítését kapja (*kolléga* forrás), különben a modell alapértékét. A szint ahhoz a modellhez igazodik, amelyen a futás ténylegesen fut.

**Frissítési megjegyzés.** Azok az agent rutinok, amelyeket akkor hoztak létre, amikor az ütemezett agent-futások még nem működtek, minden végrehajtáskor elbuktak. A frissítés után a következő indításukkor futni kezdenek — és tokent költenek. Előtte nézd át vagy szüneteltesd őket.

**Haladó (csak API).** A `conversationPolicy: 'reuse'` és egy `conversationId` értékkel rendelkező `handlerConfig` a feladatot abban a beszélgetésben futtatja újra, az új prompttal mint céllal; a beszélgetésnek ugyanahhoz a felhasználóhoz kell tartoznia, és nem futhat épp. `reuse` mellett a feladat minden futáskor beállítja annak a beszélgetésnek az erőfeszítését; Automatikus mellett a rajta kézzel vagy egy korábbi futás által hagyott szintet törli. Az olyan agent rutin létrehozását vagy szerkesztését, amelynek `handlerConfig`-jából hiányzik az `agentId` vagy a `prompt`, nem érvényes JSON, vagy érvénytelen `effort`-ot tartalmaz, az EYAS `400`-zal elutasítja. Az `effort` értéke `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, vagy `auto`/null (az agent erőfeszítése). A feladat létrehozója mindig a bejelentkezett felhasználó; a kérés törzsében küldött `createdBy` figyelmen kívül marad.

Az érvénytelen cron kifejezést és az egy másodpercnél rövidebb intervallumot az EYAS elutasítja — **Létrehozás**nál, **Átütemezés**nél és az API-n is —, az okkal az űrlapon: *„Ez az ütemezés érvénytelen, így a feladat soha nem futna le. Ellenőrizd a cron kifejezést vagy az intervallumot.”* Az **Esemény** trigger elfogadott, de az ilyen feladat magától még nem tud elindulni — **Soha nem indul** badge-et kap.

## Mezők és vezérlők

<h2 id="views">Nézetek</h2>

| Nézet | Jelentés |
|-------|----------|
| **Lista** | Feladattábla |
| **Gantt** | Idővonal-sávok |
| **Naptár** | Naptárnézet |
| Zoom **Nap / Hét / Hónap** | Gantt/naptár lépték |

<h2 id="create-job">Feladat létrehozása</h2>

Az **Új feladat** gomb az **Új ütemezett feladat** űrlapot nyitja meg:

| Mező | Jelentés |
|------|----------|
| **Rendszer handler** / **Agent rutin** | A feladat típusa |
| **Név** | Megjelenő név; az agent rutin futásainak beszélgetései ezt a címet kapják |
| **Ütemezés (cron)** | Cron kifejezés vagy rövidítés (`hourly`, `daily`, `weekdays`, `weekly`, `monthly`); alapérték `0 9 * * *` |
| **Handler** | Csak rendszer handlernél: regisztrált handler a **Handler választása…** listából |
| **Agent ID** | Csak agent rutinnál: a futtatandó agent |
| **Prompt** | Csak agent rutinnál: mit tegyen az agent — ez lesz a futás célja és a memória-felidézés lekérdezése |
| **Erőfeszítés** | Opcionális, csak agent rutinnál. Ugyanaz az **Erőfeszítés** választó, mint a beszélgetéseknél; akkor jelenik meg, amikor az **Agent ID** egy létező, bekapcsolt agent azonosítóját tartalmazza, és csak azokat a szinteket listázza, amelyeket az agent modellje kínál. Az **Automatikus** (alapértelmezett) mutatja, mit használ majd a futás — az agent saját erőfeszítését, pl. *Automatikus · Alacsony (kolléga)*, különben a modell alapértékét, pl. *Automatikus · a modell alapértéke (Közepes)*. A kiválasztott szintet a feladat minden futása használja, a modell által kínált legközelebbi szintre igazítva |
| **Létrehozás** / **Mégse** | A feladat mentése / az űrlap bezárása |

<h2 id="job-kinds">Feladattípusok</h2>

| Típus | Jelentés |
|-------|----------|
| **Rendszer handler** | Beépített karbantartó/automatizáló handler |
| **Agent rutin** | Ütemezetten futtat egy agentet egy prompttal |

<h2 id="row-actions">Feladatsorok és részletpanel</h2>

| Vezérlő | Jelentés |
|---------|----------|
| **Szüneteltetve / Fut** | A feladat engedélyezett állapota |
| **Nem futtatható badge** | A soron **Nincs handler**, **Soha nem indul** vagy **Nincs ütemezve** — nincs regisztrált handler (a modulja valószínűleg ki van kapcsolva), a trigger típusa magától soha nem indul (Esemény), vagy az ütemezés nem élesíthető (érvénytelen cron vagy egy másodpercnél rövidebb intervallum). Vidd fölé az egeret az okért. |
| **Utolsó: … / Következő: …** | Utolsó és következő indulás |
| **N futás / N hiba** | Számlálók |
| **Agent:** &lt;név&gt; | Az agent, amelyet egy agent rutin futtat |
| **Futtatás most** | Azonnali indítás; csak akkor tiltott, ha a feladatnak nincs regisztrált handlere, vagy ki van kapcsolva / dead-letter állapotú, az okkal a tooltipben. A **Soha nem indul** vagy **Nincs ütemezve** badge-es feladat is futtatható így — egy Esemény feladat csak így fut |
| **Szünet / Folytatás** | Kapcsoló |
| **Törlés** | Feladat + előzmények törlése (a *Töröljük a feladatot és az előzményeket?* kérdés után) |
| **Átütemezés** + **Alkalmaz** (részletpanel) | Új cron kifejezés vagy rövidítés, vagy egész számú ezredmásodperc intervallumhoz; az érvénytelen ütemezést az EYAS elutasítja, és az ok a mező alatt jelenik meg |
| **Erőfeszítés** (részletpanel) | Csak agent rutinnál. A változás azonnal mentődik; ha a mentés elbukik, *Mentés sikertelen* jelenik meg, és semmi nem változik |
| **Keresés…** | Lista szűrése |
| **Minden forrás** / **Minden státusz** | A lista szűkítése egy forrásra vagy egy állapotra |
| **Infrastruktúra feladatok** | A belső infrastruktúra-feladatok mutatása |
| **Mutasd csak a nem futtatható feladatokat** | Health-sáv szűrő; a **Mutasd újra az összes feladatot** visszaállítja a korábbi szűrőidet |

<h2 id="recent-executions">Korábbi futások</h2>

A feladat részletpaneljén a **Korábbi futások** listázza a korábbi futásokat — kezdés, időtartam, és ki indította (*Indította:* `system`, ha időzítő, egy agent vagy egy user id), agent rutinnál pedig **Beszélgetés megnyitása** linket a futás beszélgetéséhez (a sikertelen futásoknál is). Üres: *Még nincs futás.*

<h2 id="health">Health sáv</h2>

| Metrika | Jelentés |
|---------|----------|
| **Leader / Follower** | Cluster-vezetés (több példány) |
| **N aktív** | Aktív feladatok |
| **N fut** | Épp futó |
| **N hiba (24ó)** | Hibák az elmúlt napban |
| **N dead-letter** | Kifogyott újrapróbálások |
| **N lejárt** | Kimaradt ütemezés |
| **N nem tud futni** | Beállítás szerint nem futó feladatok |

<h2 id="legend">Jelmagyarázat (idővonal)</h2>

múlt · fut · következő · jövő · futás · esedékes

## Kapcsolódó

- [CLI / config](/docs/hu/deploy/configuration/)
- [Agentek](/docs/hu/agents/overview/)
- [Autonómia](/docs/hu/agents/autonomy/)
- [Providerek — Reasoning effort](/docs/hu/ai/providers/#reasoning-effort)
- [Mentés](/docs/hu/admin/backup/)
- [Kezdőlap](/docs/hu/daily/home/)
