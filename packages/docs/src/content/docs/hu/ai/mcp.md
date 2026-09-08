---
title: MCP-szerverek
description: Model Context Protocol — aktív szerverek, katalógus-telepítés és CLI tool-paritás.
---

**Mire való.** Az MCP (Model Context Protocol) az, ahogy az EYAS *külső* toolboxokat csatol: filesystem szerver, SaaS MCP, helyi `npx` process. Az itt felfedezett toolok ugyanúgy hozzárendelhetők, mint a beépítettek. Nem chat-[csatorna](/docs/hu/communication/channels/) és nem [Kapcsolat](/docs/hu/admin/connections/) leltársor — bár MCP-szervert Connectionként is felvehetsz health trackinghez.

**Útvonal:** `/mcp-settings`. Cím: **MCP-szerverek**. Alcím: *Az EYAS kiterjesztése külső eszközökkel, erőforrásokkal és promptokkal a Model Context Protocolon.* Fülek: **Aktív** · **Katalógus**.

## Mikor használd

- Olyan tool kell, amit az EYAS nem szállít.
- Egykattintásos katalógus-telepítés (API-kulcs) parancs gépelése helyett.
- Grok/Kimi CLI session ugyanazt a ToolExecutor felületet lássa.
- A szerver disconnected — **Teszt** / felfedezett toolszám.

## Tipikus folyamat

1. **MCP-szerverek** (`/mcp-settings`).
2. **Katalógus**. Kategória. **Használatra kész** / **Egykattintásos telepítés (API-kulcs kell)** / **Harmadik fél (kézi)**.
3. **Telepítés** (env kulcsok ha kéri) vagy **Kézi** → **MCP-szerver hozzáadása**.
4. **Aktív**: státusz **connected**, **Teszt**, felfedezett tools / resources / prompts.
5. Tool id-k az agent **Konfiguráció** fülén. Lásd [Eszközök](/docs/hu/automation/tools/).

## Funkciók

Fejléc: **N/M kapcsolódva**. Katalógus **licenc** badge (MIT-kompatibilis / copyleft / proprietary / unknown) — copyleft és proprietary **külön process**; az EYAS MIT marad.

MCP-szerver [Kapcsolat](/docs/hu/admin/connections/) sor is lehet (típus **MCP server**).

A Magnific, Higgsfield és fal a [Média](/docs/hu/ai/media/) alatt csatlakozik; az ágens öt `media_*` toolt használ a nyers vendor-MCP katalógus helyett.

A **Chrome DevTools MCP** (Google, Apache-2.0) **DevTools** katalógussor: `npx -y chrome-devtools-mcp@latest --isolated`, telemetria ki, `--categoryExperimentalWebmcp=true`. Csak coding/debug (konzol, hálózat, Lighthouse, WebMCP) — **nem** űrlapkitöltés. Toolok: `mcp_chrome-devtools_*`. A WebMCP toolok csak akkor, ha a sidecar hirdeti őket; különben nincsenek kitalálva. A `--autoConnect` és a napi Chrome-profil tiltott. Lásd [Browser Use](/docs/hu/automation/browser-use/#chrome-devtools-mcp).

## Mezők és vezérlők

<h2 id="active">Aktív szerverek</h2>

| Vezérlő | Jelentés |
|---------|----------|
| **disabled** | Létezik, de ki van kapcsolva |
| **Teszt** | Kapcsolat próba |
| **Csatlakozás** | OAuth-szerverek: böngészős bejelentkezés (`POST …/oauth/start` → átirányítás) |
| **A Beállítások → Média kezeli** | Akkor jelenik meg, ha `ownedBy` = `media` |
| **N eszköz / N erőforrás / N prompt** | Felfedezett katalógus |
| **Kapcsolat OK / Teszt sikertelen** | Utolsó teszt |
| Szerkesztés / törlés | Command, URL, API-kulcs |

<h2 id="add-server">Hozzáadás / szerkesztés</h2>

| Mező | Jelentés |
|------|----------|
| **Név** | Megjelenő id |
| **Szállítás** | **stdio (helyi folyamat)** · **HTTP (távoli)** · **SSE (Streamable HTTP)** — az `sse` transzport Streamable HTTP; **ne** toldj `/sse` utótagot. A session headert az EYAS kezeli. |
| **Parancs / Argumentumok** | stdio (`npx` + szóközzel elválasztott args) |
| **URL** | HTTP / SSE végpont (nincs `/sse` utótag) |
| **Hitelesítés** | **Nincs** · **Bearer** (API-kulcs) · **OAuth** (böngésző) |

<h2 id="catalog">Katalógus</h2>

| Vezérlő | Jelentés |
|---------|----------|
| Kategória | **Összes (N)** plusz kategóriák |
| **Telepítés / Telepítve** | Egykattintás vagy már megvan |
| **Telepítési útmutató** | Vendor lépések |
| Env dialógus | Kulcsok **Telepítés és csatlakozás** előtt |
| Licenc | *… licenc alatt. Külön process — az EYAS MIT marad.* |

Üres aktív: *Nincs beállított MCP-szerver* — **Katalógus böngészése**.

---

## CLI MCP tool-paritás (Grok / Kimi)

API és in-process providerek már osztoznak az EYAS tooljain. Host CLI:

| Provider | Viselkedés |
|----------|------------|
| **Claude Code** | In-process MCP |
| **Grok CLI / Kimi Code CLI** | Stdio MCP + loopback híd (`/api/v1/internal/cli-mcp/*`) rövid életű titkokkal; az ACP `session/new` `mcpServers`-t kap |

Eredmény: a kódoló CLI-k és a webes agent út **egységes tool-felületet** lát.

## Kapcsolódó

- [Eszközök](/docs/hu/automation/tools/)
- [Média](/docs/hu/ai/media/)
- [Agent konfiguráció](/docs/hu/agents/configure/)
- [Kapcsolatok](/docs/hu/admin/connections/)
- [Providerek](/docs/hu/ai/providers/)
