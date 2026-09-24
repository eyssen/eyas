---
title: Configuration
description: YAML defaults, local overlays, env precedence — after you pick an install path.
---

**What this is for.** Configuration is how you change listen address, modules, autonomy, memory capture, and agent verify commands without rebuilding. Edit `local.yaml` and `EYAS_*` env — not `config/default.yaml` if you can avoid it (upgrades overwrite shipped defaults). This chapter assumes you already chose [native](/docs/en/deploy/native/), [Docker](/docs/en/deploy/docker/), or [Kubernetes](/docs/en/deploy/kubernetes/).

## When to use it

- Change host/port, log level, or disable a module.
- Turn the **model-call capture** off (`memory.capture.enabled: false`) — default is on. This does **not** stop raw capture: `memory.l0.enabled` is a separate switch, also on by default.
- Turn **raw capture** off (`memory.l0.enabled: false`) if you do not want a verbatim second copy of every message kept on disk.
- Import extra skill or persona markdown folders (`skills.importRoots` / `agent.importRoots`) from ordinary folders — another assistant's own folders are skipped.
- Add `agent.verifyCommands` so a coding run is not “done” until tests pass.
- Point Search at several Odoo checkouts via `EYAS_ODOO_SOURCES_JSON`.
- Tell the model the right local time (`i18n.timezone`).
- Move the data directory (`EYAS_DATA_DIR`) or the conversation workspaces (`EYAS_WORKSPACES_DIR`), or pin the Claude Code, Grok or Kimi binary (`EYAS_CLAUDE_CODE_BIN`, `EYAS_GROK_BIN`, `EYAS_KIMI_BIN`).
- Protect further memory stores from models (`security.foreignMemoryPaths`), or require the kernel file sandbox for the CLIs' own tools (`security.cliSandbox: required`).
- Give CLI turns more or less time before they are stopped for silence (`model.cli.idleTimeoutMs`, `model.cli.toolTimeoutMs`).

## Typical workflow

1. Copy or create `local.yaml` next to the shipped defaults (or set `EYAS_HOME` so it lives with that instance).
2. Change only the keys you need. Validate: `eyas config validate`.
3. Restart (`eyas restart`). EYAS reads `default.yaml` and `local.yaml` once at startup; `eyas config reload` does **not** reload these two files. Files under `config/personality/` that say so (for example `privacy.yaml`) are picked up without a restart.
4. Confirm in **Settings** and with `eyas doctor`.

## Features

| File | Role |
|------|------|
| `config/default.yaml` | Shipped defaults |
| `local.yaml` | Overlay merge |
| `.env` | Optional secrets (never commit) |

Precedence: CLI flags → `EYAS_*` env → local YAML → default YAML.

Example keys in default.yaml: `server.host/port`, `database.path`, `log.level`, `i18n.timezone`, `modules.disabled`, `autonomy.identitySelfUpdate`, `security.foreignMemoryPaths`, `security.cliSandbox`, `model.cli.idleTimeoutMs`, `model.cli.toolTimeoutMs`, `memory.capture.enabled`, `memory.l0.enabled`.

### Time zone of the model's clock

```yaml
i18n:
  timezone: "America/New_York"   # IANA name; unset = the server's own zone
```

Every turn tells the model the current date and time. `i18n.timezone` sets the zone it uses: an IANA name such as `America/New_York`, `Europe/Berlin` or `UTC`. Unset (the default) means the server's own zone — the `TZ` environment variable, else the operating system setting. Docker containers usually run in UTC unless `TZ` is set.

Date and time always come from the same zone, and the time line names the zone and its UTC offset, for example `Current time: 23:30 (America/New_York, UTC-04:00)`. Earlier versions gave the time in one fixed Central European zone while the date came from UTC, so near midnight the two could disagree and every install outside that zone got a wrong local time.

An invalid value stops startup with a configuration error: *i18n.timezone: Unknown time zone — use an IANA name such as Europe/Berlin or UTC*. Set it in `local.yaml`; it applies after a restart.

### Data directory and vault

The data directory holds the database, the memory vault, agent files, backups and the rest of the instance's state. It is `<EYAS home>/data` by default, or the folder named by `EYAS_DATA_DIR`.

The memory vault always lives in `<data dir>/vault` and has no path setting of its own: to move it, move the data directory with `EYAS_DATA_DIR`. (The old `memory.vault.path` key in `config/personality/memory.yaml` never did anything and has been removed.)

Installs without `EYAS_DATA_DIR` — including the shipped Docker image and Helm chart, which mount the default `/app/data` — keep the vault exactly where it was. Earlier versions kept the vault in `<EYAS home>/data/vault` even when `EYAS_DATA_DIR` pointed elsewhere. On an install that sets `EYAS_DATA_DIR`, the first start after upgrading copies the old vault once, but only while the vault in the data directory holds no `.md` note and the old `<EYAS home>/data/vault` holds notes:

- It **copies, never moves**: the old folder stays untouched, file contents and modification times are kept, and nothing already in the new vault is overwritten. A log warning says the copy happened and that the old folder can be deleted once you have checked the copy.
- If the copy fails (for example, the data directory is not writable), the new vault stays empty, an error with the remedy is logged, and the copy is tried again at the next start.
- If both folders already hold notes, nothing is copied or merged. EYAS uses only `<data dir>/vault` and logs a warning on every start until the old folder is removed; copy any note you still need into the vault by hand.

`eyas doctor` shows the vault path on its **Vault** line and warns about an old vault beside a moved data directory — see [CLI](/docs/en/deploy/cli/#what-doctor-checks). The built-in [Backup](/docs/en/admin/backup/) archives `<EYAS home>/data`; if `EYAS_DATA_DIR` points elsewhere, include that folder in your own backups.

### Conversation workspaces

A conversation with no folders of its own works in its own **EYAS workspace** (see [Conversations — Folders](/docs/en/daily/conversations/#working-folders)). Workspaces are never placed inside a git checkout, because a CLI model (Claude Code, Grok, Kimi) started inside a git repository treats that repository as its project: it loads its instruction files, git status, permission rules and per-project memory. The workspaces location is, in order:

1. `EYAS_WORKSPACES_DIR`, if set. Use an absolute path.
2. Otherwise `<data dir>/workspaces`, when the data directory is not inside a git checkout (Docker and Kubernetes images, packaged installs — unchanged there).
3. Otherwise (a source install run from a git clone), a per-instance folder in your user's application-data directory:
   - macOS: `~/Library/Application Support/eyas/<instance>/workspaces`
   - Linux: `$XDG_DATA_HOME/eyas/<instance>/workspaces`, default `~/.local/share/eyas/<instance>/workspaces`
   - Windows: `%LOCALAPPDATA%\eyas\<instance>\workspaces`

`<instance>` is the EYAS home folder name plus a short hash of the data directory, so two instances on one machine (for example a dev and a live instance) never share workspaces.

**Upgrade (automatic, once).** When the location changed — a data directory inside a git checkout, or `EYAS_WORKSPACES_DIR` pointing elsewhere — the first start moves the auto-created workspaces from `<data dir>/workspaces` to the new location and repoints the conversations that used them. Folders you picked yourself are never moved or edited. If a folder with the same name already exists at the new location, the old one stays where it is, that conversation keeps using it, and a warning is logged. Restarting again changes nothing.

When the workspaces location is outside the data directory, the data backup does not include it; agent output files are still kept, because they are copied into Documents as conversation attachments. See [Backup](/docs/en/admin/backup/).

### Memory outside EYAS

```yaml
security:
  foreignMemoryPaths: []   # extra absolute paths models may neither read nor write
  cliSandbox: auto         # auto | required
```

EYAS reads and writes memory only through its own stores. `security.foreignMemoryPaths` is enforced: it is read at start, and the security gate refuses any model's reads and writes there. `security.cliSandbox` decides what happens when the kernel file sandbox for the CLIs' own tools is not available.

| Key | Default | Meaning |
|-----|---------|---------|
| `security.foreignMemoryPaths` | **`[]`** | Extra stores that models may neither read nor write, on top of the built-in list below. Absolute paths; a leading `~` is expanded; an empty string is rejected. A listed folder is protected with everything under it. Entries that are not absolute paths are ignored, with a warning in the log. Read at start — needs a restart. The same list also blocks MCP servers pointed there, conversation Folders inside it, and import roots inside it, and it is part of the kernel sandbox's deny list. **Security events → Memory outside EYAS** lists your entries and marks missing and ignored ones. |
| `security.cliSandbox` | **`auto`** | The kernel file sandbox (macOS Seatbelt, Linux bubblewrap) for Claude Code's shell and Grok CLI's own tools. `auto`: used where available; where not, the CLI still runs its tools and the chat shows a one-time notice per conversation, and a Claude Code command that asks to run outside the sandbox always waits for a person's approval. `required`: a CLI turn with tools is refused before the CLI starts when no sandbox is available (Kimi Code CLI has none, so its turns with tools are always refused), and Claude Code can never run a command outside it. There is no `off`; any other value is a configuration error and EYAS does not start. Tool-less background calls are never refused for lack of a sandbox. See [Providers — Kernel file sandbox](/docs/en/ai/providers/#kernel-file-sandbox). |

What the policy protects without any setting:

- the home-folder state of other assistants: `~/.claude` and `~/.claude.json` (Claude Code), `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium` (Windsurf), `~/.agents` and `~/.config/agents` (shared skills), `~/.copilot`;
- OpenCode's config, data and state folders (XDG locations and their `~/.config`, `~/.local/share` and `~/.local/state` fallbacks);
- Obsidian's own app settings, and every Obsidian vault, found by its `.obsidian` folder or by Obsidian's vault list (a vault created while EYAS runs is picked up within about 30 seconds);
- any folder named `ai-memory`, and any `memory` or `memories` folder under a tool dot-folder (`.claude`, `.grok`, `.codex`, `.gemini`, `.kimi`, `.cursor`, `.codeium`, `.windsurf`), including inside a project;
- the same dot-folders in other users' home folders.

Ordinary project files stay usable: a project's `.claude/settings.json` and `.claude/agents`, `CLAUDE.md`, `docs/MEMORY.md`.

EYAS's own data folder is private too. Models may use only the conversation workspaces — each conversation only its own, also when `EYAS_WORKSPACES_DIR` moves them outside the data folder — Studio projects (`data/studio`) and browser downloads (`data/browser/downloads`). The vault, database, keys, browser profile and the EYAS-owned CLI sign-in folders (`data/cli-homes`) are EYAS-only; the database file is protected even when `database.path` points outside the data folder. Symlinks do not get around this: a path is judged both as written and where it really leads.

**What is enforced.** Every path in every tool call the security gate sees is checked against this policy — EYAS tools on API providers, EYAS tools that Grok and Kimi call through the tool bridge, every tool call Claude Code asks permission for, Claude Code's own tools (through a check that runs before each of them), and every Grok/Kimi permission and file request. A protected path is refused at once, for reads as well as writes: no AI judge, no approval prompt, no grant can open it, and the refusal does not count toward the 3-denials lockout. It also holds with the security gate switched off. Each refusal is one row under **Security events**. See [Security & privacy — Memory outside EYAS](/docs/en/admin/security-privacy/#memory-outside-eyas).

The same policy also refuses saving such a folder as a conversation Folder or project working directory (see [Conversations — Folders](/docs/en/daily/conversations/#working-folders)), blocks MCP servers that point at it (see [MCP](/docs/en/ai/mcp/#memory-store-servers-are-blocked)), and skips import roots inside it (below). EYAS's own file tools refuse a symlink inside the working folder that points outside it — also when its target does not exist yet.

**The kernel layer.** Shell targets the command text does not show, and CLI reads that never ask EYAS, are covered by the kernel file sandbox where it runs (Claude Code's shell, Grok CLI's own tools). On Linux it needs bubblewrap (`bwrap`) — plus `socat` for Claude Code — and unprivileged user namespaces; the EYAS image does not include them (bubblewrap is LGPL; installing it is the operator's choice). `eyas doctor` shows the status on its **CLI sandbox** line. Kimi Code CLI has no kernel sandbox, so its own read, grep and glob tools remain covered only where EYAS sees them.

### CLI providers: homes and environment

EYAS starts the AI command-line tools with a short allowlisted environment, never with the server's full environment:

| CLI | Home | What it receives |
|-----|------|------------------|
| Claude Code | The host `HOME` (it shares only the sign-in) | `PATH`, locale and time zone, proxies and CA bundles, `HOME`, the Anthropic / Claude OAuth / Bedrock / Vertex sign-in variables, plus `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` and `DISABLE_AUTOUPDATER=1` |
| Grok CLI | `<data dir>/cli-homes/grok-cli` | `PATH`, locale and time zone, `TMPDIR`, `TERM`, `USER`, `LOGNAME`, `SHELL`, proxy and CA-bundle variables, and EYAS's isolation switches |
| Kimi Code CLI | `<data dir>/cli-homes/kimi-cli` | Same as Grok |
| OpenCode | `<data dir>/cli-homes/opencode` | See [OpenCode](/docs/en/automation/opencode/) |

Not passed on: other providers' API keys, EYAS secrets, an `XAI_API_KEY`, `CLAUDE_CONFIG_DIR`, and any other `CLAUDE_CODE_*`, `GROK_*`, `KIMI_*` or `XDG_*` setting of the server. The EYAS-owned homes under `data/cli-homes` hold the Grok and Kimi sign-ins for EYAS and are protected from every model. Claude Code and Grok do not update themselves while EYAS runs them; update the CLIs yourself. There are no settings for any of this. See [Providers](/docs/en/ai/providers/#claude-code-isolation).

### CLI turn timeouts {#cli-turn-timeouts}

```yaml
model:
  cli:
    idleTimeoutMs: 600000     # 10 min of silence while no tool is running
    toolTimeoutMs: 1200000    # 20 min of silence while a tool is running
```

Claude Code, Grok CLI and Kimi Code CLI turns are not stopped after a fixed time. A CLI turn is stopped only when the CLI goes quiet: `idleTimeoutMs` with no message while no tool is running, or `toolTimeoutMs` with no message while a tool is running. Any message from the CLI — streamed text, a tool starting or finishing, a permission request — starts the clock again, and there is no limit on the length of the whole turn; **Stop** still ends a turn at any time, and the stuck-run sweep still applies. A turn stopped for silence reports a timeout, which counts as retryable: the gateway may retry it once, or fail over, only when nothing was streamed yet, and a background run may be retried by the auto-retry scheduler.

Both values are in milliseconds and must be positive whole numbers; zero, negative, fractional or text values are rejected when the configuration is loaded. They are read at the start of each CLI turn from the running configuration, so a changed value applies after EYAS restarts. Keep `toolTimeoutMs` above 15 minutes so specialists started with `run_specialist` are not cut off.

### Durable memory capture

```yaml
memory:
  capture:
    enabled: true          # false = no post-turn vault notes
    minUserChars: 40
    maxPerConversation: 20
    maxInputChars: 4000
```

| Key | Default | Meaning |
|-----|---------|---------|
| `memory.capture.enabled` | **`true`** | After a qualifying run, a small model call on EYAS's background model decides whether anything in it is a lasting fact and writes up to two vault notes — never in the reply's critical path. It runs on every way EYAS runs a model: chat turns, background card runs, specialist and delegated runs (pipeline stages included), A2A tasks, team members and channel replies. `false` stops it on all of them; the raw record below is a separate switch. |
| `memory.capture.minUserChars` | **`40`** | A message shorter than this (in characters) never buys a model call. For a channel message or an A2A task only the sender's own words count, so a short "ok" over a channel buys no call. |
| `memory.capture.maxPerConversation` | **`20`** | Ceiling on capture model calls per conversation. A specialist or team member runs in its own sub-conversation, so it has its own ceiling; a channel conversation shares one ceiling across all its messages. |
| `memory.capture.maxInputChars` | **`4000`** | Your message and the reply are each clipped to this many characters before the capture model sees them. |

The call runs on an API provider or a CLI that can run isolated, never on one that cannot; with no eligible model, capture records a skip and makes no call. A run that answered nothing writes no capture row. **Cost:** every specialist, team member and channel reply whose instruction is at least `minUserChars` long can now spend one extra background model call. Who wrote the message decides how it is read: a delegated task, a team brief or a card's goal is a task instruction an agent may have written, and a channel message or an A2A task is a third party's words — which never create a note about who you are or how to work, and whose notes are stored at peer trust. The `memory_capture_runs` ledger gains an `entry_path` column (`interactive`, `background`, `delegation`, `pipeline`, `a2a`, `team`, `channel`; empty on rows written before this release), added automatically. There are no new settings. See [Memory — Capture is on by default](/docs/en/knowledge/memory/#capture-is-on-by-default) and [FAQ](/docs/en/reference/faq/).

### Raw capture

```yaml
memory:
  engine: legacy           # gates deterministic extraction only; recall is the same either way
  l0:
    enabled: true          # false = keep no raw copies at all
    captureToolResults: false
    captureThinking: false
    toolResultMaxBytes: 8192
    idleFlushMinutes: 30
    chunkTokens: 8000
    extractInLegacy: true
```

This is **not** the same switch as `memory.capture` above. Capture writes vault notes and costs a small model call; raw capture keeps a **verbatim second copy of every persisted message** — compressed and content-addressed — with **no model call and no API cost**. It is on by default.

| Key | Default | Meaning |
|-----|---------|---------|
| `memory.l0.enabled` | **`true`** | Master switch for raw capture. `false` records nothing and buffers nothing. |
| `memory.l0.extractInLegacy` | **`true`** | Run the deterministic pass (facts, summary, entities, topics, importance) after each flush while `engine` is still `legacy`. `false` keeps the raw text and derives nothing from it. |
| `memory.engine` | **`legacy`** | `legacy` or `v2`. It decides only whether the deterministic fact extraction runs: `v2` always extracts; `legacy` extracts while `memory.l0.extractInLegacy` is on (the default). Recall is always the layered recall, whichever value is set. |
| `memory.l0.chunkTokens` | **`8000`** | Size flush trigger: a conversation's buffer is written out once its estimated token count reaches this. |
| `memory.l0.idleFlushMinutes` | **`30`** | Time flush trigger: a once-a-minute sweep writes out any buffer idle this long. Closing the conversation and stopping EYAS also flush, so a clean restart loses nothing. |
| `memory.l0.captureToolResults` | **`false`** | Also capture the output of every tool an agent run calls, whatever the model: EYAS's own tools, EYAS tools a CLI calls over the bridge, the built-in tools of Claude Code, Grok and Kimi, the tools OpenCode runs inside an `opencode_run` task, and the OpenCode terminal panel's output. Only calls that ran are recorded (failed ones marked as errors); refused, skipped and approval-waiting calls, empty results and repeats are not, and neither are tool calls outside an agent run. **Read the next paragraph before turning it on.** |
| `memory.l0.captureThinking` | **`false`** | Keep the reasoning ("thinking") of any model that reports it, one entry per model call. Audit only: never turned into facts, never recalled. Stored verbatim and unredacted; a startup warning is printed while it is on. |
| `memory.l0.toolResultMaxBytes` | **`8192`** | Byte cap for the record of what one captured tool call returned — tool name, output, error flag, outcome and who ran it — clipped on a UTF-8 boundary with a visible truncation marker. The call's arguments do not count against it: they are kept beside the record, clipped to their first 2,048 characters. Tool results only; messages are not capped. |

`captureToolResults` and `captureThinking` are read at the start of every run from the running configuration; like the rest of `local.yaml`, a change applies after EYAS restarts.

**`captureToolResults` is off for a reason.** A captured tool result is the whole output, verbatim and unredacted, plus the first 2,048 characters of the call's arguments: `run_command` stdout, `read_file` contents, and a live `browser_totp` one-time code all land in the raw layer as plain text. Nothing redacts them and nothing encrypts them at rest — compression is not confidentiality. With the flag on, every start logs a warning saying so. Turn it on only where that is acceptable for this machine. A recorded call is never recalled or quoted into a prompt — not into the memory added to a turn, `memory_search`, `memory_expand`, the Memory page search or a conversation's summary. Only its output shapes the topics and names EYAS extracts from the conversation; the arguments are kept beside the record as provenance and are never indexed or extracted (see [Memory — Tool results are not recorded](/docs/en/knowledge/memory/#tool-results-are-not-recorded--and-why-to-leave-it-that-way)).

**No page shows these rows.** There is no page in the UI, no API endpoint and no `eyas memory` command for the raw record. The assistant reaches it only through recall — the summaries and facts derived from it, and raw rows opened with `memory_expand`. The **Recall engine** card on **Memory → Overview** shows whether the raw record, tool-output capture and reasoning capture are actually on.

**Raw capture grows and nothing prunes it.** There is no retention setting and no cleanup job in this release; a captured message costs roughly 5 KB on disk including indexes. If you would rather not pay that yet, set `memory.l0.enabled: false`. See [Memory](/docs/en/knowledge/memory/).

### Memory index and recall

| Key | Default | Meaning |
|-----|---------|---------|
| `memory.index.budgetChars` | **`2400`** | Characters of the whole recalled-memory block per turn (≈ 600 tokens), frame included: standing notes, notes retrieved for the message and full-text matches together. The size is meant for a model with a 100k-token context window and scales with the answering model's window (up to 2.5× from 250k tokens, less below about 29k tokens) — also for an OpenCode task (`opencode_run`), sized for the window OpenCode lists for the chosen model, or exactly this value when that window is unknown. Standing notes leave up to half of the block to what was retrieved. Notes that do not fit are summed up in a closing line (*… N more notes not shown*) and stay reachable through memory search. Raise it when your `user` and `feedback` notes no longer fit. Needs a restart. |
| `memory.recall.includeSecrets` | **`false`** | Whether notes, episodic rows and skills tagged `contains-secrets` (files the importer found credentials in, stored verbatim) — and the raw rows, facts and summaries derived from them — reach the model through recall, `memory_search` and `memory_expand`, and get search vectors. Off, they are stored and visible on the Memory page but never reach a prompt. Needs a restart. |

Recall — what it holds, how its query is built, and how it reaches every model — is described under [Memory — How recall reaches the model](/docs/en/knowledge/memory/#how-recall-reaches-the-model). The **Recall engine** card on **Memory → Overview** shows the budget and the `includeSecrets` switch EYAS is running with (see [Memory — Recall engine](/docs/en/knowledge/memory/#recall-engine)).

**Removed: `memory.relatedWork.*`.** The separate *Related prior work* block (`enabled`, `minQueryChars`, `maxHits`, `budgetChars`, `maxSnippetChars`) is gone; prior work now arrives inside the recalled-memory block, sized by `memory.index.budgetChars`. An existing `local.yaml` that still sets these keys keeps loading; they are ignored.

**Upgrade note.** Earlier versions shipped `memory.index.budgetChars: 8000` in `config/default.yaml`; the shipped value is now `2400`, matching the built-in default. To keep the old size, add this to `config/local.yaml` and restart:

```yaml
memory:
  index:
    budgetChars: 8000
```

### Database durability

From 0.8.23-beta every EYAS database connection runs `PRAGMA synchronous = NORMAL` instead of SQLite's default `FULL`. Paired with WAL, which EYAS has always used, this means:

- A **process** crash — EYAS killed, an unhandled error — loses nothing already committed.
- An **OS** crash or power loss at the instant of a commit can lose the last transaction.

That is the standard WAL trade and it applies to **all** modules, not only memory. If your instance holds work you cannot re-enter, treat [Backup](/docs/en/admin/backup/) as the durability story, not the commit mode.

### Extra skill and persona roots

```yaml
skills:
  importRoots: []          # extra markdown skill folders; empty = none
agent:
  importRoots: []          # extra persona markdown folders; empty = none
```

Shipped default is an empty list. Put paths in `local.yaml`, never in product source. These roots are read on **every start**, so they are a live source — for ordinary folders only (for example a team folder such as `/opt/team-skills`). Imported skills win over bundled copies of the same id. See [Skills](/docs/en/automation/skills/#import-roots).

**Roots EYAS skips.** A root that lies inside, or contains, another assistant's or note app's own folders is not scanned:

- the home folders of other tools: `~/.claude` (so `~/.claude/skills`, `~/.claude/agents` and `~/.claude/plugins/…` too), `~/.claude.json`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium`, `~/.copilot`, and the shared skill folders `~/.agents` and `~/.config/agents`;
- OpenCode's config, data and state folders;
- Obsidian's app settings and any Obsidian vault;
- folders listed in `security.foreignMemoryPaths`;
- EYAS's own CLI homes (`data/cli-homes`).

A root such as your whole home folder is skipped too, because it contains these folders. For each skipped root the server logs a warning at start, for example *skills.importRoots: /Users/me/.claude/skills is inside Claude Code (~/.claude) — not scanned; import these files once with Settings → System → Data portability → Import data*, and `eyas doctor` shows an **Import roots** warning naming the setting and the folder.

**What to do.** Skills and agents already imported from such a folder stay in EYAS; they just stop refreshing from it. To bring that content in, or refresh it, run a [Data import](/docs/en/admin/data-port/) of the folder once — it is copied into EYAS with its origin recorded — then remove the entry from `local.yaml`.

**Personas edited in EYAS are never overwritten** by their `agent.importRoots` file. A file creates its agent on first start and later updates it only while the agent's name, role, description, system prompt and tools are exactly as the last import left them; see [Agents — Configure](/docs/en/agents/configure/#imported-personas).

## Agent verify and environment variables

```yaml
agent:
  criticEnabled: true
  criticMaxRounds: 1
  # Deterministic checks after a background run (empty = disabled)
  verifyCommands:
    - name: bun-test
      command: bun
      args: [test]
  # verifyCwd: /absolute/path/to/repo   # default: process.cwd()
```

| Key | Meaning |
|-----|---------|
| `agent.verifyCommands` | List of `{ name, command, args?, timeoutMs? }` — **no shell**; failures re-open the agent with the error summary |
| `agent.verifyCwd` | Working directory for those commands |
| `EYAS_ODOO_SOURCE_PATHS` | Colon- or semicolon-separated local Odoo checkout roots for lightweight `odoo_search_*` and optional source bootstrap |
| `EYAS_ODOO_SOURCES_JSON` | Preferred multi-version bootstrap: JSON array of `{ "path", "label?", "version?", "edition?", "family?", "name?", "tags?" }` — creates idle **Search Sources** on start if those paths are not already registered |
| `EYAS_AUTO_FAILOVER` | Opt-in fill of empty routing-tier fallbacks from a second live provider |
| `EYAS_BROWSER_USER_DATA_DIR` | EYAS-owned Chromium profile for headless `browser_*` (default `data/browser/profile`). Daily Chrome/Edge profiles are rejected |
| `EYAS_AGENT_BROWSER_BIN` | Optional Vercel agent-browser CLI path. Empty = PATH. Set-but-missing is fail-closed (no PATH fallback). Profile: `data/browser/agent-browser/profile` |
| `EYAS_DATA_DIR` | Data directory (database, vault, agent files, …). Default `<EYAS home>/data`. See [Data directory and vault](#data-directory-and-vault) |
| `EYAS_WORKSPACES_DIR` | Absolute path for conversation workspaces. Default: see [Conversation workspaces](#conversation-workspaces) |
| `EYAS_CLAUDE_CODE_BIN` | Absolute path to the `claude` executable EYAS runs. Empty = `claude` on PATH, then the SDK-bundled copy (doctor warns). Set-but-invalid is fail-closed (no fallback). See [Providers — Claude Code runtime](/docs/en/ai/providers/#claude-code-runtime) |
| `EYAS_GROK_BIN` / `EYAS_KIMI_BIN` | Absolute path to the `grok` / `kimi` executable EYAS runs. Empty = the binary on PATH. Set-but-invalid is fail-closed: the provider is not registered. See [Providers — Grok CLI and Kimi Code CLI](/docs/en/ai/providers/#grok-cli-and-kimi-code-cli) |
| `LM_STUDIO_URL` | LM Studio server (default `http://localhost:1234`; a trailing slash is fine) |
| `EYAS_OPENCODE_PLUGIN_TOKEN` | Gone: EYAS neither reads nor sets it. Every OpenCode process EYAS starts (the background server and each OpenCode terminal) gets its own key on file descriptor 3, never in an environment, and each memory call carries a one-time per-session proof; the key is revoked when that process exits or restarts. OpenCode's environment only carries `EYAS_OPENCODE_KEY_FD=3`, which EYAS sets itself. See [OpenCode](/docs/en/automation/opencode/#eyas-memory-inside-opencode) |

### Multi-version Odoo example

```bash
export EYAS_ODOO_SOURCES_JSON='[
  {"path":"/path/to/odoo-18-community","label":"18c","version":"18","edition":"community","family":"odoo"},
  {"path":"/path/to/odoo-18-enterprise","label":"18e","version":"18","edition":"enterprise","family":"odoo"},
  {"path":"/path/to/custom-addons","label":"addons","version":"18","edition":"custom","family":"odoo"}
]'
```

Then open **Search Sources**, **Reindex** each source, and set **Default code sources** on each [Project](/docs/en/daily/projects/). Conversations pin sources on the **Sources** tab — see [Search](/docs/en/daily/search/#multi-version-pin-which-tree-may-the-agent-use).

Tool policy hooks run on every tool call (PreToolUse / PostToolUse) via the ToolExecutor — see [Tools](/docs/en/automation/tools/).

## Related

- [CLI](/docs/en/deploy/cli/)
- [Providers](/docs/en/ai/providers/)
- [Routing & budget](/docs/en/ai/routing-budget/)
- [Memory](/docs/en/knowledge/memory/)
