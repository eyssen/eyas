---
title: Konfiguráció
description: YAML defaultok, local overlay, env precedencia — miután választottál telepítési utat.
---

**Mire való.** Itt változtatod a listen címet, modulokat, autonómiát, memória-capture-t és az agent verify parancsait újraépítés nélkül. `local.yaml` és `EYAS_*` — ne a `config/default.yaml`-t, ha kerülhető (upgrade felülírja). Feltételezi, hogy már választottál: [natív](/docs/hu/deploy/native/), [Docker](/docs/hu/deploy/docker/) vagy [Kubernetes](/docs/hu/deploy/kubernetes/).

## Mikor használd

- Host/port, log level, modul tiltása.
- Tartós memória-capture ki (`memory.capture.enabled: false`) — alap be.
- `agent.verifyCommands`, hogy a kódoló futás ne legyen „kész” teszt nélkül.
- Több Odoo checkout `EYAS_ODOO_SOURCES_JSON`-nal.

## Tipikus folyamat

1. `local.yaml` a szállított defaultok mellé (vagy `EYAS_HOME` alá).
2. Csak a kellő kulcsok. `eyas config validate`.
3. `eyas restart` vagy `eyas config reload`.
4. **Beállítások** + `eyas doctor`.

## Funkciók

| Fájl | Szerep |
|------|--------|
| `config/default.yaml` | Szállított defaultok |
| `local.yaml` | Overlay merge |
| `.env` | Opcionális titkok (soha ne commitold) |

Precedencia: CLI flag → `EYAS_*` env → local YAML → default YAML.

Példa kulcsok: `server.host/port`, `database.path`, `log.level`, `modules.disabled`, `autonomy.identitySelfUpdate`, `memory.capture.enabled`.

### Tartós memória-capture

```yaml
memory:
  capture:
    enabled: true          # false = nincs post-turn vault írás
    minUserChars: 40
    maxPerConversation: 20
```

Alap **be**. Kis modellhívás a minősülő forduló *után* — soha a válasz kritikus útján. Lásd [Memória](/docs/hu/knowledge/memory/) és [GYIK](/docs/hu/reference/faq/).

## Agent verify és kódolás (0.8.6+)

```yaml
agent:
  criticEnabled: true
  criticMaxRounds: 1
  verifyCommands:
    - name: bun-test
      command: bun
      args: [test]
```

| Kulcs | Jelentés |
|-------|----------|
| `agent.verifyCommands` | `{ name, command, args?, timeoutMs? }` — **nincs shell**; hiba újra megnyitja az agentet |
| `agent.verifyCwd` | Munkakönyvtár |
| `EYAS_ODOO_SOURCE_PATHS` | Kettőspont/pontosvesszővel elválasztott Odoo checkout gyökerek |
| `EYAS_ODOO_SOURCES_JSON` | Többverziós bootstrap JSON tömb |
| `EYAS_AUTO_FAILOVER` | Üres routing-tartalék kitöltése második élő providerrel |
| `EYAS_BROWSER_USER_DATA_DIR` | Headless `browser_*` EYAS-profil (alap: `data/browser/profile`). Napi Chrome/Edge profil tiltott |
| `EYAS_AGENT_BROWSER_BIN` | Opcionális Vercel agent-browser CLI. Üres = PATH. Beállított, de hiányzó path = fail-closed. Profil: `data/browser/agent-browser/profile` |

Ezután **Keresési források**, **Újraindexelés**, projekt **Alapértelmezett kódforrások**. Beszélgetés **Források** fül — [Keresés](/docs/hu/daily/search/#multi-version-pin-which-tree-may-the-agent-use).

Tool policy hookok minden híváson (PreToolUse / PostToolUse) — [Eszközök](/docs/hu/automation/tools/).

## Kapcsolódó

- [CLI](/docs/hu/deploy/cli/)
- [Providerek](/docs/hu/ai/providers/)
- [Routing és költségkeret](/docs/hu/ai/routing-budget/)
- [Memória](/docs/hu/knowledge/memory/)
