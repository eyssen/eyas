---
title: OpenCode
description: Optional MIT coding-engine sidecar with a live web terminal in the conversation.
---

**What this is for.** OpenCode is a terminal coding agent (MIT, [opencode.ai](https://opencode.ai)). EYAS does **not** import its private core or its AI SDKs. The official embed path is the local HTTP server (`opencode serve` on 127.0.0.1) plus a POSIX PTY streamed to xterm.js. Chat hydrates EYAS memory, then `opencode_run` sends the task. You can watch or take over in the conversation terminal.

**Route:** `/opencode`. Sidebar: **AI → OpenCode**. In a conversation, the terminal icon in the top bar.

## When to use it

- A coding task should run in OpenCode’s own loop, not as a pile of EYAS `write_file` calls.
- You want to **watch** the TUI or type into it.
- You need OpenCode to **read EYAS memory** (`eyas_query_memory`) and persist diffs/stdout back into L0.

## Typical workflow

1. Open **OpenCode** (`/opencode`). If the card says **Not ready**, install the CLI (`curl -fsSL https://opencode.ai/install | bash` or `npm i -g opencode-ai`) or set `EYAS_OPENCODE_BIN`.
2. Grant `opencode_status` / `opencode_run` on the agent that should delegate.
3. In a conversation, click the terminal icon. The PTY attaches to `opencode` on 127.0.0.1.
4. Ask the colleague to call `opencode_run`. Memory is injected first; stdout and diffs are captured into EYAS memory.

## Features

| Piece | What it does |
|-------|----------------|
| Doctor | Fail-closed: missing CLI or PTY returns a remedy, never a crash |
| `opencode_status` | Green. Ready / not ready + checks |
| `opencode_run` | Red, approval. HTTP session against the sidecar |
| Web terminal | `@xterm/xterm` over `/api/v1/opencode/terminal/:id` (JWT). Disconnect kills the PTY |
| Memory plugin | `eyas_query_memory` / `eyas_save_memory` inside OpenCode, calling EYAS over localhost |
| Config isolation | Default: `data/opencode` via `XDG_CONFIG_HOME`, not the daily `~/.config/opencode` |

OpenCode still uses **its own provider auth** (`opencode auth login` in the TUI). EYAS does not smuggle API keys into that process.

## Related

- [Tools](/docs/en/automation/tools/)
- [Memory](/docs/en/knowledge/memory/)
- [Conversations](/docs/en/daily/conversations/)
