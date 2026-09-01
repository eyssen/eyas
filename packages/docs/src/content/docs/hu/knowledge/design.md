---
title: "Design vásznak"
description: "UI, landing, nyomtatás vagy deck artboardok — majd csatold beszélgetéshez vagy projekthez."
---

**Mire való.** A design artboardok halmaza egy pásztázható, nagyítható vásznon. Létrehozod, importálod, vagy agenttel piszkozolod; kézzel, a vásznon vagy AI-jal szerkeszted; verziózod, és csatolod, hogy a beszélgetés lássa. A fájlformátum a Claude Designé; a runtime az EYAS-é.

## Mikor használd

- UI-t, landinget, nyomtatványt vagy slidedeck-et tervezel, és az EYAS-ban akarod, nem csak külső eszközben.
- Az agentnek névvel ellátott artboardokat (tokens, components, page) kell olvasnia, ne találgasson kinézetet.
- Publikált Claude Design vásznat importálsz, vagy PNG/PDF-et exportálsz.
- A beszélgetésnek vagy projektnek minden körrel vinnie kell a vásznat.

## Tipikus munkafolyamat

1. Nyisd a **Design**t az oldalsávon (**Tartalom** szakasz) — útvonal `/design`.
2. Írj nevet, és nyomj **Újat** (vagy **Import** egy publikált vászon HTML-jét).
3. Szerkessz a vásznon, a **Source**-ban, vagy az **AI** panelen. **Save** (egy verzió mentésenként).
4. A beszélgetésben a **Design** ikonnal csatold. Az agentnek tudnia kell részeket kérni; a vászon pipával kell szerepeljen a listán.

A design artboardok halmaza egy pásztázható, nagyítható vásznon. Minden artboard
egy `.dc.html` fájl; a `canvas.json` rögzíti, hogy melyik hol helyezkedik el,
melyik oldalhoz tartozik, és hogy egy friss megnyitás melyik nézetben landol. A
képek a vásznon belül, a saját fájlnevükön élnek.

A fájlformátum a Claude Design formátuma, tehát az ott készült vászon ide
importálható és megjelenik, az innen exportált pedig ott újraépíthető. Az EYAS a
saját runtime-jával rendereli — a két eszköz fájlformátumot oszt meg, nem kódot.

## Design létrehozása

A `/design` oldalon írd be a nevet, és nyomj **Újat**. Egy egy-artboardos kezdő
vásznat kapsz, amit lecserélhetsz.

Az **Import** egy publikált design-vászon oldal teljes HTML-jét fogadja. Az olyan
oldalt, amelynek a tartalma a kiszolgáló platform saját tárában van, nem a
lapban, elutasítja: a beágyazott másolat csak egy elavult, első-megnyitáskori
pillanatkép, és az importálásával csendben egy régi verziót kapnál.

Létrehozhatja ügynök is. Bármit is állít elő, ugyanazon az ellenőrzésen megy át,
mint a saját szerkesztéseid.

## Mozgás a vásznon

A háttér húzásával mozgathatsz. A görgő pásztáz, a **Shift**+görgő oldalirányban,
a **Ctrl/⌘**+görgő nagyít — a nagyítás a mutatóra van horgonyozva, tehát ami a
kurzor alatt van, az ott is marad. A **Fit** az oldal teljes tartalmát a képre
igazítja.

A pásztázás az artboardok *körüli* területen működik, nem rajtuk. Egy artboard
elszigetelt keret, amely megtartja a saját egéreseményeit — pontosan ettől működik
egy interaktív prototípus.

Ha a vászonnak több oldala van, az oldalgombok a fejlécben jelennek meg.

## Egy artboard megnyitása

Minden artboard neve mellett van egy megnyitó gomb — vagy kattints duplán a
névre. Az artboard egyedül tölti ki a nézetet, az **Esc** pedig visszavisz oda,
ahol voltál.

Hogy hogyan nyílik meg, az az artboard tulajdonsága: alapból az egészet
lekicsinyíti, hogy elférjen; a kitöltésre állított artboardot viszont a nézet
szélességére teríti természetes méretben, és görgethetővé teszi — ezt akarja egy
fluid szélességű terv.

## Három szerkesztési mód

**A vásznon.** Nyisd meg a **Szerkesztést**, és kattints egy elemre. A
tulajdonság-panel módosítja a tipográfiáját, színét, dobozát, szegélyét és
elrendezését; az olyan grid, amelynek minden oszlopa egyenlő, sima oszlopszámként
szerkeszthető. A szöveg helyben írható, kivéve ha az artboard logikájából jön —
ilyenkor a panel szól, ahelyett hogy felülírná a kötést.

A Cmd/Ctrl+Z visszavon, a Shifttel újra, és semmi nem tárolódik mentésig: mentésenként
egy verzió, nem billentyűleütésenként.

Az interaktívnak jelölt artboard megtartja a saját vezérlőit, és a Forrás-panelen
szerkeszthető — a kijelölés elnyelné azokat a kattintásokat, amelyek a
prototípusnak kellenek.

**A forrásban.** A Forrás-panel felsorolja a vászon minden fájlját, és
közvetlenül szerkeszti őket.

**AI-jal.** Nyisd meg az AI-panelt, írd le a változtatást, alkalmazd.

Az eredmény — bárhonnan is jött — tárolás előtt átmegy a vászon szabályain: a
gyökérelem nélküli artboard, a nem létező fájlra mutató elrendezés-bejegyzés, a
mögöttes tartalom nélküli képhivatkozás vagy a kapcsos zárójelen kívüli feltételt
tartalmazó style-attribútum mind elutasításra kerül, és az előző verzió pontosan
úgy marad, ahogy volt. Ha a modell első próbálkozása elbukik az ellenőrzésen, az
EYAS megmutatja neki a konkrét problémákat, és még egyszer megkérdezi.

Ez minden beállított providerrel ugyanígy működik. Az EYAS nem adja át a feladatot
az egyik gyártó saját eszközének csak azért, mert épp az van beállítva; a prompt,
az ellenőrzés és a tárolt eredmény mindkét esetben ugyanaz.

Egy AI-szerkesztés CLI provideren, nagy vásznon több percig is tarthat. A panel
futás közben számolja az eltelt időt, és az oldal elhagyása nem szakítja meg.
Minden kísérlet rögzül, így a panel utólag is megmutatja a legutóbbit —
alkalmazva, sikertelen az indokával, vagy szerver-újraindítás szakította meg —
akkor is, ha közben újratöltötted az oldalt vagy megszakadt a kapcsolat. Amíg
egy szerkesztés fut, ugyanazon a vásznon nem indítható másik.

## Finomhangolók

A finomhangoló-chipek az artboard saját, deklarált opcióiból jönnek. Egy
módosítása azonnal újrarendereli; a rögzítése visszaírja az értéket az artboard
alapértelmezéseként.

## Verziók

Minden változtatás egy verzió, azzal együtt rögzítve, hogy ki csinálta, mi volt,
és hogy embertől, importból vagy az AI-tól jött-e. Egy régebbi verzió
visszaállítása előremásolja azt újként, tehát semmi nem vész el soha.

## Az artboardok elnevezése, hogy megtalálhatók legyenek

Az ügynökeid nem olvassák be a teljes vásznat — lásd a következő szakaszt. Egy
indexet olvasnak, amely minden artboardot a betöltött szerepe szerint osztályoz,
és a jól elnevezett artboardot megtalálják. A szótár:

| Szerep | Mi tartozik bele |
|---|---|
| **tokens** | A paletta, térközök, lekerekítések — az értékek, amikre minden más hivatkozik |
| **typography** | A méretskála, vastagságok, betűtípusok |
| **components** | Gombok, beviteli mezők, jelvények: a darabok, az állapotaikkal |
| **patterns** | Ezek a darabok összeállítva: kártyák, listák, eszköztárak |
| **page** | Egy teljes képernyő vagy nyomtatott oldal |

A szerepet az artboard `canvas.json`-beli címéből olvassa ki, aztán a
fájlnevéből. Az a design, amelynek *Tokenek*, *Tipográfia* és *Komponensek* nevű
artboardjai vannak, navigálható; öt *Frame 1*–*Frame 5* nevű artboardot csak
találomra lehet nyitogatni. Az AI által generált designok eleve így nevezik el
őket.

Egy design rendszer vászna legalább egy tokens és egy typography artboardot
vigyen.

## Design csatolása

**Beszélgetéshez.** A beszélgetés felső sávjában a **Design** ikon csatol hozzá
egy vásznat. Az ikonon lévő szám azt mutatja, hány van játékban; a legördülő
minden designt felsorol, a csatoltakon pipával. Az ügynökök maguk is tudnak
csatolni és leválasztani.

**Projekthez.** A **Projektek → szerkesztés** alatt. A projektben létrehozott
beszélgetés a projekt designjaival indul, és onnantól ő birtokolja őket — ha ott
leválasztasz egyet, az csak azt az egy beszélgetést érinti. Ha be van állítva a
projekten, az új beszélgetések megkapják; ha nincs, akkor nem. A projekt
designjainak későbbi módosítása a már létező beszélgetéseket nem éri el.

Ez ugyanaz a viselkedés, mint a projekt kódforrásainál és munkamappáinál.

## Amit egy ügynök lát a csatolt designból

Nem a vásznat — az fordulónként több tízezer karakter lenne. És az értékeit sem:
egy **bejelentkezést**. A design közli, hogy csatolva van, és hogy melyik része
MILYEN TÍPUSÚ adatot tartalmaz — tokenek (színek, térközök, lekerekítések),
tipográfia, komponensek, minták. Az öt-artboardos, 46 KB-os Odoo designra ez
**652 karakter**, és ekkora is marad, ahogy a design nő.

Az ügynök ezután kizárólag azt kéri le, amire szüksége van:

| Hívás | Mit ad vissza |
|-------|---------------|
| `design_read` `part`-tal | Egy rész derivált értékeit — színek, betűtípusok. Kicsi. |
| `design_read` `file`-lal | Egy artboard teljes markupját, ha épp markup kell. |

**Miért nem egyszerűbb beletenni a palettát?** Egy ideig benne volt. A blokkot
**minden forduló** fizeti, a lekérést **egyszer**. Két fordulónál a lekérés már
olcsóbb, és csak ez az alak az, aminek a költsége nem nő a vásznnal. Ugyanez a
számtan igaz minden méretnél, ezért a kis design is bejelentkezik, nem
beágyazódik.

A blokk ráadásul utasítja is az ügynököt, hogy kövesse a designt, nem csak
bejelenti, hogy van egy csatolva — tehát amit abban a beszélgetésben előállít, a
te palettádat, a te tipográfiádat és a te komponens-formáidat használja.

## Exportálás és nyomtatás

Az export menü kétféle dolgot kínál.

A **Fájlok** magát a vásznat adja: önálló HTML oldalt, amely bármelyik
böngészőben megnyílik, vagy hordozható vászon-dokumentumot, amelyből egy másik
eszköz újra tud építkezni.

A **Nyomtatás** valódi böngészőn keresztül rendereli a tervet: a kijelölt
artboard PNG-je normál vagy dupla felbontásban, a kijelölt artboard PDF-je, vagy
egyetlen PDF a teljes vászonról.

Hogy egy artboard hogyan nyomtatódik, az az artboard tulajdonsága. A **rögzített**
artboard — ez az alapértelmezés, és ilyen egy poszter, szórólap vagy
brosúra-oldal — pontosan egy oldalként jön ki, pontosan akkora méretben, amekkora
a vásznon. A **folyó** artboard — feljegyzés, riport — A4-re vagy Letterre
tördelődik aszerint, hogy melyiket választod a menüben; az oldalnál szélesebb
hasáb lekicsinyítve fér el, a keskenyebb pedig azon a szélességen marad, amire
tervezték, nem nagyítjuk fel.

A teljes vászon PDF-je minden artboardot külön oldalra tesz, abban a sorrendben,
ahogy a vásznon olvasnád őket: oldalanként, majd fentről le, majd balról jobbra.
Az oldalak megtartják a saját méretüket, tehát egy eltérő méretű artboardokból
álló brosúra helyesen exportálódik, nem kényszerül egyetlen papírméretre.

A nyomtatáshoz az EYAS mellé telepített böngésző kell. Ha nincs, a nyomtatási
tételek le vannak tiltva, és a menü megmondja, mit kell telepíteni. A **Fájlok**
alattiak mindkét esetben működnek.

## Átnevezés és törlés

Kattints a címre a fejlécben, írd át, Enter. Az Esc elveti.

A fejléc jobb szélén lévő kuka törli az egész designt. Előbb rákérdez, és a
kérdés megnevezi, mi megy vele: minden mentett verzió, és minden beszélgetés
vagy projekt, amihez a design csatolva van. Nincs visszavonás, és nincs kuka,
ahonnan elő lehetne venni.
