---
title: OpenCode
description: Opcionális MIT kódoló-motor sidecar élő webes terminállal a beszélgetésben.
---

**Mire való.** Az OpenCode terminálos kódoló agent (MIT, [opencode.ai](https://opencode.ai)). Az EYAS **nem** importálja a privát magját és az AI SDK-jait. A hivatalos beágyazás: helyi HTTP szerver (`opencode serve` 127.0.0.1-en) plusz POSIX PTY, xterm.js-re streamelve. A chat hidratálja az EYAS memóriát, majd az `opencode_run` elküldi a feladatot. A TUI-t nézheted, vagy átveheted.

**Útvonal:** `/opencode`. Oldalsáv: **AI → OpenCode**. Beszélgetésben a felső sáv terminál ikonja.

## Mikor használd

- A kódolást az OpenCode saját ciklusában akarod, nem EYAS `write_file` halomban.
- **Nézni** vagy gépelni szeretnél a TUI-ba.
- Az OpenCode olvassa az EYAS memóriát (`eyas_query_memory`), a diff/stdout pedig visszakerül L0-ba.

## Tipikus folyamat

1. Nyisd az **OpenCode** (`/opencode`) oldalt. Ha **Nem kész**: telepítsd a CLI-t (`curl -fsSL https://opencode.ai/install | bash` vagy `npm i -g opencode-ai`), vagy `EYAS_OPENCODE_BIN`.
2. Az ügynökön engedd az `opencode_status` / `opencode_run` toolokat.
3. Beszélgetésben kattints a terminál ikonra. A PTY a 127.0.0.1-es OpenCode-hoz csatlakozik.
4. Kérd a kollégát `opencode_run`-ra. Előbb memória, utána a stdout/diff bekerül az EYAS memóriába.

## Funkciók

| Elem | Mit csinál |
|------|------------|
| Doctor | Fail-closed: hiányzó CLI/PTY orvossággal, soha crash |
| `opencode_status` | Zöld. Kész / nem kész |
| `opencode_run` | Piros, jóváhagyás. HTTP session a sidecar ellen |
| Webes terminál | `@xterm/xterm` a `/api/v1/opencode/terminal/:id` JWT WS-en. Disconnect = PTY vége |
| Memória plugin | `eyas_query_memory` / `eyas_save_memory` localhoston |
| Config elválasztás | Alap: `data/opencode` (`XDG_CONFIG_HOME`), nem a napi `~/.config/opencode` |

Az OpenCode **saját provider-authját** használja (`opencode auth login` a TUI-ban). Az EYAS nem csempész API kulcsot abba a folyamatba.

## Kapcsolódó

- [Eszközök](/docs/hu/automation/tools/)
- [Memória](/docs/hu/knowledge/memory/)
- [Beszélgetések](/docs/hu/daily/conversations/)
