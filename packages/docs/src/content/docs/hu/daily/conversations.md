---
title: Beszélgetések
description: Beszélj az ágensekkel — küldj munkát, csatolj designt, és irányítsd az orkesztrációt egy szálon.
---

**Mire való.** A beszélgetés az a hely, ahol az ágenssel beszélsz. Az üzenetek a fő panelen mennek; a projekt, stage, források, fájlok és a runtime a jobb sávban él. Ugyanez a szál egy Tábla-kártya, tehát a chat és a pipeline egy rekord.

## Mikor használd

- Egy ágenssel akarsz dolgozni, és egy helyen látni a választ, az eszközhívásokat és a haladást.
- Rögzíteni akarod, melyik indexelt kódfát (Odoo-verzió, addonok) keresheti ez a szál.
- Egy illeszkedő skill vár — elfogadod, erre a szálra kihagyod, vagy globálisan kikapcsolod.
- Több modellnek akarod futtatni ugyanazt a feladatot (**God Mode**), vagy specialisták csapatának szétosztani.
- Egy design-vászonnak minden körrel utaznia kell, vagy a **Prompt Enhancer**rel akarod formázni a piszkozatot küldés előtt.

## Tipikus munkafolyamat

1. Kattints az **Új beszélgetés** gombra az oldalsávon (**Fő** szakasz), vagy nyiss kártyát a **Tábláról** / a Kezdőlap **Legutóbbi beszélgetések** csempéjéről. Útvonal `/conversations/:id`.
2. Állítsd be a **Projekt**, **Stage** és **Agent** mezőket az első üzenet előtt (az ágens utána zárol). Rögzítsd a **Sources** fület, ha több Odoo-fa van indexelve.
3. Írj a composerbe. Használd a **Prompt Enhancer**t, ha a piszkozat formázásra szorul; csatolj fájlt vagy **Design**t a felső sávból.
4. Ha skill-javaslat kártya jelenik meg, válassz: **Használd**, **Most ne**, vagy **Kapcsold ki**. Küldés. A választ streamelve kell látnod; a vékony kontextus-sáv azt mutatja, mi került ténylegesen abba a körbe.

## Funkciók

Elrendezés: **üzenetek + composer** (fő) és **context rail** (chatter: jegyzetek, mezők, aktivitások, fájlok, runtime).

## Beszélgetés státusz

| Státusz | Jelentés |
|---------|----------|
| **Idle** | Nincs aktív run |
| **Working…** | Ágens fut |
| **Waiting** | Vár inputra |
| **Waiting approval** | Emberi jóváhagyásra vár |
| **Archived** | Archivált |

---

## Header / modell sáv

| Vezérlő | Jelentés |
|---------|----------|
| **Provider…** | Provider felülírás ehhez a szálhoz |
| **Model…** | Modell felülírás (különben ágens default / auto-routing) |
| **Auto-routing** | A router választ |

A header feletti vékony sáv kattintható: megnyitja az adott kör **Kontextus-összeállítás** paneljét — milyen szekciók kerültek a promptba, milyen sorrendben lettek összeállítva, mekkora méretben, csonkítva lettek-e, és a nyers tartalmuk. Ez körönkénti nézet, nem a teljes beszélgetés összesítése. A sávon megjelenő szám is jelentést váltott: most azt mutatja, mennyi kontextus lett ténylegesen összeállítva ehhez a körhöz — nem a bemenet+kimenet halmozott összegét, ami túlbecsülte a kihasználtságot, és hosszú beszélgetésnél 100%-on ragadt. Ha erre emlékszel, a mostani kisebb szám a javítás, nem hiba.

---

## Prioritás (top bar)

**Low / Normal / High / Urgent** — üzleti prioritás (a Táblán is látszik).

---

## Beszélgetés mezők

| Mező | Jelentés |
|------|----------|
| **Project** | Tulajdonos projekt (`None` = nincs). Project váltáskor a **project alapértelmezett kódforrásai** kerülnek a Források fülre (ha nincs külön explicit pin a kérésben). |
| **Stage** | Stage a projekt pipeline-ban |
| **Agent** | Hozzárendelt ágens — **az első üzenet után zárolt** |
| **Effort** | Off / Low / Medium / High / Max — gondolkodási mélység vs költség |
| **Orchestration** | **Solo** = nincs sub-agent; **Auto** = a modell dönt; **Deep** = agresszív fan-out. Utolsó tétel: **God mód** — lásd [God mód](#god-mód). |

---

## Üzenetfolyam

| Vezérlő | Jelentés |
|---------|----------|
| **Start a conversation…** | Üres állapot |
| **Thinking… / Composing…** | Modell dolgozik / streamel |
| **Stop** | Run megszakítása |
| **Background working…** | Elhagytad az oldalt; a válasz később jelenik meg |
| Tool **Input / Output / Error** | Tool hívás részletei |
| **Turn N / Max**, **tokens**, **Cancel** | Agent progress |
| **Simple / Managed / Autonomous / Wizard** | Komplexitás jelző |
| **Voice INTERNAL/EXTERNAL/AUTO** | Hangprofil scope (+ force override) |

---

## Composer

| Vezérlő | Jelentés |
|---------|----------|
| **Type a message…** | Üzenet (`Shift+Enter` = új sor) |
| **Attach file** | Csatolmány a következő üzenethez |
| **Prompt Enhancer** | Iteratív prompt finomítás Apply előtt |

### Prompt Enhancer

Iteratív coach, ami a **beszélgetés modellcsaládjához** (Claude, OpenAI, Gemini, Grok, Kimi, …) alakítja a promptot küldés előtt.

| Vezérlő | Jelentés |
|---------|----------|
| Draft / cél | *Type a prompt draft or a goal…* |
| **Optimized for …** | Cél modellcsalád badge (Provider/Model alapján) |
| Task type chip-ek | **General · Coding · Research · Analysis · Writing · Agentic · Files / vision** |
| **Attach file** | Enhancer kontextus (vagy carry over) |
| **Send** | Finomítás folytatása |
| **Quality N/10** | Minőségpont; **Gaps** = hiányzó checklist tételek |
| **Propose two alternatives** | **Concise** / **Thorough** / **Recommended** változatok |
| **Suggested final prompt** | Beilleszthető szöveg |
| **carry N files** | Csatolmányok a fő chatbe |
| **Apply** | Végleges (vagy utolsó) prompt a composerbe |

**Tartós** projekt / ágens system promptokhoz: [Prompt Coach](/docs/hu/ai/prompts/) a Projektek és Ágens Configuration oldalon.

---

## Context rail (chatter)

Jobb panel fülek: **Előzmények · Források · Következő · Fájlok**

| Terület | Mezők / vezérlők |
|---------|------------------|
| **Előzmények** | Add note, All/Notes/Changes szűrő, Note/Update badge |
| **Források** | Multi-checkbox a Search Source-okra (label, verzió, status). **Összes** / **Törlés (auto)**. Pin = melyik Odoo/kód fát használhatja az ágens. Project default öröklődik új conversationnél és project váltáskor. Részletek: [Keresés](/docs/hu/daily/search/) |
| **Következő** | Activities: Type, Summary, Deadline, Schedule, Mark as done |
| **Fájlok** | Csatolt fájlok |
| **Runtime** | Futási meta (összecsukható; nem a History része) |

---

## Team funkciók

| Elem | Jelentés |
|------|----------|
| **Sub-conversations** | Többágenses gyerek szálak |
| **Team Dashboard** | Phase, tokens, Finding/Decision/Blocker/…, View chat |
| **Team proposal** | Approve / Skip / Create missing specialists |
| **Run tree / Workflow** | Hierarchikus run nézet |

---

## God mód

A God mód **ugyanazt a feladatot** futtatja párhuzamosan több modellen, majd összeveti az eredményeket. Nem negyedik orkesztrációs stílus: a Szóló / Automatikus / Mély továbbra is a dekompozíciót írja le; a God mód csak annyit jelent, hogy több modell versenyez (nem specialistákból álló csapat). Össze lehet kombinálni: God mód + Mély azt jelenti, hogy minden versenyző modell a saját magán belül is bonthatja a feladatot.

**Nincs automatikus összefésülés.** Egy munkaterület nyer; a többiek egyedi ötletei listázódnak, te alkalmazod őket.

| Téma | Jelentés |
|------|----------|
| **Keret** | **Beállítások → Isten mód** (kártya a Modell-hozzárendelések alatt). 2–5 élő szolgáltató/modell pár. Páros számnál döntőbíró kell. |
| **Menü** | Az **Orchestration** vezérlő utolsó tétele (elválasztó után): Solo, Auto, Deep, majd **God mód**. Bekapcsolása **nem írja felül** a Solo/Auto/Deep értéket (a munkások azt öröklik). Solo/Auto/Deep választása kikapcsolja a God módot. |
| **Költség** | Bekapcsolás után az első küldés megerősítést kér (keret, becslés, plafon). A későbbi küldéseknél csak banner. Ha a becslés meghaladja a plafont, a küldés blokkolt, amíg nem emeled a plafont vagy nem kapcsolod ki a God módot. |
| **Mappák** | A munkások a beszélgetés munkamappáinak izolált másolatában futnak (lehetőleg git worktree). Üres Folders esetén a futás elindul, fájl-izoláció nélkül. |
| **Győztes + meglátások** | Csak a győztes megváltozott fájljai kerülnek a beszélgetés mappáira. A többiek egyedi meglátásai a **God** fülön listázódnak — te alkalmazod, automatikus merge nincs. |

### Keret a Beállításokban

A [Beállítások](/docs/hu/admin/settings/) **Isten mód** kártyája (Modell-hozzárendelések alatt) a globális keret, amit minden God mód beszélgetés használ.

| Mező | Jelentés |
|------|----------|
| **Modellek** | 2–5 élő szolgáltató/modell pár. Duplikátum tilos. |
| **Döntőbíró (chair)** | A keret egyik modellje. **Páros számnál kötelező**; mindig ajánlott (egy elhasaló worker páros maradékot hagyhat). A döntőbíró versenyző, nem külön bíró. |
| **Költségplafon (USD)** | Opcionális. Ha az indulás előtti becslés efelett van, a futás nem indul. Ha közben átlépi a plafont, a még futó workerek leállnak, és a már célba ért közül dől el a győztes. |
| **Worker-mappák megőrzése (óra)** | Az izolált fák ennyi óra után törlődnek (alap 72). |

A keret mentése nem írja felül a már elindult futásokat: minden küldés pillanatképet készít.

A beszélgetés provider/modell sávját a God mód küldés figyelmen kívül hagyja — a Beállítások kerete fut.

### God mód bekapcsolása

1. Nyisd a beszélgetés **Orchestration** menüjét, és válaszd a **God mód** tételt.
2. Küldj üzenetet. Az első küldés költség-megerősítést kér (ki versenyez, becsült USD, plafon). Erősítsd meg.
3. Amíg be van kapcsolva, **God mód** banner marad a beszélgetésen. A jobb oldali sávon megjelenik a **God** fül.
4. A **Stop** az egész versenyt leállítja, nem csak egy workert.

### Izoláció és a győztes

Minden worker saját mappát kap (git worktree, ha a munkakönyvtár repo; különben másolat). Munka közben nem látják egymás fájljait.

Győztes választás után **csak a győztes megváltozott fájljai** másolódnak a beszélgetés mappáira. A többiek fájljai az izolált fában maradnak a megőrzési idő lejártáig. Ha a beszélgetésnek nincs munkamappája, nincs mit átemelni; a győztes akkor is a leírt válaszokból dől el.

### A God fül

A chatter-sáv **God** füle akkor látszik, ha a God mód be van kapcsolva, **vagy** a beszélgetésnek már volt legalább egy God mód futása (akkor is marad, ha később kikapcsolod).

#### Fejléc

Aktuális fázis, plusz összes token, USD és időtartam.

| Fázis | Jelentés |
|-------|----------|
| **Előkészítés** | Keret pillanatkép, izolált mappák |
| **Verseny** | A workerek párhuzamosan ugyanazt a felhasználói üzenetet futtatják |
| **Értékelés** | A célba értek pontozzák egymást és szavaznak |
| **Döntés** | Győztes rögzítve |
| **Átemelés** | A győztes fájljai a beszélgetés mappáira kerülnek |
| **Kész / Sikertelen / Megszakítva** | Végállapot |

Az elhasaló worker a szolgáltató hibáját is mutatja (például túlterhelt API).

#### Lépések

Időbélyeges napló arról, mi történt valójában:

| Lépés | Jelentés |
|-------|----------|
| A futás elindult | Verseny a pillanatnyi keretből |
| A workerek párhuzamosan indultak | Minden élő modell ugyanazt a feladatot kezdi |
| *Modell* kész / elhasalt | Annak a workernek a saját próbálkozása véget ért |
| Keresztértékelés | A célba értek olvassák egymás összefoglalóját és szavaznak |
| Győztes: *modell* | Döntés rögzítve |
| A győztes munkája átemelve | Fájlok a beszélgetés mappáira |
| A futás kész / sikertelen / megszakítva | Végállapot |

A lépésnapló előtti, régebbi futásoknál a befejezési időkből rekonstruált idővonal látszik.

#### Hogyan dőlt el a győztes

Ez a blokk megmondja a szabályt, a szavazatszámokat, és **ki kire szavazott**.

| Szabály | Mikor |
|---------|-------|
| **Többségi szavazat** | Egy modell több érvényes szavazatot kapott, mint bármelyik másik. Egy modell **nem szavazhat magára**; az önszavazat eldobódik. |
| **Döntetlen — a döntőbíró választott** | Két vagy több modell holtversenyben van, és a döntőbíró köztük van. |
| **Döntetlen — a hamarabb kész** | Holtverseny, és a döntőbíró hiányzik vagy nincs a holtversenyben. A holtversenyben az nyer, aki hamarabb készült el. |
| **Csak egy ért célba** | A többi worker elhasalt vagy megszakadt; a túlélő nyer, keresztértékelős szavazás nincs. |

Ha egy értékelő hívás elhasal, annak a workernek egyszerűen nincs szavazata. A döntés a leadott szavazatokkal megy tovább.

#### Amit a többiek munkájáról mondtak

A verseny után a célba értek **egyszer** értékelik egymást (nincs élő vita). Minden értékelőnél, külön kattintás nélkül látszik:

- kire szavazott
- 1–5 pont: **minőség**, **teljesség**, **kockázat**
- írásos véleménye a többiek munkájáról
- egyedi meglátások, amiket szerinte a többiek kihagytak
- a jelzett kockázatok

A modellkártya lenyitásával annak a modellnek a **saját** munkája (amit az értékelés előtt produkált) és az esetleges hiba olvasható.

#### Egyedi meglátások

A **nem-győztesek** meglátásainak de-duplikált listája, amik a győztes saját listájában nem szerepelnek. Ha kellene belőlük valami a győztes munkaterületre, te viszed át — a rendszer nem fésüli össze automatikusan.

### Al-beszélgetések

Minden worker egy gyermek-beszélgetés, címe `God <modell>`. A beszélgetéslistában al-beszélgetésként megjelenhetnek. God mód **ki** van kapcsolva rajtuk, hogy ne indítsanak újabb versenyt.

Globális összevetés (győzelmi arány modellenként, átlagos költség-szorzó egyetlen modellhez képest): [Observability](/docs/hu/admin/observability/). Ott egy futásra kattintva a beszélgetés God füle nyílik.

---

## Skill-javaslatok

Egy illeszkedő skill **javaslat, amire a kör vár** — semmi nem fut belőle, amíg nem válaszolsz. A kártya mutatja a skill nevét, az illeszkedő mintát és a pontszámot.

| Vezérlő | Jelentés |
|---------|----------|
| **Egy készség illeszkedik — használjam?** | Cím |
| **Használd** | Elfogadás erre a beszélgetésre; a kör a skillel folytatódik |
| **Most ne** | Elutasítás csak erre a beszélgetésre |
| **Kapcsold ki** | Elutasítás **és** a skill globális letiltása (csak owner/admin). Nem illeszkedik újra, amíg valaki vissza nem kapcsolja a [Készségek](/docs/hu/automation/skills/) oldalon |

A válaszod megjegyződik erre a beszélgetésre. Aki beszélhet, de skilleket nem kezelhet, csak a **Használd** és **Most ne** gombokat látja.

---

## Csatolt designok

A beszélgetés felső sávjában a formák ikon a **Design**. A csatolt vásznak a szál minden körével utaznak (az ágens `design_read`-del kérheti a részeket). A projekt designjai az új beszélgetésre másolódnak, ha a projektben hozod létre; utána a beszélgetés birtokolja a linkeket.

| Vezérlő | Jelentés |
|---------|----------|
| **Csatolt designok** | Minden vászon listája, pipával a csatoltakon |
| Számláló | Hány van csatolva |
| **Design megnyitása** | Ugrás `/design`-ra |
| **Még nincs design.** | Üres lista — előbb hozz létre vásznat |

---

## Kapcsolódó

- [Keresés — többverziós pin](/docs/hu/daily/search/)
- [Projektek — alap kódforrások](/docs/hu/daily/projects/)
- [Ágensek](/docs/hu/agents/overview/)
- [Tábla](/docs/hu/daily/board/)
- [Hangprofilok](/docs/hu/agents/voice/)
- [Memória](/docs/hu/knowledge/memory/)
- [Design vásznak](/docs/hu/knowledge/design/)
- [Készségek](/docs/hu/automation/skills/)
- [Observability — God Mode fül](/docs/hu/admin/observability/)
