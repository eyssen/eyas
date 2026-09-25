---
title: Routing és költségkeret
description: Auto-routing szintek, tartalékok, háttérben futó modellhívások, költési korlátok és agentenkénti modell-hozzárendelés.
---

**Mire való.** A routing azt dönti el, *melyik* modell válaszol — melyik modellhez rögzül egy új beszélgetés, mely szintek között routolja az EYAS az Auto-ra állított beszélgetést, és melyik modellen fut az EYAS háttérmunkája. A költségkeret azt, *mennyit* költesz, mielőtt az EYAS figyelmeztet, olcsóbbra vált vagy leáll. A modell-hozzárendelés a beépített agentek alapértelmezett modelljét rögzíti a setup után. Együtt tartják vissza a több provideres példányt attól, hogy mindig a drága modellt használja, vagy csendben elfogyjon a pénz.

**Útvonal:** `/providers` (menü: **Providerek**) → **Útválasztási szintek** és **Költségkeret** fül. Modell-hozzárendelés: Beállítások (`/settings`) → **Modell-hozzárendelések** kártya.

## Mikor használd

- Az Auto-ra állított beszélgetések gyors kérdésekhez olcsó, kódhoz erősebb modellt kapjanak.
- A háttérmunka — címek, heartbeat, biztonsági bíró, memória-rögzítés — általad választott modellen fusson (a **Szívverés** szint).
- Az elsődleges felhő/CLI akadozik, és explicit **Tartalék**ot akarsz (vagy bekapcsolható auto-failovert).
- Napi/heti/havi korlát, figyelmeztetési küszöb, visszaminősítés és teljes leállás kell.
- A beépített agenteknek a varázsló után sincs modelljük — rendeld hozzá őket a Beállításokban.

## Tipikus folyamat

1. Nyisd meg a **Providerek** (`/providers`) → **Útválasztási szintek** fület.
2. Nézd meg fent a **Háttérben futó modellhívások** kártyát: a háttérmunka minden csoportjánál modellnek kell látszania, nem a *Nincs modell — determinisztikus tartalék* feliratnak.
3. Kapcsold **Be** az **Automatikus útválasztás engedélyezése** kapcsolót, ha az Auto-ra állított beszélgetéseket üzenetelemzés alapján routolhatja az EYAS (tipp: *Bekapcsolva az automatikus útválasztásra állított beszélgetés üzenetenként választ modellt. A rögzített modellű vagy a kolléga alapértelmezését követő beszélgetéseket sosem irányítja át.*).
4. Szintenként állítsd be az **Elsődleges** providert és modellt, az opcionális **Tartalék**ot és a szint alapértelmezett **Erőfeszítés**ét.
5. Nyisd meg a **Költségkeret** fület: a **Költési korlátok** alatt töltsd ki a **Napi / Heti / Havi** mezőt, a **Küszöbök** alatt a **Figyelmeztetés / Visszaminősítés / Teljes leállás** mezőt.
6. Nyisd meg a **Beállítások** → **Modell-hozzárendelések** kártyát, rögzíts providert és modellt minden seed agentnél, majd **Hozzárendelések mentése**.

## Funkciók

<h3 id="auto-failover">Providerek közötti auto-failover (bekapcsolható)</h3>

Ha az **auto-failover** be van kapcsolva (`EYAS_AUTO_FAILOVER=1`, vagy `model.autoFailover: true` a konfigurációban), induláskor egy második élő provider tölti ki az üres **Tartalék** helyeket a szinteken. **Az általad beállított tartalékot soha nem írja felül.**

Ez akadozó elsődleges felhő/CLI esetén ad ellenálló képességet; költség- és minőségkontroll miatt továbbra is inkább a magad választotta tartalékot használd.

Az agent-szintű havi tokenkeret ettől külön van (az agent **Beállítások** fülén).

<h3 id="default-binding">Melyik modell válaszol, ha semmi nem nevez meg egyet</h3>

Egyes EYAS-hívások nem neveznek meg sem providert, sem modellt: egy új beszélgetés első üzenete (a beszélgetés utána megtartja azt a modellt — lásd [Beszélgetések — Melyik modell válaszol](/docs/hu/daily/conversations/#which-model-answers)), a design AI-szerkesztései, és azoknak az agenteknek a futásai, amelyeknek nincs modelljük. Ezek a **telepítés alapértelmezéséhez** mennek, ebben a sorrendben:

1. a **Normál** útválasztási szint, ha a providere engedélyezve van;
2. különben a telepítés alapértelmezett providere és modellje — ezt a [setup varázslóban](/docs/hu/setup-wizard/) az **Elsődleges CLI** kiválasztása állítja be, vagy a `PUT /api/v1/model/defaults`;
3. különben az az engedélyezett provider, amelyik ábécérendben elsőként jön, és van legalább egy engedélyezett modellje.

Név szerint egyik provider sem élvez előnyt, és az sem számít, milyen sorrendben indulnak a providerek. Ha ezek egyike sincs meg, a hívás találgatás helyett elbukik: *No default model binding: configure the Standard tier or a default provider*. A korábbi verziók az ilyen hívásokat az Anthropichoz küldték, ha be volt állítva, különben ahhoz a providerhez, amelyik épp elsőként regisztrált — így egy Normál szint nélküli, több provideres telepítésen ezek a hívások most más providerhez mehetnek, mint korábban. A Normál szint (vagy az alapértelmezett provider) beállításával ez szabályozható.

<h3 id="background-model">A háttérmodell</h3>

Az EYAS háttérmunkája soha nem azon a provideren fut, amelyet a gateway épp kiválaszt. Egyetlen feloldón megy át, amely rögzített jelölteket próbál sorban, és csak olyan modellt használ, amely **izolált** hívást tud futtatni — toolok nélkül, egy körben, a CLI saját memóriája és konfigja nélkül. Jogosult minden API provider, a Claude Code, valamint a Grok CLI / Kimi Code CLI, miután az EYAS ellenőrizte az izolációjukat ezen a hoston. Az izolálni nem képes CLI-t az EYAS soha nem használja, sem jelöltként, sem egy szint **Tartalék**aként.

| Háttérmunka | Jelöltek, sorrendben |
|-------------|----------------------|
| Beszélgetéscímek | Csak a **Szívverés** szint — soha nem a beszélgetés saját modellje vagy más provider |
| Memória-rögzítés, éjszakai konszolidáció, a reflexiós briefing, a heartbeat-briefing, Self-learning javaslatok, Forge-javaslatok, skill-írás, Data port dúsítás | **Szívverés** szint (elsődleges, majd tartalék) → telepítés alapértelmezése → API providerek ábécérendben → izolált hívásra képes CLI-k |
| Biztonsági bíró, teljességi kritikus, rubrika-terv összetett háttércélokhoz | **Szívverés** → **Gyors** → telepítés alapértelmezése → többi jogosult provider |
| Csapatjavaslat és a fázisok közötti újratervező | **Gyors** → **Normál** → telepítés alapértelmezése → többi jogosult provider |
| Kutatás (lekérdezésbővítés, forráspontozás, írás, keresztellenőrzés) | **Normál** → telepítés alapértelmezése → API providerek → izolált hívásra képes CLI-k |
| Auto-routing osztályozó | Csak az **Osztályozás** szint (elsődleges, majd tartalék) — lásd [Auto-routing](#auto-routing) |

Második jelöltet csak hálózati, időtúllépési, túlterheléses vagy rate-limit hiba után próbál az EYAS, soha nem azután, hogy az első már válaszolt (a gyakorlatban csak a biztonsági csoport próbál ilyet). A költségkeret **leállás** állása azt jelenti, hogy egyáltalán nincs hívás.

<h4 id="background-effort">A háttérhívások erőfeszítése</h4>

Minden háttérhívás azt a gondolkodási erőfeszítést kéri, amely a céljához tartozó első útválasztási szinten van beállítva: a **Szívverés** szintét a memóriamunka, a tanulási munka, a címek és a biztonsági ellenőrzések; a **Gyors** szintét az újratervezés és a csapatjavaslatok; a **Normál** szintét a kutatás; az **Osztályozás** szintét az Auto-routing osztályozója. Ugyanaz a szint-erőfeszítés érvényes, bármelyik modell válaszol végül — a szint saját modellje, a telepítés alapértelmezése, egy API provider vagy izoláltan futni képes CLI —, és az EYAS ehhez a modellhez igazítja: a nem támogatott szint a legközelebbi elfogadottra kerül. Az Osztályozás, a Gyors és a Szívverés alapértéke *Alacsony*, így alapból a legtöbb háttérhívás Alacsonyt kér; a kutatás a Normál szintet követi, amelynek alapértéke Automatikus. Az Automatikusra állított szint nem küld erőfeszítés-paramétert. Ha a modellnek nincs erőfeszítés-vezérlése, vagy az EYAS nem tudja megállapítani, melyik modell válaszol (konkrét modell nélkül hívott CLI, ami csak CLI-s telepítéseken gyakori), semmi nem megy ki, és a modell saját alapértéke érvényes.

<h4 id="background-traced">Trace-elve és elszámolva</h4>

Minden háttérhívás ugyanúgy trace-elődik, mint egy beszélgetéskör — provider, modell, tokenek, költség, késleltetés, a célja, a kért és a tényleges erőfeszítés —, és a költsége ugyanúgy beszámít a költségkeret napi, heti és havi korlátaiba, mint a beszélgetésköröké. Az a háttérhívás, amely azért nem futhatott le, mert nem volt jogosult modell, nem hív modellt: nem hagy trace-t, és nem kerül semmibe. Lásd [Observability — Használat](/docs/hu/admin/observability/#usage-tab).

Minden háttérhívás valódi rendszerpromptként küldi az utasításait, és pontosan egy user üzenetet, minden providernél — soha nem user- vagy assistant-sorként.

<h4 id="background-no-model">Ha egyik modell sem jogosult</h4>

Például csak Grokos vagy csak Kimis telepítésen, amíg az izolációjuk nincs ellenőrizve, az EYAS nem hív modellt, és minden funkció a determinisztikus eredményét tartja meg: az első üzenet kivonata marad a cím; a heartbeat a *Heartbeat: items may need your attention* riasztást küldi az okok listájával; a Self-learning az általános javaslatait mutatja; a Forge megtartja az összefűzött javaslatot; a Skill Evolution a sablon `SKILL.md`-t írja; a memória-rögzítés kihagyást rögzít; a konszolidáció egy későbbi éjszakára hagyja a klasztereket; a briefing a determinisztikus részét tartja meg; a biztonsági bíró a te jóváhagyásodra eszkalál; a kritikus a futást *Nem ellenőrzött*-nek jelöli; a csapatjavaslat egyetlen agent; a kutatás a legjobb forrásokból állítja össze a jelentést. Ha a Claude Code az egyetlen modell, minden ilyen hívás egy rövid, izolált Claude Code folyamatot indít.

<h3 id="background-model-calls-card">A Háttérben futó modellhívások kártya</h3>

Az **Útválasztási szintek** fül egy **Háttérben futó modellhívások** kártyával nyílik. Megmutatja, hová megy most az EYAS háttérmunkája, anélkül hogy modellt hívna. Csoportonként egy sor van:

| Csoport | Mit fed le |
|---------|------------|
| **Memória: rögzítés, konszolidáció, reflexió, importált adatok kiegészítése** | Rögzítés, éjszakai konszolidáció, a reflexiós briefing, Data Port import-dúsítás |
| **Tanulás: szívverés, öntanulás, Forge, skillek írása** | A heartbeat, Self-learning, Forge, skill-írás |
| **Beszélgetéscímek** | Automatikus címek |
| **Biztonság: biztonsági bíráló, teljességi ellenőr, célrubrika** | Biztonsági bíró, teljességi kritikus, célrubrika |
| **Tervezés: csapatjavaslat, újratervező** | Csapatjavaslat, a fázisok közötti újratervező |
| **Kutatás** | Kutatási futások |
| **Automatikus útválasztás (triázs)** | Az Auto-routing osztályozója |

Minden sor vagy azt a providert és modellt mutatja, amelyet a csoport következő hívása használna, *Provider · Modell* alakban, egy badge-dzsel arról, honnan jött — **Szint** (a csoport útválasztási szintje, elsődleges, majd tartalék), **Alapértelmezett** (a telepítés alapértelmezése), **API-szolgáltató**, vagy **Izolált CLI** (izolált hívásra képes CLI; csak a provider nevét mutatja, mert a saját alapértelmezett modelljét futtatja) —, vagy a **Nincs modell — determinisztikus tartalék** feliratot az okkal:

- *Egyik szolgáltató sem tud izolált hívást futtatni* — semmi jogosult nincs engedélyezve, például csak Grokos vagy csak Kimis telepítésen, mielőtt az EYAS ellenőrizte az izolációjukat, vagy egy szint ilyen CLI-t nevez meg;
- *A szintje nincs beállítva* — csak a címeknél és az osztályozásnál, amelyek kizárólag a saját szintjüket használják;
- *Elérte a költségkeretet* — a költségkeret leállása minden háttérhívást blokkol.

A kártya az első jelöltet mutatja. Ha bármelyik csoportnak nincs jogosult providere, egy piros sáv jelzi, hogy néhány háttérfeladatnak nincs használható modellje, ezért a beépített tartalékával fut, modellhívás nélkül, és arra kér, hogy engedélyezz egy API-szolgáltatót vagy egy olyan CLI-t, amelynek izolációját az EYAS ellenőrizte. A hiányzó szint vagy a költségkeret-leállás az okát a sorban mutatja, sáv nélkül. A kártya frissül, valahányszor megnyitod az Útválasztási szintek fület, és az ott végzett minden szintváltoztatás után.

**API (integrátoroknak).** A `GET /api/v1/routing/auxiliary` (Settings olvasási jog; `401`, ha nem vagy bejelentkezve, `403` a jog nélkül) ezt adja vissza: `{ groups: [ { group, purposes, target: { provider, model | null, route } | null, reason | null } ] }` — a `group` értéke `memory`, `learning`, `title`, `safety`, `planning`, `research` vagy `triage`; a `route` értéke `tier`, `default`, `api` vagy `isolated-cli`; a `reason` értéke `no_eligible_provider`, `tier_not_configured` vagy `budget_stop`. `503`-at csak akkor ad, ha a háttérmodell-szolgáltatás nem érhető el. A háttérhívások a céljukkal felcímkézve jelennek meg az [Observability](/docs/hu/admin/observability/) trace-ekben.

## Mezők és vezérlők

<h2 id="auto-routing">Auto-routing</h2>

| Vezérlő | Jelentés |
|---------|----------|
| **Automatikus útválasztás engedélyezése** Be/Ki | Engedélyezi az Auto-routingot az Auto-ra állított beszélgetéseknek. Más beszélgetéseket nem routol |
| Tipp | *Bekapcsolva az automatikus útválasztásra állított beszélgetés üzenetenként választ modellt. A rögzített modellű vagy a kolléga alapértelmezését követő beszélgetéseket sosem irányítja át.* |

**Csak az Auto-ra állított beszélgetéseket routolja az EYAS.** A beszélgetés megtartja a modellt, amelyen fut: a rögzített modellt vagy a kolléga modelljét soha nem osztályozza. Az Auto-ra állított beszélgetés üzenetét osztályozza, és a **Gyors**, **Normál**, **Összetett** vagy **Kódfuttatás** szintre routolja. Amíg a kapcsoló ki van kapcsolva, az Auto beszélgetés a tárolt modelljét használja, és ezt jelzi is. Ha minden szint ugyanarra a modellre mutat (például egyetlen CLI-s telepítésen), egyáltalán nincs osztályozás. Az Auto-routingot beszélgetésenként a felső sáv modellválasztójában választod; a bejegyzés szürke, amíg az **Automatikus útválasztás engedélyezése** ki van kapcsolva. Lásd [Beszélgetések — Melyik modell válaszol](/docs/hu/daily/conversations/#which-model-answers).

**Az osztályozó.** Előbb a kulcsszószabályok jönnek, és ezek ingyenesek: az általuk besorolt üzenet (például fordítás, kódreview vagy hibakeresési kérés) nem hív modellt. Csak az általuk be nem sorolható üzenet megy az **Osztályozás** szint modelljéhez — az elsődlegeshez, vagy ha az nem használható, a tartalékhoz, és csak akkor, ha az a provider izolált hívást tud futtatni. Soha nem esik vissza a Normál szintre, a telepítés alapértelmezésére vagy más providerre. A hívás izolált (toolok, provider-memória vagy -konfig nélkül, session megtartása nélkül), csak az üzenet első 500 karakterét küldi, ugyanazon az adatvédelmi maszkoláson és tracingen megy át, mint minden más modellhívás, és beszámít a költési korlátokba. Ha nincs ilyen modell, a költségkeret elérte a teljes leállást, vagy a válasz nem érvényes kategória és komplexitás, a kulcsszavas osztályozás dönt, és a kör nem késik. Csak Claude Code-os telepítésen egy Auto beszélgetés be nem sorolt üzenete a válasz kezdete előtt még kivár egy rövid, izolált Claude Code hívást.

<h2 id="tiers">Útválasztási szintek</h2>

Minden szintnek van **Elsődleges** providere és modellje, és opcionális **Tartalék**a:

| Szint | Tipikus használat |
|-------|-------------------|
| **Osztályozás** | Az Auto-routing osztályozója azokhoz az üzenetekhez, amelyeket a kulcsszószabályok nem tudnak besorolni (csak elsődleges és tartalék) |
| **Gyors** | Gyors, olcsó válaszok |
| **Normál** | Alap minőség — egyben a telepítés alapértelmezése a modellt meg nem nevező hívásokhoz ([fent](#default-binding)) |
| **Összetett** | Nehéz feladatok |
| **Kódfuttatás** | Kódolós munka |
| **Szívverés** | Az első választás az EYAS háttérmunkájához — címek (az egyetlen jelölt), heartbeat, memória-rögzítés, biztonsági bíró és továbbiak ([fent](#background-model)) |
| **Beágyazás** | Csak a régebbi vault- és epizodikus keresőindexet táplálja. A memória-felidézés soha nem használja: a felidézés mindig helyben ágyaz be (lásd [Memória — A vektoros keresés mindig helyben fut](/docs/hu/knowledge/memory/#vector-search-always-runs-locally)). Ha a szint olyan providert nevez meg, amely nem tud beágyazni, az index is a helyi beágyazót használja; ha az index beágyazója megváltozik, az index egyszer kiürül, és automatikusan újraépül |
| **Prompt-javító** | A beszélgetés composerének Prompt Enhancere és a projektek és agentek Prompt coach-a ([Promptok](/docs/hu/ai/prompts/)) |

| Mező | Jelentés |
|------|----------|
| **Válassz providert…** | A szint elsődleges providere |
| **Válassz modellt…** | Elsődleges modell |
| **Tartalék** (**Válassz tartalékot…** / **Nincs**) | Ha az elsődleges elhasal |
| **Erőfeszítés** | A szint alapértelmezett gondolkodási erőfeszítése (a **Beágyazás** kivételével minden szintnél) — lásd [lent](#tier-effort) |

Kimi Code CLI-s telepítésen azok a szintek, amelyeket maga az EYAS állított a kivezetett *Kimi Code CLI (K3)*, *(K2.7 Code)* vagy *(K2.6)* sorokra, induláskor a **Kimi Code CLI** (alapértelmezett) sorra kerülnek át, hiszen mindig is azt futtatták; egy új, csak Kimis telepítésen minden szint ezen indul, tartalék nélkül. Lásd [Providerek — Kimi modellek és thinking](/docs/hu/ai/providers/#kimi-models-and-thinking).

<h3 id="tier-effort">A szint alapértelmezett erőfeszítése</h3>

A **Beágyazás** kivételével minden útválasztási szintnek van **Erőfeszítés** választója: az adott szintre routolt hívások alapértelmezett gondolkodási erőfeszítése. Az **Osztályozás**, a **Gyors** és a **Szívverés** alapértéke *Alacsony*, minden más szinté *Automatikus* (a modell saját alapértéke). A választó csak azokat a szinteket listázza, amelyeket a szint modellje elfogad; ha olyan modellt választasz, amely nem kínálja a mentett szintet, az mentés előtt módosul, és ezt a felület jelzi (*Az erőfeszítés … helyett … lett*), a modell által el nem fogadott szintet pedig elutasítja: *A modell nem kínálja ezt az erőfeszítési szintet. Semmi sem mentődött.*

A szint alapértelmezése két helyen érvényes:

- **A szinten át routolt üzenetnél**, ha a sorrendben feljebb semmi nem állít be szintet: a beszélgetés saját szintje > Mély (Maximális) > kolléga > delegáló beszélgetés > útválasztási szint > a modell alapértéke.
- **Az EYAS háttérhívásainál**, amelyeknek ez az első szintjük — Szívverés a memóriának, a tanulásnak, a címeknek és a biztonsági ellenőrzéseknek; Gyors az újratervezésnek és a csapatjavaslatoknak; Normál a kutatásnak; Osztályozás az osztályozónak ([fent](#background-effort)).

Egy szint erőfeszítésének módosítása tehát a szinten routolt üzeneteket és az azt használó háttérhívásokat is módosítja. A meglévő telepítések a frissítés utáni első induláskor egyszer megkapták az *Alacsony* alapértéket; ha egy szintet később visszaállítasz Automatikusra, az Automatikus marad. A `PUT /api/v1/routing/tiers/:tier` validálja a törzsét: ismeretlen szintre `404` a válasz, olyan erőfeszítésre pedig, amelyet a szint modellje nem fogad el, `400` az `EFFORT_UNSUPPORTED` kóddal és az elfogadott szintekkel. Lásd [Providerek — Reasoning effort](/docs/hu/ai/providers/#reasoning-effort).

<h2 id="budget">Költségkeret</h2>

| Mező | Jelentés |
|------|----------|
| **Napi / Heti / Havi** (**Költési korlátok**) | Dollárkorlát az időszakra; üresen *korlátlan* |
| **Figyelmeztetés** (**Küszöbök**) | Figyelmeztetési küszöb a korlát törtrészeként (százalékként is látszik; alapérték 0,8 = 80%) |
| **Visszaminősítés** | Váltás olcsóbb modellekre (alapérték 1,0 = 100%) |
| **Teljes leállás** | További költés tiltása, a háttérhívásokat is beleértve (alapérték 1,2 = 120%) |

<h2 id="model-assignments">Modell-hozzárendelések (Beállítások)</h2>

A varázsló opcionális AI-modellek lépésének hitelesített megfelelője (az a lépés a setup befejezése után zárolt).

| Vezérlő | Jelentés |
|---------|----------|
| Agent neve | Beépített / seed agent |
| Modellválasztó | **— nincs —** vagy egy engedélyezett provider modellje, *Provider / modell* alakban |
| **Hozzárendelések mentése** | PUT `/api/v1/model/agent-assignments` (`manage Model`) |

A mentés a providert és a modellt együtt tárolja, így egy modellazonosító, amelyet két provider is listáz, soha nem kétértelmű. Az API a `{assignments: {agentId: {providerId, modelId}}}` vagy a régebbi `{agentId: modelId}` alakot fogadja; az utóbbinál a több provider által listázott modellazonosító provider nélkül tárolódik. Ha bármelyik modell nincs a katalógusban, a válasz `400` a `code: unknown_model` kóddal és az `agents` listával, és semmi nem íródik ki.

A kártya elrejtőzik, ha még nincs seed agent vagy modell.

## Kapcsolódó

- [Providerek](/docs/hu/ai/providers/)
- [Observability](/docs/hu/admin/observability/)
- [Agentek — tokenkeret](/docs/hu/agents/configure/)
- [Promptok](/docs/hu/ai/prompts/)
- [Proaktív](/docs/hu/automation/proactive/)
