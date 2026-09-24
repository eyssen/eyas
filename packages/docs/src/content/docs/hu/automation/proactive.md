---
title: Proaktív asszisztens
description: Heartbeat-alapú riasztások, insightok és tanult leckék — az asszisztens, ami előhozza a munkát.
---

**Mire való.** A proaktív asszisztens figyeli, minek kell rád: lejárt beszélgetés, avult szál, anomália, lehetőség, emlékeztető. Nem helyettesíti a Táblát vagy a Kezdőlapot. A Kezdőlap **Figyelem** csempéje ugyanazokat a riasztásokat mutathatja; ez az oldal a teljes lista plusz **Tanult leckék**. A heartbeat maradjon **ki**, amíg nem érted a jóváhagyást és a költséget — ütemezett, fizetős modellhívásokat indít.

**Útvonal:** `/proactive`. Cím: **Proaktív irányítópult**. Alcím: *Aktív riasztások, insightok és tanult minták.* A Dashboard **Figyelmet igényel → Riasztás** tételein is megjelenik.

## Mikor használd

- Nudget akarsz, ha a munka lejárt vagy a beszélgetés avult.
- Bekapcsoltad a **Proaktív heartbeat**et az Autonómiánál, és kell az operátori felület.
- Egyszeri **Ellenőrzés most**, nem a következő heartbeat.
- Leckéket nézel, amiket korábbi riasztásokból tanult.

## Tipikus folyamat

1. **Proaktív heartbeat** az [Autonómia](/docs/hu/agents/autonomy/) alatt (Beállítások → Autonómia) csak ha akarsz háttérköltséget.
2. Nyisd a **Proaktív**at (`/proactive`).
3. **Aktív riasztások.** Prioritás: **Sürgős / Magas / Normál / Alacsony**. Típus: anomália, lehetőség, emlékeztető, insight.
4. **Ellenőrzés most** azonnali értékelés. Üres: *Minden rendben — nincs aktív riasztás*.
5. **Tanult leckék** — már alkalmazott minták (bizalom %).

## Funkciók

Bekapcsolva az Autonómiánál az EYAS periodikusan értékeli, értesítsen-e vagy cselekedjen (policy szerint).

**A briefing szövegét** az EYAS háttérmodellje írja, egyetlen izolált hívásban: a **Heartbeat** routing-szint (elsődleges, majd tartalék), utána a telepítés alapértelmezése, utána az API providerek, végül az izolált hívásra képes CLI-k — soha nem olyan provider, amelyet a gateway magától választ, és soha nem a saját tooljaival és memóriájával futó CLI. Ha egyik modell sem jogosult (például csak Grokos vagy csak Kimis telepítésen, amíg az izolációjuk nincs ellenőrizve), vagy a költségkeret *stop* állásban van, az EYAS nem hív modellt, és a beépített *Heartbeat: items may need your attention* riasztást küldi az okok listájával. Lásd [Routing és költségkeret — A háttérmodell](/docs/hu/ai/routing-budget/#background-model).

**A háttérfutások ugyanazt a memóriát kapják, mint a chat.** Ha a heartbeat vagy egy board-kártya háttérfutást indít, az ugyanazt a felidézett memóriablokkot kapja az aktuális dátummal és idővel, mint egy chatkör (lásd [Memória — Hogyan jut el a felidézés a modellhez](/docs/hu/knowledge/memory/#how-recall-reaches-the-model)). A kártya célját is megjegyzi az EYAS — minden eltérő célt egyszer, akárhányszor próbálkozik újra a futás —, mégpedig az EYAS által írt szövegként, nem a tiédként.

**Egy futtató a háttérfutásokhoz.** A bot-listen vagy auto-assignee stage-ben lévő kártyák és az `assign_task` kártyák ugyanazzal a beállítással futnak, mint ugyanannak a kártyának az újrapróbálása, egy [ütemezett agent-rutin](/docs/hu/automation/scheduler/#agent-routines-run-in-a-conversation) és egy átadással elindított kolléga: felügyelten, autonóm módon, az autonómia-létra kapuja mögött, a kártya modelljén, memória-felidézéssel, csatolt designokkal, dokumentumokkal, tartós memória-rögzítéssel és a teljességi kritikussal. A board-futások most már designokat, dokumentumokat és tartós memória-rögzítést is kapnak, ami korábban hiányzott. Egy háttérkártya a providert és a modellt mindig egyetlen kötésből veszi, soha nem kombinálja a kártya providerét egy másik provider agent-modelljével.

A heartbeat **SLA breach** jeleket (`slaBreaches`) is kibocsáthat.

| Jel | Jelentés |
|-----|----------|
| **Overdue** | Beszélgetés / activity a határidőn túl |
| **Stale** | Túl régóta tétlen, de nyitott / dolgozik |

Operátori figyelem — Tábla-prioritás és [Kezdőlap](/docs/hu/daily/home/) ajánlások mellett.

## Mezők és vezérlők

<h2 id="alerts">Aktív riasztások</h2>

| Vezérlő | Jelentés |
|---------|----------|
| **Ellenőrzés most** | POST `/proactive/check` |
| **N sürgős** | Sürgős + magas darabszám |
| Prioritás | **Sürgős / Magas / Normál / Alacsony** |
| Típus | anomaly · opportunity · reminder · insight |
| Cím / törzs | Szöveg |
| Opcionális gomb | `actionLabel` — URL ha van |
| Időbélyeg | Létrehozás |

<h2 id="lessons">Tanult leckék</h2>

| Mező | Jelentés |
|------|----------|
| Cím / összefoglaló | Szöveg |
| **N% bizalom** | Mennyire biztos |
| Alkalmazva | Ha van |

Üres: *Még nincs tanult lecke.*

## Kapcsolódó

- [Autonómia](/docs/hu/agents/autonomy/)
- [Kezdőlap](/docs/hu/daily/home/)
- [Beszélgetések](/docs/hu/daily/conversations/)
- [Öntanulás](/docs/hu/automation/self-learning/)
- [Ütemező](/docs/hu/automation/scheduler/)
