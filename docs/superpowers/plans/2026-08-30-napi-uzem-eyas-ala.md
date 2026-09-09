# EYAS általános termék — fennmaradó pickup

> Korábbi cím: „Napi üzem átrakása az EYAS alá”. Az a keret **téves** volt: egyetlen tenant napi stackjére szabta a terméket. A tenant-specifikus üzem (ticket-ingest, indexer, GitOps/pod, élő idegen vault) a [parkolt tenant-jegyzetben](./2026-08-30-odoo-tamogatas-parkolva.md) van. **Azt a jegyzetet ne nyisd termék-sessionben.**

Pickup-dokumentum külső sessionnek. Nem implementációs spec: a cél, a korlátok és a sorszámozott munka. Kódolás előtt az adott tételhez tartozó meglévő modulokat olvasd el, ne emlékezetből.

**Dátum:** 2026-08-30
**Státusz:** terv; 19–20, 23–24, 3., 4b., 5., 6., 7., 10., 12. és 13. tétel kész. 4. tétel (élő idegen vault) **törölve**. Következő: 7.5 manuális próba.
**Repo:** `~/GitHub/eyas`, branch `main`
**Commit/branch/push:** tilos, amíg a user külön nem kéri.

---

## Mi ez / mi nem ez

Az EYAS **általános MIT termék**. Bárki letöltheti, teljesen más környezetbe, teljesen más feladatokra. Mi **egy felhasználó** vagyunk, nem a termék alanya.

A kód viselkedést ad (projekt-típus, memória-scope, connection, tool, skill-import). Ügyfél, modul, pod, path, ticket, connection-id a **példányon** él (UI / `data/` / local config).

A Connections-katalógus **általános rendszertípusokat** tart (GitHub, MCP, HTTP, …) — ez termék. Egy tenant napi workflow-ja, seed típusneve, gép-pathja, ticket-routingja **nem** termék-default.

Kérdés minden stringnél: igaz marad-e egy idegen letöltőnek, aki a mi környezetünket nem ismeri? Ha nem → példányadat vagy a parkolt jegyzet.

---

## Korlátok — ne litigáld újra

Ha tényszerűen tévesnek tűnnek, állj meg és kérdezz; ne írd felül csendben.

1. CLI-only az elsődleges. **Soha** ne feltételezz Ollamát / lokális modellt.
2. Grok 4.6 / Claude CLI a napi modell. Lokális 27B nem helyettesít.
3. Claude izoláció ON (`loadClaudeMd` default off). `settingSources: []` **nem** teljes izoláció — cwd-keyed auto-memory is ki kell kapcsolni.
4. Grok/Kimi ACP **nem izolálható**. Grok alatt az EYAS-felszínnek önállónak kell lennie.
5. Host Claude skillöket **ne** `settingSources` visszakapcsolásával hozd be. Importáld EYAS skill-loaderbe / toolba, izoláció maradjon ON. Az import-path a példány `local.yaml`-ja, soha nem `src/`.
6. Personák UI-n kezeltek, nem kódban. „Marveen” string tilos. Csak az EYAS saját agentjei — CLI `Agent` tool subagent EYAS-munkára tilos.
7. MIT-kompatibilis függőség. GPL/LGPL/AGPL/SSPL tilos.
8. Nincs auto-commit, auto-branch, auto-push.
9. EYAS cross-platform: runtime **nem** Keychain-függő. Secret az EYAS vaultban. Keychainből egyszeri import OK; service-nevek a példányon, nem a kódban.
10. Verziószámot ne változtasd, amíg a user nem kéri.
11. User-facing string mind a 6 nyelven (`en hu de es fr tlh`).
12. **Memória-szuverenitás.** Az EYAS csak a saját memóriáját olvassa és írja (`data/vault` + DB-tier). Élő külső vault tilos (Obsidian, `~/.claude`, `~/.grok`, host `MEMORY.md`). A provider saját memóriája nem forrás és nem cél — capture/completion `isolated: true`; ami nem izolálható (Grok/Kimi ACP), azt a panel őszintén mondja. Dream / auto-rewrite **ki** marad. Max: a data-port **egyszeri beolvasása** idegen markdown memóriát az EYAS vaultba (másolat, nem mount).
13. **Nincs nested subproject / `parent_id` a `projects` táblán.** A család = meglévő `ProjectType`. Ne litigáld újra, amíg a 19–24. viselkedés ki nem derül, hogy a 3 szint kevés.
14. **Általános termék, egy tenant.** `src/`, teszt, i18n, handbook, seed, komment viselkedést ír. Ügyfélnév, modulnév, termék, pod, ticket-id, connection-id, gép-path — soha a repóban. Teszt: fictive (`alpha` / `bravo`, `type-a`). GitHub `org` placeholder ne legyen tenant-név.

A tenant üzemeltetési szabályai (melyik checkout, melyik pod, melyik ticket-DB) **példány / típus-prompt** a parkolt jegyzetben, nem termék-default.

---

## Kész — viselkedés, ne litigáld

Ezek általános termék-képességek. A motiváció egy tenant volt; a kód fictive fixture-rel ment.

### 19. A projekt-prompt eljut a modellhez — kész

Az űrlap/DB a szerkesztő. A loader a nem-üres DB promptot olvassa, üres DB-nél a meglévő `AGENTS.md` a fallback. Mentéskor a nyers prompt kiíródik a fájlba; üres prompt törli. `resolvePromptSources` (`+` / üres / override) production hívó. `mergeSections` érintetlen. `general-general` nem kap projekt-memóriát; a GENERAL_BRIEF mehet a modellbe.

### 20. Típus-szintű memória — kész

`kind=domain`. Mappa `project-types/<typeId>/`. Frontmatter `projectType`; `vault_index.project_type_id`. Rangsor: user, feedback, domain, project, reference. `general-general` típus-jegyzet nélkül. Capture prompt általános (nincs ügyfél-/modulnév). Index: aktív projekt + a típusa; más projekt jegyzetei nem.

### 23. Tag: board-szűrő + egy suffix-sor — kész

Tábla marad. Kategória-nevek nincsenek seedelve. Suffix: `conversation-tags` szekció, egy sor; üres = nincs szekció. Cache-prefix és `project-context` hash érintetlen.

### 12. Projekt-wiki auto — kész

Zárt board-kártya → `ticket-<id>` a projekt wikijén. Team-session findings/döntés → `decision-<id>` (wiki), vault csak ha nincs effektív projekt. Ember mentése átveszi az oldalt. `general-general` nélkül.

### 24. `search_memory` default scope — kész

Tool `scope`: `current` | `all`; default `current`. HTTP `/memory/search` szűretlen. Szűrő a vault-jegyzetekre (`vaultNoteInScope`).

### 3. Skill-import, izoláció ON — kész (mechanizmus)

`skills.importRoots` / `agent.importRoots` — default **üres lista**, a pathok a példány `local.yaml`-jában. Nincs `~/.claude` a `src/`-ben. Importált skill a `wins()` létrán core fölött. Personák markdown, UI. `settingSources: []` és auto-memory disable érintetlen.

A *mechanizmus* (user létrehozhat típust; projektnek lehet `default_connection_id`-ja bármely katalógus-connectionre) **marad**. Tenant-specifikus seed típus és ticket-connection routing a parkolt jegyzetben van.

### 13. Telegram mint csatorna — kész

Inbound: pairing után a user beszélgetést indít / `/new`+`/start` újat nyit; folytatás ugyanazon a mappingen. Nincs ticket-ingest. Outbound: sárga/piros toolra Approve/Deny ping a paired Telegram-chatre; `decide()` a meglévő resume úton.

---

## Hol van ma a kód (tájékozódás)

| Téma | Útvonal |
|------|---------|
| Seed típus/projekt | `src/modules/board/index.ts` (`seedBoardDefaults`) |
| Projekt / típus prompt, connection oszlopok | `src/modules/board/services/project-service.ts`, `project-type-service.ts`, `schema.ts` |
| Prompt-lánc | `src/modules/board/services/prompt-service.ts`, `src/modules/prompt-wizard/section-merger.ts` |
| Amit a modell olvas | `src/modules/prompt-wizard/project-context-loader.ts`, `workspace-paths.ts` |
| Core-rules (memória-szuverenitás) | `src/modules/prompt-wizard/core-rules.ts` (rule 8) |
| Vault / capture / index | `src/modules/memory/vault/`, `capture/`, `memory-index.ts` |
| Data-port import (egyszeri beolvasás) | `src/modules/data-port/` |
| Skill loader | `src/modules/skills/skill-loader.ts` |
| File / grep / git | `src/modules/tools/builtin/file-tools.ts`, `review-tools.ts` |
| Shell | `src/modules/tools/builtin/shell-tools.ts` |
| Security gate | `src/modules/security-gate/` |
| Claude Code + MCP híd | `src/modules/model/submodules/claude-code/` |
| Grok CLI ACP | `src/modules/model/submodules/grok-cli/` |
| Search / Orama | `src/modules/search/` |
| Connections katalógus | `src/modules/connections/catalog.ts` |
| Working directories spec | `docs/superpowers/specs/2026-08-14-conversation-working-directories-design.md` |
| Ticket-to-code (belső board) | `src/modules/pipelines/ticket-to-code/` |
| Ops | `src/modules/ops/` |
| Projekt UI | `src/web/src/pages/projects/` |

Host-pathok (`~/.claude/`, Obsidian-vault, helyi indexer) **példány**. Termék-kódban ne hivatkozd őket defaultként.

---

## P0 — általános termék (e nélkül ne nyiss parkolt tenant-munkát)

Sorrend kötött. Egy tétel = egy külső session. Minden tétel végén: érintett tesztek zöldek, 6 nyelv ha van UI, CHANGELOG **csak ha a user kéri a hullám lezárását**.

### 4. Egy memória — **törölve mint élő mount**

A vault path **nem** mutathat Obsidianra / `~/Documents/…`-re. Default marad `data/vault`. Capture oda ír. Provider memóriája ki. Lásd korlát 12.

A 20.5 („a 4. tétel után a típus-jegyzetek a közös vaultba”) **érvénytelen**: a típus-jegyzet az EYAS vaultban marad.

### 4b. Data-port: idegen memória egyszeri beolvasása (opcionális, nem blokkol)

Csak ha a user kéri. Nem P0-kapu.

- [x] 4b.1 A meglévő data-port (`obsidian` / `claude-code` / `generic-md` profil) hozza a markdown jegyzetet az **EYAS** vaultba. Másolat. Az idegen path innentől nem élő forrás.
- [x] 4b.2 Frontmatter nélküli jegyzet: `inferKind` fallback `reference`, soha nem `user` (már döntés a capture-ben). Egy-soros indexfájl (pl. `MEMORY.md`) ne írja felül tömegesen a vault indexét — jegyzetenként egy sor, vagy skip az indexfájlra.
- [x] 4b.3 Teszt: fictive markdown fa, nem a gép Obsidian-pathja. Home-szerű gyökér: csak asszisztens-mappák + Documents; `claude-sessions` skip.

**Kész, ha:** egy idegen mappa scan → proposal → approve után az EYAS vaultban van a jegyzet, a forrás-pathot a runtime nem olvassa újra.

### 5. Alacsony súrlódású read-path (általános)

Ma a `run_command` minden hívásra red+approval, shell metachar tilos. A költözés *általános* súrlódása ez.

- [x] 5.1 Zöld, klikk nélkül: ami már külön tool (`git status` / `git diff`), és más **általános**, egyértelműen read-only beépített tool. Ne nyiss tenant-speciális zöldutat itt.
- [x] 5.2 Sárga/piros + approval: tetszőleges `run_command`, írós git, secrets, bármi destruktív. Metachar továbbra is refused.
- [x] 5.3 Teszt: zöld path approval nélkül; metachar refused. Fixture nem host-path.

A kubectl-safety, `kubectl exec`, külső ticket-fetch a **parkolt** jegyzetben van.

A gate a `Bash` / `run_command` argv-t a meglévő `git_status` / `git_diff` toolra képezi, ha az egyértelműen read-only (nincs metachar, nincs `-C` / `--git-dir` / `--no-index`, nincs abszolút path). Ilyenkor zöld allow, klikk nélkül. `git commit` / `git add` / `ls` piros marad. A `requiresApproval` flag zöld allow után nem kér újra klikket.

**Kész, ha:** egy általános kódolós beszélgetés (status + diff + file tool) 0 felesleges approval-kattintással lefut, egy tetszőleges shell nem.

### 6. Named workspaces — kész

A beszélgetés **már átveszi** a projekt `workingDirectories` listáját create-kor. Itt a hiányzó: típus-szintű lista + UI pin.

- [x] 6.1 Előre beállítható working directories a **típuson és a projekten** (név + path mezők). A pathok a példányon vannak, nem a kódban. Projekt üres → típus listája.
- [x] 6.2 Beszélgetés elején pin, mint a search context. File toolok a pinelt root(ok)ra korlátozva.
- [x] 6.3 UI: workspace választó a beszélgetésen. 6 nyelv.
- [x] 6.4 Spec: `docs/superpowers/specs/2026-08-14-conversation-working-directories-design.md` — ne tervezd újra, kösd be.

Tárolás: `{name, path}` vagy sima path string, a parser mindkettőt érti. Üres projektlista → típus listája a beszélgetés create/PATCH-én. File toolok a pinelt rootokra jail-elve, nincs `process.cwd()` fallback.

**Kész, ha:** egy nem-EYAS working directory-jú projekt beszélgetésén az `edit_file` a pinelt root(ok)on van, nem az EYAS-repón. Fixture: fictive path.

### 7. UX: hosszú tool-os beszélgetés

Nem tenant-kilépési feltétel. A web UI-nak bírnia kell egy hosszú, tool-os sessiont.

- [x] 7.1 Streaming tool-trace (mi fut, args röviden, eredmény).
- [x] 7.2 Diff nézet file-editre (nem csak a modell prózája).
- [x] 7.3 Interrupt / stop mid-run.
- [x] 7.4 Plan mód (vagy a meglévő planning-runner láthatóvá tétele a beszélgetésen).
- [ ] 7.5 Manuális próba: egy valós, hosszú beszélgetés az EYAS-terméken.

**Kész, ha:** a fenti négy felszín megvan, 6 nyelv ahol UI, és a user nem küld vissza a TUI-ba *az EYAS-munkához*.

---

## P1 — általános, P0 után

P0 nélkül ne kezdd. Tenant-tétel **nincs** itt.

### 10. Ops executor tényleg `onStart`-ban — kész mint termék-identitás

A wiring (`onStart` injektál config/secretsből, default off, őszinte refusal) **már megvolt**. Ami hiányzott: a termék OCI OKE-nek nevezte magát.

- [x] 10.1 Identitás: Kubernetes ops agent, nem OCI OKE. `values-oci-oke.yaml` kikerült a chartból. Skillök (`oci-oracle`, k8s-storage/networking OCI példák) **maradtak**.
- [x] 10.2 Observe → diagnose → propose → approve → apply. Default propose-only. Cluster/kubeconfig/GitOps repo: példány-config.
- [x] 10.3 Spec érintetlen. A cluster/shell minták a parkolt jegyzetben maradnak — ne nyisd termék-sessionben.

### 12. Projekt-wiki auto (általános) — kész

- [x] 12.1 Ticket + döntés → projekt-scoped wiki oldal. Az útvonal sablon általános, nincs ügyfélnév (`ticket-<id>`, `decision-<id>`; a sor `client_id`-je a projekt id).
- [x] 12.2 Auto-update agent: zárt stage ticket + team-session findings/döntés. HTTP PUT emberi tulajdont vesz (`autoGenerated=false`).
- [x] 12.3 Wiki XOR vault: van effektív projekt → wiki, nincs → vault promoter. Auto-update soha nem olvassa a vaultot. `general-general` nem kap oldalt.

A UI: `/projects/:projectId/wiki` a projektkártyáról, nincs globális oldalsáv. Fixture: `alpha` / `bravo`.

### 13. Telegram mint csatorna (általános) — kész

A meglévő inbound coordinator + pairing a beszélgetés. Nincs ticket-ingest.

- [x] 13.1 Inbound: első üzenet létrehoz egy beszélgetést; a továbbiak ugyanazt folytatják. `/new` és `/start` (`/new@bot` is) elengedi a mappinget — a következő üzenet új thread. A slash command nem megy a modellnek.
- [x] 13.2 Outbound: sárga/piros tool enqueue → `autonomy:approval-requested` → Telegram ping Approve/Deny gombbal. A gomb a meglévő `decide()` + `autonomy:approval-resolved` (parkolt run resume). Chat: a beszélgetés telegram mappingje, különben az approved pairing. Nincs raw tool-arg a pingben.

### 16. Forge, media/studio, Recordly — termékhullám, nem ez a pickup.

---

## Hogyan dolgozz egy külső sessionben

1. Olvasd el ezt a fájlt + a tételhez tartozó „Hol van ma a kód” sorokat. A chatet ne keresd. A 19–24. viselkedést és a 13. (nincs `parent_id`) döntést ne litigáld újra.
2. Egy session = egy sorszámozott tétel. P0: **6 → 5 → 7**. A 4b csak kérésre. A parkolt jegyzet tételeit **ne** nyisd.
3. Először a meglévő kódot olvasd. Wire, don’t write: ha van alkatrész, kösd be.
4. Teszt a tételhez. Fixture **fictive** (`alpha` / `bravo`) — korlát 14.
5. UI-tétel: 6 locale + ha layout/viselkedés: böngészős ellenőrzés.
6. Commit csak explicit user-kérésre. Branch/push tilos kérés nélkül.
7. Ha egy korábbi döntés útjában áll, kérdezz — ne hackeld meg.

**P0 kész definíció:** a 5. + 6. + 7. tétel kipipálva. A memória csak az EYAS vault. Egy hosszú tool-os beszélgetés a web UI-n végigmegy.

A tenant napi driver a parkolt jegyzetben van. Ez **nem** blokkolja a termék-P0-t.
