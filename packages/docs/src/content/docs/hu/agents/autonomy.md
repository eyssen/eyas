---
title: Autonómia
description: Mennyit tehetnek az agentek kérdezés nélkül — jóváhagyási sor és három szint.
---

**Mire való.** Az autonómia a biztonsági szabályzó. Műveletosztályonként választasz: **Értesítés** (előbb kérdez), **Jóváhagyás** (javaslat + egy kattintás) vagy **Automatikus** (megcsinálja és jelent). A kimenő és visszafordíthatatlan műveletek Értesítés szinten zároltak. Ugyanez az oldal a **Függő jóváhagyások** sora, amely addig parkoltatja a futást, amíg nem döntesz.

## Mikor használd

- Egy beszélgetés **Jóváhagyásra vár**, és találgatás nélkül akarsz **Jóváhagyás** vagy **Elutasítás** mellett dönteni.
- A visszafordítható munka (fájlszerkesztés, kutatás) fusson **Automatikus** szinten, de egy zárolt kimenő osztályt soha ne emelj meg.
- Egy folytatás elbukott, pedig már jóváhagytad — a beragadt sor még rád vár.
- A háttérben futó önfejlesztő ciklusokat akarod be- vagy kikapcsolni (proaktív heartbeat, éjszakai önreflexió, Forge-javaslatok, öntanulás, készség-átvétel).

## Tipikus munkafolyamat

1. Nyisd meg az oldalsávban az **Autonómia** oldalt (**Megfigyelés** szakasz) — útvonal `/autonomy`. Az önfejlesztő ciklusok a **Beállítások → Rendszer** oldalon vannak, az **Autonómia és önfejlesztés** kártyán.
2. Olvasd el a **Függő jóváhagyások** listát. Minden sornál **Jóváhagyás** vagy **Elutasítás**. Ha kontextus kell, kövesd az **Erre váró futás** linket a beszélgetésbe.
3. A **Visszafordítható** csoportban állíts egy kategóriát **Értesítés / Jóváhagyás / Automatikus** szintre (a zárolt kategóriák nem mehetnek Értesítés fölé).
4. A parkolt futás folytatódik (elutasításnál leállva marad). A Kezdőlap **Figyelmet igényel** listája és a beszélgetés **Jóváhagyásra vár** jelvénye eltűnik.

## Funkciók

Az autonómia a **felügyelet nélküli** viselkedést szabályozza: mennyit tehet egy agent műveletosztályonként, és mihez kell **emberi jóváhagyás**.

## Alapelvek

1. A háttérben futó önfejlesztő ciklusok **alapból ki vannak kapcsolva**; a bekapcsolásuk a te döntésed.
2. A jóváhagyások a Kezdőlap **Figyelmet igényel** listájában és a beszélgetés **Jóváhagyásra vár** jelvényeként jelennek meg.
3. Hogy egy agent közvetlenül szerkesztheti-e a saját IDENTITY-jét, az egy YAML-beállítás: `autonomy.identitySelfUpdate` (alapból be). Ha ki van kapcsolva, az identitásváltozások Forge-javaslatként mennek.

## Jóváhagyási sor és szintek

**Útvonal:** `/autonomy`. Az alcím elmondja, hogy a visszafordíthatatlan / kimenő műveletek **Értesítés** szinten zároltak, és nem emelhetők — ez egy biztonsági alsó korlát.

### Függő jóváhagyások

| Vezérlő | Jelentés |
|---------|----------|
| **Függő jóváhagyások** | A parkolt kérések sora |
| *Semmi sem vár jóváhagyásra.* | Üres sor |
| Kategória · eszköz | Mire kér engedélyt |
| Indok | Miért lépett közbe a kapu |
| **Erre váró futás** | Link a parkolt futáshoz / beszélgetéshez |
| **Jóváhagyás / Elutasítás** | Döntés — a jóváhagyás megpróbálja folytatni a futást |
| *Nem sikerült folytatni: …* | A jóváhagyásról már döntöttél, de a futás nem indult újra (beragadt folytatás) |

**Mi kerül a sorba.** Egy sárga vagy piros eszközhívás itt vár, ha a biztonsági kapu embert kér, minden providernél — beleértve azokat a hívásokat is, amelyeket egy CLI (Claude Code, Grok, Kimi) a saját eszközeivel akar végrehajtani, és azokat az EYAS-eszközöket, amelyeket a Grok vagy a Kimi az eszközhídon át hív. Felügyelt önálló futásban egy ilyen jóváhagyás szünetelteti a futást (**Jóváhagyásra vár**); jóváhagyás után a futás folytatódik, és pontosan a jóváhagyott hívás fut le egyszer.

**Ugyanazok a döntések minden providernél.** Azokról az EYAS-eszközökről, amelyeket a Grok és a Kimi az eszközhídon át ér el, pontosan úgy születik döntés, mint az API-providereknél és a Claude Code-nál. Egy általad figyelt chatben vagy egy csatornás beszélgetésben az a hívás, amelyet a kapu engedélyez, lefut: az ezen az oldalon lévő szintek a figyelt chatekre nem vonatkoznak, és egy jóváhagyást igénylőként megjelölt eszköz már nem vár itt csak azért, mert a modell Grok vagy Kimi. Háttérfutásokban (ütemezett, csapat-, pipeline-futás, vagy bármely nem figyeltként megjelölt futás) a szintek érvényesek: egy **Értesítés** vagy **Jóváhagyás** szintű kategóriába eső hívás itt vár, és egy olyan hívás, amelyet a kapu eszkalál, mindig emberre vár, akkor is, ha a kategóriája **Automatikus** szinten van — korábban egy ilyen hívás a Grokon és a Kimin kérdezés nélkül lefutott. Az agent **Eszközök** listáján kívüli eszközt az EYAS még a kapu megkérdezése előtt elutasítja, így az soha nem kerül ide. Ha a kapu AI-ellenőrzése nem tud lefutni — nincs jogosult háttérmodell, a költségkeret leállt, vagy minden próbálkozás elbukik —, a hívás letiltás helyett ide eszkalálódik (lásd [Biztonság és adatvédelem — Biztonsági bíráló](/docs/hu/admin/security-privacy/#security-judge)).

**A sandboxból kilépni kérő shell-parancs.** `security.cliSandbox: auto` mellett a Claude Code kérheti, hogy egy parancsot a kernel fájl-sandboxán kívül futtasson (például egyet, amelynek `~/.npm` kell). Egy ilyen parancs mindig ide kerül, és emberre vár — soha nem az AI-bírálóra, soha nem az autonómia-létrára, bármilyen szintű is a kategória. Az indoka: *Egy shell-parancs a kernel fájl-sandboxon kívül akar futni. Ezt csak ember engedélyezheti; a jóváhagyás pontosan ezt a parancsot engedi egyszer sandbox nélkül futni.* Az önálló futások ezen megállnak. Lásd [Providerek — Kernel fájl-sandbox](/docs/hu/ai/providers/#kernel-file-sandbox).

**Döntés a beszélgetésből.** A jóváhagyásra váró hívás *Jóváhagyásra vár* állapotban látszik, soha nem sikeresként, és a beszélgetésben jóváhagyási kártya jelenik meg **Jóváhagyás**, **Elutasítás** és **Jóváhagyások megnyitása** gombbal. A kártya ugyanazt a jogosultságot használja, mint ez a sor (jóváhagyás az Autonómián); aki nem rendelkezik vele, azt a felület tájékoztatja, hogy egy owner vagy admin itt dönthet. Lásd [Beszélgetések — Jóváhagyások a chatben](/docs/hu/daily/conversations/#approvals-in-the-chat).

### Szintek (kategóriánként)

| Szint | Címke | Tipp |
|-------|-------|------|
| 1 | **Értesítés** | Előbb kérdez |
| 2 | **Jóváhagyás** | Javaslat + egykattintásos jóváhagyás |
| 3 | **Automatikus** | Önálló + utólagos jelentés |

A kategóriák két csoportra oszlanak: **Visszafordítható** (a szint emelhető) és **Kimenő / visszafordíthatatlan (zárolt)** (nem mehet Értesítés fölé — biztonsági alsó korlát).

## Beállítások (Autonómia és önfejlesztés kártya)

A **Beállítások → Rendszer** oldalon van az **Autonómia és önfejlesztés** kártya. Minden bekapcsolt ciklus fizetős modellhívásokat indít ütemezetten (vagy eseményre), és alapból mind ki van kapcsolva:

| Kapcsoló | Jelentés |
|----------|----------|
| **Proaktív heartbeat** | Proaktív összefoglalókat állít össze, ha valami a figyelmedet igényli |
| **Éjszakai önreflexió** | Éjszakai önreflexiós kör, amely fejlesztési lehetőségeket keres az asszisztens működésében |
| **Forge-javaslatok** | A súrlódásokból tanult eszköz- és készségfejlesztéseket javasol — a jóváhagyásod továbbra is kell |
| **Öntanulás** | A használati metrikákból tanult prompt- és útválasztási finomításokat javasol — a jóváhagyásod továbbra is kell |
| **Készség-átvétel** | Az ismétlődő mintákból tanult új készségeket javasol — a jóváhagyásod továbbra is kell |

Minden kapcsoló csak funkciókapcsoló — nem töröl adatot. A módosításhoz **update Autonomy** jogosultság kell.

## Felületek a vezérlőpulton

| Felület | Jelentés |
|---------|----------|
| Kezdőlap setup-tétel: **Autonómia és önfejlesztés** | Önkéntes bekapcsolás magyarázata + link a beállítási kártyára |
| Kezdőlap **Figyelmet igényel** | Függő jóváhagyások és beragadt folytatások |
| Beszélgetés **Jóváhagyásra vár** | A futás rád vár |
| Telegram **Approve / Deny** | Ugyanaz a döntési út, mint ez a sor, sárga/piros eszközökhöz. Az értesítés a szál Telegram-hozzárendelésére megy, különben egy jóváhagyott párosításra. Nyers eszközargumentumok nélkül. Lásd [Telegram](/docs/hu/communication/telegram/#approval-ping) |

## Kapcsolódó

- [Kezdőlap](/docs/hu/daily/home/)
- [Forge](/docs/hu/agents/forge/)
- [Proaktív asszisztens](/docs/hu/automation/proactive/)
- [Biztonság és adatvédelem](/docs/hu/admin/security-privacy/)
- [Telegram](/docs/hu/communication/telegram/)
