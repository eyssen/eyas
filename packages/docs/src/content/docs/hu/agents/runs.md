---
title: Futtatások és Mission Control
description: Élő agent-futások felügyelete — leállítás, folytatás, újraindítás — és az élő műveleti tábla.
---

**Mire való.** Az **Agent-futások** a futtatások táblázata: élő és befejezett futások állapottal, ellenőrzéssel, körökkel, tokenekkel és műveletekkel. Az **Irányítóközpont** (Mission Control) az agent-kártyák élő műveleti táblája — ki fut, ki vár rád, ki végzett. A táblázat az előzményekhez és a helyreállításhoz kell, az Irányítóközpont a pillanatnyi áttekintéshez.

## Mikor használd

- Egy futás beragadt, elérte a körkorlátot vagy elbukott — **Folytatás** (ellenőrzőpontról) vagy **Újra** (a célból) kell.
- Valami fut, és a beszélgetés megnyitása nélkül kell **Mégse**.
- Látni akarod, hogy a teljességi ellenőr **Cél teljesült** vagy **Cél nem teljesült** jelölést adott-e.
- Összesítők kellenek: fut, jóváhagyásra vár, ma befejezve, mai költség.
- Egy élő kártyáról akarsz megszakítani egy futást vagy megnyitni a beszélgetését.

## Tipikus munkafolyamat

1. Nyisd meg az oldalsávban az **Agent-futások** oldalt (**AI** szakasz) — útvonal `/agent-runs`. Vagy az **Irányítóközpont** oldalt a **Megfigyelés** alatt — útvonal `/mission-control`.
2. Az Agent-futásokon nézd az **Állapot** és az **Ellenőrzés** oszlopot. Aktív sornál **Mégse**; sikertelen, beragadt, megszakított vagy kör-limites sornál **Folytatás** vagy **Újra**.
3. Az Irányítóközpontban olvasd el az összesítő sávot, majd lépj egy kártyán (**Megszakítás**, **Beszélgetés megnyitása**).
4. A sor vagy a kártya állapota élőben változik (WebSocket). A beszélgetés megnyitásakor ugyanannak a futásnak a haladását, futásfáját és eszközhívásait látod.

## Agent-futások

**Útvonal:** `/agent-runs`. Alcím: *Az agent-futások élő felügyelete — a beragadt futásokat felismeri és le lehet állítani.* Üresen: *Még nincs agent-futás.*

| Oszlop | Jelentés |
|--------|----------|
| **Állapot** | Lásd az állapotokat lent |
| **Ellenőrzés** | Teljességi ellenőr: **Cél teljesült** / **Cél nem teljesült** / **Nem ellenőrzött** (vagy —, ha nem volt ellenőrzés) |
| **Agent** | Agent-azonosító |
| **Típus** | A futás fajtája (vagy —) |
| **Körök** | Felhasznált körök |
| **Tokenek** | Felhasznált tokenek |
| **Utolsó előrelépés** | Az utolsó életjel óta eltelt idő |
| **Műveletek** | **Mégse** (fut, beragadt, frissül) · **Folytatás** · **Újra** (sikertelen, beragadt, megszakítva, kör-limit) |

### Állapotok

| Állapot | Jelentés |
|---------|----------|
| **Fut** | Folyamatban |
| **Beragadt** | Nincs előrelépés — leállítható / újraindítható |
| **Frissül** | Meleg folytatás folyamatban |
| **Jóváhagyásra vár** | Autonómia-jóváhagyásra parkolva |
| **Kész** | Befejeződött |
| **Kör-limit** | Elérte a körkeretet befejezés nélkül — folytasd vagy indítsd újra |
| **Sikertelen** | Hiba |
| **Megszakítva** | Leállítva |

### Ellenőrzés

| Jelvény | Jelentés |
|---------|----------|
| **Cél teljesült** | Egy ellenőrző modell összevetette az eredményt a céllal, és teljesültnek találta |
| **Cél nem teljesült** | A cél nem teljesült; a hiányokat az agent egyszer visszakapta |
| **Nem ellenőrzött** | Nem lehetett ellenőrizni (nincs ellenőrző modell, vagy nincs rögzítve semmi) |

A **Nem ellenőrzött** akkor is megjelenik, ha egyetlen háttérmodell sem tudta lefuttatni az ellenőrzést (például csak Grokot használó telepítésen, amelynek izolációja még nincs ellenőrizve), ha a modell-költségkeret leállt, vagy ha minden próbálkozás elbukott; maga a futás ettől rendben befejeződik.

**Milyen bizonyítékot fogad el az ellenőr.** Ha egy futás célja forrásokat igényel (kutatás, utánanézés, hivatkozás, implementálás, javítás, refaktorálás…), az ellenőr megalapozottságot keres, és minden modellt ugyanúgy ítél meg:

- **Az EYAS által a futásnak átadott memória bizonyítéknak számít**, bármelyik provider vagy modell futtatta. Az ellenőrző modell megkapja, mely memóriaelemeket kapta a futás, és eldönti, hogy a válasz megalapozott-e.
- **Az eszközbizonyíték az EYAS saját eszközvégrehajtási naplójából jön**, nem csak a provider által jelentett nevekből, így a Claude Code- vagy Grok/Kimi-hídon át hívott `memory_search` ugyanúgy számít, mint egy natív hívás.
- A `memory_expand` szintén visszakeresési bizonyítéknak számít.

Az átadott memória, visszakereső eszközhívás és `[source:…]` hivatkozás nélküli futás **Cél nem teljesült** jelölést kap, ha a célja forrásokat igényel. A teljességi ellenőr és az összetett háttércélokhoz írt értékelési terv egyetlen rövid, izolált hívásként fut az EYAS háttérmodelljén — eszközök és beszélgetési előzmény nélkül (lásd [Routing és költségkeret — A háttérmodell](/docs/hu/ai/routing-budget/#background-model)). Ilyen modell nélkül nem készül értékelési terv.

### Folytatás és Újra minden providernél

A **Folytatás** az utolsó ellenőrzőpontról folytat (ne-ismételd védelem). Az **Újra** a célból tervez újra; a már végrehajtott destruktív hívások továbbra is védettek. Mindkettő ugyanúgy működik a Claude Code, Grok CLI és Kimi CLI futásainál, mint az API-providereknél:

- Az EYAS a CLI által önállóan futtatott eszközöket (shell-parancsok, fájlírások és -szerkesztések, meghívott EYAS-eszközök) rögzíti a futás előzményében és az eszközvégrehajtási naplójában, az EYAS által használt neveken (a Bash `run_command`-ként jelenik meg, és így tovább).
- Minden olyan kör után, amelyben a CLI eszközöket futtatott, és valahányszor egy futás jóváhagyásra várva megáll, az EYAS ellenőrzőpontot ment: az addigi beszélgetést és a modell válaszát.
- A Folytatás vagy az Újra erről az ellenőrzőpontról folytat, és a modell összefoglalót kap a már végrehajtott eszközökről.
- Ha a modell megpróbálja megismételni az eredeti futásban már sikeresen lefutott destruktív hívást, az EYAS még azelőtt elutasítja, hogy a CLI lefuttatná: *already executed on the original run — duplicate side effect prevented*. Ugyanaz a hívás más argumentumokkal, vagy egy elsőre elbukott hívás engedélyezett. A CLI által végzett fájlszerkesztésekre és -áthelyezésekre is vonatkozik.
- Ugyanez a védelem vonatkozik azokra az EYAS-eszközökre is, amelyeket a Grok és a Kimi az eszközhídon át hív: ha egy folytatott vagy újrapróbált futás megismétel egy olyan EYAS-eszközhívást, amelyet az eredeti futás már befejezett (például ugyanannak az e-mailnek vagy számlának az elküldését), az EYAS még a futása előtt elutasítja, és az eszközsor ezzel az indokkal **Kihagyva** állapotot mutat. Ugyanaz az eszköz más argumentumokkal továbbra is lefut. A telepített Grok CLI-n bizonyított; hogy egy valódi Kimi-bináris hogyan jelenti ezeket a hívásokat, azt hoston még nem ellenőrizték.
- Grokon vagy Kimin futó háttérfutásban egy **Értesítés** vagy **Jóváhagyás** szintű kategóriába eső EYAS-eszközhívás, illetve egy olyan, amelyet a biztonsági kapu eszkalál (**Automatikus** szinten is), jóváhagyásra vár; a felügyelt futás a CLI körének végén **Jóváhagyásra vár** állapotban megáll, és a jóváhagyás pontosan azt a hívást engedi egyszer lefutni. Lásd [Autonómia](/docs/hu/agents/autonomy/).

### Hogyan ér véget egy futás

- A körkorlátot elérő futás rendben, **Kör-limit** állapottal ér véget, és a részleges válasz megmarad.
- Az eszközhívás-keretét kimerítő futás szintén rendben ér véget; az állapota **Kész** marad.
- A modell saját körkorlát-, hossz- vagy elutasítás-leállása kimenet, nem hiba.
- A le nem futott eszközhívást az EYAS nem jelenti sikeresnek. Az ok az egyik ezek közül: a körönkénti limit miatt kimaradt, a futás eszközkerete miatt kimaradt, folytatáskor ismétlésként kimaradt, a biztonsági kapu elutasította, vagy jóváhagyásra vár. A chat mindegyiket saját állapotként mutatja az eszközsoron, a válasz alatti jelvény mutatja, hogyan ért véget a kör, a jóváhagyásra váró hívás pedig jóváhagyási kártyát nyit a beszélgetésben, és bekerül a [Jóváhagyások](/docs/hu/agents/autonomy/) sorába — lásd [Beszélgetések — A kör kimenete](/docs/hu/daily/conversations/#turn-outcome).
- Ha egy futás válasszal ér véget, lefut rajta a tartós memória rögzítése (capture) — a háttér-, specialista-, delegált, pipeline-, A2A- és csapattag-futásokon ugyanúgy, mint a chatkörökön, ugyanazokkal a `memory.capture.*` beállításokkal. Az a futás, amely semmit nem válaszolt, nem ír capture-sort, és a capture-napló rögzíti, melyik útról jött egy sor (`entry_path`). Lásd [Memória — A capture alapból be van kapcsolva](/docs/hu/knowledge/memory/#capture-is-on-by-default).

## Irányítóközpont

**Útvonal:** `/mission-control`. Alcím: *Valós idejű nézet a futó ügynökökről.* Üresen: *Jelenleg nem fut ügynök.* **Kapcsolat megszakadt — újracsatlakozás…** sáv, ha a socket nem él.

### Összesítők

| Mérőszám | Jelentés |
|----------|----------|
| **Fut** | Most élő |
| **Jóváhagyásra vár** | Rád vár |
| **Ma befejezve** | Mai átfutás |
| **Mai költség** | Mai költés |

A kártyák sorrendje: előbb a jóváhagyásra várók, majd a futók, szüneteltetettek, üresjáratban lévők, hibásak, befejezettek, megszakítottak; egy állapoton belül a legutóbb frissült elöl.

| Kártyaelem | Jelentés |
|------------|----------|
| Állapot | **Üresjárat · Fut · Jóváhagyásra vár · Szüneteltetve · Befejezve · Hiba · Megszakítva** |
| **Kör / Tokenek / Költség** | Felhasználás |
| ↳ *szülő* | A futást egy másik futás indította |
| *N jóváhagyás függőben* | Sor ezen a sessionön |
| **Megszakítás** | Megerősítés után leállítja a futást (*Megszakítod ezt az ügynököt?*). Csak amíg fut, és csak annak a felhasználónak, aki indította, vagy egy ownernek vagy adminnak |
| **Beszélgetés megnyitása** | Ugrás a szálra |

A kártyán nincs szüneteltetés vagy folytatás. Egy leállt futás folytatásához használd az Agent-futások **Folytatás** vagy **Újra** gombját.

## Beszélgetésen belül

Amíg egy futás aktív, ezeket is látod:

- Agent-haladás (*N. lépés / Max*, ahol a provider lépéseket jelent, egyébként *Eszközhívások: N*; a futás összesített tokenjei; Mégse)
- Futásfa / munkafolyamat — minden providernél, állapottal és a futás költségével
- Kinyitható eszközhívások, a kör kimenetét mutató jelvények és jóváhagyási kártyák

Részletek: [Beszélgetések](/docs/hu/daily/conversations/).

Egy futás a beszélgetése munkakönyvtáraiban dolgozik. A saját mappa nélküli beszélgetésnek saját EYAS-munkaterülete van, amelyet létrehozáskor kap meg, régebbi beszélgetésnél a következő üzenetkor — a futás soha nem választ magának mappát. Lásd [Beszélgetések — Mappák](/docs/hu/daily/conversations/#working-folders).

## Kapcsolódó

- [Beszélgetések](/docs/hu/daily/conversations/)
- [Kezdőlap — Most fut](/docs/hu/daily/home/)
- [Autonómia](/docs/hu/agents/autonomy/)
