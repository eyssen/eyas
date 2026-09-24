---
title: Beszélgetések
description: Beszélj az ágensekkel — küldj munkát, csatolj designt, és irányítsd az orkesztrációt egy szálon.
---

**Mire való.** A beszélgetés az a hely, ahol egy ágenssel beszélsz. Az üzenetek a fő panelen mennek; a projekt, a fázis, a források, a fájlok és a futásidő a jobb oldali oszlopban él. Ugyanez a szál egy Tábla-kártya is, így a chat és a pipeline egy rekord marad.

## Mikor használd

- Egy ágenssel akarsz elvégeztetni egy munkát, és egy helyen akarod látni a választ, az eszközhívásokat és a haladást.
- Rögzíteni akarod, melyik indexelt kódfát (Odoo-verzió, addonok) keresheti ez a szál, és mely **munkakönyvtárakat** érinthetik a fájl-eszközök.
- Ki akarod választani, melyik modellel válaszoljon a beszélgetés — rögzített modell, automatikus útválasztás, vagy a kolléga alapértelmezése (a felső sáv modellválasztója).
- Egy illeszkedő skill vár — elfogadod, erre a szálra kihagyod, vagy globálisan kikapcsolod.
- Azt akarod, hogy a modell előbb tervet írjon, és várjon, mielőtt bármilyen tool fut (**Először terv**).
- Több modellel akarod versenyeztetni ugyanazt a feladatot (**God mód**), vagy a kollégák csapatkártya nélkül vonnak be specialistákat (`run_specialist`).
- Egy design-vászonnak minden körrel utaznia kell, vagy a Prompt Enhancerrel akarod formázni a piszkozatot küldés előtt.

## Tipikus munkafolyamat

1. Nyiss meg egy **kollégát** az oldalsáv **Kollégák** listájából (a home-szála), kattints az **Új beszélgetés** gombra (**Fő** szakasz), vagy nyiss meg egy kártyát a **Tábláról** / a Kezdőlap **Legutóbbi beszélgetések** csempéjéről. Útvonal: `/conversations/:id`.
2. Az első üzenet előtt állítsd be a **Projekt:** és **Fázis:** mezőt és az agentet (az agent utána zárolódik). Az agentválasztó az **Elsődleges** és **Csapat** kollégáidat listázza. Rögzítsd a **Források** fület, ha több kódfa van indexelve. Nézd meg a **Munkakönyvtárak** mezőt — az új szál a projekt listáját örökli (vagy a projekttípusét, ha a projektnek nincs).
3. Írj a composerbe. Ha a piszkozat formázásra szorul, használd a **Prompt Enhancert**; a térkép ikon az **Először terv** (tervet ír, és a toolok előtt vár). Csatolj fájlt, vagy a felső sávból csatolj **Designt**.
4. Ha skill-javaslat kártya jelenik meg, válaszd a **Használd**, **Most ne** vagy **Kapcsold ki** gombot. Küldd el. A válasz streamelve érkezik, élő tool-sorokkal, alatta a *Provider · modell* felirattal, a vékony kontextussáv pedig mutatja, mennyire telt meg a modell ablaka. A **Leállítás** megszakítja a futást.

## Funkciók

Elrendezés: a **felső sáv** és a **mezősáv** alatt az **üzenetek + composer** (fő panel); jobbra a **Futásidő** sáv (futási fa, agent-haladás, al-beszélgetések), alatta a **kontextussáv** (chatter: előzmények, források, mappák, következő lépések, fájlok).

## Beszélgetés állapota

| Állapot | Jelentés |
|---------|----------|
| **Tétlen** | Nincs aktív agent-futás |
| **Dolgozik…** | Az agent fut |
| **Várakozik** | Felhasználói vagy külső bemenetre vár |
| **Jóváhagyásra vár** | Emberi jóváhagyásra vár (biztonság / autonómia) |
| **Tervre vár** | Először-terv kör: a tervkártya **Jóváhagyás** / **Terv kihagyása** / **Elutasítás** válaszra vár |
| **Archivált** | Lezárt / archivált szál |

---

## Felső sáv

Balról jobbra: a vissza nyíl, a cím (kattintásra átnevezheted — lásd [Automatikus cím](#automatic-title)), az állapot-badge, a kolléga neve, egy súgó ikon, a prioritás, az OpenCode terminál ikonja, a **Design** ikon, a hang hatóköre és a modellválasztó. A felső szélen futó vékony sáv a kontextussáv ([Kontextus-összeállítás](#context-composition)).

| Vezérlő | Jelentés |
|---------|----------|
| **Alacsony / Normál / Magas / Sürgős** | A beszélgetés üzleti prioritása (a Táblán is látszik) |
| Terminál ikon (*OpenCode terminál*) | OpenCode terminált nyit ehhez a beszélgetéshez a jobb oldali sáv fölött — lásd [OpenCode](/docs/hu/automation/opencode/) |
| **Design** (formák ikon) | Minden körrel utazó vásznak — lásd [Csatolt designok](#attached-designs) |
| **Hang: …** | Az aktív hang-hatókör és a felülírása — lásd [Hang hatókör](#voice-scope) |
| **Modell** (jobb oldalt) | Kattints rá, és válaszd ki, hogyan választ modellt ez a beszélgetés. Van keresőmezője (*Modell keresése…*) és háromféle választása: **Rögzített modell** — minden engedélyezett provider minden engedélyezett modellje, *Rögzített modell · &lt;provider&gt;* csoportokban (például *Rögzített modell · Claude Code CLI*); **Automatikus útválasztás** — az EYAS üzenetenként választ modellt; **Kolléga alapértelmezése (&lt;modell&gt;)** — csak kollégával folytatott beszélgetésen és al-beszélgetéseken. |
| *Alapértelmezett modell — az első üzenetnél rögzül* | Kolléga nélküli új beszélgetés: az aktuális alapértelmezett modell az első üzenettel rögzül rajta, és akkor is megmarad, ha az alapértelmezések később változnak |
| Tooltip | Melyik modell válaszol a következő üzenetre és miért, például *Válaszol: Claude Code CLI / sonnet — a beszélgetéshez rögzített modell*. További okok: a kolléga saját modellje; a feladatot átadó beszélgetés modellje; az automatikus útválasztás üzenetenként választ modellt (itt látható: a Standard szint); az alapértelmezett modell |
| Figyelmeztető ikon | Tartalék érvényes (a kolléga modellje vagy a beszélgetés saját modellje nem érhető el, vagy az automatikus útválasztás ki van kapcsolva, illetve nincs szintje), vagy egyik modell sem tud válaszolni. Az okot az egérmutató alatt írja ki |
| Szürke **Automatikus útválasztás** | Az automatikus útválasztás nincs engedélyezve: *kapcsold be az „Automatikus útválasztás engedélyezése” kapcsolót a Providerek oldalon.* |
| Halványított választó | A God mód be van kapcsolva: *A God mód a Beállítások keretét használja* |

A providerek neve mindenhol ugyanaz az alkalmazásban — a választóban, a válasz feliratában, a hibaüzenetekben és a Providerek oldalon.

### Melyik modell válaszol {#which-model-answers}
A beszélgetés megtartja a modellt, amelyen fut; az üzeneteket az EYAS nem routolja újra egyenként. Hogy hogyan, azt a (fenti) modellválasztóban választod ki.

- **Rögzített modell.** A modellhez rögzített beszélgetés mindig azzal válaszol. Az a kolléga nélküli új beszélgetés, amely nem nevez meg modellt, az **első üzenetnél** a telepítés alapértelmezését kapja — a Standard routing-szintet, különben az alapértelmezett providert, különben az első aktív providert, amelynek van modellje, a CLI-ket is beleértve —, és onnantól megtartja. Az alapértelmezett provider vagy a routing-szintek későbbi módosítása nem mozdítja el a meglévő beszélgetéseket. A korábban létrehozott beszélgetések megtartják a rajtuk már tárolt providert és modellt; a tárolt modell nélküli régi beszélgetés a következő üzenetnél kapja meg az aktuális alapértelmezést.
- **Kolléga alapértelmezése.** A kollégával folytatott beszélgetés és az al-beszélgetés a kolléga saját modelljét követi; különben a feladatot átadó beszélgetés modelljét; különben az alapértelmezett modellt, amely az első üzenetnél rögzül. A `run_specialist` / `delegate_to_agent` által indított specialista, az `assign_task`-kal kiosztott kártya és a `create_sub_conversation`-nel létrehozott al-beszélgetés azon a modellen fut, **amelyen a delegáló kör ténylegesen futott** — nem a szülő mentett beállításainak másolatán. Egy átadással megnyitott kolléga home-szála a kolléga modelljét követi, nem az átadó beszélgetés modelljét. Ha a kolléga modellje nem érhető el (a providere ki van kapcsolva, vagy a modell le van tiltva), a beszélgetés a tárolt vagy alapértelmezett modelljére esik vissza, és a válasz rögzíti az `agent-binding-unavailable` megjegyzést; az EYAS soha nem választ név alapján egy másik providert.
- Az **automatikus útválasztás** beszélgetésenkénti választás. Csak az Auto-ra állított beszélgetést triázsolja az EYAS: az üzenetét osztályozza, és a Quick, Standard, Complex vagy Code szintre routolja. A Providerek oldal **Automatikus útválasztás engedélyezése** kapcsolója csak *engedélyezi*; amíg ki van kapcsolva, a választó bejegyzése szürke, egy már Auto-ra állított beszélgetés pedig a tárolt modelljét használja, és ezt jelzi is. A meglévő beszélgetéseket az EYAS nem állítja automatikusan Auto-ra. Lásd [Routing és költségkeret](/docs/hu/ai/routing-budget/#auto-routing).
- **Az általad választott modellt az EYAS soha nem cseréli le csendben.** Ha a választóban kiválasztott modell később elérhetetlenné válik (ki van kapcsolva ő vagy a providere, vagy egy CLI már nem kínálja), az EYAS nem válaszol másik modellel: az üzenetet elutasítja és nem tárolja, ezzel: *A(z) &lt;provider&gt; / &lt;modell&gt; modell nem érhető el: ki van kapcsolva (vagy a szolgáltatója). Válassz másik modellt a beszélgetés tetején lévő modellválasztóban, vagy kapcsold be a Providerek oldalon.* A választó pirossal, ugyanezzel az okkal mutatja a modellt, és egy másik modell választása megoldja. Egy ilyen beszélgetés háttérkártya-futásai ugyanígy buknak el.
- **Az EYAS által maga rögzített modellek megjegyzéssel esnek vissza.** Az első üzenetnél rögzített alapértelmezés, a modellválasztó előtti beszélgetések és egy al-beszélgetés delegáló modellje: ha ezek egyike nem érhető el, a beszélgetés az alapértelmezett modellel válaszol, és ezt jelzi (figyelmeztető ikon és tooltip). Amint a saját modellje visszatér, automatikusan visszavált rá. Az üzenetet csak akkor utasítja el (`model_binding_unavailable` kód), ha alapértelmezett modell sincs. Ha egyáltalán nincs beállított modell, a futás *Nincs beállított modell…* hibával elbukik (`no_model_configured` kód), és nem próbálkozik újra.

**Ki válaszolt.** Minden asszisztens-válasz alatt egy kis *Provider · modell* felirat áll (például *Grok CLI · grok-4*). A tooltipje *Válaszolt: …*, és azt is megmondja, miért azt a modellt használta az EYAS, és volt-e tartalék. Ha egy failover egy másik modellel válaszolt, a felirat a ténylegesen válaszoló modellt nevezi meg. A még streamelő válasz a kör indulásától mutatja a modellt; a God mód válaszai a győztes modellt mutatják.

**Váltáskor a kontextus megmarad.** Provider- vagy modellváltáskor a beszélgetés megtartja a kontextusát. Az EYAS minden körben a teljes beszélgetést küldi a saját tárából; egyik provider sem tart meg vagy folytat saját sessiont — a Claude Code, a Grok CLI és a Kimi Code CLI sem. Lásd [Providerek — Beszélgetés-folytonosság](/docs/hu/ai/providers/#conversation-continuity).

**API (integrátoroknak).** A `POST /api/v1/conversations` csak akkor tárolja a `providerId` + `modelId` párost, ha mindkettő egy aktív provider engedélyezett modelljét nevezi meg (különben semmit nem tárol, és az alapértelmezés az első üzenetnél rögzül), és elfogad egy opcionális `modelBinding`-et (`pinned` | `auto` | `inherit`; az `inherit` kollégát igényel, különben `400 binding_inherit_needs_agent`), valamint egy opcionális kezdő `effort`-ot. A `POST /api/v1/projects/:id/conversations` (kártya egy projekt tábláján) ugyanezt a szabályt alkalmazza. A `PATCH /api/v1/conversations/:id` elfogadja a `modelBinding`-et és a `providerId` + `modelId` párost, mindig együtt küldve és validálva (ismeretlen vagy letiltott modellre `400 model_binding_unavailable`); a párt küldő PATCH azt a te választásodként jelöli meg (ezt a jelzőt a kliens közvetlenül nem állíthatja). A `GET` visszaadja az `effectiveBinding`-et (provider, modell, ok és képtámogatás) és az `autoRoutingEnabled` mezőt, az élő stream pedig a kör indulásakor bejelenti a kötést. A `POST …/messages` egykörös provider + modell felülírásának mindkettőt küldenie kell. A beszélgetés-objektumokban már nincs `sdkSessionId`, és az ezt küldő `PATCH`-et az EYAS figyelmen kívül hagyja.

### Kontextus-összeállítás {#context-composition}
A beszélgetés tetején futó vékony sáv kattintható: megnyitja az aktuális kör **Kontextus-összeállítás** paneljét — minden szekciót, amely a kör promptjába került, az összeállítás sorrendjében, a méretével, azzal, hogy csonkult-e, és a nyers tartalmával. Ez körönkénti nézet, nem a teljes beszélgetés összesítése.

A **turn** zóna azt tartalmazza, ami az üzenetedhez van csatolva, nem a rendszerprompthoz: **turn-time** (az aktuális dátum és idő) és **memory-recall** (a felidézett memóriablokk, az azonosítói és a kerete). A runtime szekció már nem hordozza a dátumot és az időt, a régi *memory-index* és *related-work* szekciók pedig megszűntek. Lásd [Memória — Hogyan jut el a felidézés a modellhez](/docs/hu/knowledge/memory/#how-recall-reaches-the-model).

A szekciók mérete a kört megválaszoló modellhez igazodik — akár rögzített, akár automatikusan routolt —, így az is attól a modell kontextusablakától függ, hogy egy szekció csonkult-e. Nagy ablakú modellnél több hely jut a projektkontextusnak és az agent-fájloknak; egy kis lokális modell olyan promptot kap, amely még helyet hagy a beszélgetésnek. Lásd [Promptok — a modellhez méretezve](/docs/hu/ai/prompts/#prompt-size). Egy agent-hurokban a panel a kör utolsó modellhívását tükrözi.

**Mennyire telt meg az ablak.** A sáv azt mutatja, mennyire telt meg ténylegesen a modell kontextusablaka:

- **Mért.** Ha a provider jelenti az utolsó modellhívás promptméretét, a sáv ezt a számot használja, és a tooltipje *mért*-et ír (Anthropic és Anthropic-kompatibilis, az OpenAI-család az OpenRouterrel, a Kimi API-val és az LM Studióval együtt, Gemini és Claude Code).
- **Becsült.** Különben becslést mutat, `~` jellel és *becsült* felirattal: a rendszerprompt plusz a körrel elküldött beszélgetés-előzmények. Az Ollama, a Grok CLI és a Kimi Code CLI mindig a becslést mutatja (az Ollama kihagyja a cache-ből újrahasznált részt; a Grok és a Kimi CLI a belső lépéseik összegét jelenti).
- **Az ablak** minden providernél a kiválasztott modell saját ablaka: a modellhez a Providerek oldalon megadott ablak nyer, így egy 1M-es ablakkal listázott CLI-modell 1M-et használ. Ha a runtime jelenti a válaszoló modell ablakát (a Claude Code ezt teszi), az nyer. A CLI-k rögzített ablakai (Claude Code 200k, Grok 500k, Kimi 256k) csak tartalékok arra a modellre, amelyhez a listában nincs ablak. A Claude Code Fable, Opus, Sonnet és Haiku bejegyzései 200k-t listáznak — ezt az ablakot adja a runtime ezeknek a neveknek —, akkor is, mielőtt a runtime jelentette volna a modelljeit; csak az a bejegyzés listázódik 1M-mel, amelyet a runtime 1M-es változatként kínál (például *Opus (1M context)*). Ha a beszélgetést másik modellre váltod, a sáv azonnal az új modell ablakát használja.
- A színek (50% alatt / 75% alatt / 75% és fölötte) a téma success, warning és destructive színeit követik. Ugyanez a szám hajtja a tábla-kártya *% context* csíkját. A régebbi körök a következő körig a becslésüket mutatják.

**Adatvédelem szekciónként.** Minden rögzített promptszekció adatvédelmi badge-et kap:

| Badge | Jelentés |
|-------|----------|
| *N maszkolva · &lt;típusok&gt;* | Az értékek helyőrzőkre (például `[EMAIL]`) cserélődtek, mielőtt a modell látta őket (például *2 maszkolva · E-mail-cím, IBAN*) |
| *nincs vizsgálva (EYAS állítja elő)* | Az identitás, a szabályok, a futásidejű óra, a munkamappák, a tool-, skill- és agent-listák és az orkesztrációs direktíva úgy megy ki, ahogy van |
| *nincs mit maszkolni* | A szekciót az EYAS átvizsgálta, és semmit nem kellett maszkolni |
| *helyi cél — nincs maszkolás* | A modell ezen a gépen fut (loopback, vagy az Adatvédelem → helyi gépek alatt felsorolt gép), ezért szándékosan nincs maszkolás |
| Nincs badge | A szekcióhoz semmi nem rögzült: az üzenetedben küldött szekciók (a körönkénti memóriablokk), a promptban meg nem talált szekciók (ezeket a rendszerszöveg többi részével együtt ettől még átvizsgálja), és azok a körök, amelyeknél a maszkolást még nem rögzítette |

Ha valami maszkolódott, megjelenik egy **Ahogy összeállt / Ahogy a modell megkapta** kapcsoló; az *Ahogy a modell megkapta* nézet pontosan úgy mutatja a szekciót a helyőrzőkkel, ahogy a modell kapta. Egy sor megnevezi a használt adatvédelmi szabályzat verzióját (*Adatvédelmi szabályzat: regex@2/policy@N*), egy *Maszkolt memóriaeszköz-eredmények: memory_search (2), …* sor pedig felsorolja azokat a memóriatool-eredményeket, amelyekben értékek maszkolódtak — azokat is, amelyeket a Claude Code, a Grok és a Kimi az EYAS tool bridge-en át kért le. Lásd [Biztonság és adatvédelem — Hol hat a maszkolás](/docs/hu/admin/security-privacy/#where-masking-applies).

**Átadott memória.** Egy doboz mutatja, milyen memória jutott el a modellhez, ugyanúgy, bármi válaszolt is a körre (API providerek, Claude Code, Grok, Kimi vagy egy lokális modell), tényenként egy sorban:

- *&lt;modell&gt; számára méretezve · &lt;N&gt; tokenes ablak* — az a modell, amelyhez a prompt és a memóriakeret méreteződött; *az ablak ismeretlen, a 100k tokenes alapérték érvényes*, ha az EYAS nem ismeri a modell ablakát.
- *&lt;találatok&gt; felidézett elem (&lt;teljes&gt; teljes szöveggel) · &lt;tokenek&gt; / &lt;keret&gt; token* — az üzenethez csatolt felidézett memóriablokk (állandó jegyzetek plusz az üzenethez visszakeresett elemek), hány elem kapta meg a teljes szövegét, és a blokk becsült mérete az ehhez az ablakhoz tartozó plafonhoz mérve. Különben *Ehhez az üzenethez nem került elő memória*, vagy *Felidézés visszatartva: &lt;ok&gt;* — a választ nem te kapod, hanem valaki más (egy A2A peer vagy egy külső hangú csatornaválasz); a modell kontextusablakában nem maradt hely; innen nincs miből felidézni; a felidézés nem sikerült, és a kör csak az időpontot kapta meg.
- *Memória-drill-down: &lt;hívások&gt; / &lt;korlát&gt; hívás ebben a körben · &lt;elemek&gt; elem olvasva* — a modell saját `memory_search` / `memory_expand` / `search_memory` hívásai ebben a körben, a körönkénti 3-as plafonhoz mérve (minden providernél ugyanaz), az utolsó olyan hívásig számolva, amely talált valamit. Azok a körök, amelyeknél a hívásokat még nem számolta, csak az *elem olvasva* részt mutatják. *Memória-drill-down nem érhető el: a memóriaeszközök nem jutnak el ehhez a modellhez*, ha a modell nem tud toolt hívni, vagy a CLI tool bridge elbukott az öntesztjén.
- *Rendszerprompt: …* (csak Grok és Kimi) — *rendszerpromptként érkezett meg (igazolva)*, *rendszerpromptként elküldve (nincs igazolva)*, vagy *az üzenetbe ágyazva érkezett*.

A doboz nem jelenik meg a bevezetése előtt rögzített köröknél, és ha nem állt össze prompt. A körönkénti részletek többi részéhez hasonlóan alapból 7 napig marad meg, utána törlődik. A [Megfigyelhetőség → Kontextus](/docs/hu/admin/observability/) fül **Memóriaátadás szolgáltatónként** kártyája ezt az átadást providerenként veti össze.

### Automatikus cím {#automatic-title}
Az új beszélgetés címe először az üzeneted első szavai; ezt aztán egy rövid modellhívás jobbra cserélheti. Ez a hívás csak a **Heartbeat** routing-szinten fut, izolált hívásként, és soha nem a beszélgetés saját modelljére vagy más providerre terhelődik. Ha a Heartbeat szintnek nincs jogosult modellje (például csak Grokos vagy csak Kimis telepítésen, amíg az izolációjuk nincs ellenőrizve), az első üzenet kivonata marad a cím. A címre kattintva magad is átnevezheted.

### Hang hatókör {#voice-scope}
| Vezérlő | Jelentés |
|---------|----------|
| **Hang: BELSŐ / KÜLSŐ / AUTO** | Melyik hangprofil aktív ([Hangprofilok](/docs/hu/agents/voice/)); az AUTO utáni *(alapért.)* azt jelenti, hogy az agent alapértelmezése érvényes, felülírás nélkül |
| Választó (*Hang hatókör felülírása*) | **Auto**, **Kényszerítés: Belső** vagy **Kényszerítés: Külső** |

---

## Beszélgetésmezők (kontextus)

A felső sáv alatti mezősávban balról: projekt, munkakönyvtárak, agent, fázis, erőfeszítés, orkesztráció és határidő. A felelősök és a címkék akkor jelennek meg, ha a beszélgetésnek vannak ilyenjei.

| Mező | Jelentés |
|------|----------|
| **Projekt:** | A tulajdonos projekt, projekttípus szerint csoportosítva (*Nincs*, ha nincs beállítva). Projektváltáskor **a projekt alapértelmezett kódforrásai** kerülnek a Források fülre (hacsak ugyanabban a módosításban nem adsz meg explicit forrásokat), és a munkakönyvtár-lista is lecserélődik. Az első üzenet előtt a projekt alapértelmezett agentjét is kiválasztja. |
| **Munkakönyvtárak** | Mely elnevezett gyökereken olvashat és írhat ez a szál; a választó azt rögzíti, melyik a **fő** (cwd). A saját mappa nélküli szál a saját **EYAS workspace**-ében dolgozik (lásd [Mappák](#working-folders)); **Nincs mappa** csak akkor jelenik meg, ha a workspace-ek helye nem írható. A lista a sáv **Mappák** fülén szerkeszthető. |
| Agent | A hozzárendelt kolléga — **az első üzenet után zárolt** (*Az agent az első üzenet után nem módosítható*). A chat csak ennek a kollégának a **Tools** listáját kínálja, plusz a `memory_search`-öt és a `memory_expand`-ot (kolléga nélkül a projekt alapértelmezett agentjének listáját); az üres lista, vagy ha egyáltalán nincs agent, minden toolt jelent. A lista minden providernél érvényes, és a modell nem futtathat olyan toolt, amelyet nem kapott meg. Lásd [Agentek — Toolok](/docs/hu/agents/configure/#tools--constraints). |
| **Fázis:** | Fázis a projekt pipeline-jában |
| Erőfeszítés | Gondolkodási mélység. A választó csak azokat a szinteket listázza, amelyeket a beszélgetés modellje kínál (a Nincs, Minimális, Alacsony, Közepes, Magas, Nagyon magas, Maximális közül; be/ki modellnél Ki / Be). Az **Automatikus** semmit nem tárol, és megnevezi, mit örököl — *Automatikus · Maximális (Mély)*, *Automatikus · Magas (kolléga)*, *Automatikus · Nagyon magas (delegáló beszélgetés)*, vagy *Automatikus · a modell alapértéke (Közepes)*. Magasabb = mélyebb, lassabb, drágább. A modell által nem támogatott szintet az EYAS nem menti el, és üzenetben felsorolja, mely szinteket támogat. Modellváltáskor a tárolt szint megmarad; amelyet az új modell nem kínál, az így látszik: *Nagyon magas → Magas (a(z) … nem kínálja ezt: Nagyon magas)*, és az EYAS minden kört igazít. Lásd [Providerek — Reasoning effort](/docs/hu/ai/providers/#reasoning-effort). |
| **Orkesztráció: …** | **Szóló** = nincsenek specialisták, átadások és csapatjavaslatok, minden providernél (a CLI-modelleknél az EYAS bridge-en is): a `run_specialist`, a `delegate_to_agent`, a `handoff_to_colleague` és a `propose_team` nem kerül felajánlásra; a memóriatoolok és az `assign_task` maradnak. **Automatikus** = a modell szükség esetén bevon specialistákat. **Mély** = agresszív `run_specialist` szétosztás; a Mély az alapértelmezett erőfeszítést Maximálisra állítja, és a saját erőfeszítés nélküli specialisták ezt öröklik. Minden modell ugyanazt a Mély utasítást kapja: a nem triviális munkát bontsa fel, minden független szelethez futtasson egy specialistát párhuzamosan, pontos, önálló eligazítással, adja át a feladatot annak a kollégának, akié, csapatot csak akkor javasoljon, ha egy szükséges specialista még nem létezik, a fontos eredményeket ellenőrizze, és a végső szintézist tartsa meg magának. Az utolsó tétel, a **God mód**, ugyanazt a feladatot a Beállítások keretével versenyezteti (lásd [God mód](#god-mód)). |
| Határidő | A beszélgetés határideje (követett üzleti mező is) |

### Komplexitásjelzők

Ha a beszélgetés nem egyszerű módban fut, a mezősáv alatt egy badge mutatja a módját, mellette a komplexitási osztállyal, ha ismert.

| Badge | Jelentés |
|-------|----------|
| **Irányított** | Strukturált / felügyelt út |
| **Autonóm** | Nagyobb autonómiájú út |
| **Varázsló** | Varázslóval támogatott folyamat |

---

## Üzenetfolyam

| Vezérlő / címke | Jelentés |
|-----------------|----------|
| *Kezdj el egy beszélgetést…* | Üres állapot |
| **Gondolkodik / Gondolkodik…** | A modell gondolkodik (karakterszámot is mutathat) |
| *Válasz készítése…* | A válasz streamel |
| *Eszközök futnak…* | Egy vagy több tool folyamatban van |
| **Leállítás** | Az aktuális futás megszakítása |
| *Az agent a háttérben dolgozik…* | Elmentél az oldalról, és visszajöttél, miközben az agent még dolgozott — az üzenetek megjelennek, ha készen vannak |
| Melléklet | A szál beágyazott képe vagy fájlja (*Fájl megnyitása*) |

### Tool-nyomkövetés {#tool-trace}
Minden toolhívás egy élő sor a folyamban: a tool neve, a paraméterek rövid előnézete, rövid eredmény, időtartam, és egy ikon a státusszal. Kattintásra a sor kinyílik.

A sorok minden providernél egyformák — API providereknél, Claude Code-on, Grok CLI-n és Kimi Code CLI-n. Az EYAS közös toolneveit használják (`read_file`, `run_command`, `edit_file`, …, vagy egy EYAS tool saját nevét, például `memory_search`), mutatják a hívás bemenetét és kimenetét (a nagyon hosszú kimenetet 64 KiB-nál levágja és jelöli), az időtartamát, fájlszerkesztésnél pedig a diffet. Ha a provider saját toolneve eltér az EYAS-étól (például a Claude Code *Edit*-je az `edit_file`-nál), a toolnév fölé víve az egeret látszik (*A szolgáltató eszközneve: …*). Az elbukott hívás hibaszövege egyszer jelenik meg.

| Státusz | Jelentés |
|---------|----------|
| **Fut** | A hívás folyamatban van |
| **Sikeres** | A tool lefutott és visszajelzett |
| **Sikertelen** | A tool lefutott és hibát adott |
| **Elutasítva** | Elutasítva — a biztonsági kapu, a memória-policy (a túl tág keresést is beleértve) által, vagy mert a modell olyan toolt nevezett meg, amelyet nem kapott meg, vagy a CLI egy olyan saját toolját, amelyet az agent **Eszközök** listája visszatart |
| **Jóváhagyásra vár** | Emberi döntésre vár (lásd [Jóváhagyás a chatben](#approvals-in-the-chat)) |
| **Kihagyva** | Soha nem futott le — a toolhívás-keret, a körönkénti limit, vagy ismétlés egy folytatott futásban |
| **Kimenetel ismeretlen** | A sor még nyitva volt, amikor a kör véget ért |

Egy sor csak akkor zárul le, amikor a tool ténylegesen visszajelzett; az elutasított, váró vagy kihagyott hívás soha nem zöld. Lásd [Providerek — Ugyanaz a chat minden providernél](/docs/hu/ai/providers/#same-chat-on-every-provider).

**Egy elutasított hívás véget vet a Grok válaszának.** Ha az EYAS elutasítja a Grok egyik toolhívását — például egy EYAS-on kívüli memória olvasását —, a Grok befejezi azt a választ: a chat az **Elutasítva** sort mutatja, és utána semmit. A Grok modellje nem látja az EYAS indoklását, ezért kérd újra ennek a lépésnek a kihagyásával. A Claude Code ezzel szemben folytatja, és megkapja az indoklást (*Memory outside EYAS … use memory_search / memory_expand from EYAS*). Grok CLI 1.0.41-en megfigyelve; lásd [Providerek — Grok CLI és Kimi Code CLI](/docs/hu/ai/providers/#grok-cli-and-kimi-code-cli).

**Túl tágként elutasított keresés.** Ha egy CLI saját keresése (Grep, Glob, egy rekurzív shellparancs) olyan mappában indul, amely egy védett helyet is tartalmaz, az EYAS elutasítja, és az **Elutasítva** sor ezt a nyelveden közli: *Túl tág keresés: a mappa egy másik eszköz memóriáját is tartalmazza, amelyet csak az EYAS olvashat. A modell azt a választ kapta, hogy szűkebb mappában keressen.* — vagy az EYAS saját adatait, az EYAS által őrzött CLI-bejelentkezéseket, illetve egy másik beszélgetés munkaterületét nevezi meg. A Claude Code megkapja az indokot, és szűkebb mappával újrapróbálhatja; a Grok befejezi a válaszát, ezért kérd újra, egy szűkebb mappát megnevezve. Lásd [Biztonság és adatvédelem — Memória az EYAS-on kívül](/docs/hu/admin/security-privacy/#memory-outside-eyas).

**EYAS toolok a Grokon.** Egy a Grok által hívott EYAS tool sora azokat az argumentumokat mutatja, amelyeket a tool ténylegesen kapott, nem a Grok belső `use_tool` burkolóját (`tool_name`, `tool_input`, `variant`).

| Címke | Jelentés |
|-------|----------|
| **Diff** | A fájlszerkesztések (`edit_file` / `write_file`) unified diffet mutatnak a szálban — nem csak a modell szöveges leírását |
| **Bemenet / Kimenet / Hiba** | A nyers adat, ha nincs fájl-diff, vagy ha szükséged van rá |

Ez a sor semmilyen jogosultságot nem ad. A sárga és piros toolok továbbra is [jóváhagyásra](/docs/hu/agents/autonomy/) várnak. A csak olvasó `git status` / `git diff` (akkor is, ha a modell `run_command`-ként küldte) nem kér kattintást — lásd [Eszközök](/docs/hu/automation/tools/).

### A kör kimenete {#turn-outcome}
Minden asszisztens-válasz alatt, a válaszoló és az erőfeszítés-chip mellett egy badge jelenik meg, ha a kör nem egyszerűen befejeződött:

| Badge | Jelentés |
|-------|----------|
| **Elérte a körlimitet** | A kör elhasználta a körkeretét (lásd [Agent-haladás](#agent-progress)) |
| **Elérte a kimeneti limitet** | A válasz elérte a modell kimeneti tokenlimitjét |
| **A modell elutasította** | A modell megtagadta |
| **Elfogyott az eszközkeret** | Elfogyott a kör toolhívás-kerete |
| **Leállítva** | Megnyomtad a Leállítást |
| **Sikertelen** | A kör elbukott; a tooltip megnevezi, mi romlott el (például a kéréskorlát) |
| **Jóváhagyásra vár** | Egy toolhívás emberi döntésre vár |

Az addig megírt válasz mindig megmarad; a badge tooltipje ezt meg is mondja (*A kör idő előtt véget ért; az addigi válasz megmarad.*). A válasz a tokeneket is mutatja *N be · N ki* alakban, ahol a *be* a teljes prompt, a cache-elt részekkel együtt, valamint a költséget: *$x*, ha a provider jelentette, *~$x*, ha az EYAS a tokenszámokból becsülte (a tooltip megmondja, melyik), vagy *Nincs jelentett felhasználás*, ha a provider semmit nem jelentett — soha nem $0. A nem jelentett költség nem adódik hozzá a beszélgetés összegéhez. A *Kért jóváhagyások: N* a jóváhagyási sorra visz.

Minden asszisztens-üzenet tárolja, hogyan ment a köre: a kimenetelt és a leállás okát; a tokeneket (nem cache-elt input, output, cache-olvasás és -írás, reasoning); a költséget és a forrását (a provider jelentette, az EYAS becsülte, vagy nem jelentett); a lépések, toolhívások és jóváhagyások számát; a providert és a modellt; az esetleges értesítéseket; sikertelen körnél pedig a hiba fajtáját és kódját. A delegált, specialista-, pipeline- és csatornaválaszok ugyanezt tárolják. A `GET /api/v1/conversations/:id` minden üzenetén és a stream `done` frame-jén `turnMeta`-ként jön vissza; a régebbi üzeneteknek nincs ilyenük.

### Hibák és értesítések {#errors-and-notices}
Egy elbukott kör a hiba fajtájától függően egyetlen, a nyelveden írt üzenetet mutat: a provider nem fogadta el a bejelentkezést vagy az API-kulcsot, elérted a kéréskorlátot, a provider túlterhelt, a modell nem válaszolt időben, hálózati hiba, a kérés megszakadt, a provider elutasította a kérést, a modell futása véget ért, mielőtt befejezte volna a választ, a CLI leállt, mert az izolációja nem volt megerősíthető, vagy egyéb. Ezekre az esetekre pontosabb üzenetek vannak:

- a CLI izolációja elutasítva, az összes elbukott ellenőrzéssel ([Providerek — Izolációs ellenőrzés](/docs/hu/ai/providers/#isolation-check-before-every-turn));
- a CLI nincs bejelentkezve az EYAS számára;
- kernel fájl-sandbox kötelező (`security.cliSandbox: required`), de nem érhető el ([Providerek — Kernel fájl-sandbox](/docs/hu/ai/providers/#kernel-file-sandbox));
- a beszélgetés modellje vagy providere ki van kapcsolva vagy nem érhető el;
- nincs beállított modell;
- az erőfeszítés szintjét a modell nem támogatja.

A provider nyers szövege soha nem maga az üzenet; egy összecsukható **Részletek megjelenítése** alatt van. Azoknál a hibáknál, amelyekre a provider-beállításokban van orvosság (bejelentkezés, izoláció, sandbox, modellkötés, nincs beállított modell, hitelesítés), egy **Szolgáltatóbeállítások megnyitása** gomb is megjelenik. Ha a kör a hiba előtt a válasz egy részét már megírta, az a rész a beszélgetésben marad, újratöltés után is, a hiba pedig ezt mondja: *A hiba előtt megírt válaszrész el lett mentve.* Maga a hiba soha nem mentődik üzenetszövegként, mert különben előzményként visszajátszódna a modellnek. A leállított kör is megtartja, amit megírt, és az elbukott és leállított körök tokenjei és költsége is rögzül. Ha a szerver elutasít egy üzenetet, a chat ezt mutatja: *A szerver nem fogadta el az üzenetet (HTTP n).*; megszakadt kapcsolatnál: *A kapcsolat a szerverrel megszakadt, mielőtt a válasz megérkezett. Töltsd újra a beszélgetést, hogy lásd, mi lett mentve.*

Az értesítések halk sorokként jelennek meg a kör alatt, és újratöltés után is ott maradnak:

- *A modell futtatókörnyezete e kör alatt tömörítette a munkakontextusát, hogy helyet csináljon.* — az EYAS továbbra is a teljes beszélgetést őrzi;
- *A modell nem látta a képeket (N): …* — a modell nem lát képet (lásd [Providerek — Képek](/docs/hu/ai/providers/#images-and-models-that-cannot-see-them));
- *A(z) &lt;provider&gt; ezen a szerveren kernel fájl-sandbox nélkül futtatja a saját eszközeit.* — akkor jelenik meg, ha egy CLI sandbox nélkül futtatja a saját tooljait (`security.cliSandbox: auto`); az EYAS ettől még minden toolhívást ellenőriz, amelyet lát;
- *A(z) &lt;path&gt; mappa kimaradt ebből a körből: az EYAS már nem engedi, hogy egy modell ott dolgozzon…* — egy korábban mentett Mappát az EYAS most elutasít, így ez a kör nélküle futott (lásd [Mappák](#working-folders)).

### Jóváhagyás a chatben {#approvals-in-the-chat}
Ha egy toolhívás emberi döntést igényel, a beszélgetés alatt egy kártya jelenik meg: *Jóváhagyás szükséges: &lt;tool&gt;*, egy összecsukható **Indoklás**, **Jóváhagyás** és **Elutasítás** gomb (ha a hívás a jóváhagyási sorba került), valamint **Jóváhagyások megnyitása**, amely az [Autonómia](/docs/hu/agents/autonomy/) oldalra visz. A gombok ugyanazt a jogosultságot használják, mint a jóváhagyási sor; akinek nincs meg, ezt látja: *Nincs jogod jóváhagyásokról dönteni. Egy tulajdonos vagy admin döntheti el a jóváhagyási sorban.* A máshol már eldöntött kérés ezt jelzi. Jóváhagyás után kérd meg az asszisztenst, hogy próbálja újra: ez a pontos hívás (ugyanaz a tool, ugyanazok az argumentumok) most egyszer engedélyezett. A kártyák a következő üzenet elküldésekor eltűnnek.

Egy általad figyelt chatben az a hívás, amelyet a biztonsági kapu engedélyez, lefut; a kártya csak akkor jelenik meg, ha a kapu eszkalál, és a chat nem áll meg. Ez minden providernél így van — azoknál az EYAS tooloknál is, amelyeket a Grok és a Kimi az eszközhídon át ér el, és amelyek már nem várnak jóváhagyásra csak azért, mert egy tool jóváhagyást igénylőként van megjelölve. Az autonómia-szintek a háttérfutásokra vonatkoznak, nem a figyelt chatekre (lásd [Autonómia](/docs/hu/agents/autonomy/)).

### Agent-haladás {#agent-progress}
A haladás panel a jobb oldali **Futásidő** sávban van, amely magától kinyílik, amíg egy agent fut. A kolléga nevét mutatja, vagy a sima asszisztensnél az *Asszisztens* szót.

| Címke | Jelentés |
|-------|----------|
| **N. lépés / Max** | Akkor látszik, ha a provider jelenti a lépéseit (Claude Code); a lépéssáv csak ekkor jelenik meg |
| **Eszközhívások: N** | Egyébként ez látszik (Grok CLI, Kimi Code CLI és a lépéseket nem jelentő API providerek) |
| **Fut** | A futás folyamatban |
| **N token elszámolva** | Az egész futás bemenete és kimenete, minden modellhívásra összegezve, ahogy a provider jelentette — nem a beszélgetés mérete. Egy CLI-agent minden belső körében újraküldi, amit addig beolvasott, ezért ez sokszorosa lehet annak, amit te írtál |
| **Megszakítás** | A futás megszakítása |

**Körkeret.** Egy chatkör alapból legfeljebb **25** modell-kört használhat. Ha a beszélgetés kollégájának (vagy a projekt alapértelmezett agentjének) saját **Max. körök** értéke van, az érvényes helyette. A keret minden providernél ugyanaz; a Claude Code-nál, a Groknál és a Kiminél ez egyben a CLI saját belső körkorlátja az adott chatkörre. A delegált, specialista- és pipeline-futások (alapból 10) és a csatornaválaszok (alapból 20) megtartják a saját keretüket.

---

## Composer (bevitel)

| Vezérlő | Jelentés |
|---------|----------|
| *Írj egy üzenetet… (Shift+Enter: új sor)* | Fő bevitel — az Enter küld |
| **Fájl csatolása** | Melléklet a következő üzenethez |
| **Prompt Enhancer** | *Prompt Enhancer — segít finomítani a promptot*: megnyitja az iteratív promptfinomító párbeszédablakot küldés előtt |
| **Először terv** (térkép ikon) | *Először terv — a toolok előtt tervet ír és jóváhagyást vár*: ez a küldés tervet ír, és vár — tool nem fut, amíg a tervkártyára nem válaszolsz |
| Hiba | Az elbukott kör egyetlen, a nyelveden írt üzenetet mutat **Részletek megjelenítése** gombbal, és ahol segít, **Szolgáltatóbeállítások megnyitása** gombbal — lásd [Hibák és értesítések](#errors-and-notices). Például: *A(z) Grok CLI leállt: az EYAS nem tudta megerősíteni, hogy elszigetelten fut (…). A kör nem került át másik modellhez.* |
| Kép-chip | Csatolt képnél, olyan modellel, amely nem lát képet: *A(z) &lt;modell&gt; nem lát képet: csak azt tudja meg, hogy kép van csatolva.* God módban nem jelenik meg |
| **Az üzenet nem ment el — adatvédelem** | Az üzenet olyan értéket tartalmazott, amelyet az adatvédelmi szabályzat tilt, és távoli modellhez menne — lásd [Elutasított üzenetek](#refused-messages-privacy) |

### Elutasított üzenetek (adatvédelem) {#refused-messages-privacy}
Egy chatben vagy God módban küldött **új** üzenetet az EYAS elutasít, ha olyan értéket tartalmaz, amelynek adatvédelmi művelete **block** — alapból IBAN, bankszámlaszám, adószám, személyi igazolvány szám, kártyaszám vagy amerikai SSN, valamint bármely block-ra állított egyéni minta —, **és** távoli modellhez menne. Csak az új üzeneted utasítható el: az előzményeket, a memóriát, a tool-eredményeket és a csatolmányok kinyert szövegét soha nem utasítja el, ezek kifelé maszkolódnak. Az e-mail-címeket és telefonszámokat (mask osztály) és a warn osztályú típusokat soha nem utasítja el.

- **Hová megy.** A cél az a modell, amelyen az üzenet futni fog (egy körre szóló felülírás, a beszélgetés rögzített modellje, vagy a kollégája modellje). Helyi az, amelynek endpointja loopback (`localhost`, `127.x`, `::1`), vagy szerepel az adatvédelmi szabályzat helyi gépei között; a CLI providerek (Claude Code, Grok CLI, Kimi Code CLI) és az ismeretlen endpointok távolinak számítanak. Az Auto-ra állított beszélgetés mindig távolinak számít, mert a modelljét az ellenőrzés után választja az EYAS — kivéve, ha az automatikus útválasztás globálisan ki van kapcsolva; ekkor a tárolt modelljét ítéli meg. God módban minden keret-résztvevőt megítél: ha bármelyik távoli, vagy üres a keret, az üzenetet elutasítja.
- **Semmi nem tárolódik.** Az üzenet eltűnik az átiratból, a beszélgetés nem kap új címet, nem rögzül memória, nincs modellhívás, és nem indul God mód verseny. A composer fölött megjelenik **Az üzenet nem ment el — adatvédelem** kártya: név szerint felsorolja az elutasított típusokat (az értékeket soha), és ezeket kínálja: **Küldés ezekkel az adatokkal kitakarva** (újra elküldi úgy, hogy csak a tiltott értékeket cseréli helyőrzőkre, például `[IBAN]`; a maszkolt szöveg tárolódik, látszik és megy ki), **Üzenet szerkesztése** (a szöveget és a csatolmányait visszateszi a composerbe) és **Elvetés**.
- Egy leállított kör újrafuttatását (skill-javaslat vagy tervjóváhagyás után) nem ellenőrzi újra. Kikapcsolt adatvédelmi szabályzat vagy adatvédelmi modul mellett semmit nem utasít el.

Minden elutasítás `privacy.inbound_refused`, minden maszkolt újraküldés `privacy.inbound_masked` auditbejegyzést kap, a típusokkal, a beszélgetéssel és a felhasználóval — értékkel soha. **API:** a `POST /api/v1/conversations/:id/messages` elfogad egy opcionális `privacy: "mask"` mezőt (minden más érték → `400`). Az elutasítás HTTP `422 {error: 'privacy_blocked', code: 'privacy_blocked', message, types, maskedContent}`, még a stream indulása előtt. Lásd [Biztonság és adatvédelem](/docs/hu/admin/security-privacy/#refused-messages).

### Prompt Enhancer párbeszédablak {#prompt-enhancer-dialog}
Iteratív coach, amely küldés előtt **a beszélgetés modellcsaládjához** (Claude, OpenAI, Gemini, Grok, Kimi, …) **alakítja a promptot**. Leírás: *Iteratív prompt-coach — a conversation modellcsaládjához optimalizál. Válassz feladattípust, finomíts, majd Apply.*

| Vezérlő | Jelentés |
|---------|----------|
| Cél / piszkozat mező | Írd le, mit akarsz finomítani (*Írd be a prompt-piszkozatot vagy egy célt — segítek finomítani.*) |
| **Optimalizálva: …** | Cél-modellcsalád — alapból az a modell, amelyen a beszélgetés ténylegesen fut |
| Feladattípus-chipek | **Általános · Kódolás · Kutatás · Elemzés · Írás · Agentikus · Fájl / kép** — a szerkezetet és a checklistet irányítja |
| **Fájl csatolása** | Kontextusfájlok csak az enhancernek (vagy átvitelre) |
| **Küldés** | Finomítás folytatása az enhancerrel |
| **Minőség N/10** | Heurisztikus minőségpont; a **Hiányok: …** a hiányzó checklist-tételeket sorolja; teljes lefedettségnél **Checklist lefedve** |
| **Két alternatíva (rövid + alapos)** | **Rövid** / **Alapos** / **Ajánlott** változatokat kér |
| **Javasolt végleges prompt** | Beilleszthető szövegjelölt |
| **N fájl átvitele** | A mellékletek a fő chatbe is átkerüljenek-e |
| **Apply** | A végleges promptot (vagy az utolsó választ) beszúrja a fő composerbe |

**Tartós** projekt- / agent-rendszerpromptokhoz (nem egyszeri chat-piszkozatokhoz) használd a [Prompt Coach](/docs/hu/ai/prompts/#prompt-coach)-ot a Projektek és az agent-beállítás oldalon.

---

## Kontextussáv (chatter) {#context-rail-chatter}
A jobb oldali oszlop tetején a **Futásidő** sáv van, alatta — ha nyitva van — az OpenCode terminál, majd a fülek:

**Előzmények · Források · Mappák · Következő · Fájlok** (plusz **God**, amíg a God mód be van kapcsolva, vagy ha már volt verseny)

### Előzmények (üzenetek / szűrők)

| Vezérlő | Jelentés |
|---------|----------|
| **Előzmények** | Időrendi jegyzetek és tábla-frissítések |
| **Összes / Jegyzetek / Változások** | Szűrés jegyzetekre vagy mezőváltozásokra |
| *Jegyzet hozzáadása…* + **Jegyzet** | Emberi jegyzet a rekordon (nem chatkör a modellnek) |
| **Jegyzet** / **Frissítés** badge | A bejegyzés típusa |
| **Ma / Tegnap** | Időbeli csoportosítás |

### Források (kód / Odoo pin)

Több **indexelt keresési forrás** jelölhető ki, amelyet ez a beszélgetés használhat (például Odoo 18c + saját addonok). Így egy szálban nem keveredik több Odoo-verzió.

| Vezérlő | Jelentés |
|---------|----------|
| Jelölőnégyzet-lista | Minden regisztrált keresési forrás (címke, verzió, állapot, útvonal) |
| **Összes** / **Törlés (auto)** | Minden forrás rögzítése / a rögzítés törlése |
| **Auto** | Nincs beszélgetésszintű rögzítés — a projekt alapértelmezése vagy a többverziós `needsPin` szabályok érvényesek |
| **N kijelölve** | A kijelölt források száma |
| **Search sources kezelése →** | A `/search-sources` megnyitása |

**Öröklés:** a projekt új beszélgetései, és ha egy meglévő beszélgetéshez projektet rendelsz, a projekt **alapértelmezett kódforrásait** másolják. Itt mindig felülírhatod.

Teljes beállítás: [Keresés — többverziós pin](/docs/hu/daily/search/#többverziós-pin-melyik-fát-használhatja-az-ágens) · [Projektek](/docs/hu/daily/projects/).

### Mappák (munkakönyvtárak) {#working-folders}
Elnevezett gyökerek, amelyeken ez a beszélgetés olvashat és írhat. Az első útvonal a **fő** munkakönyvtár (cwd). A fájltoolok (`read_file`, `edit_file`, `grep`, …) ezekre az útvonalakra vannak zárva — nincs visszaesés az EYAS process könyvtárára. A Claude Code, a Grok CLI, a Kimi Code CLI és az OpenCode az első, még érvényes mappában indul, különben a beszélgetés saját EYAS workspace-ében — soha nem az EYAS szerver saját könyvtárában.

| Vezérlő | Jelentés |
|---------|----------|
| **Munkakönyvtárak** (mezősáv) | Melyik elnevezett gyökér a fő |
| **Mappák** fül | **Mappa hozzáadása** (név + abszolút útvonal), **Fel** / **Le**, **Törlés**; az első bejegyzés a **Fő** |
| *Ehhez a projekthez még nincs alapértelmezett mappa.* | Az alapértelmezést a [projekten](/docs/hu/daily/projects/#working-directories) (vagy a típusán) állítsd be |

Az új beszélgetés a projekt listáját másolja; üres projektlista esetén a **típus** listáját. Projektváltáskor ez a lista lecserélődik. Az útvonalak a telepítéshez tartoznak, nem a termék alapértelmezéseihez.

**Menthetetlen mappák.** Mentéskor az EYAS elutasít egy mappát, megnevezi, és a nyelveden megmondja, miért:

- a fájlrendszer gyökere, a home mappád vagy bármely fölötte lévő mappa (például `/Users` vagy `/home`) — onnan egy modell minden eszköz memóriáját és a hitelesítő adataidat elérhetné; válassz inkább egy projektmappát a home-odon belül;
- egy másik AI-eszköz saját tárolóján belüli mappa (`~/.claude`, `~/.claude.json`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.cursor`, `~/.codeium`, `~/.kimi`, `~/.agents`, `~/.config/agents`, `~/.copilot`, az OpenCode konfig-/adat-/állapotmappái, vagy egy repón belüli `.claude`/`.grok`/… `memory` mappa), vagy azok a CLI-bejelentkezési home-ok, amelyeket az EYAS a Groknak és a Kiminek tart fenn (`data/cli-homes`);
- jegyzet-vaulton vagy memóriatáron belüli mappa: bármely Obsidian vault, az Obsidian alkalmazásbeállításai, egy `ai-memory` nevű mappa, vagy a `security.foreignMemoryPaths` alatt felsorolt útvonal;
- az EYAS saját adatmappáján belüli mappa (memória-vault, adatbázis, kulcsok) — kivéve egyetlen beszélgetés-workspace-t, a Studio projekteket és a böngészőletöltéseket; magát a workspaces mappát elutasítja, mert az minden beszélgetés workspace-ét tartalmazza;
- érzékeny helyek: `.ssh`, `.env` fájlok, `master.key`, az adatbázis mappája;
- nem abszolút útvonal, nem létező vagy nem olvasható mappa, és mappa helyett fájl;
- olyan mappa, amely egy védett helyet **tartalmaz** — az üzenet megnevezi, mit talált benne: az EYAS saját home-ját, adatmappáját, adatbázisát vagy a beszélgetés-workspace-ek mappáját (például az EYAS forrás-checkoutot, amelyben a `data/` van, vagy magát az EYAS home-ot akkor is, ha az `EYAS_DATA_DIR` máshová helyezte az adatokat); egy másik AI-eszköz tárolóját vagy egy EYAS-os CLI-bejelentkezési mappát (például a `~/.config` mappát, amelyben az OpenCode mappája van, vagy egy repót `.claude/memory` mappával); egy jegyzet-vaultot (egy mappát, amelyben `.obsidian` van, vagy egy vaultot az Obsidian vaultlistájából — például a `~/Documents` mappát, amelyben az *Obsidian Vault* van), egy `ai-memory` mappát vagy egy `security.foreignMemoryPaths` bejegyzést.

**Miért kerül elutasításra az a mappa is, amely ezek egyikét csak tartalmazza.** Egy CLI, például a Claude Code, kérdezés nélkül olvas és keres a munkamappáján belül, és a kiadási ellenőrzés a valódi binárison igazolta, hogy az ilyen olvasások soha nem jutnak el a jóváhagyási lépésig. Ezért egy védett helyet tartalmazó mappát nem biztonságos modellnek átadni. Válassz helyette szűkebb mappát, például a `~/Documents` alatti projektmappát vagy a repó egy külön klónját. A csak az alakjukról ismert vaultokat és memóriamappákat egy korlátozott átnézés találja meg — 8 szint mélységig, legfeljebb 2000 mappa, a `.git` és hasonló mappák, valamint a `node_modules` kihagyásával; egy mélyebben lévőbe történő olvasást az EYAS továbbra is útvonalanként elutasít, és az EYAS saját `grep` és `glob` toolja soha nem néz bele egy védett almappába. Ha egy új beszélgetés mappáit elutasítja, a beszélgetés nem jön létre.

**A korábban mentett, most elutasított mappákat** az EYAS nem írja át, de minden futás kihagyja őket: az EYAS saját fájltooljai, a biztonsági kapu, valamint a Claude Code, a Grok, a Kimi és az OpenCode munkamappája. A rendszerprompt sem nevezi meg őket többé. A chatben a kör ezt az értesítést mutatja: *A(z) &lt;path&gt; mappa kimaradt ebből a körből: az EYAS már nem engedi, hogy egy modell ott dolgozzon, mert az maga egy védett hely, egy védett helyen belül van, vagy tartalmaz egyet (az EYAS saját adatai, egy másik AI-eszköz tárolója, egy jegyzettár vagy a saját mappád). Módosítsd a beszélgetés vagy a projektje Mappák beállítását.* A csak hiányzó mappát ez nem érinti. A háttérben futó kártya-, csapat- és specialistafutásoknál a kihagyás csak a szervernaplóban látszik. Ha minden tárolt mappa elutasításra kerül, az EYAS saját fájltooljainak nincs mappájuk, a CLI pedig a beszélgetés saját EYAS workspace-ében dolgozik. A Kimi Code CLI ugyanezeket a mappaszabályokat követi; a viselkedését itt hoston még nem ellenőrizték. Minden mentés a teljes listát ellenőrzi, ezért egy már elutasított mappát előbb vegyél ki, mielőtt a lista más változását mentenéd. Az API elutasított mappára `400 {error, code, path, found}` választ ad, ahol a `code` ezek egyike: `home`, `providerHome`, `vault`, `eyasData`, `sensitive`, `containsEyasData`, `containsProviderHome`, `containsVault`, `notAbsolute`, `notFound`, `notDirectory`, a `found` pedig — a három `contains…` kóddal együtt küldve — a mappán belül talált védett hely.

**Minden beszélgetésnek van munkamappája.** Az a beszélgetés, amely se tőled, se a projekttől, se a típusától nem kap mappát, létrehozáskor megkapja a saját **EYAS workspace**-ét — bármelyik projektben, akkor is, ha a kérés üres mappalistát küld. A mappa nélküli régebbi beszélgetések, és azok, amelyekből minden mappát eltávolítottak, a következő üzenetnél kapják meg a workspace-üket. A **Mappák** fülön ugyanúgy látszik, mint bármelyik mappa. Amit a modell oda ír, az bekerül a beszélgetés csatolmányai közé ([Dokumentumok](/docs/hu/knowledge/documents/)), a média-jobokkal és a Studio-renderekkel együtt — akkor is, ha a kör az EYAS tool-pipeline-ja nélkül futott. **Nincs mappa** csak akkor jelenik meg, ha a workspace-ek helye nem írható. Az általad beállított mappákat soha nem cseréli le.

A workspace-ek soha nincsenek git checkouton belül: egy git repóban indított CLI modell (Claude Code, Grok, Kimi) a repót a saját projektjének tekinti, és betölti annak utasításfájljait, git státuszát, jogosultsági szabályait és projektenkénti memóriáját. Hogy hol vannak, és hogyan helyezheted át őket az `EYAS_WORKSPACES_DIR`-rel: [Konfiguráció — Beszélgetés-workspace-ek](/docs/hu/deploy/configuration/#conversation-workspaces).

### Üzleti mezők (követett)

| Mező | Jelentés |
|------|----------|
| **Szakasz** | Pipeline-fázis |
| **Projekt** | Projekthivatkozás |
| **Prioritás** | Prioritás |
| **Állapot** | Állapot |
| **Határidő** | Határidő |

A változások **Frissítés** bejegyzésként jelennek meg az **Előzmények** fülön.

### Tevékenységek

A **Következő** fül (*Következő lépések ehhez a rekordhoz*) a beszélgetés tevékenységeit listázza.

| Vezérlő | Jelentés |
|---------|----------|
| **Ütemezés** | Az ütemezési űrlap megnyitása |
| **Típus** | Tevékenységtípus (teendő, követés, review, …) |
| **Összefoglaló** | Opcionális összefoglaló szöveg |
| **Határidő** | Mikor esedékes |
| **Tevékenység ütemezése** | Megerősítés |
| **Késznek jelöl** | Egy tevékenység lezárása |
| **Lejárt / Ma / Tervezett** | Csoportosítás |
| **N kész** | A lezártak száma |

### Következő / Fájlok / Futásidő

| Terület | Jelentés |
|---------|----------|
| **Következő** | Tevékenységek és következő lépések ehhez a rekordhoz (fent) |
| **Fájlok** | A beszélgetés mellékletei, a modell által a workspace-ben írt fájlokkal együtt |
| **Futásidő** | Az összecsukható sáv a fülek fölött: a futási fa, az agent-haladás és az al-beszélgetés fa. Magától kinyílik, amíg egy agent fut, és külön van az Előzményektől, így az agent tevékenysége soha nem keveredik az üzleti jegyzetekkel |

---

## Csapatfunkciók

### Al-beszélgetés fa

| Vezérlő | Jelentés |
|---------|----------|
| **Csapat / Al-beszélgetések** | Többágenses munkához indított gyerek-szálak (a Futásidő sávban) |
| **Kibontás** (*Team Dashboard megnyitása*) | A dashboard-réteg megnyitása |
| **N. kör** | Egy al-szál haladása |

### Team Dashboard

| Vezérlő | Jelentés |
|---------|----------|
| **Team Dashboard** / **Összecsukás** | A réteg címe / bezárása |
| **Fázis:** | Az aktuális orkesztrációs fázis |
| **N kör / N token** | Felhasználás |
| **Megállapítás / Döntés / Blokkoló / Kérdés / Adat** kategóriák | A megosztott csapat-memória bejegyzéstípusai |
| **Beszélgetés megnyitása** | Ugrás egy tag al-chatjére |
| **Csapat-memória** | Összesített megállapítások, döntések és blokkolók |

### Csapatjavaslat-kártya

A szokásos specialista-szétosztás (`run_specialist`) **nem** mutatja ezt a kártyát. A `/team` parancsra, kifejezett csapatkérésre, hiányzó specialistáknál vagy nagy (epic) munkánál jelenik meg. A javaslatot a háttérmodell írja egy izolált hívásban; jogosult háttérmodell nélkül a kártya egyetlen agentet javasol (lásd [Csapatok és delegálás](/docs/hu/agents/teams/)).

| Vezérlő | Jelentés |
|---------|----------|
| **Team javaslat** | Többágenses végrehajtási terv |
| **~N token · költség** | Becslés |
| **Fázisok** | Párhuzamos vagy sorban futó fázisok |
| **Hiányzó specialisták** | Még létre nem hozott sablonok |
| **Létrehozom most** | A hiányzó agentek létrehozása |
| **Elfogadom / Módosítom / Kihagyom / Kihagyom (kockázatos)** | A terv elfogadása, módosítása (ha elérhető) vagy kihagyása |

### Átadás {#handoff}
Amikor egy kolléga átveszi a munkát (`handoff_to_colleague`), a tool-soron **&lt;név&gt; megnyitása** visz a home-szálára, és a kolléga ott **azonnal elindul**: az átadási eligazítás lesz a futás célja és a memória-felidézés lekérdezése, a futás pedig felügyelt, autonóm, és az [autonómia](/docs/hu/agents/autonomy/)-létra kapuzza, mint egy tábla-kártya futását. Ha a kolléga a home-szálában épp foglalt (egy chatkör vagy egy korábbi futás még dolgozik, vagy egy futás jóváhagyásra vár), az átadást *busy* üzenettel elutasítja — próbáld újra később, vagy használd az `assign_task`-ot. A saját magadnak vagy egy specialistának szóló átadást elutasítja, és egy megismételt átadás soha nem indít második futást.

<h3 id="run-tree--workflow">Futási fa / munkafolyamat</h3>
A Futásidő sávban mutatja az aktuális kör futásszerkezetét (**Munkafolyamat** címke), minden providernél — API providereknél (Anthropic, OpenAI, Gemini, OpenRouter, Kimi API, lokális modellek, …) és a Claude Code-nál, a Grok CLI-nél és a Kimi Code CLI-nél egyaránt.

- A beszélgetés csomópontja mutatja az éppen futó toolt, a körszámlálót (CLI-nél a saját belső lépéseit), az eddig használt tokeneket és egy státuszt: **Várakozik**, **Fut**, **Kész**, **Sikertelen**, **Megszakítva** vagy **Szüneteltetve**. Az emberi jóváhagyásra váró futás **Szüneteltetve** állapotban látszik.
- Minden új üzenet friss fát indít: az előző kör fája lecserélődik, nem bővül.
- Amikor egy futás véget ér, a fejléc amerikai dollárban mutatja a költségét: a provider saját költségét, ahol jelenti (Claude Code, sikertelen futásnál is), különben a tokenhasználatból a beállított árakkal számolva (a `model.pricing` felülírások érvényesek). Ha egy provider nem jelentette a felhasználását, a költség *—*, a tooltip pedig ezt írja: *A költség ismeretlen — a szolgáltató nem jelentette a felhasználást* — soha nem kitalált $0.
- **Grok- és Kimi-tervek.** Ha a modell teendőlistát vezet, minden bejegyzése **Tervlépés**ként jelenik meg a beszélgetés alatt, egy checklist ikonnal és a státuszával (várakozik, fut, kész).
- A specialisták minden providernél ugyanúgy jelennek meg; a Claude Code futásai nem mutatnak saját csomópontokat. Csapatfutásban minden tag mutatja az éppen futó toolját, bármelyik provideren fut.
- A régebbi, eltárolt fák továbbra is visszajátszhatók.

---

## God mód

A God mód **ugyanazt a feladatot** futtatja párhuzamosan több modellen, majd összeveti az eredményeket. Nem negyedik orkesztrációs stílus: a Szóló / Automatikus / Mély továbbra is azt írja le, hogyan bontja fel a munkát minden worker; a God mód csak annyit dönt el, hogy több modell versenyez (nem specialistákból álló csapat). Kombinálható: God mód + Mély azt jelenti, hogy minden versenyző modell a saját magán belül is szétoszthatja a feladatot.

**Nincs automatikus összefésülés.** Egy munkaterület nyer; a többiek egyedi ötletei listázódnak, te alkalmazod őket.

| Téma | Jelentés |
|------|----------|
| **Keret** | **Beállítások → Isten mód** (kártya a Modell-hozzárendelések alatt). 2–5 élő provider/modell pár. Páros számnál döntőbíró kell. |
| **Menü** | A beszélgetés orkesztrációs vezérlőjének utolsó tétele (elválasztó után): Szóló, Automatikus, Mély, majd **God mód**. Bekapcsolása **nem írja felül** a Szóló/Automatikus/Mély értéket (a workerek azt öröklik). A Szóló/Automatikus/Mély választása kikapcsolja a God módot. Érvényes keret nélkül a tétel ezt írja: *Adj meg legalább 2 modellt a Beállítások → God mód alatt*. |
| **Költség** | Bekapcsolás után az első küldés megerősítést kér (*Elindítod a God mód futást?* — keret, becslés, plafon). A későbbi küldéseknél ugyanabban a beszélgetésben csak a banner látszik. Ha a becslés meghaladja a plafont, a küldés blokkolt, amíg nem emeled a plafont vagy nem kapcsolod ki a God módot. |
| **Mappák** | A workerek a beszélgetés munkamappáinak izolált másolatában futnak (lehetőleg git worktree). Mappák nélkül a futás elindul, fájl-izoláció nélkül. |
| **Győztes + meglátások** | Csak a győztes megváltozott fájljai kerülnek a beszélgetés mappáira. A többiek egyedi meglátásai a **God** fülön listázódnak — te alkalmazod őket, automatikus összefésülés nincs. |

### Keret a Beállításokban

A [Beállítások](/docs/hu/admin/settings/) oldalon, a Modell-hozzárendelések alatt az **Isten mód** kártya a globális keret, amelyet minden God módos beszélgetés használ.

| Mező | Jelentés |
|------|----------|
| **Modell hozzáadása** | 2–5 élő provider/modell pár. Duplikátum nem megengedett. |
| **Döntőbíró** | A keret egyik modellje. **Páros számnál kötelező**; mindig ajánlott (egy elbukó worker páros maradékot hagyhat). A döntőbíró versenyző, nem külön bíró. |
| **Költségplafon (USD)** | Opcionális. Ha az indulás előtti becslés efölött van, a futás nem indul. Ha a költés futás közben átlépi a plafont, a még nem végzett workerek leállnak, és a már végzettek közül dől el a győztes. |
| **Munkamappák megőrzése (óra)** | Az izolált fák ennyi óra után törlődnek (alapból 72). |

A keret mentése nem módosítja a már elindult futásokat: minden küldés pillanatképet készít a keretről.

A beszélgetés modellválasztója halványított, és a God módos küldés figyelmen kívül hagyja — a Beállítások kerete fut, és minden worker mindig a saját keret-modelljén fut. A beszélgetésen beállított erőfeszítés minden versenyzőre átmásolódik, a Mély mód pedig a versenyzők módjaként öröklődik; ezután minden versenyző szintjét az EYAS a saját modelljéhez igazítja. A keresztértékelés szavazatai is a beszélgetés erőfeszítését használják.

### God mód bekapcsolása

1. Nyisd meg a beszélgetés orkesztrációs menüjét, és válaszd a **God mód** tételt.
2. Küldj üzenetet. Az első küldés költség-megerősítést kér (hány modell versenyez, becsült USD, plafon). Az indításhoz kattints a **Küldés** gombra.
3. Amíg be van kapcsolva, **God mód · N · ~$x** banner marad a beszélgetésen. A jobb oldali sávon megjelenik a **God** fül.
4. A **Leállítás** az egész versenyt leállítja, nem csak egy workert.

### Izoláció és a győztes

Minden worker saját mappát kap (git worktree, ha a munkakönyvtár repó; különben másolat). Munka közben a workerek nem látják egymás fájljait.

Győztes választás után **csak a győztes megváltozott fájljai** másolódnak a beszélgetés mappáira. A többi worker fájljai az izolált fájukban maradnak a megőrzési idő lejártáig. Ha a beszélgetésnek nincs munkamappája, nincs mit átemelni; a győztes akkor is a leírt válaszokból dől el.

### A God fül

A sáv **God** füle akkor látszik, ha a God mód be van kapcsolva, **vagy** a beszélgetésnek már volt legalább egy God módos futása (akkor is marad, ha később kikapcsolod).

#### Fejléc

Az aktuális fázis, plusz az összes token, USD és időtartam.

| Fázis | Jelentés |
|-------|----------|
| **Előkészítés** | Keret-pillanatkép, izolált mappák |
| **Verseny** | A workerek párhuzamosan ugyanazt a felhasználói üzenetet futtatják |
| **Értékelés** | A célba értek pontozzák egymás munkáját és szavaznak |
| **Döntés** | Győztes rögzítve |
| **Átemelés** | A győztes fájljai a beszélgetés mappáira másolódnak |
| **Kész / Sikertelen / Megszakítva** | Végállapot |

Egy elbukott worker a provider hibáját is mutatja (például túlterhelt API).

#### Lépések

Időbélyeges napló arról, mi történt valójában:

| Lépés | Jelentés |
|-------|----------|
| A futás elindult | Verseny a pillanatnyi keretből |
| A workerek párhuzamosan indultak | Minden élő modell ugyanazt a feladatot kezdi |
| *Modell* kész / elhasalt | Annak a workernek a saját próbálkozása véget ért |
| Keresztértékelés | A célba értek olvassák egymás összefoglalóját és szavaznak |
| Győztes: *modell* | Döntés rögzítve |
| A győztes munkája átemelve | A győztes fájljai a beszélgetés mappáira másolódnak |
| A futás kész / sikertelen / megszakítva | Végállapot |

A napló előtti, régebbi futásoknál a befejezési időkből újraépített idővonal látszik.

#### Hogyan dőlt el a győztes

Ez a blokk megmondja az alkalmazott szabályt, a szavazatszámokat, és **ki kire szavazott**.

| Szabály | Mikor |
|---------|-------|
| **Többségi szavazat** | Egy modell több érvényes szavazatot kapott, mint bármelyik másik. Egy modell **nem szavazhat magára**; az önszavazat eldobódik. |
| **Döntetlen — a döntőbíró döntött** | Két vagy több modell holtversenyben van, és a döntőbíró köztük van. |
| **Döntetlen — a hamarabb kész** | Két vagy több modell holtversenyben van, és a döntőbíró hiányzik vagy nincs köztük. A holtversenyben az nyer, aki hamarabb elkészült. |
| **Csak egy ért célba** | Minden más worker elbukott vagy megszakadt; az egyetlen túlélő nyer, és nincs keresztértékelős szavazás. |

Ha egy értékelő hívás elbukik, annak a workernek egyszerűen nincs szavazata. A döntés a leadott szavazatokkal megy tovább.

#### Keresztértékelés

A verseny után a célba értek **egyetlen** strukturált keresztértékelést végeznek (nincs élő vita). Minden értékelő egyetlen izolált, tool nélküli hívásban szavaz, a saját keret-modelljén. A többiek válaszait és fájlváltozásait egyértelműen jelölt adatként kapja, soha nem utasításként, így egy társ kimenetében lévő szöveg nem mondhatja meg az értékelőnek, hogyan szavazzon. Minden értékelőnél, külön kattintás nélkül látszik:

- kire szavazott
- 1–5 pont: **minőség**, **teljesség**, **kockázat**
- írásos véleménye a többiek munkájáról
- egyedi meglátások, amelyeket szerinte a többiek kihagytak
- a jelzett kockázatok

A modellkártya lenyitásával annak a modellnek a **saját** munkája (amit az értékelés előtt készített) és az esetleges worker-hiba olvasható.

#### Egyedi meglátások

A **nem győztesek** meglátásainak de-duplikált listája, amelyek a győztes saját listájában nem szerepelnek. Ha kellene belőlük valami az átemelt munkaterületre, te viszed át — a rendszer semmit nem fésül össze automatikusan.

### Gyermek-beszélgetések

Minden worker egy gyermek-beszélgetés, címe `God <modell>` alakú. A beszélgetéslistában al-beszélgetésként megjelenhetnek. God mód **kikapcsolva** fut rajtuk, így nem indíthatnak újabb versenyt.

A globális összevetés (győzelmi arány modellenként, átlagos költség-szorzó egyetlen modellhez képest) a [Megfigyelhetőség](/docs/hu/admin/observability/) oldalon van. Ott egy futásra kattintva a beszélgetés God füle nyílik meg.

---

## Skill-javaslatok

Egy illeszkedő skill **javaslat, amelyre a kör vár** — semmi nem fut belőle, amíg nem válaszolsz. A kártya mutatja a skill nevét, az illeszkedő mintát és a pontszámot.

| Vezérlő | Jelentés |
|---------|----------|
| **Egy készség illeszkedik — használjam?** | Cím |
| **Használd** | Elfogadás erre a beszélgetésre; a kör a skillel folytatódik |
| **Most ne** | Elutasítás csak erre a beszélgetésre |
| **Kapcsold ki** | Elutasítás itt **és** a skill globális letiltása (csak owner/admin). Nem illeszkedik újra, amíg valaki vissza nem kapcsolja a [Készségek](/docs/hu/automation/skills/) oldalon |

A válaszod megjegyződik erre a beszélgetésre. Aki chatelhet, de skilleket nem kezelhet, az is látja a **Használd** és a **Most ne** gombot.

---

## Először terv {#plan-mode}
A composer térkép ikonja az **Először terv** (*Először terv — a toolok előtt tervet ír és jóváhagyást vár*). Ez a küldés **nem** futtat toolt, a szál állapota pedig **Tervre vár** lesz. A tervet a beszélgetés saját modellje írja egyetlen izolált hívásban — toolok nélkül, egy körben, soha nem másik providerrel. Ha ez a hívás elbukik, a kör terv nélkül fut.

A **Terv erre a körre** kártya mutatja a célt, a számozott lépéseket (a sikerkritériumaikkal), és ha a terv megad ilyet, egy *Visszaállítás: …* sort arról, hogyan lehetne visszacsinálni.

| Vezérlő | Jelentés |
|---------|----------|
| **Jóváhagyás** | A terv végrehajtása |
| **Terv kihagyása** | A kör terv nélkül fut |
| **Elutasítás** | Megáll — semmi nem futott |

Amíg a kártya vár, semmi nem futott. A későbbi futás sárga és piros tooljai a szokásos módon továbbra is az [Autonómián](/docs/hu/agents/autonomy/) mennek át.

---

## Csatolt designok {#attached-designs}
A beszélgetés felső sávjában a formák ikon a **Design**. A csatolt vásznak a szál minden körével utaznak (az agent a `design_read`-del kérhet le részeket). A projekt designjai az új beszélgetésre másolódnak, ha a projektben hozod létre; utána a beszélgetés birtokolja a linkeket.

| Vezérlő | Jelentés |
|---------|----------|
| **Csatolt designok** | Minden vászon legördülő listája, pipával az itt csatoltakon |
| Számláló | Hány van csatolva |
| **Design megnyitása** | Ugrás a `/design` oldalra |
| *Még nincs design.* | Üres lista — előbb hozz létre vásznat |

---

## Kapcsolódó

- [Keresési források és többverziós pin](/docs/hu/daily/search/)
- [Projektek — munkakönyvtárak és wiki](/docs/hu/daily/projects/)
- [Agentek áttekintése](/docs/hu/agents/overview/)
- [Csapatok és delegálás](/docs/hu/agents/teams/)
- [Providerek](/docs/hu/ai/providers/)
- [Tábla](/docs/hu/daily/board/)
- [Hangprofilok](/docs/hu/agents/voice/)
- [Memória](/docs/hu/knowledge/memory/)
- [Design vásznak](/docs/hu/knowledge/design/)
- [Készségek](/docs/hu/automation/skills/)
- [OpenCode](/docs/hu/automation/opencode/)
- [Megfigyelhetőség — God Mode fül](/docs/hu/admin/observability/)
