# Parkolt: Odoo-támogatás — tenant extra (nem termék-P0)

> A termék-pickup: [`2026-08-30-napi-uzem-eyas-ala.md`](./2026-08-30-napi-uzem-eyas-ala.md). **Ezt a jegyzetet ne nyisd** termék-sessionben. A user akkor kéri, ha a shop Odoo-üzemét (ticket, indexer, eyssen.com, kubectl) az EYAS alá kell terelni.
>
> Őrzi a napi Odoo-üzem feladatait, hogy ne vesszenek el. Nem implementációs spec a termék-sessionnek.

**Dátum:** 2026-08-30
**Státusz:** parkolva. A **konnektor** (katalógustípus, natív JSON-RPC, élő instance toolok) **termék**, mint a GitHub — ne vedd ki. Itt a *tenant napi üzem* van: seed típus, ticket-ingest, indexer, eyssen.com, kubectl, dual connection.
**Forrás:** a régi „napi üzem átrakása” pickup (Grok, 2026-08-29/30) Odoo-fele + ami a termék-pickupból ide került (21–22, 25, korlát 8).

---

## Miért van ez a jegyzet

Az EYAS általános program. Az Odoo **konnektor** beletartozik (élő instance, mint egy GitHub-connection). Ami **nem** termék-alap: a mi shopunk napi stackje — eyssen.com `project.task`, több ügyfél-Odoo, Community fork, SQLite indexer, OKE, seedelt `odoo` ProjectType, ticket- vs execute-connection.

Ha a termék-P0 megvan, **akkor** lehet a shop-üzemet extra/példány-munkaként kötni. Addig a napi Odoo-ticket a TUI + host skill (`odoo-ticket`, `odoo-connector`, `odoo-search.sh`).

Ez a fájl a rés-mátrix, a projekt-térkép és a parkolt tételek, ügyfélnevekkel — **csak itt**, soha a `src/`-ben mint default.

---

## Termék vs. tenant — ne keverd

| Bent marad a termékben (konnektor) | Ide tartozik (tenant napi üzem) |
|------------------------------------|----------------------------------|
| `src/modules/odoo/` JSON-RPC kliens | Seed `ProjectType` id `odoo` + `ODOO_TYPE_PROMPT` |
| Connections katalógus `id: 'odoo'` native adapter | `ticket_connection_id` (ticket-DB vs instance-DB) |
| Élő toolok: `odoo_search_tasks`, `odoo_get_task`, `odoo_message_post`, `odoo_write_task` | Search `family: odoo` 50k walk, `EYAS_ODOO_*` bootstrap, 18c/18e pin mint termék-default |
| Connection-test, connection-scoped secret | Routing kategória `odoo_development` |
| `default_connection_id` bármely katalógus-típusra (Odoo is) | Bundled `odoo-dev-chain` mint *az* implementációs lánc; host `odoo-ticket` / indexer path |
| Handbook: Odoo mint rendszertípus a Connectionsben | eyssen.com, ügyfélnevek, pod nevek, checkout pathok, `graph-builder topic:odoo` mint tenant-téma |

Egy 2026-08-30 memória-ruling („Odoo a `src/`-ben tilos, csak skill/MCP”) **téves volt**: a konnektort akarta kivenni. **Felülírva.** A natív klienst ne vedd ki. A tenant-defaultot ne égesd a seedbe.

---

## Kiindulási pont (dogfood, példány)

Az augusztusi sessionök alapján a munka nagyjából:

| Sáv | Arány | Példa |
|-----|-------|--------|
| Odoo ticket → kód | ~55% | eyssen.com `project.task`, Werth/Soler/3Dee/D1, `_inherit`, NAV/ÁFA |
| EYAS termékfejlesztés | ~30% | a másik pickup |
| Infra / OKE | ~10% | `kubectl exec` + `odoo shell`, GitOps |
| Egyéb | ~5% | könyvelő, n8n, doksi-deploy |

A minőség a felszínből jön: `odoo-ticket`, `odoo-connector`, SQLite indexer (`odoo-search.sh` 18c/18e/19c/19e), letzdoo plugin skillök, personák, kubectl-safety hook, vault-döntések.

Rövid rés-mátrix (a kiindulás; a termékoszlop a 0.8.17 állapot, konnektor **benne**):

| Napi lépés | Ma (TUI) | EYAS 0.8.17 | Paritás? |
|------------|----------|-------------|----------|
| Ticket + chatter + melléklet | `fetch_ticket.py` + Keychain | `odoo_get_task`, egy instance, nincs chatter | Nem |
| Tetszőleges Odoo RPC, több instance | connector skill | `execute_kw` a kliensben van, toolként nincs; Connections tud több sort, a toolok globális secretet is olvasnak | Nem |
| Forrás-grounding | SQLite indexer, 4 checkout | regex-séta + Orama (50k fájl, 256 KB), `family: odoo` | Gyenge |
| `_inherit` / security / teszt / OWL | marketplace skillök + personák | egy `odoo-dev-chain.md` | Gyenge |
| Pod diagnózis | `kubectl` + safety hook | ops: executor nincs injektálva | Nem |
| Memória | Obsidian `99_Meta/ai-memory` | saját `data/vault` — **így marad**; idegen jegyzet csak data-port import | Szétcsúszik, amíg nincs import |
| Skillök | `~/.claude/skills` + pluginok | `importRoots` (példány `local.yaml`) | Példányon köthető |
| Böngésző / TOTP | TUI browser | `browser_*` + TOTP — termék, megvan | Igen (a bejelentkezés példány) |
| Board, approval, audit, Telegram, scheduler | nincs / n8n | van (általános) | EYAS előny |

---

## Korlátok, ha egyszer a shop-extra készül

A termék korlátai (MIT, izoláció, nincs auto-commit, 6 nyelv, nincs tenant-adat a `src/`-ben) **itt is** érvényesek. Plus:

- A mi Odoo-munkánk: Community fork, Enterprise csak külön kérésre, EE kódot soha nem másolunk. Ez **példány / típus-prompt**, nem termék-default. Pod-vs-local, indexer-path ugyanígy.
- Pod vs. local: a termék defaultja local; pod-írás csak explicit. Pod-only projekt (Soler), external-pod read-only: **projekt-prompt / connection**, soha ne égesd a kódba.
- Runtime nem Keychain-függő. Keychainből egyszeri secret-import OK; service-nevek a példányon.
- **Konnektor marad** a termékben. Új natív klienst ne vezess ki. A shop-extra a ticket-chatter, indexer-wrapper, dual connection, board-szinkron — nem a JSON-RPC kliens újraírása.
- Memória: az extra **sem** írhat Obsidianba / `~/.claude`-ba. Capture az EYAS vaultba. Import: data-port (termék 4b).

A korábbi termék-korlát 8 („Odoo a `src/`-ben tilos…”) **ide tartozott, és érvénytelen** a konnektorra. Ami abból megmarad: nincs seedelt `odoo` típus, nincs tenant path, nincs `odoo_development` routing mint termék-kategória, nincs `EYAS_ODOO_*` default.

---

## 21–22. és 25. — átkerült a termék-pickupból

A 21. tétel seedelt egy `odoo` `ProjectType`-ot. A 22. tétel `ticket_connection_id`-t és Odoo-tool routingot rakott a `projects` táblára. Ez a **tenant** kötés, nem a konnektor. A termékben marad: user létrehozhat típust; `default_connection_id` bármely connectionre.

### 25. Tenant-kötés ki a seedből / mag-boardból (nem a konnektor)

Ne vedd ki a modult. Csak a shop-defaultot.

- [ ] 25.1 Seed: töröld a `odoo` `ProjectType`-ot a `seedBoardDefaults`-ból (`ODOO_TYPE_PROMPT` is). Meglévő példányon: seed-sor `source='seed'` AND `id='odoo'` AND user nem szerkesztette → törölhető; ha a user átírta / projektet rakott alá, **ne** töröld vakon — állj meg. Teszt: új DB-n nincs `odoo` típus. Marad: `general`, `eyas`. A típust a példányon a user létrehozza.
- [ ] 25.2 **Ne** vezesd ki a `src/modules/odoo/` modult, a live toolokat, a security-gate `odoo_*` listákat, a handbook Connections Odoo-oldalát.
- [ ] 25.3 Connections katalógus: az `id: 'odoo'` native adapter **marad**. GitHub `org` placeholder ne legyen `eyssen` (ez a termék 14. korlátja is).
- [ ] 25.4 Search: `family: odoo` 50k walk, pin-kényszer, default `family: 'odoo'` a path-os forrásnál — **általánosítsd** (verziós forrás-család) vagy vidd az extra alá. Routing: `odoo_development` kategória **ki** a mag-routingból (a modellnek nem kell Odoo-kategória a triázshoz).
- [ ] 25.5 `ticket_connection_id` oszlop és az Odoo-tool resolver (ticket vs default vs globális `odoo-*` secret) **ki a mag-boardból**. `default_connection_id` **marad**. Ticket-connection csak itt, az extra oszlopa/resolver-e. Teszt: fictive connection.
- [ ] 25.6 `graph-builder` `topic:odoo`; seed i18n `projects.types.seed.odoo.*`; handbook példák, amik *az* Odoo-fejlesztői láncot termék-defaultnak állítják (18c/18e, `odoo-dev-chain` mint kötelező skill). Ugyanaz a kérdés: idegen letöltőnek igaz, vagy csak nekünk?

**Kész, ha:** tiszta clone + seed után van Odoo **konnektor** (katalógus + live toolok), de nincs seedelt `odoo` típus, nincs tenant path, nincs `odoo_development` routing; `default_connection_id` működik fictive connectionnel.

---

## Projekt-térkép — példány, nem seed

A hierarchia a termékben már megvan (19–20, 23–24):

```
ProjectType → Project → Stage → Conversation
```

Nincs `parent_id`. Tag = board-szűrő + egy suffix-sor. Domain-memória = `kind=domain` a típuson.

**Ne litigáld újra** a 3 szintet. A lenti nevek a **gépeden** születő projektek, ha a shop-extra megvan. A termék seedje `general` + `eyas` (+ ma még a seedelt `odoo`, amíg a 25.1 meg nincs).

| ProjectType (példányon létrehozva) | Project | Always-on a modellnek |
|------------------------------------|---------|------------------------|
| `odoo` (user-created type, nem seed) | `werth`, `soler`, `3dee`, `distributionone`, `absolute`, `bluesound`, `maxvalor`, … | Típus-prompt: Community fork, indexer, no EE, hu, pod-vs-local. Projekt: pod név, connection, Soler=pod-only, stb. |
| ugyanaz | `eyssen-erp` | Platform-modulok, amikor a ticket nem egy ügyfélé |
| `eyas` (termék seed) | Agents/Skills/Prompts/System | termék |
| `infra` (később, példány) | `oke-gitops` | kubectl, GitOps, CNPG |

Tag kategóriák a **board**on: `module:l10n_hu`, `nav`, `liquidity` — emberi szűrés + opcionális egy sor a suffixben.

A keresztbe menő tudás (tax_skew, `l10n_hu`, eyssen-erp viselkedés) **típus-szintű** jegyzet az EYAS vaultban (`project-types/<id>/`), nem negyedik entitás.

`eyssen-erp` mint kód: a típus working directory-ja / indexed source-a, nem alproject.

---

## Hol van ma (példány + termék-konnektor)

| Téma | Útvonal |
|------|---------|
| Natív konnektor (termék, **marad**) | `src/modules/odoo/` |
| Connections `odoo` típus (termék, **marad**) | `src/modules/connections/catalog.ts` |
| Seed `odoo` típus (tenant, 25.1) | `src/modules/board/index.ts` (`seedBoardDefaults`) |
| `ticket_connection_id` (tenant, 25.5) | `src/modules/board/schema.ts`, `project-service.ts` |
| Search `family: odoo` (25.4) | `src/modules/search/` |
| Routing `odoo_development` (25.4) | `src/modules/model/routing/` |
| Odoo skill (vékony, maradhat skillként) | `config/skills/coding/odoo/odoo-dev-chain.md` |
| Mai ticket skill | `~/.claude/skills/odoo-ticket/` |
| Mai connector skill | `~/.claude/skills/odoo-connector/` |
| Indexer wrapper | `~/GitHub/.odoo-index/odoo-search.sh` |
| SQLite indexek | `~/.odoo-indexer/odoo-{18,19}-{community,enterprise}.sqlite3` |
| Checkoutok | `~/GitHub/odoo/odoo-odoo-{18,19}`, `odoo-enterprise-{18,19}`, `~/GitHub/owl/eyssen-erp` |
| Közös TUI-memória (nem EYAS élő vault) | `~/Documents/Obsidian Vault/99_Meta/ai-memory/` |
| kubectl safety (Claude hook) | `~/.claude/` PreToolUse `kubectl-safety` |
| Personák | `~/.claude/agents/` |
| `deploy-eyssen-docs` | `~/.claude/skills/deploy-eyssen-docs` |
| Ticket-to-code (board, nem Odoo) | `src/modules/pipelines/ticket-to-code/` |
| Ops stub | `src/modules/ops/` |

A `~/.claude/`, Obsidian-vault, `odoo-search.sh` pathok **példány**. Termék-kódban ne hivatkozd őket defaultként.

---

## Parkolt tételek

Sorszámok a régi pickupból. **Ne implementáld** a termék-P0 alatt. Ha a shop-extra formája dől, ezekből lesz a spec.

### 1. Több-Odoo connection + execute + ticket chatter

A Connections-katalógusban van `odoo` típus (termék). A live toolok ma egy globális secret-készletet (`odoo-url`, `odoo-db`, …) is olvasnak, plusz connection-scoped secretet.

- [ ] 1.1 Több Connection. Tool paraméter: `connectionId`. Default: a projekt `default_connection_id`; ticket-read külön connection (a példányon, 25.5 / extra oszlop). Az id-k nem a kódban.
- [ ] 1.2 `execute_kw` toolként: `search_read` / `read` / `fields_get` **zöld**; `write` / `create` / `unlink` / `message_post` **sárga/piros + approval**.
- [ ] 1.3 Ticket: `mail.message` (chatter, tracking) + `ir.attachment` lista; opcionális letöltés → Documents. Minta: `~/.claude/skills/odoo-ticket/scripts/fetch_ticket.py`.
- [ ] 1.4 Secret az EYAS vaultban, connection-scoped. Keychainből egyszeri import OK; runtime ne Keychainre támaszkodjon.
- [ ] 1.5 Teszt: mock JSON-RPC, több connection, approval-gate write-on, ticket+chatter fixture (fictive, nem élő ügyfél-id).
- [ ] 1.6 Kézikönyv: a konnektor (katalógus + live toolok) **termék**-oldal. A ticket-chatter / execute_kw extra-fejezet csak ha a shop-extra a termék része (ki-be kapcsolható).

**Kész, ha:** egy ticket-id kiadva visszaadja a ticketet chatterrel, a megfelelő connectionön, write nélkül. A ticket-id a hívás argumentuma, nem konstans.

### 2. Forrás-indexer a mai szinten (SQLite wrapping, ne Orama-csere)

Az Orama 50k/256 KB **nem** Odoo-indexer. Ne írj új indexert. A `family: odoo` speciális eset a 25.4 szerint általános vagy extra — ide ne tedd vissza *rendszer-familyként*, hacsak az extra nem hoz saját, ki-be kapcsolható forrás-típust.

- [ ] 2.1 Tool vagy skill-wrapper: a meglévő `odoo-search.sh` / SQLite (`18c` `18e` `19c` `19e`). Parancsok: `search`, `get_details`, `search_xml_id`, `find_refs`.
- [ ] 2.2 Version pin, ha több checkout van.
- [ ] 2.3 Viselkedés-állítás továbbra is `read_file` / `grep` a checkout pathon — az indexer csak létezést/nevet/típust ad.
- [ ] 2.4 Cite formátum: `[source:odoo-src:label:path:line]` — csak az extra belsejében.
- [ ] 2.5 `odoo-dev-chain.md` (skill): indexer az első lépés, regex-séta fallback. Import a példány `importRoots`-ján, ne termék-kötelező skill.
- [ ] 2.6 Teszt: pin nélkül elutasít; pin mellett a wrapper a várt args-szal hív (a sqlite-ot mockold).

**Kész, ha:** `sale.order` + `18c` pin mezőlistát ad a SQLite-ból, nem regex-sétából.

### 5-ops. kubectl + odoo shell (a termék 5. tételének shop-fele)

- [ ] kubectl read-only igék (`get|logs|describe|top`) zöld, ha az ops extra/általános gate engedi.
- [ ] `kubectl apply|delete|exec` sárga/piros + approval.
- [ ] A `kubectl-safety.sh` tartalma a security-gate-be (fail-closed), ne Claude PreToolUse hook maradjon — **csak ha** az ops út be van kapcsolva; a tartalom általánosítható, a mi cluster-neveink nem.
- [ ] `kubectl exec … -- odoo shell` diagnózis: külön tool vagy allowlistelt exec, stdin script, **ne** interaktív TTY. Pod-írás explicit.
- [ ] Teszt: zöld path; `kubectl delete` deny/approval.

### 8. Ticket adapter a ticket-to-code pipeline-ra

- [ ] 8.1 `TicketSourcePort` implementáció Odoo `project.task`-ra (nem csak board-conversation).
- [ ] 8.2 Ingest = ticket chatterrel. Utolsó stage: chatter visszaírás + board kártya, gated.
- [ ] 8.3 A pipeline default off, amíg PR provider + secret nincs. Lásd `src/modules/pipelines/ticket-to-code/README.md`.

### 9. Böngésző: ügyfél-Odoo UI-check (példány)

A `browser_*` + TOTP **termék**, megvan. Itt csak a mi céljaink:

- [ ] 9.1 Bejelentkezés eyssen.com / ügyfél-Odoo-ba, **nem** a napi Chrome profil. URL-ek a példány connectionjén, nem a kódban.
- [ ] 9.2 UI-változás után kötelező kör (user rule): a feature-t végigkattintani, nem screenshotot nézni.
- [ ] 9.3 TOTP seed Secretsben; a seed soha nem logolódik.

### 11. Board szinkron eyssen.com taskokkal

- [ ] 11.1 Nyitott `project.task` → EYAS kártya (poll vagy scheduler).
- [ ] 11.2 Stage visszaírás gated.
- [ ] 11.3 Egy ticket = egy beszélgetés (board-design: Task=Conversation). A beszélgetés **kötelezően** egy példány-projektre essen, ne `general-general`-ba.

### 13-ticket. Telegram inbound ticket-hivatkozás

A termék 13. tétele a csatorna + approval ping. Itt:

- [ ] Inbound: ticket-hivatkozás → ugyanaz a P0 Odoo-pipeline (1. + 8.).

### 14. `deploy-eyssen-docs` skill

- [ ] A `~/.claude/skills/deploy-eyssen-docs` tartalma EYAS skill + gated `run_command` / kubectl. Destructive doksi-pod csak approval után. Ez **a mi** skillünk, nem termék-default.

### 21–22. mint extra-terv (nem termék-seed)

- [ ] Példányon (UI): user létrehoz egy domain-típust + ügyfél-projekteket. A típus-prompt általános viselkedés a **mi** forkunkra (indexer, pod vs local) — a prompt a példányon van, nem a letöltött seedben.
- [ ] Két connection / projekt: instance DB vs ticket-DB. A termékben marad a `default_connection_id`. A ticket-connection **csak az extra** oszlopa/resolver-e legyen, ne a mag-boardé.
- [ ] Új beszélgetés: domain-ticket ne essen `general-general`-ba.

### 15. n8n ismert jobok → scheduler

Az n8n SQLite→Postgres amúgy pending. Külön döntés.

### 17. Saker, könyvelés / UK sole trader

Külön döntés. Nem Odoo-extra.

### 18. Teljes pipeline PR/deploy éles GitOps-ra

Az ops (termék 10. / ez a 5-ops) után.

---

## Amíg ez a jegyzet parkol

- Napi Odoo-ticket: **TUI**.
- EYAS termék-P0: a másik pickup (workspace, súrlódás, UX). A konnektor már a termékben van; ne nyúlj hozzá termék-sessionben.
- Skill-import: a példány `local.yaml` `importRoots`-ja rámutathat a `~/.claude/skills`-re — a shop-lánc példányon él, nem seedben.
- Memória: az EYAS vault a terméké. Az Obsidian `ai-memory` marad a TUI közös tára, amíg egy data-port import (termék 4b) egyszer át nem másolja.
