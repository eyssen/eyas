---
title: Eszközök
description: Hívható képességek katalógusa — kockázat, jóváhagyás, hozzárendelés.
---

**Mire való.** Az eszköz (tool) az, amit az agent tényleg meg tud tenni: fájlt olvas, indexet keres, böngészőt nyit, e-mail-piszkozatot küld. Ez az oldal az élő katalógus. A hozzárendelés az agent **Konfiguráció** fülén történik; itt a nevet, kategóriát, kockázatot és a jóváhagyást nézed.

**Útvonal:** `/tools`. Alcím: *Az agentek által használható regisztrált eszközök.*

## Mikor használd

- Mielőtt id-ket írsz az agent tool-listájára, látni akarod, mi létezik.
- Egy hívást blokkoltak, és kell a kockázati szint meg a **jóváhagyás szükséges**.
- MCP-t vagy Connectiont kötöttél, és a felfedezett toolokat a beépítettek mellett akarod látni.
- Kell a bemeneti séma, mert az agent rosszul hívja.

## Tipikus folyamat

1. Nyisd az **Eszközök** menüt (`/tools`).
2. Keress név/leírás szerint, vagy szűrj **kategória** és **kockázati szint** szerint.
3. **Séma megjelenítése**, ha kell a JSON bemenet.
4. Az id-t az agent **Konfiguráció** fülén adod meg. Lásd [Konfiguráció](/docs/hu/agents/configure/).
5. A veszélyes hívások runtime a [biztonsági kapun](/docs/hu/admin/security-privacy/) mennek át — a katalógussor nem jogosultság.

## Funkciók

A fejléc számolja az **eszköz**öket és hány **jóváhagyást igényel**. Kártya: monospace id, leírás, kategória, kockázat (**low / medium / high / critical**), borostyán pajzs ha kell jóváhagyás.

| Fogalom | Jelentés |
|---------|----------|
| Tool név | Stabil id configban és logban |
| Leírás | Mit csinál |
| Kategória | `system`, `file`, `network`, `compute`, `data`, … |
| Kockázati szint | `low` · `medium` · `high` · `critical` |
| **jóváhagyás szükséges** | Emberi igen nélkül nem fut |
| Bemeneti séma | JSON Schema — **Séma megjelenítése / elrejtése** |
| Jogosultság | CASL + biztonsági kapu |
| Homokozó | Egyes toolok korlátozott környezetben futnak |

Üres: *Még nincs regisztrált eszköz.*

MCP: [MCP-szerverek](/docs/hu/ai/mcp/). Külső rendszer: [Kapcsolatok](/docs/hu/admin/connections/).

## Mezők és vezérlők

<h2 id="catalogue">Szűrők</h2>

| Vezérlő | Jelentés |
|---------|----------|
| Keresés | *Eszközök keresése…* |
| **Minden kategória** | Egy kategóriára szűkítés |
| **Minden kockázati szint** | Egy szintre szűkítés |

## Beépített csoportok (kiemelések)

### Kódolási felület (modellfüggetlen)

Minden modell (Grok, Claude API, Kimi, lokális, …) tud kódot szerkeszteni Claude Code SDK builtinok nélkül:

| Tool | Cél | Kockázat |
|------|-----|----------|
| `read_file` | Szövegfájl (offset/limit) | zöld |
| `write_file` | Létrehozás/felülírás | sárga |
| `edit_file` | Pontos stringcsere | sárga |
| `grep` | Tartalomkeresés a workspace-ben | zöld |
| `glob` | Fájlkeresés mintára | zöld |
| `git_status` / `git_diff` | Csak olvasható review | zöld |
| `run_command` | Shell nélküli futtatás (jóváhagyás) | piros |

Útvonalak a beszélgetés **munkakönyvtáraira** (vagy az agent **worktree**-jére) vannak zárva. Nincs fallback az EYAS process könyvtárára. Érzékeny pathok (`.env`, `master.key`, `.ssh`, …) tiltva. Inkább `edit_file`, mint teljes fájl-újraírás.

**Olvasható git kattintás nélkül.** Ha az ágens `run_command` (vagy CLI `Bash`) hívása egyértelműen `git status` vagy `git diff` — nincs shell metachar, nincs `-C` / `--git-dir` / `--no-index`, nincs abszolút path — a gate `git_status` / `git_diff`-re képezi, és **engedélyezi**. Nem kér jóváhagyást. A `git commit`, `git add`, `ls` és minden metachar-os parancs piros marad vagy elutasított.

**Verify before done:** `agent.verifyCommands` YAML-ben (pl. `bun test`); hiba esetén az agent újra megnyílik az összefoglalóval.

**Hookok:** minden hívás PreToolUse / PostToolUse a ToolExecutoron (univerzális, nem csak Claude).

### Keresés és grounding

| Tool | Cél |
|------|-----|
| `list_search_sources` | Források listája tényállítás előtt |
| `get_search_context` | Mi van pinelve erre a beszélgetésre |
| `set_search_context` | Pin / törlés |
| `search_indexed` | Hibrid FTS + vektor **idézetekkel** |

Több **odoo-family** forrás ready és nincs pin → **`needsPin`**. Lásd [Keresés](/docs/hu/daily/search/#multi-version-pin-which-tree-may-the-agent-use).

### Memóriablokkok

| Tool | Cél |
|------|-----|
| `memory_block_read` / `memory_block_write` | Megosztott blokkok |
| `search_memory` / `save_memory` | Tartós vault jegyzetek — EYAS memória, nem a host CLI-é. A `search_memory` a projektben a korábbi beszélgetésüzeneteket is keresi (user + assistant); a `scope=all` projekteken átnyúlik. A `scope` alapból `current` (ez a projekt, a típusa, plusz globális user/feedback/reference); `all` a többi projektet is. A Memória oldal keresése szűretlen. |

Lásd [Memória](/docs/hu/knowledge/memory/).

<h3 id="browser">Böngésző</h3>

Headless Playwright (`browser_*`) — ugyanaz a Chromium, mint a design print. Index CSS helyett; `snapshotId` navigációra érvénytelen. Profil: `data/browser/profile` / `EYAS_BROWSER_USER_DATA_DIR`, **soha** a napi Chrome-profil. Letöltés a [Dokumentumok](/docs/hu/knowledge/documents/) közé. Részletek: [Browser Use](/docs/hu/automation/browser-use/).

| Tool | Cél |
|------|-----|
| `browser_navigate` | URL; **SSRF** a privát/metadata hostokra |
| `browser_snapshot` | Accessibility fa + számozott lista + `snapshotId` |
| `browser_click` / `browser_fill` / `browser_hover` / `browser_select` | Index vagy CSS |
| `browser_tabs` | `list` / `open` / `switch` / `close` |
| `browser_back` / `browser_wait` | Vissza; várakozás |
| `browser_dialog` | Accept/dismiss a következő dialógusra |
| `browser_upload` | Fájlmező — workspace vagy Documents id |
| `browser_evaluate` | JS az oldalon (nem Node) |
| `browser_download` | Letöltés → Dokumentumok |
| `browser_storage` | Playwright `storageState` |
| `browser_replay` / `browser_action_cache` | Elmentett locator, LLM nélkül. JSON projekt vagy vault. Kitöltött érték nincs benne |
| `browser_totp` | TOTP a Titkokból / Keychainből → `browser_fill`. Sárga. A seed nem jön vissza |
| `browser_screenshot` / `browser_get_content` / `browser_close` | Kép, szöveg, process vége |
| `agent_browser_status` / `agent_browser_run` | Ajánlott agent-browser sidecar (`@e1`) |
| `browser_use_status` / `browser_use_exec` | Régi Python CLI sidecar |

Draft→approve→send e-mail, élő Odoo JSON-RPC + lokális `odoo_search_*`, Connections inventory. Skill: `coding/odoo/odoo-dev-chain`. A Stúdió `hyperframes_*` / `videouse_*` tooljai: [Stúdió](/docs/hu/studio/). Képernyőrögzítés-csiszolás nem tool: a Recordly AGPL kísérő a [Bővítmények](/docs/hu/admin/extensions/#recordly) alatt — nincs `recordly_*`.

**Média** (opcionális): `media_generate`, `media_wait`, `media_catalog`, `media_balance`, `media_history` — Magnific / Higgsfield / fal a [Média](/docs/hu/ai/media/) alatt. A kész fájlok a Dokumentumokba ingestelődnek.

További csoportok, ha a modul be van kapcsolva: board, conversation, document, knowledge, research, schedule, channel, A2A delegate, opcionális Google Docs. Az agent-modul tooljai (`delegate_to_agent`, team, …) ott regisztrálódnak, itt nem duplikálva.

### CLI MCP paritás

**Grok CLI** / **Kimi Code CLI** stdio MCP hídon kapja ugyanazt a ToolExecutor felületet. Lásd [MCP](/docs/hu/ai/mcp/).

## Kapcsolódó

- [Agentek — toolok](/docs/hu/agents/configure/)
- [Biztonsági kapu](/docs/hu/admin/security-privacy/)
- [Kapcsolatok](/docs/hu/admin/connections/)
- [Készségek](/docs/hu/automation/skills/)
- [MCP-szerverek](/docs/hu/ai/mcp/)
- [Média](/docs/hu/ai/media/)
- [Stúdió](/docs/hu/studio/)
- [Browser Use](/docs/hu/automation/browser-use/)
- [Bővítmények](/docs/hu/admin/extensions/#recordly)
