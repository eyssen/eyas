---
title: OpenCode
description: Optional MIT coding-engine sidecar with a live web terminal in the conversation — isolated in an EYAS-owned folder.
---

**What this is for.** OpenCode is a terminal coding agent (MIT, [opencode.ai](https://opencode.ai)). EYAS does **not** import its private core or its AI SDKs. The official embed path is the local HTTP server (`opencode serve` on 127.0.0.1) plus a POSIX PTY streamed to xterm.js. Chat sends EYAS's recalled memory with the task, then `opencode_run` runs it. You can watch or take over in the conversation terminal. Every OpenCode process EYAS starts runs in an EYAS-owned folder, not in your everyday OpenCode setup.

**Route:** `/opencode`. Sidebar: **AI → OpenCode**. In a conversation, the terminal icon in the top bar.

## When to use it

- A coding task should run in OpenCode’s own loop, not as a pile of EYAS `write_file` calls.
- You want to **watch** the TUI or type into it.
- OpenCode should look things up in EYAS memory with the same `memory_search` / `memory_expand` every other model has — read-only, locked to the conversation's project.
- Delegated OpenCode tasks should use a particular model and reasoning variant (**Model and reasoning** card).

## Typical workflow

1. Open **OpenCode** (`/opencode`). If the card says **Not ready**, install the CLI (`curl -fsSL https://opencode.ai/install | bash` or `npm i -g opencode-ai`) or set `EYAS_OPENCODE_BIN`.
2. Sign OpenCode in **for EYAS** (the owner or an admin): open a conversation, click the terminal icon, and use `/connect` in the OpenCode terminal (see [Sign-in](#sign-in)).
3. Grant `opencode_status` / `opencode_run` on the agent that should delegate. It works on every provider: CLI models (Claude Code, Grok, Kimi) reach these tools over the EYAS bridge too. Optionally pick the model and reasoning variant on the **Model and reasoning** card.
4. Ask the colleague to call `opencode_run` in a conversation. EYAS sends the task with its recalled memory; OpenCode asks EYAS before each tool call; the answer and the diffs come back as the `opencode_run` result.

## Features

| Piece | What it does |
|-------|----------------|
| Doctor | Fail-closed: missing CLI or PTY returns a remedy, never a crash |
| `opencode_status` | Green. Ready / not ready + checks |
| `opencode_run` | Red, approval. Runs only inside a conversation. HTTP session against the sidecar; every tool call inside it asks the EYAS security gate |
| Web terminal | `@xterm/xterm` over `/api/v1/opencode/terminal/:id` (JWT). Owner and admins only (the manage right on OpenCode — see [Who can open a terminal](#who-can-open-a-terminal)). Disconnect kills the PTY |
| Memory plugin | `memory_search` / `memory_expand` inside OpenCode — the same names, descriptions and arguments as in every other EYAS run, read-only. Nothing in OpenCode can write EYAS memory |
| Isolation | Always on: an EYAS-owned folder, `<EYAS data dir>/cli-homes/opencode` — see below |

### Isolation {#isolation}

Every OpenCode process EYAS starts — the background server for chat tasks and the OpenCode terminal in a conversation — runs in `<EYAS data dir>/cli-homes/opencode`. There is no on/off setting: the earlier *isolated config* setting was removed, and a previously saved value is ignored.

| Area | What it means |
|------|---------------|
| **Owned by EYAS** | OpenCode's config (`config/opencode/opencode.json`, written by EYAS, which loads only the EYAS memory plugin, `config/opencode/eyas/eyas-memory.ts`), data (including the sign-in, `data/opencode/auth.json`, and OpenCode's sessions), state and cache (including the npm cache). OpenCode's `HOME` is that same folder. |
| **Not loaded** | Host `~/.claude/CLAUDE.md`, `~/.claude` skills and the rest of OpenCode's Claude Code compatibility; `~/.agents` and other external skills; the project's own `opencode.json`, `.opencode` folder, `AGENTS.md`, `CLAUDE.md` and `CONTEXT.md`; the everyday `~/.config/opencode` and `~/.local/share/opencode`; provider API keys from the server environment (such as `OPENAI_API_KEY`). |
| **Off** | Auto-update and session sharing. |
| **Shell** | OpenCode's own shell tool sees the EYAS folder as its home directory, so your `~/.gitconfig` and SSH keys are not visible to it. |

The background server listens on 127.0.0.1 and is password-protected with a fresh random password on each start.

**Where the memory plugin lives.** The EYAS memory plugin is written to `<EYAS data dir>/cli-homes/opencode/config/opencode/eyas/eyas-memory.ts`, next to the `node_modules` folder where OpenCode installs the plugin's `@opencode-ai/plugin` dependency, and the managed `opencode.json` points to it. Earlier versions wrote it to `…/cli-homes/opencode/plugins/eyas-memory.ts`, where OpenCode 1.18.29 could not resolve that import and skipped the plugin without an error — OpenCode's model then had no `memory_search` / `memory_expand`, and the plugin's shell hook never ran. EYAS deletes the old copy at the next start. As before, OpenCode's first start needs access to the npm registry to install the plugin's dependency; without it, OpenCode runs without the EYAS memory tools.

### Sign-in {#sign-in}

OpenCode signs in to its model providers itself; EYAS does not pass API keys into that process. The sign-in now lives in the EYAS folder, so **existing OpenCode users are signed out once**. The owner or an admin opens the OpenCode terminal of a conversation and uses `/connect` (see [Who can open a terminal](#who-can-open-a-terminal)). Do not use `opencode auth login` in a terminal of your own outside EYAS: it uses your normal environment and would sign in your everyday OpenCode, not the EYAS one.

### Who can open a terminal {#who-can-open-a-terminal}

In the OpenCode terminal you approve OpenCode's tool calls yourself — the EYAS security gate answers only the tasks EYAS starts — and OpenCode has no kernel sandbox, so the terminal is effectively a shell on the server, running as its operating-system user. That is why every terminal is for the owner and admins only, as the plain shell already was.

| Right on OpenCode | Roles by default | What it allows |
|-------------------|------------------|----------------|
| read | owner, admin, user | The OpenCode page (status, models, the saved settings); listing and closing your own terminals |
| create | owner, admin, agent | Headless use: the EYAS memory API that OpenCode's plugin calls, for a signed-in caller |
| manage | owner, admin | Saving the settings (**Model and reasoning**), and opening or connecting to a terminal — the OpenCode terminal and the plain shell |

- Without the manage right, `POST /api/v1/opencode/sessions` answers `403` for both kinds, and the terminal socket (`/api/v1/opencode/terminal/:id`) refuses to connect. The conversation top bar shows the terminal icon only to someone the server lets open terminals; if the server still refuses, the terminal panel says so.
- The right is checked with the user's current role and status every time the socket connects, and again for as long as it stays open: before every keystroke, resize or ping the terminal sends, every 15 seconds, and at once when the owner or an admin changes the person's role, suspends them or archives them. A terminal whose user has lost the right ends — the panel says why, the connection closes and the terminal's process is stopped — and it cannot be reconnected.
- Headless tasks are not affected: a colleague's `opencode_run` still runs in any user's conversation, because every tool call inside it asks the EYAS security gate ([Headless tasks ask EYAS](#headless-tasks-ask-eyas)).
- `GET /api/v1/opencode/access` (read right) returns `{terminal, settings}`: what the caller's own rights allow. The web page uses it to decide whether to show the terminal icon.

The rights of the built-in roles are fixed in EYAS; no setting gives the user role the manage right on OpenCode. To let someone use the terminal, give them the admin role (`PATCH /api/v1/users/<id>` with `{"role": "admin"}`, by the owner or an admin) — which also gives them every other admin right.

### Headless tasks ask EYAS {#headless-tasks-ask-eyas}

`opencode_run` tasks ask EYAS before every tool call: file reads and edits, listing and searching, shell commands, web fetch and search, access to folders outside the task folder, subagents, LSP and skills.

- EYAS answers each request with its [security gate](/docs/en/admin/security-privacy/), the same gate used for the other assistants. Allowed calls run once; denied calls are refused.
- If the gate wants a human decision, the call is refused and an approval is queued in [Approvals](/docs/en/agents/autonomy/).
- If the security gate is not available, every request is refused.
- EYAS answers only for the task it started, including subagents that task spawns. In the OpenCode terminal you approve tool calls yourself.
- After a task, EYAS deletes the OpenCode session. The answer and the diffs stay in the conversation as the `opencode_run` result.

**Task folder.** `opencode_run` runs only inside a conversation and refuses anywhere else. The folder you name must lie inside the conversation's folders — or, when it has none, inside its own workspace. Without one, EYAS uses the first conversation folder, else the conversation's own workspace — never the EYAS install folder. The OpenCode terminal opens only for a conversation of your own: anyone else's conversation is *not found*, for an admin too. It works in that conversation's saved folders, which EYAS reads itself — the page cannot name others — and falls back to the conversation workspace the same way. Its folders pass the same check as every other run's: a folder that is, sits inside or contains a protected place (EYAS's own data, another AI tool's storage, a notes vault or your home folder) is left out, the terminal opens in the next allowed folder or the conversation workspace, and a line at the top of the terminal names the folder that was left out. The same happens to a saved folder that is, sits inside or leads (through a link) into the workspace of another user's conversation — one saved before EYAS refused such folders, or inherited from a project; `opencode_run` leaves it out too, and refuses a task folder named there. The workspaces of your own other conversations stay usable.

**Not a sandbox for its own user.** The folders above only decide where the terminal starts. What runs in it runs as the operating-system user of the EYAS server: a command you approve in the OpenCode terminal (a shell command, or access to a folder outside the task folder) can reach anything that user can, other folders on the server included. That is why every terminal is for the owner and admins only — see [Who can open a terminal](#who-can-open-a-terminal). The plain shell of the sessions API (`POST /api/v1/opencode/sessions` with `kind: "shell"`; the web page opens only the OpenCode terminal) starts with the OpenCode terminal's environment and EYAS-owned home folder, not the server's own environment, so EYAS's master key and the providers' API keys are not in it.

### Memory sent with a task {#memory-sent-with-a-task}

`opencode_run` sends EYAS's recalled-memory block — the same block every other run gets — as the task's system text. It is sized like every other model's recall: `memory.index.budgetChars` (2,400 characters by default) is the size at a 100k-token context window, and the block grows with the window of the model OpenCode runs, up to 2.5× from 250k tokens (6,000 characters by default); below about 29k tokens it shrinks, and a very small window gets no recalled memory at all. EYAS reads the window from OpenCode's own model list — the model's input limit when OpenCode lists one, otherwise its context limit. When the window is unknown, the block is exactly `memory.index.budgetChars`: no model is picked on the **Model and reasoning** card (OpenCode then uses its own default model, which EYAS only learns from the reply); the chosen model is not in OpenCode's list or is listed without a limit (for example a custom provider model with no `limit` in its OpenCode config); or the list cannot be read (a warning is logged and the task still runs). The list is read at most once per task, only when a model is picked, and the request carries nothing of the task. Before this, OpenCode tasks always got exactly `memory.index.budgetChars`, so a large-window model got less memory than any other provider would give it. The block carries the same hint as in every other run: open a line with `memory_expand`, search further with `memory_search`. Only a task on an attached external server gets no hint (that server has no EYAS memory tools) and more of the best matches in full instead. See [Memory — How recall reaches the model](/docs/en/knowledge/memory/#how-recall-reaches-the-model).

**Masked before it leaves EYAS.** OpenCode always counts as a remote destination, because it can run any model. The task prompt and the recalled memory sent as the task's system text are masked by the privacy policy before anything reaches OpenCode, and the OpenCode session title comes from the masked prompt. Answers of `memory_search` / `memory_expand` inside OpenCode are masked too. If the privacy scan fails, the task fails with *privacy scan failed — the task was not sent to OpenCode*, and nothing reaches OpenCode. With the privacy policy (or the privacy module) off, nothing is masked. See [Security & privacy — Where masking applies](/docs/en/admin/security-privacy/#where-masking-applies).

### EYAS memory inside OpenCode {#eyas-memory-inside-opencode}

The EYAS memory plugin gives OpenCode's model exactly two tools, `memory_search` and `memory_expand`. They have the same names, descriptions and arguments as in every other EYAS run, they are read-only, and they share the same budget of 3 memory tool calls per turn. OpenCode has no tool that saves memory: what EYAS remembers is decided by EYAS, never by OpenCode's model.

What the tools may read depends on who calls them:

- **An `opencode_run` task.** EYAS binds the OpenCode session it creates to the conversation and user that started the task. The tools then read that conversation's project, its project type and global memory, and share the calling turn's 3-call budget.
- **Everywhere else** — an OpenCode terminal someone opens in the panel, any session EYAS did not create, or a signed-in caller who is not the session's user — the tools read global memory only.
- **An attached external server** (attach URL) has no EYAS memory access at all.

**The key never leaves OpenCode, and never sits in an environment.**

- Each OpenCode process EYAS starts — the background server and each OpenCode terminal — gets its own key on file descriptor 3, a connection only that process holds. The key is never in an environment, an argument list or a file. It dies when that process exits or restarts.
- The EYAS plugin reads the key once, when OpenCode loads it, keeps it in memory and closes descriptor 3, so nothing OpenCode starts later — including the model's shell commands — inherits it. The process environment only says that the key is on descriptor 3 (`EYAS_OPENCODE_KEY_FD=3`), and a shell the model runs sees that variable and `OPENCODE_SERVER_PASSWORD` as empty. `ps eww` or `/proc/<pid>/environ` of the OpenCode process shows no key.
- Every memory call carries a one-time proof for one OpenCode session instead of the key: a signature over the id of the session the tool runs in (set by OpenCode, not by the model), a random value and the time. EYAS accepts a proof once, for 2 minutes, and only while that OpenCode process runs, and serves the call only for the session the proof names. A session id the model passes as a tool argument is not sent to EYAS. A command the model runs holds no key, so it cannot make a memory call for any session.
- Where the key cannot be handed over on descriptor 3, OpenCode runs without the EYAS memory tools rather than getting a key any other way.

Every call runs through the same EYAS tool executor as any other model's memory call (security gate, permissions, drill budget, memory access log, privacy mask).

**Limits that remain.** OpenCode 1.18.29 reads its server password only from its environment. A shell the model runs sees it empty, but any process of the same OS user that can read another process's environment can read it and drive that OpenCode server's sessions through OpenCode's own API — for example to read another running task's messages — and that includes a command the model runs. The terminal's own server has a port and password of its own; it never gets the background server's password, so a command in the terminal does not inherit it. Running each task on a server of its own would not close this, because every process of the same OS user can read every other one's environment; only a separate OS user or a sandbox around OpenCode would. OpenCode has no kernel sandbox. A process allowed to read another process's memory (a debugger the OS permits, or root) can still reach the key.

**What EYAS records.** OpenCode's tool output inside an `opencode_run` task and the output of the terminal panel are recorded only when `memory.l0.captureToolResults` is on (default off), like every other tool's output: stored under the conversation's project, with trust *ingested*, and never recalled word for word. Terminal output is recorded only for a conversation that exists and belongs to the terminal's user. The final OpenCode answer and the diffs are not stored separately: they are the `opencode_run` result. See [Memory](/docs/en/knowledge/memory/).

**API (integrators).** `POST /api/v1/opencode/memory/search` and `POST /api/v1/opencode/memory/expand` take the arguments of `memory_search` / `memory_expand`. The plugin authenticates with a one-time session proof, `Authorization: Bearer eyas-ocs.<payload>.<signature>`, one per call, and the call acts for the session the proof names: a body naming another session in `sessionId` gets `403`; a forged, replayed or expired proof, a proof from a process that has stopped, or the raw key used as a bearer gets `401`. A signed-in caller with the create right on OpenCode (the agent role, and the owner and admins through the manage right; not the user role by default) can still call the routes and name a session in the body with `sessionId`; the call acts for that session only if the user is its bound user, otherwise it reads global memory only. A permission denial is `403`. The answers are masked like any memory tool result sent to a remote model. The old `/api/v1/opencode/memory/query` and `/api/v1/opencode/memory/save` are gone (`404`). Mutating calls to `/api/v1/opencode/*` made with a session cookie need the `X-Eyas-Request` header, like the other admin APIs (the web UI sends it).

### Model and reasoning {#model-and-reasoning}

The **Model and reasoning** card on the OpenCode page picks the model and reasoning variant for tasks the assistant delegates to OpenCode (`opencode_run`).

- **Model** lists OpenCode's own models: the providers and models the EYAS-owned OpenCode sidecar is signed in to, read from the running OpenCode server. **OpenCode default** (empty) sends no model, so OpenCode uses its own default, exactly as before.
- **Reasoning variant** lists the variants OpenCode offers for the chosen model — for example low/medium/high/xhigh/max for Claude Opus 5.5, none…max for GPT-5.6, minimal/high for some Gemini models. It is hidden when the model has no variants. **Model default** (empty) sends no variant. Standard names (none, minimal, low, medium, high, xhigh, max) show with EYAS's effort labels; provider-specific names show as OpenCode names them.
- Choosing another model resets the variant unless the new model offers the same one. **Save** stores the choice; it needs the manage right on OpenCode (owner and admin by default).
- The list needs the OpenCode server to be running. It starts with the first OpenCode terminal session or delegated task — the page does not start it. Until then the card says so and shows only the saved choice; reload the page once the server runs. If OpenCode cannot return its list, the card says *Could not read the model list from OpenCode.*
- At run time, a saved variant the model no longer offers, or one that cannot be checked because the list is unreadable, is dropped with a server-log warning; the task runs on the chosen model at its default reasoning. The task result names the model and variant that actually ran, as OpenCode reports them (field `effective`), including which model OpenCode picked when none was set.
- The OpenCode terminal is not affected: you still pick its model inside OpenCode.

Existing installs start at OpenCode's default model and variant; there is nothing to migrate.

**API (integrators).** `GET /api/v1/opencode/models` (read OpenCode) returns `{running, providers: [{id, name, models: [{id, name, variants: [{id, level}], contextWindow?}]}], defaults}`; `contextWindow` is the model's input limit (else its context limit) when OpenCode lists one. Provider credentials are never returned, and it never starts the server: with no server running it returns `running: false`; a failing list returns `502` with code `OPENCODE_MODELS_UNAVAILABLE`. `PUT /api/v1/opencode/settings` accepts `model` (`{providerID, modelID}` or null) and `variant` (string or null), and rejects any malformed body with `400` instead of ignoring it.

### Attaching to an external server {#attaching-to-an-external-server}

An attach URL to an external OpenCode server means **no isolation**: that server keeps its own config, sign-in and permission rules, and it gets no EYAS memory tools, no memory key and no capture. The OpenCode page shows **Server** and **Isolation** as *Warning* with this disclosure.

### The OpenCode page {#the-opencode-page}

The page shows translated check names, an **Isolation** line, a **Server** line, a sign-in hint and the **Model and reasoning** card.

### Upgrade {#upgrade}

- Earlier versions kept OpenCode files under `data/opencode` in the install folder. That folder is no longer used. Move anything you still need out of `data/opencode/workspaces` (earlier terminal sessions), then you can delete it.
- The OpenCode tools `eyas_query_memory` and `eyas_save_memory` are replaced by `memory_search` / `memory_expand`. A running OpenCode picks up the new plugin at its next start (an EYAS restart).
- `EYAS_OPENCODE_PLUGIN_TOKEN` no longer exists: EYAS neither reads nor sets it. Every OpenCode process gets its own key on file descriptor 3, and memory calls carry per-session proofs. An attached server no longer reaches EYAS memory.
- The memory plugin moved to `config/opencode/eyas/eyas-memory.ts` inside the EYAS-owned OpenCode folder; the old `plugins/eyas-memory.ts` is deleted at the next start. OpenCode's model now really has `memory_search` / `memory_expand` (verified on OpenCode 1.18.29).
- OpenCode tool and terminal output is no longer stored unless `memory.l0.captureToolResults` is on.
- Earlier versions let the user role open the OpenCode terminal (the create right on OpenCode). Now every terminal needs the manage right: the owner and admins keep it, and a user loses the terminal icon and gets `403`. Colleagues' `opencode_run` tasks in that user's conversations run as before. There is nothing to migrate — the built-in roles' rights are not stored — and no setting to restore the old default; give someone who needs the terminal the admin role (see [Who can open a terminal](#who-can-open-a-terminal)).

## Related

- [Tools](/docs/en/automation/tools/)
- [Memory](/docs/en/knowledge/memory/)
- [Conversations](/docs/en/daily/conversations/)
- [Security & privacy](/docs/en/admin/security-privacy/)
