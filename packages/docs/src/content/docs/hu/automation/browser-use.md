---
title: Browser Use
description: Headless Playwright toolok nyilvános oldalakra, és opcionális CLI-sidecar a már belépett Chrome-hoz.
---

**Mire való.** Összefüggő felületek, egy modell. A headless `browser_*` toolokkal az ügynök az EYAS saját Chromiumában nyit nyilvános oldalt. A **Browser Use** képernyő (`/browser-use`) két opcionális CLI-sidecar **tartós belépéshez**: **Agent Browser** (ajánlott — Vercel `agent-browser`, Apache-2.0, `@e1` refek) és a régi Python Browser Use CLI. A **Playwright MCP** opcionális [Kapcsolatok](/docs/hu/admin/connections/) katalógussor a11y-refhez. A **Chrome DevTools MCP** külön coding/debug katalógussor (konzol, hálózat, Lighthouse, WebMCP) — nem űrlapkitöltés. Egyik út sem importál idegen LLM SDK-t. A modell az EYAS-é marad. Soha `agent-browser chat`, soha a Python browser-use MCP.

**Útvonal:** `/browser-use`. Oldalsáv: **AI → Browser Use**. A headless toolok katalógusa: [Eszközök](/docs/hu/automation/tools/) (`/tools`).

## Mikor használd

- Az ügynök **nyilvános** oldalt olvasson vagy töltsön ki, a napi Chrome nélkül.
- A letöltés a [Dokumentumok](/docs/hu/knowledge/documents/) közé kerüljön, a beszélgetéshez kapcsolva.
- A **már belépett** Chrome kell (admin, levelezés, 2FA kész) — ez a sidecar, nem a headless.
- Egy hívás elakadt, és látni akarod, **Kész** vagy **Nem kész** a sidecar, plusz az orvosság.

## Tipikus folyamat

1. **Eszközök** (`/tools`). Keresés: `browser_`. Index CSS helyett, `browser_snapshot`.
2. Az id-ket az agent **Konfiguráció** fülére. [Konfigurálás](/docs/hu/agents/configure/).
3. Nyilvános oldal: navigál, snapshot, indexre kattint, navigáció után újra snapshot.
4. Tartós belépés: **Browser Use** (`/browser-use`). Az **Agent Browser** kártyát részesítsd előnyben. Ha **Nem kész**: `npm i -g agent-browser`, majd `agent-browser install`, vagy `EYAS_AGENT_BROWSER_BIN`. Az ügynök: `agent_browser_status`, majd `agent_browser_run`. A Python kártya a régi sidecar.
5. Nem böngésző asztali app: [Kezek](/docs/hu/admin/hands/).

## Funkciók

### Sávok

| Feladat | Hol | Toolok |
|---------|-----|--------|
| Nyilvános oldal, headless | [Eszközök](/docs/hu/automation/tools/) | `browser_*` — Playwright, számozott index, EYAS-profil |
| Tartós belépés, `@e1` (ajánlott sidecar) | ez a képernyő, `/browser-use` | `agent_browser_status`, majd `agent_browser_run` (vagy `mcp_agent_browser_*`) |
| Régi Python CLI | ez a képernyő, második kártya | `browser_use_status`, majd `browser_use_exec` |
| a11y-ref MCP-sidecar / élő fül | [Kapcsolatok](/docs/hu/admin/connections/) + [MCP](/docs/hu/ai/mcp/) katalógus | `mcp_playwright_*`, ha a Playwright MCP kapcsolódott |
| Coding/debug: konzol, hálózat, Lighthouse, WebMCP | [Kapcsolatok](/docs/hu/admin/connections/) + [MCP](/docs/hu/ai/mcp/) katalógus | `mcp_chrome-devtools_*`, ha a Chrome DevTools MCP kapcsolódott — **nem** űrlapkitöltés |
| Asztali OS | [Kezek](/docs/hu/admin/hands/) | Kezek |

<h2 id="headless">Headless Playwright (browser_*)</h2>

Nincs Python. Ugyanaz a Chromium, mint a design print. A **folyamat** 5 perc; a sütik a `data/browser/profile` (vagy `EYAS_BROWSER_USER_DATA_DIR`) alatt maradnak. Ez **soha** nem a napi Chrome/Edge profil — a Chrome 136+ a Default profilon tiltja a CDP-t, az EYAS pedig előre elutasítja.

| Tool | Mit csinál |
|------|------------|
| `browser_navigate` | http(s) URL. **SSRF** a privát/metadata hostokra |
| `browser_snapshot` | Accessibility fa + számozott lista + `snapshotId` |
| `browser_click` / `browser_fill` / `browser_hover` / `browser_select` | **Index** (ez a preferált) vagy CSS |
| `browser_tabs` | `list` / `open` / `switch` / `close` — az utolsó tabot nem zárja |
| `browser_back` | Vissza (invalidálja az indexeket) |
| `browser_wait` | Selector, URL, load vagy timeout (max 30 s) |
| `browser_dialog` | Accept/dismiss **mielőtt** a klikk megnyitja az `alert`/`confirm`/`prompt`-ot |
| `browser_upload` | Fájlmező — workspace path és/vagy Documents id |
| `browser_evaluate` | JavaScript **az oldalon**, nem Node-ban. JSON max 50k |
| `browser_download` | Következő letöltés → Dokumentumok, a beszélgetéshez kapcsolva |
| `browser_storage` | Playwright `storageState` mentés/töltés |
| `browser_replay` / `browser_action_cache` | Elmentett locator a következő futáson (nincs LLM). JSON a projekt vault mappában, különben `procedural/browser-action-cache.json`. Nem Stagehand; kitöltött érték és TOTP-seed nincs a cache-ben |
| `browser_totp` | 6 jegyű TOTP a [Titkok](/docs/hu/admin/secrets/)ból (vagy macOS Keychain). A kód a `browser_fill`-be. Sárga. A seed soha nem jön vissza |
| `browser_screenshot` / `browser_get_content` / `browser_close` | Kép, szöveg, process vége (a profil a lemezen marad) |

Az index és a `snapshotId` navigációra vagy vissza gombra érvénytelen. Snapshot újra. Sikeres klikk/kitöltés `intent: "click Submit"` mellett tartós CSS/role locatort ment (nem az indexet); a `browser_replay` ugyanezen originen ezt használja. A letöltés a **Dokumentumok** (`/documents`) alatt jelenik meg. A veszélyes hívások [jóváhagyásra](/docs/hu/admin/security-privacy/) várnak.

Nyilvános oldalra ez a sáv. A sidecar a már belépett Chrome-hoz kell.

<h2 id="agent-browser">Agent Browser (ajánlott sidecar)</h2>

Opcionális Vercel `agent-browser` CLI (Apache-2.0). Az EYAS **nem** vendoroja a Rust crate-et. Feloldás: `EYAS_AGENT_BROWSER_BIN` → settings → PATH. Beállított, de hiányzó env-path = hiba, nincs PATH-fallback. Hiányzó bináris, timeout, vagy `doctor --offline --quick --json` `ok: false` → **Nem kész**. Nincs npx auto-install.

Telepítés: `npm i -g agent-browser`, majd `agent-browser install`.

Az ügynök: `agent_browser_status`, majd `agent_browser_run` `argv`-val (`["snapshot","-i"]`, `["click","@e1"]`) vagy `batch` JSON. A ref `@e1`. Auth: `state save` / `state load` a `data/browser/agent-browser/` alatt. Profil: EYAS-tulajdon (`data/browser/agent-browser/profile`). Soha `--profile Default`, soha a napi Chrome-profil (Chrome 136+). Soha `--auto-connect` / `--cdp`. Soha `--no-sandbox`. Soha `chat` (Vercel AI Gateway — a modell az EYAS-é). Az `AI_GATEWAY_*` spawnkor le van szedve.

Opcionális MCP: **Beállítások → MCP szerverek → Katalógus → Agent Browser** (`agent-browser mcp --tools core,state`). A `--tools all` / `debug` átíródik (`chat`). Toolok: `mcp_agent_browser_*`. A Test fail-closed.

<h2 id="sidecar">Python CLI (régi)</h2>

Az extra modul továbbra is burkolja a MIT Browser Use **CLI**-t. Nem vendoroja a Python libet és az LLM SDK-kat. Telemetria mindig ki. A Cloud kulcs csak akkor marad, ha a beállításokban bekapcsolod. Soha `--no-sandbox`. Ha az Agent Browser kártya Kész, azt használd.

Kell:

- Python 3.11+
- `browser-use` a PATH-on, `uvx`, vagy `EYAS_BROWSER_USE_BIN`

Ha egy check **Hiányzik**, az üres szöveg azt mondja, a CLI nincs kész — pótold, aztán `browser_use_exec`. Ne találj ki CDP URL-t.

<h2 id="playwright-mcp">Playwright MCP (Kapcsolatok)</h2>

Opcionális Microsoft `@playwright/mcp` (Apache-2.0). Telepítés: **Beállítások → MCP szerverek → Katalógus**, aztán opcionálisan [Kapcsolatok](/docs/hu/admin/connections/) sor **Playwright MCP** típussal. A **Test** fail-closed (Node 18+, npx), mint a Hyperframes CLI. Telemetria ki (`DO_NOT_TRACK=1`). A `--no-sandbox` törölve van és tiltott.

Nincs második LLM-loop. A toolok a meglévő MCP-hídon jönnek: `mcp_playwright_*` (a11y-snapshot + elem-ref). Élő Chrome/Edge fülhöz: Playwright MCP Bridge extension, args: `--extension` (`--isolated` nélkül). Soha a napi Chrome-profil.

**Ne** telepítsd a Python `browser-use` MCP-t (`uvx browser-use --mcp`). LLM-kulcsot kér, és `retry_with_browser_use_agent`-et hoz. Az EYAS add/connectkor elutasítja.

<h2 id="chrome-devtools-mcp">Chrome DevTools MCP (coding / debug)</h2>

Opcionális Google `chrome-devtools-mcp` (Apache-2.0). Telepítés: **Beállítások → MCP szerverek → Katalógus → Chrome DevTools MCP**, aztán opcionálisan [Kapcsolatok](/docs/hu/admin/connections/) sor **Chrome DevTools MCP** típussal. A **Test** fail-closed (Node 18+, npx). Telemetria ki. A `--no-sandbox` tiltott. A `--autoConnect` tiltott (napi Chrome, Chrome 136+). A katalógus `--isolated`.

Ez **nem** az űrlap-sáv. Ne használd ennek a szervernek a `click` / `fill` / `fill_form` tooljait űrlapra — az a `browser_*`. A toolok a meglévő MCP-hídon jönnek: `mcp_chrome-devtools_*` (konzol, hálózat, Lighthouse).

**A WebMCP fail-closed.** A katalógus bekapcsolja: `--categoryExperimentalWebmcp=true`. A `list_webmcp_tools` / `execute_webmcp_tool` **csak akkor** jelenik meg, ha a sidecar hirdeti (Chrome 150+, `--enable-features=WebMCP`, és az oldal regisztrált `navigator.modelContext` toolokat). Ha hiányoznak, az EYAS nem találja ki őket. Üres lista = az oldal nem adott WebMCP toolt — ez nem indok a click/fillre itt.

## Mezők és vezérlők

<h2 id="status">Állapotkártya</h2>

| Vezérlő | Jelentés |
|---------|----------|
| Cím | **Browser Use** |
| Alcím | *Opcionális CLI-sidecarek tartós belépéshez.* |
| Sáv-hint | Headless `browser_*`; Agent Browser (ajánlott); Python CLI (régi); Kezek |
| Kártyák | **Agent Browser** (Ajánlott) és **Browser Use CLI (Python)** |
| Badge | **Kész** / **Nem kész** kártyánként |
| Üres | Orvosság a nem kész kártyán |
| Check sor | Címke + **OK** / **Hiányzik** / **Figyelmeztetés**, részlet, orvosság ha nem OK |
| Súgó **?** | Ezt a fejezetet nyitja |

Innen nem fut feladat. Az ügynök az `agent_browser_run`-t vagy a `browser_use_exec`-et hívja, ha a kártya kész.

## Kapcsolódó

- [Eszközök](/docs/hu/automation/tools/)
- [Kapcsolatok](/docs/hu/admin/connections/)
- [MCP szerverek](/docs/hu/ai/mcp/)
- [Dokumentumok](/docs/hu/knowledge/documents/)
- [Kezek](/docs/hu/admin/hands/)
- [Biztonság és adatvédelem](/docs/hu/admin/security-privacy/)
- [Konfiguráció](/docs/hu/deploy/configuration/) (`EYAS_BROWSER_USER_DATA_DIR`, `EYAS_AGENT_BROWSER_BIN`)
