---
title: Csapatok és delegálás
description: Kollégák, akikkel beszélsz, specialisták, akiket indítanak, és mikor jelenik még meg csapatjavaslat.
---

**Mire való.** **Kollégákkal** (elsődleges és csapat-agentekkel) beszélsz. Szigorú szerepük van. A munkát átadják egy másik kollégának, vagy **specialistákat** indítanak egy közös poolból — automatikusan, gyakran párhuzamosan. Csapatjavaslat-kártya csak akkor jelenik meg, ha hiányzik egy specialista, csapatot kértél, vagy a munka epic méretű.

Ez együttműködés, nem Isten mód (amikor több modell ugyanazon a feladaton versenyez).

## Mikor használd

- A Személyi asszisztenssel vagy a Rendszermérnökkel emberként akarsz beszélni, nem egy rejtett legördülő menüként.
- Egy feladathoz egyszerre több specialista kell (`run_specialist` egy körben).
- Git worktree-k kellenek, hogy a párhuzamos szerkesztők ne ütközzenek (implicit session két vagy több író specialistával, és epic csapatjavaslatok).
- Továbbra is látható tervet akarsz **Elfogadom** gombbal, ha egy specialista még nem létezik.

## Tipikus munkafolyamat

1. Nyiss meg egy **kollégát** az oldalsávból (**Kollégák**), vagy válassz egyet egy új beszélgetésben.
2. Kérd meg, hogy végezze el a munkát. Más szerep munkája helyett `handoff_to_colleague`-ot vagy `run_specialist`-et kell használnia.
3. A specialista-futások al-beszélgetésként jelennek meg. A csapatmemória javaslatkártya nélkül is működik (implicit session).
4. Kattints a **Team Dashboard megnyitása** gombra, ha több specialista dolgozik egyszerre.
5. **Team javaslat** kártya továbbra is megjelenik `/team`, „használj csapatot” vagy epic munka esetén — **Elfogadom** vagy **Kihagyom**.

## Fogalmak

| Fogalom | Jelentés |
|---------|----------|
| **Kolléga** | Elsődleges vagy csapat-agent, akinek közvetlenül írsz. Van otthoni szála és hangja (SOUL). |
| **Specialista** | Szűk feladatkörű munkás. Közös pool — bármelyik kolléga bármelyik engedélyezett specialistát elindíthatja. |
| **`run_specialist`** | Soron belüli indítás; megvárja az összefoglalót. Zöld (nincs kattintás). Alias: `delegate_to_agent`. |
| **`handoff_to_colleague`** | Megnyitja a másik kolléga otthoni szálát, és azonnal futást indít benne, az eligazítással mint céllal. Amíg a szál foglalt, *busy* üzenettel elutasítja. Zöld. Lásd [Beszélgetések — Átadás](/docs/hu/daily/conversations/#handoff). |
| **`assign_task`** | Aszinkron board-kártya. Zöld, ha a cél engedélyezett. |
| **`propose_team`** | Kártya hiányzó szerepre / epic munkára / kifejezett kérésre. Sárga. |
| **Otthoni szál** | Kollégánként egy folytonos beszélgetés. |
| **Implicit munkasession** | Az első specialista-indításkor jön létre, hogy a csapatmemória kártya nélkül is működjön. |

## Szintek

| Szint | Beszélsz vele? | Tipikus feladat |
|-------|----------------|-----------------|
| **Elsődleges** | Igen | A setupkor létrehozott munkatársak (Asszisztens, Mérnök) |
| **Csapat** | Igen | Állandó kollégák (ellenőrző, kritikus, …) |
| **Specialista** | Nem (csak al-feladatként / taskként) | Egyetlen szakterület végrehajtása |

## Egyféle specialista-futtatás, minden providernél

A specialisták mindig az EYAS-on keresztül futnak. Amikor egy kolléga szétosztja a munkát — **Automatikus** és **Mély** orkesztrációban egyaránt —, `run_specialist`-tel indít specialistákat, bármelyik provideren fut is: Claude Code, Grok CLI, Kimi CLI vagy API-provider. A Claude Code nem indít saját, rejtett subagenteket: a beépített Task/Agent eszközét nem kapja meg.

Minden specialista a saját EYAS agent-beállításával fut — persona prompt, EYAS memória, beállított eszközök —, és megnyitható al-beszélgetésként jelenik meg, saját felügyelt futással és átirattal. A **Mély** mód Claude Code-on tovább tarthat, mert minden specialista önálló, teljes EYAS-futás.

**A Mély mód minden modellnek ugyanazt az utasítást adja:** a nem triviális munkát bontsd fel, és minden független szelethez futtass egy specialistát, párhuzamosan, mindegyiket pontos, önálló eligazítással; add át `handoff_to_colleague`-gal, ha egy másik kolléga gazdája a feladatnak; csapatot csak akkor javasolj, ha egy szükséges specialista még nem létezik; a fontos eredményeket ellenőrizd, mielőtt lezárod; a végső szintézist pedig tartsd meg magadnak.

**Biztonság.** A biztonsági kapu nem engedélyezi előre a Claude Code subagent-eszközének nevét. A Claude Code ezt az eszközt soha nem kapja meg, és egy ilyen hívást a kapu besorolatlanként kezelne, és engedélyezés helyett jóváhagyásra eszkalálna.

<h2 id="which-model-and-effort-a-specialist-or-member-uses">Milyen modellt és erőfeszítést használ egy specialista vagy csapattag</h2>

**Modell.** Az agent modellje egy provider + modell pár (lásd [Létrehozás és beállítás — Modell és erőfeszítés](/docs/hu/agents/configure/#model--effort)). Ha üres, az agent a beszélgetés saját modelljén fut:

- A `run_specialist` / `delegate_to_agent` által indított **specialista**, az `assign_task`-kal kiosztott kártya és a `create_sub_conversation`-nel létrehozott al-beszélgetés azon a modellen fut, **amelyen a delegáló kör ténylegesen futott**. Ez a pár az új al-beszélgetésen tárolódik; nem a szülőbeszélgetés mentett beállításaiból másolódik. Claude Code-on, Grokon és Kimin a delegáló kör modellje a hídon át hívott EYAS-eszközökhöz is eljut.
- A **csapattag** a saját modelljén fut, különben a vezető aktuális modelljén (azon a modellen, amelyen a szülőbeszélgetés épp fut; automatikus útválasztású beszélgetésnél a Normál szintjén), különben a telepítés alapértelmezésén.
- Ha ezek egyike sincs, a telepítés alapértelmezése érvényes (Normál szint → alapértelmezett provider → az első aktív provider engedélyezett modellel, a CLI-providereket is beleértve), és az első futáskor rögzül azon a beszélgetésen.
- Ha az agent saját modellje nem használható (a providere ki van kapcsolva, vagy a modell le van tiltva), a futás a beszélgetés tárolt modelljét (a delegáló körét) használja, különben az alapértelmezést, és a válasz rögzíti az `agent-binding-unavailable` megjegyzést. Az EYAS soha nem választ név alapján egy másik providert. Ha egyáltalán nincs beállított modell, a futás *Nincs beállított modell…* hibával elbukik, és nem próbálkozik újra.

Nincs csak Anthropicos csapat-modellrouter: a modell nélküli csapattag nem fut az Anthropic API-n csak azért, mert be van állítva egy Anthropic-kulcs, és a csapatkonfigurációkban nincs `modelRouting`.

**Erőfeszítés.** A saját erőfeszítéssel rendelkező tag vagy specialista megtartja azt. Amelyiknek nincs, az a munkát delegáló beszélgetés szintjét örökli, így egy **Mély** beszélgetés a specialistáit *Maximális* szintre küldi — ami többe kerül. Minden szintet ezután az EYAS a válaszoló modellhez igazít, és minden válasz rögzíti, mit kértek és mi futott. Lásd [Providerek — Gondolkodási erőfeszítés](/docs/hu/ai/providers/#reasoning-effort).

## Memória és eszközök csapatfutásban

- A specialisták, a delegált agentek és a csapattagok ugyanazt a felidézett memóriablokkot kapják a feladatukhoz vagy eligazításukhoz csatolva, mint egy chatkör (lásd [Memória — Hogyan jut el a felidézés a modellhez](/docs/hu/knowledge/memory/#how-recall-reaches-the-model)).
- Az EYAS minden csapattag eligazítását is megjegyzi, mégpedig agent által írt szövegként, nem a tiédként.
- A tartós memória rögzítése (capture) minden specialistán, delegált agenten és csapattagon is lefut, ugyanazokkal a `memory.capture.*` beállításokkal, mint egy chatkörön. A feladatot vagy az eligazítást az EYAS olyan utasításként olvassa, amelyet egy agent is írhatott: csak azok a tények maradnak meg, amelyeket rólad, a projektről vagy a világról állít, a feladat saját lépései soha. Mindegyik a saját al-beszélgetésében fut, így saját `maxPerConversation` plafonja van, és minden futás, amelynek utasítása legalább `minUserChars` hosszú, elkölthet egy további háttérmodell-hívást. Lásd [Memória — A capture alapból be van kapcsolva](/docs/hu/knowledge/memory/#capture-is-on-by-default).
- Minden tag az agentje **Eszközök** listáját kapja, kiegészítve a memóriaeszközökkel ([Létrehozás és beállítás — Eszközök](/docs/hu/agents/configure/#tools--constraints)), minden providernél.
- Csapatfutásban minden tag mutatja az éppen futó eszközét, bármelyik provideren fut.

## Csapatjavaslat és újratervezés

A csapatjavaslatot az EYAS háttérmodellje írja, egyetlen izolált, eszköz nélküli hívásban, a tervező szinteken: **Gyors**, majd **Normál**, majd a telepítés alapértelmezése vagy egy másik, izolált hívásra képes provider. Jogosult háttérmodell nélkül — például olyan telepítésen, amelynek egyetlen modellje egy Grok CLI vagy Kimi CLI, amelyről az EYAS még nem ellenőrizte, hogy tud izolált hívást futtatni, vagy ha a modell-költségkeret kimerült — a kártya egyetlen agentet javasol (az első engedélyezett agentet). A fázisok közötti újratervező ugyanígy működik: jogosult háttérmodell nélkül a csapat megtartja a jelenlegi tervét. Lásd [Routing és költségkeret — A háttérmodell](/docs/hu/ai/routing-budget/#background-model).

## Worktree és verify

| Viselkedés | Mikor |
|------------|-------|
| **Git worktree** | Két vagy több író specialista implicit sessionben, illetve **complex** / **epic** célú csapatjavaslat — a `.eyas-worktrees/` alatt |
| **Verify parancsok** | Opcionális `agent.verifyCommands` a YAML-ben — lásd [Konfiguráció](/docs/hu/deploy/configuration/) |

## Beszélgetésben

Lásd [Beszélgetések](/docs/hu/daily/conversations/):

- Al-beszélgetés fa
- Team Dashboard (megállapítások, döntések, akadályok)
- Csapatjavaslat-kártya: **Elfogadom** / **Kihagyom**, és hiányzó specialistákhoz **Létrehozom most**
- **&lt;név&gt; megnyitása** az eszközsoron, amikor egy kolléga átveszi a munkát

## Beállítás

A setup varázsló két elsődleges kollégát hoz létre. Az opcionális **Csapat-agentek** lépés további kollégákat és specialistákat ad. Specialisták sablonból vagy az **Agent létrehozása** gombbal is jönnek. Később az **Agentek** alatt módosíthatod őket.

## Kapcsolódó

- [Beszélgetések](/docs/hu/daily/conversations/)
- [Futtatások és Mission Control](/docs/hu/agents/runs/)
- [Agentek áttekintés](/docs/hu/agents/overview/)
