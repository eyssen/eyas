---
title: Létrehozás és beállítás
description: Agent neve, modellje, eszközei, büdzséje és csatornakötései.
---

**Mire való.** A **Beállítások** fül az agent tárolt identitása: név, szerep, modell, erőfeszítés, eszközök, megkötések és havi token-keret. A munkaterület-fájlok és a hangprofil külön fülek. Ezt töltöd ki, amikor valakit létrehozol, és ezt módosítod, ha a feladata megváltozik.

## Mikor használd

- Agentet hozol létre, és név, típus, modell és eszközlista kell.
- Egy API-modellen futó kódoló agentnek `read_file` / `edit_file` / `grep` kell, CLI nélkül.
- Havi tokenplafon kell, vagy törölni akarod (`0` = korlátlan).
- A bejövő Telegram (vagy más csatorna) ehhez az agenthez fusson be.
- A prompt coach-csal akarod feszesebbre írni a rendszerpromptot — nem a hangot, nem a projekt szakterületét.

## Tipikus munkafolyamat

1. Nyisd meg az **Agentek** oldalt → kattints az agentre (vagy **Agent létrehozása**) — útvonal `/agents/:id`, **Beállítások** fül. Az **Agent létrehozása** varázsló beszélgetése nem nevez meg modellt: a telepítés alapértelmezésén fut, amely az első üzenetével rögzül.
2. Töltsd ki: **Név**, **Szerep**, **Szint**, **Agent-típus**, **Modell** (provider + modell, vagy **A beszélgetés saját modellje**), **Erőfeszítés**, **Eszközök (vesszővel elválasztva)**, **Megkötések (soronként egy)**.
3. Állíts be **Havi token-keret**et, ha plafon kell. A **Csatornák** fülön köss csatornát, ha a bejövő üzenetek ide érkezzenek.
4. **Módosítások mentése**. Az ezzel az agenttel indított új beszélgetés ezt a modellt, eszközlistát és promptot használja.

## Funkciók

Az oldal fejléce mutatja a **Token-keret** összesítőt, és futás közben a **Végrehajtás…** jelzést. Fülek: **Beállítások**, **Emlékek**, **Hang**, **Munkaterület**, **Csatornák**.

## Besorolás

| Mező | Jelentés |
|------|----------|
| **Szint** | **Elsődleges** / **Csapat** = kollégák, akikkel beszélsz; **Specialista** = közös indítási pool (lásd [áttekintés](/docs/hu/agents/overview/)) |
| **Agent-típus** | **Asszisztens**, **Mérnök**, **Fejlesztő**, **Ellenőrző**, **Kritikus**, **Kutató**, **Tervező**, **Koordinátor**, **Megfigyelő** |

## Karakter

| Mező | Jelentés |
|------|----------|
| **Név** | Megjelenített név |
| **Szerep** | Rövid szerepleírás |
| **Leírás** | Hosszabb leírás |
| **Cél** | Mi vezérli a döntéseket (*Mi vezérli az agent döntéseit*) |
| **Háttértörténet** | A megközelítést formáló kontextus (*Kontextus, ami alakítja az agent megközelítését és nézőpontját*) |
| **Avatár** | A felületen megjelenő emoji |
| **Rendszerprompt** | Agent-szintű utasítások (a rétegzett promptokkal együtt) |
| **Prompt coach** | AI coach a rendszerprompthoz (csak az operációs protokoll — nem a hang, nem a projekt szakterülete) — [Promptok](/docs/hu/ai/prompts/#prompt-coach) |

<h2 id="model--effort">Modell és erőfeszítés</h2>

| Mező | Jelentés |
|------|----------|
| **Modell** | Provider plusz modell, providerenként csoportosított listából — vagy **A beszélgetés saját modellje** (üres): a kolléga ekkor a beszélgetés modelljén fut — a delegáló kör modelljén, vagy a telepítés első használatkor rögzített alapértelmezésén (lásd [Csapatok és delegálás](/docs/hu/agents/teams/#which-model-and-effort-a-specialist-or-member-uses)) |
| Visszaállító gomb | *A beszélgetés saját modelljének használata* — törli a modellt; a mentés tényleg törli |
| Piros megjegyzés | *A(z) &lt;provider&gt; / &lt;modell&gt; nem egy aktív szolgáltató bekapcsolt modellje. Amíg vissza nem tér, ez a kolléga a beszélgetés saját modelljével fut.* |
| **Erőfeszítés** | Ugyanaz az Erőfeszítés választó, mint a beszélgetésekben: csak azok a szintek, amelyeket az agent modellje kínál (a **Nincs**, **Minimális**, **Alacsony**, **Közepes**, **Magas**, **Nagyon magas**, **Maximális** közül; be/ki modellnél **Be** / **Ki**), elöl az **Automatikus**, a modell alapértékével (*Automatikus · a modell alapértéke (Közepes)*). Ha olyan modellt választasz, amely nem kínálja a mentett szintet, a szint mentés előtt módosul, és a felület ezt jelzi (*Az erőfeszítés Nagyon magas helyett Magas lett: a kiválasztott modell nem kínálja ezt: Nagyon magas.*); erőfeszítés-vezérlés nélküli modellnél Automatikusra vált. A modell által nem támogatott szintet az EYAS nem menti el, és üzenetben felsorolja a támogatott szinteket — a többi módosításod az űrlapon marad. Rögzített modell nélkül a választó minden olyan szintet kínál, amelyet egy automatikus útválasztási szint modellje elfogad. A kolléga erőfeszítése mindenhol érvényes, ahol fut — a chatjében, az otthoni szálában, a csatornaválaszokban, és örökölt szintként az általa delegált specialistáknál. Lásd [Providerek — Gondolkodási erőfeszítés](/docs/hu/ai/providers/#reasoning-effort). |
| Erőfeszítés-tipp | *A kolléga gondolkodási erőfeszítése — csak a modellje által kínált szintek látszanak, és modellváltáskor az új modell által nem kínált szint igazodik. Automatikus = a modell saját alapértéke.* |
| **Max. körök** | A modell-körök kemény felső határa futásonként — a kolléga chatköreire, valamint a háttér-, specialista-, csapat- és csatornafutásaira. Claude Code-on, Grokon és Kimin ez a CLI saját körkorlátja is. Tárolt érték nélküli agentnél a mező 10-et mutat, és a mentés a látott számot tárolja. Tárolt érték nélkül egy chatkör 25, egy háttér-, csapat- vagy csatornafutás 20, egy specialistafutás 10 kört enged. |

A többi mező (név, prompt…) mentése nem küldi újra a modellt, így egy szerkesztés soha nem bukik el azért, mert közben kikapcsolták a modellt.

**Frissítés.** A frissítés utáni első induláskor minden meglévő agent, amelynek modellazonosítója a modellkatalógusban pontosan egy provider alatt szerepel, automatikusan megkapja azt a providert. A több provider alatt listázott modellazonosítók, az ismeretlen azonosítók és az olyan szintnevek, mint a `sonnet`, provider nélkül maradnak; ezeket az EYAS futáskor rendeli a gazdájukhoz, és ha ez nem lehetséges, a beszélgetés saját modellje fut.

<h2 id="tools--constraints">Eszközök és megkötések</h2>

| Mező | Jelentés |
|------|----------|
| **Eszközök (vesszővel elválasztva)** | Az agent által hívható eszközök nevei. Helyőrző: *Üres = minden eszköz · pl. read_file, grep, research*. Tipp: *Üres = minden eszköz. A beszélgetésekben és minden szolgáltatónál érvényes – a CLI-modellek saját írási, parancsfuttatási és webes eszközeire is. A memóriakeresés mindig elérhető; CLI-modellnél a beszélgetés mappáiban a fájlok olvasása is.* |
| **Képességek (vesszővel elválasztva)** | Képességcímkék (pl. `research, coding`) |
| **Megkötések (soronként egy)** | Kemény szabályok (pl. nincs destruktív művelet) |

### Mit jelent az Eszközök lista

A lista minden úton ugyanúgy érvényes, ahol egy agent fut: interaktív chat, egy beszélgetés ütemezett és board-futásai, a `run_specialist` / `delegate_to_agent` által indított specialisták, csapattagok és csatornaválaszok (Telegram, Slack, e-mail és a többi csatorna) — és minden providernél: az API-modelleknél és a Claude Code, Grok és Kimi CLI-modelleknél.

- **Az üres lista minden eszközt jelent.**
- Különben az agent **pontosan a listázott eszközöket kapja, plusz a `memory_search`-öt és a `memory_expand`-ot**. Ezt a két EYAS memóriaeszközt minden agent mindig megkapja, akkor is, ha a listájából hiányoznak.
- **Szóló** beszélgetésben a `run_specialist`, a `delegate_to_agent`, a `handoff_to_colleague` és a `propose_team` is kikerül; a `memory_search`, a `memory_expand` és az `assign_task` (board-munka) marad.
- Az agent rendszerpromptjában az eszközleltár csak azokat az eszközöket nevezi meg, amelyeket a futás ténylegesen megkap.
- **A modell csak felajánlott eszközt használhat.** Ha egy modell a listán kívüli vagy nem létező eszközt nevez meg, az EYAS a hívást *'&lt;tool&gt;' is not in this agent's toolset* üzenettel elutasítja, és nem futtatja. Jóváhagyási kérdés nincs; minden providernél azonnal elutasítás.
- **Az ismeretlen nevek kiesnek.** Az a név, amely nem telepített eszköz (elírás, kikapcsolt modul, nem csatlakozott MCP-szerver), nem kerül felajánlásra, és a szervernapló agentenként és eszköznevenként egy figyelmeztetést mutat.
- **A CLI-modelleknél (Claude Code, Grok, Kimi) a lista a CLI saját beépített eszközeit is korlátozza**, minden CLI-nél ugyanúgy:
  - **Fájlok írása** (a Claude Code Write, Edit, NotebookEdit eszköze; a Grok és a Kimi szerkesztő és áthelyező eszközei, valamint azok a fájlírások, amelyeket az EYAS szolgál ki a CLI-nek): csak ha a lista tartalmazza a `write_file` vagy az `edit_file` eszközt.
  - **Shell-parancsok** (a Claude Code Bash eszköze; a Grok és a Kimi végrehajtó eszközei; a törlés is shell-parancsnak számít, ahogy a biztonsági kapu besorolja): csak ha a lista tartalmazza a `run_command` eszközt. A `git_status` és a `git_diff` nem ad shellt; `run_command` nélküli listán ehelyett EYAS-eszközként, a hídon át kapja meg őket a CLI.
  - **Webes lekérés és webes keresés** (a Claude Code WebFetch, WebSearch eszköze; a Grok és a Kimi lekérő eszközei, a Grok web_fetch és web_search eszköze): csak ha a lista tartalmaz egy webes eszközt — `research`, `browser_navigate`, `agent_browser_run` vagy `browser_use_exec`.
  - **Fájlok olvasása** (a Claude Code Read, Glob, Grep eszköze; a Grok és a Kimi olvasó, kereső és listázó eszközei) mindig engedélyezett, bármit mond a lista. A beszélgetés mappáin belül marad, a memória-policy és a kernel fájl-sandbox alatt. A memóriakeresés is elérhető marad.
  - Az üres lista továbbra is minden eszközt jelent, a CLI saját eszközeit is.

  A Claude Code-on a visszatartott eszközöket a modell egyáltalán nem kapja meg. A Grokon és a Kimin azt a visszatartott eszközt, amelyet a CLI használni próbál, az EYAS még a biztonsági kapu megkérdezése előtt elutasítja: nincs jóváhagyási kérdés, és az eszközsor **Elutasítva** állapotot mutat. A Kimi engedélykérései nem mondják meg, milyen fajta eszköz kérdez (a Kimi 1.52.0 forráskódja alapján; hoston még nem ellenőrizve), ezért az az agent, amelynek listájából a fájlíró eszközök vagy a `run_command` bármelyike hiányzik, a Kimi egyetlen kérdező eszközét sem használhatja (fájlírás vagy -csere, shell, háttérfeladatok). A Kimi webes keresése és lekérése soha nem kérdezi az EYAS-t, ezért agentenként nem engedélyezhető; az EYAS izolációs ellenőrzése így is leállítja az ezeket használó kört. Lásd [Providerek — Claude Code izoláció](/docs/hu/ai/providers/#claude-code-isolation).
- Az EYAS-hídon — a Claude Code folyamaton belüli szerverén és a Grok/Kimi MCP-hídon egyaránt — a lista azokat az EYAS-eszközöket szabályozza, amelyeket a CLI elér. Azok az EYAS-eszközök, amelyeknek a CLI-ben van engedélyezett saját megfelelője (`read_file`, `grep`, `glob` mindig; `write_file`, `edit_file`, amíg írhat; `run_command`, `git_status`, `git_diff`, amíg használhatja a shelljét), nem mennek át a hídon: a CLI a saját eszközeit használja a biztonsági kapu, a memória-policy és a kernel fájl-sandbox alatt. Az EYAS böngésző-, agent-browser-, browser-use- és OpenCode-eszközei a CLI-modellekhez is eljutnak. Lásd [MCP — CLI eszközparitás](/docs/hu/ai/mcp/#cli-mcp-tool-parity-grok--kimi).

**Viselkedésváltozás a meglévő agenteknél:** a szűk listát az EYAS mindenhol betartja. Például a **Személyi asszisztens** nem kap `run_command` / `write_file` eszközt chatben, háttér-, specialista- vagy csapatfutásban, ahogy a sablonja is mondja — és a Claude Code-on, a Grokon és a Kimin a CLI saját Write, Edit vagy Bash eszközével sem írhat már fájlt és nem futtathat parancsot. Ha eszközt akarsz adni, vedd fel a listára (íráshoz `write_file` / `edit_file`, a shellhez `run_command`), vagy ürítsd ki a listát, hogy minden eszköz engedélyezett legyen. Azok az agentek, amelyeknek a listája nem létező eszközöket nevez meg, elveszítik ezeket a neveket (figyelmeztetéssel a naplóban), és az a modell, amely a felajánlott listáján kívüli eszközt hív, elutasítást kap.

### Kódoló agentek (modellfüggetlen felület)

Implementáló, javító vagy review-munkához API-modellen add meg az első osztályú fájleszközöket, hogy a modell shell nélkül is szerkeszthessen:

```
read_file, write_file, edit_file, grep, glob, git_status, git_diff, run_command, search_indexed, list_search_sources
```

| Eszköz | Használat |
|--------|-----------|
| `read_file` / `edit_file` / `write_file` | Olvasás és célzott szerkesztés a munkakönyvtárakban vagy a worktree-ben |
| `grep` / `glob` | Szimbólumok és fájlok keresése |
| `git_status` / `git_diff` | Review-segédek (csak olvasás) |
| `run_command` | Tesztek/lint (piros szint — jóváhagyás / autonómia) |

A CLI-modellek (Claude Code, Grok, Kimi) ehelyett a saját fájl- és shell-eszközeiket használják, és a listán ezek a nevek engedélyezik őket: a `write_file` / `edit_file` a CLI saját fájlírásait, a `run_command` a shelljét nyitja meg. `run_command` nélkül a `git_status` és a `git_diff` EYAS-eszközként, a hídon át jut el a CLI-hez.

A **Személyi asszisztens** (elsődleges, asszisztens típusú) koordinál — ne kapjon `write_file` / `edit_file` / `run_command` eszközt. A **Rendszermérnök** és a kódoló specialisták viselik ezeket. Lásd [Csapatok és delegálás](/docs/hu/agents/teams/).

A 0.8.6 előtt létrehozott **meglévő agentek** **nem** kapják meg automatikusan az új eszközöket — itt vedd fel őket (vagy töltsd újra egy frissített sablonból). Teljes katalógus: [Eszközök](/docs/hu/automation/tools/).

<h2 id="imported-personas">Importált personák</h2>

Agentek a `local.yaml` `agent.importRoots` alatt felsorolt mappák persona-fájljaiból is jöhetnek (lásd [Konfiguráció — Extra skill- és persona-gyökerek](/docs/hu/deploy/configuration/#extra-skill-and-persona-roots)). Az EYAS-ban szerkesztett agentet a fájlja **soha nem írja felül**:

- Az első induláskor a fájl létrehozza az agentjét.
- A fájl későbbi változásai csak addig frissítik az agentet, amíg a **neve, szerepe, leírása, rendszerpromptja és eszközei** pontosan olyanok, amilyennek az utolsó import hagyta. Ha ezek közül bármelyiket itt szerkeszted, a fájl többé nem módosítja az agentet.
- Ha csak a modelljét, erőfeszítését, be/ki kapcsolóját, avatárját, címkéit vagy keretét módosítod, a frissítések nem állnak le, mert ezeket az import soha nem írja.
- Az általad törölt importált agentet az EYAS nem hozza létre újra. Ha vissza akarod kapni, importáld a fájlt az [adatimporttal](/docs/hu/admin/data-port/).
- Az azonos azonosítójú meglévő agentet, amelyet nem az import hozott létre — beépített sablon, a felületen készült, vagy adatimportból jött —, az EYAS soha nem írja felül. Ha már pontosan egyezik a fájllal, átveszi, és követi a fájl későbbi változásait.
- Ha két importmappában is van azonos azonosítójú persona, az elsőként felsorolt mappa nyer; ha azt a fájlt eltávolítod, a következő mappa fájlja veszi át.

**Frissítés.** A korábbi verziók által importált, azóta nem szerkesztett agenteket az EYAS automatikusan átveszi. Az általad szerkesztettek pontosan úgy maradnak, ahogy vannak.

## API (integrátoroknak)

- A `PATCH /api/v1/agents/:id` a törzsét a létrehozáshoz hasonlóan validálja: az ismeretlen mezőket, például a `source`-t vagy az `id`-t figyelmen kívül hagyja, érvénytelen értékre részletekkel együtt `400`-at ad (a nem támogatott erőfeszítés `EFFORT_UNSUPPORTED` kódot kap a modell támogatott `levels` listájával), ismeretlen agentre pedig `404`-et.
- A `POST` / `PATCH /api/v1/agents` a `model` mellett `provider`-t is elfogad. A párnak egy aktív provider engedélyezett modelljének kell lennie; különben a válasz `400`, `code: model_binding_unavailable`, `providerId` és `modelId` mezőkkel, és semmi nem mentődik. `model` nélküli `provider` → `400`.
- A `model` önmagában (a régebbi alak) továbbra is elfogadott; a providerét az EYAS kitölti, ha pontosan egy provider listázza a modellazonosítót.
- A `provider: null, model: null` (vagy üres modell) mindkettőt törli. A `GET` válaszok tartalmazzák a `provider` mezőt.

## Keret

| Mező | Jelentés |
|------|----------|
| **Havi token-keret** | Havi plafon; **`0` = korlátlan** |
| Tokenfelhasználás | Felhasznált / keret a listán és a fejlécben |

## Műveletek

| Vezérlő | Jelentés |
|---------|----------|
| **Módosítások mentése** | A beállítások mentése |

## Emlékek fül (csak olvasható lista)

| Elem | Jelentés |
|------|----------|
| **Epizodikus / Munka** | Memóriaszint-szűrő |
| *N emlék* | Darabszám |
| *fontosság: N* | Fontossági pontszám |
| *N× használva* | Hozzáférések száma |
| *M karakterből az első N — a teljes emlék tárolva van* | Hosszú emléket csak a lista rövidít |
| Üres tipp | *Az emlékek itt jelennek meg, ahogy az agent dolgozik és tanul.* |

## Csatornák fül (összefoglaló)

Köss csatorna-példányokat, hogy a bejövő üzenetek ehhez az agenthez érkezzenek. Teljes mezőlista: [Csatornák áttekintés](/docs/hu/communication/channels/).

| Vezérlő | Jelentés |
|---------|----------|
| **Csatorna-példány kötése** | Meglévő Telegram/… példány kiválasztása |
| **Kötés ehhez az agenthez** | Hozzákötés |
| **Leválasztás** | Leválasztás |
| Állapot **Kapcsolódva / Hiba / Hitelesítés megadva / Nincs beállítva** | A példány állapota |
| Mód **Önálló** | A csatorna önálló kezelést indíthat |

## Kapcsolódó

- [Identitás és munkaterület](/docs/hu/agents/identity-workspace/)
- [Csapatok és delegálás](/docs/hu/agents/teams/)
- [Hangprofilok](/docs/hu/agents/voice/)
- [Providerek](/docs/hu/ai/providers/)
