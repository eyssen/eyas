---
title: Security & privacy
description: Security gate, event stream, audit log, and the privacy policy — before tools run and after.
---

**What this is for.** Three operator surfaces sit behind this chapter. The **security gate** is the runtime policy that allows, denies, or escalates a tool call *before* it runs. **Security events** (`/security`) is the stream of those decisions. **Audit** (`/audit`) is the immutable action log (with optional rollback). **Privacy** (`/privacy`) is where you edit the privacy policy and test it: which personal data is masked when text leaves EYAS for a remote model, which new messages are refused, and the same mask that durable memory capture applies *before* a vault write.

## When to use it

- A tool call was denied and you need the checkpoint, risk, and reason.
- You want to confirm browser tools cannot hit private/metadata hosts (SSRF).
- You are about to enable autonomy and need to see what the gate will escalate.
- You must check whether PII is leaking into logs, vault notes, or outbound prompts.
- You want to know what a remote model receives when a prompt carries an e-mail address, an IBAN or a tax number.
- A model was refused a path with *Memory outside EYAS …* or *… is read and written only by EYAS*, and you want to know why — or see which places are off-limits on this server.
- You need to know how the AI command-line tools (Claude Code, Grok, Kimi, OpenCode) are kept away from the machine's own setup, how that is proven, and whether their kernel file sandbox is active.
- A message was refused with *Message not sent — privacy*, or you want to change which values are masked or refused.
- A model ran without EYAS's isolation and its memory should be hidden from every model (see [Quarantine a provider's memory](#quarantine-a-providers-memory)).

## Typical workflow

1. Open **Security** (`/security`). The **Memory outside EYAS** card is at the top (owners and admins). Filter the events by decision (**Allow / Deny / Escalate**), risk and checkpoint.
2. Open **Audit** (`/audit`) for who did what, module, result (**success / error / denied / rolled back**), cost. Rollback is a confirm action when offered.
3. Open **Privacy** (`/privacy`). Read the traffic counters, adjust the policy (action per type, custom patterns, local hosts) and **Save policy**, then **Test PII Scanner** with sample text — *As sent to a remote model* is what a remote model would receive.
4. Combine with [Autonomy](/docs/en/agents/autonomy/) (approvals) and [Secrets](/docs/en/admin/secrets/).
5. For SSH to other machines, see [Nodes](/docs/en/admin/nodes/) — destructive patterns need an explicit force flag.

## Features

| Area | Route / meaning |
|------|-----------------|
| **Security gate** | Runtime policy before dangerous tools |
| **Security events** | `/security` event stream, with the **Memory outside EYAS** card |
| **Audit** | `/audit` immutable action log |
| **Privacy** | `/privacy` traffic counters, privacy policy editor, scan tester |

### Browser SSRF protection {#browser-ssrf-protection}

Browser tools block requests to **private / metadata** hosts (cloud metadata, loopback, RFC1918, etc.) to reduce server-side request forgery risk. Prefer `browser_snapshot` (numbered interactive elements) over screenshots when agents only need structure. Indexes are invalid after navigation. The headless profile is EYAS-owned (`data/browser/profile`); the daily Chrome profile is rejected (Chrome 136+ blocks Default-profile CDP). `browser_evaluate` runs in the page, not in Node. `browser_totp` is **yellow**: it reads a seed from Secrets/Keychain and returns only a short-lived code (pass it to `browser_fill`). The action-cache JSON stores locators, never secrets or fill values. The optional [Browser Use](/docs/en/automation/browser-use/) sidecars (recommended: agent-browser under `data/browser/agent-browser/profile`; legacy Python CLI) never disable the Chromium sandbox automatically, never call `chat` / AI Gateway, and never attach to the daily Chrome profile.

### Read-only git without a click {#read-only-git-without-a-click}

`git_status` and `git_diff` are green. When the model instead sends `run_command` / `Bash` whose argv is unambiguously `git status` or `git diff` (no metacharacters, no `-C` / `--git-dir` / `--no-index`, no absolute path), the gate remaps the call to those tools and **allows it** — no approval row. `git commit`, `git add`, `ls`, and any command with metacharacters stay red or are refused. See [Tools](/docs/en/automation/tools/).

### Security judge {#security-judge}

Yellow and red tool calls get an AI check before they run. That check is one short isolated call on EYAS's background model — no tools, no conversation history, never a CLI session that loads the CLI's own memory or config. It uses the **Heartbeat** routing tier, then **Quick**, then the install default, then other eligible providers (any API provider, Claude Code, Grok CLI once its isolation check at provider load (start, reload, re-enable) or a turn's session start has passed, and Kimi Code CLI once a session has started on this host, which includes the model discovery at load while it is signed in for EYAS). A second model is tried only after a network, timeout, overload or rate-limit failure.

When no model is eligible (for example a Grok-only install whose isolation is not verified yet), the model budget is stopped, or every attempt fails, the call is **escalated to your approval** (an approval request in the queue) — never allowed. Before, a failed AI check blocked the call outright. If an agent's autonomy category is at level 3 (**Auto**), EYAS runs the call without asking, as it already did when no AI provider was configured at all. An answer the check cannot read still denies the call. On an install where Claude Code is the only model, each AI check starts one short isolated Claude Code process.

### Memory outside EYAS {#memory-outside-eyas}

The security gate refuses memory outside EYAS — **reads as well as writes** — for every model and every tool call it checks. Refused:

- the memory and state of other assistants: Claude Code (`~/.claude`, `~/.claude.json`), Grok, Codex, Gemini, Kimi, Cursor, Windsurf, OpenCode's folders, shared agent-skill folders, Copilot, the same dot-folders in other users' homes, any `ai-memory` folder and any memory folder under a tool dot-folder;
- Obsidian vaults (found by their `.obsidian` folder or Obsidian's vault list) and Obsidian's app settings;
- every path listed in `security.foreignMemoryPaths` (read at start; entries that are not absolute paths are ignored with a warning in the log);
- EYAS's own data folder — vault, database (also when `database.path` points elsewhere), keys, browser profile and the EYAS-owned CLI sign-in folders (`data/cli-homes`);
- another conversation's workspace, whenever the call's working folders are known.

Still allowed: the conversation's own workspace and folders, Studio projects (`data/studio`), browser downloads (`data/browser/downloads`), and ordinary project files such as `CLAUDE.md`, `AGENTS.md`, `.claude/settings.json`, `.claude/agents` and `docs/MEMORY.md`. A file whose text only *mentions* these paths is fine — the gate judges the path, not the content — and Grep's search pattern is never treated as a path.

**Where it applies:** EYAS tools run by EYAS's own agent loop (API providers); EYAS tools that Grok and Kimi call through the tool bridge (the bridge knows the turn's folders on the server, and a request can never name its own); every tool call Claude Code asks permission for; Claude Code's own built-in tools (Read, Write, Edit, Glob, Grep, Bash, NotebookEdit, WebFetch, …), which pass one check **before they run** — including reads Claude Code would otherwise allow on its own inside its working folder; every Grok/Kimi permission request (Grok asks for all its native tools, reads included); and every file Grok or Kimi read or write through EYAS. Which folders count as the conversation's is decided by EYAS — its Folders that still pass validation plus the folder the CLI was started in — never by where the CLI says it is. Headless OpenCode tasks are checked the same way, with the task's folders. Grok, Kimi and OpenCode run in their own EYAS-owned home, where `~` and `$HOME` point: a path written with them is judged both as that home and as your own home, so `~/../../vault` or `$HOME/../../sqlite` cannot reach EYAS's data or another CLI's sign-in folder.

**A folder is judged by what it contains.** A CLI such as Claude Code reads and searches inside its working folder without asking — the release check confirmed on the real binary that such reads never reach the approval step. So a conversation, project or project-type Folder is refused not only when it lies inside one of the places above, but also when it **contains** one: EYAS's own home, data folder, database or workspaces folder (for example the EYAS checkout that holds `data/`), another AI tool's storage or an EYAS CLI sign-in folder, a notes vault, an `ai-memory` folder or a `security.foreignMemoryPaths` entry (for example `~/Documents` holding a vault). Folders saved earlier that are now refused are left out of every run, with a notice in the chat. See [Conversations — Folders](/docs/en/daily/conversations/#working-folders). On Claude Code the memory-policy check also refuses the reads Claude Code allows on its own inside its working folder — a vault or EYAS's data reached by an absolute or relative path, a symbolic link, Grep, Glob, LS or a shell `cat`; this was proved on the real binary.

**Searches are judged by what they can reach.** A search by a CLI's own tools is refused not only when its folder is protected, but also when the folder it searches **contains** a protected place and its include globs may reach it: the CLI cannot be told to leave that place out, so the call is refused before it runs. This covers Claude Code's Grep, Glob and LS; Grok's grep and list_dir; OpenCode's grep, glob and list; and shell commands run through Claude Code's Bash, Grok's shell and EYAS's `run_command` that search recursively — `grep -r`/`-R`, `rg`, `ag`, `ack`, `find`, `fd`, `tree`, `du`, `ls -R`, recursive `cp`/`rsync`/`scp`/`zip`/`tar`/`ditto`, `locate`/`mdfind`, `git grep --no-index` — or use glob words such as `cat ~/.*/projects/*/memory/*.md`. The protected places are the ones listed above.

- **Refused**, for example: Grep in `~` with the glob `**/memory/*.md`; Glob in `~` for `**/MEMORY.md`; `grep -r token ~`; Grep in `~/Documents` when a vault is inside; a Grep whose path is the EYAS checkout or a folder above it, such as `grep -rn x ~/GitHub` when the checkout is inside (the checkout holds `data/`).
- **Still allowed:** a search whose folder or glob cannot reach the protected place — for example the checkout's `src` folder as the path, or the glob `src/**/*.ts` with the checkout as the path — and every search in an ordinary project folder. Writing a file through a here-document (`cat > a.ts <<'EOF'` … `EOF`) is not a search: its lines are data, never glob words or commands. Exclusion globs (`!…`) do not narrow a search. A glob without a slash (`*.md`) matches at any depth, as in ripgrep, so it reaches every sub-folder; shell glob words are anchored where they are written.
- **The same refusal.** It is the same hard, deterministic refusal as every other memory-path refusal: no AI judge, no approval, never opened by a grant, not counted toward the 3-denials lockout, and in force with the gate switched off. It writes one **Deny** row under Security events (checkpoint `deterministic`) and counts in the [Memory outside EYAS card](#memory-outside-eyas-card)'s refusal number.
- **How the places are found.** The places EYAS knows by name are always checked: other tools' stores, registered Obsidian vaults, `security.foreignMemoryPaths`, EYAS's data folder and database, the CLI homes and other conversations' workspaces. Vaults known only by their `.obsidian` folder, `ai-memory` folders, memory folders under tool dot-folders and symbolic links into protected places are found by a bounded look through the searched folder: the first 2,000 folders, 8 levels deep, never inside `node_modules` or `.git`/`.hg`/`.svn`. Beyond that bound only the named places are checked. Reading shell commands stays best effort: variables are not followed; `cd`, `eval`, `sh -c`, a shell that reads its script from a here-document, reserved words (`if`, `then`, `do`, `{`, `!`), redirections such as `2>/dev/null` and brace alternatives such as `~/{.,}` are. A search run by `xargs` or `parallel` takes its folders from input the command line does not show, so it counts as a search of `/`.
- **EYAS's own `grep` and `glob`** are never refused for such a folder: they leave protected folders out, and now also protected files — a database kept in the searched folder, or a file listed in `security.foreignMemoryPaths`, also when it is named directly.
- **Kimi Code CLI** (from the kimi-cli 1.52.0 source; not verified on a host): Kimi's own Grep and Glob never ask EYAS, so EYAS cannot refuse a Kimi search that starts above a protected place. Kimi's Glob stays inside its working folder, but its Grep accepts any folder, and Kimi has no kernel sandbox. Kimi's shell commands do ask, but the request does not carry the command in a form the path check can read, so the AI judge or a person decides.

**How it refuses:** at once and deterministically. There is no AI judge, no approval prompt, and no approval or grant can open it. The refusal does not count toward the 3-denials lockout, so a model retrying a forbidden path does not lock out other tools for 10 minutes. It also holds with the security gate switched off. Each refusal is one row under **Security events** — decision **Deny**, checkpoint `deterministic`, and a reason. The check fails closed: if it cannot answer, the call is refused. Only a one-shot background call with no tools at all runs without it.

**What the model is told:**

- *Memory outside EYAS (&lt;store&gt;) — use memory_search / memory_expand from EYAS*
- *EYAS data directory (&lt;part&gt;) is read and written only by EYAS*
- *EYAS-owned CLI home (cli-homes) is read and written only by EYAS*
- *Not this conversation's workspace (…) — work in this conversation's folders*
- *Search too broad [memory-path:search-scope:&lt;target&gt;]: the folder searched contains &lt;what&gt;, and this tool cannot leave it out — search a narrower folder that does not contain it* — for another tool's memory it adds *; for memory use memory_search / memory_expand from EYAS*. The target is `foreign-memory`, `eyas-data`, `provider-home` or `other-workspace`. The chat's **Denied** tool row turns it into a translated line, for example *Search too broad: the folder also holds another tool's memory, which only EYAS may read. The model was asked to search a narrower folder.* — or EYAS's own data, the CLI sign-ins EYAS keeps, or another conversation's workspace.

Grok CLI does not pass the reason on to its model: when EYAS refuses one of Grok's tool calls, Grok ends that answer, and the chat shows the refused tool row and nothing after it. Ask again without that step — after a *Search too broad* refusal, with a narrower folder. Claude Code carries on and receives the reason, so it can retry a search on a narrower folder by itself. See [Providers — Grok CLI and Kimi Code CLI](/docs/en/ai/providers/#grok-cli-and-kimi-code-cli).

**The kernel layer.** Shell commands can reach a path the command text does not show, and some CLI tools never ask EYAS at all. For those, Claude Code's shell and Grok CLI's own tools run inside the operating system's file sandbox (macOS Seatbelt, Linux bubblewrap), which blocks the same places at the kernel: other tools' memory, EYAS's private data and other conversations' workspaces. With `security.cliSandbox: auto` (the default) a CLI runs without it where none is available and the chat says so once; with `required` such turns are refused. In `auto`, a Claude Code command that asks to run outside the sandbox always waits for a person's approval — never the AI judge, never the autonomy ladder. Kimi Code CLI has no kernel sandbox, so its own read, grep and glob tools are still checked only where EYAS sees them. See [Providers — Kernel file sandbox](/docs/en/ai/providers/#kernel-file-sandbox). The [data import](/docs/en/admin/data-port/) is unaffected, because it reads other tools' stores itself and not through a model tool.

**Migration.** Agents that used to read `~/.claude/CLAUDE.md`, `~/.grok` memory, vault notes or files under `data/` directly are now refused (Security events shows it). Bring that knowledge into EYAS once with the data import. Agents or habits that searched the whole home or a parent folder with a CLI's own tools are refused too: point them at a sub-folder, or use EYAS's `grep`/`glob`, which leave protected places out. A Folder that contains a protected place — the EYAS checkout, a `~/Documents` holding a vault — is no longer accepted: choose a narrower folder, such as the project folder inside `~/Documents` or a separate clone of the repository. MCP servers that keep a memory outside EYAS are blocked too — see [MCP](/docs/en/ai/mcp/#memory-store-servers-are-blocked).

### The Memory outside EYAS card {#memory-outside-eyas-card}

The **Security events** page (`/security`) opens with a **Memory outside EYAS** card. Only owners and admins see it, because it shows absolute paths on the server; other roles get a load error and no paths. It shows:

- **Two counters for the last 24 hours.** *Memory-policy refusals* counts tool calls the memory policy refused on any channel — reading or writing another tool's memory, an Obsidian vault, EYAS's own data folder, database or CLI sign-ins, or another conversation's workspace, and searches refused as too broad because their folder contains one of these. *Commands that asked to leave the sandbox* counts shell commands that asked to run outside the kernel sandbox and were sent to a human for approval.
- **Other tools' memory on this server** — the known stores of other AI tools and note apps that exist here (for example `~/.claude`, `~/.grok`, `~/.codex`, OpenCode's folders, Obsidian's app settings), with their paths, and how many more known locations are protected as soon as they appear. One sentence explains what else is protected wherever it is: any folder holding an `.obsidian` folder (an Obsidian vault), folders named `ai-memory`, and memory folders inside `.claude`, `.grok`, `.codex` and similar tool folders.
- **Obsidian vaults found** — vaults from Obsidian's own vault list, plus vaults EYAS recognised by their `.obsidian` folder while checking tool calls. A vault that is not listed is still protected by its `.obsidian` folder.
- **Your additions (security.foreignMemoryPaths)** — the extra paths from the configuration. Paths that do not exist yet are marked *not on this server yet*; entries that are not absolute paths are marked *ignored*. To protect another folder or file, add its absolute path to `security.foreignMemoryPaths` in the configuration file and restart EYAS (the list is read at start).
- **EYAS's own data** — the data folder, the database and the CLI sign-ins (the EYAS-owned CLI homes). Only EYAS reads and writes these; models may use their conversation's workspace, Studio projects and browser downloads.
- **Conversation workspaces** — the workspaces root. Each conversation's model sees only its own workspace there.
- **Kernel file sandbox of the CLI providers** — the `security.cliSandbox` mode (`auto` or `required`) and, for each switched-on CLI provider (Claude Code, Grok CLI, Kimi Code CLI), whether its own tools run in the kernel sandbox: *active*, *unavailable* or *not supported*, with the reason (bubblewrap not installed, socat missing — needed by Claude Code —, user namespaces disabled, unsupported operating system, or the CLI offers none). With `required` and no sandbox, the card says that turns with tools on that CLI are refused. With *unavailable* or *not supported* in `auto`, the CLI's own tools run without the sandbox and EYAS still checks every tool call it sees. With `auto` and an active Claude Code sandbox, a Claude Code command that asks to run outside the sandbox always waits for a human's approval.

**API.** `GET /api/v1/security/memory-policy` (read `SecurityEvent`). There are no new settings or environment variables.

### AI command-line tools run isolated {#ai-command-line-tools-run-isolated}

- **Claude Code** always runs isolated: no host `settings.json`, `CLAUDE.md`, skills, MCP servers or auto-memory, no transcripts on the host, an allowlisted environment, and a start-up check that stops a run if anything else was loaded. See [Providers — Claude Code isolation](/docs/en/ai/providers/#claude-code-isolation).
- **Grok CLI and Kimi Code CLI** run in EYAS-owned homes (`data/cli-homes/…`, which hold their EYAS sign-ins), ask EYAS before their native tools, and run only after EYAS has checked that they are isolated — a turn that fails the check stops, and is never moved to another model. See [Providers — Grok CLI and Kimi Code CLI](/docs/en/ai/providers/#grok-cli-and-kimi-code-cli).
- **OpenCode**, the optional sidecar, runs in an EYAS-owned folder (`cli-homes/opencode`, which holds its sign-in) and loads no host assistant instructions, skills or project config. Headless OpenCode tasks ask the EYAS security gate before each tool call. OpenCode reads EYAS memory only through the read-only `memory_search` / `memory_expand`; it has no tool that writes memory. Each OpenCode process EYAS starts gets its own key on file descriptor 3 — never in an environment, an argument list or a file — and the key dies with that process. The key itself never leaves OpenCode: each memory call carries a one-time proof for the one OpenCode session the tool runs in, so a command the model runs, or another process, cannot read another session's memory. Limits that remain: OpenCode reads its server password only from its environment, so a process of the same OS user that can read another process's environment can drive that OpenCode server's sessions through OpenCode's own API; OpenCode has no kernel sandbox; and a process allowed to read another process's memory can reach the key. An attach URL to an external OpenCode server is not isolated and has no EYAS memory access. See [OpenCode](/docs/en/automation/opencode/#eyas-memory-inside-opencode).
- **Kernel file sandbox.** Claude Code's shell commands and Grok CLI's own tools run inside the operating system's file sandbox where one is available (`security.cliSandbox`); Kimi Code CLI has none. See [Providers — Kernel file sandbox](/docs/en/ai/providers/#kernel-file-sandbox).

### How isolation is proven {#how-isolation-is-proven}

Every CLI run is checked when it starts (see above). On top of that, every CLI version EYAS supports is proven before release by a **release check**, `bun run test:live-cli`, which developers and release owners run. It starts the real Claude Code and Grok CLI (and Kimi Code CLI where it is installed) through EYAS's own providers, in a throwaway home full of traps: host settings that allow everything, hooks and MCP servers that would leave a mark if they ran, `CLAUDE.md`, `AGENTS.md`, skills, an Obsidian-style vault, and a project folder with its own config. The free part sends every model request to a fake model on the local machine, so it needs no account and spends no tokens. The paid part runs real model turns on the owner's own sign-in and is approved for each run.

The check asserts that:

- no host or project config, instruction file, hook or MCP server is loaded;
- every file Grok reads is asked through EYAS, and the vault stays out;
- EYAS's memory policy refuses the vault and EYAS's own data folder;
- the operating system's file sandbox stops a hidden vault read in Claude Code's shell;
- a normal workspace read still works;
- no session store is left in EYAS's CLI homes;
- Grok and Kimi change nothing in the host home;
- Claude Code writes to the host only a short, versioned list of bookkeeping files, never conversation content;
- Claude Code's temporary folder, where the output of background shell commands goes, is the run's own folder in EYAS, gone when the run ends — nothing is left in the host's `/tmp/claude-<uid>`.

That list: `~/.claude.json` limited to start-up and bookkeeping keys (first start, migrations, feature-flag cache, plugin usage counters), plus its backup copies and its lock folder; empty session and marker folders under `~/.claude` and `~/.config/anthropic`; shell snapshots without conversation content; npm's own log of `npm root --global` in `~/.npm/_logs`; Bun's cache when the `node` on PATH is Bun; and, on hosts without a keychain, the sign-in refresh file. Never a transcript, todo list, file history, plan or prompt history.

**Memory test.** On Claude Code and Grok CLI the check also runs the memory policy through the real security gate. A folder registered only in `security.foreignMemoryPaths` is refused both to the model's own file read and to a shell `cat`, and a write into EYAS's vault is refused. Each refusal is exactly one **Deny** row in Security events from the memory policy (checkpoint `deterministic`, never a rate-limit lockout) and one refused tool row. A workspace read after those refusals still works, and nothing from the refused folder reaches the model. Two more free cases cover searches: Claude Code's Grep, Glob and `grep -r`, and Grok's grep and list_dir, rooted at the trap-filled home, are each refused by the memory policy through the real gate — audited, with a refused tool row — while a search of the project folder still works. A third shows that Claude Code reads a file in its working folder without asking EYAS's permission check, and that the memory-policy check refuses such a read when it lands in a vault.

**Versions proven:** Claude Code 2.1.281 and Grok CLI 1.0.41, free part only. Kimi Code CLI is not proven yet and has no memory test. Two findings of the check are built into the start-up checks:

- Claude Code 2.1.281 lists two plugins compiled into the binary, `agents-md` and `telemetry`. They are accepted only as `<name>@builtin`, because the check proved them harmless under EYAS's isolation: no `AGENTS.md` from the working folder or a subfolder reaches the model. Any other plugin, including a new builtin a later Claude Code adds, still stops the run.
- Grok CLI 1.0.41 writes a cache of vendor-managed settings (`managed_config.toml`) into its EYAS home, empty for a normal account. An empty one is accepted; one that holds any setting still stops the turn.

**`eyas doctor`** shows one line per CLI provider: *CLI isolation (Claude Code)*, *CLI isolation (Grok CLI)* and *CLI isolation (Kimi Code CLI)*. Each names the binary EYAS runs — how it was found (`EYAS_CLAUDE_CODE_BIN` / `EYAS_GROK_BIN` / `EYAS_KIMI_BIN`, on PATH, or SDK-bundled), its path and version — and whether the release check has proven that version. A different version, a binary that reports no version, or a CLI that was never proven is a warning, not a stop: EYAS still checks every session at start. A CLI that is not installed is fine; an invalid `EYAS_*_BIN` is a failure. For Grok and Kimi the line also checks their EYAS home, `<data dir>/cli-homes/<provider>`: not created yet is fine; a symbolic link or not a folder is a failure (EYAS refuses to run the CLI; remove it, the next run recreates it); a folder other users can read is a warning, because it holds the CLI's sign-in (`chmod 700 <folder>`); a file EYAS manages there that changed since EYAS wrote it is a warning — EYAS rewrites those files before the next run, so a change between runs means something else edits that folder. Doctor is read-only: it only runs `--version`. See [CLI](/docs/en/deploy/cli/).

### Quarantine a provider's memory {#quarantine-a-providers-memory}

If a model — typically a CLI such as Grok CLI, Kimi CLI or Claude Code — ran without EYAS's isolation, it may have answered from memory outside EYAS, and its answers were saved into EYAS memory like any other turn. The owner can hide from every model what one provider wrote — its replies and tool output, the facts and summaries derived from them, and the capture notes of its conversations — and release it later. Nothing is deleted, and the owner's own messages are never touched. The card is on **Memory → Overview**; see [Memory — Quarantine a provider's memory](/docs/en/knowledge/memory/#quarantine-a-providers-memory). Every apply and release is written to the audit log (`memory.quarantine.apply` / `memory.quarantine.release`).

### Remote node SSH {#remote-node-ssh}

Remote-node **SSH invoke** (via Nodes) runs guarded commands; **destructive** command patterns require an explicit force flag. Non-SSH node types may return not-implemented for invoke.

### Memory at rest {#memory-at-rest}

Durable notes are masked by the privacy module **before they touch disk**, not at read time — a read-time redaction would leave raw text in the file and in the FTS index. It is the same function and the same rules as for outgoing model traffic: dates are kept, and mask- and block-class values are replaced, so an IBAN in a note is stored as `[IBAN]` (earlier versions replaced only e-mail addresses and phone numbers in notes). The raw conversation record, conversation summaries and facts stay unmasked inside EYAS and are masked only when they leave it. Capture itself is switched with `memory.capture.enabled` in `config/default.yaml` (default **on**). See [Memory](/docs/en/knowledge/memory/) and [FAQ](/docs/en/reference/faq/).

**Model-written notes pass the instruction filter.** Vault notes a model writes — the per-turn memory capture, nightly consolidation summaries and team-session summaries — pass the same filter EYAS already uses for facts and summaries. Text that looks like an instruction to the assistant (*ignore previous instructions*, *from now on you are…*, fake `<system>` tags, *delete all memory*, in English, Hungarian, German, Spanish and French) is never written. Refusals appear in the server log with the detector's name, never with the text. Every such note also carries an `origin` in its frontmatter and is remembered as model-written, never as your own words. See [Memory — Why some sentences are refused](/docs/en/knowledge/memory/#why-some-sentences-are-refused).

## Privacy policy {#privacy-policy}

EYAS stores its data raw and **masks personal data when text leaves EYAS for a remote model**. One deterministic function does the masking, for prompts, memory tool results, embeddings and vault notes alike.

### How detection works {#how-detection-works}

Detection is rule-based and deterministic: the same text always gives the same result, and nothing is ever sent to a model to detect personal data. It is **line-bounded** — a value split across two lines is not detected, and a phone word or tax word only counts on the same line as the number.

Never treated as personal data: calendar dates in any common layout (`2026-09-08`, `2026.09.30.`, `2026. 09. 30.`, `22.09.2026`, `09/22/2026`), clock times, ISO timestamps, IP addresses, software versions (`1.0.40`, `0.8.29-beta`), money amounts (decimals, or numbers next to a currency such as HUF/Ft/EUR/€/$), and record, ticket, build, commit and timestamp ids, UUIDs, ULIDs and hashes. The prompt's *Current date* line reaches every model intact.

### What is detected {#what-is-detected}

| Type | How it is recognised and validated |
|------|-----------------------------------|
| `email` | Standard address shape |
| `phone` | An international number starting with `+` (8–15 digits); a number with an area code in parentheses; the Hungarian national format (06/36 + area code + 6–7 digits); or any 7–15 digit number with a phone word within 40 characters before it on the same line. Phone words match as whole words only: phone, tel, mobile, cell, call, fax, WhatsApp, telefon, mobil, hívj, Handy, Telefonnummer, teléfono, móvil, téléphone, Tél., portable, and similar. Loosely written numbers without a `+`, a national format or a phone word are deliberately not detected. |
| `iban` | IBANs of every country, compact or grouped with spaces, validated with the official mod-97 checksum and the country's exact length (earlier versions detected only Hungarian IBANs) |
| `bank_account` | Hungarian giro account numbers, 8-8 or 8-8-8 digits (space or dash), validated with the 9-7-3-1 block checksum |
| `credit_card` | 13–19 digits with a card-network prefix, validated with Luhn |
| `ssn` | US social security number `AAA-GG-SSSS` with a valid area, group and serial |
| `personal_id` | Hungarian personal ID card number (6 digits + 2 capital letters) as a standalone token |
| `tax_number` | Hungarian tax number (adószám, `12345676-2-42`) with a valid check digit, VAT code 1–5 and a real county code; Hungarian EU VAT number (`HU12345676`); and the Hungarian personal tax ID (adóazonosító jel, 10 digits starting with 8) only with a valid check digit **and** a tax-ID word before it (adóazonosító, adószám, tax ID, TIN, Steuer-ID, NIF, numéro fiscal, …). Words match as whole words, so `tin` in *routine* or `tax` in *syntax* triggers nothing, and a random 10-digit number next to the word *tax* is not a tax number. |
| `taj_number` | Hungarian TAJ number, validated with its check digit |

Names and postal addresses are not detected. Use [custom patterns](#custom-patterns) for them and for any other organisation-specific identifier.

There is no model-based scanner. The earlier NER scanner, which silently sent prompt text to a local Ollama, has been removed; if `ner` is still listed under `privacy.scanners` in `config/personality/privacy.yaml`, it is ignored and a warning is logged.

### Actions {#actions}

Each detected type has one action:

| Action | Effect |
|--------|--------|
| `off` | Ignored |
| `warn` | Counted and logged; the text is left as it is |
| `mask` | Replaced with a placeholder such as `[EMAIL]` or `[IBAN]` when the text leaves EYAS for a remote model |
| `block` | Masked the same way on the way out; and a **new** chat or channel message carrying it is refused before it is stored when it would go to a remote model (see [Refused messages](#refused-messages)) |

Built-in defaults: `email` and `phone` are **mask**; `iban`, `bank_account`, `tax_number`, `personal_id`, `credit_card` and `ssn` are **block**; `taj_number` is **warn**.

**Masking never stops a model call.** A block-class value anywhere in a prompt — for example an IBAN in a memory note — is masked and the turn continues; memory capture does not fail on such turns either. `block` has exactly one further effect: it refuses a **new** message you send.

### Refused messages {#refused-messages}

Only a **new** message a user sends — in chat, in a God Mode conversation, or through a channel (Telegram, Slack, Discord, e-mail, WhatsApp, Signal, …) — can be refused. Everything else EYAS sends to a model (history, memory, tool results, attachments' extracted text, embeddings) is never refused; it is masked on the way out.

A message is refused when it contains a block-class value **and** it would go to a remote model. Local means the model's endpoint host is loopback (`localhost`, `127.x`, `::1`) or listed in the policy's local hosts; CLI providers (Claude Code, Grok CLI, Kimi CLI) and unknown endpoints count as remote. The destination is the model the message will run on (a one-turn model override, the conversation's fixed model, or its colleague's model). A conversation set to Auto always counts as remote, because its model is chosen per message after the check — unless Auto-routing is switched off globally, when its stored model is judged. In God Mode every roster participant is judged; if any is remote, or the roster is empty, the message is refused. With the policy or the privacy module off, nothing is refused.

- **In chat,** the refused message is not stored: no transcript entry, no rename, no memory, no model call, no God Mode race. A card above the composer, **Message not sent — privacy**, lists the types (never the values) and offers **Send with these values masked**, **Edit message** and **Discard**. See [Conversations — Refused messages](/docs/en/daily/conversations/#refused-messages-privacy).
- **On a channel,** the sender gets an automatic reply in the language they wrote in (English, Hungarian, German, Spanish, French or Klingon; English if unclear), naming the types, never the values, and asking them to resend without those values. No conversation, message or agent run is created; the inbound event shows status **skipped** with error `privacy_blocked`, and only its masked text is kept. See [Channels](/docs/en/communication/channels/#refused-messages).
- Messages already stored before a policy change are not refused later.

Every refusal writes the audit action `privacy.inbound_refused`, and every *send masked* writes `privacy.inbound_masked`; both record the types, the conversation (chat) or inbound event id (channels) and the user — never a value.

### Custom patterns {#custom-patterns}

Each custom pattern has a `name`, a `regex`, a lower-case `type` slug that becomes the placeholder (for example `[INTERNAL_PROJECT]`), and its own `action`. Add them on the [Privacy page](#privacy) (up to 50); patterns sharing a type use the first pattern's action. Patterns are line-bounded: they never match across a line break, and `^` / `$` anchor to the start and end of a line. A pattern that is unsafe (catastrophic backtracking) or does not compile is skipped and reported in the server log. A pattern that can match an empty string no longer hangs the scanner.

### Local hosts: who receives text unmasked {#local-hosts-who-receives-text-unmasked}

Text is sent unmasked only when the model endpoint is on this machine: a loopback endpoint (`localhost`, `127.x.x.x`, `::1`) or a host listed in the policy's **local hosts** (up to 32 hostnames or IP addresses, no scheme or port). This is decided by the endpoint host the provider sends to, never by the provider's name:

- A local Ollama or LM Studio is exempt; a **remote `OLLAMA_HOST` is masked**. If you relied on the old Ollama exemption for a remote Ollama host, add that host to the local hosts.
- LAN hosts that are not listed, cloud APIs, unknown endpoints and every CLI provider (Claude Code, Grok CLI, Kimi CLI) count as remote — EYAS cannot see where a CLI sends its traffic.
- The old `auto_local` action (reroute to a local Ollama) is gone; a legacy `auto_local` rule is treated as `mask`, with a warning in the log.

### Stored completions (OpenAI) {#stored-completions-openai}

Requests to the built-in **OpenAI** provider opt out of OpenAI's *stored completions* explicitly, on chat, streaming and tool calls alike. OpenAI therefore does not keep EYAS conversations for its distillation or evaluation features, even if *store completions* is turned on in your OpenAI account or project. Nothing needs to be configured. This also holds when `OPENAI_BASE_URL` redirects the built-in OpenAI provider. OpenAI-compatible providers (xAI, Mistral, Groq, DeepSeek and the rest of the compatible catalogue, OpenRouter, Kimi API, LM Studio) do not receive the flag, because some of those services reject unknown parameters; what they keep is set by their own account settings and terms. Embeddings are not affected.

### Where masking applies {#where-masking-applies}

Masking happens inside the model gateway on **every attempt, for the provider that actually answers**. If a call is retried or falls over to a tier's fallback provider, each attempt is masked for its own destination: a local Ollama primary receives the raw text, and if it fails and the call moves to a cloud fallback, the cloud provider receives the masked text. The quick routing check that runs before a chat turn is masked too.

For a remote destination, EYAS masks:

- the system prompt, section by section: memory, persona and agent files, project context, skills, designs, and any text EYAS cannot attribute to a section;
- the conversation history;
- results of the EYAS memory tools, including their error texts: `memory_search`, `search_memory`, `memory_expand`, `search_knowledge`, `get_page`, `read_team_memory`;
- texts sent to a remote embedding provider.

Not masked:

- the sections EYAS writes itself — identity, core rules, the runtime block with date and time, working folders, the tool, skill and agent lists, the orchestration directive — so the model always reads today's date and its folders verbatim;
- results of workspace tools (files, shell, git, grep, browser, documents, code search). CLI-native tools cannot be masked anyway, and masking would write placeholders such as `[EMAIL]` back into files the model edits.

The same memory item is masked identically whether EYAS puts it into the prompt or the model fetches it with a memory tool — it is the same function. That holds on **every path** a model can use to read EYAS memory:

- providers whose tool loop runs inside EYAS (API and local providers);
- Claude Code's in-process EYAS tools (`mcp__eyas__*`);
- Grok CLI and Kimi CLI over EYAS's MCP bridge;
- external MCP clients calling EYAS's own MCP server (`POST /api/v1/mcp/tools/call`);
- the OpenCode sidecar: the `opencode_run` task prompt and the recalled memory sent as its system text are masked before they reach OpenCode (the OpenCode session title comes from the masked prompt), and so are the answers of `memory_search` / `memory_expand` inside OpenCode.

A CLI, an external MCP client and OpenCode always count as remote, because they can run any model: nothing in a request can make them local, and the local hosts list does not exempt them. Mask- and block-class values are replaced with `[TYPE]` placeholders; dates, times, ids, numbers and the JSON structure are kept.

**Fail closed.** If the privacy scan itself fails, the memory tool result is not sent: the model gets *Error: memory tool result withheld (privacy scan failed)*, and an OpenCode task fails with *privacy scan failed — the task was not sent to OpenCode* — nothing reaches OpenCode. The log records only types, counts and identity (conversation, run, agent, turn, tool, transport), never a value: *Privacy: masked values in a tool result sent past the model gateway*, or *warn-class values in a tool result sent past the model gateway*.

A policy change takes effect from the next turn. A turn already running keeps the policy it started with, so a tool loop is masked consistently.

### Where the policy lives {#where-the-policy-lives}

The policy is stored in the EYAS database. `config/personality/privacy.yaml` is its seed: it is re-imported automatically when the file changes, with no restart, until the policy is first saved on the [Privacy page](#privacy). After that the saved policy wins and edits to the file are ignored with a warning in the log.

A missing or invalid `privacy.yaml` no longer falls back to defaults silently: the error is logged with the file's full path and the reasons, and the last good policy stays in force. On a first install without a readable file, the built-in defaults apply.

The legacy format (`scanners` / `rules` / `custom_patterns`) is still accepted:

- For each type the first matching rule decides; a type no rule matches is `warn`.
- `sanitize` becomes `mask`; `auto_local` becomes `mask` with a warning; `ner` is ignored with a warning.
- A scanner missing from `scanners` switches its detections off.
- Unusable rules or patterns are dropped with a warning.

**Audit.** With `audit` on, every model call that masked (or warned about) something writes **one** audit entry, action `privacy.egress`, targeted at the conversation. It replaces the old one-entry-per-match `privacy.detected` entries, which are no longer written. The entry lists the conversation, run, agent and composition (or turn) ids; the provider; the destination (remote); the transport (`gateway`, `embed`, `mcp-bridge`, `mcp-external`, `opencode`); the policy version; the masked and warned counts; counts per type; the prompt sections involved (`unattributed` = system text outside the recorded sections); the number of matches in the conversation history; and the memory tools involved. A memory tool result sent past the gateway gets its own entry. Detected values are never logged or stored. Policy changes are always audited as `privacy.policy.updated` (version, source, changed types and the user who saved — never values). Log lines read *Privacy: masked values in outgoing model traffic* or *warn-class values in outgoing model traffic*, and now also name the conversation, composition, sections and tools. The context inspector shows per prompt section what was masked — see [Conversations — Context composition](/docs/en/daily/conversations/#context-composition).

**Upgrade.** Nothing to do: existing `privacy.yaml` files in the old format keep working, and an existing `privacy.yaml` keeps seeding the policy until the first save on the page. Text that the old scanner stored with a date replaced by `[PHONE]` — for example in a vault note — is not repaired automatically, because the original value is gone; re-importing from the source restores it.

## Fields and controls

### Security events (`/security`) {#security-events}

Subtitle: *Tool execution decisions and security audit log.*

The page opens with the **Memory outside EYAS** card (owners and admins) — see [above](#memory-outside-eyas-card).

| Control | Meaning |
|---------|---------|
| Stats | **Total Events**, **Denial Rate**, **Top Blocked Tools** |
| Decision filter | **All / Allow / Deny / Escalate** |
| Risk filter | **All / low / medium / high / critical** |
| Checkpoint filter | Free text (*Filter checkpoint…*) — `deterministic` for path refusals such as memory outside EYAS |
| Columns | Timestamp, Tool, Decision, Checkpoint, Risk, Agent, Reason |

Empty: *No security events found.*

### Audit (`/audit`) {#audit}

Subtitle: *Action logging, snapshots, and rollback tracking.*

| Control | Meaning |
|---------|---------|
| Stats | **Total Entries**, **Actions / Day**, **Top Module**, **Total Cost** |
| Filters | **Action**, **Module**, **From**, **To** |
| Columns | Timestamp, User, Action, Module, Target, Result, Cost |
| **Rollback** | Restore from snapshot (confirm) |

Results: **success / error / denied / rolled back**.

### Privacy (`/privacy`) {#privacy}

The page has three parts. (Before this version every Privacy API call was rejected as unauthenticated, so the page could bounce to the login screen; that is fixed.)

**1. Stats** (top of the page). Counters of real traffic since the server started — kept in memory, so a restart resets them; *Since the server started: &lt;time&gt;* shows when they began, and **Refresh** reloads them. Scan-tester runs are never counted.

| Counter | Meaning |
|---------|---------|
| **Remote calls checked** | Outgoing payloads scanned for a remote destination: every model call attempt (retries and tier-fallback hops count separately), embeddings sent to a remote embedder, and memory tool results sent past the gateway (Claude Code / Grok / Kimi bridges, external MCP clients, the OpenCode sidecar). Calls to a local destination are not scanned and not counted |
| **Calls with masked values** | Of those, how many had at least one value replaced |
| **Messages refused** | New chat, God Mode and channel messages refused because of a block-class value |
| **Sent masked on request** | Refused chat messages the sender then sent with **Send with these values masked** |
| **Detected PII Types** | Detections per type, with *Detections by scanner* (regex / custom) |

**2. Privacy policy editor.** A header with the policy version (*Version N*) and where it comes from: *Imported from config/personality/privacy.yaml…* (re-imported whenever the file changes, until you save here), *Managed on this page. Changes to privacy.yaml are ignored.*, or *Built-in defaults: privacy.yaml could not be read.* While the policy still comes from the file, a red banner *privacy.yaml problem: &lt;error&gt;* shows a missing or invalid file with its full path.

| Control | Meaning |
|---------|---------|
| **Privacy policy on** | Off: nothing is detected, masked or refused |
| **Audit** | Record every model call or memory tool result with masked or warned values in the audit log (types and counts, never the values). Policy changes are always audited |
| **Action per type** | A legend of the four actions (**Off**, **Warn**, **Mask**, **Block**, each explained) and one row per built-in type (`email`, `phone`, `iban`, `bank_account`, `credit_card`, `ssn`, `personal_id`, `tax_number`, `taj_number`) with its name, a one-line description of what is detected, and an action selector |
| **Custom patterns** | Rows of **Name**, **Regular expression**, **Type** (a lower-case slug such as `project_code`; in capitals it becomes the placeholder, e.g. `[PROJECT_CODE]`) and **Action**; **Add pattern** / **Remove pattern**; up to 50. Patterns match one line at a time; patterns sharing a type use the first pattern's action. An unsafe (catastrophic backtracking) or invalid regular expression is refused on save with the reason under the field |
| **Local hosts** | Hostnames or IP addresses (no scheme, port or path; up to 32) whose model endpoints receive text unmasked, like localhost. Invalid input is refused before saving |
| **Save policy** / **Discard changes** | With an *Unsaved changes* marker. Saving replaces the whole policy and stores it in the database; from then on the policy is managed on this page and edits to `privacy.yaml` are ignored (a warning is logged). It applies from the next model call — a turn already running keeps the policy it started with. If the server refuses the policy, nothing changes and each problem is shown at its field |

Only the owner can change the policy. Admins see it read-only with *You can view the policy. Only the owner can change it or use the scan tester.* An operator can switch everything off; that change is audited.

**3. Test PII Scanner** (owner only). Paste up to 100,000 characters and **Scan Text**. It always uses the **saved** policy (a hint appears while the editor has unsaved changes). Results: the verdict for a new message — *A new message with this text would be refused: &lt;types&gt;.* or *A new message with this text would be accepted.*; each detection with its type, position, scanner and action; and **As sent to a remote model** — the text with mask- and block-class values replaced (warn-class values stay). *The privacy policy is off: nothing is detected.* when the policy is switched off.

**API (integrators).**

- `GET /api/v1/privacy/policy` (owner and admin) → `{policy: {enabled, actions, customPatterns, localHosts, audit}, version, source ('yaml'|'ui'|'defaults'), seedError, updatedAt, rulesetVersion, builtinTypes, actions, limits: {customPatterns: 50, localHosts: 32}, canManage}`.
- `PUT /api/v1/privacy/policy` (owner) — the body is the whole policy (omitted fields take their defaults; unknown keys are refused) → the same shape as `GET`, or `400 {code: 'invalid_policy', issues: [{path, code, message}]}` with nothing changed (codes include `unsafeRegex`, `invalidRegex`, `invalidHost`, `invalid_enum_value`, `too_big`, `unrecognized_keys`).
- `POST /api/v1/privacy/scan` (owner; `text` non-empty, at most 100,000 characters) → `{enabled, rulesetVersion, matches: [{type, start, end, scanner, action, value: '***'}], inbound: {refused, types}, egressPreview}`. The fields `blocked`, `blockedTypes`, `warnings`, `sanitizedText` and `confidence` are gone. Not counted in stats.
- `GET /api/v1/privacy/stats` (owner and admin) → `{since, egress: {calls, maskedCalls, byType}, inbound: {checked, refused, masked}, byScanner}`; `totalScans`, `totalDetections`, `detectionsByType`, `detectionsByScanner` and `detectionsByAction` are gone.
- `/api/v1/privacy/*` requires the `X-Eyas-Request` header on mutating calls made with a session cookie, like the other admin APIs (the web UI sends it; API keys and Bearer tokens are unaffected).

## Related

- [Autonomy](/docs/en/agents/autonomy/)
- [Users](/docs/en/admin/users/)
- [Tools](/docs/en/automation/tools/)
- [Observability & nodes](/docs/en/admin/observability/)
- [Nodes](/docs/en/admin/nodes/)
- [Memory](/docs/en/knowledge/memory/)
- [OpenCode](/docs/en/automation/opencode/)
- [CLI](/docs/en/deploy/cli/)
