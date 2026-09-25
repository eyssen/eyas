---
title: Architektúra (mutató)
description: Hol vannak a technikai specifikációk, és melyik átfogó szabályokra épül a kézikönyv többi része.
---

A felhasználói dokumentáció itt véget ér. Fejlesztőknek:

| Útvonal | Tartalom |
|---------|----------|
| `docs/eyas-architecture.md` | A teljes moduláris architektúra |
| `docs/superpowers/specs/` | Tervezési specifikációk |
| `docs/superpowers/plans/` | Megvalósítási tervek |
| `CHANGELOG.md` | Kiadások |

Ezeket a fájlokat ne kezeld végfelhasználói kézikönyvként. Az alábbi szakaszok azokat a szabályokat foglalják össze, amelyek minden providernél érvényesek — API modellek, Claude Code CLI, Grok CLI, Kimi Code CLI, helyi futtatókörnyezetek és OpenCode —, és azokra az oldalakra mutatnak, amelyek elmagyarázzák őket.

## Memóriaszuverenitási réteg {#memory-sovereignty-layer}

Egy modellnek egyetlen memóriája van: az EYAS. A modell csak az üzenetéhez csatolt felidézési blokkon és a `memory_search` / `memory_expand` toolokon át olvassa. Memóriát soha nem ír — azt az EYAS rögzíti —, és az EYAS-on kívüli memóriát egyetlen csatornán sem érheti el:

```text
Egy modell toolhívása ezen csatornák egyikén érkezik:
  1. EYAS toolok az EYAS saját agent-ciklusában (API providerek)
  2. EYAS toolok, amelyeket a Grok CLI és a Kimi Code CLI a tool-hídon át hív
  3. A Claude Code beépített tooljai (egy ellenőrzés, mielőtt lefutnak)
     és a Claude Code engedélykérései
  4. A Grok / Kimi engedélykérései, és a fájlok, amelyeket az EYAS-on át
     olvasnak vagy írnak
                         |
                         v
        EGY útvonal-szabály. Védi:
          - más AI-eszközök memóriáját
          - az Obsidian vaultokat
          - a security.foreignMemoryPaths útvonalait
          - az EYAS saját adatmappáját (vault, adatbázis, kulcsok, CLI-bejelentkezések)
          - más beszélgetések munkaterületét
                         |
             +-----------+-----------+
             v                       v
      kemény elutasítás           engedély
   (nincs AI-bíró, nincs jóváhagyás,
    nem számít a zároláshoz,
    egy sor a Biztonsági eseményekben)

A CLI-k saját shellje alatt az operációs rendszer fájl-sandboxa
ugyanezeket a helyeket blokkolja (Claude Code és Grok CLI; a Kimi Code
CLI-nek nincs ilyenje).

Memória be:  az <eyas-memory> blokk + memory_search / memory_expand
Memória ki:  csak az EYAS írja
```

A headless OpenCode-feladatok ugyanezen az ellenőrzésen mennek át, és az OpenCode modellje is csak ugyanezen a két toolon át olvas memóriát.

- Hol érvényes a szabály, és mit kap vissza a modell: [Biztonság és adatvédelem — Memória az EYAS-on kívül](/docs/hu/admin/security-privacy/#memory-outside-eyas).
- Hogyan bizonyítja a valódi CLI-ken minden kiadás előtt: [Biztonság és adatvédelem — Hogyan bizonyított az izoláció](/docs/hu/admin/security-privacy/#how-isolation-is-proven).
- Mit kap helyette a modell: [Memória — Hogyan működik a felidézés](/docs/hu/knowledge/memory/#how-recall-works) és [Az EYAS-on kívüli memóriát az EYAS elutasítja](/docs/hu/knowledge/memory/#memory-outside-eyas-is-refused).

## Memóriaátadás {#memory-delivery}

A felidézett memória minden modellhez ugyanúgy jut el, minden belépési úton.

- **Egy előállító.** A felidézést kizárólag a prompt-összeállító állítja elő, egyetlen felidézési szolgáltatáson át. A chat, a háttér- és ütemezett futások, a board bot futásai, a God Mode workerek, a specialisták és delegált agentek, a csapattagok, a csatornaválaszok, a kollégák közötti átadások és az OpenCode-feladatok mind ezen mennek át. A felidézési lekérdezést maga a szolgáltatás állítja össze a beszélgetésből, így minden út ugyanúgy keres.
- **Egy elhelyezés.** Az agent runner a kérés elküldésekor csatolja a körblokkot — az aktuális dátumot és időt, majd a felidézési blokkot — az aktuális felhasználói üzenethez. A tárolt üzenet soha nem változik, és egy folytatott futás a régi helyett friss blokkot kap. A körről körre változó tartalom nem kerül a rendszerpromptba, így az változatlan marad és gyorsítótárazható (az Anthropic API-n automatikusan).
- **A modellhez méretezve.** A kör átadási profilja egyetlen ablakfeloldóból jön: a modell katalógusbeli ablaka, különben a CLI provider ismert ablaka, különben 200k token. A keretek egy 100k tokenes ablakra vannak beállítva — ott a felidézési blokk része a `memory.index.budgetChars`, alapból 2400 karakter —, és az ablakkal együtt skálázódnak: 250k tokentől legfeljebb 2,5-szörösre, 100k alatt pedig a prompt-keret soha nem foglalja el az ablak 35%-ánál többet. A mesteridentitás és a szabályok soha nem vágódnak le.
- **A hosthoz igazított nevek.** A toolnevek kanonikusak, és minden tipp úgy nevezi meg őket, ahogy a modell hostja listázza: API providereknél `memory_search`, Claude Code-ban `mcp__eyas__memory_search`, Grok CLI-ben `use_tool` az `eyas__memory_search` névvel, Kimi Code CLI-ben `memory_search` az `eyas` MCP szerveren. A toolt hívni nem tudó modell nem kap sem toolokat, sem drill-down tippet, helyette kettő helyett legfeljebb négy jegyzetet kap teljes szöveggel.
- **Drill-down.** A `memory_search` és a `memory_expand` együtt körönként 3 hívást enged, minden providernél. A projekt-hatókörüket az EYAS a szerveren oldja fel a beszélgetésből, soha nem egy tool-argumentumból.
- **Közönség.** A tulajdonos memóriáját az EYAS nem tolja ki külső olvasóknak. Az A2A partnerektől jövő feladatok és a külső hangon szóló — vagy meghatározhatatlan hangú — csatornaválaszok csak a dátumot és az időt kapják, a kör pedig rögzíti, hogy a felidézés elmaradt. Maguk a memóriatoolok a biztonsági kapu alatt maradnak.
- **Látható.** Minden kör rögzíti, mit kapott: a kontextus-összeállítás **Átadott memória** dobozában és a trace `memoryTiersUsed` mezőjében. A **Megfigyelhetőség → Kontextus** **Memóriaátadás szolgáltatónként** kártyája a providereket veti össze. Lásd [Beszélgetések — Kontextus-összeállítás](/docs/hu/daily/conversations/#context-composition) és [Observability és ops](/docs/hu/admin/observability/#memory-delivery-by-provider).

## Egy kötés, egy tool-hatókör, egyféle specialista-futtatás {#binding-tools-specialists}

- **Körönként egy modellkötés.** Minden kör azon a modellen fut, amelyhez a beszélgetése kötve van — rögzített modell, a kolléga alapértelmezése vagy Auto-routing. A kötés már a prompt összeállítása előtt ismert, így a prompt mérete és toolnevei ahhoz a modellhez igazodnak. Az általad választott modellt az EYAS soha nem cseréli le csendben; az EYAS által magától rögzített modell megjegyzéssel esik vissza. Lásd [Beszélgetések — Melyik modell válaszol](/docs/hu/daily/conversations/#which-model-answers).
- **Egyféle specialista-futtatás.** A specialisták mindig az EYAS-on át futnak a `run_specialist` toollal, minden providernél, al-beszélgetésként, saját felügyelt futással. A Claude Code saját subagent-toolját az EYAS nem kínálja fel. Lásd [Csapatok és delegálás](/docs/hu/agents/teams/).
- **Egy tool-hatókör.** Egy agent a saját toollistáját kapja, plusz a `memory_search` és a `memory_expand` toolt (az üres lista minden toolt jelent), Solo módban pedig a delegáló toolok kimaradnak. Ugyanez a hatókör érvényes minden futási úton és minden providernél, a CLI által a hídon át elért EYAS toolokra is; a hatókörön kívüli hívást az EYAS elutasítja. Lásd [Létrehozás és beállítás — Eszközök és megkötések](/docs/hu/agents/configure/#tools--constraints).

## Effort és bizonyított CLI-verziók {#effort-and-cli-versions}

- **Effort.** A szintet az EYAS modellenként, abban a pillanatban dönti el, amikor egy modell válaszol — útválasztás, újrapróbálás vagy visszaesés után újra —, és ahhoz igazítja, amit a modell támogat. Minden provider csak lefordítja a saját paraméterére, és az a modell, amelyről az EYAS-nak nincsenek ellenőrzött adatai, nem kap semmit. A Claude Code CLI, a Grok CLI és a Kimi Code CLI visszajelzi, milyen szinten futott ténylegesen. Lásd [Providerek — Hogyan alkalmazza az effort-szintet az egyes provider](/docs/hu/ai/providers/#effort-by-provider).
- **Bizonyított CLI-verziók.** A CLI-izolációt az EYAS minden session indulásakor ellenőrzi, és minden CLI-verziót kiadás előtt a kiadási ellenőrzés (`bun run test:live-cli`) bizonyít. Az `eyas doctor` a telepített binárist a legutóbb bizonyított verzióval veti össze. Lásd [Providerek — Bizonyított CLI-verziók](/docs/hu/ai/providers/#proven-cli-versions).

## Megfigyelhetőség minden providernél {#observability-on-every-provider}

- **Toolhívások, egyszer számolva.** Egy trace megszámolja a hívásokat, amelyeket a modell az EYAS-nak adott át futtatásra, és azokat, amelyeket egy CLI a saját ciklusában intézett el — a beépített tooljait és a hídon át hívott EYAS toolokat —, mindegyiket egyszer, minden providernél ugyanúgy.
- **A CLI által futtatott toolokat az EYAS naplózza, nem futtatja újra.** A CLI által maga futtatott tool kanonikus néven, a futásával együtt sort kap a toolfuttatási naplóban. Az EYAS nem futtatja és nem engedélyezi másodszor, és a naplóból semmi nem jut a memóriába: hogy a toolok kimenete bekerül-e a memóriába, azt egyedül a `memory.l0.captureToolResults` dönti el. Lásd [Eszközök — Toolfuttatási napló](/docs/hu/automation/tools/#tool-execution-log).
- **Memória körönként.** A trace-ek `memoryTiersUsed` mezője memória-azonosító előtagonként számolja a felidézett tételeket, a `GET /api/v1/observability/memory-parity` pedig a válaszoló providerenként összesíti a felidézést és a drill-downokat. Lásd [Observability és ops](/docs/hu/admin/observability/#usage-tab).
- **Az EYAS saját modellhívásai.** A háttérmunka — címek, memória-rögzítés, biztonsági bíró, … — a háttérmodellen fut, és ugyanúgy nyomon követhető és beszámít a keretbe, mint egy beszélgetési kör. Lásd [Routing és költségkeret — A háttérmodell](/docs/hu/ai/routing-budget/#background-model).

## Közreműködőknek {#for-contributors}

- **Modellhívások.** A backend kód csak egy rövid, átnézett listáról hívja közvetlenül a modell-gatewayt: az agent runner, a chat stream route, a modell API route-jai, a tracing, maga a gateway, valamint néhány izolált interaktív egyszeri hívás (Először terv, a God Mode bírálója, Design). A háttérmunka a háttérmodell-szolgáltatáson át megy. A `tests/modules/model/no-direct-model-calls.test.ts` minden más közvetlen hívásnál elbukik.
- **Ez a kézikönyv.** Az angol a forrás, és az öt fordítás ugyanazokat a címsorokat tartja ugyanabban a sorrendben. A lefordított címsor egy `## Címsor {#angol-id}` utótaggal megtartja az angol horgonyt, így a `/docs/<lang>/<page>/#<id>` linkek és az alkalmazáson belüli súgó-hashek minden nyelven működnek, a címsor pedig az oldal tartalomjegyzékében marad. A `--`-t tartalmazó azonosító nem éli túl a tipográfiai átalakítást, amely előbb fut; az ilyen címsor nyers `<h3 id="…">`-t használ. Egyetlen teszt, a `tests/contracts/handbook-locale-parity.test.ts` bukik el, ha egy listázott oldal nyelvek között eltér (címsorok, horgonyok, a címsor formája, táblázatsorok), vagy ha bármely kézikönyv-link olyan horgonyra mutat, amely nincs az oldalán. Az oldalak felépítése és hangneme: `packages/docs/PAGE_TEMPLATE.md`.
