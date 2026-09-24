---
title: Observability és ops
description: Token-telemetria, trace-ek, költség, God mód futások, prompt-kontextus költség és a memóriaátadás szolgáltatónként.
---

**Mire való.** Az Observability (`/observability`) ennek a példánynak a telemetria-felülete: trace-ek, költség, késleltetés, anomáliák, ensemble (God mód) futások, amit a modell *ténylegesen* kapott, és hogy az egyes szolgáltatók mennyire egyformán kapták meg az EYAS memóriáját. Az **Ops** (`/ops`) a javítás. A kezek, távoli csomópontok, bővítmények és értesítési beállítások **nem** ezen a lapon vannak — saját fejezeteik vannak.

| Terület | Útvonal | Jelentés |
|---------|---------|----------|
| Observability | `/observability` | **AI-megfigyelhetőség** oldal (menü: **Megfigyelhetőség**) — **Használat**, **God Mode**, **Kontextus** fülek |
| Ops | `/ops` | Kubernetes ops agent — megfigyel → diagnosztizál → javasol → jóváhagy → alkalmaz. Alap **csak javaslat**. Cluster URL, kubeconfig és GitOps repo példány-config, nem termék-default. |

Máshol (nem ez a lap): [Kezek](/docs/hu/admin/hands/) (`/hands`), [Távoli csomópontok](/docs/hu/admin/nodes/) (`/nodes`) — őrzött SSH invoke-kal, [Ingress](/docs/hu/admin/ingress/) (`/ingress`), [Bővítmények](/docs/hu/admin/extensions/) (`/extensions`), [Értesítések](/docs/hu/admin/notifications/) (`/notifications-settings`).

## Mikor használd

- Tudni akarod, mennyibe kerülnek az AI-hívások naponta és modellenként, és melyik volt közülük az EYAS saját háttérmunkája.
- Egy kör lassú vagy drága volt, vagy toolokat használt, és kell a trace-e.
- Értékelni akarod a válaszokat, vagy látni, hogyan dőlt el egy God mód verseny.
- Látni akarod, mi került ténylegesen a promptba, mely szakaszok vágódtak le, és mennyire tér el a token-becslés.
- Ellenőrizni akarod, hogy minden szolgáltató — API-modellek és CLI-k egyaránt — ugyanazt a memóriát kapta.

## Tipikus folyamat

1. Nyisd meg a **Megfigyelhetőség** menüpontot (`/observability`).
2. A **Használat** fülön szűkítsd a trace-táblát a **Modell**, **Ettől**, **Eddig** és **Cél** szűrőkkel; egy trace-t a sora végén lévő hüvelykujj fel / le gombbal értékelhetsz.
3. Az ensemble versenyekhez és a győzelmi arányokhoz nyisd meg a **God Mode** fület.
4. Nyisd meg a **Kontextus** fület, és kezdd a **Memóriaátadás szolgáltatónként** kártyával, utána jönnek a szakaszátlagok, a csonkítás és a becsült vs. tényleges kártyák.

## Funkciók

<h3 id="usage-tab">Használat fül</h3>

A **Használat** a token-telemetria: az **Összes trace**, **Összköltség**, **Átlagos késleltetés** és **Anomáliák** kártyák, a **Napi költség**, a **Modellek megoszlása**, az **Aktív anomáliák**, valamint a trace-tábla — **Időbélyeg**, **Modell**, **Provider**, **Cél**, **Tokenek**, **Költség**, **Késleltetés**, **Eszközök**, **Minőség** —, fölötte a **Modell**, **Ettől**, **Eddig** és **Cél** szűrőkkel.

**Modell és „válaszolt”.** A **Modell** oszlop az általad választott modellazonosítót tartja meg, így a címkék és az árazás stabilak maradnak. Ha a provider egy másik konkrét modellt jelentett — dátumozott modellverziót, egy router választását (például OpenRouter auto), az Ollamában vagy LM Studióban betöltött modellt, vagy azt a modellt, amelyet a Grok ténylegesen futtatott —, egy második sor mutatja: *válaszolt: &lt;modell&gt;*. A háttérben futó memória-rögzítéseket is ehhez a konkrét modellhez rendeli az EYAS.

**Effort.** Minden AI-hívás trace-e rögzíti a kért reasoning effortot, a modellhez igazítás után ténylegesen használt effortot, és azt, honnan jött a kérés (beszélgetés, Deep, kolléga, delegáló beszélgetés, útválasztási szint, a modell alapértéke, …). Lásd [Providerek — Reasoning effort](/docs/hu/ai/providers/#reasoning-effort).

**Cél.** Egy háttérbeli modellhívás — amelyet az EYAS a saját céljára indít, nem egy beszélgetés köre — a **Cél** oszlopban mutatja a célcsoportját:

| Címke | Háttérhívások |
|-------|---------------|
| **Memória** | Memória-rögzítés, éjszakai konszolidáció, a reflexiós briefing, Data Port import-dúsítás |
| **Tanulás** | A heartbeat, Self-learning, Forge, skill-írás |
| **Címek** | Automatikus címek |
| **Biztonsági ellenőrzés** | Biztonsági bíró, teljességi kritikus, rubrika-tervező |
| **Tervezés** | Csapatjavaslatok, a fázisok közti újratervező |
| **Kutatás** | Kutatási futások |
| **Osztályozás** | Az Auto-routing osztályozója |

Egy beszélgetéskör (normál chat- vagy agentkör) *—* jelet mutat, és ugyanígy azok a trace-ek is, amelyeket egy olyan verzió rögzített, amely még nem rögzítette a célt. A **Cél** szűrő a **Minden hívás** (alapértelmezett) vagy egy csoport közül választ; egy csoport csak a saját háttérhívásait listázza (a beszélgetéskörök soha nem illeszkednek), a szűrő váltása pedig az első oldalra visz vissza. Minden háttérhívás ugyanúgy trace-elődik, mint egy beszélgetéskör — provider, modell, tokenek, költség, késleltetés, kért és tényleges effort (forrás: *útválasztási szint*) —, és a költsége ugyanúgy beszámít a költségkeret napi, heti és havi korlátaiba, mint a beszélgetésköröké. Az a háttérhívás, amely azért nem futhatott le, mert nem volt jogosult modell, nem hív modellt, nem hagy trace-t, és nem kerül semmibe. Az automatikus címadó hívások a beszélgetésükhöz vannak rendelve. Hová mennek az egyes csoportok hívásai: [Routing és költségkeret — Háttérben futó modellhívások](/docs/hu/ai/routing-budget/#background-model-calls-card).

**Eszközök.** Az **Eszközök** oszlop minden providernél ugyanúgy számolja egy trace toolhívásait: azt a hívást, amelyet a modell visszaadott az EYAS-nak futtatásra, és azt is, amelyet egy CLI a saját ciklusában futtatott — Claude Code, Grok CLI és Kimi Code CLI —, akár a CLI saját beépített toolja volt (shell, fájlolvasás, …), akár egy EYAS tool, amelyet az EYAS hídon át hívott. Minden hívás egyszer számít. A korábbi verziók minden CLI-körnél 0-t mutattak.

**Minőség.** A **Minőség** oszlop a saját értékelésed: a sor végén lévő hüvelykujj fel / le gomb *jó* vagy *rossz* jelölést ad a trace-nek. Az EYAS nem pontozza automatikusan a trace-eket; ha szám áll ebben az oszlopban, azt egy régebbi verzió rögzítette.

**A tokenszámok minden providernél ugyanazt jelentik.** Az *input* tokenek azok a prompt-tokenek, amelyeket **nem** a provider cache-e szolgált ki; a cache-olvasásokat (és Anthropicnál a cache-írásokat) külön számolja az EYAS. A korábbi verziók az OpenAI-családnál és a Gemininél az input tokenekbe számolták a cache-elt részt, ezért cache-nehéz beszélgetéseken az input számuk most kisebb, a cache-elt rész pedig cache-olvasásként jelenik meg. A reasoning- vagy thinking-tokenek az *output* tokenek részei; a Gemini thinking-tokenjei korábban hiányoztak, ezért a thinking-modellek Gemini output-száma most nagyobb. Az OpenAI reasoning-tokenjeit és a Gemini thinking-tokenjeit külön, reasoning-tokenként is tárolja az EYAS, csak tájékoztatásul — kétszer nem számlázza őket. A Grok CLI és a Kimi Code CLI számai ugyanezt a jelentést követik. Ha egy provider egyáltalán nem küld használati adatot (egyes kompatibilis szerverek, számok nélküli Ollama szerver, egy CLI, amelynek a runtime-ja semmit nem jelentett), a kör *nem jelentett* jelölést kap, és nem valódi nullaként tárolódik; a beszélgetés $0 helyett *Nincs jelentett felhasználás* feliratot, a futásfa *—* jelet mutat. Az Anthropic API-n a prompt-cache automatikus, ezért ezeknél a hívásoknál cache-olvasási és cache-írási tokenek is megjelennek (lásd [Providerek — Prompt-cache](/docs/hu/ai/providers/#prompt-caching-anthropic-api)).

**Költség.** Ha egy provider saját költséget jelent, a trace azt használja. Különben az EYAS a tokenszámokból becsli, minden prompt-tokent egyszer árazva: a nem cache-elt inputot az input-díjon, a cache-olvasást a modell cache-olvasási díján, a cache-írást a cache-írási díján. Ha az ártáblában (vagy a konfiguráció `model.pricing` felülírásában) nincs cache-díj egy modellhez, a cache-elt tokenjeit a normál input-díjon számolja. A *nem jelentett* használatú hívást az EYAS soha nem árazza tokenszámokból: a költsége az, amit a provider maga jelentett, vagy $0. A korábbi verziókhoz képest:

- Kimi K3 a Kimi API-n keresztül, és minden modell, amelynek cache-olvasási díja van egy `model.pricing` felülírásban: a becslés kisebb, mert a cache-elt részt már nem számolja kétszer.
- OpenAI és Gemini a beépített táblával: az input-költség változatlan.
- Gemini thinking-modellek: a becslés nagyobb, mert a thinking-tokenek outputként számlázódnak.
- A táblában nem szereplő Anthropic-kompatibilis végpontok: a cache-elt tokenek ingyenes helyett a konzervatív tartalék input-díjon számlázódnak.
- Claude Code futások, ahol a CLI nem jelentett költséget, de tokenszámokat igen: a cache-tokenek ingyenes helyett a megfelelő Anthropic cache-díjakon árazódnak.

Nincs mit beállítani és nincs mit migrálni: az új trace-oszlopok automatikusan létrejönnek.

**API (adminoknak és integrátoroknak).** A `GET /api/v1/observability/traces` (és a `/traces/:id`) az audit-napló olvasási jogát igényli (read `AuditEntry`). A fenti oszlopokon túl minden trace tartalmazza:

- a `purpose` mezőt (a pontos cél, például `capture`, `title`, `security_judge`, `triage`), az `auxRoute` mezőt (hogyan választódott a modell: `tier` = a cél útválasztási szintje, `default` = a telepítés alapértelmezése, `api` = egy API provider, `isolated-cli` = izoláltan futni képes CLI) és a `purposeGroup` mezőt — beszélgetésköröknél mindhárom null;
- a `toolCalls` mezőt — a hívások JSON listája, mindegyik `{name, id}`, és `executedBy` (`provider` vagy `eyas`) annál a hívásnál, amelyet a CLI a saját ciklusában intézett el;
- a `memoryTiersUsed` mezőt — a körbe felidézett memória JSON darabszámai rétegenként: `vt` vault-jegyzet, `gs` összefoglaló, `ft` tény, `en` entitás, `ep` epizód, `rw` nyers sor, például `{"vt":75,"gs":5,"ft":3}`. Null, ha a kör nem vitt memóriát, és azoknál a hívásoknál, amelyeknek nincs kontextus-összeállításuk (háttérhívások).

A lista elfogadja a `purposeGroup=memory|learning|title|safety|planning|research|triage` paramétert. A lekérdezés validált: ismeretlen `purposeGroup`, nem numerikus vagy tartományon kívüli `limit` (1–500), negatív `offset`, illetve nem numerikus vagy negatív `minCost` esetén `400` a válasz, ahelyett hogy az EYAS figyelmen kívül hagyná; az üres paraméterek hiányzónak számítanak.

<h3 id="god-mode-tab">God Mode fül</h3>

A **God Mode** fül listázza az ensemble futásokat (beszélgetés, győztes, modellszám, költség, időtartam, döntetlen-bontás), a modell szerinti győzelmi arányt, és az átlagos költség-szorzót egyetlen modellhez képest. Egy futásra kattintva a beszélgetés God füle nyílik (lépésnapló, ki kire szavazott, és minden modell megjegyzései a többiekről).

Hogyan áll fel egy verseny, hogyan dől el a győztes, és hogyan olvasd a beszélgetés God fülét: [Beszélgetések — God mód](/docs/hu/daily/conversations/#god-mód).

<h3 id="context-tab">Kontextus fül</h3>

A **Kontextus** fül azt mutatja, mit kapott *ténylegesen* a modell — nem azt, amit küldeni szántunk. A **Memóriaátadás szolgáltatónként** kártyával nyílik (lásd lent), utána jön:

- **Becsült vs. tényleges** — az EYAS token-becslése és a szolgáltató által jelentett érték közti rés, az átlagos abszolút hibával;
- **Átlagos token szekciónként** — az egyes promptszakaszok átlagos és maximális token-költsége, és hogy hány mintán alapul;
- **Csonkítási gyakoriság** — milyen gyakran és melyik szakasz vágódik le a keret betartásához.

A részletes, szakaszonkénti rekordok megőrzési ideje szándékosan rövid (alapból 7 nap, `observability.contextRetentionDays`); hosszú távon csak a napi összesítés marad meg. Ha régi részletet keresel és nem találod, az szándékos, nem adatvesztés.

<h4 id="memory-delivery-by-provider">Memóriaátadás szolgáltatónként</h4>

Ez a kártya szolgáltatónként mutatja, hogy a köreik ugyanazt az EYAS memóriát kapták-e — ezzel ellenőrizhető, hogy egy API-modell és egy CLI egyformán kap-e memóriát. Az időszakot jobb felül választod: **Utolsó 7 nap**, **Utolsó 30 nap** vagy **Utolsó 90 nap**. Minden szolgáltatónak, amely az időszakban köröket válaszolt meg, egy sora van; failover után a kör annál a szolgáltatónál számít, amelyik ténylegesen válaszolt.

| Oszlop | Jelentés |
|--------|----------|
| **Szolgáltató** | A szolgáltató azonosítója. Kattints rá a legutóbbi köreiért |
| **Körök memóriával** | *N / M*: azok a körök, amelyeknek az üzenete felidézett memóriát vitt, az összes köréből |
| **Elemek rétegenként (átl.)** | A beinjektált memóriaelemek átlagos száma rétegenként, a memóriát vivő körökre, rétegkód-badge-ekként (`vt`, `gs`, `ft`, `en`, `ep`, `rw`); egy badge fölé víve a réteg neve látszik |
| **Memóriatoken (átl.)** | A beinjektált elemek saját token-becslésének átlaga, a memóriát vivő körökre |
| **Memória-drill-down körönként** | *X hívás · Y elem*, az összes kör átlagában: azok a `memory_search` / `memory_expand` hívások, amelyeket a modell maga indított és amelyek olvastak valamit, és az ezek által olvasott memóriaelemek |

Egy szolgáltatóra kattintva a legutóbbi 10 köre listázódik: az időpont (link, amely megnyitja a beszélgetést), a modell, az elemek rétegenként vagy *nincs memória*, a memóriatokenek és a drill-downok (*hívás · elem*, vagy csak *elem* azoknál a köröknél, amelyeket még a hívásszámok naplózása előtt rögzített az EYAS).

**Hogyan hasonlítsd össze a szolgáltatókat.** Ha a **Körök memóriával** és az **Elemek rétegenként (átl.)** hasonló, akkor minden modell ugyanazt a memóriát kapta. A **Memória-drill-down körönként** azt mutatja, hogy a modell maga is megnyitja-e a memóriát: az a CLI, amelyiknek jóval kevesebb drill-downja van, mint az API-modelleknek, nem éri el vagy nem használja az EYAS memóriatooljait.

A kártya a kontextus-összeállítás részleteiből készül, így csak az `observability.contextRetentionDays` idejéig (alapból 7 nap) lát vissza: az **Utolsó 30 nap** és az **Utolsó 90 nap** csak akkor mutat többet, ha ezt a megőrzést megemeled. Az a kör, amelynek a felidézését az EYAS nem elemenként naplózta, körként számít, de elemek nélkül.

**API.** `GET /api/v1/observability/memory-parity?days=N` — az `N` 1 és 90 közötti egész szám (alapból 7); ugyanazt a read `AuditEntry` jogot igényli, mint a többi observability-végpont, érvénytelen `days` esetén `400` a válasz. A válasz: `{days, since, providers: [{provider, turns, memoryTurns, avgItemsByLayer, avgItems, avgMemoryTokens, drillDownTurns, avgDrillDownCalls, avgDrillDownReads, recentTurns: [{compositionId, createdAt, conversationId, model, hasMemory, itemsByLayer, items, memoryTokens, drillDownCalls, drillDownReads}]}]}`.

<h4 id="single-turn-composition">Egyetlen kör összeállítása</h4>

Egyetlen kör összeállítása a beszélgetés kontextussávjáról nyílik — lásd [Beszélgetések — Kontextus-összeállítás](/docs/hu/daily/conversations/#context-composition): a mért vagy becsült ablaktelítettség, a szakaszonkénti adatvédelmi badge-ek és az **Átadott memória** doboz. A `GET /api/v1/observability/compositions/:id` ugyanezt adja vissza: `composition.egress` és szakaszonként `egress` (`{masked, spans, skipped}`) arról, mit csinált az adatvédelmi réteg; `composition.delivery` (turnId, profile, budgetTotalTokens, recall — ids, hits, retrieved, expanded, chars, budgetChars, tokens, budgetTokens, withheld — és systemPromptChannel); valamint `composition.drillDown` (`{calls, reads, limit}`). Mindegyik null, ha semmi nem rögzült; a `drillDown` akkor is null, ha a memória-hozzáférési napló nem olvasható. A listavégpont változatlan. A memória-hozzáférési naplóban egy kör felidézési és drill-down sorai ugyanazt a körazonosítót (az összeállítás azonosítóját) viselik, a drill-down sorok pedig rögzítik a hívás sorszámát a körön belül.

## Kapcsolódó

- [Mission Control](/docs/hu/agents/runs/)
- [Routing és költségkeret](/docs/hu/ai/routing-budget/)
- [Memória](/docs/hu/knowledge/memory/)
- [Több példány](/docs/hu/deploy/multi-instance/)
- [Biztonság](/docs/hu/admin/security-privacy/)
- [Beállítások áttekintés](/docs/hu/admin/settings/)
- [Kezek](/docs/hu/admin/hands/)
- [Távoli csomópontok](/docs/hu/admin/nodes/)
- [Bővítmények](/docs/hu/admin/extensions/)
- [Értesítések](/docs/hu/admin/notifications/)
