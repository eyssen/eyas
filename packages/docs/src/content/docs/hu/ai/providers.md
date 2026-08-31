---
title: Providerek
description: AI backendek — API, host CLI és lokális runtime. Az izoláció providerenként őszinte.
---

**Mire való.** A provider az LLM backend, amit ez a példány hívhat: felhő API, host CLI (Claude Code, Grok, Kimi) és lokális runtime (Ollama, LM Studio, vLLM). Bekapcsolod, kulcsot tárolsz, modelleket választasz, a routing ezt használja. Itt kapcsolható **vissza** a gépszintű Claude-konfig — alapból ki — és itt mondja a Grok/Kimi ACP, hogy nem izolálható.

**Útvonal:** `/providers`. Alcím: *AI routing, provider-beállítás és költségkeretek.* Fülek: **Routing szintek · Providerek · Költségkeret · AI-elemzés**.

## Mikor használd

- Setup után: provider **Be**, API-kulcs, modellek.
- Hoston van `claude` / `grok` / `kimi`, kulcs nélküli CLI provider kell.
- A beszélgetések a `~/.claude` memóriát olvasták — **Gépszintű Claude-konfig betöltése** maradjon **KI** (alap).
- Tudni akarod: Grok/Kimi ACP **mindig** tölti a saját gépkonfigját — nincs hamis kapcsoló.

## Tipikus folyamat

1. **Providerek** (`/providers`) → **Providerek** fül.
2. Kártya. **Be / Ki** a routinghoz. **Hitelesítés**: API-kulcs (titkosítva a [Titkok](/docs/hu/admin/secrets/)ban) vagy host CLI login.
3. Modellek engedélyezése. **Frissítés API-ról / CLI-ről**.
4. Claude Code CLI: **Gépszintű Claude-konfig betöltése** maradjon **KI**, hacsak nem akarod szándékosan a settings.json-t, CLAUDE.md-t, host skilleket és projekt `.mcp.json`-t.
5. Szintek és költés: [Routing és költségkeret](/docs/hu/ai/routing-budget/).

## Funkciók

| Elem | Jelentés |
|------|----------|
| **Be / Ki** | Routinghoz engedélyezés |
| **N/M modell engedélyezve** | Aktív modellek |
| **CLI nem található** | Hiányzó bináris |
| **Nincs API-kulcs** | Kulcs kell |
| **Hitelesítési hiba** | Újraadd a kulcsot/logint |

### Beépített providerek (a kártyákon)

Anthropic, OpenAI, OpenRouter, Gemini, Kimi (Moonshot API), Claude Code CLI, Claude Code SDK, Grok CLI (ACP — EYAS toolok [CLI MCP hídon](/docs/hu/ai/mcp/#cli-mcp-tool-parity-grok--kimi)), Kimi CLI (ACP), Ollama / LM Studio / vLLM, plusz a kártyákon listázott felhő API-k (xAI, Mistral, Groq, Together, DeepSeek, …).

### Gépszintű Claude-konfig — opt-in

Alapból az EYAS elszigeteli a beszélgetéseket a gép Claude-konfigjától — nincs settings.json, CLAUDE.md, host skill, projekt `.mcp.json` —, így az EYAS saját memóriája az egyetlen igazságforrás. Opt-in: `settingSources: ['user','project','local']`. Izolált / opted-out hívások `CLAUDE_CODE_DISABLE_AUTO_MEMORY` + `strictMcpConfig` — az üres `settingSources` **önmagában nem** állítja le a CLI cwd-kulcsos auto-memóriáját.

A panel kapcsolója visszakapcsol. A meglévő telepítések is átbillennek. Vállalati managed policy, ahol van, továbbra is érvényes — azt az EYAS-ból nem lehet kikapcsolni.

Ismert maradék: a flip előtt létrehozott CLI session a resume-nál visszaállítja a korábban betöltött kontextust, amíg a session el nem avul.

### Grok / Kimi ACP nem izolálható

Az ACP-nek nincs izolációs paramétere. A grok CLI-nek nincs suppression flagje (tölti a `~/.grok`-ot és demonstrálhatóan a `~/.claude`-ot is). A kimi baseline nincs ellenőrizve. A paneljeik ezt mondják, nem színlelnek. Ne várd, hogy csak az EYAS memóriáját lássák.

## Mezők és vezérlők

<h2 id="panel">Provider panel</h2>

| Szakasz | Jelentés |
|---------|----------|
| **● Aktív** | Szerkesztésre kiválasztva |
| **Hitelesítés** | API-kulcs vagy CLI |
| CLI auth | Nincs API-kulcs; `claude` / `grok` / `kimi` |
| API-kulcs | Titkosítva; **Kulcs mentve / Nincs kulcs / Kulcs törlése** |
| Modellista | Enable/disable; **Tools** / **Vision** / ctx |
| **Gépszintű Claude-konfig betöltése** | Csak Claude Code CLI — **BE / KI**, alap KI |
| Grok ACP hint | `grok agent stdio`; az EYAS nem tudja letiltani a host konfigot |
| Kimi ACP hint | `kimi acp`; az EYAS nem tudja letiltani vagy ellenőrizni |

## Kapcsolódó fülek

- [Routing és költségkeret](/docs/hu/ai/routing-budget/)
- **AI-elemzés** — független benchmark iframe

## Kapcsolódó

- [Setup varázsló — AI provider](/docs/hu/setup-wizard/)
- [Titkok](/docs/hu/admin/secrets/)
- [MCP](/docs/hu/ai/mcp/)
- [Memória](/docs/hu/knowledge/memory/)
