---
title: Memória
description: Amire az EYAS emlékszik — automatikus vault-jegyzetek, öt szint, minden üzenet nyers naplója, és melyik tárat mikor használd.
---

**Mire való.** A memória az EYAS saját hosszú távú tára. Egy tartós tényt, amit a beszélgetésben kimondasz, vault-jegyzet lesz belőle kérés nélkül, és ugyanezt a jegyzetet olvassa vissza minden későbbi beszélgetés. Ezen az oldalon a working blokkokat, az epizodikus tényeket, a vault-fájlokat és a review sort nézed — nem wiki-t szerkesztesz. Hogy a megjegyzett szöveg hogyan jut el egy modellhez, azt a [Hogyan működik a felidézés](#how-recall-works) szakasz írja le. A 0.8.23 óta az EYAS minden általa eltárolt üzenetről nyers naplót is vezet; mindent, amit tudni kell róla, [A nyers napló](#the-raw-record) szakasz mond el alább.

## Mikor használd {#when-to-use-it}

- Az asszisztensnek emlékeznie kell rád, a munkamódodra, vagy egy projekt korlátaira.
- Tény hangzott el a chatben, és ellenőrizni akarod, bekerült-e a vaultba (vagy miért maradt ki a capture).
- Review, tag, gráf vagy konszolidáció kell — vagy a **Mai jegyzet**.
- Választanod kell Memória, Tudásbázis-wiki, Dokumentumok és kézzel írt vault-fájl között (lásd alább).
- Erre a példányra ki akarod kapcsolni a capture-t (`memory.capture.enabled: false`) — vagy a nyers naplót is (`memory.l0.enabled: false`).
- Egy modell az EYAS izolációja nélkül futott, és amit írt, azt minden modell elől el kell rejteni (**Egy szolgáltató memóriájának karanténba helyezése**, csak owner).
- Látni akarod, min fut itt a felidézés — a helyi beágyazót, hogy a memória mekkora része kapott már vektort, és mely rögzítési kapcsolók vannak ténylegesen bekapcsolva (a **Felidéző motor** kártya).

## Tipikus munkafolyamat {#typical-workflow}

1. Nyisd meg a **Memória** oldalt az oldalsávon (**Tartalom** szakasz) — útvonal: `/memory`. (A **Beállítások → AI és modell** alatt is szerepel.)
2. Nézd meg az **Áttekintés** fület (számok, relevancia, legutóbbi epizodikus emlékek és a **Felidéző motor** kártya), majd a **Vault fájlok** fület a tartós jegyzetekhez.
3. Folytass egy ~40 karakternél hosszabb beszélgetést, amely tartós tényt mond ki. A válasz után térj vissza ide: új vault-jegyzetet kell látnod (`user`, `feedback`, `domain`, `project` vagy `reference` fajtájút).
4. Ha semmi nem jelent meg: túl rövid volt, a capture ki van kapcsolva, egyetlen háttérmodell sem tudta lefuttatni a capture-t (lásd [A capture a háttérmodellen fut](#capture-runs-on-the-background-model)), vagy God Mode kör volt (maga a verseny köre nem ír vault-jegyzetet; minden worker futását külön rögzíti). Ha így is kell, írd meg kézzel a vaultba. A God Mode körből a győztes válasz attól még bekerül a nyers naplóba — lásd [A nyers napló](#the-raw-record).

## Melyik tárat használd {#which-store-to-use}

| Tár | Feladat |
|-----|---------|
| **Memória** (ez az oldal) | Tények, amelyeket az EYAS automatikusan rögzít — az agentek maguk soha nem írnak memóriát. Az EYAS egy egysoros indexet, és amit az adott üzenethez felidézett, minden későbbi körhöz csatol. Ez a forrás, „mit tud rólad az asszisztens.” |
| **Tudásbázis** wiki | Kurált oldalak, **te** szerkeszted (space-ek, fa, verziók). A capture ide nem ír. |
| **Dokumentumok** | Feltöltött fájlok (PDF, kép, …) retrievalhez — nem identitás-jegyzetek. |
| **Vault-fájlok** (kézzel írt markdown) | Ugyanaz a vault, mint a capture (`<data dir>/vault/…`, alapból `data/vault/…`). Írj egyet magad; az EYAS felveszi. **Ne** a `~/.claude` vagy `~/.grok` legyen ez a tár. |
| **Projekt-wiki** | Projektenkénti ticket- és döntésoldalak, nem globális memória. |
| **Nyers napló** | Minden üzenet, amit az EYAS eltárol, szó szerint és tömörítve megőrizve még egyszer. A 0.8.23 óta automatikusan íródik; egyetlen oldal sem jeleníti meg, az asszisztens pedig csak a felidézésen keresztül éri el. |

A gép host Claude / Grok memóriája **nem** a forrás, és a modellek nem is érik el. A Claude Code mindig izoláltan fut, és nem tölt be host konfigurációt vagy auto-memóriát; a Grok és a Kimi a saját EYAS home-jában fut; a biztonsági kapu bármely más tool memóriájának olvasását és írását is elutasítja; az EYAS-on kívül memóriát tartó MCP szerverek pedig tiltottak. A master prompt ugyanezt mondja minden agentnek (lásd [Promptok — a memória-szerződés](/docs/hu/ai/prompts/#the-memory-contract-in-the-master-prompt)). Lásd [Az EYAS-on kívüli memóriát az EYAS elutasítja](#memory-outside-eyas-is-refused).

## Funkciók {#features}

Alcím az appban: *5-rétegű hibrid memóriarendszer — működő, epizodikus, szemantikus/procedurális vault, archívum*.

### Műveletek {#actions}

| Vezérlő | Jelentés |
|---------|----------|
| **Mai jegyzet** | Ugrás a mai jegyzetre, vagy létrehozása |
| **Konszolidálás most** | A konszolidáló futtatása (emlékek előléptetése/lefokozása) |
| **Frissítés** | A statisztikák újratöltése |

A fülek fölött a **Reggeli tájékoztató** kártya mutatja a legutóbbi éjszakai reflexió összefoglalóját, ha van ilyen (a reflexiós job alapból ki van kapcsolva: `memory.reflection.enabled`).

### Fülek {#tabs}

| Fül | Tartalom |
|-----|----------|
| **Áttekintés** | Statisztikák, relevancia-grafikonok és a legutóbbi epizodikus emlékek, alattuk a **Felidéző motor** és az **Egy szolgáltató memóriájának karanténba helyezése** kártya (utóbbi csak ownernek) |
| **Munka memória** | Rövid élettartamú blokkok (24 óra) |
| **Epizodikus** | Tények/epizódok relevanciával |
| **Vault fájlok** | Markdown vault-böngésző |
| **Archívum** | Alacsony relevanciájú, archivált tételek |
| **Gráf** | Memóriagráf nézet |
| **Címkék** | Címkeböngésző |
| **Véleményezés** | Review-sor a memória karbantartásához |

### Áttekintés {#overview}

| Statisztika | Jelentés |
|-------------|----------|
| **Működő blokkok** | Aktív munkablokkok (24ó TTL) |
| **Epizodikus tények** | Epizodikus darabszám (+ érvénytelenítettek) |
| **Vault fájlok** | Szemantikus + procedurális markdown fájlok |
| **Archivált** | Alacsony relevanciájú archivált tételek száma |
| **Előléptetésre kész** → vault | Nagy értékű epizodikus jelöltek |
| **Lefokozásra kész** → archívum | Alacsony relevanciájú jelöltek |
| Relevancia min / átl / max | Eloszlás |
| **Leggyakoribb címkék** / **Epizodikus — Forrás szerint** | Bontások |

A statisztikák alatt a [Felidéző motor](#recall-engine) és az [Egy szolgáltató memóriájának karanténba helyezése](#quarantine-a-providers-memory) kártya következik.

### A fülek részletei {#tab-details}

A **Munka memória** minden sora ezt mutatja: *N karakter · N× hozzáférés · lejár: (időpont)*.

Az **Epizodikus** fülön egy sorra kattintva nyílik meg a részletezés:

| Mező | Jelentés |
|------|----------|
| **Relevancia** | Fontossági pontszám |
| **érvénytelenítve** | Már nem megbízható vagy nem aktuális |
| **ID / Forrás / Forrás azonosító / Ügynök** | Eredet |
| **Hozzáférések száma / Beszélgetések száma** | Használat |
| **Érvényes ettől / Érvénytelenítve / Létrehozva / Utolsó hozzáférés** | Életciklus-időbélyegek |
| **Embedding hash** | Van-e a tételnek vektora |
| **Címkék** | A tétel címkéi |

A **Vault fájlok** fül:

| Vezérlő | Jelentés |
|---------|----------|
| **Fájlok** | A vault útvonalai |
| **Frontmatter** | YAML-metaadatok |
| **címkék:** / **hivatkozások:** | Címkék és wikilinkek |
| **Tartalom** | Markdown törzs |
| **Visszahivatkozások** | Az ide linkelő jegyzetek |

Az **Archívum** minden sora ezt mutatja: *archiválva (dátum) · eredeti (dátum)* és *id · eredeti id*. A konszolidáló ide mozgatja az alacsony relevanciájú tételeket.

### Felidéző motor {#recall-engine}

Az **Áttekintés** fül **Felidéző motor** kártyája csak olvashatóan mutatja azt a gépezetet, amelyen keresztül minden modell felidéz. Ugyanaz, bármelyik chat-provider válaszol, és a kártyán semmi nem módosítható.

| Sor | Mit mutat |
|-----|-----------|
| **Beágyazó** | A helyi modell, amely a memóriát és a lekérdezéseket vektorrá alakítja: *Többnyelvű e5 (helyi)*, ha a multilingual-e5-small súlyai betöltődtek, különben *Hash-alapú szótő-beágyazó (helyi tartalék)*; alatta a modell azonosítója. *Ki* csak akkor, ha ezen az indításon egyetlen beágyazó sem jött létre — ekkor a vektoros felidézés ki van kapcsolva (lásd [A vektoros keresés mindig helyben fut](#vector-search-always-runs-locally)). |
| **Vektorral rendelkező összefoglalók** / **Vektorral rendelkező tények** | *X / Y*. Az Y azoknak az összefoglalóknak és tényeknek a száma, amelyeket a felidézés visszaadhat: aktuálisak, nincsenek felülírva és nincsenek karanténban; a `contains-secrets` címkéjűek kimaradnak, hacsak a `memory.recall.includeSecrets` nincs bekapcsolva. Az X az, hogy ezek közül hánynak van már vektora a jelenlegi beágyazótól. A különbség a következő memóriaírás után másodperceken belül eltűnik. Egy korábbi beágyazó vektorai nem számítanak; a következő induláskor cserélődnek. |
| **Vektorok utolsó frissítése** | Mikor futott utoljára a háttérben dolgozó vektorkészítő ebben a szerverfolyamatban. Újraindítás után *Indulás óta még nem*, amíg az első menete le nem fut — ez pár másodperccel az indulás után történik. |
| **Projekt-partíciók** | Hány projektnek és projekttípusnak van saját partícióba sorolt vektora — ez tartja távol egy projekt memóriáját egy másik projekt felidézésétől. Csak azok a partíciók számítanak, amelyekben most is van vektor; a globális memóriának mindig saját partíciója van. |
| **Nyers napló** | Rögzül-e a [nyers napló](#the-raw-record): a `memory.l0.enabled` be van kapcsolva, és a rögzítés az induláskor elindult. |
| **Eszközkimenet rögzítése** | `memory.l0.captureToolResults`. *Ki*, ha a nyers napló ki van kapcsolva, mert akkor semmi nem rögzül. |
| **Gondolkodás rögzítése** | `memory.l0.captureThinking`. Szintén *Ki*, ha a nyers napló ki van kapcsolva. |
| **Titkokat tartalmazó jegyzetek felidézése** | `memory.recall.includeSecrets` |
| **Felidézési keret (100k tokenes ablak)** | `memory.index.budgetChars` (alapból 2400 karakter): a felidézett blokk mérete 100k tokenes kontextusablaknál; a blokk a válaszoló modell ablakával skálázódik (lásd [Állandó memóriasorok](#standing-memory-lines)). |

A kártya azt a konfigurációt mutatja, amellyel az EYAS fut, és minden oldalbetöltéskor frissen olvassa; a `local.yaml` módosítása újraindítás után látszik. A háttérben a `GET /api/v1/memory/engine` áll, amely memória-olvasási jogot kér (owner, admin, user és agent szerepkör; vendégnek `403`). Csak darabszámokat, kapcsolókat és a beágyazó azonosítóját adja vissza — memóriatartalmat soha.

## Tartós jegyzetek {#durable-notes}

A tartós jegyzet egy megmaradó tény, nem egy esemény feljegyzése: ki vagy,
hogyan szeretnéd, hogy dolgozzanak, mik egy projekt megszorításai. Mindegyik
egy-egy markdown fájl a vaultban, és a modell minden fordulóban egy
**egysoros indexet** kap belőlük — csak az összefoglalókat, minden sort egy
azonosítóval — az üzenetedhez csatolt felidézett memóriablokkban (lásd
[Hogyan jut el a felidézés a modellhez](#how-recall-reaches-the-model)). A teljes
jegyzetet `memory_expand`-dal nyitja meg, ha a sor érdekesnek bizonyul, és
`memory_search`-csel keres tovább (lásd
[Mélyebbre](#looking-further-memory_search-and-memory_expand)).

Ugyanez a blokk azt is tartalmazza, amit az EYAS **az aktuális üzenethez
visszakeresett** — beszélgetés-összefoglalókat, tényeket, vault-jegyzeteket,
epizodikus memóriát és korábbi üzeneteket —, plusz a legjobb találatok teljes
szövegét. A modellnek nem kell `memory_search`-öt hívnia ahhoz, hogy ezek a
találatok megjelenjenek. A korábbi üzenetek azért kereshetők, mert már tárolva
vannak — a felidézés nem készít róluk újabb másolatot. (Az alábbi nyers napló
ettől független, szándékos második másolat.) A rendszerprompthoz korábban
hozzáfűzött külön *Related prior work* blokk megszűnt: a korábbi munka most a
felidézett memóriablokkon belül érkezik.

Két frontmatter-mező vezérli:

| Mező | Mit csinál |
|------|------------|
| `kind` | `user`, `feedback`, `domain`, `project` vagy `reference` — egyben a rangsor is |
| `summary` | Az az egy sor, ami az indexben megjelenik |

A `user` és a `feedback` van elöl, mert ezek minden válasz elkészítését
befolyásolják. A `domain` a projekttípus (az azonos típusú ügyfelek osztoznak
rajta); a `project` ez az egy ügyfél. A `kind` nélküli jegyzet `feedback`, ha a `procedural/` alatt
van, egyébként `reference` — **soha nem `user`**: egy be nem sorolt jegyzetet
rólad szóló ténynek nyilvánítani annyi, mint minden prompt elejére tenni.
`summary` híján a jegyzet első valódi sora kerül be, tehát egy bármilyen
szerkesztőben kézzel írt fájl EYAS-specifikus frontmatter nélkül is működik.

Hol vannak: `<data dir>/vault/semantic/`, `procedural/`, `projects/` és
`project-types/` — alapból a `data/vault/` alatt. A vault mindig az
adatkönyvtárban van, és követi az `EYAS_DATA_DIR`-t; saját útvonal-beállítása
nincs (lásd [Konfiguráció — Adatkönyvtár és vault](/docs/hu/deploy/configuration/#data-directory-and-vault)).
Írj bele egyet, és az EYAS felveszi.

**Ezek maguktól töltődnek.** Miután a válasz már megérkezett — egy chatben, egy
háttérben futó kártyafutásban, egy specialista- vagy delegált futásban, egy
csapattag futásában, egy A2A taskban vagy egy csatornaválaszban —, egy kis
modellhívás az EYAS háttérmodelljén elolvassa a fordulót, és megkérdezi (lásd
[A capture a háttérmodellen fut](#capture-runs-on-the-background-model)): van-e benne bármi, ami egy
hónap múlva is igaz és hasznos lesz. Legfeljebb két jegyzetet adhat vissza, és a
fordulók többségén helyesen egyet sem. Mindez soha nem a válaszod kritikus
útján történik, és egy elbukott rögzítés egy hiányzó jegyzetbe kerül, nem a
válaszodba.

A hívás előtt csak egy hosszellenőrzés és egy beszélgetésenkénti plafon áll, és ki is kapcsolhatod — lásd [A capture alapból be van kapcsolva](#capture-is-on-by-default). A kézzel írt jegyzet mindig működik. Az ügynökök nem írhatnak memóriát: az EYAS automatikusan rögzíti, a `save_memory` pedig kivezetésre került — semmit nem ír, és azt mondja az ügynöknek, hogy a `memory_search`-öt használja. Az OpenCode modellje sem írhat: az OpenCode-on belüli EYAS memória-plugin csak a `memory_search`-öt és a `memory_expand`-ot kínálja.

A jelölt jegyzet írás előtt ugyanazon az utasításszűrőn megy át, mint a tények
és az összefoglalók (lásd [Miért utasít el bizonyos mondatokat](#why-some-sentences-are-refused)),
és minden modell által írt jegyzet frontmatterében `origin` áll — `by:
capture`, plusz a provider, a modell és a beszélgetés, ahol ismert —, így az EYAS
modell által írtként jegyzi meg, soha nem a te szavaidként.

Ha egy tényt megismételsz, az a már meglévő jegyzetet erősíti meg, nem csinál
mellé másodikat: az új megfogalmazás dátumozott felsorolásként kerül a
`## History` alá, a régit soha nem írja felül. A szöveget a privacy modul még
lemezre írás előtt maszkolja, nem visszaolvasáskor, ugyanazzal a függvénnyel és
szabályokkal, mint a kimenő modellforgalmat: a dátumok megmaradnak, a `mask` és
`block` osztályú értékek cserélődnek — egy jegyzetbeli IBAN `[IBAN]`-ként
tárolódik. Ez a vault-jegyzetekre igaz; az alábbi nyers napló, a
beszélgetés-összefoglalók és a tények szó szerint tárolódnak az EYAS-on belül,
és csak akkor maszkolódnak, amikor elhagyják (lásd
[Memória és adatvédelem](#memory-and-privacy)).

**Projektmemória.** Egy projekt beszélgetéseiben tanult tény a
`projects/<projekt-id>/` alá kerül, abban a projektben az általános
referencia-jegyzetek elé sorolódik, és máshol meg sem jelenik — egy másik
projekt jegyzetei soha nem jutnak el a promptodig. A gyűjtő **General**
projekt, amelyben minden beszélgetés alapból indul, nem projektidentitás: az ott
tanult tények rólad vagy a munkamódszerről szóló tényként maradnak meg, tehát
mindenhová veled tartanak, nem tűnnek el egy gyűjtőprojektben.

### A capture alapból be van kapcsolva {#capture-is-on-by-default}

A capture **minden** beszélgetésen fut, globálisan, hacsak be nem állítod a `memory.capture.enabled: false` értéket (a `local.yaml`-ben, majd újraindítás). Minden olyan úton lefut, ahol az EYAS modellt futtat: a saját chatfordulóidon, a háttérben futó kártyafutásokon, a specialista- és delegált futásokon (`run_specialist` / `delegate_to_agent`, a ticketből kódot készítő pipeline szakaszait is beleértve), egy peer agenttől érkező A2A taskokon, minden csapattag futásán és minden csatornaválaszon (Telegram, e-mail, Slack, …). Mindegyik ugyanazon a kapun és ugyanazokkal a beállításokkal megy át, és a `memory.capture.enabled: false` minden utat kikapcsol. Az a futás, amely semmit nem válaszolt, nem ír sort. A `minUserChars`-nál rövidebb üzenet soha nem ér modellhívást, és egy beszélgetés legfeljebb `maxPerConversation` hívást kap. Egy specialista vagy csapattag a saját al-beszélgetésében fut, így saját plafonja van; egy csatornás beszélgetés minden üzenete egyetlen közös plafonon osztozik. Így minden specialista, csapattag és csatornaválasz, amelynek utasítása legalább `minUserChars` hosszú, elkölthet egy további háttérmodell-hívást. Ha egyetlen háttérmodell sem jogosult, vagy a költségkeret *stop* állásban van, nincs hívás, és a futás kihagyásként rögzül (lásd [Capture-futás napló](#capture-run-ledger)).

**Hogy ki írta az üzenetet, az dönti el, hogyan olvassa az EYAS.**

- A saját chatüzeneteidet a tiédként olvassa.
- Egy delegált feladatot, csapat-eligazítást, átadási eligazítást vagy egy kártya célját olyan feladat-utasításként olvassa, amelyet egy agent is írhatott neked. Csak azok a tények maradnak meg, amelyeket rólad, a projektről vagy a világról állít, a feladat saját lépései soha.
- Egy csatornaüzenet vagy egy A2A task harmadik fél szavai. Soha nem hozhat létre jegyzetet arról, hogy ki vagy (`user`), sem szabályt arról, hogyan dolgozzon az EYAS (`feedback`) — ezeket az alkalmazásban mondd el az EYAS-nak. Csak `reference`, `project` vagy `domain` jegyzet születhet belőle, amely a frontmatterjében `trust: peer` jelölést kap, és peer bizalmi szinten tárolódik, nem modell által levezetettként. Egy ilyen jegyzet soha nem egészíti ki egy meglévő jegyzetedet: az újra kimondott tény saját fájlt kap. A hosszküszöb csak a küldő szavait számolja, így egy csatornán érkező rövid „ok” nem vált ki modellhívást.

| Kapu | Alap | Jelentés |
|------|------|----------|
| `memory.capture.enabled` | **be** | Főkapcsoló |
| `minUserChars` | 40 | Unicode kódpontok; rövidebb üzenet kihagyja a modellhívást |
| `maxPerConversation` | 20 | Modell-költési plafon (sikeres, unparsable, rejected-shape, utasításszűrős (`poison_gate`) és error futás számít; a too-short, no-eligible-model és budget-stop skip nem, mert modellhívás nem történt) |
| `maxInputChars` | 4000 | Az üzeneted és a válasz is legfeljebb ennyi karakterre vágódik, mielőtt a capture-modell látja |

Nincs kulcsszólista egyik nyelven sem. A `{"notes":[]}` a gyakori és helyes
extractor-válasz (0–2 jegyzet).

### A capture a háttérmodellen fut {#capture-runs-on-the-background-model}

A memória-capture, az éjszakai konszolidáció és a reflexiós összefoglaló mind az
EYAS **háttérmodelljét** használja: egy API providert, vagy olyan CLI-t, amely
izolált hívást tud futtatni (ma a Claude Code; a Grok CLI és a Kimi Code CLI, miután
az EYAS ellenőrizte az izolációjukat ezen a hoston). A sorrend: a Heartbeat
routing-szint, aztán a telepítés alapértelmezése, aztán az API providerek,
végül az izolálni képes CLI-k. Soha nem esik vissza olyan providerre, amelyet a
gateway magától választ, és soha nem olyan CLI-re, amely nem tud izolálni.

Minden extrakciós, konszolidációs és reflexiós hívás **izolált**: egy kör,
toolok nélkül, CLI-natív memória vagy konfiguráció nélkül, az utasítás pedig
rendszerpromptként megy. Ha az extrakciós modell távoli, a forduló block
osztályú értékei maszkolva (`[IBAN]`), a dátumai épen jutnak el hozzá, így az
IBAN-t említő forduló is megkapja a jegyzetét.

Ha API provider vagy Claude Code engedélyezve van, semmi látható nem változik.
Olyan telepítésen, amelyen nincs jogosult háttérmodell — például csak Grokos
vagy csak Kimis telepítésen, amíg az izolációjuk nincs ellenőrizve:

- **A capture nem hív modellt.** Minden jogosult kör egy capture-napló sort ír
  `no_eligible_model` kihagyási okkal, provider nélkül. Ez rögzített kihagyás,
  nem hiba.
- **Az éjszakai konszolidáció** nem alakítja át az ismétlődő epizodikus
  emlékeket vault-jegyzetté. Ezeket a klasztereket érintetlenül hagyja (nem
  foglalja össze, nem érvényteleníti), és egy későbbi éjszakán lépteti elő, ha
  már van jogosult modell.
- **A reflexiós / reggeli összefoglaló** csak a determinisztikus részét tartja
  meg (például a lejárt feladatokat), modell által írt eredmények, tanulságok
  vagy javaslatok nélkül.

Ha a modell-költségkeret *stop* állásban van, a capture `budget_stop`
kihagyási okot rögzít, és nem hív modellt.

Izoláció nélkül az extractor egyszer a tulajdonos host-memóriáját olvasta,
„már rögzítve” választ adott, és az EYAS vault üres maradt. Ezt a hibát zárja.

### Capture-futás napló {#capture-run-ledger}

Minden kimenetel, ami a kapuig eljut, `memory_capture_runs` sort ír: skip okkal
(`too-short`, `cap-reached`, `unparsable`, `rejected-shape`, `poison_gate`,
`no_eligible_model`, `budget_stop`, `error`), extraction a kindokkal (egy
`poison_gate` futás is számolja az ugyanabból a válaszból mentett jegyzeteket), plusz
`provider` oszlop: `provider/model`, `provider/route`, ha egy CLI a modellje
megnevezése nélkül válaszolt (például `claude-code/isolated-cli`), vagy null, ha
nem hívtak modellt. Az elbukott vagy üres extrakciós hívás `error` sort ír,
amely megnevezi a megpróbált providert. Az `entry_path` oszlop rögzíti, melyik
futási útról jött a sor: `interactive`, `background`, `delegation`,
`pipeline`, `a2a`, `team` vagy `channel` (a kiadás előtt írt soroknál üres).
Két csend szándékos: kikapcsolt capture semmit nem ír, és az
assistant-szöveg nélküli futás nem éri el a kaput. Egy **God Mode** verseny a
saját streamjével tér vissza a post-turn blokk előtt, ezért maga a verseny köre
sem vault-jegyzetet, sem itteni sort nem ír; minden worker saját háttérfutásként
fut, és ott rögzül, a feladatot agent által írt utasításként olvasva.
Az alábbi nyers napló ettől
független nyilvántartás, és rájuk is kiterjed.

## Hogyan működik a felidézés {#how-recall-works}

Minden körben, bármelyik modell válaszol, az EYAS egyetlen blokkban csatolja az üzenetedhez, amire emlékszik:

- **Állandó jegyzetek** — a tartós jegyzetek és összefoglalók egysoros indexe, minden sor egy azonosítóval, amelyet a modell megnyithat;
- **Visszakeresett találatok** — az ehhez az üzenethez illő összefoglalók, tények, jegyzetek, epizodikus emlékek és korábbi üzenetek, relevancia, kor és szerző szerint rangsorolva;
- **A legjobb találatok teljes szövege** — az első kettőé (toolt hívni nem tudó modellnél négyé).

Mindez csak abból a memóriából jön, amelyet a beszélgetés láthat (a projektje, a projekttípusa és a globális memória), azon a nyelven keres, amelyen írsz, és a bizalmi szint szerint súlyoz. Tovább a modell a `memory_search`-csel és a `memory_expand`-dal kereshet, válaszonként három hívással. Az alábbi szakaszok ezeket veszik sorra.

### Melyik memóriát látja egy beszélgetés {#which-memory-a-conversation-can-see}

Egy beszélgetés háromféle memóriát lát: a saját projektjéét, a projekttípusáét és
a globálisat. Másik projekt memóriáját soha nem látja. A projekten kívüli
beszélgetés — ide tartozik az alapértelmezett **General** projektben lévő is —
csak a globális memóriát látja.

Egyetlen szabály vonatkozik mindenre, amit a modell kap: a minden körben
beinjektált memóriára, az állandó indexsorokra, a vektoros felidézésre, valamint
a `memory_search`, `memory_expand` és `search_memory` toolra.

Hogy egy vault-jegyzet hová tartozik, azt a frontmattere dönti el:

| A jegyzet deklarál | Hol látszik |
|--------------------|-------------|
| `project:` | Csak abban a projektben, a jegyzet fajtájától függetlenül. (Korábban a `user` / `feedback` / `reference` jegyzetek akkor is mindenhol megjelentek, ha projektet neveztek meg.) |
| csak `projectType:` | Az ilyen típusú projektekben |
| egyiket sem | Mindenhol (globális) |

Ha egy jegyzetet egy létező projekt `projects/<id>/` mappája alá mozgatsz, vagy
`project:` mezőt adsz a frontmatteréhez, arra a projektre szűkül — és vele az
EYAS által belőle levezetett tények és összefoglaló is: ezeket csak abban a
projektben idézi fel, nem minden beszélgetésben. A Memória oldal keresése
(`/memory`) továbbra is szűretlen.

### Hogyan jut el a felidézés a modellhez {#how-recall-reaches-the-model}

Amire az EYAS egy üzenethez emlékszik, azt **ahhoz az üzenethez** csatolja, nem a
rendszerprompthoz. Egyetlen határolt blokkban, `<eyas-memory>`-ként érkezik, egy
`<turn-context>` blokkon belül, amelyet az EYAS az aktuális üzeneted elejére
tesz, az aktuális dátummal és idővel együtt (az `i18n.timezone` szerint,
különben a szerver zónájában). A blokk ebben a sorrendben tartalmazza:

1. az állandó jegyzeteket — az egysoros indexet, minden sort az azonosítójával;
2. az ehhez az üzenethez visszakeresett jegyzeteket;
3. a legjobb találatok teljes szövegét.

A formátum minden providernél ugyanaz — API modellek, Claude Code, Grok CLI,
Kimi Code CLI, lokális modellek —, és minden futástípusnál: interaktív chat;
háttérfutások (board-bot kártyák, újrapróbálások és folytatások, God Mode
munkások); specialisták és delegált agentek (`run_specialist` /
`delegate_to_agent`) és ticket-to-code pipeline lépések; csapattagok; a
tulajdonos (belső) hangján adott csatornaválaszok; és az
[OpenCode](/docs/hu/automation/opencode/) feladatok. A kolléga nélküli chat
olyan projektben, amelynek nincs alapértelmezett agentje, nem kap összeállított
rendszerpromptot, de a dátumot, az időt és a felidézett memóriát megkapja. Az
üzenetkérésben küldött `system` felülírás csak a rendszerpromptot cseréli; a
felidézés ettől még megérkezik. A folytatott futás (frissítés, jóváhagyás utáni
folytatás, kritikus visszajelzése) friss dátumot, időt és felidézést kap, nem
azt, amelyet a futás indulásakor rögzített.

- **Adat, nem utasítás.** A blokk közli a modellel, hogy adat, nem utasítás, és
  arra kéri, hogy amit felhasznál, azt `[source:<id>]` formában hivatkozza. A
  benne lévő szöveg nem tudja lezárni a blokkot, és nem adhatja ki magát
  rendszer- vagy felhasználói üzenetnek: az ilyen tageket az EYAS
  hatástalanítja, de olvashatók maradnak.
- **Soha nem mentődik.** A tárolt üzeneted soha nem változik; a blokk csak a
  modellnek küldött másolatba kerül, így az EYAS soha nem rögzíti vissza a saját
  felidézését memóriaként.
- **Stabil rendszerprompt.** Mivel az óra is ebbe a blokkba került, a
  rendszerprompt körről körre ugyanaz marad, így cache-elhető.
- **Toolnevek a hosthoz.** A drill-down tippek úgy nevezik meg a toolokat,
  ahogy a modell hostja listázza őket: natív providereken `memory_search` /
  `memory_expand`, Claude Code-on `mcp__eyas__memory_search`, Grok CLI-n
  `use_tool` `eyas__memory_search`-csel, Kimin pedig `memory_search` az `eyas`
  MCP szerveren. A toolt hívni nem tudó modell nem kap drill-down tippet, és
  kettő helyett legfeljebb négy teljes szövegű jegyzetet kap, a promptja pedig
  azt mondja, hogy ez a blokk az összes memória, amit kap, és hogy tovább nem
  kereshet, ahelyett hogy a `memory_search` / `memory_expand` felé irányítaná
  (lásd [Promptok — A memória-szerződés](/docs/hu/ai/prompts/#the-memory-contract-in-the-master-prompt)).
- **Nincs tulajdonosi memória kívülálló olvasóknak.** Az A2A peertől érkező
  feladatok, valamint azok a csatornaválaszok, amelyeknek a hanghatóköre Külső
  (**Kényszerítés: Külső** a beszélgetésen, vagy ideiglenes felülírás), csak a
  dátumot és az időt kapják meg. Ha az EYAS nem tudja megállapítani egy
  csatornaválasz hanghatókörét, az is felidézett memória nélkül megy ki. Maguk a
  memóriatoolok változatlanok, és továbbra is a biztonsági kapu felügyeli őket.

A teljes blokk méretét, a keretezéssel együtt, a `memory.index.budgetChars`
adja (lásd [Állandó memóriasorok](#standing-memory-lines)), a válaszoló modell
ablakával skálázva — egy OpenCode-feladatnál azzal az ablakkal, amelyet az
OpenCode a kiválasztott modellhez listáz (lásd [OpenCode — A feladattal küldött memória](/docs/hu/automation/opencode/#memory-sent-with-a-task)). A
[Kontextus-összeállítás](/docs/hu/daily/conversations/#context-composition)
panelen a felidézés a **turn** zóna **memory-recall** szekciója, a
**turn-time** (az óra) mellett; a *memory-index* és a *related-work* szekciók
már nem jelennek meg. A panel **Átadott memória** doboza minden providernél
megmutatja, milyen modellhez és ablakhoz méreteződött a blokk, hány elem
idéződött fel, és ebből hány teljes szöveggel, a blokk plafonjához mérve, miért
maradt el a felidézés, ha elmaradt, és a kör drill-down hívásait a 3-as
plafonhoz mérve.

Ha providereket akarsz összevetni egy időszakra, a **Megfigyelhetőség → Kontextus** oldalon a **Memóriaátadás szolgáltatónként** kártya providerenként mutatja, hány kör vitt memóriát, átlagosan hány elemet rétegenként és hány memóriatokent ezekben a körökben, és milyen gyakran nyitotta meg a modell maga a memóriát. A hasonló számok azt jelentik, hogy minden modell ugyanazt a memóriát kapta. Lásd [Megfigyelhetőség](/docs/hu/admin/observability/).

### Mivel keres a felidézés {#what-recall-searches-with}

Minden kör ugyanazzal a lekérdezéssel keres a memóriában, akár chatről, akár egy
beszélgetés háttér- vagy ütemezett futásáról van szó. A lekérdezés modellhívás
nélkül épül fel ezekből:

- az aktuális üzeneted (ha üres, az ebben a beszélgetésben írt utolsó üzeneted);
- az előző, ettől eltérő üzeneted (első 400 karakter);
- a beszélgetés címe (első 120 karakter; az *Untitled* helyőrzőt figyelmen
  kívül hagyja);
- a beszélgetés feladatleírása vagy célja (első 400 karakter).

Legfeljebb 1200 karakter, az üzeneted van elöl, és az a rész, amely egy
korábbiban már benne van (például az első üzenetedből képzett cím), nem
ismétlődik. Csak ennek a beszélgetésnek a saját üzeneteit használja, soha nem
egy másikét. Így egy rövid folytatás, például *igen, csináld*, a szóban forgó
feladatot idézi fel, egy leírás nélküli beszélgetés háttérfutása pedig a címe
alapján is keres. (Korábban a chat csak az aktuális üzenettel keresett, a
háttérfutás pedig csak a feladatleírással.)

**A keresés a nyelvedet olvassa.** A nyelvet magából a lekérdezésből veszi. Egy
rövid, egyértelmű nyelv nélküli üzenetnél azt a nyelvet használja, amelyen a
beszélgetés folyt; ha az is ismeretlen, minden támogatott nyelv gyakori
funkciószavait figyelmen kívül hagyja. Így a magyar, német, spanyol és francia
funkciószavak (*hogy*, *csak*, *aber*, *para*, *avec* …) már nem számítanak
keresőszónak, és nem engednek át oda nem illő jegyzeteket, a klingon
lekérdezések pedig erősebb kulcsszó-súlyozást kapnak. A modell saját `memory_search` lekérdezései — az OpenCode-éi is — ugyanígy állapítják meg a nyelvüket.

### Hogyan rangsorol a felidézés {#how-recall-ranks}

Minden modell, minden belépési út és a `memory_search` / `memory_expand` toolok
ugyanazt a rangsorolást használják. Semmit nem kell beállítani vagy migrálni.

- **Elöl a relevancia**: mennyire illik egy jegyzet vagy korábbi üzenet az
  üzenetedhez. Utána az, hogy mennyire friss és mennyire fontos, plusz egy kis
  bónusz az ugyanabból a feladatból (beszélgetésből) vagy ugyanabból a
  projektből származó memóriának.
- **A kor memóriafajtánként számít.** A tények avulnak a leggyorsabban (nagyjából
  egy hónap), a korábbi üzenetek nagyjából három hónap alatt, az összefoglalók és
  a vault-jegyzetek lassan (nagyjából egy év), a kitűzött összefoglalók pedig
  soha nem öregszenek. Egy vault-jegyzetnél a kor azt jelenti, mikor indexelte
  utoljára az EYAS — mikor változott utoljára a jegyzet; egy korábbi üzenetnél
  azt, mikor íródott. (Korábban minden jegyzet és korábbi üzenet vadonatújnak
  számított.)
- **Számít, ki írta.** A saját üzeneteid és az EYAS agentjei vagy modelljei által
  írt szöveg teljes súllyal számít; a tool-kimenet és a harmadik féltől importált
  szöveg 0,6×, a csatornaküldőktől érkező szöveg 0,3× súlyú. Ehhez azt a
  bizalmi szintet használja, amelyet az EYAS a tétel mentésekor rögzített (lásd
  [Bizalom: ki írta](#trust-who-wrote-it)).
- **Soha nem idéződik fel:** a lehetséges prompt-injekcióként megjelölt
  (karanténba tett) szöveg — annak a beszélgetésnek az összefoglalóján át sem,
  amelyből származik —, a modell saját gondolkodása és a rögzített tool-hívások
  (lásd [A tool-eredmények nem kerülnek bele](#tool-results-are-not-recorded--and-why-to-leave-it-that-way)).
- **Egy korábbi üzenet a saját szavait mutatja.** Egy korábbi beszélgetésből
  felidézett sor az adott üzenet saját szövegét mutatja — a keresőszavaid körüli
  részt, legfeljebb 280 karakterben —, nem a beszélgetés összefoglalóját vagy
  csak az azonosítóját. A vault-jegyzetek és a korábbi üzenetek egyenlő
  feltételekkel versenyeznek (korábban a korábbi üzenetek kulcsszavas találatai
  mindig megelőzték az illeszkedő jegyzeteket), a nyers naplóba importált
  jegyzet pedig egyszer tér vissza, jegyzetként.
- A Memória oldal keresése (`GET /api/v1/memory/search`) és a `memory_search`
  tartalékútja is a korábbi üzenetek saját szövegét mutatja, megjelölt szöveget,
  modell-gondolkodást vagy rögzített tool-hívást soha.

### A vektoros keresés mindig helyben fut {#vector-search-always-runs-locally}

Bármelyik chat-provider válaszol is — Claude Code, Grok, Kimi vagy egy API
provider —, az EYAS magán a gépen alakítja vektorokká a memóriát: a
multilingual-e5-small modellel, ha a súlyai elérhetők, különben egy egyszerűbb,
beépített hash-alapú beágyazóval (gyengébb minőség, letöltés nem kell). A
memória szövege soha nem kerül egy provider embedding API-jához azért, hogy
felidézhető legyen.

- A **Beágyazás** routing-szint már csak a régebbi vault- és epizodikus
  keresőindexet táplálja; a felidézés soha nem használja. (Korábban ennek a
  szintnek a beállítása csendben kikapcsolta az összefoglalók és a tények
  vektoros felidézését, és minden induláskor elküldte őket annak az API-nak.) Ha
  ennek a régebbi indexnek a beágyazója megváltozik, az index egyszer kiürül, és
  automatikusan újraépül.
- **Az új memória másodperceken belül kereshető.** Amikor az EYAS egy
  beszélgetés pufferelt üzeneteit a memóriába írja — a feladat lezárásakor, 30
  perc tétlenség után, vagy amikor a puffer megtelik —, az ebből kinyert
  összefoglalók és tények nagyjából fél másodperccel később megkapják a
  vektoraikat, nem csak újraindítás után.
- A felülírt összefoglalók, a felülírt vagy törölt tények, a karanténba tett
  tételek és a titkot tartalmazóként jelölt tételek (hacsak a
  `memory.recall.includeSecrets` nincs bekapcsolva) kikerülnek a
  vektorindexből, így már nem foglalnak felidézési helyet.
- A helyi e5 modell minden telepítésen induláskor betöltődik, ott is, ahol
  Beágyazás szint van beállítva (kb. 100 MB RAM). Ha nem tud betöltődni, az EYAS
  a tartalék beágyazót használja, és tovább működik. Hogy melyik van
  használatban, azt az `eyas doctor` **Memory embedder** sora mutatja — lásd
  [CLI](/docs/hu/deploy/cli/#what-doctor-checks).

Semmit nem kell beállítani és semmit nem kell migrálni: egy korábbi beágyazó
vektorait a következő induláskor automatikusan lecseréli.

### Mélyebbre: memory_search és memory_expand {#looking-further-memory_search-and-memory_expand}

Ha a felidézett memóriablokk nem elég, a modell
`memory_search`-öt hív, majd `memory_expand`-dal nyit meg egy találatot. A
`search_memory` a `memory_search` aliasa.

- **Válaszonként 3 hívás, minden provideren.** A három tool együtt válaszonként
  3 hívást enged — API modelleken, Claude Code-on, Grokon és Kimin egyaránt. A
  számláló minden új elküldött üzenetednél újraindul, és válasz közben nem fogy
  el, akármilyen hosszan fut a modell saját tool-hurka.
- **Egy korábbi üzenet megnyitása.** A `memory_expand` egy `rw:` azonosítóra az
  eredeti üzenetszöveget adja vissza, legfeljebb 8000 karakterben, a
  forrástípusával és a bizalmi szintjével. A beszélgetés összefoglalóját csak
  akkor adja hozzá kontextusként, ha az maga is felidézhető (nincs megjelölve, és
  nem titokból származik, hacsak a `memory.recall.includeSecrets` nincs
  bekapcsolva).
- **A beszélgetés projektjére zárva, az EYAS által a szerveren.** Akármit küld a
  modell, egy CLI vagy egy híd, a toolok a beszélgetés saját projektjét, annak
  típusát és a globális memóriát olvassák. A `scope` vagy projekt argumentumot
  figyelmen kívül hagyják: másik projekt megnézése a UI-ban történik, soha nem
  tool-argumentummal. Az EYAS által nem ismert beszélgetést megnevező hívás
  *memory scope unresolved* hibát ad, találatok nélkül.
- Az EYAS saját MCP szerverének külső kliensei mögött nincs EYAS beszélgetés:
  memóriatool-hívásaik csak a globális memóriát olvassák, 90 másodpercenként
  legfeljebb 3 hívással. Ugyanez a korlát vonatkozik az OpenCode feladathoz nem kötött hívásaira.
- **Az OpenCode** ugyanezt a két toolt kínálja a modellnek, ugyanazokkal a nevekkel és argumentumokkal, csak olvasásra. Egy `opencode_run`-nal delegált feladatnál a beszélgetés projektjére vannak zárva, és a hívó kör 3 hívásán osztoznak. Minden más esetben — a panelen indított OpenCode terminál-sessionben, egy nem az EYAS által létrehozott sessionben, vagy ha a bejelentkezett hívó nem a session felhasználója — csak a globális memóriát olvassák. Egy kívülről csatolt OpenCode szerver egyáltalán nem éri el az EYAS memóriáját. Lásd [OpenCode](/docs/hu/automation/opencode/).

Minden host a saját nevén listázza ezeket a toolokat — API providereken
`memory_search`, Claude Code-ban `mcp__eyas__memory_search`, Grokban `use_tool`
`eyas__memory_search`-csel. Lásd [MCP — toolnevek hostonként](/docs/hu/ai/mcp/#tool-names-per-host).

### Állandó memóriasorok {#standing-memory-lines}

Az állandó memóriaindex minden sora olyan azonosítót mutat, amelyet a
`memory_expand` megnyit: `(vt:<path>)` vault-jegyzethez, `(gs:<id>)`
beszélgetés-összefoglalóhoz. A `memory_expand` entitásazonosítókat (`en:<id>`)
is megnyit: visszaadja az entitás nevét, típusát, aliasait és legfeljebb 10
aktuális tényét abból a memóriából, amelyet a beszélgetés lát.

Az indexben az összefoglaló-sorok: a kitűzött összefoglalók, a projekt saját
összefoglalója, és ugyanannak a projektnek legfeljebb 5 legutóbbi
feladat-összefoglalója (projekten kívül a többi projekt nélküli beszélgetésé) —
soha nem másik projekté, soha nem az aktuális beszélgetés sajátja, és soha nem
karanténba tett összefoglaló. (Korábban: bármely projekt 20 legfontosabb
összefoglalója.)

A `memory.index.budgetChars` (alapból 2400 karakter, kb. 600 token) a **teljes
felidézett memóriablokk** mérete, a keretezéssel együtt: az állandó jegyzetek, a
visszakeresett jegyzetek és a teljes szövegű találatok együtt. Ez az
alapérték a 100k tokenes kontextusablakú modellre szól; a blokk a válaszoló
modell ablakával skálázódik (250k tokentől legfeljebb 2,5-szeresre, nagyjából 29k token
alatt kevesebbre, egy nagyon kicsi ablaknál pedig semennyire). Egy OpenCode-feladat
ugyanígy méreteződik, annak az ablaknak megfelelően, amelyet az OpenCode a
modelljéhez listáz, vagy pontosan `memory.index.budgetChars` méretre, ha az
ablak ismeretlen (korábban az OpenCode mindig a skálázatlan értéket kapta). Az állandó jegyzetek jönnek elöl, de mindig helyet hagynak — a
blokk legfeljebb felét — annak, amit az aktuális üzenethez visszakeresett. A be
nem férő jegyzeteket egy záró sor összesíti — *… N more notes not shown* —,
amely úgy nevezi meg a drill-down toolt, ahogy a host listázza; a
`memory_search`-csel elérhetők maradnak. Emeld meg a keretet a
`config/local.yaml`-ban (és indíts újra), ha a `user` és `feedback` sorok már
nem férnek bele. A korábbi verziók a
`config/default.yaml`-ban 8000-et szállítottak — lásd a
[frissítési megjegyzést](/docs/hu/deploy/configuration/#memory-index-and-recall).

A frissítés utáni első induláskor az EYAS minden meglévő memóriavektort a
projektje alá sorol, egyszer és kötegekben (a log: *L3 repartition: vectors
filed under their project*). Ha nem tud végezni, figyelmeztetést logol, és a
következő induláskor újra megpróbálja. Nincs teendő.

### Projekt nélküli projekt-jegyzetek {#project-notes-without-a-project}

Az a jegyzet, amelynek a `kind`-ja `project` vagy `domain`, de nincs benne
`project:` / `projectType:`, **globális**: minden beszélgetésnél megjelenik az
állandó indexben, a `memory_search` találatai közt és a felidézésben,
projekt-jegyzetként rangsorolva. Ha a `projects/<id>/` alá mozgatod — vagy
`project:` mezőt írsz a frontmatterébe —, arra az egy projektre szűkül. Az
importált jegyzetek addig maradnak így, amíg létre nem hozod a hozzájuk tartozó
projekteket.

### Az importált titkok kimaradnak a felidézésből {#imported-secrets-stay-out-of-recall}

Az importer soha nem hagy ki egy fájlt azért, mert hitelesítő adatot tartalmaz.
Szó szerint tárolódik, a tétel pedig `contains-secrets` címkét kap — jegyzet-
címkeként, skill-képességként vagy epizodikus címkeként, aszerint, mi lett
belőle.

Alapból az ilyen tétel kimarad mindenből, amit a modell magától elér: az
állandó indexből, a felidézésből, a `memory_search`-ből, a reflexiós jobból, az
éjszakai konszolidálóból és a skill-illesztőből. Sosem kap beágyazást, és sosem
kerül az opcionális dúsító modell elé. A Memória oldal viszont továbbra is
teljes egészében mutatja neked.

**Minden, ami belőle származik, szintén kimarad.** A címke a jegyzetről vagy
epizódról átöröklődik a nyers naplóbeli másolatára, minden belőle kinyert
tényre és minden belőle épített összefoglalóra; egy már ismert tény is titokká
válik, ha később egy címkézett jegyzet megerősíti. Az ilyen nyers sor, tény vagy
összefoglaló nem kap beágyazást, nem szerepel az állandó sorokban, nem adja
vissza a `memory_search` vagy a `GET /api/v1/memory/search`, és a
`memory_expand` sem nyithatja meg. Egy entitás kibontásakor a titkos tényei
kimaradnak, egy olyan korábbi üzenet pedig, amelynek a beszélgetés-összefoglalója
titkos, az összefoglaló nélkül jelenik meg. (Korábban ezek
a levezetett tények és összefoglalók még eljuthattak a modellhez.) A
frontmatterjében `contains-secrets` címkét viselő, közvetlenül lemezre írt
jegyzetet az EYAS már azelőtt titkosnak tekinti, hogy a vault-indexelő látta
volna.

Ha a `config/local.yaml` fájlban `memory.recall.includeSecrets: true` értéket
állítasz és újraindítasz, mindez a modell felé is megnyílik, ahogy korábban.

**Frissítés.** A frissítés utáni első induláskor az EYAS megjelöli a címkézett
jegyzetekből és epizódokból származó meglévő nyers sorokat, tényeket és
összefoglalókat — egyszer, a vektorok építése előtt —, és egy sort naplóz. Ha
később egy másik jegyzet vagy epizód is megkapja a címkét, a következő indulás
az abból levezetett sorokat is megjelöli. A jelölések csak gyűlnek: ha a
`contains-secrets` címkét kézzel eltávolítod egy jegyzetről, az abból már
levezetett összefoglalók és tények ettől nem válnak újra felidézhetővé.

Ez a kapu az automatikus behúzást akadályozza; nem fájlrendszer-homokozó. Egy
fájlolvasó eszközökkel bíró agent továbbra is elolvashatja az eredeti fájlt a
lemezen. Az importált agent-persona és a jóváhagyott workspace-szabályfájl
egyáltalán nincs kapuzva — ott a tartalom *maga* a prompt —, ezért ezeket a
sorokat jóváhagyás előtt nézd át.

A `legacy` (régi memóriamappa) és a `third-party` (más terméke
dokumentációja) címke közönséges, teljesen felidézhető jegyzetet jelöl; csak
azt mondják meg, honnan jött a jegyzet. Minden importált tétel `source:<adapter>`
címkét is visel, amely megnevezi az őt beolvasó adaptert. Egy saját kezűleg írt
jegyzet a frontmatterjében maga is deklarálhat `contains-secrets` címkét, és
ugyanezt a bánásmódot kapja. Lásd: [Adatimport és -export](/docs/hu/admin/data-port/).

### Memória és adatvédelem {#memory-and-privacy}

Az EYAS nyersen tárolja a memóriát, és kifelé menet maszkolja. Amikor a memória
távoli modellhez megy — a promptba injektálva, vagy a `memory_search`, a
`memory_expand` és a többi memóriatool eredményeként —, az adatvédelmi policy
arra a célra maszkolja, és ugyanaz a memóriaelem mindkét úton ugyanúgy
maszkolódik. Egy lokális modell (loopback, vagy az adatvédelmi policyban
lokálisként felsorolt host) maszkolatlanul kapja. A vault-jegyzetek emellett
már íráskor, tárolás előtt maszkolódnak (a dátumok megmaradnak).

A memóriatool-eredmények **minden** olyan úton ugyanígy maszkolódnak, amelyen egy
modell EYAS-memóriát olvashat: API és lokális providereknél, a Claude Code
folyamaton belüli EYAS-toolainál, a Groknál és a Kiminél az EYAS MCP-hídján át,
az EYAS saját MCP szerverének külső klienseinél, és az OpenCode sidecarnál (a
feladat promptja, a feladattal küldött felidézett memória és a `memory_search` / `memory_expand` tooljainak válaszai). Egy CLI, egy külső MCP kliens és az OpenCode
mindig távolinak számít. Ha az adatvédelmi szkennelés elbukik, az eredményt az
EYAS visszatartja, ahelyett hogy maszkolatlanul küldené el. Lásd
[Biztonság és adatvédelem — Hol hat a maszkolás](/docs/hu/admin/security-privacy/#where-masking-applies).

### Az EYAS-on kívüli memóriát az EYAS elutasítja {#memory-outside-eyas-is-refused}

Az agentek azt kapják: az EYAS memóriája az egyetlen memóriájuk, azt az EYAS
rögzíti, és a `memory_search` / `memory_expand` toollal érik el. Ezt az EYAS ki
is kényszeríti:

- **A biztonsági kapu az olvasást és az írást is elutasítja** más eszközök
  memóriájánál (`~/.claude`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`,
  `~/.cursor`, az OpenCode mappái, `ai-memory` mappák és a lista többi eleme),
  az Obsidian vaultoknál, a `security.foreignMemoryPaths` minden útvonalánál, az
  EYAS saját adatmappájánál (vault, adatbázis, kulcsok, a CLI-bejelentkezési
  home-ok) és egy másik beszélgetés workspace-énél — minden modell és minden
  általa ellenőrzött toolhívás esetén. A modell például ezt kapja: *Memory outside EYAS (Claude Code) — use memory_search / memory_expand from EYAS* — kivéve a Grok CLI-t, amely az elutasított hívásnál befejezi a válaszát, és a modellje nem látja az okot (lásd [Providerek — Grok CLI és Kimi Code CLI](/docs/hu/ai/providers/#grok-cli-and-kimi-code-cli)).
  Korábban csak az írás és a shell-hozzáférés volt tiltva a `~/.claude`, a
  `~/.grok` és az `ai-memory` felé, az olvasás engedélyezett volt.
- **A Claude Code saját toolja** a futása előtt ugyanezen az ellenőrzésen megy
  át, beleértve azokat az olvasásokat is, amelyeket a Claude Code a
  munkamappáján belül magától engedne.
- **A keresést az minősíti, amit elérhet.** Egy CLI saját keresését (Grep,
  Glob, egy rekurzív shellparancs), amelynek mappája egy másik eszköz
  memóriáját, egy vaultot vagy az EYAS adatait tartalmazza, az EYAS *Search too
  broad* üzenettel elutasítja, mert a CLI nem tudja kihagyni azt a helyet; és
  egy ilyen helyet tartalmazó Mappa többé nem menthető. Lásd
  [Biztonság és adatvédelem — Memória az EYAS-on kívül](/docs/hu/admin/security-privacy/#memory-outside-eyas).
- **A kernel fájl-sandbox.** A Claude Code shellparancsai és a Grok CLI saját
  toolai az operációs rendszer fájl-sandboxában is futnak, ahol ilyen elérhető,
  és ez ugyanezeket a helyeket akkor is blokkolja, ha egy shellparancs olyan
  módon éri el őket, amelyet az EYAS nem tud kiolvasni (lásd
  [Providerek — Kernel fájl-sandbox](/docs/hu/ai/providers/#kernel-file-sandbox)).
  A **Biztonsági események** oldal **EYAS-on kívüli memória** kártyája
  listázza, mi védett ezen a szerveren.
- **A CLI-k izoláltan futnak.** A Claude Code nem tölt be host `CLAUDE.md`-t,
  beállításokat, skilleket, MCP szervereket vagy auto-memóriát; a Grok CLI és a
  Kimi Code CLI a saját EYAS home-jában fut, és soha nem látja a `~/.grok`, a
  `~/.kimi` vagy a `~/.claude` mappát. Lásd
  [Providerek](/docs/hu/ai/providers/#claude-code-isolation).
- **A második memóriát tartó MCP szerverek** (a Memory tudásgráf-szerver, a
  Qdrant, az Obsidian, az MCPVault, …), vagy a védett mappára mutatók minden
  modell számára tiltottak. Lásd
  [MCP](/docs/hu/ai/mcp/#memory-store-servers-are-blocked).

**Migráció.** Azok az agentek, amelyek korábban közvetlenül olvasták a
`~/.claude/CLAUDE.md`-t, a `~/.grok` memóriáját, vault-jegyzeteket vagy a
`data/` alatti fájlokat, most elutasítást kapnak (a Biztonsági események minden
elutasítást mutat). Ezt a tudást egyszer hozd be az EYAS-ba az
[adatimporttal](/docs/hu/admin/data-port/). Részletek és ami még nincs lefedve:
[Biztonság és adatvédelem — Memória az EYAS-on kívül](/docs/hu/admin/security-privacy/#memory-outside-eyas).

---

## A nyers napló {#the-raw-record}

**Semmi nem vész el abból, ami elhangzott.** Minden üzenetet, amit az EYAS
lejegyez — a tiédet, az asszisztensét és a háttérben futó ágensek kimenetét —,
mostantól másodszor is megőriz, szó szerint, egy nyers naplóban a beszélgetés
mellett. Beíráskor tömörödik (valódi szövegen nagyjából 2,7-szer kisebb lesz),
és a saját bájtjaiból számolt hash alá kerül, tehát egy beszélgetésen belül
megismételt mondat egyszer tárolódik és kétszer számít.

**Mi olvassa.** Nincs oldal és nincs parancs, amely megmutatná neked a nyers
naplót. Az asszisztens csak memória-felidézésen keresztül éri el, ugyanabban a
projekt-hatókörben, mint minden mást: az EYAS által belőle levezetett
összefoglalók és tények (lásd alább) állandó memóriasorként és keresési
találatként jelennek meg, a `memory_search` / `memory_expand` pedig ezeket és a
nyers sorokat is meg tudja nyitni — lásd
[Melyik memóriát látja egy beszélgetés](#which-memory-a-conversation-can-see).

Ami ma megváltozott számodra, az az, hogy hol élnek a szavaid. A beszélgetés
már nem az egyetlen példánya annak, ami elhangzott benne: ha lezárod,
archiválod vagy törlöd a beszélgetést, a nyers napló megmarad, és sehol nincs
gomb, ami törölné. Ha ezt nem így akarod, kapcsold ki a nyers naplót, mielőtt
olyasmire használod az EYAS-t, aminek később nyoma se maradjon (lásd alább).

Az írás kötegelt, nem azonnali. Az üzenetek beszélgetésenként állnak sorban, és
akkor íródnak ki, ha a beszélgetés lezárul (vagy lezárt stage-be kerül), ha
nagyjából 8000 token gyűlt össze, ha a beszélgetés 30 percig tétlen volt, vagy
ha az EYAS leáll — az újraindítás semmit nem veszít el abból, ami már elhangzott.

Minden üzenetre rákerül az is, honnan származik, és ez a bélyeg soha nem
öröklődik. Egy összefoglaló vagy tény soha nem lehet megbízhatóbb annál a
szövegnél, amiből készült — lásd [Bizalom: ki írta](#trust-who-wrote-it).

### Bizalom: ki írta {#trust-who-wrote-it}

Hogy az EYAS mennyire bízik egy megjegyzett szövegben, az attól függ, **ki
írta**, nem attól, hogy a beszélgetés melyik oldalán jelent meg.

| Bizalom | Mire vonatkozik |
|---------|-----------------|
| **owner** | Amit te gépelsz egy beszélgetésben, a God Mode kört is beleértve |
| **derived** | Amit egy agent vagy maga az EYAS írt: a modell válaszai, egy agent által egy másiknak delegált feladat, egy átadási eligazítás, a Prompt coach / Prompt enhancer által a piszkozatod köré írt prompt, egy board-kártya célja, amikor háttérben fut, és egy csapattag eligazítása |
| **peer** | Csatornaküldők üzenetei (Telegram, e-mail és más csatornák) és egy másik rendszer által A2A-n küldött feladatok, valamint azok a vault-jegyzetek, amelyeket a memória-capture ezekből készít (`trust: peer`) |
| **ingested** | Tool-kimenet |
| **quarantined** | Megjelölt szöveg — megmarad, de soha nem idéződik fel |

A tények és összefoglalók soha nem megbízhatóbbak annál a szövegnél, amiből
készültek, így egy coach-prompt *Target model: X* sora vagy egy delegált
feladat *Deadline: Friday* sora már nem válhat tulajdonosi szintű ténnyé. A
felidézés is súlyozza ezeket a szinteket (lásd [Hogyan rangsorol a
felidézés](#how-recall-ranks)): a tool-kimenet és az importált, harmadik féltől
származó szöveg 0,6×, a csatornaküldők szövege 0,3× súllyal számít, a
karanténba tett szöveg soha.

**A háttér- és csapatutasításokat is megjegyzi:** egy kártya célját, amikor egy
háttérfutás elindítja, és minden csapattag eligazítását. Minden eltérő
utasítást egyszer jegyez meg, akárhányszor próbálkozik újra vagy folytatódik a
futás. Magában a beszélgetésben semmi új nem jelenik meg.

**A vault-jegyzeteknek is van bizalmi szintjük.** A modell által írt jegyzet
*derived*, nem a tiéd — az automatikus fordulónkénti jegyzetek, az éjszakai
konszolidáció és a csapat-összefoglalók. Felismerheted őket a frontmatterben
lévő `origin` bejegyzésről (`by: capture`, `consolidation` vagy `team`, plusz a
provider, a modell és a beszélgetés, ahol ismert), az `auto-consolidated`
címkéről, vagy arról, hogy linkelnek az őket rögzítő beszélgetésre. Ha egy
jegyzet `origin` mezőjét kézzel eltávolítod, egy capture-jegyzet ettől nem lesz
újra owner szintű, mert a capture-link továbbra is jelöli. Az a jegyzet, amelyet
a capture egy csatornaüzenetből vagy egy A2A taskból készített, `trust: peer`
jelölést kap, és peer bizalmi szinten tárolódik; soha nem erősít meg egy nála
jobban bízott jegyzetet, így az újra kimondott tény saját fájlt kap. A kézzel írt vagy általad importált
jegyzetek *owner* szintűek maradnak. Egy jegyzet frontmatterjéhez `trust:`
mezőt adhatsz, de az csak **csökkentheti** a szintet, soha nem emelheti: a
`trust: quarantined` kihagyja a jegyzetet az állandó memóriasorokból, és az
asszisztens nem nyithatja meg `memory_expand`-dal (a fájl a vaultban és a
Vault böngészőben marad).

**Frissítés.** A frissítés utáni első induláskor az EYAS minden vault-jegyzetet
egyszer beolvas, hogy rögzítse a bizalmi szintjét, ezért ez az indulás kicsit
tovább tart. Néhány másodperccel később egy egyszeri háttérmenet kijavítja a
meglévő vault-jegyzetek memóriáját — a modell által írt jegyzetek elveszítik a
tulajdonosi szintet, a projekt-jegyzetek a projektjükbe kerülnek —, és
újraépíti a tényeiket és az összefoglalójukat. Nincs teendő, és a menet nem
ismétlődik.

<h3 id="what-eyas-works-out-from-it--with-no-model-call">Mit vezet le belőle — modellhívás nélkül</h3>

Minden kiírás után az EYAS visszaolvassa, amit épp leírt, és magától kiveszi
belőle:

- a **tényeket** a szöveg `key: value` soraiból, plusz néhányat a beszélgetés
  saját tábla-kártyájáról (cím, projekt, projekttípus, ágens);
- egy **rövid összefoglalót**, legfeljebb 280 karakterben — az első és az utolsó
  üzenet, plusz néhány a köztük lévő legjellemzőbb mondatokból;
- az **entitásokat**: dátumok, `@mentions`, `#tickets`, kódazonosítók,
  backtickek közé zárt kifejezések, nagybetűs nevek;
- a **témákat** és egy **fontossági pontszámot**, amit a beszélgetés hossza,
  a benne a te részed aránya, a döntést jelző szóhasználat (öt nyelven), a
  lezártság és a kitűzés együtt ad ki.

Ebből semmi nem hív modellt. Nem keres meg providert, nem használ API-kulcsot,
nem költ a keretből, és nincs rajta mit beállítani. Cserébe gondosan olvas, nem
okosan: azt találja meg, ami nyíltan ki van mondva, és elszalasztja azt, ami
csak sejtetve volt.

A tények nem gyűlnek egymásra. Ha ugyanazt mondod el újra, az a már meglévő
tényhez kapcsolódik. Ha ugyanarról újat mondasz — egy határidő hétfőről
péntekre csúszik —, a régi tény záró dátumot kap és nyugdíjba megy, nem íródik
felül, tehát pontosan egy érvényes válasz van, mögötte érintetlen történettel.
Semmi nem módosul a helyén, és semmi nem vész el. Egy tény ráadásul soha nem
örököl olyan projekt- vagy beszélgetéscímkét, amit nem visel az összes forrása.

Az összefoglalókat és a tényeket olvassák az állandó memóriasorok (`gs:`
azonosítók), a felidézés, a `memory_search` és a `memory_expand`. Egy köteg
kiírása után nagyjából fél másodperccel megkapják a keresővektoraikat (lásd
[A vektoros keresés mindig helyben fut](#vector-search-always-runs-locally)).

### Mibe kerül, és hogyan kapcsolod ki {#what-it-costs-you-and-how-to-switch-it-off}

A nyers napló a használattal nő, és **egyelőre semmi nem takarítja** — ebben a
kiadásban nincs megőrzési beállítás és nincs takarító job. Mérve egy rögzített
üzenet nagyságrendileg 5 KB lemezterület, az indexeivel együtt, tehát az
adatbázis érezhetően gyorsabban fog nőni, mint eddig.

Három beállítás a `config/default.yaml`-ben, mind a `memory` alatt:

| Beállítás | Alap | Jelentés |
|-----------|------|----------|
| `memory.l0.enabled` | **be** | Főkapcsoló. `false` esetén semmit nem rögzít; a következő újraindításkor lép életbe |
| `memory.l0.extractInLegacy` | **be** | `false` esetén megmarad a szöveg, de semmit nem vezet le belőle — se tény, se összefoglaló, se téma |
| `memory.engine` | `legacy` | Csak azt dönti el, lefut-e a determinisztikus tény-kinyerés: `v2` mellett mindig; `legacy` mellett addig, amíg a `memory.l0.extractInLegacy` be van kapcsolva (ez az alapértelmezés). A felidézés mindig az ezen az oldalon leírt rétegzett felidézés, bármelyik érték van beállítva |

A `memory.capture.enabled: false` **nem** kapcsolja ki a nyers naplót. Az a
vault-jegyzeteket és a mögöttük álló kis modellhívást szabályozza; a kettő
független, és bármelyiket kapcsolod ki, a másik fut tovább.

Az `eyas doctor` megmondja, elérhető-e a tömörítés, és melyik implementáció van
használatban. Ha egyik sincs, az EYAS ezt kiírja a logba, és semmit nem rögzít,
ahelyett hogy csendben puffert töltene.

<h3 id="tool-results-are-not-recorded--and-why-to-leave-it-that-way">A tool-eredmények nem kerülnek bele — és miért hagyd így</h3>

A `memory.l0.captureToolResults` **alapból ki van kapcsolva**. Olvasd el ezt, mielőtt bekapcsolod.

Egyetlen kapcsoló fed le minden toolt, amelyet egy agent-futás hív, bármelyik modell válaszol: az EYAS saját tooljait; azokat az EYAS toolokat, amelyeket a Claude Code, a Grok vagy a Kimi az EYAS bridge-en át hív; és a Claude Code, a Grok és a Kimi beépített tooljait — parancsfuttatás, fájlok olvasása, írása vagy keresése. Az OpenCode-ra is kiterjed: az `opencode_run` feladaton belül futó OpenCode-toolokra és a beszélgetés OpenCode termináljának kimenetére (a terminál ikon a beszélgetés felső sávjában) — ez csak olyan beszélgetésnél rögzül, amely létezik és a terminál felhasználójáé. Az OpenCode végső válasza és diffjei maga az `opencode_run` eredménye, és minden más tool-eredményhez hasonlóan rögzül. (Korábban az OpenCode a kapcsolótól függetlenül tárolta a terminálkimenetet és az eseményeit.)

- Csak a ténylegesen lefutott hívások rögzülnek. A sikertelen hívás rögzül, és hibaként jelölődik. Az elutasított (denied), kihagyott és jóváhagyásra váró hívások nem rögzülnek, ahogy az üres eredmények és ugyanannak a hívásnak az ismétlései sem.
- Minden rögzített hívás azt őrzi meg, amit a hívás visszaadott: a tool nevét, a kimenetet, hogy elbukott-e, a kimenetelt, és hogy ki futtatta (az EYAS vagy a modell saját CLI-je). A hívás argumentumainak első 2048 karaktere csak eredetjelzésként kerül mellé: nincs teljes szövegű indexben, és soha nem alakítja az EYAS által kinyert témákat, neveket vagy tényeket.
- Csak a beszélgetéshez tartozó agent-futáson belüli hívások rögzülnek. Az agent-futáson kívül hívott tool (például egy külső MCP klienstől) nem rögzül. A terminálkimenet csak olyan beszélgetésnél rögzül, amely létezik és a terminál felhasználójáé.
- A rögzített hívások a beszélgetés projektje alá kerülnek, *ingested* bizalmi szinttel (lásd [Bizalom: ki írta](#trust-who-wrote-it)).

Bekapcsolva a nyers napló minden tool-hívás **teljes kimenetét megőrzi, szó szerint és szerkesztetlenül**, az argumentumai első 2048 karakterével együtt. Vagyis egy parancs teljes kimenete, minden fájl tartalma, amit az asszisztens elolvas, és bármilyen egyszer használatos kód vagy token, amit egy tool éppen visszaad — mind ott ül az adatbázisban, sima szövegként. Semmi nem maszkolja, semmi nem vizsgálja át, és a tömörítés nem titkosítás. A vault-jegyzetek írás előtt átmennek a privacy modulon; a rögzített tool-eredmények nem.

**Mi kerül vissza egy promptba.** Egy rögzített tool-hívás soha nem idéződik fel, és szövege sehol nem jelenik meg idézve: sem abban a memóriában, amelyet az EYAS egy körhöz hozzáad, sem a `memory_search` vagy a `memory_expand` útján, sem a Memória oldal keresésében, sem a beszélgetése összefoglalójában. Csak a kimenete alakítja a témákat és a neveket (például egy fájl- vagy függvénynevet), amelyeket az EYAS a beszélgetésből kinyer; az argumentumok semmit nem alakítanak. Így egy jelszó, amelyet egy tool egy űrlapba írt, egy keresőkifejezés vagy egy útvonal, amelyet a modell átadott, soha nem lesz téma, név vagy tény, egy token pedig, amelyet egy parancs kiírt, vagy egy weboldal, amelyet egy tool letöltött, soha nem jelenik meg újra egy másik beszélgetés promptjában — akkor sem, ha azt a promptot egy távoli modell kapja.

A `memory.l0.toolResultMaxBytes` (8 KB) annak a rekordját vágja le, amit a hívás visszaadott — tool neve, kimenet, hibajelző, kimenetel és hogy ki futtatta —, karakterhatáron, látható csonkolásjelzéssel. Az argumentumok nem számítanak bele; azokat külön, az első 2048 karakterükre vágja. Bekapcsolt kapcsoló mellett az EYAS minden induláskor figyelmeztet, hogy a tool-eredmények szó szerint és szerkesztetlenül tárolódnak, és semmi nem vizsgálja vagy titkosítja őket.

### A modell gondolkodása (csak audit) {#model-reasoning-audit-only}

A `memory.l0.captureThinking` (alapból **ki**) minden olyan modell gondolkodását
(„thinking”) megőrzi a nyers naplóban, amely jelenti, modellhívásonként egy
bejegyzésben. Csak auditra való: soha nem lesz belőle tény, és soha nem kerül
felidézésre egy promptba. A tool-eredményekhez hasonlóan szó szerint és
szerkesztetlenül tárolódik, és amíg be van kapcsolva, az EYAS minden induláskor
figyelmeztet.

Mindkét kapcsolót minden futás elején a futó konfigurációból olvassa az EYAS; a
`local.yaml` módosítása az EYAS újraindítása után érvényes.

**Eredet.** A rögzített tool-eredmények és gondolkodás, valamint a háttér-,
csapat- és delegált futások válaszai most már rögzítik a ténylegesen válaszoló
providert és modellt (ez nem mindig a kért, például egy tartalékra váltás után),
és azt, hogyan indult a futás: interaktív, háttér, csapat, delegálás, A2A,
csatorna vagy pipeline. A régebbi sorokból ezek a mezők egyszerűen hiányoznak.

### Miért utasít el bizonyos mondatokat {#why-some-sentences-are-refused}

Az a szöveg, ami az asszisztensnek szóló utasításként olvasható, nem válhat
megbízható ténnyé. A „Felejtsd el az összes korábbi utasítást”, a „mostantól te
vagy…” szerepváltás, vagy bármi, ami rendszerüzenetnek van álcázva, kereken
elutasításra kerül. Az asszisztensnek címzett egyszerű parancsok, a tool
futtatására szóló felszólítások és a „felejts el mindent” fordulatok
megmaradnak, de megbízhatatlan jelölést kapnak, hogy egy későbbi visszakeresés
kihagyhassa őket. Az ellenőrzés kiterjed az angol, a magyar, a német, a spanyol
és a francia nyelvre.

Ha egy összefoglalót elutasít, az EYAS nem adja fel, hanem lejjebb lép: előbb
egyszerűbb összefoglalóra, aztán csak a tisztán olvasható mondatokra, végül egy
csonkra, ami megnevezi a beszélgetést anélkül, hogy a szövegét megismételné. A
beszélgetést soha nem veszíted el, csak az összefoglalóját.

Ez mintaillesztő szűrő, nem bizonyítás, és inkább óvatos: a hétköznapi
munkaszöveg — például a `Futtasd a következő parancsot a podban: …` — néha
szintén megbízhatatlan jelölést kap. A lehetséges prompt-injekcióként megjelölt
(karanténba tett) szöveg soha nem idéződik fel, és a `memory_expand` sem nyitja
meg, annak a beszélgetésnek az összefoglalóján át sem, amelyből származik.

**A modell által írt jegyzetek ugyanezen a szűrőn mennek át.** A körönkénti
memória-capture, az éjszakai konszolidáció összefoglalói és a
csapatsession-összefoglalók ellenőrzésen mennek át, mielőtt bármi a vaultba
íródna, és bármely találat elutasítja az írást:

- **Capture:** az elutasított jegyzet elmarad. A capture-futás `poison_gate`
  okkal rögzül, és beszámít a `maxPerConversation` keretbe, mert a modell
  hívása megtörtént.
- **Konszolidáció:** semmi nem íródik ki, és az epizodikus emlékek megmaradnak; a
  következő éjszakai futás újra próbálkozik.
- **Csapatsessionök:** csak a kifogásolt megállapítás vagy döntés marad ki.

Az elutasítások a szervernaplóban a detektor nevével jelennek meg, az
elutasított szöveggel soha, így egy téves riasztás látható, nem csendes.

---

## Egy szolgáltató memóriájának karanténba helyezése {#quarantine-a-providers-memory}

Akkor használd, ha egy modell — jellemzően egy CLI, például a Grok CLI, a Kimi Code CLI vagy a Claude Code — az EYAS izolációja nélkül futott, és válaszolhatott az
EYAS-on kívüli memóriából, például egy másik tool memóriamappájából vagy egy
Obsidian vaultból. A válaszai minden más körhöz hasonlóan bekerültek az EYAS
memóriájába, és onnan minden modellhez visszajuthattak.

**Hol:** **Memória → Áttekintés**, **Egy szolgáltató memóriájának karanténba
helyezése** kártya. Csak az owner használhatja; az adminok és a felhasználók ezt
látják: *Memóriát csak a tulajdonos helyezhet karanténba vagy oldhat fel.*

1. Jelölj be egy vagy több **Szolgáltatót**. A lista minden providert mutat,
   amely írt memóriát, azoknak a sorainak a számával, amelyek még
   felidézhetők.
2. Ha kell, állíts be **Ettől** / **Eddig** dátumot. Ezek teljes helyi napok, és
   a határnapok is beleszámítanak; üresen nincs korlát.
3. Kattints az **Előnézet** gombra. Megmutatja, hány nyers sor, tény,
   összefoglaló és capture-jegyzet rejtődne el, és hány beszélgetésből. Még
   semmi nem változik.
4. Kattints a **Karanténba** gombra, majd erősítsd meg helyben. A Mégse semmit
   nem változtat.

**Mi rejtődik el minden modell elől**, minden úton (a körönkénti
memóriablokk, a `memory_search` / `memory_expand`, az állandó memóriaindex és a
vektoros keresés):

- a provider válaszai és a futásai tool-kimenete — az egyes sorokon rögzített
  provider alapján; az ilyen adat nélküli régebbi sorok azt a providert
  használják, amelyhez a beszélgetés rögzítve van;
- minden belőlük levezetett tény és összefoglaló, beleértve egy beszélgetés
  olyan összefoglalóját is, amely a te üzeneteidet is lefedi, és minden olyan
  tényt, amelynek legalább egy ilyen forrása van;
- az érintett beszélgetések capture-jegyzetei. Ezek a vault
  `.quarantine/<id>/…` mappájába kerülnek, így kiesnek a vault-böngészőből, a
  jegyzetindexből és a keresésből.

**Mit nem érint:** a saját üzeneteid soha nem kerülnek karanténba; a
beszélgetés átirata változatlan; semmi nem törlődik. A provider jövőbeli körei
továbbra is rendesen mentődnek — a karantén takarítás, nem tiltás, ezért
állítsd át a beszélgetést egy másik modellre, vagy gondoskodj róla, hogy a CLI
izoláltan fusson. Az éjszakai konszolidáció által több beszélgetésből írt
szemantikus jegyzetek nem hivatkoznak beszélgetésre, így ezeket nem követi
vissza; ezeket nézd át a vault-böngészőben.

**Előzmények és feloldás.** Az előzmények minden karantént listáznak a
providereivel, az időpontjával és a darabszámaival, egy **Feloldás** gombbal
(vagy *Feloldva: &lt;dátum&gt;* felirattal). A feloldás pontosan visszaállítja a
sorok korábbi bizalmi szintjét, és visszamozgatja a jegyzeteket. Ha egy új
jegyzet időközben elfoglalta egy visszaállított jegyzet útvonalát, a régi
`<name>-restored.md` néven tér vissza, továbbra is modell által írtként
jelölve. A `.quarantine` mappából kézzel törölt jegyzetet hiányzóként jelenti;
minden más ettől még visszaáll. Amit az automatikus mérgezés-ellenőrzés már
karanténba tett, az karanténban marad, és ugyanígy azok a tények és
összefoglalók is, amelyek a karantén után készültek karanténba tett sorokból.
Ugyanannak a kiválasztásnak az ismételt karanténba helyezése semmit nem tesz;
az egymást átfedő karanténok egymástól függetlenül oldhatók fel.

**Audit.** Minden alkalmazás és feloldás az audit naplóba (műveletek:
`memory.quarantine.apply` / `memory.quarantine.release`, modul: `memory`) és a
szervernaplóba kerül; a pontos rekord (a sorazonosítók a korábbi bizalmi szint
szerint, a mozgatott jegyzetek) a memória purge-naplójában marad meg.

**API (csak owner; `delete` a MemoryEntry-n).** A törzs: `{providers:
string[], from?: epochMs, to?: epochMs, conversationIds?: string[]}`; érvénytelen
törzsre `400` a válasz. A `GET /api/v1/memory/quarantine` `{entries, providers}`
értéket ad vissza; a `POST /api/v1/memory/quarantine/preview` `{counts}` értéket;
a `POST /api/v1/memory/quarantine` `201 {id, counts}` értéket, vagy `200 {id:
null}` értéket, ha már nincs mit karanténba helyezni; a `POST
/api/v1/memory/quarantine/:id/release` ismeretlen azonosítóra `404`-et, már
feloldott karanténra `409`-et ad.

## Shared memory blockok (kivezetve) {#shared-memory-blocks-retired}

A `memory_block_read` és a `memory_block_write` agent-tool már nem létezik. Amit
az agentek blokkokban tároltak, nem vész el: a frissítés utáni első induláskor
minden blokk egyszer, modell által írt jegyzetként átmásolódik az EYAS
memóriájába, és onnantól minden más memóriához hasonlóan megtalálható — az
állandó felidézésben, a `memory_search`-csel és a `memory_expand`-dal (`rw:`
találatként). A blokkok globális memóriává válnak, ahogy a gyakorlatban mindig
is azok voltak (bármely agent bármely blokkot olvashatott). Az a blokk, amelynek
szövege az asszisztensnek szóló utasításnak látszik, auditra megmarad, de soha
nem idéződik fel. Az az egyedi agent, amelynek tool-listája még megnevezi a
`memory_block_*` toolokat, egyszerűen nem kapja meg őket; semmi nem bukik el.

## Kapcsolódó {#related}

- [Tudásbázis](/docs/hu/knowledge/knowledge-base/)
- [Dokumentumok](/docs/hu/knowledge/documents/)
- [Projekt-wiki](/docs/hu/knowledge/client-wiki/)
- [Providerek](/docs/hu/ai/providers/) (CLI-izoláció)
- [Biztonság és adatvédelem](/docs/hu/admin/security-privacy/) (memória az EYAS-on kívül)
- [Adatimport](/docs/hu/admin/data-port/)
- [Konfiguráció](/docs/hu/deploy/configuration/) (`memory.l0.*` kulcsok)
- [Toolok](/docs/hu/automation/tools/)
- [OpenCode](/docs/hu/automation/opencode/) (memóriatoolok az OpenCode-ban)
- [Megfigyelhetőség](/docs/hu/admin/observability/) (memóriaátadás szolgáltatónként)
