# Changelog

## [Unreleased]

## [0.8.30-beta] - 2026-09-24 — Any model, one memory

EYAS kept its own memory, but not its own ground. A CLI started inside the
EYAS checkout adopted that repository, Claude Code resumed sessions EYAS never
owned and left transcripts on the host, Grok and Kimi read the operator's own
config and could not reach EYAS tools, a conversation changed model from turn
to turn, and the privacy scanner turned dates into `[PHONE]` before failing
whole turns over an IBAN in a memory note.

Now the model is an interchangeable executor on EYAS's terms. Every CLI runs
isolated in a home EYAS owns and is checked before every session, and a live
release check proves it on the real binaries. One path policy, and under the
CLIs' own shells the kernel, keeps other tools' memory and EYAS's private data
out of reach. Recall arrives with the message the same way for every provider,
and only EYAS writes memory. A conversation keeps the model you pick, at the
effort that model really offers; a turn ends once, with its outcome, usage and
cost; and the owner can see what reached each model, and quarantine it.

### Security / memory sovereignty

- **One memory-sovereignty path policy (`src/shared/memory-sovereignty/`).** A versioned table of other tools' memory stores (Claude Code, Grok, Codex, Gemini, Kimi, Cursor, Windsurf, OpenCode XDG folders, shared agent-skill folders, Obsidian app folders), Obsidian vaults found from Obsidian's vault list and `.obsidian` markers, and segment rules (`ai-memory`, `.<tool>/…/memory`). The EYAS data folder is private except the work areas (workspaces root, Studio, browser downloads); another conversation's workspace, the database wherever it lives and the EYAS-owned CLI homes are protected too. Paths are judged as written and after realpath. The gate enforces it, and the kernel file sandbox enforces it for the CLIs' own tools (see below).
- **New settings `security.foreignMemoryPaths` and `security.cliSandbox` (`auto` | `required`).** The owner can add stores to protect and choose the sandbox mode; there is no `off`. Both are read at start and enforced (see below); `foreignMemoryPaths` entries that are not absolute paths are ignored with a warning.
- **The file-tool path check follows dangling symlinks.** A link inside the working folder that points outside it is refused even when its target does not exist yet (`src/shared/fs-realpath.ts`).
- **The security gate refuses memory outside EYAS — reads as well as writes, for every tool.** Every path in every tool call the gate sees (EYAS tools, the Grok/Kimi tool bridge, Claude Code permission requests, Grok/Kimi permission and file requests) goes through the memory-sovereignty path policy. Other tools' memory, Obsidian vaults, `security.foreignMemoryPaths`, EYAS's own data folder (vault, database wherever it lives, keys, CLI sign-in homes) and — when the call's folders are known — another conversation's workspace are refused at once: no LLM judge, no approval, no grant, not counted toward the denial-streak lockout, one Security events row (checkpoint `deterministic`), also with the gate switched off. Previously only writes and shell access to `~/.claude`, `~/.grok` and `ai-memory` were blocked, and `Read`/`Grep`/`Glob`/`read_file` of host memory were allowed as green. The model is told `Memory outside EYAS (<store>) — use memory_search / memory_expand from EYAS`, or that the location is EYAS-only. The three regex patterns and the literal database-path check are gone. Shell targets the command text does not show, and CLI reads that never ask, are covered by the kernel file sandbox where it runs (Kimi has none).
- **CLI searches are judged by what they can reach, not only by their folder.** Claude Code's Grep, Glob and LS, Grok's grep and list_dir, OpenCode's grep/glob/list, and shell searches through Claude Code Bash, Grok's shell and `run_command` are refused when their folder contains a protected place and their include globs may reach it. Shell searches covered: `grep -r`, `rg`, `ag`, `ack`, `find`, `fd`, `tree`, `du`, `ls -R`, recursive `cp`/`rsync`/`scp`/`zip`/`tar`/`ditto`, `locate`/`mdfind`, `git grep --no-index`, and glob words such as `~/.*/projects/*/memory/*.md`. Protected places: other tools' memory, Obsidian vaults, `security.foreignMemoryPaths`, EYAS's data folder, database and CLI homes, and other workspaces. Examples: Grep in `~` with glob `**/memory/*.md`, Glob in `~` for `**/MEMORY.md`, `grep -r token ~`, or a Grep of the EYAS checkout, which holds `data/` (for example `grep -rn x ~/GitHub` when the checkout is inside). The CLI cannot be told to leave the place out, so the hard, audited refusal tells the model `Search too broad [memory-path:search-scope:<target>] … search a narrower folder that does not contain it`. Narrow searches pass; exclusion globs never narrow a search, and a glob without a slash matches at any depth. Places known by name are always checked; vaults and memory folders known only by their shape are found by a bounded scan (2000 folders, 8 levels, never `node_modules`/VCS folders). Glob matching is linear-time (`src/shared/memory-sovereignty/search-scope.ts`). Grok ends its answer on the refusal, so ask again with a narrower folder; Claude Code gets the reason and can retry narrower.
- **Shell searches are read with the shell's grammar, and writing a file is never a search.** The search check used to treat every unquoted word of a command line as a glob, here-document lines included, so writing a source file with a JSDoc `/**` or a CSS `/* */` comment through `cat > f <<'EOF'` was refused as *Search too broad* in an ordinary project. Here-document lines are now data — never glob words or commands; only their `$(…)` runs when the delimiter is unquoted — so such a write, a `git commit -m "$(cat <<'EOF' … EOF)"` or `python3 - <<'EOF'` is not a search. What the shell does run is now seen: a search after `if`/`then`/`do`/`{`/`!`/`coproc`, under `eval` or `sh -lc`, in a here-document or here-string a shell reads as its script, with a redirection before its folder (`grep -r token 2>/dev/null ~`), or on brace alternatives (`~/{.,}`). A recursive search run by `xargs` or `parallel` gets its folders from input the line does not show, so it counts as a search of `/`. Scripts passed as one quoted word (`bash -c '…'`, `eval "…"`) name paths for the path check too. The bounded scan below a searched folder walks the folder once per 10 s whatever the globs, so repeated searches of a folder no longer stall the server (a 6,400-folder tree: about 85 ms once, then nothing).
- **The chat explains a refused search in your language.** A tool row refused as too broad shows a translated line naming what the folder also holds (another tool's memory, EYAS's own data, the CLI sign-ins EYAS keeps, another conversation's workspace), in all six languages. The reason's tag is one of the memory-policy reason markers, so the refusal counts on the Security page's **Memory outside EYAS** card.
- **Known gap: Kimi Code CLI searches.** Per its source, Kimi's own Grep and Glob never ask EYAS, so a Kimi search rooted above a protected place cannot be refused yet (Kimi's Glob stays in its working folder, its Grep accepts any folder, and Kimi has no kernel sandbox). Kimi's shell commands ask, but the request does not carry the command in a form the path check can read, so the AI judge or a person decides. This is unverified on a host and awaits an owner decision.
- **CLI turns hand their folders to the gate and the tool bridge.** The agent runner sends every conversation folder, not only the first; Grok and Kimi resolve their working folder before the tool bridge is set up and bind the turn's folders (cwd included) to the bridge secret server-side, so bridged EYAS tools work in the turn's folders and a request cannot name its own.
- **`~` and `$HOME` are judged where the CLI's tools point them.** Grok, Kimi and OpenCode run in an EYAS-owned HOME two levels under the data dir; the gate now judges `~`/`$HOME`/`${HOME}` in their permission requests under that home as well as the operator's, so `~/../../vault`, `$HOME/../../sqlite/eyas.db` or another CLI's sign-in folder are a hard deny instead of reaching the judge. Headless OpenCode tasks also hand the gate the task's folders, so another conversation's workspace is refused there too.
- **A turn's date-and-time and recall block cannot be forged.** The runner always attaches EYAS's own `<turn-context>` block — a message that merely starts with a look-alike frame no longer suppresses it — and EYAS frame tags in the text it is attached to are defanged. A checkpoint removes exactly the block that run attached, never the sender's text. An A2A peer's task reaches the model fenced as untrusted input (`source="a2a"`).
- **Kernel file sandbox for the CLIs' own tools.** Claude Code's shell and Grok CLI's own tools now run inside the operating system's file sandbox (macOS Seatbelt, Linux bubblewrap; Claude Code on Linux also needs socat). It blocks other tools' memory, EYAS's private data and other conversations' workspaces at the kernel; the conversation's own folders stay writable. `security.cliSandbox: auto` (default) runs without it where none is available and shows a one-time chat notice (`cliSandboxUnavailable`). `required` refuses such turns before the CLI starts (coded `cliSandboxUnavailable`, never retried or failed over) and stops Claude Code from ever running a command outside it; any other value is a configuration error and EYAS does not start. In `auto`, a Claude Code command that asks to leave the sandbox always waits for a human approval: never the judge, never the autonomy ladder. Tool-less isolated calls need no sandbox and are never refused for lack of one. Grok gets an EYAS profile in its own `sandbox.toml` it cannot relax. Kimi Code CLI has no kernel sandbox (reported as not supported). The provider panel shows a 'Kernel file sandbox' row, `GET /api/v1/model/providers[/:id]` returns `fileSandbox`, and `eyas doctor` adds a 'CLI sandbox' check. bubblewrap is not bundled (LGPL); it is the operator's install.
- **The Security page shows what memory is off-limits.** A 'Memory outside EYAS' card (owner/admin; `GET /api/v1/security/memory-policy`, read `SecurityEvent`) lists, with their absolute paths: the other tools' memory stores present on this server; detected Obsidian vaults; your `security.foreignMemoryPaths`, including entries that are missing or ignored because they are not absolute; EYAS's data folder, database and CLI sign-ins; and the workspaces root. It also shows the kernel file sandbox status and reason of each switched-on CLI provider under the `security.cliSandbox` mode, and two counts for the last 24 hours: memory-policy refusals and shell commands that asked to leave the sandbox. Refusals are recognised by shared reason markers (`MEMORY_PATH_REASON_MARKERS`), and the fail-closed refusal now has one wording for every channel.
- **grep/glob skip protected sub-folders and files.** The built-in file tools never descend into EYAS's data folder, a nested Obsidian vault, another tool's memory, a CLI home or another conversation's workspace, so a search over a repository that holds `data/` returns nothing from the EYAS vault. They also skip protected files — a database kept in the searched folder and files listed in `security.foreignMemoryPaths`, also when named directly — so they are never refused for an enclosing folder, unlike a CLI's own search.
- **The isolation is proven on the real CLIs before release.** `bun run test:live-cli` (`EYAS_LIVE_CLI_PROOF=1`) runs the installed Claude Code and Grok CLI (Kimi Code CLI where installed) through EYAS's own providers under a hostile temporary HOME. Free cases send every model request to a local fake model with a dummy key, so they spend no tokens. They prove that no host or project config, instruction file (AGENTS.md included), hook or MCP server is loaded; that the memory policy, the Grok file jail and the kernel sandbox keep the vault and the EYAS data folder out while a workspace read still works; that no session store is left; and that Grok and Kimi leave the host untouched. Claude Code's host writes are judged against a versioned allowlist (`tests/live/claude-host-writes.allowlist.json`) of start-up and bookkeeping files, never conversation content; clearing the stale lock folder that `claude auth status` leaves behind (`~/.claude.json.lock`) is allowed, any other removed host path fails. Paid canary turns on a real sign-in run only with `EYAS_LIVE_CLI_PAID=1` and owner approval per run. Proven versions are recorded in `src/modules/model/cli-runtime/verified-versions.ts`: Claude Code 2.1.281 and Grok CLI 1.0.41, free cases; Kimi Code CLI is not yet proven.
- **Memory sovereignty is proven the same way.** The lane runs a memory matrix on Claude Code and Grok CLI through the real security gate: a store listed only in `security.foreignMemoryPaths` is refused to the model's own file read and to a shell `cat`, and a write into `<data dir>/vault` is refused. Each refusal is exactly one Security events deny from the memory-path policy (checkpoint `deterministic`, never a rate limit) and a `denied` tool row; a workspace read after the three refusals still works, and nothing from the store reaches the model. Kimi Code CLI is not covered yet.
- **The live lane proves search scopes and in-folder reads.** Two free cases: Claude Code's Grep, Glob and `grep -r` rooted at the hostile home are refused by the memory-policy hook through the real gate, and so are Grok's grep and list_dir; each refusal is audited and shows a denied tool row, while a project search still works. A third free case shows that Claude Code reads a file in its working folder without asking `canUseTool`, and that the memory-policy hook refuses such a read when it lands in a vault — which is why a stored folder that holds a vault never becomes the working folder.
- **`eyas doctor` — CLI isolation lines.** One line per CLI provider ('CLI isolation (Claude Code)', '(Grok CLI)', '(Kimi Code CLI)'): the executable, how it was found, its version, and whether the release check proved that version. A differing, unknown or never-proven version is a warning; every session is still checked at start. For Grok and Kimi the line also checks the EYAS home (`<data dir>/cli-homes/<provider>`): not created yet is fine, a symlink or non-folder is a failure, a folder open to other users is a warning (it holds the CLI's sign-in), and a file EYAS manages there that changed between runs is a warning. Doctor stays read-only: it only runs `--version` and `claude auth status`.

### Claude Code runtime

- **EYAS runs the Claude Code you installed, as one binary for everything.** Resolution order: `EYAS_CLAUDE_CODE_BIN` (absolute executable; set but invalid fails closed, with no fallback) → `claude` on PATH → the Agent SDK's bundled `cli.js` as a last resort (doctor warns). The sign-in check, availability, fresh-install onboarding and every `query()` (`pathToClaudeCodeExecutable`) use the same path. The Agent SDK stays at 0.2.89; a newer CLI is used as it is and reported as version skew. No dependency bump and no Dockerfile change: the image ships no Claude Code CLI, so install or mount one and set `EYAS_CLAUDE_CODE_BIN`.
- **Availability = signed in, not "on PATH".** `claude auth status --json` is local, zero-cost and opens no session; its output is parsed tolerantly and identity fields (e-mail, organisation) are dropped, never logged. The provider registers, and a fresh install auto-enables it, only when the runtime is signed in (claude.ai login, `ANTHROPIC_API_KEY`, Bedrock/Vertex).
- **No more paid host model probe.** The `claude -p "respond ONLY with OK"` probe — four paid calls per **Refresh models** plus one at first boot, each loading the host's CLAUDE.md, hooks, MCP servers and auto-memory and leaving transcripts — is deleted. First start stores the known aliases (Fable, Opus, Sonnet, Haiku) without a model call, and the list no longer claims a concrete model version.
- **Thinking is no longer forced off.** The fixed `budgetTokens` branch is gone. With nothing requested no thinking option is sent (the model's default applies); thinking is switched off only when None is asked for on a model that can switch it off, and otherwise follows the effort level (below).
- **`eyas doctor`: 'Claude Code runtime' line** — source, path and version, SDK/CLI version skew, signed in yes/no. An invalid override is a failure; the bundled last resort, skew and signed-out are warnings; a host `claude` shadowed by the override is info.
- **Claude Code always runs isolated — the 'Load host Claude config' switch is gone.** One options builder (`buildClaudeIsolationOptions`, `claude-code/isolation-options.ts`) serves every chat, agent, background and isolated query and the `auth status` check. It sets `persistSession: false`, `settingSources: []`, `strictMcpConfig: true`, `enableFileCheckpointing: false`, the resolved runtime path and an allowlisted env with `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`, `DISABLE_AUTOUPDATER=1` and `CLAUDE_AGENT_SDK_CLIENT_APP=eyas`. There is no `{...process.env}` spread any more: other providers' keys, EYAS secrets, `CLAUDE_CONFIG_DIR` and a parent session's `CLAUDE_CODE_*` switches are dropped. Only the host sign-in is shared. The stored `loadClaudeMd` setting is removed on start and ignored if present. The provider panel's toggle and its CLAUDE.md warning are replaced by a one-line isolation statement (six languages).
- **Claude Code never works in the server's own directory.** The working directory comes from the CLI cwd resolver: a saved Folder that still validates, else the conversation's workspace, else a per-run scratch folder. Before, a conversation without Folders ran in the EYAS home, where Read/Grep/Glob of `data/master.key` and the vault were auto-allowed without reaching the EYAS gate.
- **Init tripwire.** Each run's `system/init` report is checked before any output is used: MCP servers ⊆ those EYAS passed (none for isolated calls), permission mode `default`, cwd = the resolved cwd (compared realpathed), and no plugins except the two builtins Claude Code 2.1.281 compiles in (`agents-md`, `telemetry`). Those are accepted only as `<name>@builtin`, because the release check proved them inert: no AGENTS.md from the working folder or a subfolder reaches the model. Any other plugin, including a new builtin, stops the run. A violation, or an answer or streamed delta that arrives before init, aborts the run with a terminal `CliIsolationError` (kind `isolation`: never retried, no failover), and no text is yielded. The provider's isolation status records the outcome and the CLI-reported `claude_code_version`.
- **Claude Code's own tools pass the memory policy before they run.** Every Claude Code tool call now passes one deterministic check first (a PreToolUse hook, the first one registered): Read, Write, Edit, Glob, Grep, Bash, NotebookEdit, WebFetch and the bridged EYAS tools — including reads the CLI allows on its own and never routes to EYAS's permission check. Reads and writes of other tools' memory (`~/.claude`, `~/.grok`, `~/.codex`, Obsidian vaults, `security.foreignMemoryPaths`), of EYAS's own data folder and of another conversation's workspace are refused with the policy's reason. With the gate active each refusal is one deterministic Security events row: no judge, no approval, no lockout streak. Without a gate the same policy answers. The check fails closed. Only tool-less isolated calls skip it. The folders it treats as the conversation's are built by EYAS (its valid Folders plus the CLI's start folder, shared with Grok/Kimi); they reach the permission bridge and the bridged EYAS tools too, so `read_file` and friends on Claude Code now work in the conversation's folders instead of failing with 'no working directory configured'.
- **One writer of SDK hooks.** `mergeHooks()` (`claude-code/hooks.ts`) composes every contributor in a fixed order: memory-policy hook, then effort readback. `applyHooks()` is the only code that sets `queryOptions.hooks`, and it refuses a second write. A test pins exactly one LLM-judge call and one `security_events` row per Claude Code tool call.
- **Claude Code follows the agent's tool list, Solo and the per-answer memory budget.** The in-process EYAS MCP server now offers only the tools EYAS offers the run: the agent's list plus `memory_search`/`memory_expand`, with an empty list meaning all tools. Solo removes `run_specialist`, `delegate_to_agent`, `handoff_to_colleague` and `propose_team`. Every bridged call carries the conversation, project, turn and run from the request, so memory drill-down is 3 calls per answer and locked to the conversation's project, and tool executions are attributed to the run. A request without a conversation no longer reaches tools with an empty conversation id. Prompts name EYAS tools for Claude Code as `mcp__eyas__<name>`.
- **One specialist mechanism on every provider.** Claude Code no longer runs native SDK subagents (Task/Agent tool, `options.agents`). Every non-isolated Claude Code query gets an explicit built-in tool list without the subagent spawner, and specialists always run as EYAS sub-conversations via `run_specialist`, with the EYAS prompt, memory and tool scope, a supervised run and an openable transcript. The Deep orchestration directive is now one provider-neutral text (`run_specialist` / `handoff_to_colleague` / `propose_team`). Claude Code has no run-tree observer of its own any more: the agent runner draws the tree for every provider (see Conversations / stream). The security gate no longer classifies `Task` as green: a stray call is unclassified and escalates.
- **Claude Code looks like every other provider in the chat.**
  - Text and thinking stream live (partial messages) instead of once per finished block, with no duplicate of the complete message.
  - Tool rows open with the canonical name (`read_file`, `run_command`, `edit_file`…, the runtime's own name kept as `rawName`) and the full normalized input, so edits render as a diff. A row settles only when the runtime reports the output (capped at 64 KiB) with its duration.
  - A call EYAS refused settles as `denied` / `approval_required` / `skipped` instead of green: the gate, the memory-policy hook, a wait for approval, or a resumed run's repeat. A call waiting on a human raises `approval_required` with its approval id, also when the run parks on it.
  - The runtime's turn limit (`error_max_turns`) is an outcome: `done` with `stopReason: 'max_turns'`, the partial answer and usage kept, not a `ProviderRunError`. Other failed subtypes still throw with the partial answer.
  - Usage is canonical (`reported`, the runtime's `costUsd`, `promptTokensLastCall`, cost "not reported" when the result carries none). `contextWindow` comes from the answering model's `modelUsage` entry.
  - `compact_boundary` becomes a `contextCompacted` notice; the dead compaction-summary → memory branch is gone. Content from inside a tool call (`parent_tool_use_id`) is dropped.
- **The model list is discovered from the runtime EYAS runs.** On every provider start and on Refresh models, EYAS asks the resolved Claude Code runtime for its models: zero-cost and isolated (the runtime's own model list, no prompt; account fields are never read). Each entry names the concrete model its alias runs, including a new `claude-code-default` row, and carries the effort levels that runtime offers, including Extra high. Entries it no longer offers are switched off, not deleted.
- **Effort is mapped per model to what the running binary accepts.** A level is sent only when the runtime reported it for that model and that CLI version; summarized thinking is requested only from runtimes that have the option (2.1.280+, see Reasoning effort). The effective effort is read back from the runtime every turn and reported as a confirmed outcome.
- **Every answer records the concrete model that answered** (resolved model). A turn with no model chosen is attributed to `claude-code-default`, no longer to `claude-code-sonnet`.
- **First-boot models no longer claim 1M context.** Before the runtime reports its models, Fable, Opus and Sonnet list the 200k window the runtime gives a bare alias (was 1M), so the context badge, the context bar and prompt sizing agree. Only the runtime's own `[1m]` variants are 1M; a larger window the runtime reports for the answering model still wins in the context bar. Entries an earlier version stored at 1M that no model read has confirmed are corrected at the next start, also while the model read fails; the user's on/off choice is kept.
- **Claude Code's shell runs in the kernel file sandbox** where one is available (see Security / memory sovereignty).
- **Claude Code's temporary folder is EYAS's, per query.** Claude Code 2.1.281 kept a per-session `tasks/` folder — the output of background shell commands, in a folder named after the working folder (so after the conversation) — under the host's `/tmp/claude-<uid>`, and nothing ever removed it. Every query and the discovery probe now get `CLAUDE_CODE_TMPDIR` set to a private folder of their own in the run scratch area (`<workspaces>/_runs/clitmp-…`, `cliQueryTmp`): it is one of the turn's folders (the memory policy and the kernel sandbox open it to that query only), it is created right before the CLI starts and removed when the query ends, and the run-scratch sweep removes any an earlier process left behind. `buildClaudeIsolationOptions` requires the folder. The live lane now also fails when a Claude case leaves anything in `/tmp/claude-<uid>` for its working folders or in the run scratch area; folders earlier runs left there are not cleaned up automatically.

### Grok / Kimi CLI isolation

- **Grok and Kimi run in an EYAS-owned home, not yours (breaking: sign in for EYAS).** Every Grok/Kimi spawn — chat turn, background call, model probe — goes through one launch profile (`grok-cli/acp-profiles.ts`): HOME and GROK_HOME / KIMI_SHARE_DIR point at `data/cli-homes/<provider>` (0700), and the child env is the cli-runtime allowlist plus the isolation switches — never `{...process.env}`. Host `~/.grok`, `~/.kimi`, `~/.claude` (skills, rules, settings, `~/.claude.json` MCP servers), `~/.cursor` and `~/.agents` are no longer seen. The host Grok/Kimi login and a server-side `XAI_API_KEY` are no longer used.
- **Grok asks EYAS before every native tool, and cannot be flipped to always-approve.** EYAS writes the Grok home's `config.toml` (ask mode, `[permission] ask` for Read/Edit/Grep/Bash/WebFetch/WebSearch; memory, memory v2, session search, telemetry, trace upload, leader and auto-update off; every Claude/Cursor/Codex compat import off), `requirements.toml` (bypass lock, only the `eyas` MCP server allowed) and an empty `trusted_folders.toml` before every run. Grok starts as `grok agent --no-leader [--model X] stdio`, never `--always-approve` or `--trust`, so a project folder's AGENTS.md, `.grok` config, hooks and MCP servers stay unloaded. Proven on grok 1.0.40 with the recorded fixtures and again on 1.0.41 by the release check (see Security / memory sovereignty).
- **A slash at the start of a message is never a CLI command.** grok 1.0.40 runs a prompt that starts with `/always-approve on` locally and switches the session to always-approve even under the requirements lock. EYAS now wraps any prompt text block that starts with a slash command in `<message>…</message>` before `session/prompt`, for Grok and Kimi.
- **The Grok/Kimi turn limit applies, and it is an outcome.** The undocumented `_meta.maxTurns` was ignored. EYAS now counts tool calls (subagents included). One call over the limit sends `session/cancel`: later permission requests are answered `cancelled`, and the turn ends with `stopReason: 'max_turns'`, the partial answer and usage. ACP `max_turn_requests` maps to `max_turns`.
- **Kimi starts as exactly `kimi acp`.** `--model` was ignored by kimi-cli and misreported the model. EYAS upserts only `default_yolo = false`, `telemetry = false` and `merge_all_available_skills = false` into its Kimi `config.toml` (login and `default_model` / `default_thinking` are kept), and `.kimi/mcp.json` is empty. The chosen model is applied in-session (below).
- **CLI session files are deleted after every turn.** The Grok/Kimi session store in the EYAS home is purged when a run ends, after the CLI exits; when several runs share a store, the last one to end purges it. A sweeper removes entries older than 1 h at boot and hourly.
- **Grok/Kimi availability uses the shared executable resolver** (`EYAS_GROK_BIN` / `EYAS_KIMI_BIN` → PATH; an invalid override fails closed), and a provider reload re-resolves it. Turns run in the shared cwd resolver (folder → conversation workspace → run scratch), never `process.cwd()`.
- **Grok and Kimi fail closed.** Before every turn, EYAS checks the CLI. Grok is checked with `grok inspect --json` in the conversation folder: no model call, a pass cached for 10 minutes per binary, folder and EYAS home. Kimi is checked by reading back its EYAS home. The turn is refused when the CLI could approve its own tool calls, loads permission rules or a config layer EYAS does not own, would start an MCP server other than EYAS's bridge, or has hooks, plugins or language servers; also when it loads instructions, skills or agents from its home or from outside the conversation's folders, has Claude/Cursor/Codex imports on, or applies a trusted project folder's config. Project instruction files inside the conversation's folders are allowed, because they are never auto-loaded. A session that starts in a bypass mode is stopped. Grok's vendor-managed settings cache (`managed_config.toml`, which grok 1.0.41 writes into its EYAS home, empty for a normal account) is accepted while it is empty; one that holds any setting refuses the turn, and a change in it voids a cached pass at once.
- **Runtime tripwire.** A native tool call that starts or finishes without an EYAS decision cancels the session: file, search, list, shell, web, subagent, tool search, or a non-EYAS MCP tool. So does any use of the CLI's own memory tool. Everything the CLI says after that is dropped. Calls are keyed on the tool call id, so subagent calls are covered too. The failure is `CliIsolationError` (kind `isolation`, code `cliIsolation`, params `{provider, checks}`), never retried or failed over. The chat shows it localized, with the failed checks and a link to the provider settings. SSE error frames now carry `kind`, `retryable`, `code` and `params`.
- **Allow once, one jail, one judgement.** ACP permission prompts are answered by option kind only: `allow_once` for an allow, `reject_once` for a deny, `cancelled` otherwise. A standing `allow_always` grant and name matching are gone. Client-fs reads and writes are jailed to the conversation's valid folders plus the working folder, with symlinks resolved (a new file under a linked folder included) and O_NOFOLLOW on open. No folder means no file access. The memory-path policy applies next. Each operation gets exactly one gate decision. `fs/read_text_file` honours `line`/`limit`.
- **Isolated completions on Grok/Kimi.** `supportsIsolatedCompletion` is advertised only while the provider's isolation status is `verified`: Grok at provider load, **Verify now** and each session start, Kimi only after a session started on this host. An isolated request runs with no EYAS bridge, every permission and fs request refused, a tool cap of 0 and its output cap (see Background model calls).
- **Grok and Kimi sign in for EYAS, not on the host.** The Grok/Kimi provider panel, the setup wizard's AI provider step and a new Home banner (owners/admins, for installs that relied on the host login) carry a **Sign in for EYAS** card.
  - **Device code:** runs the CLI's own login through the provider's launch profile (`grok login --device-auth`, or `kimi login --json`, parsed leniently). It shows the link and the code to confirm in any browser; nothing is opened on the server. It waits up to 15 minutes, and output it cannot parse is shown verbatim.
  - **API key (Grok):** stored encrypted in Secrets as `grok-cli-api-key` and passed to grok runs only as `XAI_API_KEY`. Billed as xAI API usage; a device sign-in takes precedence.
  - **Sign out:** removes the EYAS credential and the stored key (`grok logout` in the EYAS home; for Kimi EYAS deletes its own credential file, because `kimi logout` would also clear the operator's OS keyring). The host login is never touched.
  - **Signed out:** the provider card shows **Sign-in required**, the isolation status is `auth-required`, and a turn fails at once with the coded `cliSignIn` error (terminal, no failover) instead of starting the CLI.
  - **API:** `GET/POST/DELETE /api/v1/model/providers/{grok-cli|kimi-cli}/sign-in` (read / manage Model). `POST {method:'device'}` → 202; `{method:'apiKey', apiKey}` → 200, Grok only; `DELETE ?target=session` only cancels. A `GET` without manage Model gets the pending session's `verificationUrl`, `userCode`, `rawPrompt` and `error` as `null` — whoever confirms the code binds their own account to the EYAS home.
  - Kimi's flow follows the kimi-cli 1.52.0 source and is not yet verified on a host.
- **Grok and Kimi get EYAS's system prompt, checked.** Kimi now receives it at the top of every message, fenced as EYAS system instructions; its untested `_meta.systemPromptOverride` is no longer sent. Grok writes the system prompt it used to its session record only once the model request is built, so EYAS reads that record after the turn, inside its own Grok home and before the session is purged, and looks for a check marker. Until a grok binary (path, size, mtime) has proven the override, each turn carries the prompt both ways. Once proven, the override goes alone and every turn is checked again. A turn that answered without it switches all later turns of the process to the in-message copy and logs a warning; a turn that never reached the model proves nothing. Every Grok/Kimi response records how the prompt arrived (`systemPromptChannel`: `meta-verified`, `prompt`, `meta-unverified`).
- **Kimi Code CLI runs the model and thinking you pick.** `kimi acp` ignores `--model`/`--thinking`, so every Kimi row used to run Kimi's own default.
  - EYAS now selects the model and its thinking variant inside each ACP session with `session/set_model` (`<key>` / `<key>,thinking`). The switch happens after the session check and before the prompt, and it is read back: `resolvedModelId` and a confirmed effort outcome.
  - Discovery reads Kimi's models state from a `session/new` (no prompt, no model call), on every provider load and on Refresh models: `kimi-cli-default` plus `kimi-cli-<key>`.
  - Thinking control per model: both variants listed = On/Off toggle; thinking variant only = always on; plain only = no control. Auto keeps the running variant.
  - A model the session does not offer fails before the prompt (`does not offer it`).
  - Until the list has been read, the Kimi panel says the model and thinking cannot be pinned, and nothing is sent. The static overlay row that claimed a toggle for every Kimi model is removed.
  - Kimi persists the switched model in its own `config.toml`, so the default row runs the last model EYAS selected. The Kimi preflight now also requires Kimi's share dir to be the EYAS Kimi home, so that write never lands outside it.
  - The seed ids `kimi-cli-k3` / `kimi-cli-k2.7-code` / `kimi-cli-k2.6` are retired: EYAS-seeded routing tiers and the Kimi default move to `kimi-cli-default` at start, new installs seed every tier with it, their downgrade entries are removed, and discovered models are priced at the default rate.
  - Built from the kimi-cli 1.52.0 source; not yet verified on a real binary.
- **CLI turns stop only when idle.** Claude Code, Grok CLI and Kimi Code CLI turns no longer abort after a fixed 10 minutes. A turn now stops only after `model.cli.idleTimeoutMs` (default 10 min) of silence with no tool running, or `model.cli.toolTimeoutMs` (default 20 min) of silence while a tool runs; any SDK message or ACP line resets the clock. Long specialists and builds get the same time as on API providers. A stopped turn reports a retryable `timeout` instead of a generic abort; operator Stop stays `aborted`.
- **Grok and Kimi see the whole conversation, images included, when their CLI can.** Every turn replays EYAS's history as ACP content blocks: a `<conversation-history>` frame with earlier images inline in turn order, then the latest message's text and images. Before, both CLIs got text only and pasted images vanished. Images are sent only when the CLI's `initialize` advertises `promptCapabilities.image`; otherwise each image becomes a text stub (`[image omitted (<type>): this model cannot see images]`). Each Grok/Kimi turn writes the reported image capability to that provider's model rows, so the Vision badge follows the installed CLI; Grok CLI 1.0.40 reports no image input, so the Grok CLI catalog now starts with Vision off.
- **A refused tool call ends a Grok answer (known behaviour, grok 1.0.41).** When EYAS refuses a Grok permission request, for example a read of memory outside EYAS, Grok stops the turn: the tool row shows as refused, no further model request is made, and EYAS's reason (`Memory outside EYAS (…) — use memory_search / memory_expand from EYAS`) does not reach Grok's model. Ask again without that step. Claude Code continues and receives the reason.

### Grok / Kimi tools

- **Grok CLI and Kimi Code CLI reach EYAS tools again.** The deny-by-default session check rejected every call from the stdio MCP child with 'Authentication required', so these agents had no EYAS memory drill-down and no EYAS tools. Exactly `/api/v1/internal/cli-mcp/tools/list` and `/tools/call` are now exempt from session auth; they are authenticated by the bridge's own per-turn secret plus a loopback check. Every other internal path still requires login.
- **Bridge identity lives on the server.** Each turn's 192-bit secret is bound server-side to its conversation, agent, project, turn, run and tool scope (`BridgeBinding`); the child carries only the secret (`EYAS_MCP_TOOL_CONTEXT` is gone, a request-body `context` is ignored). The secret is revoked when the turn ends and expires 2 h after its last use (sliding, so a long, busy turn keeps its EYAS tools).
- **Runtime-agnostic launch.** The stdio MCP child runs as `process.execPath` from a module-relative path, and `bun run build` now emits `dist/stdio-mcp-server.js`, so Docker images include the bridge. The server's MCP `instructions` name EYAS memory as the only memory.
- **Boot self-test.** After start-up EYAS calls the bridge through the full middleware stack and logs a warning, with the reason, when Grok/Kimi cannot reach EYAS tools; the check is postponed while setup is incomplete.
- **Grok and Kimi get the same approval verdicts and do-not-repeat guard for EYAS tools.** The CLI tool bridge now binds the turn's origin (attended or autonomous) and a resumed run's do-not-repeat ledger server-side. It puts every `tools/call` through the shared permission bridge that Claude Code's `canUseTool` uses before the executor runs it as an already-gated call (`src/modules/model/cli-mcp/bridge-routes.ts`). In an attended chat or channel conversation, whatever the gate allows runs: a tool's `requiresApproval` and the autonomy ladder no longer add an approval on Grok/Kimi only. An escalation always waits for a person, also at autonomy level 3 (it used to run unasked on Grok/Kimi). A supervised background run parks on the approval once the CLI's turn ends. A resumed run's repeat of an already-executed call is refused and shown as *Skipped*. A call outside the turn's toolset is refused before the gate, so it queues nothing; without a security gate every bridged call is refused. Grok's EYAS tool rows record `use_tool`'s `tool_input` (what the bridge received), so the ledger a resume builds matches the call and the row shows the tool's real arguments. Proven on the installed Grok CLI in the free live lane. How the Kimi binary reports bridged calls is not yet verified on a host.

### OpenCode sidecar

- **OpenCode sidecar isolation.** OpenCode now always runs in an EYAS-owned home (`<data>/cli-homes/opencode`): HOME, XDG config/data/state/cache and the npm cache. Host `~/.claude/CLAUDE.md`, Claude Code/`~/.agents` skills and project config are disabled, and no host provider keys are passed in. The `isolatedConfig` setting is removed; a saved value is ignored. Existing OpenCode users sign in once with `/connect` in the OpenCode terminal. The spawned server is password-protected, and an attach URL is flagged as not isolated.
- **OpenCode headless tasks ask EYAS.** `opencode_run` sessions run with every tool set to ask. Each `permission.asked` goes through the EYAS security gate (allow → once; deny, escalation or no gate → reject). The task folder comes from the shared CLI cwd resolver, never the install root. The OpenCode session is deleted after capture.
- **OpenCode tasks get recall like every run.** `opencode_run` sends the recalled-memory block as the task's `system` text, with the usual drill hint (unless the server is attached), instead of a separate quoted-memory message. The task prompt and that system text are masked by the privacy policy before they reach OpenCode (see Privacy). `opencode_run` refuses to run outside a conversation.
- **OpenCode tasks get recall sized for their model's window.** The recalled-memory block `opencode_run` sends is sized by the same window scaling as every other model's recall: `memory.index.budgetChars` at a 100k-token window, up to 2.5× from 250k tokens, less below about 29k, none for a very small window. It was the unscaled `memory.index.budgetChars`, so a 1M-token model got 40% of what any other provider gives it. The window is the one OpenCode lists for the chosen model (`/config/providers` `limit`: input limit, else context). With no model picked, an unlisted model, a model without a limit or an unreadable list, the baseline applies. The model list is read at most once per task, only when a model is picked, carries nothing of the task, and serves both the reasoning-variant check and the window. `GET /api/v1/opencode/models` returns an optional `contextWindow` per model. Proven by a free live case on opencode 1.18.29.
- **OpenCode's EYAS memory tools actually load.** The live lane showed that OpenCode 1.18.29 silently skipped the EYAS memory plugin: from `<home>/plugins/eyas-memory.ts` its `@opencode-ai/plugin` import does not resolve. OpenCode's model had no `memory_search` / `memory_expand`, and the plugin's `shell.env` hook never ran. The plugin now lives at `config/opencode/eyas/eyas-memory.ts` in the EYAS-owned OpenCode home, where OpenCode installs that dependency, and the old copy is removed at start. OpenCode's first start still needs the npm registry to install it; without it OpenCode runs without the EYAS memory tools.
- **OpenCode reads memory like every model and cannot write it.** The EYAS memory plugin inside OpenCode now offers only `memory_search` / `memory_expand`, with EYAS's own names, descriptions and arguments, read-only, with the same 3-calls-per-turn budget. `eyas_query_memory` and `eyas_save_memory` are removed, so OpenCode's model no longer decides what EYAS stores. For an `opencode_run` task the tools are locked to the conversation's project and share the calling turn's budget: EYAS binds the OpenCode session in process to the conversation, the user and the server's plugin key. An unbound session (a terminal session a person starts, any session EYAS did not create), another key, or a signed-in caller who is not the bound user reads global memory only; an attached external server has no EYAS memory. New `POST /api/v1/opencode/memory/search|expand` (the plugin's one-time session proof, or a signed-in user with create OpenCode; a forged, replayed or dead-key proof is 401, a body naming another session 403, a CASL denial 403) run through the one executor (gate, CASL, drill budget, access log, privacy mask). `/memory/query` and `/memory/save` are removed (404).
- **Per-session proofs replace the shared OpenCode plugin key.** Each OpenCode process EYAS starts (the `opencode serve` server and every OpenCode terminal) gets its own 32-byte key, revoked with the process. The key is handed over on file descriptor 3, a socket only that process holds, and is never in an environment, an argument list or a file. The plugin reads it once at load and closes fd 3. The environment carries only `EYAS_OPENCODE_KEY_FD=3`, which the model's shells see blank, as they see `OPENCODE_SERVER_PASSWORD`. Each memory call sends a one-time proof for the session the tool runs in (`Bearer eyas-ocs.<payload>.<mac>`, HMAC-SHA256 over OpenCode's own session id, a nonce and the time, good for 2 minutes), never the key. EYAS serves the call only for that session. A body naming another session is 403, and a forged, replayed, stale or dead-key proof is 401, so neither another process nor a command the model runs can read another session's memory. The plugin sends only the tool's declared arguments. Where the key cannot be handed over on fd 3, OpenCode runs without the EYAS memory tools. The auth middleware lets a valid proof through only on the two memory paths (`auth/delegated-bearer.ts`), and `/api/v1/opencode/*` is paired with authenticate + CSRF protection (the web UI already sends the header). Proven on opencode 1.18.29 by two free live-lane cases (serve and TUI). Remaining: OpenCode reads its server password only from its environment, so a same-user process that reads that environment can still drive the server's sessions through OpenCode's own API; OpenCode has no kernel sandbox; and a process allowed to read another process's memory can reach the key.
- **OpenCode terminals open only in allowed folders, on their own server.** The terminal's folders now pass the same screening as every other CLI run: a stored folder that is, sits in or contains a protected place (EYAS's data, another tool's storage, a vault, the home folder) is left out, the terminal opens in the next allowed folder or the conversation's own workspace, and the terminal says which folder was left out and why. A request naming the home folder gets the workspace. The terminal's own OpenCode server gets a port and password of its own; it no longer receives the headless server's password, so nothing a terminal's model runs inherits a way into EYAS tasks' sessions.
- **OpenCode capture follows `memory.l0.captureToolResults`.** Settled OpenCode tool results of a task (once per call; a call that ran and failed is recorded with its error and marked `isError` / outcome `error`, a refused call is not recorded) and terminal output are recorded only with the switch on (default off), as `tool_result` rows with trust `ingested`, in the conversation's project and with OpenCode provenance, never recalled word for word. Terminal output is recorded only for the terminal user's own existing conversation. The separate event, answer and diff saves are gone: the answer and diffs are the `opencode_run` result. Before, terminal output and OpenCode events were stored regardless of the switch and without a project.
- **OpenCode model and reasoning variant are settable.** A new 'Model and reasoning' card on the OpenCode page picks the model and reasoning variant for tasks the assistant delegates to OpenCode (`opencode_run`). Both lists come from the running OpenCode server's own `/config/providers`; the variant select appears only for models that have variants, and standard names use EYAS's effort labels. Both values are forwarded on OpenCode's `/session/:id/message`. A variant the model does not offer, or one that cannot be verified, is dropped with a warning rather than reported as applied. The task result's `effective` names the model and variant OpenCode actually ran, including its own default when none is set. New `GET /api/v1/opencode/models` (read OpenCode; never returns provider credentials, never starts the server); `PUT /api/v1/opencode/settings` takes `model`/`variant` and now answers `400` to any malformed body. The OpenCode terminal keeps its own model picker.

### Memory

- **Agents read and write memory only through EYAS.** Core rule 8 now forbids reading as well as writing any other tool's memory (`~/.claude`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium`, OpenCode's data folders, ai-memory folders, Obsidian vaults) and creating memory files in working folders or the EYAS data folder; the "MEMORY.md inside the workspace" loophole is gone. The master identity no longer tells agents to update `MEMORY.md` or `memory/YYYY-MM-DD.md`: EYAS records memory, recall sits in the prompt's Memory section, drill-down is `memory_search` → `memory_expand`, and agents cite `[source:<id>]`. Unedited locked master sections refresh on start, including rows still on the 0.8.16–0.8.23 `save_memory` rule; owner edits are kept.
- **`workspace_append` / `workspace_edit` no longer write memory files.** They edit only `AGENTS.md` and `TOOLS.md`. The Workspace tab marks `MEMORY.md` as owner notes that are never sent to the model.
- **Memory drill-down is 3 calls per answer, on every provider.** `memory_search`, `memory_expand` and the `search_memory` alias share one budget per answer turn, keyed by a turn id the agent runner stamps and the CLI-MCP bridge binding carries. It no longer runs out mid-answer in a long CLI loop or spills into the next user turn (it was a 90-second window per conversation). Outside MCP clients keep 3 calls per 90 seconds; Claude Code's in-process bridge now carries the turn id too (see Claude Code runtime).
- **Drill-down is project-locked on the server.** The tools resolve the scope from the conversation row — its project, its type and global memory. A project from the model, a CLI or a bridge is ignored; an unknown conversation fails closed with 'memory scope unresolved'; external MCP clients read global memory only.
- **One project scope for every recall reader.** KNN partitions, hydrate, `memory_expand`, vault and raw FTS and the standing index apply the same rule: own project, its type, global, never another project; a conversation without a project gets global memory only. Vectors are filed under their project when written, and a one-time batched boot pass moves the existing ones (retried at the next start if it cannot finish). Vault notes that name a project are scoped to it whatever their kind.
- **Standing memory lines carry ids.** Index lines show `(vt:<path>)` / `(gs:<id>)`, which `memory_expand` opens; `memory_expand` gains `en:` entity ids (name, type, aliases, up to 10 current facts). The gist lines are pinned summaries, the project's own summary and up to 5 recent sibling tasks — never another project's or the current conversation's own (previously the top 20 summaries of any project).
- **The memory vault follows `EYAS_DATA_DIR`.** The vault is now always `<data dir>/vault`; it used to stay in `<home>/data/vault` even when `EYAS_DATA_DIR` moved the rest of the data. On the first start of such an install the old notes are copied once, only while the new vault holds no note — staged, never moving or deleting the old folder, never overwriting, retried at the next start if it fails. `eyas doctor` gains a 'Vault' line. The Data Port undo reads raw notes from the vault path the memory module publishes, and the vault watcher ignores dot-entries only inside the vault, so a vault under a hidden folder is still watched. The unused `memory.vault.path` key is gone.
- **L0 memory schema v2 (groundwork).** `memory_raw.source_type` also accepts `thinking` (and nothing else — there is no `compaction` type). Existing databases are upgraded once at boot by a single-transaction table rebuild (`memory_meta.schema_version` 1 → 2) that keeps every rid, blob reference, FTS rowid, tag and index; a failure rolls back, is logged and is retried at the next start, and meanwhile the ingest drops only the `thinking` units the old table would refuse. Extraction never reads `thinking` rows, but its watermark moves past them. These rows back the default-off `memory.l0.captureThinking` switch (below).
- **Claude Code delegated answers are no longer extracted twice.** The run's stored text (narration + final answer) and its final `result` counted the final answer twice in importance, topics and the gist. `preferGranularTurns` now also matches a suffix of at least 40 characters and keeps only the leading narration. L0 is unchanged.
- **`tool_executions.run_id`.** Each executed tool call records the supervised run it belongs to (additive column).
- **Vendor-neutral memory code and tests.** Comments and fixtures use fictional names only, a guard test keeps the memory module that way, and memory graph topic grouping no longer has special clusters for particular names. The live-database eval is replaced by a synthetic hu/de/en recall eval with a per-language R@5 floor.
- **Recall arrives with your message, the same way for every model.** What EYAS recalls for a turn is one fenced `<eyas-memory>` block inside a `<turn-context>` frame attached to the current user message, never the system prompt: standing notes (each with its id), then notes retrieved for this message, then the full text of the best matches. It is built once by `ctx.memoryRecall` (memory/v2/assemble.ts), which composes the query itself and takes the memory scope from the conversation, fail closed; `ctx.memoryAssemble` is removed. Bodies are fenced per item with id/source/trust, and control tags (`<system>`, `</eyas-memory>`, `<turn-context>`, …) inside recalled or teammate text are defanged by one shared fence (`fenceUntrusted`). Only the copy sent to the model carries the block; the stored message is untouched.
- **Every run gets the same recall.** Chat, background runs (board bot, retries and resumes, God Mode workers), specialists and delegated agents, pipeline stages, team members, owner-voice channel replies and OpenCode tasks all receive the block. A chat with no colleague and no project default agent still gets it. A `system` override in the message request replaces only the system prompt. A resumed run gets a fresh block.
- **No pushed owner memory for outside readers.** A2A peer tasks and channel replies whose voice scope is External get the date and time only; an unresolvable voice scope counts as External. The memory tools are unchanged.
- **The clock moved into the turn block.** Date and time (`i18n.timezone`, else the server's zone) leave the system prompt's runtime section, so the prompt prefix and suffix stay byte-stable across turns.
- **The recall block is budgeted to the model.** `memory.index.budgetChars` (default 2400 at a 100k-token window, scaled with the window up to 2.5×) now caps the whole block, frame included; `config/default.yaml` ships 2400 as well (it shipped 8000). Standing notes leave up to half of it to what was retrieved for the message. The 'N more notes' trailer and the drill-down hint name tools the way the host lists them (`mcp__eyas__…`, Grok `use_tool` `eyas__…`, the `eyas` MCP server), never `search_memory`. A model without tool access gets no hint and up to four expanded notes instead of two.
- **Legacy recall removed.** The system-prompt 'memory index' and 'Related prior work' appends, the `ctx.memoryIndex` / `ctx.relatedWork` accessors, `memory/related-work.ts`, `memory/context-builder-v2.ts`, `memory/search/context-builder.ts` and the `memory.relatedWork.*` settings are gone (an old `local.yaml` still loads; the keys are ignored).
- **One access-log row per recalled item.** `memory_access_log` gets a row per injected id (retrieved first) with that item's own token estimate and `rank_detail_json` {turnId, providerId, modelId, tier, rank, score}; previously the whole section's size was logged against every id.
- **Context inspector: new `turn` zone** with `turn-time` and `memory-recall` sections. Every entry path records the model's context window and the prompt budget total; the composition's delivery record lists the recalled ids and why recall was withheld (external audience, no budget, unavailable, failed).
- **Master prompt points at `<eyas-memory>`.** The identity's memory bullet and core rule 8 now say recall arrives in the `<eyas-memory>` block of each message. Locked master rows holding the previous text refresh on start; owner edits are kept. A model without tool support is told that this block is all the memory it gets (see Prompt / models).
- **One recall query on every path, read in your language.** Chat turns and background runs search memory with the same query: your message (else your last one), your previous different message (≤ 400 chars), the conversation title (≤ 120, placeholders skipped) and its goal (≤ 400). At most 1,200 chars, your message first, repeats dropped, never another conversation's text. A short reply now recalls the task under discussion, and a background run of a conversation without a goal searches by its title. The query language is detected from the query, else from the conversation's dominant language in the raw record, else every stop list applies — never hard-coded to English — so Hungarian, German, Spanish and French function words no longer count toward the two-stem lexical gate, and Klingon queries get the lexical up-weight. `memory_search` queries resolve their language the same way.
- **Recall always embeds locally, and new memory is searchable within seconds.** Recall runs on the local embedder on every install, whatever chat provider is used: multilingual-e5-small, else the hashed stem embedder. The 'Embedding' routing tier now feeds only the legacy vault/episodic search index, so configuring it no longer disables vector recall or sends summaries and facts to that API. A new incremental L3 worker embeds the gists and facts each flush extracts, instead of only at boot, drops the vectors of superseded, tombstoned, quarantined and secret-marked owners, and applies the live-index cap. The legacy index is re-embedded only when its own embedder changes. `eyas doctor` gains a 'Memory embedder' check.
- **Imported secrets stay out of recall, and so does everything EYAS derives from them.** A vault note or episodic memory tagged `contains-secrets` passes the tag to its raw-layer copy, to every fact extracted from it and to every summary built from it; a fact that a tagged source confirms later is tagged too. Unless `memory.recall.includeSecrets` is on, none of them is embedded, listed in the standing memory lines, returned by `memory_search` or `GET /api/v1/memory/search`, or opened by `memory_expand`. Before this, the derived facts and summaries could reach the model through `gs:`/`ft:`/`rw:` ids. On the first start after the upgrade, EYAS marks the rows already derived from tagged notes and episodes, once, and again when a further source is tagged. Markers are never removed automatically.
- **Trust comes from the author, not the role.** Only what you type in a conversation is stored at 'owner' trust. A delegated task, a handoff brief and a prompt-coach/enhancer seed are stored as 'derived'. Channel and A2A senders are 'peer'. A user-role message with no author defaults to 'derived'. Before this, every role 'user' row was owner trust, so seed and delegation lines like `key: value` minted owner-trust facts. Every L0 chat row now records `author`, `entryPath` and `agentId` in its provenance.
- **Background and team instructions are remembered.** A background card's goal and a team member's brief were only ever sent to the model and never stored. They are now captured as derived user messages, once per distinct instruction, with a deterministic id, so a retry or resume adds nothing.
- **Vault notes carry their author's trust and their project.** `vault_index.trust_tier` is derived by the indexer: frontmatter `origin`, the `auto-consolidated` tag or a capture link make a note 'derived'; frontmatter `trust` can only lower it, and `trust: quarantined` keeps the note out of the standing index and `memory_expand`. L0 migration now takes trust, project and project type from the index instead of 'owner' and global, and a source with no conversation row is extracted under its own L0 scope, so a project note's facts stay in that project.
- **One-time vault provenance repair.** At the first start after the upgrade, a one-shot pass corrects the trust and project of vault notes already in the raw record, tombstones their facts and summary and rebuilds them, in one transaction per note; a note that fails is retried at the next start. The indexer also re-reads every note once to fill the new trust column.
- **Recall ranks by relevance first, with real age and stored trust.** Past-message (`rw:`) and vault (`vt:`) hits carry their own timestamp (the message's time, the note's `indexed_at`) and their stored trust tier instead of 'now' and 'owner'. The raw and vault keyword lists are merged by bm25 normalised per list, so neither table always wins. The whole candidate pool is reranked before the limit cuts it: relevance min-max-normalised over the pool, 0.35 relevance + 0.20 recency (per day: facts 1/30, past messages 1/90, summaries and notes 1/365, pinned summaries never decay) + 0.20 importance + 0.10 same-task/same-project, × trust (owner/derived 1, ingested 0.6, peer 0.3). Before, relevance contributed at most about 0.006, and truncation came before the rerank.
- **A past-message hit is its own text.** A recalled `rw:` line is the passage of that message around the query words (≤ 280 chars), and the two-keyword admission gate reads the message itself. Before, the gate read the conversation's summary, so a message without a summary could never pass it, and the line showed that summary or only the conversation id. `memory_expand rw:<id>` returns the message's own text (≤ 8,000 chars) with its source type and trust, and the task summary only when it is itself recallable. `GET /api/v1/memory/search` and the `memory_search` fallback show the message's own text too.
- **Untrusted text and reasoning never re-enter recall.** Quarantined past messages, quarantined vault notes, a quarantined task summary behind a past message, and model reasoning (`thinking`) rows are never returned by recall, `memory_search` or `GET /api/v1/memory/search`, nor opened by `memory_expand`. A vault note's raw-record copy is no longer returned next to the note.
- **Recorded tool calls are never recalled or quoted.** A `tool_result` row (`memory.l0.captureToolResults`: the call's output, with its arguments kept beside it, both stored verbatim and unredacted) is never returned by recall, `memory_search` or `GET /api/v1/memory/search`, never opened by `memory_expand`, and never quoted in the conversation's heuristic summary (`NEVER_RECALLED_SOURCE_TYPES`; `extract/gist.ts`). Only its output still shapes topics and entities; the arguments shape nothing. Without this, now that a past-message hit shows its own text, a password typed by `browser_fill`, a token a command printed or a fetched page would have come back verbatim in another conversation's prompt, remote models included, and fetched text would have bypassed the poison gate model-written notes pass.
- **One tool-output switch for every model.** `memory.l0.captureToolResults` (still off by default) now records the output of every tool an agent run calls, whatever the provider: EYAS's own tools, EYAS tools a CLI calls over the bridge, and the built-in tools of Claude Code, Grok and Kimi, which were never recorded before. Capture reads the runner's normalized `tool_result{outcome, executedBy}` stream (`memory/v2/run-capture.ts`) instead of the tool executor's log; `tools/l0-capture.ts` is deleted.
  - One `tool_result` row per call that ran: the content is `{tool, output, isError, outcome, executedBy}`, trust `ingested`, actor `tool:<name>`. The call's arguments (first 2,048 characters) are kept on the row as provenance (`meta_json.input`): never full-text indexed, never turned into topics, entities or facts.
  - Refused, skipped and approval-waiting calls are not recorded, and neither are empty results or repeats of the same call. Failed calls are recorded, marked as errors.
  - `toolResultMaxBytes` caps the record of what the call returned (tool name and output); the arguments are clipped separately.
  - Tool calls outside an agent run are no longer recorded.
- **`memory.l0.captureThinking` (default `false`).** Model reasoning, one `thinking` row per model call (trust `derived`): audit only, never extracted, never recalled. A startup warning is printed while it is on. Both switches are read per run through one capture policy (`setCapturePolicy`/`capturePolicy`).
- **One provenance shape.** Every run-captured row carries `{origin:'agent_run', provider, model, agentId, entryPath, sessionId}`, where provider and model are the pair that answered that model call, not the requested one. The runner's `LlmResponse` event records `response.provider`, `response.model` and `entryPath`, so background, team and delegated replies in L0 name the model that actually answered and how the run started. `AgentRunOptions.entryPath` is derived from the request origin when not given (A2A tasks say `a2a`).
- **Model-written notes pass the instruction filter.** The per-turn capture, the nightly consolidation summaries and the team-session notes now go through the same poison gate as facts and gists (`memory/v2/model-write-gate.ts`), and any detector hit refuses the write. A refused capture note is recorded as a `poison_gate` capture run (it counts against `maxPerConversation`). A refused consolidation summary keeps its cluster for the next night. A refused team entry is left out of the note. The log names the detector, never the text.
- **Model-written notes say who wrote them.** Capture, consolidation and team-session notes carry frontmatter `origin` (`by`, provider, model, conversation) and are indexed with `derived` trust.
- **Memory capture on every run path.** Durable-fact capture (vault notes) now runs on specialist, delegated and pipeline runs, A2A tasks, team members and channel replies too, not only on chat turns and background cards. All paths go through one entry (`memory/capture/run-end.ts`) with the same gate, per-conversation cap and run row; a run that answered nothing writes no row, and `memory_capture_runs.entry_path` records which path a row came from. Channel and A2A messages are read as a third party's words: they never create `user` or `feedback` notes, their notes are stored at peer trust (`trust: peer`), they never reinforce your own notes, and the length gate counts only the sender's words. Delegated tasks, team briefs, hand-off briefs and card goals are read as task instructions, not as your own words. A specialist or team member has its own `maxPerConversation` ceiling (its own sub-conversation); a channel conversation shares one. God Mode workers are captured on their own runs; only the race's own post-turn block stays out. Every specialist, team member and channel reply whose instruction is at least `minUserChars` long can now spend one extra background model call. `memory.capture.enabled: false` still turns all of it off.
- **Shared memory blocks are retired.** `memory_block_read` and `memory_block_write` are removed from the tool surface. On the first start, every `memory_blocks` row is copied once into L0 as a global, derived document (`blocks_migrated_v1`; instruction-shaped blocks land quarantined) and is recalled like any other memory. The table is kept. Agent tool lists that name the old tools simply lose them.
- **`memory.engine` means what it says.** It gates deterministic extraction only; recall is always v2. There is no behaviour change, only the corrected description.
- **Recall engine card on the Memory page.** The Overview tab shows, read-only, what every model recalls through: the local embedder (multilingual e5, or the hashed fallback, with its model id); how many of the summaries and facts recall can return already have a vector ('X of Y'); when the vector worker last ran; how many project and project-type partitions hold vectors; whether the raw record, tool-output capture and reasoning capture are actually on; `memory.recall.includeSecrets`; and the recall budget at a 100k-token window. It is backed by `GET /api/v1/memory/engine` (read on MemoryEntry: owner, admin, user and agent; guests get 403), which returns counts and flags only, no memory content. Six languages.
- **Quarantine a provider's memory (owner only).** A card on Memory › Overview hides from every model what one provider wrote.
  - Hidden: its replies and tool output (by the provider recorded on each row, else the conversation's pinned provider), the facts and summaries derived from them, and the capture notes of those conversations, which move to `<vault>/.quarantine/<id>/`.
  - Pick providers and an optional date range, preview the counts, confirm inline.
  - Nothing is deleted. Release restores the exact previous trust levels and moves the notes back; a note whose path is taken returns as `-restored.md`.
  - The owner's own messages are never touched. Re-applying the same selection is a no-op.
  - Routes (`delete` on MemoryEntry, so owner only; Zod bodies): `GET/POST /api/v1/memory/quarantine`, `POST /api/v1/memory/quarantine/preview`, `POST /api/v1/memory/quarantine/:id/release`.
  - Each apply and release is audited (`memory.quarantine.apply` / `.release`) and recorded in `memory_purge_log` (reasons `quarantine` / `quarantine_release`).

### Privacy

- **The scanner no longer mistakes dates, IDs and versions for personal data.** Scanner v2 is deterministic, synchronous and line-bounded. Dates in every common layout, clock times, ISO timestamps, IP addresses, versions, amounts and record/ticket/build/timestamp ids never match, so the prompt's `- Current date:` line and dates in memory reach the model intact instead of `[PHONE]`.
- **Real validators instead of loose shapes.** IBAN: mod-97 and exact length for every registry country (was Hungary only). New `bank_account` type: HU giro 8-8(-8), 9-7-3-1 checksum (blocked like `iban` by default). Hungarian tax number, HU VAT number and personal tax ID: checksums, and the personal tax ID also needs a whole-word tax-ID word (no more `tin`-in-`routine` hits). TAJ check digit, Luhn cards with a network prefix, SSN area/group/serial. Phone numbers need a `+`, a parenthesised area code, the Hungarian national format or a phone word on the same line.
- **NER scanner removed.** It sent prompt text to a local Ollama outside the model gateway and gave nondeterministic results. A legacy `ner` entry in `privacy.yaml` is ignored with a warning. Custom patterns are the extension point: they are line-bounded, unsafe or non-compiling patterns are skipped and logged, and an empty-matching pattern can no longer hang the scanner.
- **Policy v2: one mask function, stored in the database, hot-reloaded.** A per-type action map (`off` / `warn` / `mask` / `block`; defaults: email/phone mask, iban/bank_account/tax_number/personal_id/credit_card/ssn block, taj_number warn), custom patterns with their own action, `localHosts` (up to 32) and `audit`, validated with Zod and stored in `privacy_policy`. `config/personality/privacy.yaml` is the seed and is re-imported on change, without a restart, until the first save from the UI. A missing or invalid file is logged with its path; the last good policy is kept instead of silently falling back to defaults. The legacy `rules` format still loads (first match wins, `sanitize` → mask, `auto_local` → mask with a warning).
- **Masking never blocks a model call.** A block-class value anywhere in a prompt used to fail the whole turn with 'Privacy policy blocked request'. It is now masked as `[IBAN]` and the turn continues; memory capture no longer fails on it either. `block` is kept as the class used to refuse new inbound messages (below). `auto_local`/`routeToLocal` is removed.
- **Masked in the gateway, per attempt and per destination.** The privacy filter sits in the gateway's egress slot instead of wrapping `ctx.model`: each attempt — retry and tier-fallback hop included — is masked for the provider it reaches (a local Ollama primary gets raw text, its cloud fallback gets it masked), and so are embeddings sent to a remote embedder and the pre-turn routing check. Locality is the endpoint host (loopback or the policy's local hosts), never the provider id: a remote `OLLAMA_HOST` is masked, a local LM Studio is exempt, CLI providers always count as remote.
- **Section-aware system-prompt scan and memory tool results.** EYAS-generated sections (identity, core rules, runtime date/time, working folders, tool/skill/agent inventories, orchestration directive) are sent as they are; memory, persona, project and skill sections are scanned one by one, and unattributed text is scanned (fail closed). Results of memory-bearing tools (`memory_search`, `search_memory`, `memory_expand`, `search_knowledge`, `get_page`, `read_team_memory`, flagged `ToolImplementation.memoryBearing`) are masked; workspace tool results stay raw. A running turn keeps the policy it started with.
- **Vault notes are masked at rest by the same function** (`PrivacyService.maskAtRest`): dates are kept, mask- and block-class values are replaced. The raw record, gists and facts stay raw inside EYAS.
- **Same memory masking on every tool transport.** Results of the EYAS memory tools, including their error texts, are masked by the privacy policy on every transport that bypasses the model gateway: Claude Code's in-process EYAS tools, the Grok/Kimi bridge, external MCP clients (`/api/v1/mcp/tools/call`) and OpenCode. OpenCode gets masked `opencode_run` prompts, recalled-memory system text and `memory_search` / `memory_expand` answers. One serialisation (`ToolExecutor.renderForModel`) and one mask (`PrivacyService.redactToolOutput`, always remote — a CLI, an external MCP client and OpenCode can run any model, and local hosts do not exempt them) replace the bridge-local copies. Dates and JSON structure are kept, workspace tool output stays raw, and a failed scan withholds the result (fail closed); an OpenCode task then fails before anything is sent. Logs carry types, counts and identity, never values.
- **A message with blocked personal data is refused before it is stored.** A new chat, God Mode or channel message carrying a value the privacy policy sets to `block` (IBAN, bank account, tax number, ID card, card number, SSN, or a custom pattern) is refused when it would go to a remote model. The destination is judged by the model's endpoint host: loopback or a policy local host is exempt; CLI providers, Auto conversations (unless Auto-routing is globally off) and unknown endpoints count as remote, and in God Mode every participant counts (an empty roster is remote). Nothing is stored: no message row, no memory capture, no title, no triage, no model call. Chat answers HTTP 422 `privacy_blocked` with the types and the masked text (never the values), and the composer shows a card with 'Send with these values masked' (`privacy: "mask"`, which stores and sends only the masked text), 'Edit message' and 'Discard'. A channel sender gets a notice in the language they wrote in (six languages), and the inbound event ends `skipped` / `privacy_blocked` with only its masked text kept. Refusals and masked re-sends are audited as `privacy.inbound_refused` / `privacy.inbound_masked`, without values. 'block' never stops anything else: history, memory, tool results and embeddings are masked on the way out.
- **See what the model actually received.** The context inspector now shows, per prompt section, what the privacy layer did on the way to the model: 'masked N · types', 'not scanned (EYAS-generated)', 'nothing masked', or 'local destination — not masked'. It adds an 'As assembled / As sent to the model' toggle, the policy version, and a line of masked memory tool results, including results that Claude Code, Grok and Kimi fetched over the EYAS tool bridge. Per-match `privacy.detected` audit entries are replaced by ONE aggregated `privacy.egress` entry per model call or bridged memory tool result. It is targeted at the conversation and carries the run, agent, composition/turn, provider, transport, policy version, counts per type, sections and tool names, never a value. `GET /api/v1/observability/compositions/:id` returns `composition.egress` and per-section `egress`. New additive columns: `context_compositions.egress_json` and `context_sections.egress_masked/egress_spans/egress_skipped`.
- **Privacy page: policy editor, scan tester, working stats.** `/privacy` now edits the policy in the UI: an on/off switch, an action per built-in type (Off / Warn / Mask / Block, each explained), custom patterns (name, regex, type, action; up to 50), local hosts (up to 32), the audit switch, and Save / Discard with unsaved-change tracking. It shows the policy version and where it comes from (privacy.yaml seed, managed on the page, or built-in defaults), plus a banner for a missing or invalid privacy.yaml. Saving makes the policy UI-managed and hot-swaps it for the next model call. Owners edit; admins get a read-only view. The scan tester shows each detection with its action, whether a new message with the text would be refused, and the text as a remote model receives it. The stats cards count real traffic since the server started: remote calls checked, calls with masked values, messages refused, and messages sent masked on request, plus detections per type and scanner. Scan-tester runs are not counted.
- **API.** `POST /api/v1/privacy/scan` validates its body (non-empty `text`, at most 100 000 characters) and returns `{enabled, rulesetVersion, matches (with a per-match action), inbound {refused, types}, egressPreview}`; `reason`, `routeToLocal`, `blocked`, `blockedTypes`, `warnings`, `sanitizedText` and `confidence` are removed. New `GET`/`PUT /api/v1/privacy/policy`: `PUT` returns `400 {code:'invalid_policy', issues:[{path, code, message}]}` and leaves the policy unchanged on a validation error, and it audits `privacy.policy.updated` with the user. `GET /api/v1/privacy/stats` now returns `{since, egress {calls, maskedCalls, byType}, inbound {checked, refused, masked}, byScanner}`; the old `totalScans` / `detections*` fields are removed.
- **Fixed: the Privacy page bounced to login.** `privacy` now starts after `auth` (a declared dependency), so its routes run behind the authentication middleware, and `/api/v1/privacy/*` is paired with authenticate + CSRF protection like the other admin APIs. The two matching known issues are resolved: the login bounce, and privacy's place in the CSRF-pairing debt list (now 16 segments).

### Conversations / continuity

- **Continuity is EYAS replay only.** Every turn replays the whole conversation from EYAS's own store; Claude Code, Grok CLI and Kimi Code CLI never keep or resume a session of their own, so a conversation keeps its context across a provider or model switch. Claude Code runs with `persistSession: false` — EYAS runs no longer write transcripts to the host `~/.claude/projects` (older ones are not deleted) — and no query sets `resume`. Grok/Kimi ACP always use `session/new`, never `session/load`, and the prompt always carries `<conversation-history>`. `ModelRequest`/`ModelResponse.sessionId` and `ProviderRunError.sessionId` are removed; the `claude_code_sessions` table is dropped at boot. Conversations lose `sdkSessionId`: a PATCH that sends it is ignored, and stored ids are cleared (the legacy `sdk_session_id` column stays inert on existing databases; fresh installs do not get it). The Claude Code turn cost is trusted per turn; the resumed-session re-estimate is gone.
- **Raw model endpoints are validated.** `POST /api/v1/model/complete|stream` accept only `provider`, `model`, `messages` (1–1000, `user`/`assistant`, string or text/image blocks), `system`, `maxTokens`, `temperature` (0–2) and `stopSequences` (≤ 16). `sessionId`, `metadata`, `cwd`, `isolated`, `tools` and `thinking` are stripped, so these calls are governed as autonomous. A bad body returns `400 ValidationError` with `issues`.
- **Every conversation has a working folder.** A conversation with no Folders gets its own EYAS workspace on create, whatever the project and even when the request sends an empty folder list (previously only inside a project without folders), and lazily on its next message (legacy rows, cleared Folders). **No folder** now appears only when the workspaces location cannot be written. User-chosen Folders are never replaced.
- **Projects no longer require working directories.** The project form saves a project without folders (the field lost its asterisk and the 'at least one directory' refusal), and `POST`/`PATCH /api/v1/projects` accept an empty list: a new project then takes its type's folders, if any, and an edit clears the project's own. Conversations in a project without folders work in their own EYAS workspace; the seed-project hint says so instead of warning that file tools will refuse. Folder paths are still validated.
- **Workspaces leave the git checkout.** On a source install the data dir sits inside the EYAS clone, and a CLI started there adopted the repository's instruction files, git status, permission rules and per-project memory. Workspaces now live at `EYAS_WORKSPACES_DIR`, else `<data dir>/workspaces` when no git work tree encloses it (Docker, Kubernetes, packaged — unchanged), else a per-instance folder in the user's application-data directory (`~/Library/Application Support/eyas/<instance>/workspaces`, `$XDG_DATA_HOME|~/.local/share/eyas/…`, `%LOCALAPPDATA%\eyas\…`; `<instance>` = home folder name + a hash of the data dir). A one-time, idempotent boot migration moves auto-created `<data dir>/workspaces/<id>` folders and repoints only those Folders; a name clash leaves the old folder in place with a warning.
- **CLI runtime seam (`src/modules/model/cli-runtime/`).** An allowlisted child environment (`buildCliEnv`: no `{...process.env}`, host `CLAUDE_CODE_*`/`GROK_*`/`KIMI_*`/`XDG_*`/`EYAS_*` switches and other vendors' keys dropped, `GIT_CEILING_DIRECTORIES` = workspaces root); EYAS-owned CLI homes (`data/cli-homes/<provider>`, 0700); one cwd resolver, `resolveCliCwd` (stored folder → conversation workspace → `_runs/<runId>` scratch, never `process.cwd()`, the install root or the data dir; stale scratch swept after 7 days); an isolation-status store with `CliIsolationError`, a new terminal model error kind `isolation` (code `cliIsolation`, never retried or failed over); and one executable resolver (override env → PATH → SDK-bundled last resort). Every CLI provider now spawns through it (see below).
- **Backups skip CLI session stores.** `data/cli-homes/*/sessions` is excluded from the local backup archive.
- **Folders that would expose memory or credentials are refused.** One validator (`validateWorkingDirectories`, on the memory-sovereignty path policy) checks conversation Folders, project working directories and project-type folders on every save, and every stored folder again before a CLI (Claude Code, Grok, Kimi, OpenCode) starts in it.
  - Refused, with a translated reason that names the folder: the filesystem root, the home folder or any folder above it (`home`); another AI tool's store or an EYAS-owned CLI home (`providerHome`); an Obsidian vault, an `ai-memory` folder or a `security.foreignMemoryPaths` entry (`vault`); EYAS's data folder outside its work areas, including the workspaces root itself (`eyasData`); `.ssh`, `.env`, `master.key` or the database folder (`sensitive`); relative paths (`notAbsolute`), missing folders (`notFound`) and files (`notDirectory`).
  - The API answers `400 {error, code, path}`. A malformed `workingDirectories` is a `400` without a code.
  - A new conversation with a refused folder is no longer created. The project-type form now shows save errors.
- **A folder is judged by what it contains.** Conversation, project and project-type Folders are refused when they are, or contain, EYAS's own home, data folder, database or workspaces folder (`containsEyasData`), another AI tool's storage or an EYAS CLI home (`containsProviderHome`), or a notes vault, ai-memory folder or `security.foreignMemoryPaths` entry (`containsVault`). The `400` body now also carries `found`, the protected place inside, and the message names it in six languages. A CLI reads inside its working folder without asking, so the EYAS checkout that holds `data/` and a `~/Documents` that holds a vault are no longer accepted; choose a narrower folder. New `PathPolicy.protectedWithin` uses the same reach as the search-scope check. Nested vaults and memory folders are found by a bounded scan (8 levels, 2000 folders).
- **Stored folders that are now refused are left out of every run, visibly.** Folders saved earlier are not rewritten. The agent runner (and the chat route without a runner) screens a conversation's stored folders before the first model call. A refused one is removed from EYAS's file tools, the gate and the CLI's working folder (Claude Code, Grok, Kimi, OpenCode), and the turn shows the `folderRefused` notice (six languages); background card, team and specialist runs log it only. The system prompt no longer names it. Missing folders are unaffected. With every stored folder refused, EYAS's file tools have no folder and a CLI works in the conversation's own workspace. Kimi Code CLI uses the same rules, unverified on a host.

### Conversations / model binding

- **Conversations keep their model.** No more per-turn re-routing: every interactive turn used to be triaged, whatever model the conversation or its colleague had. Now a conversation is fixed to a model. A new one without a model gets the install default (Standard tier → default provider → first active provider with an enabled model, CLIs included) on its first message and keeps it when the defaults change later; existing rows keep their stored pair. New column `conversations.model_binding` (`pinned` | `auto` | `inherit`), migrated once: rows with an agent or a parent become `inherit`, all others `pinned`. `POST /api/v1/conversations` no longer stamps a tier/default pair (the ladder that skipped CLI providers is deleted) and stores a named pair only when it is an enabled model of an active provider; the `routingTier` body field is gone. `PATCH` validates `modelBinding` and `providerId`+`modelId` (both or neither) with coded 400s (`model_binding_unavailable`, `binding_inherit_needs_agent`).
- **Triage runs only for Auto-routing conversations.** The global Auto-routing switch now only allows Auto; while off, an Auto conversation uses its stored model with a note. The decision engine makes no triage call when every tier it could pick resolves to the same model. The dead explicit-override branch of `route()` is removed.
- **Colleague conversations follow the colleague's model.** Agent-bound conversations and sub-conversations resolve agent model > stored pair (source `parent` for sub-conversations) > default fixed on first use. An unavailable agent model falls back with note `agent-binding-unavailable`. A stored model that is no longer available (switched off — e.g. by a CLI discovery reconcile — or its provider off) runs the turn on the install default with note `stored-binding-unavailable` and stays stored, so it answers again once it is back; only with no default either does the turn fail with `400 model_binding_unavailable`. No model at all → `no_model_configured`. The chat shows these coded 400s translated (six languages), and the top bar shows the effective model (the pending default of a new conversation, the fallback with its reason); "Auto-routing" appears only on an Auto conversation.
- **The answering model is recorded and exposed per turn.** `agent_start` carries `binding` {providerId, modelId, source, tier?, note?}. The saved assistant message stores the pair that answered (a tier failover included). `GET /api/v1/conversations/:id` and the `done` frame carry `effectiveBinding` (with `supportsImages`), and the context window is sized for it. One resolver, `model/binding.ts` `createBindingResolver`, is published as `ctx.modelBinding`; the prompt wizard's delivery default reads it.
- **Conversation model picker.** The top bar's read-only model label is now a picker. The choices are a fixed model (every enabled model, grouped 'Fixed model · <provider>'), Auto-routing (offered only while 'Allow Auto-routing' is on; otherwise greyed out with a hint) and, on colleague conversations and sub-conversations, 'Colleague default (<model>)'. A new agentless conversation reads 'Default model — fixed on the first message'. The tooltip names the model the next message answers with and why; a warning icon marks a fallback or an unavailable model; in God Mode the picker is dimmed. Choosing an option PATCHes `{modelBinding, providerId?, modelId?}`. `GET /api/v1/conversations/:id` adds `autoRoutingEnabled`. The dead `ConversationHeader` component and its `conversations.header.*` keys are removed.
- **A model you pick is never swapped silently.** A pair chosen in the picker (new column `conversations.model_user_chosen`, set only by a PATCH that sends a pair, never writable by the client) fails closed with `model_binding_unavailable` when it becomes unavailable. This covers the chat route, `effectiveBinding` and background card runs. The error is translated and points to the picker. Pairs EYAS fixed itself (the materialized default, rows from before the picker, a delegating turn's pair) keep the default-with-note fallback.
- **Every reply names who answered.** Assistant messages show 'Provider · model' (from the stored provider/model; the tooltip adds the rule from `turnMeta.binding`). The streaming reply shows it from `agent_start.binding`; God Mode replies show the winner.
- **Agents run on a provider+model pair; empty means the conversation's own model.** `agent_definitions.provider` is new. It is backfilled once on upgrade where exactly one catalog lists the model id; ambiguous ids and tier aliases stay provider-less and are resolved at run time. Specialists (`run_specialist`), `assign_task` cards and `create_sub_conversation` children store the delegating turn's effective model and never copy the parent's raw pair; the turn's binding reaches bridged tools of Claude Code, Grok and Kimi too. Team members run on their own model, else the lead's current model; background cards and channel replies take provider and model from one binding. A default is fixed on the conversation at first use. An unavailable agent model falls back to the stored or default model with note `agent-binding-unavailable` (recorded in the reply's turn metadata), never to a provider picked by name. Every non-chat entry path (delegation, team members, background cards, God Mode children, channel replies) resolves through the same binding resolver as the chat route. `POST`/`PATCH /api/v1/agents` accept `provider` with `model` (a pair must be an enabled model of an active provider, else 400 `model_binding_unavailable`). `PUT /api/v1/model/agent-assignments` accepts `{providerId, modelId}` or a legacy model id (400 `unknown_model` for a model not in the catalog); the setup wizard's AI-models step follows the same rules and its proposals carry `proposedProviderId`.
- **Agent and assignment models are provider+model pairs in the UI.** The agent editor's model picker encodes both ids, calls the empty choice 'Conversation's own model' and warns when the saved pair is not an enabled model of an active provider. It sends the model only when it changed, and clearing it now saves. Settings → Model assignments and the setup wizard's AI-models step show each choice as *Provider / model* and send `{providerId, modelId}` (the wizard pre-selects the proposed pair and gains a *— none —* choice; before, it posted bare model ids, so an id two providers list was stored without a provider). The Agent Wizard no longer pins `anthropic/claude-sonnet-4-20250514`. The Providers switch is labelled 'Allow Auto-routing', with a hint that it never re-routes fixed or colleague-default conversations.
- **Home threads, channel and A2A conversations follow their colleague.** A handoff home thread no longer copies the handing-off conversation's pair. Channel and A2A conversations are created as colleague conversations (A2A creation also lacked a userId, which the table requires; fixed), and channel replies record the provider/model that answered. God Mode workers are pinned to their roster pair. Board cards (`POST /api/v1/projects/:id/conversations`) store a pair only when it is an enabled model of an active provider. The Prompt Enhancer's default target is the parent's effective model.
- **No model configured is a coded error.** An unpinned call with no install default fails with `no_model_configured` (a coded, never-retried `invalid-request`), localized like the chat route's 400.
- **The Anthropic-only team model router is gone.** `model-router.ts`, `TeamConfig.modelRouting` and the `autoRouteModel` argument are removed. Team members without a model no longer silently run on the paid Anthropic API in installs that have an Anthropic key.

### Reasoning effort

- **Effort is resolved per call, against the model that answers.** The model gateway resolves the level after routing, retry and failover. Unsupported levels are clamped to the nearest one the model accepts, and models without verified reasoning facts get no reasoning parameter (Auto). A failover to another model re-resolves the level for that model. Precedence: conversation > Deep (max) > agent > delegating parent > routing tier default > model default. Only Claude Code, Grok CLI and Kimi Code CLI confirm the level they ran by reading it back from the runtime; every other provider reports the level EYAS sent.
- **Routing tiers carry a default effort** (`routing_tiers.effort`). Triage, Quick and Heartbeat default to Low (seeded once on upgrade); other tiers are Auto. The tier default applies when nothing higher in the order sets a level, and to background calls (below).
- **Thinking budgets for budget-driven models** are sized from the model's output limit and keep answer headroom (no more max_tokens above the model cap; non-streaming calls stay under the SDK's plain-HTTP limit).
- **Each AI trace records** `effort_requested`, `effort_effective` and `effort_source`.
- **Effort is checked against the model when it is saved.** Conversation `PATCH`/`POST` and colleague `POST`/`PATCH` accept only the canonical ladder (`none`…`max`, `auto`/null = Auto). On a known model, a level it does not support returns `400` with `code: 'EFFORT_UNSUPPORTED'`, the level and the model's `levels`, instead of being clamped silently at run time. Auto-routed conversations, colleagues without a model and models EYAS has no verified data for accept every level (the gateway still clamps per call). Agent `PATCH` moves from a raw passthrough to a Zod partial schema: unknown keys such as `source` are stripped, bad values are `400`, and an unknown agent is `404`. The UI shows the refusal as a translated message.
- **The conversation's Effort menu no longer shows 'Off' for Auto.** Auto (stored as NULL) is the model's or tier's default reasoning; the old 'Off' label, which ran Auto, is gone, and a legacy thinking budget is no longer shown as a level. A refused level shows a translated message with the levels the model supports, in the chat header and in the colleague editor. The colleague editor no longer fails a name or prompt edit on a stored level the model has since stopped offering: an unchanged level on an unchanged model is accepted, and is judged again when the level or the model changes.
- **Effort per model in the UI.**
  - One Effort select in conversations, the colleague editor, each routing tier and scheduled agent routines. It lists only the levels the selected model supports, so Extra high, Minimal and None are now reachable where offered. It updates when the model changes and labels Auto with what it inherits (Deep → Max, colleague, delegating conversation) or the model's default.
  - A stored level the model lacks is shown as "level → effective" in conversations and adjusted visibly before saving in the colleague editor and tier rows.
  - New per-tier default Effort on Providers → Routing (Triage, Quick and Heartbeat default to Low; Embedding has none).
  - Each reply shows the effort it actually ran with (requested → effective, and who set it).
  - The Providers page shows each model's reasoning levels, its default, and whether they were reported by the provider or come from the EYAS catalog (with the verified date).
  - New `GET /api/v1/model/effort-options` and `GET /api/v1/conversations/:id/effort-options`.
  - `PUT /api/v1/routing/tiers/:tier` is Zod-validated: an unknown tier is 404 and an unsupported level is refused with `EFFORT_UNSUPPORTED`.
- **More reasoning models get their real effort levels.** New verified rows in the capability overlay (`src/modules/model/reasoning/overlay.json`, verified 2026-09-24): OpenAI GPT-5.2 and GPT-5.4 mini/nano (None–Extra high, default None); on OpenRouter GPT-5.2, GPT-5.2/5.4/5.5 pro and GPT-5.2/5.3 Codex; on the xAI API Grok 3 Mini (Low | High; it always reasons and shows its reasoning, but xAI no longer lists it). Internal calls that set a token limit and temperature, such as memory capture, now send `max_completion_tokens` and no temperature to GPT-5.2 and GPT-5.4 mini/nano, which could reject them before. OpenAI's Responses-only models (pro, Codex, o1-pro, o3-pro, deep-research) stay Auto-only on the OpenAI provider — use them through OpenRouter — and undocumented ids such as gpt-5.1-mini get no guessed control.
- **Fetched model ids inherit their family's reasoning facts by one prefix rule.** When no overlay row matches exactly, the id is tried again without its trailing release stamps: a date snapshot (`-YYYY-MM-DD`, `-YYYYMMDD`, `-MMDD`), `-latest` or `[1m]` (`releaseStems`, `reasoning/registry.ts`). Variant segments (-mini, -pro, -codex, -chat, -preview, -beta, -fast) are never stripped, an unknown family stays Auto-only, and inheritance never crosses providers.
- **Claude Code: summarized thinking from 2.1.280, and hidden reasoning is stated below that.** `--thinking-display` is verified on the 2.1.280 binary (fixture `tests/fixtures/cli/claude-code/2.1.280/thinking-display.json`), and the free live lane proves it becomes `thinking.display: 'summarized'` on the model request. Discovery records `thinkingDisplay`; on older or unknown runtimes (the SDK-bundled 2.1.89 included) it is false, and the registry reports those models' reasoning as hidden, so the effort select says *This model does not show its reasoning text.* The levels are unchanged.
- **Effort follows the agent everywhere.** The reasoning-effort intent is loaded by one shared loader for every run path: interactive chat, a colleague's home thread, background/scheduled runs, retries and resumes, team members, delegations and specialists, pipeline stages, A2A tasks, channel replies and God Mode. Precedence: the conversation's own level > Deep (Max) > the agent the run speaks as > the nearest delegating parent (inherited, up to five levels). Children without their own effort inherit, so Deep now raises specialists to Max. God Mode copies an explicit level onto every racer, and its review votes use the same intent. Each persisted reply records requested vs effective effort (`turn_meta.effort`); a clamp is recorded, never dropped. The legacy `thinking-resolver` is removed.
- **Background calls use their tier's effort.** Every call through the background model service (`ctx.auxiliaryModel`) carries the effort of its purpose's first routing tier as an intent (`{level, source: 'tier'}`): Heartbeat for memory, learning, titles and the safety checks; Quick for re-planning and team proposals; Standard for research; Triage for the classifier. This holds whichever rung answers (tier, install default, API provider or isolating CLI). With the seeded defaults these calls ask for Low (research: Auto). An Auto tier, or a value that is not on the ladder, sends no intent. The gateway clamps the intent per attempt to the model that answers, and traces record requested vs effective with source `tier`. The tier default is no longer limited to auto-routed messages.
- **Legacy thinking budgets become effort levels, once.** At startup, a conversation with the old `thinking = 'on'` and no effort gets the level its budget stood for (≤5k Low, ≤10k or none Medium, ≤25k High, else Max), and its thinking flag and budget are cleared. Deep conversations keep their Deep → Max default. Off-ladder effort values on conversations and colleagues are reset to Auto (one warning with the count). Conversations no longer expose or accept `thinking`/`thinkingBudget`.
- **Raw model endpoints take an effort.** `POST /api/v1/model/complete|stream` accept an optional `effort` (a ladder level or `auto`), forwarded as a request-level intent. The response and the stream's `done` event carry `effortOutcome` (requested vs effective).

### Conversations / stream

- **One ending per turn.** Both chat paths (the tool pipeline and the direct no-tools stream) feed one turn sink (`conversations/turn-sink.ts`).
  - It stores the reply exactly once, with its turn metadata. That fixes the duplicate reply, duplicate `done` frame and duplicate memory capture when a provider reports 0 input tokens (Grok/Kimi CLI, LM Studio, Ollama).
  - It records the cost once and sends exactly one terminal frame (`done` | `error` | `cancelled` | `parked_for_approval`).
  - It runs the post-turn memory capture once, on every outcome that left text.
  - A failed or cancelled turn keeps its partial answer, never the error text, and its tokens and cost are recorded.
- **Turn metadata on every reply.** `conversation_messages.turn_meta` is added (one additive column). It holds a strict, Zod-validated `TurnMeta`: outcome, stop reason, canonical usage, cost and cost source (`provider` / `estimate` / `unknown`, never $0 when unknown), steps, tool calls, approvals, binding, effort and notices, plus error kind and code on a failure. It is written by the chat route, by delegated/specialist/pipeline runs (`executeAgent`) and by channel replies, and returned as `turnMeta` on messages and on the `done` frame. An invalid value is refused on write.
- **Turn budget 25, or the agent's own Max Turns.** Interactive chat no longer hard-codes 10 turns, which made Claude Code's `error_max_turns` routine. `DEFAULT_AGENT_MAX_TURNS = 25` (`src/shared/turn-budget.ts`) is also the Claude Code, Grok and Kimi providers' default internal cap, and the no-tools path now passes the budget too. Delegated/specialist/pipeline runs (10) and channel replies (20) are unchanged.
- **Stream frames follow the shared contract.**
  - `error` is `{kind, retryable, code?, params?, providerId?, detail, partialSaved}` (`error` became `detail`).
  - `agent_start` is `{agentId, maxTurns, binding?}`, sent on both paths; God Mode no longer sends one (`god_started` opens progress).
  - `tool_use` carries `rawName`; CLI steps arrive as `progress` `{step, maxSteps}` and notices as `notice` `{code, params}`.
  - `done` is `{message, turnMeta, conversation}`.
- **Compaction writes no memory.** The dead PreCompact → episodic hook (`onContextCompact`) is removed from the conversation memory hooks and the memory lifecycle; a CLI compaction is only a `contextCompacted` notice.
- The no-tools path now also attaches workspace outputs, media and Studio renders to the reply.
- **The run tree is the same on every provider.** The agent runner emits the Workflow tree for every run that has a conversation, API providers included; each CLI provider no longer draws its own. The tree shows the conversation's node with the live current tool, the turn count (or the CLI's own steps) and tokens, and when the run ends its status, tokens and cost. A conversation's next message replaces the previous turn's tree, and a run waiting on an approval shows as Paused. Team members show their live current tool on every provider. Removed: Claude Code's orchestration observer hooks (`orchestration-hooks.ts`), `includeHookEvents`, the per-provider run frames, the orchestrator's `tool` progress kind, and the `orchestration` slot of `mergeHooks` (the order is now sovereignty → readback).
- **Grok and Kimi plans are plan steps.** Each ACP `plan` entry becomes a `plan_step` node (checklist icon) under the conversation's node, shown as pending, running or completed, instead of a fake subagent. The shared helper is `grok-cli/acp-plan.ts`.
- **The run cost is honest.** `run_completed.totalCostUsd` is `number | null`: the CLI's own billed cost when there is one, otherwise the reported usage priced with the pricing table (`config.model.pricing` overrides apply), and `null` — shown as '—' with a hover hint — when a provider reported no usage for part of the run. A failed Claude Code run reports what it billed (`ProviderRunError.usage.costUsd`).
- **Run trees replay in order.** Every emitter on a run (the runner, plan steps, the team driver) continues above the run's persisted seq (`createSharedRunSeq`). Run-tree statuses are translated in all six languages and use theme colours.

### Conversations / chat

- **One chat UI for every provider.** The web consumes the shared `ChatStreamFrame` contract (`src/shared/chat-stream.ts`) directly. A tool row settles only on its own `tool_result`, matched by id whatever the row's status, so a late error result is no longer dropped. Rows show one icon and label per outcome (running, succeeded, failed, denied, needs approval, skipped, outcome unknown); a row nothing settled ends as 'unknown', never green. The provider's raw tool name appears as a tooltip. `tool_use_end`, `max_turns_reached` and `agent_done` are gone from the client.
- **Turn outcome, usage and cost under every reply.** An outcome badge appears when a turn did not simply complete: turn limit, output limit, declined by the model, tool budget, stopped, failed, or waiting for approval. The partial answer is always kept, including a failed or stopped turn's streamed text in the live view. Tokens show in/out; the cost shows its source (provider / `~` estimate), and a provider that reported no usage reads 'Usage not reported', never $0. Each reply also shows the effort it ran with.
- **One localized error renderer.** `stream-error.tsx` replaces `stream-error-format.ts`. It shows `conversations.errors.<code>`, else the kind's message through an exhaustive `Record<ModelErrorKind, key>` (so a new kind cannot typecheck without text), else `other`. The raw provider text is shown collapsed, with an 'Open provider settings' link and a 'partial answer saved' note. Refused sends (HTTP) and dropped connections use the same renderer; no English 'Error:' bubbles remain.
- **Approvals in the chat.** `approval_required` and `parked_for_approval` open an inline card with Approve and Reject (`POST /api/v1/autonomy/approvals/:id/{approve,reject}`, same permission as the queue; 403 shows a localized 'not allowed', 409 'already decided') and 'Open approvals'. An approved call runs once when retried with the same arguments.
- **Agent progress that means the same everywhere.** The panel shows 'Step N / Max' only when the provider reports steps, otherwise 'Tool calls: N'. Tokens are summed over the run. The colleague's name is resolved from `agent_start.agentId`, falling back to a localized 'Assistant'.
- **Images are never silently dropped.** When the conversation's model cannot see images (its Vision flag in the model catalog is off: a text-only model, or a Grok/Kimi CLI that reports no image input), each image reaches it as a short text note at its place. The composer warns before sending (`conversations.input.imagesNotVisible`), and an `imagesNotVisible` notice (count, provider, model) is shown under the turn and stored in the reply's `turn_meta`. A model without a catalog row still gets the image. Claude Code now sees images from earlier turns: the replayed `<conversation-history>` is sent as content blocks with each image in place, while a text-only history stays one plain string. URL images reach Claude Code as proper URL sources.
- **Notices** are rendered generically as `conversations.notice.<code>`, live and from the stored reply: `contextCompacted`, `imagesNotVisible` and `cliSandboxUnavailable` have their text in all six languages.
- **Theme tokens `--success` / `--warning`** (with `--color-*` mappings) in `globals.css` and every theme template (light and dark). Tool rows, outcome badges, approval cards, diff lines and the context bar no longer use fixed palette colours.

### Conversations / context inspector

- **The context bar measures, and knows each model's window.** The bar and the board stripe now use the prompt size the provider reported for the last model call (tooltip 'measured'), on Anthropic, OpenAI-family, Gemini and Claude Code. Otherwise they show an estimate that finally includes the conversation history, not only the system prompt (tooltip 'estimated'); Ollama, Grok CLI and Kimi Code CLI always show the estimate. The window is the answering model's own, on every provider: runtime-reported (Claude Code) → the window the prompt was sized for → the model list → the CLI's known window (200k / 500k / 256k, now only a fallback) → 200k. A CLI model listed at 1M is no longer shown against 200k, and prompt sizing uses the same precedence. `context_compositions` gains `observed_prompt_tokens`, `observed_context_window` and `history_estimated_tokens`; every entry path (chat, background, team member, delegated, channel, God Mode review) records them.
- **The context inspector shows what memory reached the model.** The Context composition panel has a new 'Memory delivered' box, the same for every provider. It shows the model and window the prompt was sized for, how many recalled items went into the turn block and how many in full, and their estimated tokens against the recall cap for that window (or why recall was withheld: external audience, no room, nothing to recall, failure). It also shows the turn's memory drill-down calls out of the per-turn cap of 3, and for Grok/Kimi how the system prompt got through (verified system prompt, unverified, or inside the message). `context_compositions.delivery_json` (additive) holds the record. A turn's composition id is now the turn id on both its recall and drill-down access-log rows, and drill-down rows record the call's number within the turn. `GET /api/v1/observability/compositions/:id` returns `delivery` and `drillDown` (`null` when nothing was recorded). A parity test checks that `memory_search` / `memory_expand` answer identically, keep the same project lock and refuse the same ids on the native executor, the Claude Code in-process bridge and the Grok/Kimi ACP bridge.

### Observability

- **Observability shows what each background call was for.** `ai_traces` gains `purpose` and `aux_route` (the auxiliary-ladder rung that answered: `tier`, `default`, `api`, `isolated-cli`). Background calls are the purposes set by `ctx.auxiliaryModel`; conversation turns keep both NULL. The Usage tab's trace table has a **Purpose** column (Memory, Learning, Titles, Safety checks, Planning, Research, Triage; '—' for conversation turns) and a Purpose filter, in all six languages. `GET /api/v1/observability/traces` returns `purpose`, `auxRoute` and a derived `purposeGroup`, and accepts `purposeGroup=<group>`. Its whole query is now Zod-validated: an unknown group, a bad `limit` (1–500), `offset` or `minCost` gets 400 instead of reaching SQL as NaN. Background calls are traced and priced like turns, and count toward the routing budget's spend; that spend sum now lives in `model/routing/spending.ts` `readSpendTotals`.
- **CLI turns count like every other turn.** The Usage tab's Tools count now includes tools a CLI ran in its own loop (Claude Code, Grok CLI, Kimi Code CLI), both built-in tools and EYAS tools called over the bridge, counted once per call; CLI turns no longer show 0. The trace API lists each call as `{name, id}` plus `executedBy` for calls the CLI settled itself. Each trace records which memory layers the turn carried (`memoryTiersUsed`, counts per layer: `vt` vault note, `gs` summary, `ft` fact, `en` entity, `ep` episode, `rw` raw record). A call whose provider reported no usage costs what the provider itself reported, or $0, never an estimate from placeholder counts. Each tool a CLI ran itself also gets a row in the tool execution log, with its run; the completeness critic and the self-learning and efficiency reports count it as tool evidence, and nothing from it is captured into L0.
- **Memory delivery by provider.** A new card at the top of Observability → Context compares, for each provider that answered in the last 7, 30 or 90 days, the turns that carried memory ('N of M'), the average injected items per layer, the average memory tokens and the drill-downs per turn (calls · items), with each provider's latest 10 turns linked to their conversations. Similar numbers mean each model received the same memory; a CLI with fewer drill-downs is not reaching or not using the EYAS memory tools. The card reads the context detail, kept 7 days by default (`observability.contextRetentionDays`). API: `GET /api/v1/observability/memory-parity?days=1..90` (read AuditEntry; 400 on an invalid value).

### Providers

- **Provider panels tell the truth about CLI runtimes and isolation.** The Claude Code / Grok CLI / Kimi Code CLI panels no longer claim that the host Grok/Kimi login, config or memory is used or that "EYAS cannot disable this" (`providers.panel.grokAcpHint`, `kimiAcpHint`, `cliAuthDescPre.grok/.kimi` removed in all six languages; the Claude Code login line and the three card subtitles rewritten). New **Runtime** line: source (host CLI / override / bundled), version, path, SDK version skew, a host CLI an override shadows, an override that names no executable, and *Not signed in* for Claude Code. New **Isolation** block: status badge, last check (kept in memory, reset at restart), localized failed checks, what the live isolation release check proved for the installed version (Kimi: *not yet verified on a host*), and one residual-risk sentence per CLI. **Verify now** for Grok and Kimi runs the load-time checks without a model call (and, when signed in, a prompt-free session start that also refreshes the model list); Claude Code has none, because it is checked at the start of every turn. Kimi stays enabled by default. API: `GET /api/v1/model/providers/:id/isolation` (read Model; 404 for other providers), `POST …/isolation/verify` (manage Model; 409 `verifyUnavailable` for Claude Code or a provider that is not loaded).
- **One 'Refresh models' button for every provider.** The Models section said 'Refresh from CLI' for Claude Code and Grok CLI and 'Refresh from API' for everything else, including Kimi Code CLI — misnaming the source, and for Claude Code suggesting the host CLI supplied the list. One label now, in all six languages; the button still reloads the provider's model list.
- **One provider display source.** Provider names and kinds now come only from `GET /api/v1/model/providers` (`model/provider-display.ts`). Each row, and the `/providers/:id` detail, carries `kind`: `cli` (Claude Code, Grok CLI, Kimi Code CLI), `local` (Ollama, LM Studio, vLLM) or `api` (every hosted API and any unknown id). The web reads names and kinds from one cached fetch (`lib/provider-display.ts`); the eight duplicated name maps and CLI-id lists in the top bar and model picker, the Providers page, provider card and panel, Settings, the setup wizard and the CLI sign-in card and banner are gone. Claude Code reads 'Claude Code CLI' everywhere, and Kimi Code CLI, Kimi and the compatible providers no longer show raw ids in the routing-tier selects or the conversation picker. A viewer who may not read the model catalog (guest) sees provider ids.
- **No duplicate locale keys.** The hu/de/es provider bundles each defined three Grok keys twice (JSON.parse silently kept the last). The duplicates are gone, and the web i18n parity contract now scans every `locales/*.json` for repeated keys at any depth.
- **Gemini runs EYAS tools, including memory search.** Function calls that Gemini ends with `finishReason: STOP` stop for tool use. Results go back under the function's name and Gemini's call id, `thoughtSignature` is replayed with each call, failed tools are sent as errors, and tool-call ids no longer repeat across turns.
- **OpenAI-compatible backends no longer end the tool loop early.** `finish_reason: 'stop'` together with tool calls now runs the tools (openai-compat, Kimi API, OpenRouter). On Ollama, tool results carry the tool name. Stop reasons on Gemini, the OpenAI family and Ollama go through one shared mapper: output-budget stops are `max_tokens` (a truncated call is never run), safety/content-filter stops are `refusal`.
- **LM Studio runs EYAS tools and uses your parameters.** LM Studio sits on the shared OpenAI-compatible provider: tool calls and results reach the model through standard function calling instead of being cut from the history (it used to re-call the same tool until the turn limit). Temperature, max output tokens and stop sequences are sent as set (the fixed 0.7 is gone); the 120 s hard cap is replaced by the client timeout (10 minutes, with retry); `LM_STUDIO_URL` may end with a slash.
- **Stop cancels local generation** on LM Studio and Ollama, instead of generating to completion (Ollama) or for up to 120 s (LM Studio).
- **One stable id per streamed tool call.** OpenAI-compatible backends that stream a tool call without an id get one `call_<uuid>`, used by the chat row, the `tool_use` block and the tool result — no more nameless ghost row plus duplicate on OpenAI, compat, Kimi, OpenRouter and LM Studio.
- **Discovered models keep working, and each row says what it runs.** **Refresh models** now saves what discovery found in `model_config.metadata`: the concrete model (`realModelId`), the alias and the discovery time, so a model found by Refresh keeps running after a restart. A Grok CLI row runs exactly the model it names; the default row sends no `--model` and runs the CLI's own default. The process-local EYAS-id → CLI-model map and the silent `grok-4.5` fallback are gone. Claude Code selects by the row's alias and passes a full model name through; an unknown id is no longer dropped silently. An id that names no model fails the turn (`CliModelIdError`), resolved in one place, `cli-model-id.ts`. The Models section shows **Runs <model>** when it differs from the row id.
- **A refresh reconciles, never deletes.** Rows a successful refresh no longer offers are switched off and marked **Not offered by the last refresh**. They are switched back on when offered again, unless the user switched them off. A failed or empty discovery answers `502` (`ModelDiscoveryFailed` / `ModelDiscoveryEmpty`) and changes nothing, and the panel says so. OpenAI, Gemini, OpenRouter, Kimi and OpenAI-compatible discovery now fail loudly instead of returning the built-in list. `GET /api/v1/model/providers/:id` and `/api/v1/model/models` return `realModelId`, `missing` and the effective `reasoning`.
- **Model-only calls reach discovered models.** An agent or specialist that names only a model known to `model_config` is routed to the single enabled, registered provider owning an enabled row for that exact id (gateway `lookupModelOwner`). Disabled, unknown and ambiguous ids still fail with `No provider found`.
- **Truthful model identity.** `ModelResponse.model` stays the EYAS id (pricing, labels). The new `ModelResponse.resolvedModelId` carries the concrete model the backend reported: Anthropic, Anthropic-compatible, the OpenAI family incl. OpenRouter/Kimi/LM Studio, Gemini `modelVersion` (no longer an empty model), Ollama and Grok CLI. `ai_traces.resolved_model` stores it, and Observability shows **answered by …** under Model when it differs. Background model calls (memory capture runs) are attributed to it.
- **Grok CLI models and effort levels are discovered without a prompt.** The `grok models` probe is gone. EYAS opens a Grok session over ACP in the isolated EYAS Grok home (initialize, session/new, then `session/set_config_option model` for each offered model) and never sends `session/prompt`, so there is no model call and no cost. For every model it reads the `reasoning_effort` option and stores the levels, the default, the CLI version and the concrete model in `model_config.metadata`. It rediscovers on every provider load (skipped while signed out) and on **Refresh models**; a failed discovery changes no row.
- **Grok runs the effort you chose, confirmed by Grok.** The gateway's resolved level is set per turn with `session/set_config_option reasoning_effort` after `session/new` and before `session/prompt` (a plain string value: grok 1.0.41 rejects the documented `{value}` object). The effective level is read back and reported as a confirmed `effortOutcome`. A refused level records what Grok kept; Auto sends nothing and records Grok's default. The host `~/.grok` default effort no longer applies. A pinned model the CLI no longer offers now fails before the prompt (`CliModelIdError`) instead of silently running Grok's default.
- **Reasoning survives the tool loop on Anthropic and Anthropic-compatible providers.** With thinking on (any effort level, or an always-on model), a tool call used to send the continuation without the model's signed thinking block, which the API rejects or answers without the reasoning. The Anthropic API and every Anthropic-compatible endpoint now share one stream consumer (`consumeAnthropicStream`) that captures `thinking` / `redacted_thinking` with the signature in API order. The next request of the same loop replays them byte-unchanged, only to the provider that produced them. A new transient `ThinkingBlock` content block carries them; it is never stored with the conversation, is stripped from a checkpoint-seeded resume (the reasoning restarts once), and is skipped by the OpenAI-family, Gemini and Ollama adapters. A failover mid-loop drops it, which the API allows. Anthropic-compatible providers now report cache read/write tokens when streaming.
- **OpenAI requests opt out of stored completions.** The built-in OpenAI provider now sends `store: false` on every chat completion (complete and stream), so OpenAI does not keep EYAS conversations for distillation/evals even when the account or project default would store them. OpenAI-compatible providers (compat catalogue, OpenRouter, Kimi API, LM Studio) are unchanged.
- **Tool rows settle when the tool has run (API providers).** Anthropic, Anthropic-compatible, OpenAI, OpenAI-compatible, Kimi API, OpenRouter, Gemini, Ollama and LM Studio: a tool row used to turn green as soon as the model finished writing the call, so a failed or skipped call showed success and its error was lost. The providers no longer emit the pre-execution `tool_use_end`.
- **One set of stop reasons.** Every API provider records refusals and safety stops as `refusal`: Anthropic `refusal`, OpenAI `content_filter` and the `refusal` message, Gemini safety-class finishes and blocked prompts. Output-limit stops are `max_tokens`. An OpenAI refusal message is now shown as the answer instead of an empty reply.
- **Usage means the same on every provider.** Input tokens are uncached prompt tokens, and cache reads and writes are counted separately. This fixes the OpenAI/Gemini cached-token double count. Gemini thinking tokens now count as output. OpenAI and Gemini reasoning tokens are also recorded separately. A provider that reports no usage is marked `reported:false` instead of 0 tokens.
- **Cost estimates price every prompt token once.** A cached token for a model without a configured cache rate is billed at its input rate instead of $0, and the Claude Code model aliases got Anthropic's cache rates for runs the CLI did not price. Estimates drop where a cache-read rate is configured (Kimi K3, pricing overrides) and rise for Gemini thinking models. OpenAI estimates with the built-in table are unchanged.
- **Grok and Kimi tool calls look like every other provider's.** Each ACP tool call is one row under EYAS's common tool name (`run_command`, `read_file`, `edit_file`, … or the EYAS tool's name), with its input (an edit's path and old/new text), its output (capped at 64 KiB) and its duration. The row closes only when the CLI reports the call finished (`tool_use_end` is gone from the provider stream). A call EYAS refused is recorded as denied, one waiting on a human as approval required (with its approval id), and a repeat blocked on resume as skipped.
- **EYAS tools reached from Grok/Kimi report their approvals.** When a call that came through the CLI's MCP tool bridge waits for approval, the shared permission bridge reports it with the approval id (a refusal as denied, a repeat on resume as skipped) and stamps the run on the approval. The turn gets the outcome, and a supervised autonomous run parks on it like on a CLI-native approval (see Grok / Kimi tools).
- **Honest ACP usage and neutral errors.** Grok/Kimi token counts follow the canonical meaning, and a turn without reported usage is marked unreported. A CLI turn-limit stop ends as `max_turns` with the partial answer. Error text names the CLI that failed ('Kimi Code CLI', never 'Grok CLI').
- **Anthropic API: current catalog, discovered per key.** The first time an Anthropic API key is present with no stored models, EYAS reads `GET /v1/models` (free list call, no model call; 10 s timeout, no retries). Each model gets its context window (`max_input_tokens`), output cap (`max_tokens`) and discovered reasoning (`capabilities.effort.*`, `capabilities.thinking.types.*` → `model_config.metadata.reasoning`, source `models-api`), merged by the capability registry over the overlay (discovery decides the levels; the overlay keeps default level, can-disable, sampling lock, display). If discovery fails or returns nothing, the built-in catalog is used: `claude-fable-5-1`, `claude-fable-5`, `claude-opus-5-5`, `claude-opus-5`, `claude-opus-4-8`, `claude-sonnet-5`, `claude-sonnet-4-6` (output cap corrected to 128K), `claude-haiku-4-5`. Refresh re-reads the Models API; rows no longer offered are switched off and flagged, never deleted. Existing installs keep their stored list until Refresh.
- **Anthropic API + Anthropic-compatible: capability-driven reasoning mapping.** `applyAnthropicReasoning(params, effortPlan)` replaces the hard-coded `ADAPTIVE_THINKING_MODELS` / `NO_SAMPLING_MODELS` / `EFFORT_BUDGET_TOKENS` sets and `applyAnthropicThinking` / `allowsTemperature`:
  - Auto sends nothing (models that think unasked and hide it get `thinking {type:'adaptive', display:'summarized'}` for visibility only);
  - Off sends `{type:'disabled'}` only where the model can be switched off (never on Fable or Opus 5.5);
  - effort models get `output_config.effort` (incl. `xhigh` where supported) plus adaptive thinking;
  - budget models (Haiku 4.5, Sonnet 4.5) get `budget_tokens` from the level, within the output cap and strictly below `max_tokens`;
  - `temperature`/`top_p`/`top_k` are dropped on sampling-locked models (Fable, Opus 5.5, Opus 5, Opus 4.7/4.8, Sonnet 5) and next to switched-on thinking.

  Anthropic-compatible catalog models (MiniMax, Synthetic, Xiaomi MiMo) get no reasoning control until an overlay row verifies them.
- **One level → budget translation.** `src/modules/model/reasoning-wire.ts` `levelToBudget` (OpenRouter ratios, clamped to the model's budget range, strictly below `max_tokens`) is used by the effort resolver for every budget-driven provider.
- **Pricing and downgrade for the new Claude ids.** Cost-estimate rows for `claude-fable-5-1` (cache read $0.25), `claude-opus-5-5` ($4/$20, cache read $0.20; before, unrecognized models were estimated at $15/$75), `claude-opus-5` and `claude-sonnet-5` ($2/$10). Budget downgrade: Fable 5.1 → Opus 5, Opus 5.5/Opus 5 → Sonnet 5, Sonnet 5 → Haiku 4.5.
- **Anthropic API: automatic prompt caching.** The Anthropic API provider now caches three things: the system prompt, which no longer changes per turn since the clock and recalled memory ride on the message; the conversation up to the current message; and, in tool-using turns, each tool step's previous request. All use the 5-minute cache. Later turns and tool steps read the prompt back at the cache-read rate instead of full input price. Cache read and write tokens show in usage and cost. Anthropic-compatible third-party endpoints are unchanged and are sent no `cache_control`.
- **Effort reaches the OpenAI family, per model.** The `/^o\d/` guess is gone. OpenAI, OpenRouter, the Kimi API and the OpenAI-compatible gateways read the gateway's effort plan (the answering model's capability record). OpenAI: `reasoning_effort` for GPT-6 Astra, GPT-5.6/5.5/5.4/5.1, GPT-5 (mini/nano), GPT-5 pro and o1/o3/o3-mini/o4-mini, each with its own levels (None/Minimal/Extra high/Max where the model has them). Reasoning models get `max_completion_tokens` and no temperature, memory capture and background passes included. An explicit level raises a smaller output cap to that level's floor. Models without verified facts (GPT-4o, …) get nothing and keep `max_tokens`/temperature.
- **OpenRouter: `reasoning: { effort }`, never a top-level `reasoning_effort`.** Refresh models reads `supported_parameters` into the model's discovered reasoning ('reasoning' → Minimal…Max, clamped by OpenRouter upstream; absent → no control). New overlay rows with `clampPolicy: 'server'` narrow known upstream families (Claude 4.6, GPT-5.x/o-series, GPT-6 Astra, Gemini 3.x) to their own ladders. `reasoning_details` go back unmodified inside a tool loop. The seed list is refreshed (Claude Sonnet 4.6, Claude Opus 4.6, GPT-5.5, Gemini 3.1 Pro preview, GPT-4o).
- **Kimi API reasoning.** K3 `reasoning_effort` low/high/max; K2.6 `thinking: {type: enabled|disabled}`; K2.7 Code nothing (always on). No temperature on fixed-sampling models. `reasoning_content` is shown as thinking and replayed on the assistant tool-call turns of the same loop. `kimi-k2.5` leaves the seed (kept only when `/v1/models` lists it); the Kimi haiku tier and the budget-downgrade floor are now K2.6.
- **Gateways get no guessed reasoning.** OpenAI-compatible providers send an effort only where an overlay row for that provider verifies it; `openai/gpt-5.4` on a gateway gets nothing. xAI rows are now 'always reasoning, no control': EYAS uses xAI Chat Completions, where no effort parameter is documented — except for Grok 3 Mini, which takes `reasoning_effort` low | high (see Reasoning effort). The Grok CLI keeps its effort control.
- **Returned reasoning is thinking, never text.** `reasoning_content` / `reasoning` / `reasoning_details` from any OpenAI-compatible backend become thinking events plus a transient `ThinkingBlock` bound to provider and model. Only the Kimi and OpenRouter dialects send it back; the openai dialect never does.
- **OpenAI seed catalog** is gpt-5.6, gpt-5.5, gpt-5.4, gpt-5-mini, o3-mini, gpt-4o, gpt-4o-mini (gpt-4-turbo dropped). A refreshed model the seed knows keeps its window and output cap.
- **Gemini reasoning effort per model.** Gemini 3 models get `thinkingLevel` (minimal/low/medium/high, clamped per model). Gemini 2.5 models get a `thinkingBudget` derived from the level, inside the model's range. 'None' sends budget 0 only where the model can switch thinking off. 'Auto' sends no level or budget. Thought summaries (`includeThoughts`) stream as reasoning and never reach the answer text or the stored content. A caller's lower `maxOutputTokens` is raised to fit the level. models.list discovery records `thinking:false` models as having no reasoning control. The built-in Gemini catalog replaces the shut-down gemini-2.0-flash and 2.5 preview ids with the current 3.x models; the default model is gemini-3.8-flash.
- **Ollama thinking follows the effort level.** Discovery reads each model's capabilities from `POST /api/show` (on load, in the background, and on Refresh models). A model reporting `thinking` gets on/off control (`think: false` for None, `true` otherwise); gpt-oss takes `low | medium | high` (default medium, cannot be switched off); a server that reports `thinking.values` gets exactly those levels. Auto sends no `think`, and a model without the capability, or whose `/api/show` failed, never gets one (Ollama rejects it with 400). Streamed `message.thinking` arrives as reasoning, never as answer text, and an explicit level raises a smaller `num_predict` to the level's output floor. Model listing (`listModels`) is `/api/tags` only. A disabled or unreachable Ollama is never contacted; models it no longer lists are flagged and switched off after a load too.
- **LM Studio reasoning stays LM Studio's.** EYAS sends no reasoning or effort parameter to LM Studio for any level (overlay: no control, and the provider drops the effort plan). The reasoning setting LM Studio reports (`GET /api/v1/models` `capabilities.reasoning`) is stored as display-only `model_config.metadata.runtimeReasoning`, returned on the provider detail, and shown per model in the LM Studio panel.
- **Reasoning overlay:** new rows `ollama-gpt-oss` (server clamp over generic on/off discovery) and `lmstudio-no-control`. A 'none' overlay row now wins over discovered levels.

### Prompt / models

- **The prompt is sized for the model that answers.** One window resolver (`model/model-window.ts`) replaces the hard-coded 200k stub and the conversations-only `context-window.ts`. The assembler builds a delivery profile (window, tool support, provider-exact tool names) and sizes every section with `budgetForWindow`: the standard caps at 100k, up to 2.5× at ≥ 250k, and within 35 % of the window below ~29k. Locked sections are never cut, and the identity budget now fits the shipped text (200 → 600 tokens). Chat turns, background runs, team members, delegated runs (specialists, pipelines) and channel replies pass the model they call. A model pinned without its provider is bound to the provider whose model list has it; a model no provider lists gets the neutral profile (plain tool names, standard caps), never the install default's. Only a run that names no model at all is sized for the install default, which is the model it then calls. The recall block is sized for the answering model too (see Memory).
- **Tool-less models get no tools.** A model marked without tool support is sent no tools and no tool list, and a tool call it returns anyway is not executed. Ollama's model list reads `/api/show` capabilities to mark tool support.
- **Models without tool support are no longer told to call tools.** For such a model EYAS builds its System identity and Core rules 7 and 8 with a tool-less wording: recalled memory is in the `<eyas-memory>` block, that is all it gets, and it cannot search further. It is no longer pointed at `memory_search` / `memory_expand`, the grounding searches or hand-offs, and it no longer gets the skill list or agent roster, which only work through tool calls. The swap happens when the prompt is built (`prompt-wizard/master-variant.ts`). Stored sections are never rewritten, and a paragraph the owner edited is sent as written. Tool-capable models get the stored text unchanged, with host-exact names in the tool list. The shipped text is byte-identical, so there is no seed migration; on tool-less models the cached prompt prefix changes once. Still open: on 4k–32k windows, tool schemas are not counted in the prompt budget, so a large toolset can still fill the window.
- **Ollama gets `num_ctx` only when a request needs it** — the next power of two above its 4096-token default, capped at the model's window. Small requests are untouched; `OLLAMA_CONTEXT_LENGTH` applies otherwise.
- **EYAS tools are named the way each CLI host lists them.** Providers declare how their model reaches EYAS tools: Grok CLI through `use_tool` with `tool_name` `eyas__memory_search` (found via `search_tool`), Kimi Code CLI as `memory_search` on the `eyas` MCP server, API providers by the plain name. The system prompt's tool list adds one line with the host-exact form, so a bare `memory_search` no longer steers Grok into its own native memory (`model/tool-addressing.ts`). Claude Code gets its `mcp__eyas__` line (see Claude Code runtime).
- **The clock in the model's prompt follows your time zone.** New `i18n.timezone` (an IANA name such as `America/New_York`); unset means the server's zone (`TZ`, else the OS). Date and time now come from the same zone, so they can no longer disagree near midnight, and the time line names the zone and its UTC offset. Previously every install was told the time in one fixed Central European zone. An invalid zone stops startup with a clear config error.

### Model gateway

- **Default binding.** A model call that names no provider or model goes to the install default: the Standard tier, then the default provider/model, then the first enabled provider by id that has an enabled model. It never goes to Anthropic by preference or to whichever provider registered first; with no default it fails with an explicit error.
- **Gateway guards.** Model requests may only carry `user`/`assistant` messages; instructions go in `system`. The auto-title, heartbeat, self-learning, forge, skill, data-port enrichment and semantic-promoter passes were fixed accordingly and no longer silently fall back on the Anthropic API. An isolated request never fails over to a CLI that cannot run isolated (Grok CLI, Kimi Code CLI until their isolation is verified).
- **Auxiliary model service (seam).** `ctx.auxiliaryModel` is one isolation-aware resolver for background model calls: policy tiers, then the install default, then API providers, then isolating CLIs. No gateway-chosen fallback, every request `isolated`, and `none` instead of calling an ineligible CLI. Background callers now use it (see Background model calls).
- **One egress slot inside the gateway.** An outgoing request is filtered for the provider it actually reaches, after that provider is resolved — on the first attempt, the same-provider retry, the tier-fallback hop and `embed()` alike. Each hop is filtered once from the raw request; a filter that fails stops the call rather than sending the request unfiltered.
- **Providers report the host they send to.** `egressHost()` gives the host behind the base URL (Ollama `OLLAMA_HOST`, LM Studio `LM_STUDIO_URL`, OpenAI and everything built on it, anthropic-compat). Only loopback (`localhost`, `127.0.0.0/8`, `::1`) is local, with no DNS lookup; `0.0.0.0` and private ranges are not. CLI and fixed-cloud providers report nothing and count as remote.

### Background model calls

- **Titles, the heartbeat, self-learning, Forge, skill authoring and Data Port enrichment use the background-model resolver.** `model/cheap-pass.ts` is deleted. Each call goes through `ctx.auxiliaryModel.completeText` with its own purpose (`title`, `heartbeat`, `self_learning`, `forge`, `skill_generation`, `data_port_enrichment`). Every request is isolated, carries its instruction in `system` and one user message, and never runs on a provider the gateway picked on its own or on a CLI that cannot run isolated. Order: Heartbeat tier (primary, then fallback) → install default → API providers by id → CLIs that can run isolated. Titles use the Heartbeat tier only. With no eligible model (Grok-only or Kimi-only until their isolation is verified) there is no model call: the snippet title, the canned heartbeat alert, the generic self-learning sentence, the concatenated Forge proposal and the template SKILL.md remain. A Data Port job with enrichment ticked then sends nothing and counts each note it would have enriched as a fallback. Title calls carry the `conversationId` for trace attribution.
- **Memory background passes run only on an eligible background model.** Memory capture, nightly semantic consolidation and the reflection briefing go through `ctx.auxiliaryModel` (purposes `capture`, `consolidation`, `reflection`), isolated, with the instruction in `request.system` and exactly one user message. `memory/capture/completion.ts` (the capture provider ladder and its `gateway-fallback` rung) is deleted. With no eligible model or on a budget stop, capture writes a `memory_capture_runs` row with the new skip reason `no_eligible_model` or `budget_stop` and a NULL provider; neither counts against `maxPerConversation`. Consolidation keeps recurring-memory clusters untouched (not invalidated) for a later run, and the reflection digest stays deterministic. A failed or empty extraction call writes an `error` row naming the attempted `provider/model`, or `provider/route` when no model was named.
- **Isolated CLI one-shots honour their output limit.** A background one-shot call (title, triage, memory capture, security judge, consolidation, …) on Claude Code, Grok CLI or Kimi Code CLI now stops once its answer passes `maxTokens` × 4 characters, as it already did on API providers. EYAS closes the Claude Code query or cancels the ACP session, and the call ends as `done` with stopReason `max_tokens` and the answer clipped to the cap, never an error. Only answer text counts, not reasoning. Turns with tools are not capped by `maxTokens`. One shared rule (`src/modules/model/cli-output-cap.ts`); the ACP tool-call cap and the output cap share one cancel path. Proven on the real binaries in the free live lane (Claude Code 2.1.281, Grok CLI 1.0.41); Kimi is covered by the fake-agent tests only (no binary on the proving host).
- **Security judge, completeness critic and rubric planner run isolated on the background model.** Each is one isolated, tool-less call (Heartbeat → Quick → default → others; a second candidate only after a retryable transport error). It is no longer a full CLI session with the CLI's own memory loaded. With no eligible model, a stopped budget or every attempt failing, the security judge escalates the tool call to human approval (before, a judge error blocked it); an unreadable verdict still denies. The completeness critic leaves the run Unverified, and no rubric plan is written. `planning.ts` takes an injected completion, so one plan generator serves background and interactive callers.
- **Plan first, God Mode review, team proposals, re-planning and Design run isolated.** Plan first writes the plan with the conversation's own model in one isolated, tool-less call. God Mode reviewers vote in one isolated, tool-less call on their own roster model, and peers' results reach them as fenced data, never as instructions. The team proposal and the between-phase re-planner run through the background model service (Quick → Standard); without an eligible model the proposal is a single agent and the re-planner keeps the current plan. Design AI edits run as one isolated call on the install default, independent of provider registration order.
- **Auto-routing's classifier runs isolated and is traced.** A message the keyword rules cannot place is classified by the Triage tier's model (primary or fallback only, on a provider that can run isolated calls) in one isolated, tool-less call through the background model service, with only the first 500 characters. Before, the decision engine held on to the gateway from before privacy and tracing were installed, so the call bypassed tracing and budget and ran as a full, non-isolated CLI session. With no eligible model, a budget hard stop, or an answer that is not a valid category/complexity, the keyword classification decides and no model is called.
- **Research runs on the background model, isolated, with web content fenced as data.** Query expansion, source scoring, synthesis and the cross-check go through the auxiliary model service (purpose `research`: Standard tier → default binding → API providers → isolating CLIs), traced and budgeted. Search titles, snippets, page extracts and model-written sections reach the model only inside a per-call nonce block (`research-data-<16 hex>`, CSPRNG); fence-family tags inside the content are defanged. Model answers are Zod-checked.
- **Routing shows where background calls go.** A new **Background model calls** card at the top of Providers → Routing Tiers lists each group of background work: memory, learning, titles, safety, planning, research and triage. Each row shows the provider · model the next call would use and the rung it came from (Tier, Default, API provider, Isolated CLI). Otherwise it shows *No model — deterministic fallback* and why (no provider can run an isolated call, tier not configured, budget limit reached). A red banner flags degraded mode (a group with no eligible provider), and the card refreshes after every tier change. The card reads the new read-only `GET /api/v1/routing/auxiliary` (`read:Settings`), which returns `{ groups: [{ group, purposes, target: { provider, model|null, route } | null, reason|null }] }` from `ctx.auxiliaryModel.describe()` without making a model call.
- **Data-port enrichment runs only on an isolated answer, says who answered, and drops links the model made up.** With 'Enrich metadata with the model' ticked, a note's suggested kind, summary, tags and links are used only when the background model service answered through an isolated call; no eligible model, an error, an empty answer or a refusal leaves the deterministic metadata and counts as a fallback. Enriched notes carry `enriched_by: {provider, model?, route}` in their frontmatter (route = tier | default | api | isolated-cli), and the vault reads it back so a rewrite keeps it. A model-proposed link is kept only when it resolves to a note in the vault index or in the same import, written as that note's slug; the source's own links are untouched. The job looks the background model service up when it runs instead of capturing it at start.
- **Background calls pin a CLI model only when its discovery offered it.** A routing tier's Claude Code, Grok or Kimi model is used for a background call only when that CLI's own discovery offered the model (enabled, discovered, not missing); otherwise the call runs on the CLI's default.
- **A research report completes without a model.** With no eligible background model, a budget stop, or a failed/unusable synthesis, the report completes with `degraded` set: only the topic is searched, sources are ranked by search order, there is one section per top source (title, snippet, URL) and no cross-check; pages are not fetched when no model is available. The Research page shows a banner (six languages) and the `research` tool returns `degraded: true`. `research_reports` gains `degraded INTEGER NOT NULL DEFAULT 0`, and `GET /api/v1/research[/:id]` returns it. A model failure no longer ends the job as Error.

### Agent runs, tools and personas

- **One ending per agent run, the same for every provider.** The agent runner ends each run exactly once: done with an outcome (completed, max turns, max tokens, refusal, tool budget), cancelled, parked for approval, or one error. A provider error frame is no longer passed on as a separate event. A turn-limit or tool-budget stop is a normal ending and keeps the partial answer. The old `max_turns_reached`, `tool_budget_exhausted`, `tool_approval_required`, `tool_approval_denied` and `tool_calls_per_turn_truncated` events are gone. Every tool result carries an outcome (success, error, denied, approval required, skipped) and who executed it, so a call that never ran is not reported as a success.
- **Resume and Retry protect CLI runs too.** Tools that Claude Code, Grok or Kimi ran on their own are recorded under EYAS's canonical names. The runner saves a checkpoint after such a turn and before an approval park. A resumed run gets the same recap and do-not-repeat ledger as an API-provider run. The ledger reaches the CLI's permission bridge, which refuses an exact repeat of a destructive call ('already executed on the original run — duplicate side effect prevented'). The bridge reports every refused call to the provider (`onDecision`), so tool rows can show the real outcome. CLI file edits and moves are now in the destructive set.
- **An agent's Tools list means the same thing on every path, and memory is always in it.** Chat, scheduled and board runs, specialists (`run_specialist` / `delegate_to_agent`), team members, channel replies and Claude Code's EYAS MCP server now apply one rule (`src/modules/agent/tool-scope.ts`): an empty list offers every tool; otherwise exactly the listed tools plus `memory_search` and `memory_expand`, which every agent now gets even when its list omits them (Devil's Advocate, Code Reviewer, Security Auditor, Technical Writer and API Designer had no memory drill-down on API providers). A Solo conversation also drops `run_specialist`, `delegate_to_agent`, `handoff_to_colleague` and `propose_team` (`assign_task` stays). The system prompt's tool inventory lists only the tools the run is offered. Behaviour change: a narrow list is now honoured — the Personal Assistant, for example, gets no `run_command` / `write_file`, as its template says. The Tools field placeholder shows real tool names instead of the non-existent `memory.search, knowledge.search`.
- **Tool lists and Solo hold on every provider, CLI bridges included.** A model runs only a tool it was offered: the tool executor refuses any other name ("not in this agent's toolset"), and the agent runner refuses it before the gate, with no approval prompt. Tools in a list that do not exist are dropped, with one warning per agent in the log. The Grok/Kimi bridge binding carries the tool scope server-side: `tools/list` shows exactly the allowed tools, `tools/call` refuses any other (the row shows 'denied'). Solo means no specialists, hand-offs or team proposals on both CLI bridges too. The always-on memory tools are defined once (`MEMORY_ALWAYS_ON_TOOLS`).
- **CLI models gain the EYAS browser, agent-browser, browser-use and OpenCode tools.** One exposure rule (`tools/cli-exposure.ts`) serves Claude Code's in-process bridge, the Grok/Kimi `tools/list` and `tools/call`, and the prompt's tool list: every scoped tool except the ones a granted CLI built-in stands in for (`read_file`, `grep`, `glob` always; `write_file`, `edit_file` while writing is granted; `run_command`, `git_status`, `git_diff` while the shell is granted). Before, the whole shell and browser categories were hidden from CLIs. Bridged tools run under the same gate, approvals and tool scope as on API models.
- **Agent tool lists now bound the CLI models' own tools.** One table (`tools/cli-exposure.ts` `CLI_NATIVE_CAPABILITIES`) maps an agent's Tools list onto Claude Code's built-ins and onto Grok/Kimi's native tool kinds. Without `write_file`/`edit_file` there is no native Write/Edit, without `run_command` no Bash/shell (a delete counts as shell), and without a web tool (`research`, `browser_navigate`, `agent_browser_run`, `browser_use_exec`) no WebFetch/WebSearch. Reading (Read/Glob/Grep) always stays, and an empty list still grants everything. Claude Code gets the withheld built-ins left out and passed as `disallowedTools`. Grok/Kimi permission requests and client-fs writes for them are refused before the security gate is asked (tool row *Denied*, no approval). A Kimi request with no kind is refused while write or shell is withheld; Kimi's web search and fetch never ask, so they cannot be allowed per agent. `git_status`/`git_diff` on a list without `run_command` are now offered over the EYAS bridge. The agent editor's Tools hint says so (six languages). New free live-lane cases prove it on Claude Code and the Grok CLI.
- **Scheduled agent runs run.** An `agent_run` job used to fail on every execution (it read `ctx.agent`, created the conversation without a user and called a `sendMessage` that does not exist). Now each execution creates a conversation owned by the job's creator (the owner for agent- or system-created jobs), with the prompt as its goal, mode `autonomous`, following the agent's model. It runs through the shared runner entry `ctx.agents.runConversation`: supervised, autonomous, full EYAS recall from the prompt, designs, documents, memory capture, critic. The execution result carries `conversationId`, including on failure (new `JobFailure`), and Recent executions links it (**Open conversation**). A run that does not start fails the execution with its reason (`agent_unavailable`, `over_budget`, `invalid_config`, `conversation_busy`, …). `conversationPolicy: 'reuse'` re-arms the given conversation (same user, not running). `POST`/`PATCH /api/v1/scheduler/jobs` refuse an invalid agent_run `handlerConfig` with `400` (Zod `AgentRunConfigSchema`), and `createdBy` is always the authenticated user. Job handlers now receive `(config, { jobId, createdBy })`. The unimplemented `channelNotify` option is gone.
- **Scheduled agent runs can set their own effort.** An agent routine job can have an optional Effort, chosen when the job is created or later in the job's detail panel. The select lists only the levels the agent's model supports, and Auto shows what the run falls back to (the agent's own effort, otherwise the model default). The level is stored on each run's conversation, so the run resolves it through the same effort chain as every other run, and it is adjusted to the model the run lands on. API: `handlerConfig.effort` (a ladder rung, or `auto`/null = the agent's); an invalid value returns 400.
- **Hand-off starts the colleague.** `handoff_to_colleague` now runs the colleague's home thread at once through the same runner entry: the brief is the run's goal and recall query, and the run is supervised and gated by the autonomy ladder. Only a thread still `waiting` is claimed, so a duplicate `task_assigned` never starts a second run. A hand-off to a colleague whose home thread is busy (`working` / `waiting_approval`) is refused with a busy error instead of re-arming it.
- **One runner entry for background runs.** `createRunDeps()` (`agent/run-deps.ts`) is the single dependency bundle for board bot runs, scheduled runs, hand-offs, retry/refresh, approval resume, the auto-retry sweep, boot recovery and God Mode. The bot-executor now calls `ctx.agents.runConversation` instead of assembling a partial bundle, so board runs also get designs, documents and durable-memory capture.
- **Verification credits delivered memory on every provider.** The completeness critic counts the memory EYAS delivered with a run's message as grounding evidence. A goal that needs sources is no longer failed automatically when the model answered from recall instead of calling `memory_search`, and the reviewer model is shown the delivered memory ids. Tool evidence is read from the run's own tool execution log (`tool_executions.run_id`), so bridged calls from Claude Code and Grok/Kimi count the same as native ones. `memory_expand` now counts as retrieval.
- **Import roots are no longer a live door into other tools' folders.** `skills.importRoots` and `agent.importRoots` are read on every start, so a root there acted as a live source. A root inside another assistant's or note app's own folders is now skipped with a warning at start and an 'Import roots' warning in `eyas doctor`: `~/.claude` (skills, agents, plugins), `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium`, `~/.copilot`, `~/.agents`, `~/.config/agents`, the OpenCode folders, Obsidian settings and vaults, `security.foreignMemoryPaths`, and EYAS's own CLI homes. A root that encloses one of them (e.g. the home folder) is skipped too. Such content comes in once through Settings → System → Data portability → Import data. Rows imported earlier stay; ordinary folders are still scanned. The selection is one shared function on the memory-sovereignty path policy (`shared/memory-sovereignty/import-roots.ts`), used by skills, agents and doctor.
- **Personas edited in EYAS are never overwritten by their import file.** A new ledger, `agent_persona_imports`, records per agent the owning file and a hash of the fields the import writes (name, role, description, system prompt, tools). A file updates its agent only while those fields are exactly as the last import left them. An agent deleted after import is not re-created. An existing agent the import did not create (template, UI-made, Data port) is never overlaid; it is adopted only when it already matches the file. The first listed root owns an id. Previously every start overwrote name, role, prompt and tools from the file.

### MCP

- **Memory-store MCP servers are blocked for every model.** An MCP server that keeps a second memory outside EYAS would make it a live read/write source for every provider. The catalog's Memory, Qdrant and Obsidian entries leave 'Ready to use' and move to a new 'Not available — memory outside EYAS' section (install disabled, link to the data import). A manual add, catalog install or edit is refused with `409 memory_store_blocked` when the launch names a known memory package (e.g. `@modelcontextprotocol/server-memory`, `@bitbonsai/mcpvault`, `mcp-obsidian`, `mcp-server-qdrant`; version suffix ignored, display name never matched) or when an argument, env value, command path or `file://` URL points at a folder the memory-sovereignty path policy protects (another tool's memory, an Obsidian vault, `security.foreignMemoryPaths`, EYAS's data folder, EYAS-owned CLI homes). Servers run from `data/mcp-servers/` — where `config/mcp.yaml` clones them — are server code, not memory, and stay allowed (judged by their real path, so a link from there into the vault is still refused); the shipped `config/mcp.yaml` servers load without `memory_store_blocked`. Existing rows are marked **Blocked** at boot: never spawned, no `mcp_*` tools registered, `blocked: 'memory_store'` in `GET /api/v1/mcp/servers`; edit or delete still work. `refresh` returns 409 and `test` returns the code. Bring such memory in with Settings → System → Data portability → Import data. The foreign-store table gains the MCPVault signature (version 2026-09-23).
- **External MCP `tools/call` validates its body.** A malformed body gets HTTP 400 with a JSON-RPC error: `-32600` for a non-JSON or non-object body, `-32602` for a missing name or a non-object `arguments`. An unknown tool is still 404 with `-32601`. Memory tool results sent to external clients are masked (see Privacy).

### Model layer (internal groundwork)

- **One stream contract for every provider.** `src/shared/chat-stream.ts` defines the shared stop reasons (adds `max_turns` and `refusal`), tool and turn outcomes, canonical token usage (uncached input, separate cache reads/writes, reasoning tokens, `reported:false` when a provider gives none), cost source (provider / estimate / unknown — never a silent $0), generic notices, the strict per-turn metadata schema and the chat SSE frame union. Provider streams gain `tool_result`, `approval_required`, `step` and `notice`. `StreamEvent` is exactly this contract: the old `tool_use_end` / `context_compact` union is deleted and no provider emits either (see Providers). Canonical usage is built in one place (`model/usage.ts`) with one mapper per dialect.
- **Coded model errors.** `CodedModelError(kind, code, params)` is recognised directly or as a cause, so a specific failure is shown as one localized message instead of raw provider text (see Conversations / chat).
- **Canonical tool names, stop-reason mapping and a validated ACP event parser** (`canonical-tool-name.ts`, `model/stop-reason.ts`, `grok-cli/acp-events.ts`), plus a stream-contract test harness for provider fixtures.
- **Reasoning effort has one ladder and a per-model capability record.** `auto | none | minimal | low | medium | high | xhigh | max`. A registry merges runtime-discovered levels over a versioned overlay (`model/reasoning/overlay.json`: 58 verified rows for Anthropic, OpenAI, OpenRouter upstream families, Gemini, xAI/Grok CLI, Kimi, Ollama gpt-oss and LM Studio, each with its source and verification date). Unknown models resolve to Auto and no reasoning parameter is ever guessed; a fetched id with a release stamp inherits its family's row (see Reasoning effort). Every provider mapper reads the plan directly (see Providers); an optional row-level `clampPolicy: 'server'` marks endpoints that clamp upstream themselves (OpenRouter, gpt-oss on Ollama).
- **`model_config.metadata`.** An additive column for provider-discovered facts (alias, real model id, discovered reasoning), validated on read. A models refresh is now an upsert that keeps stored metadata and the enabled choice; the refresh and enable/disable responses include `metadata` (filled by **Refresh models**, see Providers).
- **CLI isolation contracts recorded as fixtures.** `scripts/cli-isolation-spike.ts` runs the installed Grok (1.0.40), Claude Code (2.1.280) and OpenCode (1.18.29) against a hostile temporary home (`tests/live/hostile-home.ts`) and a local fake model with dummy keys — no provider is ever called — and writes `tests/fixtures/cli/<cli>/<version>/`. Kimi (1.52.0) is recorded from its source and marked unverified; the paid canary runs only with `EYAS_SPIKE_ALLOW_PAID=1` and an explicit key. Findings that shape the isolation work: Grok `[permission] ask` routes every native tool to EYAS over ACP; a prompt starting with `/always-approve on` still switches Grok to always-approve despite the requirements lock; `session/new` exposes no permission mode; `GIT_CEILING_DIRECTORIES` does not affect Grok; Claude Code with the isolated options writes no transcript, only startup bookkeeping; OpenCode still writes an npm cache under `$HOME`.
- **One model-provider protocol.** The unused v2 adapter layer is deleted: `ModelProvider`, `ProviderCapabilities`, `NormalizedRequest` and the `AnthropicAdapter`/`OpenAIAdapter`/`GeminiAdapter`/`OllamaAdapter` classes, which carried their own thinking and cache logic that never reached production. `AIProvider` is the only provider protocol. `eyas migrate run` (the legacy v1→v2 prompt split) now calls the same provider factories as the server, so its OpenAI call carries `store: false` too, and a contract test keeps the old layer from coming back. The paid `EYAS_REAL_ANTHROPIC` prompt-cache gate now measures the production Anthropic provider.
- **Reasoning effort internals.** New `reasoning/clamp.ts`, `resolve.ts`, `intent.ts`, `outcome.ts`. `ModelRequest.effort` is an intent; the gateway alone sets the per-attempt `effortPlan`, and CLI runtimes confirm the level they ran only via `readbackOutcome()`. No pre-plan reasoning path is left: `ThinkingConfig`, `ModelRequest.thinking` and the temporary legacy effort shim are deleted. The effort-plan contract test fails on any return of the old knob, a provider reading the raw intent, or a provider authoring outcome fields. The window resolver's unused per-model capability source is removed: the model catalog is its only per-model source.
- **Dead model-calling code removed; new direct model calls are blocked.** The unwired automatic trace scorer is deleted: `observability/quality-scorer.ts` `autoScoreTrace`, which pinned a vendor model id and had no caller, and `TraceCollector.updateAutoScore`. User feedback is unchanged. The `quality_score_auto` / `evaluator_model` columns stay for older rows, but nothing writes them. The ops LLM diagnoser and the email-triage template's injected LLM client document their contract: once wired, they are backed by `ctx.auxiliaryModel.completeText`, never the gateway. A source-scan test (`tests/modules/model/no-direct-model-calls.test.ts`) fails the build when backend code reads `.complete` / `.stream` on the model gateway or a provider outside an explicit allowlist; it covers aliases, casts, getters, a destructured `ctx.model` and method references. The allowlist is the agent runner, the chat stream route, the model API routes, the tracing wrapper, the lazy gateway, gateway dispatch and the auxiliary service, plus Plan first, God Mode review and Design as isolated one-shots whose requests must carry `isolated: true`. A stale allowlist entry also fails the build.

### Upgrade notes

- **Automatic at first start:**
  - the `claude_code_sessions` table is dropped and stored provider session ids are cleared;
  - auto-created workspaces move out of a git checkout;
  - the L0 memory table is rebuilt once (a large memory store makes that start a little longer), existing memory vectors are filed under their project, and with `EYAS_DATA_DIR` set an old vault is copied into `<data dir>/vault` if the new one is empty;
  - vault notes are re-read once for their trust level, a one-time pass repairs their provenance, secret markers are added to rows derived from tagged sources, and every shared memory block is copied once into memory as a model-written note;
  - unedited locked master prompt sections refresh (the prompt cache prefix changes once);
  - legacy thinking budgets become effort levels, and Triage/Quick/Heartbeat get a Low default effort;
  - `conversations.model_binding` is added (agent and sub-conversations become `inherit`), and `agent_definitions.provider` is filled in where exactly one provider lists the agent's model id;
  - stored Grok model rows are refreshed from the CLI, and EYAS-seeded Kimi Code CLI tiers and the Kimi default move off the retired `kimi-cli-k3` / `-k2.7-code` / `-k2.6` rows to `kimi-cli-default`;
  - Claude Code model rows an earlier version stored with a 1M window, and no model read has confirmed since, are corrected to 200k (the on/off choice is kept); the old OpenCode memory plugin copy (`cli-homes/opencode/plugins/eyas-memory.ts`) is deleted;
  - additive columns are added: `ai_traces.resolved_model`, `effort_*`, `purpose` and `aux_route`; `conversations.model_user_chosen`; `conversation_messages.turn_meta`; `context_compositions.observed_*`, `history_estimated_tokens`, `egress_json` and `delivery_json`; `context_sections.egress_*`; `memory_capture_runs.entry_path`.
- **Existing scheduled agent routines start running.** `agent_run` jobs that failed silently until now execute — and spend tokens — on their next trigger. Review or pause them before upgrading.
- **Claude Code must be signed in** to be available — `claude` on PATH is not enough. In Docker, mount or install a current CLI and set `EYAS_CLAUDE_CODE_BIN`.
- **Claude Code no longer loads host config.** An install that had 'Load host Claude config' on is switched to isolated; host CLAUDE.md, settings.json hooks and permission rules, skills, project `.mcp.json` and Claude Code auto-memory no longer reach conversations. Bring host CLAUDE.md content in once with Settings → System → Data portability → Import data. Claude Code does not update itself while EYAS runs it; update it yourself.
- **Sign Grok and Kimi in for EYAS.** Grok CLI and Kimi Code CLI now run in EYAS's own home, so an install that relied on the host login has no working Grok or Kimi model until someone signs in once under Providers (device code; Grok also takes an xAI API key). A Home banner points owners and admins there. The host login is never read or changed.
- **Proven CLI versions.** The release check proved Claude Code 2.1.281 and Grok CLI 1.0.41; `eyas doctor` warns on any other installed version, and EYAS still checks every session at start. Kimi Code CLI is not yet proven on a host.
- **The kernel file sandbox needs bubblewrap on Linux.** Install bubblewrap (`bwrap`) — plus `socat` for Claude Code — and allow unprivileged user namespaces on Linux hosts and in containers; the image does not bundle it. Without it, `auto` runs the CLIs' own tools unsandboxed with a notice, and `required` refuses CLI turns with tools. `eyas doctor` shows the status on its 'CLI sandbox' line.
- **Models can no longer read `~/.claude`, `~/.grok`, Obsidian vaults or EYAS's `data/` folder.** An agent that read `~/.claude/CLAUDE.md` or a vault note directly is now refused (Security events shows it); bring that knowledge into EYAS once with the data import.
- **Broad CLI searches are refused.** Agents or habits that searched the whole home or a parent folder with a CLI's own tools (Grep, Glob, `grep -r`, `find`, …) are now refused as *Search too broad*. Point them at a sub-folder, or use EYAS's `grep`/`glob`, which leave protected places out. A recursive search fed by `xargs` or `parallel` (for example `fd -e ts | xargs rg foo`) counts as a search of `/` and is refused too — run the search on the folder instead.
- **Memory-store MCP servers stop working.** Memory, Qdrant, Obsidian and MCPVault servers — and any server pointed at a vault or at another tool's memory — are marked Blocked at boot. Use the data import instead.
- **Import roots inside another tool's folders are skipped.** Move that content in once with the data import, then remove the entry from `local.yaml`. Personas imported earlier and not edited since are taken over by the new ledger; edited ones stay as they are.
- **Folders that contain a protected place are refused.** The EYAS checkout that holds `data/`, the EYAS home, a `~/Documents` that holds a vault and similar folders can no longer be saved as Folders; choose a narrower folder, such as the project folder inside `~/Documents` or a separate clone of the repository. **Stored folders that are now refused** are not rewritten, but every run leaves them out with a chat notice (the conversation's CLI works in its own workspace when none is left); remove them from the list before saving other changes.
- **OpenCode:** users sign in once with `/connect` in the OpenCode terminal; `data/opencode` in the install folder is no longer used. `EYAS_OPENCODE_PLUGIN_TOKEN` is gone (each OpenCode process gets its own key on fd 3; calls carry per-session proofs), an attached OpenCode server no longer reaches EYAS memory, and OpenCode tool and terminal output is no longer stored unless `memory.l0.captureToolResults` is on. OpenCode's first start needs the npm registry to install the memory plugin's dependency.
- **Grok/Kimi runs follow the same approval verdicts.** Scheduled, team and pipeline runs on Grok or Kimi now wait for approval on EYAS tool calls the gate escalates (even at Auto) or whose category is at Notice/Approve, and park as *Waiting approval* — review the autonomy levels of such routines. In attended chats a tool marked as needing approval no longer queues just because the model is Grok or Kimi.
- **Calls that name no model** now go to the Standard tier, then the default provider, then the first enabled provider alphabetically — set the Standard tier to control it.
- **Picked models fail closed.** A conversation model chosen in the picker is never swapped for the default when it becomes unavailable; the message is refused until you pick another model or re-enable it.
- **A narrow agent Tools list is now honoured everywhere**, including chat, both CLI bridges and the CLI models' own write, shell and web tools; clear the list to allow all tools. An agent without `run_command` / `write_file` (for example the Personal Assistant template) can no longer write files or run commands on Claude Code, Grok or Kimi either — add `write_file` / `edit_file` and/or `run_command`, or clear the list. Names in a list that are not installed tools are dropped (a warning per agent in the log), and a model that calls a tool outside its offered list now gets a denial.
- **Memory capture runs on more paths.** Specialists, team members, channel replies, A2A tasks and pipeline stages now capture too: each whose instruction is at least `memory.capture.minUserChars` long can spend one extra background model call. `memory.capture.enabled: false` still turns all capture off.
- **Claude Code reasoning display needs 2.1.280.** On an older Claude Code (the bundled 2.1.89 included), models that hide their thinking unless asked show no reasoning text, and the effort select says so. Update Claude Code and refresh the models, or restart.
- **Press Refresh models** on the Anthropic and Gemini providers to get the current catalogs; existing rows stay until then, and rows the API no longer offers are switched off, not deleted. On Kimi Code CLI, sign in for EYAS and refresh; a conversation or agent pinned to a retired Kimi row now stops with 'does not offer it' until you pick a discovered model.
- **A smaller recall budget.** `memory.index.budgetChars` now sizes the whole recall block and ships as 2400 (it was 8000); to keep 8000, set it in `config/local.yaml` and restart. `memory.relatedWork.*` is ignored.
- **The prompt clock follows `i18n.timezone`**, else the server's zone (`TZ`, else the OS), instead of one fixed Central European zone. Set it when the server runs in another zone than its users.
- **`default.yaml` / `local.yaml` changes need a restart.** `eyas config reload` does not reload them.
- **A remote `OLLAMA_HOST` is masked now.** Add it to the privacy policy's `localHosts` if it should receive text unmasked.
- **New messages carrying block-class values are refused** when they would go to a remote model (CLI providers included). Set such a type to `mask` on the Privacy page, or add the model's host to the local hosts, if that is not what you want. Audit consumers: `privacy.detected` entries are replaced by one `privacy.egress` entry per call; the `/api/v1/privacy/scan` and `/stats` response shapes changed.
- **Dates already stored as `[PHONE]`** by the old scanner are not repaired; re-importing from the source restores them.
- **Earlier enriched imports** carry no `enriched_by` and may hold unchecked links: roll the job back and re-import it without enrichment to clean them.

### Handbook

User docs in all six languages (en/hu/de/es/fr/tlh). The pages this release rewrites are consolidated into one text per language, checked against the code, with the same headings and stable English anchors in every language and UI labels quoted as each language's interface shows them. Several de/es/fr/tlh pages that were short summaries are now full translations.

- **Providers:** continuity, Claude Code runtime and isolation, Grok/Kimi isolation, sign-in and the isolation check, proven CLI versions, models and Refresh models, kernel file sandbox, reasoning effort with a per-provider table (what EYAS sends, where the levels come from, what Auto does, sent vs read back), Claude Code/Grok/Kimi model discovery, Anthropic/OpenAI/Gemini catalogs, Anthropic prompt caching, CLI turn timeouts, images, context window, tool calling, local runtimes, privacy per provider, one provider name everywhere, and the refused-call behaviour of Grok; the Runtime line, the Isolation block and Verify now on the CLI panels, the output limit of background calls on a CLI, how an agent's Tools list limits a CLI's own tools, the same EYAS-tool approval verdicts on Grok and Kimi, the new effort rows (GPT-5.2, GPT-5.4 mini/nano, OpenRouter pro and Codex, Grok 3 Mini) and the release-stamp rule, and the 200k Claude Code windows.
- **Conversations:** working folder and folder validation (a folder is judged by what it contains; refused stored folders and their notice), the top bar and model picker, who answered, tool rows and statuses (a search refused as too broad), turn outcome, errors and notices, approvals in the chat, refused messages, effort, Plan first (and its *Rollback: …* line), God Mode review, titles, run tree, context bar and memory delivered, privacy badges, hand-off.
- **Memory:** project scope, drill-down, standing lines, how recall reaches the model, recall query, local embedder, ranking, trust, secrets, the Recall engine card, the raw record with tool-output and reasoning capture, the instruction filter for notes, retired memory blocks, quarantine, memory outside EYAS, background model, memory and privacy; capture on every run path and who wrote the message, peer-trust notes, the `entry_path` ledger column.
- **Security & privacy:** privacy policy v2 and the rebuilt Privacy page, masking on every transport, refused messages, the `privacy.egress` audit, memory outside EYAS (card and kernel layer, searches judged by what they can reach, folders judged by what they contain), the security judge, CLI isolation and how it is proven, stored completions.
- **Observability:** the Purpose column, the compositions API, CLI tool counts, memory tiers on traces, and the Memory delivery by provider card.
- **Routing & budget:** default binding, the Background model calls card, Auto-routing, tier effort, background-call effort, model assignments.
- **OpenCode:** isolation, model and reasoning, masking, EYAS memory inside OpenCode (the plugin's location, the key on fd 3, per-session proofs and the limits that remain), recall sized for the task model's window.
- **Configuration and deployment:** time zone, data directory and vault, conversation workspaces, memory outside EYAS, `security.cliSandbox`, `model.cli.*`, `memory.l0.*`, `memory.capture.*` (including `maxInputChars`), `memory.engine`, environment variables; multi-instance, Docker, native, Kubernetes, backup; CLI (doctor lines, exit status, CLI isolation).
- **Agents and automation:** tools list (and how it limits a CLI model's own tools), tool execution log, catalog risk badges and categories, imported personas, teams, runs (Mission Control cards as they are), autonomy (the Autonomy & self-improvement toggles), Max Turns defaults, scheduler (create form, effort), MCP (bridge, self-test, tool names per host, memory-store block, CLI tool exposure, external `tools/call`, the add dialog), channels, A2A, data import (checked enrichment, `enriched_by`).
- **Also:** identity & workspace, prompts (memory contract and its tool-less wording, sizing for the model, Prompt coach), projects, research, proactive, self-learning, design, secrets, home, board, setup wizard, settings (sidebar groups), getting started, concepts, FAQ; the glossary gains the new terms (turn and tool outcome, raw record, trust tier, project scope, memory id, turn block, drill-down, delivery profile, recall engine, memory delivery by provider, release check, proven CLI version, provider kind, effort readback, OpenCode memory plugin), and the reference architecture page summarises the memory sovereignty layer, memory delivery, binding, specialists and tool scope, effort and CLI versions, observability and the contributor rules.
- **For contributors:** a heading-id plugin (`packages/docs/remark-heading-ids.mjs`) turns `## Heading {#id}` into a real anchor that stays in the page's table of contents; one handbook parity test (`tests/contracts/handbook-locale-parity.test.ts`) checks the listed pages across the six languages — heading levels, pinned anchors, the `{#id}` heading form (raw `<hN id>` only for an id containing `--`), table rows and help-map hashes — and every anchor link anywhere in the handbook; help-map gains `ai.providers.effort`.

## [0.8.29-beta] - 2026-09-09 — The door still opens

0.8.25 said a public clone still builds a UI. Adel's machine then died on
nested `bun install`: `src/web/bun.lock` already records `link:@saker/*`, and
current Bun reports `FileNotFound: failed linking dependency/workspace`
instead of `is not linked`, so the skip-and-retry never ran.

The door still opens: those `link:` deps are skipped on any failed nested
install that lists them, not only the old error text.

### Installer / frontend

- **Public clone nested `bun install` no longer dies on a Saker lockfile.** `src/web/bun.lock` records `link:@saker/*`. Current Bun then reports `FileNotFound: failed linking dependency/workspace` instead of `is not linked`, so the skip-and-retry never ran. The nested installer now skips those `link:` deps on any failed nested install that lists them (not only the old error text). A failed nested install no longer prints a misleading `[OK]` line.

## [0.8.28-beta] - 2026-09-09 — Talking heads, same five tools

Media already generated stills and cinematic clips. It could not put a presenter on camera without a studio day. **HeyGen** is now an optional backend on that same gateway — talking-head avatars, Video Agent, speech — through the five `media_*` tools, not a dump of fifty vendor MCP calls.

### Media

- **HeyGen is an optional talking-head backend.** Submodule `media.heygen` — MCP OAuth at `https://mcp.heygen.com/mcp/v1/`. Same five `media_*` tools as Magnific/Higgsfield/fal; none is default. Video without `avatar_id` → Video Agent (prompt→video); with `avatar_id` / catalog `model` → scripted avatar; `audio` → speech. MCP spends the HeyGen **web plan**, not the separate REST API balance. REST key, translation, and lipsync stay out of v1. Not Studio: Hyperframes remains local HTML→MP4.
- **Handbook and landing name HeyGen.** User docs (all six locales): Media chapter compare table, glossary, tools, studio contrast, welcome map. Landing (`docs/eyas-overview.html`): Media card, proprietary backends, MCP catalog card (34 servers / 7 manual).

## [0.8.27-beta] - 2026-09-08 — OpenCode in the pane

Chat can hand a coding task to **OpenCode** (MIT, [opencode.ai](https://opencode.ai)) and you can watch — or type into — the live TUI inside the conversation.

EYAS does not import OpenCode's private core or its AI SDKs. The official embed is the local HTTP server (`opencode serve` on 127.0.0.1) plus a POSIX PTY streamed to `@xterm/xterm`. Missing CLI or PTY is fail-closed with a remedy.

### Sidecar

- Extra module `opencode`. Doctor: `EYAS_OPENCODE_BIN` → PATH. Isolated config under `data/opencode` (`XDG_CONFIG_HOME`), not the daily `~/.config/opencode`.
- Tools: `opencode_status` (green), `opencode_run` (red, approval). Memory is hydrated first; stdout/diffs/events go to L0 via `captureUnit`.
- OpenCode plugin `eyas_query_memory` / `eyas_save_memory` calls EYAS over localhost with a process token.

### Terminal

- Conversation top-bar toggle opens xterm.js. Dedicated JWT WebSocket `/api/v1/opencode/terminal/:sessionId` (fat TTY, not a thin pub/sub topic). Last client disconnect destroys the PTY.
- POSIX PTY via bun:ffi (no `node-pty`). Windows unavailable.

User handbook in all six languages: OpenCode chapter + glossary. Landing page (eyas-overview.html) lists the sidecar and the extra module.

## [0.8.26-beta] - 2026-09-08 — You talk to colleagues

The roster was always there. What was missing was the feeling of people:
two always-on colleagues you open from the sidebar, specialists they spawn
without a card, and routing that is not a human gate.

You talk to **colleagues** (primary and team). They have strict roles. They
hand work to another colleague or spawn **specialists** from a shared pool —
automatically, often in parallel. A team-proposal card appears only when a
specialist is missing, you asked for a team, or the work is epic.

### Routing

- **`run_specialist`** (alias `delegate_to_agent`) is green: spawn an enabled specialist and wait for the summary. No click.
- **`handoff_to_colleague`** is green: open the other colleague's home thread and start them.
- **`assign_task`** is green when the target is enabled.
- **`propose_team`** stays yellow: missing roles, `/team` / an explicit ask, or epic work.

### Colleagues

- Sidebar **Colleagues**. Each colleague has one home thread (`conversations.kind = home`). The conversation picker lists primary and team colleagues.
- Setup still creates Personal Assistant + System Engineer. The Assistant coordinates and no longer gets builder tools (`write_file` / `edit_file` / `run_command`). The Engineer owns platform/code.
- Living roster in the prompt (`renderInventory` available-agents). First specialist spawn creates an **implicit work session** so team memory works without a card.

### Parallel specialists

- Two or more `run_specialist` / `delegate_to_agent` in one turn run concurrently after the security gate; remaining tools stay sequential.
- Git worktrees under `.eyas-worktrees/` when an implicit session has two or more writer specialists.

### Handbook

User docs in all six languages (en/hu/de/es/fr/tlh): teams, overview, configure, conversations, tools, first hour, setup wizard, concepts, glossary.

## [0.8.25-beta] - 2026-09-08 — The door stays open

0.8.22 said a public clone still builds a UI. Adel's machine showed the nested
install skip working — then Vite died on `@saker/react`, and a second run of
the one-liner built the old tree because `git checkout --force main` does not
fast-forward.

The door stays open: existing installs move onto the fetched ref, and the
Saker stub aliases are exact so the knowledge editor CSS does not resolve to
`saker-stub.tsx/styles/editor.css`.

### Installer / frontend

- **Existing native installs actually move onto the fetched ref.** `git checkout --force main` does not fast-forward a local `main` that is already checked out, so a piped new `install.sh` built an old tree (`bunx vite`, no Saker stub). The installer now fetches the ref and `checkout -B` onto `FETCH_HEAD`.
- **Public clone UI build no longer dies on `@saker/ui/styles/editor.css`.** The Saker fallback aliases are exact (`/^@saker\/ui$/`); a string `@saker/ui` prefix was rewriting the editor CSS to `saker-stub.tsx/styles/editor.css`. A leftover `package.json` from a failed `link:` is treated as missing unless the entry file exists.

## [0.8.24-beta] - 2026-09-08 — The door remembers

0.8.23 laid the floor: every persisted message written twice, facts and gists
extracted with no model call — and nothing read them yet. This release is the
recall half, and the door that lets another system's memory walk in.

What you import is kept whole. What you already knew — standing notes, a
corrective-invoice decision, never-commit — is injected into the turn, and a
paraphrase finds it without a tool.

### Memory — hybrid retrieval and assembler (Phase 2)

- Local embedder is `@huggingface/transformers` 4.2 + `multilingual-e5-small` q8 (Apache-2.0 / MIT), with the hashed stem embedder as fallback. Switching models wipes the previous vector space.
- Retrieval is gated fusion (dense-primary, lexical hits need ≥ 2 query stems; Klingon keeps lexical up-weight). Naive RRF is forbidden (spike: it dropped e5 R@5 from 85 % to 65 %).
- L3 KNN actually runs on the retrieve connection: sqlite-vec is probed/loaded there (a second `bun:sqlite` handle used to search FTS-only), `project_key` is the D1 set (global ∪ project ∪ project_type), and `live_in_index` is a MATCH filter, not an after-the-fact JOIN. Prepare failures are logged at warn, not swallowed as debug. Live set capped at 40 000.
- One injected section (`memory-context`, 1 200-token reserve) at both call sites: standing index, retrieved one-liners, auto-expanded top-2. Short reference MOCs (Werth, 3dee) are reserved inside the 8000-character index so they cannot be crowded out by feedback/project dumps. `memory_search` / `memory_expand` are the model-facing tools (3 calls/turn, project-locked, quoted). `search_memory` is an alias; `save_memory` is retired.
- Every inject and drill-down is written to `memory_access_log`. Duplicate FTS/vector weights in the search engine import the memory hybrid module.
- Acceptance fixtures: 80-pair / 300-distractor hu/de/en e5 R@5 (skip if `data/models` is empty); 20-question owner-eval on the live DB answers from injected context alone. A KNN worker thread is not in this release.

### Memory — layered ingest and hybrid recall (Phase 2 start)

- Imported vault notes and episodic rows are ingested into L0 (`document` / `legacy_episodic`) on boot, idempotently. Deterministic extraction then writes heuristic gists (L2) and structural facts (L1): `key: value` lines plus one `states` fact per imported note.
- Conversations extracted before that fact rule are rebuilt once (`reason=rebuild`) so L1 is not stuck empty behind the watermark.
- Related work includes unscoped imported episodic rows in a project conversation, and L0 `memory_raw_fts` hits (labelled `[note]` / `[episode]`). `search_memory` fuses those with current gists and facts.
- The always-on index fills remaining budget with current non-vault gists. Within a kind, short MOCs rank ahead of long session dumps so standing notes (Werth, commit rule) still fit the 8000-character budget.
- CLI-only installs get a local embedder: `multilingual-e5-small` when `@huggingface/transformers` is present, otherwise a hashed stem embedder (384-d). Gist, fact and entity vectors are written to `memory_embedding` / `memory_embedding_vec` (L3). Vault/episodic rows missing a vector are backfilled in the background.
- Always-on index budget default in `config/default.yaml` is 8000 characters so the owner's remaining user/feedback/project notes all fit after the junk purge.

### Data port — lossless import

- Every selected file is read whole at import time: no 12 000-character scan clip, no 4 000-character note cap, no 6 000-character skill cap; the original frontmatter, path, hash and modification time are kept under `source:`.
- Declared `type` becomes the note's `kind`; `feedback` files under `procedural/`; the source file name is the vault file name so wikilinks keep resolving; `description` (or the `MEMORY.md` hook) becomes the summary.
- Every skipped file is a visible row with a reason; the bullet-ratio "index file" rule that dropped bullet-heavy notes as indexes is gone — only `MEMORY.md` is an index, and it is imported as one note.
- Provider adapters: Claude Code, Grok CLI (incl. per-project session summaries), Cursor, Codex (SQLite memories, rollouts), Gemini CLI, Windsurf, Copilot, Obsidian, ChatGPT / Claude.ai / generic JSON exports.
- Skills import as whole packages (`references/`, `scripts/` verbatim, also copied to `data/skills/imported/`), with trigger phrases from the description; `.claude/agents` personas become agent definitions with mapped tools. Persona frontmatter must be a YAML mapping: a leading `---` block holding a sequence or a bare scalar was never frontmatter, so the file stays a visible skipped row (`not-a-persona`) instead of becoming an agent with a blank prompt.
- Rule proposals target the primary assistant and are appended to the current file on approval (two approvals no longer overwrite each other); optional *Project-type prompt* target.
- Idempotent re-runs (`Unchanged`), `-N` suffixes instead of overwrites, and an applied-items ledger that stores the sha256 of every body it wrote. Re-importing a rule file that is still waiting for approval reuses the pending proposal instead of stacking up a second one.
- **Roll back this import** undoes a whole job — notes, episodic rows, skills and their copied files, agents, approved rule sections — and rejects what is still pending. It is destructive, so the route requires the `delete` permission on Data Port: owner and admin only under the shipped defaults. A vault note whose body no longer matches the sha recorded in the ledger has been edited since the import, so rollback leaves it alone and reports it as skipped rather than deleting your work.
- Model enrichment is now an explicit choice: an **Enrich metadata with the model** checkbox on the review step, **off by default**. Left alone, the import is deterministic end to end and spends no model call. Ticked, it still only ever touches metadata — kind, summary, tags — for notes that declare no type of their own, and never the body.
- Recall: unscoped `project` / `domain` notes are global; `memory.index.budgetChars` makes the always-on index budget configurable.

### Data port — no limits

- The scan has no caps: the file-count cap is gone, the 4 MiB / 50 MiB per-file limits are markers on the row instead of skips, and there is no total-size cap. A tree ten times larger than a typical home directory is listed and imported in full; the cost is time and disk, never omission.
- The walker maps everything under the root — the home-directory keep-list is gone. Only directory classes that can never hold memory (`node_modules`, `.git`/`.hg`/`.svn`, `.cache`, `__pycache__`, `.venv`/`venv`, build outputs beside a build manifest, browser profile roots, `.Trash`, `Library/Caches`) are not entered, and each is still one visible row with its file count (`directory-skipped:<class>`). Symlinked directories are followed once; loops and unreadable folders are reported, never silently dropped.
- Everything with text content is a candidate, and what reads as memory or instructions is selected by default: assistant `*.jsonl` transcripts (sub-agent transcripts included), Cursor and Codex sessions, Obsidian session notes (`type: claude-session` / `grok-session`), legacy memory folders (`memory.local-backup-*`, `memory.old`, `*.bak` → tagged `legacy`), your own documents anywhere under the root, third-party product docs (tagged `third-party`) and rule files inside repositories (`.cursor/rules/*.mdc`, `.cursorrules`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `global_rules.md` → proposals). `not-durable` and `transcript` are labels only. Source-code and data/configuration files are listed and importable but not ticked.
- Secrets are stored, never dropped: a flagged file is imported verbatim and tagged `contains-secrets`; such notes, episodic rows and skills are hidden from every model-facing recall path by default — the always-on index, `search_memory`, related work, the reflection job, the nightly consolidator, the skill matcher, the assembled system prompt and the embedding write path — and `memory.recall.includeSecrets` (default `false`) opens them. Revealing them over the API is owner-only. The heuristic no longer flags lookups (`keychain_lookup(...)`, `os.environ[...]`, `getenv(...)`) or placeholders (`your-…`, `<…>`, `xxx`, `.env.example`). A flagged note is never handed to the optional enrichment model.
- An imported agent persona and an approved workspace rule file are the two kinds that stay ungated, because there the content *is* the prompt: they are tagged so you can find them, and the wizard and the docs say plainly that they are used verbatim in prompts. The recall gate is an automatic-inclusion gate, not a filesystem sandbox.
- A bundled skill file over 200 000 characters is inlined into the skill body up to that point with a marker naming the complete on-disk copy under the skill's asset directory, which is byte-exact. A single text file larger than one text value the engine can hold (about 512 MiB) is listed, hashed and selectable but reported as `exceeds-string-limit` instead of being filed — the row says why.
- Bodies are written byte for byte, leading and trailing blank lines included; the vault writer's single trailing newline and a dropped UTF-8 BOM are the only changes. The vault reader no longer trims on the way back, so a verbatim body survives the round trip. Earlier imports are still recognised as **Unchanged**.
- Provenance on every item: `source.adapter` / `source:<adapter>` tag, every alias path, and the content sha256 in the ledger for vault, episodic, skill, skill-assets, agent and proposal rows alike.
- Scale: candidates live in `data_port_candidates` (one row each, indexed by scan, kind, reason, folder and path) and folders in `data_port_scan_dirs`; the scan runs in the background, reports progress and yields to the server even inside a million-entry folder count or a multi-gigabyte file hash; the API pages and filters candidates and returns per-kind / per-folder / per-reason counts and a folder tree; the wizard renders a folder tree, a virtualised list and a preview with **Select all importable**, **Select none** and **Back to suggested** over the whole scan plus tri-state folder and kind checkboxes below them (the count beside each is the server's own answer for the wire on screen), and never loads the whole list; the runner streams items, keeps one container open, commits the ledger per 100 items, yields to the event loop, rebuilds the index once at the end, can be stopped after the current batch and resumes from its last committed batch after a restart. Scan and import times are reported. Imported episodic rows are not embedded during the import (no model call in the import path), and the 48-item enrichment cap is gone — enrichment stays opt-in and metadata-only.
- One large file, not the whole tree, sets the memory bound: importing a container costs several times its own file size in transient memory, because the file is held as one buffer while every unit inside it is rendered — about three times for a line-per-turn transcript, seven or more for a chat export parsed whole into one object graph. The import phase costs more than the scan (a 19 MB transcript measured 100 MiB scanning and 235 MiB importing), and a 90 MB chat export peaks near 900 MiB resident. The row-by-row profile stays flat and a scan keeps nothing once it finishes, so the peak follows your single largest file rather than the size of the tree.
- A cloud-storage root is now a counted directory class, and a dematerialised file anywhere else is listed but never read (`not-downloaded`). Reading a placeholder is a download: before this, mapping a home directory pulled 9.7 GB through the provider. Nothing is skipped — the rows are there, with everything `stat` knows about them.
- Home-directory scans no longer tick package caches, Photos libraries, editor-extension trees, session-stats, CLA signature trees, checkout `README`/`CHANGELOG` boilerplate, third-party product docs, or `eyas-memory-backup-*` snapshots. Those folders are still **mapped** as one counted row each (`package-cache`, `photos-library`, `tool-ephemera`); the files stay importable if you tick them. Owner memory (`.grok/memory`, `.claude/projects|skills|agents`, Obsidian vault notes) stays selected.
- Idempotent and additive: re-running a scan and import after this change adds only what is new; earlier imports are not rolled back. Scans made before this change are migrated into the table at startup. Sessions and skills are identified by content digest, so a whitespace-only edit to a source file after an import creates a second row rather than updating the first — vault notes, which have path identity, are re-stamped in place.

## [0.8.23-beta] - 2026-09-05 — Nothing said is lost

EYAS could hold a conversation and forget it. Messages lived in
`conversation_messages`, background agent output lived in `agent_events`, and
the memory tiers underneath stayed at zero rows — nothing wrote to them, so
nothing could ever be recalled from them.

This release lays the floor. A raw layer now keeps every message verbatim,
compressed and content-addressed, and a deterministic pass turns each flush
into facts, a gist, entities, topics and tags — with **zero model calls and no
API cost**. It is a write path: recall from these layers arrives in the next
wave, and until then the vault index and related-work blocks serve the prompt
exactly as before.

### The raw layer

- **Every persisted message is kept a second time, verbatim.** Each one becomes
  a zstd blob keyed by the SHA-256 of its *uncompressed* bytes, plus a
  `memory_raw` row carrying actor, task, project, source type, timestamp and
  trust tier, a contentless FTS5 entry, and structural tags. Two byte-identical
  messages inside one task share one blob (`ref_count 2`); across two tasks they
  get one blob each, so a future per-task erasure stays possible.
- **Capture sits at the persistence layer, not after the turn.** Chat messages
  are captured inside `addMessage` itself, so interactive routes, `executeAgent`,
  the orchestrator, God Mode's winner promotion and every channel adapter are
  covered structurally rather than by remembering to call something. Background
  agent output is captured from the event store's `LlmResponse` append and joined
  to its conversation through `agent_sessions`.
- **Trust is assigned at capture and never inherited from context.** Your own
  messages are `owner`, model-authored text is `derived`, tool output is
  `ingested`. A derived row can never outrank the sources it came from.
- **Writes are buffered per task and flushed on four triggers:** the task closes
  (or moves into a closed stage), the buffer passes `chunkTokens` (8000
  estimated tokens), a once-a-minute sweep finds it idle for `idleFlushMinutes`
  (30), or EYAS stops — shutdown flushes everything still buffered, so a restart
  loses nothing. A failed flush rolls back and returns its units to the buffer.
- **Idempotency is keyed on the capture-time id, not on content**, so a retried
  flush is a no-op while two genuinely identical replies stay two occurrences. A
  reply that arrives twice through two different paths — once as an event, once
  as the message that follows it — is suppressed once, within ten minutes and
  within one task.

### What EYAS derives from every flush

- **A deterministic extraction pass runs after each committed flush, with no
  model call.** It reads the task's new rows above a per-task watermark and
  derives: structural facts from `key: value` lines (up to 20) plus up to four
  board facts (title, project, project type, agent); entities by regex — dates,
  `@mentions`, `#tickets`, code identifiers, backticked terms, capitalised
  phrases (up to 50); topics from TF-IDF stems unioned with entity names; and a
  gist of at most 280 characters built from the first and last message plus up
  to three TF-IDF-picked sentences. This is a property of the import graph, not
  a code path left untaken: nothing under `memory/v2` imports a model, provider
  or gateway.
- **An importance score is computed from the conversation itself** — message
  count, your own text volume, decision markers in five languages, whether the
  task is closed and whether you pinned it. The weights are hand-set and
  published in the source.
- **Facts are arbitrated, not appended.** A fact whose content hash already
  exists, still live and in the same project, is linked rather than duplicated.
  The same `(subject, predicate)` with a different object supersedes the old
  row: the old one gets a `valid_until` and an `invalidated_by_fact_id`, so
  "deadline is Monday → Friday → Monday" ends with exactly one live fact and an
  intact history. Nothing is updated in place and nothing is deleted.
- **Tags are inherited only when every source carries them.** A fact or gist can
  never carry a project or task its own sources lack; a violation is counted and
  the tag withheld.
- **Every run is recorded, including the ones that do nothing.** `memory_run`
  gets a row for each extraction with its trigger, counts, language, importance
  and — always, in this release — `model_used = NULL` and `model_calls_used = 0`.
  A skip writes a row too.

### The poisoning gate

- **Instruction-shaped text never becomes a fact or a gist at full trust.**
  Explicit override phrasing — "ignore all previous instructions", "hagyd
  figyelmen kívül", "vergiss alles", "olvida todo", "oubliez tout", role
  reassignment with "from now on" — is rejected outright. Imperatives aimed at
  the assistant, tool-invocation directives and memory-wipe directives are
  quarantined: stored, but at a trust tier that recall must exclude. Fake role
  markup (`<system>`, `[INST]`, `SYSTEM:`, shouted headings) is quarantined too.
- **A rejected gist degrades rather than disappearing:** it falls back to the
  heuristic gist, then to only the sentences that scan clean, then to a stub that
  keeps the task addressable without carrying the text. Every rejection and
  quarantine is counted in the run row.
- Coverage is English, Hungarian, German, Spanish and French. It is a regex
  gate — a filter, not a proof — and it will occasionally quarantine ordinary
  engineering prose such as `Execute the following command in the pod: …`.

### Configuration

Seven new keys, all under `memory`:

- **`memory.l0.enabled`** (default `true`) — the master switch for raw capture.
- **`memory.l0.extractInLegacy`** (default `true`) — derive facts and gists even
  though `engine` is still `legacy`. Set it to `false` to keep the raw text and
  derive nothing.
- **`memory.engine`** (default `legacy`) — selects the read/write engine. Today
  it gates only extraction; it does not switch retrieval yet.
- **`memory.l0.chunkTokens`** (8000) and **`memory.l0.idleFlushMinutes`** (30) —
  the two size and time flush triggers.
- **`memory.l0.captureToolResults`** (default `false`) — **read this before
  turning it on.** A captured tool result is the whole output, verbatim and
  unredacted, plus 2048 characters of the call's arguments: `run_command` stdout,
  `read_file` contents and a live `browser_totp` one-time code all land in the
  raw layer as plain text. Nothing redacts them and nothing encrypts them at
  rest — `dek_id` is NULL and zstd is compression, not confidentiality. With the
  flag on, every boot prints a warning saying exactly that.
- **`memory.l0.toolResultMaxBytes`** (8192) — the byte cap applied to a captured
  tool result, clipped on a UTF-8 boundary with a visible truncation marker.

### Diagnostics and platform

- **`eyas doctor` reports two new lines.** SQLite capabilities are probed live —
  FTS5 is required and a missing one is a hard failure; sqlite-vec is checked by
  actually loading it, inserting an int8 row and running a KNN query, with a
  platform-specific remedy when it is absent. The zstd tier is reported too:
  native is fine, the WASM fallback is a warning (about 2× slower), none is a
  failure.
- **A three-tier zstd shim** picks Bun's native compressor, then `node:zlib`
  (Node ≥ 22.15; 23.0–23.7 have none), then `@bokuweb/zstd-wasm`. If no tier
  resolves, capture is disabled loudly and says so — never left buffering
  silently. Level 3, measured ratio ≈ 2.7 on real text, about 32 µs per message.
- **One new dependency:** `@bokuweb/zstd-wasm` 0.0.27 (MIT), used only when
  neither runtime provides zstd natively.
- **Every EYAS database connection now runs `PRAGMA synchronous = NORMAL`**
  instead of SQLite's default `FULL`. With WAL this stays durable across a
  process crash, but not across an OS crash or power loss at the instant of
  commit. This applies to all modules, not only to memory.
- **The capability probe no longer runs inside an open transaction.** It used to
  be able to swallow a caller's uncommitted rows; it now refuses, loudly, and a
  failed probe is never cached.

### What this release does not do yet

- **Nothing reads the new layers.** There is no retrieval path, no HTTP
  endpoint, no UI page and no `eyas memory` command in this release: the raw
  rows, facts and gists are written and then wait. Recall, embeddings and the
  context assembler are the next wave. Setting `memory.engine: v2` today changes
  nothing.
- **The raw layer grows and nothing prunes it.** There is no retention setting
  and no cleanup job yet; measured, a captured row costs on the order of 5 KB
  all-in including indexes. If you would rather not pay that yet, set
  `memory.l0.enabled: false`.
- **Rows whose source timestamp predates the extraction watermark are not
  extracted.** They stay in the raw layer and are counted in the run row, and a
  future rebuild recovers them.

## [0.8.22-beta] - 2026-09-03 — The door opens

A knock got you native or Docker. The native path then died after a
successful-looking `bun install`: Vite could not find `@vitejs/plugin-react`,
because the UI is a nested package the root install never touches.

The door opens now: nested `src/web` deps, one retry if a package is still
missing, unlinked local editors skipped, and a public clone still builds a UI.

### One-line installer

- **Native install now installs the nested frontend package.** `src/web` has
  its own `package.json` and is not a bun workspace, so root `bun install`
  never put Vite or `@vitejs/plugin-react` on disk. The next step — `bunx vite
  build` — then died with `Cannot find package '@vitejs/plugin-react'` after
  a successful-looking root install. The installer (and `eyas start` /
  `eyas update apply` / the Docker image) now `bun install`s `src/web` first,
  retries the UI build once if a package is still missing, and skips `link:`
  deps that are not `bun link`-ed on this machine (the Saker editor) so a
  public clone still produces a UI.

## [0.8.21-beta] - 2026-09-02 — A knock at the door

The one-line installer used to guess. Docker on PATH meant Docker, even when
the daemon was down and Bun was missing — and it asked for an admin account,
an AI provider and an agent name that the setup wizard would ask again.

It now knocks first: native or Docker every time, an offer to install (or
start) whatever is missing, and the wizard left to the wizard. GitHub
Sponsors is on the repository, the README and the landing page.

### One-line installer

- **Always asks native vs Docker**, even when both runtimes are already present.
  Missing git, Bun, or Docker is offered for install (and started, if Docker
  Desktop is installed but the daemon is down) instead of silently picking a
  method and failing at `docker compose up`.
- **Setup-wizard fields left to the wizard.** The installer no longer collects
  admin user/password, AI provider, API key, language, or agent name — those
  belong to first boot in the browser. Directory and HTTP port stay.
- **Banner:** original ANSI Shadow EYAS, with the eYssen slant wordmark above it.

### Sponsors

- **GitHub Sponsors is wired through the mirror.** `.github/FUNDING.yml` lives
  in this repository so the next orphan snapshot of public `main` keeps the
  Sponsor button. Tiers, the $1,000/month model-bill goal, and the full list
  are in `SPONSORS.md`; the README, the landing page and the docs index in
  all six languages point there. Sponsorship is not a support contract.

## [0.8.20-beta] - 2026-09-01 — A front door, and its locks

EYAS had no public face: the overview page lived in the repository, the
documentation was only reachable from a running instance, and the README still
described a smaller project than the one in the tree.

It has one now — https://eyssen.github.io/eyas/ — and turning the repository's
scanners on for the first time found real defects behind it, which this release
fixes.

### A public site

- **The landing page and the docs are published together.** `/` serves the
  product overview, `/docs/<lang>/` the 392-page documentation in all six
  languages. One build script assembles both, and CI runs the same script
  rather than a copy of its logic.
- **The landing page speaks six languages, not two.** Every string exists per
  language in the page itself, so it stays a single self-contained file. The
  language is chosen before first paint from `?lang=`, the last choice, or the
  browser, and English renders without JavaScript.
- **A beta callout and an installation panel replaced a mock terminal line.**
  The callout asks for reports and links the issue tracker; the panel carries
  the three real install routes and a link to the getting-started guide that
  follows the language switch.

### Security fixes

- **Email header injection in both address formatters.** A display name was
  written into a header without removing CR/LF, so a name carrying
  `\r\nBcc: …` added a recipient. The quote was escaped but the backslash was
  not, so a name ending in one escaped its own closing quote.
- **The CLI MCP bridge secret came from `Math.random()`** plus a timestamp.
  That secret authenticates bridge sessions; it now takes 24 bytes from the
  CSPRNG and encodes no clock.
- **Notification event patterns are globs, but only the dot was escaped**
  before the star was expanded, leaving every other regex metacharacter live:
  `board.(task).*` matched `board.task.assigned` through a regex group.
- **Generated skill frontmatter escaped quotes but not backslashes**, the
  key-injection its own guard was written to prevent.
- **The research HTML stripper** missed `</script >` and `</script foo>`, kept
  the contents of comments, and kept a tag left unterminated by truncation.
- **Four advisories patched**: drizzle-orm (SQL injection via improperly
  escaped identifiers), nodemailer, `@anthropic-ai/sdk`, and sharp in the docs
  package. Measured against a baseline: the suite fails identically before and
  after, so the upgrades change nothing else.

### Around the repository

- **A security policy, a contributing guide and issue templates.** Private
  vulnerability reporting is on, and `SECURITY.md` now names that channel
  instead of leaving reporters with a public issue. `CONTRIBUTING.md` leads
  with what a contributor cannot guess: this repository is a mirror.
- **The README's figures are measured, not estimated.** 57 modules, 228 skills,
  7,200+ tests across 747 files, twelve provider submodules including the CLI
  engines that need no API key, and the six setup-wizard steps the code
  actually registers.

## [0.8.19-beta] - 2026-08-31 — Related prior work

A new chat used to know who you are and how you work. It did not know that
this task is the follow-up to one you already finished. That knowledge lived
in a provider's own memory — and vanished when the provider changed.

EYAS now searches its own store on every turn: past user and assistant
messages, plus the vault, plus episodic notes. A small related-work block
lands in the prompt without the model having to call a tool.

### What the last job was

- **Past conversation text is searchable.** User and assistant messages get
  an FTS index (diacritics folded, bodies clipped). Deleted threads stay out.
  Backfill is chunked so start does not wait on history.
- **`search_memory` includes those messages by default.** Hits are labelled
  `conversation`. The current thread is excluded. Other projects stay out
  unless `scope=all`. HTTP search stays unfiltered.
- **A related-work block is injected on every turn.** The current message is
  the query. Vault, episodic, and conversation hits are one-liners. Follow-up
  is still `search_memory` for a body. Resume after a skill proposal uses the
  stored user message, not an empty body.

### What stays out of the block

- **An echo of this turn is not prior work.** A sibling conversation that
  only restates the question is dropped so the actual earlier decision can
  rank.
- **Weak vault glue is not a hit.** Notes that only share short words
  (`durable`, `setup`, `from`) stay out. Codes and distinctive names
  (`IAP`, `Cloudflare`, `1010`) still match.
- **Conversation hits keep two reserved slots.** A full vault cannot push
  the last related thread off the block.

Handbook: Memory and Tools — six languages.

## [0.8.18-beta] - 2026-08-31 — A desk of its own

Memory fills itself. Hands can make a still, a clip, a form. What was still
missing is the desk: a place the work belongs so a new chat does not dump onto
`general-general`, sibling projects share family facts without seeing each
other's notes, and a long tool-using session can stay in the web UI instead of
fleeing back to a TUI.

The desk is a project. A type names the family; a project is one instance of
that family. Folders, connections, memory, and wiki pages inherit from type to
project to conversation. EYAS is a general product — the paths, the tickets,
the clients live on the instance.

### The project is the room

- **New conversations pick a project grouped by type.** Domain work no longer
  silently lands on `general-general`. New projects inherit type sources and
  directories when omitted; an empty project prompt inherits the type brief
  instead of copying it. Instance projects are not seeded.
- **A domain type ships with a generic operating brief.** Indexer, local vs
  remote writes, domain notes vs project notes. The type is a behaviour, not
  a tenant.
- **The project form prompt actually reaches the model.** The form wrote DB
  prompts; the assembler read `AGENTS.md`; the two never met. The loader now
  takes a non-empty DB prompt first (file fallback), applies `+` / empty /
  override, and a form save materializes `AGENTS.md` as a derived dump.
- **Tags stay a board filter.** They render as one `tags:` line in the prompt
  suffix so a swap does not change the project-context cache prefix. Category
  names are documented, not seeded.

### Memory that knows which desk it is on

- **Type-level domain notes rank with the active project.** A `kind=domain`
  note is for the conversation's project type, so sibling projects share
  family facts without seeing each other's project notes. `general-general`
  has no type notes. Capture stays in the EYAS vault.
- **`search_memory` defaults to the current project and type.** Other
  projects stay out unless the model passes `scope=all`. HTTP vault search
  stays unfiltered.
- **Named working directories pin from type to conversation.** Types and
  projects store optional named folders (name + absolute path). An empty
  project list falls back to the type. New conversations pin that list the
  way they pin search sources; file tools stay inside the pinned roots, not
  the EYAS checkout. The conversation fields bar picks the primary workspace.
- **Catalog connections pin on the project.** Ticket tools use
  `ticketConnectionId`; other tools use `defaultConnectionId`. An explicit
  `connectionId` wins. Missing project connections still fall back to the
  global secrets.

### The wiki writes the project's own pages

- **Closed board cards write `ticket-<id>` on the project's wiki.**
  Team-session findings and decisions write `decision-<id>` there instead of
  the vault when the conversation has a project. Human saves take ownership.
  `general-general` gets no page.
- **Wiki writes stay off until a project opts in** to closed tickets and/or
  team decisions. Ticket pages default to title-only instead of the
  transcript.

### A conversation that can stay in the web UI

- **Long tool-using chats keep a trace.** What is running, short args, a
  file-edit diff. Stop aborts the server-side run. Plan first parks a written
  plan for approval before tools run.
- **`git status` and `git diff` skip approval.** CLI providers sent those
  read-only commands through Bash/`run_command`, which is red on every call.
  When the argv matches the dedicated tools, the gate allows them as green.
  Arbitrary shell, write-git, and metacharacters stay refused.

### Skills, Telegram, and a copy of what you already wrote

- **Extra skill and persona roots import without host Claude config.**
  Instance overlay lists markdown directories. Imported files win on id
  collision and appear on the Agents page. Isolation stays on:
  `settingSources` stay empty; host `MEMORY.md` is not loaded.
- **Telegram `/new` and `/start` start a fresh thread.** Paired DMs already
  created one conversation per sender. The slash command drops that mapping
  so the next message does not go to the model. When a yellow or red tool
  waits, the paired chat gets an Approve/Deny ping. Raw tool args stay off
  the ping.
- **Data port copies, it does not mount.** Scan → review → import writes
  markdown into the EYAS vault. The source path is not read again.
  Undeclared notes get `kind: reference`, never `user`. `MEMORY.md` indexes
  and `claude-sessions` transcripts stay out even if everything is selected.
  A home scan stays in assistant folders and Documents — `GitHub` and other
  source trees are not walked. Grok memory files that symlink into
  `ai-memory` count as that vault; they are not imported twice. Classify and
  transform prompts assume the user pointed at the wrong (too wide) folder.

### Ops is Kubernetes, not a cloud overlay

- **The ops module and Helm chart are general Kubernetes.** Cloud-provider
  values stay on the instance; bundled OCI skills are unchanged. The OCI OKE
  overlay is gone.

### The product is not a tenant

- **EYAS is a general product; this operator is one tenant.** Capture prompt
  and tests no longer name shop clients, modules, or tickets. Instance data
  stays on the machine.

Handbook: conversations (working folders, tool trace, plan first), projects,
skills import roots, Telegram `/new` + Approve/Deny, git remap, and Data
port — six languages.

### Known issues

- **Plan first still wants a live trial on a long product conversation.** The
  four surfaces (trace, diff, stop, plan) are in; a real long run on this
  machine has not been the gate.

## [0.8.17-beta] - 2026-08-29 — Hands that make things

An agent that can remember still cannot show you the thing. This wave is the
hands: generate a still or a clip through a vendor you already pay, render a
title card on this machine, cut footage from a transcript, and fill a form in
a browser that is not the one you use every day.

Media is SaaS prompt-to-pixel. Studio is local production. The browser is
EYAS's own Chromium, plus optional sidecars when the work needs the Chrome
you already logged into. Recordly records the screen; it is AGPL, so it is a
catalogue card, never a bundled engine.

Every lane fail-closes with a remedy. Missing Node, missing FFmpeg, missing
CLI, missing Chromium: the tool says so. None of them silently disable the
sandbox. None of them vendor a third-party LLM. The model stays EYAS's.

### Media is SaaS, and none of it is default

- **Agents generate, upscale, and wait through five `media_*` tools.**
  `media_catalog`, `media_generate`, `media_wait`, `media_balance`,
  `media_history`. The vendor is a routing choice, not a tool dump.
- **Magnific, Higgsfield, and fal are optional backends.** None is default;
  several can run at once. Zero connected providers is an empty, fail-closed
  state — never mock pixels. Magnific and Higgsfield sign in with OAuth; fal
  takes an API key. The Media page and the handbook compare them on the
  criteria that actually matter here: strength, sign-in, credits, and file
  lifetime.
- **Completed files land in Documents and on the producing turn.** Vendor CDN
  URLs expire — Higgsfield's in about seven days — so ingest copies the bytes
  locally (up to 200 MB, no JPEG recompress) rather than leaving a link that
  will 404.
- **Raw vendor MCP tools stay off.** Turning them on dumps `mcp_magnific_*` /
  `mcp_higgsfield_*` / `mcp_fal_*` onto the agent and skips ingest. Leave them
  off unless you are debugging.
- **Routing is per kind, with an optional budget.** Default / fallback cover
  an outage; "also run on" fans the same prompt out and doubles credits.
  Daily and monthly caps fail **before** the vendor is called.

### Studio is local production

- **Studio is a new category** (Content → Studio, `/studio`), not Media.
  Local engines live here; Media stays hosted prompt-to-pixel.
- **First engine: Hyperframes.** The agent authors HTML compositions and
  renders deterministic MP4s through six `hyperframes_*` tools. Node.js 22+,
  FFmpeg, and the Hyperframes CLI are required; missing any of them fail
  closed with a remedy. Hyperframes downloads its own `chrome-headless-shell`
  — never `EYAS_CHROMIUM_PATH`, never `--no-sandbox`. Output lands in
  Documents and on the producing turn. The CLI is Apache-2.0 and is not
  vendored.
- **Second engine: Video Use.** Transcript-first footage cuts (`videouse_*`).
  EYAS reimplements the open-source hard rules in TypeScript (MIT) rather
  than vendoring librosa or Manim. FFmpeg on this machine; ElevenLabs Scribe
  is optional for transcription. Confirm a cut strategy before writing
  ranges. Overlays can be Hyperframes renders. Not Media, not Hyperframes.

### Recordly is a companion, not a product

- **Recordly is an AGPL desktop screen recorder.** It is not a Studio engine
  and it is not bundled. Catalogue card: Extensions → Third-Party
  (`recordly`). Manual install only (GitHub / Setup guide);
  `POST /extensions/recordly/install` is refused. Export MP4/GIF in Recordly,
  then attach in Documents. Skill: `config/skills/integrations/recordly.md`.

### A browser of its own

- **Headless `browser_*` tools share the design-print Chromium.** Numbered
  interactive indexes from `browser_snapshot` (click/fill by index; CSS is
  the fallback). Indexes and `snapshotId` die on navigation — snapshot
  again. Same SSRF, same 5-minute process.
- **The session is a real browser, not a one-shot page.** Tabs, back, wait,
  hover, select, dialog, file upload, page `evaluate`, download → Documents,
  Playwright `storageState`, and an EYAS-owned `userDataDir`
  (`data/browser/profile` / `EYAS_BROWSER_USER_DATA_DIR`). The daily Chrome
  profile is rejected first (Chrome 136+ blocks Default-profile CDP).
- **Action cache without Stagehand.** A successful `browser_click` /
  `browser_fill` with `intent` stores a durable CSS/role locator in vault
  JSON (`projects/<id>/` or `procedural/browser-action-cache.json`).
  `browser_replay` reuses it on the same origin without an LLM or a snapshot
  index. Fill values and TOTP seeds are never cached.
- **`browser_totp` (yellow)** reads the seed from Secrets or macOS Keychain
  and returns only the 6-digit code for `browser_fill`. The seed never
  leaves that call.
- **Snapshot and locator scripts run as IIFEs.** Playwright `evaluate` of a
  string does not call `() =>` sources, so indexes and cached locators would
  otherwise stay empty. That was a live miss, not a design choice.

### Sidecars for the Chrome you already logged into

- **Agent Browser is the recommended sidecar** (Vercel, Apache-2.0).
  `EYAS_AGENT_BROWSER_BIN` → PATH, fail-closed doctor
  (`doctor --offline --quick --json`). Tools `agent_browser_status` /
  `agent_browser_run` (argv or batch JSON, `@e1` refs). MCP catalog
  `agent-browser mcp --tools core,state` → `mcp_agent_browser_*`. EYAS-owned
  `--profile` (`data/browser/agent-browser/profile`). Daily Chrome /
  `--profile Default` / `--auto-connect` / `chat` / `--tools all` refused.
  Rust is not vendored. `AI_GATEWAY_*` is stripped on spawn. The LLM stays
  the EYAS model module.
- **Python Browser Use remains as a legacy sidecar.** Extra module, MIT CLI
  wrapper, telemetry off, Cloud API key stripped unless turned on.
  `browser_use_status` / `browser_use_exec`. UI `/browser-use`. Prefer Agent
  Browser when that card is Ready.
- **Playwright MCP** is a Connections catalog row (`playwright-mcp`) plus
  MCP catalog sidecar (`npx @playwright/mcp@latest --isolated`). Agent tools
  arrive through the existing MCP bridge (`mcp_playwright_*`). Doctor is
  fail-closed (Node 18+, npx). Telemetry off. `--no-sandbox` is stripped and
  refused. The Python browser-use MCP is rejected (it wants an LLM key and
  `retry_with_browser_use_agent`). Live tab: Playwright MCP Bridge extension
  (`--extension`).
- **Chrome DevTools MCP** (Google, Apache-2.0) is a separate coding/debug
  lane — Connections type `chrome-devtools-mcp` plus MCP catalog
  (`npx chrome-devtools-mcp@latest --isolated`). Console, network,
  Lighthouse, WebMCP. **Not** form-filling (`browser_*` stays the form
  lane). Tools arrive as `mcp_chrome-devtools_*`. WebMCP
  (`list_webmcp_tools` / `execute_webmcp_tool`) only if the sidecar
  advertises them. `--autoConnect` and the daily Chrome profile refused.
  `--no-sandbox` stripped. Doctor fail-closed.

### MCP that can reach a hosted server

- **The MCP client speaks Streamable HTTP and OAuth.** Hosted creative
  servers connect without a custom adapter per vendor. That is what made
  Magnific and Higgsfield possible as Media backends rather than one-off
  integrations.

### The handbook

- **The Starlight docs are rewritten around a first-hour path**, with a
  purpose opening on every chapter, the missing admin surfaces filled in,
  and in-app `?` help wired on every remaining product page. Six languages.

### A skill proposal can turn the skill off

- **The third button is global.** "Not this time" still only covers this
  conversation. "Turn it off" declines here and disables the skill, so it
  will not match again until someone turns it back on in Skills. The turn
  then resumes the same way as a decline. Only owner and admin see the
  button — a user who can talk but cannot manage skills still has yes and
  no.

### Fixed along the way

- **The kanban context stripe used the conversation's lifetime token total
  against a hardcoded 128k window.** Opening the same Grok card painted
  green (composed size / 500k) while the board painted red (cumulative /
  128k). Occupancy inputs now come from one function
  (`loadConversationContext`): latest composition `estimated_tokens` over
  the model's real window. The board, the conversation GET, and the
  end-of-turn frame all attach those fields; both stripes only paint them.
  A card with no composition stays blank rather than inventing a reading
  from `tokensUsed`.
- **The open chat overflowed the viewport by about a centimetre.** The page
  sized itself with `100vh` minus the top bar and ignored the status bar
  plus leftover main padding. New messages then called `scrollIntoView`,
  which scrolled every overflow ancestor and hid the header. The pane now
  fills the chrome remainder, and only the message list scrolls.
- **The template picker is opaque.** It already sits above the page (the
  header is a stacking context), but it was still a `glass-card` — 3%
  white in dark mode — so the page bled through the names. It now uses
  the same solid `popover` surface as the notification panel and the
  user menu.

### Known issues

- **The skill matcher still scores badly.** The third button means a bad
  match now costs a click and then stops being offered, but the scoring
  itself is untouched — `google-drive-integration` can still light up for
  "what time is it".
- **Action-cache locators are CSS/role, not visual.** A redesigned page on
  the same origin will miss. That is the Stagehand idea without the
  library, and a restyle is a cache miss rather than a silent click on
  the wrong control.
- **No sidecar binary is in the tree.** Agent Browser, Playwright MCP,
  Chrome DevTools MCP, Hyperframes CLI, FFmpeg, and the Chromium used by
  `browser_*` are resolved or they say they are missing. A VPS without
  them is a working EYAS that cannot click or render until they are
  installed.

## [0.8.16-beta] - 2026-08-28 — A memory of its own

What EYAS knows now comes from what EYAS remembers. The vault writes itself: a
durable fact stated in any conversation — on any model — becomes a note without
anyone asking, and the same note is what every later conversation reads back.
Closing that loop meant winning an argument with the host machine: conversations
on the Claude Code CLI no longer read the owner’s own Claude config and memory,
because an assistant that can see a second memory will happily report a fact
“already recorded” that its own vault has never held.

Every fix here was found the same way: a live test, a measurement table, and a
root cause chased until it reproduced deterministically. The capture run ledger
(`memory_capture_runs`) is why each diagnosis took minutes instead of days.

### Memory that fills itself — and knows where it came from

- **A durable fact learned in a conversation is written to the vault without
  anyone asking.** Capture runs on every conversation, globally, on by default;
  `memory.capture.enabled` in `config/default.yaml` switches it off. A small
  model call attaches to a qualifying turn AFTER the reply has been delivered —
  never in its critical path — and a capture that fails is a missing note, never
  a failed conversation.
- **The extractor reaches a model that can answer it, whatever the instance
  runs.** Capture assumes nothing about what is installed — most instances are a
  VPS or a pod with no room for a local model, and many have nothing but a host
  CLI. Resolution is a ladder over what is actually enabled: the `heartbeat`
  tier, but only when this instance really has the provider that tier names and
  it is not a CLI; otherwise the first enabled, registered provider that is not a
  host CLI whose model can be named; otherwise no pin at all, letting the gateway
  fall back the way it does for any unpinned request — anthropic when registered,
  else the first registered provider, a CLI included — because a capture that is
  attempted is measured and one that is skipped is invisible. The rung is
  logged. The routing tier is configuration, so it can name a provider this box
  does not have — and it did: the pin was silently dropped, and a CLI provider's
  `complete()`, which runs a full agent turn, answered the extraction prompt in
  prose. One `unparsable` row per qualifying turn, and never a note.
  Three repairs meet the CLI there as well: the parser lifts the first balanced
  `{…}` object out of surrounding chatter (string-aware, so a brace inside a
  value does not close it), the prompt says the reply is the object and nothing
  else — no commentary, no fence, no tool calls — and the unusable-output
  warning now carries the reply's length and its first 200 characters, so the
  next diagnosis is not blind.
- **The extraction runs in an isolated context, so a CLI's own loaded memory
  cannot pre-empt EYAS's.** A request can now ask to be `isolated` — no
  filesystem settings, no CLI-native memory or config, no bridged tools, a
  single turn — and Claude Code honours it whatever its `loadClaudeMd` setting
  says. Without it the extraction call loaded the owner's `~/.claude` memory,
  which another tool had already written the fact into: the model read it there,
  reported it known, and EYAS's vault — the one place it was NOT recorded —
  stayed empty. No prompt rule wins against a whole loaded memory system. The
  ladder now prefers a CLI that advertises the capability over one that does
  not, choosing on the CAPABILITY and never on a provider name; grok CLI's
  protocol offers no such switch, so it says so rather than pretending.
- **The extractor believes the notes on file, not the assistant's account of
  them.** A retest caught it returning a healthy-empty batch on a fact-dense
  exchange: the reply had said "I've already saved that to memory" — it had not,
  the CLI narrated a tool call that never ran — and the extractor honoured the
  do-not-restate rule against that claim while its own EXISTING NOTES section
  was empty. Coverage is now judged ONLY against EXISTING NOTES, and the prompt
  says in as many words that an assistant's statement about saving is narration,
  not evidence. What a model concludes cannot be asserted in a test; that the
  instruction ships is pinned by one.
- **Every capture run records which model produced it.** `memory_capture_runs`
  gains a `provider` column holding `provider/model` — NULL when no model was
  called, because a gate skip spends nothing. An instance with several providers
  could already count its unparsable runs but could not say which model was
  failing to answer in JSON, and answering that took a live retest once already.
- **Memory is EYAS's own, in both directions.** The mandatory memory rule named
  no tool and only one direction ("update memory when you learn something new"),
  which a CLI-backed agent reads as its own machine-global convention. It now
  names `search_memory` for recall and `save_memory` for recording, states that
  EYAS's memory is the only memory, and forbids writing to a machine-global
  memory directory, an `ai-memory` or Obsidian vault, `~/.claude` or `~/.grok`.
  Because a rule is guidance, the deterministic gate denies the same paths to
  every file-writing tool, matching the path fields of a call and never its
  content. `Read`, `Grep` and `Glob` stay open — the data-port importer exists
  to carry exactly those notes into EYAS — but the shell is blocked in both
  directions, because `cat` is one character from `>>` and no reading of a
  command string proves which one it is. The denied set is narrow on purpose:
  an `ai-memory` directory, a home-anchored `~/.claude` or `~/.grok`, and a
  `memory/` directory under either. A workspace's own `.claude/settings.json`
  and `.claude/agents/*` pass, since that is project config, not memory.
  `MEMORY.md` is deliberately not on the list: the gate is handed a path, not a
  workspace root, and cannot tell the owner's global index from a repository's
  own `docs/MEMORY.md`.
- **The gate is structural, not lexical.** One length check, `minUserChars`
  (default 40), counted in Unicode code points so an accented message gates
  identically to an ASCII one of the same length. No keyword list in any
  language: this product ships in six, and the repository has already paid twice
  for that class of bug — JavaScript's `\b` is ASCII-only, so `\bűrlap` never
  matched "Űrlapelemek", and Hungarian lengthens the stem vowel, so "minta" is
  not a prefix of "minták". Deciding what a sentence MEANS is the model's half
  of the design.
- **The runaway guard counts model spend, not turns.** `maxPerConversation`
  (default 20) is consumed by a successful extraction, an unparsable reply and
  an errored call — never by a too-short skip. Counting skips meant twenty short
  acknowledgements ("ok", "mehet") exhausted the budget without a single model
  call, and the next fact-rich turn was refused. Every outcome still writes its
  row; only what the budget is spent on changed.
- **0–2 candidate notes against a strict schema.** `user` (who the owner is),
  `feedback` (how to work — invalid unless it carries both a Why and a How to
  apply), `project` (a durable fact about the conversation's project) and
  `reference`. When the conversation has no real project, a `project` candidate
  is REJECTED by the schema rather than hidden from the model — and because the
  refinement runs per note inside one array parse, a single stray project
  candidate fails the whole batch, which is then dropped and recorded as
  `unparsable`. `{"notes":[]}` is the common and correct answer, and the prompt
  says so.
- **A repeated fact reinforces one note instead of spawning a second.**
  Deduplication is word-set overlap against the existing summary rather than
  string equality, because a reinforcement rephrases ("Answers in Hungarian" →
  "Answers in Hungarian, always"); a match appends a dated bullet under
  `## History` and never overwrites what was there.
- **Sanitised before it touches disk, not when it is read.** The privacy module
  runs over the summary and the body before the vault write, because a read-time
  redaction would leave the raw text in the file and in the FTS index built from
  it.
- **A project's facts rank first inside that project and are invisible outside
  it.** The always-on index ranks global `user` and `feedback` first, then the
  ACTIVE project's `project` notes, then `reference`; another project's notes
  never appear at all. Project notes live in `projects/<project-id>/` with a
  `project` frontmatter field frozen at capture, so re-scoping a note is a
  deliberate act rather than a side effect of the next update.
- **The seed catch-all project is not a project identity.** Every conversation
  defaults into `general-general`, so treating it as a real project would file
  the owner's general facts under it and hide them everywhere else.
  The rule lives in one FUNCTION, `effectiveProjectId()`, and every entry point
  calls it — capture, both recall paths, and the memory tools — so the write
  half and the read half cannot disagree about what counts as a project.
- **Every note records where it came from.** `memory_note_links` names the
  conversation that wrote a note or later reinforced it, in the same multi-owner
  shape as `design_links` and `document_links`, and episodic memories now carry
  `conversation_id` and `project_id`.
- **Every outcome that reached the gate writes a `memory_capture_runs` row** —
  skips with their reason, extractions with the kinds they wrote. Two silences
  are deliberate: capture switched off writes nothing at all, and a background
  run with no assistant text to read never reaches the gate, because a skip row
  per autonomous run would only inflate the diagnostics it exists to keep
  honest. One silence is a known gap rather than a choice: a God Mode turn
  returns its own stream before the post-turn block and so captures nothing —
  no note, no row. That is what makes
  `minUserChars` a tunable number instead of a permanent guess, and the `kinds`
  distribution is the only way a mislabel (a project fact filed as `user`)
  becomes visible without reading the vault by hand.
- **A boot-order bug had silently stopped the memory lifecycle hooks from ever
  wiring.** `conversations` checked `ctx.memory` in its own `onStart`, but the
  loader orders modules by hard `dependencies` only and starts `conversations`
  before `memory` on every boot — so the hooks were wired 0 times in 68 recorded
  start cycles. They resolve lazily now, with the same pattern as the lazy
  getters that were already on the lines above the old site, and PreCompact
  summaries reach episodic memory.

### Claude config isolation is now the default

- **`loadClaudeMd` defaults to OFF.** Conversations on the Claude Code CLI no
  longer load the host machine's Claude config — no `settings.json` (hooks,
  permission rules), no CLAUDE.md at any tier, no host skills, no project
  `.mcp.json` servers.
  (Enterprise-managed policy settings, where deployed, still apply — that tier
  cannot be suppressed client-side.)
  EYAS's own memory is the single source of truth; what the model knows is
  what EYAS recorded. Existing installs flip too — one click on the provider
  panel opts back in.
- **The ON path is explicit now.** Opting in sends
  `settingSources: ['user','project','local']` instead of omitting the option.
  The installed CLI treats an absent flag as "load everything" while the SDK
  docs promise the opposite — the toggle no longer depends on either reading,
  and the panel copy says honestly that ON loads the whole machine config,
  hooks included, not just CLAUDE.md.
- **No fake switch for Grok/Kimi.** ACP has no isolation parameter and the
  grok CLI has no suppression flag (it demonstrably loads `~/.grok` and even
  `~/.claude` globally); the kimi baseline is unverified. Their panels now say
  so instead of pretending otherwise.
- **Known residual:** a CLI session created before the flip restores its
  previously loaded context when resumed, until the session goes stale.
- **Auto-memory and filesystem MCP configs are covered too.** `settingSources: []`
  alone was not the whole story: the CLI's auto-memory keys the machine-level
  `~/.claude/projects/<cwd>/memory/MEMORY.md` on the working directory — a live
  extraction read the owner's own memory index there and judged a fresh fact
  "already recorded". Isolated calls and opted-out conversations now also set
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY` and `strictMcpConfig`, closing both channels.

### Known issues

- **The capture gate's threshold is still a guess — but now a measured one.**
  `minUserChars: 40` was chosen before there was any data on how often it fires;
  `memory_capture_runs` was built so the next change to it is read off the skip
  distribution rather than argued. The same table's `kinds` column is the only
  signal on whether the extractor mislabels a project fact as a fact about the
  owner, and neither has enough rows yet to say.

## [0.8.15-beta] - 2026-08-27 — Designs your agents follow

A design stops being a picture you keep somewhere else and becomes something the
work follows. Multi-artboard canvases in the Claude Design format, rendered by
EYAS's own MIT runtime: create one, import one, edit it by hand or on the canvas
or by asking, version every change through a single validator, attach it to a
conversation or a project, and export it to PNG and PDF.

Getting an agent to actually use one took longer than building it, and that is
most of what follows. The tool inventory was clipped to 15% of itself. A matched
skill emptied the tool list. Nothing that was ever written to memory could reach
a prompt, and nothing wrote to memory either. Each was invisible on its own, and
together they were why a design sat attached to a conversation and changed
nothing.

### Design (F2)

- **A "Design" menu item.** Multi-artboard canvases on a pan-and-zoom surface, in
  the Claude Design container format: `<Name>.dc.html` artboards, a `canvas.json`
  layout manifest with pages and sticky notes, and images stored as bare base64
  under their filename. A canvas exported here re-seeds there, and one published
  there imports and renders here.
- **EYAS's own runtime.** The hosting platform's editor is a ~2.4 MB precompiled
  payload under a licence this repository cannot redistribute, so the Design
  Components dialect is implemented from scratch as MIT code: dotted-path holes,
  `<sc-for>`, `<sc-if>`, `<dc-import>`, JSX-camelCase event binding, and real
  execution of the artboard's `class Component extends DCLogic` — so clickable
  prototypes, variant switches and selection state work.
- **The isolation that makes executing AI-authored JavaScript acceptable:** a
  `srcdoc` iframe with `sandbox="allow-scripts"` and never `allow-same-origin`, a
  CSP inside the srcdoc with `connect-src 'none'`, and Google Fonts as the only
  external origin. No route serves an artboard as a document — the render endpoint
  returns the srcdoc and the sandbox value in one JSON payload so they cannot
  drift apart. The runtime moves `<helmet>` content into `<head>` but drops any
  `<script>` there.
- **A validator gate on every write.** Hand edit, import or AI result, all of it
  is checked before it can become a version: an artboard with no `<x-dc>` root, a
  layout entry naming a file that is not there, an image reference with nothing
  behind it, a case-insensitive artboard-stem collision, a `launch` pointing at
  nothing, a stray top-level key in `canvas.json`, and the `}} ?` ternary inside a
  style attribute that the format drops silently. A rejected edit leaves the
  previous version byte-identical.
- **One AI pipeline, not one per vendor.** The same prompt and the same gate
  whatever the provider; only the executor tier varies — whole-canvas rewrite for
  small canvases, per-artboard iteration for large ones, both on plain text
  completion so a local model works too. A failed attempt is retried once with the
  validator's own output as the feedback.
- **Agents get `design_list`, `design_read`, `design_write` and `design_create`,**
  all `category: 'custom'` so they survive the MCP bridge and exist on the CLI
  providers. A design linked to a conversation travels with every turn as a
  `design-context` section; a large canvas is summarised and the agent fetches what
  it needs.
- Import from a published canvas page, export as raw files, as a portable canvas
  document, or as a standalone HTML page that opens and prints anywhere.

### WYSIWYG (F4)

- **Click an element, change it in a panel, and it lands in the source.**
  Typography, colour, box, border, radius and layout, including grid tracks that
  round-trip through `repeat(N, minmax(0, 1fr))`. Text is editable in place
  unless it is bound to a `{{hole}}`, which the panel says rather than silently
  overwriting the binding.
- **The design that this forced.** The artboard iframe has no
  `allow-same-origin`, so the app cannot reach its DOM. Rather than parse and
  mutate the template in the app — which would need a server-side DOM and a
  rendered-node-to-source mapping — the runtime owns the mutation: it stamps
  every template element with a stable index at parse time, applies the edit to
  its own copy, re-serialises, and posts the finished template back. The app
  splices it into the `.dc.html` file with the head marker, helmet and logic
  script preserved byte-for-byte.
- **Style edits keep `{{holes}}` in declarations they did not touch.** The patch
  works on the style attribute as text, declaration by declaration; a DOM style
  API would have destroyed the binding silently.
- **The splice refuses anything that does not read back as what was written.**
  Checking that the result merely parses is too weak: a `</x-dc>` inside a
  template closes the element early, and the file still parses — into a
  truncated artboard.
- **Messages are attributed to the artboard's own frame** before they are acted
  on, and validated against a strict shape. They come from an opaque origin and
  are exactly as untrusted as the artboard.
- **Tweak chips** from `data-props` re-render live; pinning one writes it back as
  the artboard's declared default.
- **Undo/redo** per artboard with Cmd/Ctrl+Z, and one version per explicit save
  rather than one per keystroke.
- The runtime defaults to **interact**, not edit: the canvas shows working
  prototypes, and an artboard marked `is_interactive` never enters edit mode.

### Print, PDF and PNG (F5)

- **A design canvas exports as PNG and PDF.** One artboard at 1× or 2×, one
  artboard as a PDF at its own natural size, or the whole canvas as a single
  multi-page PDF. `print: 'fixed'` artboards come out as one page at exactly
  their frame — a CSS pixel is 1/96 inch, so the size passes through without a
  conversion; `print: 'flow'` artboards paginate onto A4 or Letter.
- **The browser fact that shaped it: Chromium will not paginate inside an
  iframe.** It lays a frame out as a fixed box and clips the overflow, so a
  flowing artboard printed in the preview's sandboxed iframe would come out as
  one truncated page. Every artboard is therefore rendered as its own top-level
  document, and a canvas PDF is those PDFs concatenated with `pdf-lib`. That is
  the better answer anyway: each page keeps its natural size, a flowing report
  still paginates, and one artboard's `<helmet>` CSS cannot leak into the next.
- **Losing the sandbox attribute meant replacing it with three things.** Every
  print page opens in a throwaway browser context with no cookies and an opaque
  origin; every request is aborted in the browser process except the two Google
  Fonts origins the format admits; and the page carries the same `ARTBOARD_CSP`
  as the preview, imported rather than re-typed so the two cannot drift.
- **A broken artboard is refused, not exported blank.** Both failure layers are
  checked — the mount throwing, and the runtime's own marker when a component
  constructor or `renderVals()` throws. A PDF whose only content is
  "renderVals() threw: …" is worse than an error message.
- **The browser is optional and says so.** `playwright-core` is a real
  dependency (Apache-2.0, no postinstall, no runtime dependencies of its own);
  the ~150 MB browser binary is not. It is resolved from `EYAS_CHROMIUM_PATH`,
  then Playwright's own registry, then known system paths, and when there is
  none `/api/v1/designs/print-status` answers `available: false` with the remedy
  and the UI disables the buttons. The Docker image installs Chromium and the
  fonts a headless browser needs; deleting that layer costs ~350 MB and switches
  these two features off cleanly.
- **The Chromium sandbox is never disabled automatically.** A sandbox failure
  does not fall back to `--no-sandbox`: the renderer is the process that
  executes AI-authored artboard JavaScript, and turning a deployment problem
  into a silent security downgrade there is not a trade-off worth making
  quietly. It takes an explicit `EYAS_CHROMIUM_NO_SANDBOX=1`, and the error
  message says so.
- **`playwright` is gone as a shimmed optional module.** The browser tools and
  the print pipeline now share one resolver, so there is a single place that
  knows how to find a Chromium, and the SSRF predicates moved to
  `shared/net-guard` where the headless browser can apply them per request.
- **New dependencies:** `playwright-core` (Apache-2.0) and `pdf-lib` (MIT). The
  latter is not in the design spec's dependency list — it was added because
  concatenating per-artboard PDFs is what makes a mixed canvas correct instead
  of compromised onto one uniform paper.

### Canvas usability, and one field taken back out

- **The canvas takes a scroll wheel.** Plain scroll pans, Shift scrolls
  sideways, Ctrl/⌘ + scroll zooms — anchored on the pointer, so the thing under
  the cursor stays under the cursor. The listener is attached natively with
  `passive: false`, because React routes `onWheel` through a passive root
  listener where `preventDefault()` is ignored and Ctrl+wheel zooms the browser
  instead.
- **An artboard can be opened on its own.** A control on its title row (or a
  double-click on the title) fits it to the viewport; Esc returns to the
  previous view. This is what finally makes `artboardEntry.expand` do something:
  `fit` shrinks the whole artboard to the viewport, `fill` widens the frame to
  the viewport at natural scale and lets it scroll.
- **"Fit" now fits.** It measures the page's actual bounding box — artboards and
  annotations — instead of resetting to a hardcoded 60% at 40,40.
- **Nothing was put over the frames.** An overlay would make the entire surface
  pannable, but it would also silence every `is_interactive` prototype until you
  clicked into it. Dragging the background works, so opening an artboard is an
  explicit control rather than a gesture over a frame.
- **A design can be renamed** in place from its header.
- **`designs.status` is gone.** It rendered a badge in the list and did nothing
  else: it gated nothing, no UI ever called its filter, and it could not be
  changed from anywhere. A declared surface with no consumer — removed rather
  than given a job it did not need. Existing installs keep the column inert
  (`NOT NULL DEFAULT 'draft'`, so an INSERT that omits it still works); a table
  rebuild is not worth it, and a test pins that the old shape still works.

### Deleting a design, and watching a long AI edit

- **A design can be deleted from the interface.** The capability had been in
  the API since the canvas shipped, with no button anywhere — the manual said
  so out loud. The bin sits in the detail header beside rename, not on the list
  cards: those are links, and a destructive control inside a navigation target
  is a misclick waiting to happen.
- **The confirmation names what goes with it** — saved versions, and every
  conversation or project the design is attached to. The attachment count is
  the part nobody can see from the design's own page, so `GET /designs/:id` now
  carries a `links` summary next to the design. Asking blind is the worse
  version of asking.
- **A nine-minute AI edit no longer looks like nothing happening.** A measured
  edit on a CLI provider took 8 min 43 s behind a bare spinner. The panel now
  counts the elapsed time, says that a large canvas can take minutes, and the
  AI button in the header spins while a run is open — so it is visible without
  opening the panel.
- **A failed AI edit keeps its reason.** Every attempt is recorded before the
  model is asked and closed on every exit, including the throw, so a reload, a
  dropped connection or a proxy timing the request out no longer destroys the
  answer: the server finishes, the row records it, the panel reads it back. The
  request itself stays synchronous — turning it into a job id would only
  shorten the HTTP hold, at the cost of the existing API and the candidate
  preview path.
- **A restart is not a model failure.** A run orphaned by a dead process is
  closed as `interrupted` with its own message when the module registers,
  rather than spinning forever or being reported as something the AI got wrong.
- **Two clocks again, handled at the source.** "How long has this been running"
  subtracts a server timestamp from a browser one. The runs response carries the
  server's own `now`, the frontend derives the skew from it, and the elapsed
  figure is measured on one clock. The columns are epoch milliseconds rather
  than this module's usual ISO text, because `datetime('now')` produces a string
  `new Date()` reads as local time.
- **A second AI edit cannot start while one is running** on the same canvas.

### Attaching a design where it is actually used

- **A design can be attached to a conversation from the UI** — an icon in the
  top bar with a count, not a field: the bar is full, and this is an occasional
  act.
- **And to a project**, which every conversation created in it then inherits.
- **A project's designs are COPIED onto a conversation created in it**, the same
  way `indexedSources` and `workingDirectories` already are — set on the
  project, and a new conversation starts with them; not set, and it does not.
  The conversation owns them from then on and can detach any one, and nothing
  resolves the project again at read time. The copy is additive and idempotent,
  so it never removes a design somebody attached on purpose.
- **`design_link` and `design_unlink` tools**, so an agent can attach the canvas
  it just made. They default to the run's own conversation from the tool
  context, never a model-supplied id, and `scope` is a closed namespace —
  `conversation` or `project` — so a model cannot file a link somewhere nothing
  reads it.
- **Background runs see attached designs.** `buildDesignContext` was wired into
  interactive chat only, which meant a scheduled run worked blind on the very
  design it was supposed to be working from.

### What an agent sees of an attached design
- **A design announces itself; it does not hand its contents over.** The block
  says a design is attached and what KIND of data each of its parts holds —
  tokens, typography, components, patterns — and names the two calls that fetch
  them. On the shipped Odoo canvas that is **652 characters against a 46 763
  character design**, and it stays flat: twenty artboards fold into the same
  handful of role lines as two.
- **`design_read` takes a `part`.** It used to return either one whole artboard
  or the entire canvas, so "read only what you need" meant reading 10 KB to
  find five hex codes. A part returns the derived values for one role and
  nothing from another, off the same derivation the announcement is built from
  — the two cannot disagree about what exists.
- **Nothing is inlined, at any size.** An earlier version put the palette in the
  block, and before that the whole canvas when it fit. Both were paid on EVERY
  turn; a fetch is paid once. At two turns the fetch already wins, and only the
  fetch stops the cost growing with the canvas.
- **The block instructs rather than announces.** It says to follow the design
  and not to invent styling, instead of merely noting that one is attached.
- **The index is derived, never stored.** A stored copy would be a second thing
  to keep in sync, would travel in exports, and would confuse the Claude Design
  interop.
- **The design prompt teaches the same role vocabulary**, so newly generated
  canvases name their artboards accordingly — the structure is the design's own,
  not a classification imposed afterwards. Artboards are classified by file name
  and title, never by body text: a body that mentions "pattern" proves nothing.
- Two regex traps found on the first real design: JavaScript's `\b` is
  ASCII-only, so `\bűrlap` never matches "Űrlapelemek"; and Hungarian lengthens
  the stem vowel in the plural, so "minta" is not a prefix of "minták".

### Foundation (F0)

- **One assembly path.** `assembleSystemPrompt` is now the single fail-soft "assemble and flatten"
  helper, and `executeAgent` plus `channel-run-agent` go through it. Delegated subagents and
  channel replies get the project cascade and the workspace files they were silently missing. The
  agent definition's own prompt is **appended**, never replaced, so nothing that worked stops working.
- **A missing `SOUL.style.json` no longer empties the prompt.** The active-voice resolver ran inside
  the assembler's `Promise.all`; one agent without that file made `buildForPrimary` throw and the
  interactive path send `system: ''`. It now degrades to a neutral profile.
- **`projectId` reaches where it was lost:** orchestrator children, `ToolContext`, and
  `ConversationService.create()`.
- **New entry points in the context inspector:** `delegated` and `channel`. A channel reply now
  records what its prompt was made of, which it never did before.
- **Route-scoped body limits.** The 1 MiB global cap is now raised per prefix. This also fixes
  document uploads, which believed they allowed 50 MB while HTTP rejected them at 1 MiB.
- **Public asset route.** `<dataDir>/public` is served with `Cross-Origin-Resource-Policy:
  cross-origin`, so an EYAS-hosted image can finally load in an email client or an exported page.
  Binary types only — SVG is refused on an origin that holds the session cookie.

### Outgoing HTML, without a second entity to configure

- **A deterministic renderer owns every byte of the HTML EYAS sends** —
  notification email, channel replies, and the body of an approved email draft,
  composed at SEND time rather than frozen into the draft row.
- **It takes Markdown, never HTML.** That is the security property, not a
  convenience: accepting markup would need a sanitizer, and instead the body
  goes through the existing escape-by-construction markdown renderer while the
  shell is built in code. A caller that passes HTML gets a refusal that says to
  send Markdown.
- **The notification email channel stops building its own HTML.** It routed
  around the template engine with an unescaped inline string — which is why
  `render()` and `registerTemplate()` had zero callers. Both the escaping bug
  and the bypass are gone, and the transport is injectable so the send path is
  actually tested.
- **`ChannelContent.html` is finally populated.** It had been plumbed all the
  way to MIME since the channel layer was written and never filled in.
- **`render_html_document` tool**, so an agent can turn Markdown into a
  self-contained page or email body through the same renderer.

### The brand entity, considered and removed

- A second entity (`design_systems`: palette, typography, tone, logo) was built
  alongside designs, with its own table, CRUD, versioning, project column,
  settings card, `brand_get` tool, compliance critic and app skin. **It is
  gone.** Two adjacent concepts — "brand" and "design" — are misleading side by
  side, and what was useful about it the design already carries: an attached
  canvas puts its artboard source in the prompt, so the agent sees the colours,
  the type and the components.
- **What survived, and why:** the deterministic HTML renderer above. Its palette
  is a constant now. Everything else went with the entity — the compliance
  critic, the app skin, the URL extraction, the `brand-context` prompt section
  and the 800 tokens carved out for it (`projectCascade` gets its full 3000
  back; the total is still 8400).
- Existing installs keep two inert columns (`projects.design_system_id`,
  `conversations.design_system_id`) that nothing reads; a table rebuild is not
  worth it.

### Tools that reach the agent, and output you can find

- **The design tools reached nobody.** They were registered, both MCP bridges
  would have served them, and every agent's allow-list had been written before
  the design module existed. The symptom was a model saying "`design_read` is
  not wired", working around it, and producing the result twice — once without
  the design and once with the palette it scraped out of the prompt.
- **Seeded agents are brought up to the tool set their template grants today.**
  Same shape as the design-prompt seed migration: keep every previously shipped
  tool set, upgrade only rows that still match one exactly. An agent whose
  tools somebody edited is left alone, because that was a decision.
- **Every module that registers tools now declares `tools` as a dependency.**
  Eight did not. Registration is `(ctx as any).tools?.registry` — an optional
  chain that gives up silently — so a module ordered before the tools module
  loses its tools with no error anywhere. It worked only because bootstrap
  happens to register the tools module earlier in the file. A contract test now
  runs the real loader over the real dependency graph.
- **The MCP bridge logs the tool list it serves.** Without it, "did the model
  actually get that tool" is archaeology.
- **A conversation always has a working directory.** With none, the agent
  picks: observed output landed in `/tmp` and on the Desktop in the same
  session. When neither the request nor the project names one, the conversation
  gets a directory of its own under the data directory.
- **What an agent writes hangs off the message that produced it**, so it is
  visible in the conversation as it happens and still there after a reload —
  not only in a side panel. The outputs are collected before the assistant
  message is stored and attached to it.
- **A non-image attachment is finally visible.** Every attachment rendered as
  an `<img>` that hid itself on error, so an HTML page, a PDF or a CSV became
  an invisible broken image: an agent could write a file, register it
  correctly, and still leave no trace anywhere a user looks. Images still
  render as images; everything else is a chip with its name, its size and a
  link that opens it.
- **Background runs collect their output too**, not only interactive chat — a
  scheduled report otherwise existed only on disk.
- **The token figure says what it counts.** "299 931 token" next to a one-line
  question reads as if EYAS had sent that much context. It is what the provider
  billed for the run, and a CLI agent re-sends everything it has read on each
  of its internal turns, so it is the sum of those. The label and its tooltip
  now say so. (The number itself was correct — this is a labelling fix, not an
  accounting one.)
- **Two clocks, one comparison.** Output collection compared `Date.now()` with
  the filesystem's mtime and required strictly newer. A fast run writes its
  file in the same millisecond, some filesystems keep mtime only to the second,
  and the file was dropped — a test that passed alone and failed in a warm
  suite. There is a two-second tolerance now: wider than any rounding, far
  narrower than the age of anything already in the workspace.
- **What an agent writes also shows up in the attachments panel.** A CLI
  provider writes with its own file tool, so there is no `write_file` call to
  intercept and nothing lands in the documents table. Instead, after a turn,
  the working directory is scanned for files newer than the turn and they are
  registered as documents on the conversation. Deliberately conservative: two
  directory levels, no build or checkout directories, an allow-list of
  extensions a person would open, and a cap — a working directory can be a
  repository, and a build must not become four thousand attachments.

### The tool list the model was shown was 15% of the tool list

- **56 tools rendered to 13 586 characters against a 2 000-character budget, so
  the model saw eight.** Every `design_*` tool was among the 11 517 characters
  dropped, and the clip landed mid-sentence — taking with it the line that tells
  the model where the real schemas come from. One half of the prompt referenced
  tools the other half did not list. The observable result: an agent narrating
  "the design tool may have a different name, I'm looking for it", writing the
  requested page without the attached design, and writing it again once it had
  worked the palette out from the design index instead.
- **Descriptions are now the first thing given up, and names the last.** An
  inventory's job is to say what exists; the schemas arrive over the provider's
  tool API, which the footer states. Names-only puts all 56 tools in about
  1 000 characters — the complete list, inside the same budget.
- **The footer survives at every size**, because it is where the model learns
  the descriptions it is no longer being shown are available elsewhere.
- **Nothing trails off.** If even the names do not fit, the section says how
  many it could not list. That is the case for skills today: 228 of them need
  roughly 3 700 characters against a 1 600-character bucket, so about a third
  are named and the rest are counted. A 228-entry inventory in a system prompt
  is its own problem, now visible instead of silently cut.

### A skill has to be accepted, and never takes the tools away
- **"Make a simple HTML file that shows the time" matched the
  `google-drive-integration` skill at 0.9**, was injected silently, and the same
  code path emptied the tool list — `if (activeSkill) tools.length = 0`.
  `design_read` was named in the prompt and in the tool inventory and was not
  callable, so the agent read a stale file off disk and produced the wrong
  design. Verified from the recorded prompt: the inventory was complete and
  untruncated, the design announcement was there, and the tools never arrived.
- **The tool-stripping rule is gone**, and was not narrowed to one skill type
  either. An `integration` skill exists to be used WITH tools; a `tool` skill IS
  one; a `knowledge` skill is reference material, which is no reason an agent
  should stop being able to read a file. Nothing tested it and nothing depended
  on it.
- **A matched skill is now a proposal, and the turn waits for the answer.**
  Nothing is streamed, no assistant message is written and the model is not
  called: the run stops at the match, which happens before the stream opens.
  The user's message stays stored — it really was sent.
- **The answer is two buttons**, and the card says WHY the skill matched: name,
  score and the matched pattern. On the failure above it would have read
  `Google Drive · 0.9 · name: Google Drive` on a request to print the time.
- **Both answers are remembered, per conversation.** Accepting applies the skill
  silently from then on, because it was approved; declining means it is never
  proposed again there. A skill can be right for one conversation and wrong for
  the next, so the decision is not global.
- **Resuming is a re-run, not a suspended request.** Holding an SSE connection
  open until a human clicks would survive neither a restart nor a closed tab.
  The client re-sends with `resume: true`, which skips storing the user message
  a second time — pinned by a test that counts the messages across the stop and
  the resume.
- **The background path proposes nothing.** There is nobody to ask, so it uses
  what was already accepted and otherwise runs without a skill.
- **Without a decision store no skill is applied at all.** A decision that
  cannot be recorded would be asked for again every turn, and injecting
  silently instead is the exact bug this closes.
- The weak match that started it is left standing as a separate problem — a
  skill scoring 0.9 on an unrelated request means the matcher needs work — but a
  bad match now costs a click, not every tool and a wrong answer.

### Every tool call spun for ever on a finished run

- **The ACP client knew which tool call had ended and threw the id away.** It
  emitted `tool_use_start` with the real `toolCallId` and then a bare
  `tool_use_end` — no id, no status — so the panel could never match an end to
  a start. Seven tool rows kept spinning under a run badged `completed`.
- `tool_use_end` now carries `id` and `status`, optional so the nine providers
  that emit it bare stay valid. The grok-cli path fills both, the SSE relays
  forward them, and the two CLI providers stop guessing the id for their
  orchestration event.
- **Three ways a call can settle, in order of trust:** the `tool_result` that
  names it, the `tool_use_end` that names it, and — for a provider that names
  nothing — the oldest still-running call, because these CLIs run their tools
  one at a time. A first outcome always stands; a late end cannot turn a
  reported success into an error.
- **And a last line of defence:** finishing a run settles anything still
  running. A completed run cannot have a tool call in flight.

### Memory the model can actually see

- **The vault reaches the prompt.** A durable note — a markdown file with
  frontmatter — now contributes one line to an index the agent gets on every
  turn, on both the interactive and the background path. Before this, no memory
  tier had any path into the prompt except a tool nobody called, so a memory
  system that had been empty for 24 conversations would have stayed invisible
  even once it filled.
- **Two frontmatter fields carry it:** `kind` (`user`, `feedback`, `project`,
  `reference`) and `summary`. `user` and `feedback` rank first because they
  change how every answer is produced.
- **A note with no `kind` is never read as `user`.** It becomes `feedback` under
  `procedural/` and `reference` otherwise. Promoting an undeclared note to a
  fact about the owner would put it at the top of every prompt on a guess.
- **A hand-written Obsidian note works as-is.** With no `summary`, the note's
  first real line becomes its index entry — no EYAS-specific frontmatter needed
  for the vault to be useful.
- **The index says what it is.** A note's body is conversation text replayed
  into a system prompt later, which is a delayed prompt-injection channel; the
  block is labelled background context, not instructions.
- **Nothing is silently cut.** Whole lines are dropped to fit the budget and the
  count of what did not fit is printed. Half a summary is noise the model has to
  guess at.
- **Per turn, not a cache-prefix section** — `DEFAULT_BUDGET_FULL` sums to 8400
  against a shrink target of 8800, so a new prefix section would quietly scale
  every other section down for every agent.
- **Capture is the next section, not this one.** Recall shipped first so that a
  vault which starts filling is visible from the turn it fills.

### The user manual

- **The design chapter is rewritten** in all six languages
  (`knowledge/design.md`). It had grown by appending a section per feature and
  read like a build log: "Editing" and "Editing on the canvas" as separate
  topics, panning documented twice, "Import and export" competing with
  "Printing and export", and — worse — a stale claim that a small canvas is
  injected whole and a large one summarised, which stopped being true when the
  index landed.
- Eleven sections in a reading order, identical across the six languages:
  creating, getting around, opening one artboard, the three ways to edit,
  tweaks, versions, **naming artboards so an agent can find them**, attaching,
  what an agent actually sees, exporting and printing, and renaming and
  deleting.
- **Writing the chapter is what found the missing delete button.** A "what is
  not there yet" section had to exist to admit it. Both are gone now — the
  button was built, and the section it needed had nothing left to say.

### Fixed along the way

- **`triage.ts` called `require()` three times in an ESM codebase.**
  `COMPLEXITY_TO_TIER` and `CATEGORY_TIER_OVERRIDE` are runtime constants that
  had been placed in an `import type` — which erases them — so three call sites
  reached for `require('./types.js')` to get them back. That resolves only once
  something else has loaded the module, so any chat-route test running on its
  own died with "Cannot find module './types.js'" while passing in a warm suite.
  They are a value import now.

### Security

- Artboard HTML never gains `allow-same-origin`; the public asset route serves an
  allow-list of binary types only, with `nosniff` and an explicit CORP header, because it bypasses
  Hono and therefore every security-header middleware.
- DOMPurify added (taken under its Apache-2.0 option) for the HTML surfaces that follow.

### Known issues

- The 58 pre-existing test failures across 9 files (test-fixture drift) are unchanged.
- The design source editor is a plain textarea, matching the workspace file editor
  already in the app. A real code editor is deliberately deferred rather than
  introducing a second editing paradigm in the same release.
- The agentic executor tier — a CLI provider editing the materialised canvas with
  its own file tools — is designed but not wired; it needs the agent-runner
  integration. `chooseTier` never returns it, and nothing pretends otherwise.
- `bun run full-docs` regenerates every documentation page from the generator's metadata and
  **destroys hand-written prose** in the process. The committed docs and the generator have
  diverged; the design documentation was therefore hand-written into the six pages rather
  than generated.
- **The skill matcher scores badly.** `google-drive-integration` matched a request
  to print the time at 0.9, against a 0.1 threshold, out of 228 enabled skills.
  The acceptance gate means a bad match now costs a click instead of a wrong
  answer, and it is what finally makes the matcher's real quality measurable —
  but the scoring itself is untouched.
- **228 skills do not fit an inventory.** Their names alone need roughly 3 700
  characters against a 1 600 character budget, so about a third are named and
  the rest are counted. Honest, and still a lot of skills to put in front of a
  model on every turn.
- **Durable memory does not fill itself yet.** Recall works — a note in the vault
  reaches every prompt as one index line — but nothing writes one automatically.
  The vault holds exactly what was put there on purpose.
- **The permission bridge has no deterministic working-directory check.** Its
  gate is model-judged, so it refused one write to the project root and allowed
  another; an agent told to write only under its workspace put a file in the
  repository root anyway. A path comparison would settle it.

## [0.8.14-beta] - 2026-08-26 — Shape your own landing page

The landing page stops being something you're handed and becomes something you shape. The fixed
dashboard is gone; a nine-tile grid takes its place, and the extension point it's built on had
been sitting declared and unused since before this feature existed.

### Home
- **Widget grid at `/`:** drag to move, drag a corner to resize, remove a tile, or open a drawer
  and add one — including tiles from disabled modules, shown dimmed so you can see what could be
  there. Layout is per user and per breakpoint (`lg`/`md`/`sm` arrange independently) and saves
  itself ~800ms after you stop dragging.
- **Factory nine:** Pulse, Attention, Running agents, Schedule, Conversations, Board, Briefing,
  Cost, System. No stored layout means the factory layout applies — so a later release that adds
  a tile reaches everyone who never customised, automatically. A customised user is instead
  **offered** any newly-added factory widgets ("Add" / "No thanks"), never handed them silently.
- **Tiles fail alone.** A per-tile error boundary means a broken module shows "Unavailable" on
  its own tile; the other eight keep working.
- **Disabled-module tiles survive.** A tile from a disabled module drops out of the rendered grid
  but keeps its stored position and config, and returns intact when the module is re-enabled.
- **The widget extension point is alive.** `FrontendManifest.widgets` / `WidgetRegistration`
  (`src/core/types.ts`) were declared and typed but nothing populated or read them. The new
  `home` module now collects them from the module loader and serves them at
  `GET /api/v1/home/widgets`; a contract test forbids a manifest-declared widget with no frontend
  component, or the reverse.
- **Setup requests collapse:** `SetupRecommendationsCard` fired 10 requests on every open
  (providers, projects, prompts, agents, search sources, backups, ingress, autonomy, vault,
  communication). It now calls one server-cached aggregate, `GET /api/v1/home/setup-status`.
- **Dead code removed:** `AutonomyNudgeCard` — never imported, never rendered — is deleted, along
  with the fixed dashboard page it used to live on.
- Handbook: `daily/home` documents the grid, edit mode, add/remove/resize, restoring the factory
  layout, and the new-widget offer, in en, hu, de, es, fr and tlh.

### Security
- **The home endpoints were never authenticated.** `home` created its routes in `onRegister`, which
  runs for every module before any module's `onStart` — where auth mounts its middleware. Hono
  composes middleware in registration order, so nothing auth registered could ever apply: every
  `/api/v1/home/*` request failed with 401 and the UI bounced the user straight back to the login
  screen. Routes now mount in `onStart` and `home` declares `auth` as a dependency, which forces the
  order through the loader's topological sort. CSRF pairing added for the mutating layout routes.
- **A contract test now asserts what a route test structurally cannot.** Every route test in this
  repo installs its own `c.set('userId', …)`, i.e. simulates a world where auth already ran — which
  is why thousands of green tests never saw the above. `api-auth-coverage.contract.test.ts` runs the
  real dependency resolver over the real registration order and fails if a module that mounts routes
  lands before `auth`, or if an `/api/v1` segment is neither covered nor on a named public list.

### Fixed
- **Each breakpoint keeps its own arrangement.** The grid loaded the layout once at `lg` and never
  reloaded, so crossing a width threshold made the library derive an `md` layout from the `lg` one
  and save it — creating a stored row for someone who never customised (which stops future factory
  widgets reaching them) and flattening a deliberately arranged desktop layout on the way back.
- **Tiles stay inside their tiles.** Content larger than its cell escaped the frame and painted over
  neighbouring panels; it is now contained, with a visible scroll affordance where it scrolls. Pulse
  stays readable at its minimum height instead of clipping its own figures.
- **A failed fetch no longer reads as good news.** Attention, Conversations, Briefing and Board
  rendered a backend failure as a successful empty state — a dead approvals endpoint said "Nothing
  needs your attention". All nine tiles now report an unavailable source as unavailable.

### Known issues
- **The Privacy page bounces to login**, for the same reason the home page did: `privacy` registers
  before `auth`, so `/api/v1/privacy/*` never passes through the auth middleware. Its handlers use
  `requirePermission`, so the endpoints fail closed rather than being exposed — but the page is
  unusable. Not fixed here: `privacy`'s registration position is load-bearing for model wrapping.
- **17 route segments with mutating endpoints have no CSRF pairing** (a2a, artifacts, client-wiki,
  connections, costops, data-port, federation, ideas, intel, internal, ops, privacy, prompt-coach,
  skill-generation, system, team-sessions, voice). Pre-existing; frozen in a self-checking baseline
  so the list cannot grow unnoticed.
- **Disabling `auth` would start every module unprotected.** `startAll` never checks that a live
  module's declared dependencies are enabled, and `EyasModule.required` is declared but read nowhere.
- Visual layout was verified by a human on one screen size only; jsdom performs no layout, so no
  automated test covers rendering, drag-and-drop or resize.


## [0.8.13-beta] - 2026-08-25 — What actually happened

Two things that ran without leaving a trace now leave one. Every prompt records
the sections that really reached the model — in order, with sizes and what was
cut — and a scheduled job that cannot run says so on its own row instead of
sitting quietly marked active.

### Conversations
- **Context composition:** the token stripe above the header is clickable and
  opens that turn’s composition — every section that went into the prompt, in
  assembly order, with its size, whether it was truncated, and its raw content.
  Per turn, not a running total. The percentage now measures the context actually
  composed for that turn against the model’s window; the old figure summed input
  and output across the whole conversation and overstated how full the window was.

### Observability
- **Context tab:** average and peak token cost per prompt section with the sample
  count behind it, truncation rate, and estimate vs. actual — the first way to
  measure how far the token estimate drifts from what the provider reports.
  Detailed records are short-lived by design (7 days by default); the daily
  rollup survives.

### Skills
- **Inventory:** a resolution table — which copy of a skill won, what it shadows,
  where it came from, how often it was used, whether it is enabled. Duplicate ids
  resolve by a fixed ladder (user > generated > extension > core, then root, then
  path) instead of filesystem order, and the losers are recorded as shadowed
  rather than dropped silently.
- **Dead-skill detector:** finds orphaned, shadowed, never-used and dormant
  skills and files a proposal in the autonomy approval queue. It **disables; it
  never deletes**, and nothing changes until you approve. Facts are proposed at
  once; inferences wait out a grace period, and your own skills are exempt from
  the time-based rules.

### Scheduler
- **Runnability:** a job that cannot execute now says why — no handler
  registered (usually a disabled module), a trigger type that never fires on its
  own, or a schedule that could not be armed. Shown as a badge on the row, and
  **never hidden by the infrastructure filter**, since the jobs most likely to
  break are the module-seeded ones. The health strip’s “cannot run” count filters
  the list to exactly those jobs.
- **Execution log:** skipped runs now record why, and who triggered a run.
  The missing-handler case — the one early exit that recorded nothing at all —
  now writes a row, once per process, so a per-minute broken job cannot flood the
  log. `next_run_at` is refreshed on every path, so it stops drifting after a skip.
- **Truthful answers:** an invalid cron or a sub-second interval is rejected when
  you press Create instead of producing a job that silently never runs, and
  neither the API nor the agent tools report a run that did not happen. Creating,
  running and rescheduling all surface the reason when they are refused.

### Internals
- **Component tests:** first React component coverage in the repo —
  @testing-library/react (dev-only), plus 17 tests over the scheduler UI’s
  disabled states, badges, error paths and filters.
- Handbook updated in en, hu, de, es, fr and tlh across four pages.

---

## [0.8.12-beta] - 2026-08-24 — God Mode

Same task, several models, one winner. A Settings roster races in isolated
folders; they vote once on each other’s work; the winner’s files land on the
conversation and unique insights are listed — nothing is merged automatically.

### Conversations
- **God Mode:** last item in the Orchestration menu. First send confirms cost
  against the ceiling; later sends show a banner. Workers use isolated
  folders (git worktree when possible). One structured cross-review, then
  majority vote (chair / earliest finish on a tie; sole survivor if only one
  finishes). The winner workspace is promoted; unique insights are listed
  for you to apply. The **God** tab shows the step log, who voted for whom,
  each model’s comments on the others, and how the winner was chosen.
  Handbook (en/hu/de/es/fr/tlh) documents roster, isolation, decision rules,
  and how to read the God tab.

### Observability
- **God Mode tab:** ensemble run list, win-rate by model, average cost
  multiple versus a single model.

---

## [0.8.11-beta] - 2026-08-14 — Conversation working folders

A conversation now has a real workspace. Projects require a default folder
list (first = primary cwd); conversations inherit it and can override it.
Untitled threads get a name from the first request. Grok/Kimi CLI start in
that folder, not the EYAS install directory.

### Conversations
- **Working directories:** projects require a default folder list (first = primary
  cwd). Conversations inherit it, can override it, and reset it when the project
  changes. File/shell tools jail to those folders and no longer fall back to the
  EYAS process cwd. Folders tab plus a host-side directory browser.
- **Auto title:** after the first message, a still-untitled conversation
  (`Untitled` / `Névtelen` / empty) is named from that request. Immediate
  snippet, optional cheap-tier refine; a user-set title is never overwritten.
- **Context bar:** uses the model's catalog window (Grok 256k–500k), not a
  hardcoded 200k that painted a single Grok CLI turn red.
- **Grok CLI pricing:** `$2 / $6` per million (not the $15/$75 unknown-model
  fallback).
- **CLI cwd:** Grok/Kimi CLI sessions start in the conversation’s first
  working folder (same as Claude Code). They no longer inherit the EYAS
  process directory.

---

## [0.8.10-beta] - 2026-08-14 — French and Klingon locales

The product UI and the user handbook now ship **French (`fr`)** and **Klingon
(`tlh` / tlhIngan Hol)** alongside English, Hungarian, German, and Spanish.

### Languages
- Six product languages: `en`, `hu`, `de`, `es`, `fr`, `tlh`.
- i18n-parity tests require all six locale files per UI bundle.
- Settings language buttons wrap so all six labels fit.
- Setup wizard and Appearance picker offer Français and tlhIngan Hol.

### Product docs
- Starlight handbook in French and Klingon (54 chapters each).
- In-app `/docs/fr/` and `/docs/tlh/`; language switcher in the docs header.

---

## [0.8.9-beta] - 2026-08-13 — Durable tunnel + offsite backup credentials

Cloudflare tunnel settings survive a restart, and Backup destinations accept
pasted S3/B2 keys instead of only environment-variable names.

### Ingress
- Persist hostname + vaulted tunnel token; compact `eyJ` tokens accepted
  (not only dotted JWTs).
- Status matches reality: the UI no longer expects `active` while the API
  returns `{ status: { running } }`. Connected only after Cloudflare
  registers the connector.
- In-app `?` help on Tunnel settings; handbook page (en/hu/de/es).

### Backup
- Destination form accepts pasted access keys (not only `process.env` names).
- Pasted secrets are vaulted; B2 endpoint/region normalized.
- Backup list shows offsite upload status.

### Product docs
- Admin → Ingress (en/hu/de/es): tunnel token, persist, live status.

---

## [0.8.8-beta] - 2026-08-13 — Incremental code indexer

A full Odoo checkout can be indexed without freezing the server. Files are
persisted in batches; reindex skips unchanged paths; Search Sources shows
live chunk counts while `indexing`.

### Search indexer
- Incremental, batched persist (40 files at a time) so a full Odoo checkout
  no longer has to sit in RAM before any row is written.
- Tree-sitter WASM grammar/parser cache + dispose parse trees (was reloading
  the grammar on every file).
- Large classes store an outline + methods, not the whole class body twice.
- XML/JSON/YAML/HTML/CSS/SQL indexed as one chunk per file.
- Reindex skips unchanged files via `search_file_state` mtime; the HTTP loop
  stays responsive; Search Sources polls chunk count while `indexing`.
- Odoo family also skips `*_demo.xml`.

### Product docs
- User handbook (en/hu/de/es): large-tree indexing, resume on reindex.

---

## [0.8.7-beta] - 2026-08-12 — Multi-version code search pin + project defaults

Agents can pin **which** indexed codebases (e.g. Odoo 18c vs 18e vs custom addons)
a conversation may use — no silent version mixing. Project defaults inherit onto
new threads; handbook and env bootstrap cover the operator path.

### Search sources (multi-version)
- Source config metadata: **`label`**, **`version`**, **`edition`**, **`family`**,
  **`tags`**, **`include`/`exclude`**, **`maxFiles`** / **`maxFileSize`**.
- One checkout = one source (e.g. `18c`, `18e`, `eyssen-erp`). UI form + badges.
- Bootstrap idle sources from **`EYAS_ODOO_SOURCES_JSON`** (preferred) or
  `EYAS_ODOO_SOURCE_PATHS` when no labeled sources exist yet.
- **`search_indexed`** accepts `sourceIds[]` / `labels` / `version` / `edition`.
- Tools: **`get_search_context`**, **`set_search_context`** (conversation pin).
- Conversation **`search_context`** JSON + right-rail **Sources** tab (multi-checkbox).
- Project **`indexed_sources`** (search source IDs) as default pin — applied on
  conversation create and on project change.
- Shared **`resolveSearchContext`**: tool args → conversation → project → type →
  safe fallback (`needsPin` when multiple odoo-family versions would mix).
- Prompt suffix **`<code-search-context>`** for the active pin.
- Odoo tools use the same pin; cites are **`[source:odoo-src:label:file:line]`**.
- Code indexer: odoo-family excludes (`i18n`, `static`, …), higher default file
  cap, `rootLabel` / `module` metadata; reindex reuses embeddings by
  **content_hash**.

### Product docs
- User handbook (en/hu/de/es): Search Sources multi-version, conversation
  **Sources** tab, project default code sources, env bootstrap, tools, glossary.

---

## [0.8.6-beta] - 2026-08-08 — Model-agnostic coding surface (L1–L3)

EYAS owns the coding hands for every model — not only Claude Code SDK builtins.
First-class file tools, verify-before-done, worktree isolation on complex teams,
review helpers, local Odoo source search, and universal Pre/Post tool hooks.

### Coding surface (P0)
- **`read_file`**, **`write_file`**, **`edit_file`** (exact replace), **`grep`**,
  **`glob`** — workspace/worktree jail, sensitive-path deny, Zod validators,
  ACI-friendly output caps.
- **`run_command`** uses agent worktree `workingDirectory` when set.

### Review helpers (P2)
- **`git_status`**, **`git_diff`** (read-only) for PR-style review without shell.
- Coding and review agent templates grant the new file + git tools.

### Orchestration (P1)
- Team proposals use **git worktrees** for `complex` and `epic` (not only epic).
- Config **`agent.verifyCommands`** / **`verifyCwd`**: deterministic lint/test
  after a run, before the LLM critic; failures feed the feedback-resume path.

### Odoo source chain (P3)
- **`odoo_search_model`**, **`odoo_search_field`**, **`odoo_search_xml_id`**
  against local checkouts (`EYAS_ODOO_SOURCE_PATHS`).
- Bundled skill: `config/skills/coding/odoo/odoo-dev-chain.md`.

### Universal tool hooks (P4)
- **PreToolUse / PostToolUse** on every `ToolExecutor` path (all providers).
- Default safety hook blocks `.git` via file tools; registry on `ctx.tools.hooks`.
- Security-gate tiers + `FILE_ACCESS_TOOLS` cover snake_case coding tools.

### Product documentation
- User manual (en/hu/de/es): tools catalogue, agent configure, teams, configuration,
  skills, glossary updated for the coding surface.

---

## [0.8.5-beta] - 2026-08-08 — Grounding, connections, prompt coaches, multi-role readiness

Employee-replacement readiness release: agents retrieve and cite indexed sources
before inventing facts, CLI hosts share the same tool surface, durable shared
memory and external system inventory land, and prompt writing gets model-aware
coaches from one-off drafts through project/agent system prompts.

### Prompt writing
- **Model-aware Prompt Enhancer** (conversation drafts): shapes prompts for the
  thread’s model family (Claude, OpenAI, Gemini, Grok, Kimi), task-type chips
  (general/coding/research/analysis/writing/agentic/files-vision), quality
  scoring with checklist gaps, and concise/thorough alternatives. Dead wizard UI
  removed.
- **Scoped Prompt Coaches** for durable layers: project, project-type, and agent
  `systemPrompt` — same iterative help without mixing cascade/persona concerns.

### Grounding & hybrid search
- Hybrid search engine: FTS (Orama) + in-memory vector cosine index, fused with
  RRF and query-adaptive weights; degrades honestly to FTS when embeddings are
  unavailable.
- Embed-on-index: chunks store `embedding` BLOB + model when Ollama/OpenAI embed
  providers are present; startup reloads vectors into the index.
- `search_indexed` returns stable `citationId` / `cite` (`[source:…]`) fields;
  `list_search_sources` helps agents list configured sources before inventing
  facts.
- Completeness critic: deterministic grounding pre-check + RULE 6 for research /
  implement-from-source goals that claim completion without retrieval evidence;
  coding/data tool suggestions prefer search tools.

### CLI MCP tool parity (Grok / Kimi ACP)
- Stdio MCP server + loopback bridge (`/api/v1/internal/cli-mcp/*`) with
  short-lived secrets; ACP `session/new` receives non-empty `mcpServers`.
- Grok CLI and Kimi Code CLI providers inject the bridge (Claude Code already
  had in-process MCP) so host CLIs share EYAS ToolExecutor tools.

### Connections inventory
- New core module `connections`: named multi-instance inventory of external
  systems (Odoo, GitHub, GitLab, Linear, Notion, Jira, Slack API, MCP, custom HTTP).
- Catalog + CRUD API, health adapters, agent propose → human approve flow
  (optional autonomy queue), secrets vault binding (`conn-{id}-{field}`).
- Agent tools: `connections_list`, `connections_catalog`, `connections_test`,
  `connections_propose`.
- UI: `/connections` (active / pending / catalog), en/hu/de/es.

### Domain tools — Odoo + email
- Optional `odoo` module: JSON-RPC client + tools (`odoo_search_tasks`,
  `odoo_get_task`, `odoo_message_post`, `odoo_write_task` — write gated).
- Email draft → approve → send (`email_create_draft`, `email_approve_draft`,
  `email_send_draft`) with local draft store; send requires approved status.

### Durable memory, SLA, browser, failover
- **Memory blocks** (`memory_blocks` + `memory_block_read/write` tools): company /
  agent / team / run scopes with append/replace and prompt formatting.
- **SLA evaluation** in proactive heartbeat (`slaBreaches`: overdue + stale).
- **Browser hardening:** SSRF block for private/metadata hosts; `browser_snapshot`
  accessibility-tree tool (token-efficient).
- **Auto-failover planner:** when `EYAS_AUTO_FAILOVER=1` (or config), fill empty
  tier fallbacks from a second live provider (never overwrites set fallbacks).
- Ticket-to-code deploy artifact carries closed-loop checklist (human merge required).

### Multi-role execution
- **A2A task executor** wired to `agents.executeAgent` (conversation + agent run;
  no longer instant-fail “execution not available”); mailbox list/get on the
  communication service.
- **Remote-node SSH invoke** via `ssh2` (destructive-command guard unless
  `forceDestructive`); non-SSH types still 501.
- **Skill curator gate:** auto-adoption blocked unless a recent private benchmark
  snapshot meets min pass ratio + average score.

### Eval harness
- `tests/benchmarks` default agent factory is category-aware (email classifier +
  structured coding/ops/research handlers); `--stub` keeps CI plumbing smoke.
  `EYAS_BENCH_LIVE=1` optional live server path.

### Product documentation
- User/admin docs (`packages/docs/`, en/hu/de/es) updated for all 0.8.5 surfaces:
  Prompt Enhancer/Coach, hybrid search & grounding, Connections, tools catalogue,
  memory blocks, SLA, MCP CLI parity, A2A execution, security (SSRF/SSH), routing
  auto-failover, skill curator gate, glossary. New **Admin → Connections** page
  + help-map / sidebar entry.

---

## [0.8.4-beta] - 2026-08-02 — Security closure, durable autonomy, operator platform

Everything shipped after the 0.8.3-beta memory/prompt-enhancer release, previously
split across multiple `0.8.3-beta` CHANGELOG headers plus unreleased August work.
Covers F0–F2 security and autonomy loops, governed CLI providers, operator UX
(home, board, Schedule Hub), install/self-update/backup lifecycle, expanded model
providers, multi-instance channels, and new modules (voice, intel, ideabox, costops).

### Install, lifecycle & self-update
- Default HTTP port **3100** (avoids Grafana/CRA on `:3000`); `EYAS_HOME` +
  `local.yaml` merge; port-clash detection; multi-project Docker Compose.
- `eyas start` / `stop` / `restart`; one-line curl/PowerShell installers;
  optional installer `--version` / `-Version` for empty-system restore pin.
- Auto-build frontend on `start`/`serve` when the web build is missing or stale.
- Setup recommendations checklist (replaces autonomy-only home nudge).
- Status bar version reads `version.json` via `getVersion()` (no hardcoded `1.0.0`).
- **Self-update v1:** GitHub `eyssen/eyas` release/tag + CHANGELOG detection;
  `eyas update check` / `apply`, `GET`/`POST /api/v1/system/update`, Settings
  Updates card, status-bar badge. Apply always requires a working backup module
  and creates a fresh backup before checkout/rebuild/restart — no silent upgrades.

### Backup & offsite destinations
- Full-system backup packs `data/`, `config/`, `.env`, `version.json`, and compose
  overrides (excludes nested backups/tmp/runtime); sidecar manifest records
  `eyasVersion`; Backup UI shows version.
- Configurable primary offsite target after local `tar.gz`: S3/B2, FTP, Dropbox,
  SSH. Secrets are env/secret-ref names only; B2-style S3 setup documented in README.

### Providers & models
- **Kimi API** + **Kimi Code CLI** (wizard host-CLI detection).
- Claude Code **Fable** model alias; stable product display names; Terminal icons
  for `*-cli` hosts.
- OpenClaw-aligned OpenAI/Anthropic-compatible catalog (xAI, Mistral, Groq,
  Together, DeepSeek, MiniMax, vLLM, …).
- **Grok CLI ACP** provider + dual-CLI setup wizard (Claude Code + Grok).
- Claude Code session store; self-healing routing-tier defaults; providers
  off-by-default until configured.

### Communication — multi-instance channels
- Channel catalog with **instance-level credentials** and agent bindings (same
  type, e.g. Signal, can serve multiple agents).
- Configure/reconnect APIs, `list_channels` / `channel_send` tools, dashboard
  setup recommendation, agent detail **Channels** tab.
- Communication UI: per-card add instance, step-by-step setup guides, human
  field labels for Signal/Telegram.
- Channel hardening: reply-guard, progress placeholders/watchdog; Google Chat /
  Teams stubs; A2A peers.

### Product documentation & in-app help
- **Starlight multi-language docs** (`packages/docs/`, en/hu/de/es): user/admin
  product documentation covering setup, daily work, agents, automation, knowledge,
  communication, AI providers, admin, deploy/CLI, and reference.
- Served by the main EYAS process at **`/docs/`** (same origin/port); auto-build
  on `start`/`serve` when missing or stale (`docs:build`, soft-fail if omitted).
  Env: `EYAS_SKIP_DOCS_BUILD`, `EYAS_FORCE_DOCS_BUILD`, `DOCS_BASE` for standalone
  static export. Docker image and install script build the docs package.
- **help-map.json** + **ContextualHelp** (`?` on page titles) resolve to the
  active UI language; sidebar **Documentation** link. Vite proxies `/docs` in
  frontend dev.

### Operator surfaces
- **Home Attention Surface:** approvals, pinned/recent conversations, mission-
  control snapshot, briefing, next jobs (replaces empty dashboard).
- **First-turn team auto-propose** from orchestration mode + complexity
  (still requires user approval).
- **Context Rail** on conversations (notes + business history, Next activities,
  Files); runtime strip separated from chatter; idle/working noise dropped.
- Board defaults to **All projects**; rich kanban meta restored (status, due,
  tokens, agent, subtasks, aging, WIP); `/conversations` → `/board`.
- Dialogs use theme tokens (`bg-background` / `border-border`) instead of
  hardcoded dark overrides.
- **Schedule Hub:** `next_run_at`, PATCH reschedule, timeline/projections API,
  24h stats, dead-letter, concurrency limits, execution retention; `agent_run` +
  board recurring handlers; `schedule_*` tools; Gantt/list/calendar UI with
  assigned-agent badges (en/hu/de/es).
- Board multi-views (July): Linear-style grouped list + ⌘K, timeline/run-trace,
  dashboard, orchestration + stage-flow graph.
- UI i18n: English / Hungarian / German / Spanish throughout.

### New modules & data portability
- **Voice:** local STT/TTS (Whisper/Piper) + Telegram voice replies.
- **Intel** fact registry, **Ideabox** funnel, **Costops** ledger.
- Ops host-guards: disk space, channel watchdog, stuck runs; optional bumblebee scan.
- Stage WIP limits + card aging; Google Docs tools; MCP `connectors.hu`.
- Settings **data port** import wizard (multi-tier memory + own-skill routing);
  richer vault memory graph UI.

### Platform foundations (July, condensed)
- Prompt assembler: DB-backed master identity + core-rules, warm base personality,
  memory/team resolvers, master-seed refresh on upgrade; real system prompt on
  interactive/background/delegated runs.
- Autonomy / self-improvement: feature-flagged loops, approval-gated applies,
  forge/self-learning/skill-generation model-authored proposals, proactive
  heartbeat composer, settings card + onboarding.
- Skill-generation module live: routes, gated owner-approval adoption, scheduler,
  skills-registry adapter.
- Templates/themes: nebula/atelier/halo/terminal/sequoia skins, status-bar module,
  Appearance + wizard template picker.
- Users: archive-not-delete, protect agent users, restore archived.
- Ops dashboard + ticket-to-code pipeline + real remediation execution (kubectl/PR
  gate); vendor-neutrality scrub of shipped surface.
- Mission Control team role + parent edges; per-agent `maxTurns` and tool progress
  under Claude Code; phase-nested run tree + `maxParallelAgents`.

### Fixes
- Non-blocking `agentPostBoot` recovery (fire-and-forget after listen; batch-capped);
  UTC-correct daily stats (`date('now')` vs UTC `completed_at`).
- Privacy phone sanitization no longer rewrites ticket IDs as `[PHONE]`.
- Grok ACP `mcpServers` on `session/new`; ops/intel scheduler seed CreateJobInput shape.
- Conversation switch hardening; theme token mapping via `@theme inline`.

---

### F2 durable loops — park/resume, verification, auto-retry, cost producer
Eleven-task closure of the autonomy loops left open after F0/F1: a durable park-and-resume
interrupt for gated tool calls (instead of deny-and-continue), a completeness critic that
checks a run's own transcript against its goal before it can claim `completed`, auto-retry
and tier failover for transient provider errors, restart-survivable team sessions, a real
tokens/cost producer, and ownership-scoped WebSocket/REST surfaces. Every deliverable below
lands on a clean backend + web type check and a green full suite.

### Behavior changes to know before relying on this build
- **BREAKING — provider failures now fail the run.** `grok-cli` and `claude-code` used to
  swallow transport/result errors and let the run finish as if nothing happened; both now
  always throw (`grok-cli` rethrows after its `error` frame, `claude-code` throws
  `ProviderRunError` on any non-`success` SDK result subtype). Run success rates will look
  different after upgrade — they're honest now, not silently inflated.
- Mission Control's run list now includes team and delegation runs, not just background
  runs — because those shapes are supervised for the first time (see below), there are
  simply more rows than before for the same amount of actual work.
- Every background run that would finalize `completed` now spends one extra cheap-tier
  model call (the completeness critic), and complex goals spend one more for plan
  generation. A run that exhausts `maxTurns` is now its own terminal status, `max_turns`,
  and is no longer reported as `completed`.
- Historical runs/conversations/team sessions keep `cost_usd`/`total_cost_usd` at `0` —
  the new cost producer is forward-only, there is no backfill.
- Tier-based cross-provider failover ships **dormant**: `DEFAULT_TIERS` seeds every tier
  with empty `fallbackProviderId`/`fallbackModelId`, so no existing install gets
  cross-provider failover until an operator sets a fallback provider/model per tier in the
  routing UI. Same-provider retry-once is always active; that part is not gated.
- `PATCH /api/v1/conversations/:id` now Zod-validates the client-settable `status` to
  `{'idle', 'waiting', 'archived'}` (400 on anything else) — a client can no longer PATCH a
  conversation into (or out of) `waiting_approval`; that status is runner-owned, so a parked
  conversation can't be flipped back into a claimable state from the outside
  (`src/modules/conversations/routes.ts`).
- First in-codebase SQLite table rebuild: `autonomy_approvals` gained a `'revoked'` status
  value, which SQLite's `CHECK` constraint can't add via `ALTER TABLE` — the migration
  renames the table, recreates it with the new constraint, copies rows, and drops the old
  one (`src/modules/security-gate/autonomy-policy.ts`). It runs once at boot on upgrade;
  if a second process touches the same SQLite file during that boot window it will wait on
  `busy_timeout` and can fail to start — this is retryable, just restart it.

### Durable park-and-resume approvals (replaces deny-and-continue)
- An autonomous supervised run (background, team, delegation, or pipeline) that escalates a
  gated tool call now **parks**: the run and its conversation move to `waiting_approval`,
  the loop ends cleanly (no `handle.complete`), and the pending call is queued as an
  approval row carrying its arguments, an arg hash, and the run id
  (`src/modules/agent/agent-runner.ts`, `src/modules/agent/run-supervisor.ts`). CLI
  providers (Grok ACP, claude-code) park through an interrupt + approval-sink path instead
  of the native event. Interactive chat is unchanged — it still gets deny-and-continue plus
  a queued approval, never a park.
- The approval row is the grant: `autonomy_approvals` gained `arg_hash`, `run_id`,
  `consumed_at`, and `kind` columns. Operator approve consumes the grant exactly once via a
  CAS `UPDATE … WHERE consumed_at IS NULL` before the tool is allowed to re-run
  (`autonomy-policy.ts#consumeGrant`) — a changed argument set never matches a stale grant
  and re-escalates instead. A run lineage that re-parks five times fails outright with
  `error_kind='approval_loop'` rather than looping forever.
- Approve/reject drive a warm-resume via the existing checkpoint machinery
  (`src/modules/agent/approval-resume.ts`): approved runs re-issue the exact call with a
  reviewer message telling them to proceed; rejected runs get a denial message telling them
  not to retry the action. TTL expiry (`security.approvalTtlHours`, default 72h) resolves
  the same way as a reject. An hourly sweep retries approved-but-unconsumed grants and
  covers boot-time ordering, and any resume failure is recorded on the approval row
  (`resume_error`) instead of silently leaving the run stuck.
- The approvals list endpoint is now ownership-scoped for non-admin callers (parent-chain
  resolution, same pattern as team-session ownership), and the raw `input_json` (tool
  arguments) is projected out of non-admin/non-owner responses.

### Supervision extended to team + delegation runs
- Team-member and delegation/pipeline runs now get a real `agent_sessions` row,
  checkpoints, and an event-store transcript — the same supervision background runs
  already had. This is what makes park-and-resume, the critic, and cost attribution work
  for these shapes too, and it's why Mission Control now lists them (see behavior note
  above).
- Member/delegation completion status is now the run's real outcome instead of a
  hardcoded `'completed'` string; a member that throws now reports `failed`, and a
  delegated call that returns no text is reported as empty text with its real status
  instead of the previous fabricated `'Task completed.'`.

### Verification-before-done — completeness critic + plan-as-rubric
- Every supervised run that would finalize `completed` (never `max_turns`/`failed`/
  `cancelled`) is now judged by a cheap-tier completeness critic
  (`src/modules/agent/critic.ts`) against its goal — and, for background runs complex
  enough to have triggered planning, against the plan's per-step success criteria
  (`src/modules/agent/plan-store.ts`, new `agent_plans` table). The critic is fail-open: no
  provider available or an unparseable verdict just marks the run `unverified`, it still
  completes.
- An `incomplete` verdict triggers exactly one feedback resume with the critic's own
  reasoning injected as a reviewer message; a second `incomplete` finalizes the run
  `completed` with `verification='failed'` rather than looping.
- New `agent_sessions.verification` column (`passed | failed | unverified`) surfaced as a
  badge on the agent-runs page.

### Auto-retry + boot warm-resume + budget engine
- Background runs that fail with a retryable `error_kind` (rate-limit, overload, timeout,
  network) and have made fewer than 3 attempts are rescheduled with a 60s/300s/900s backoff
  and resumed from checkpoint by a sweep (`src/modules/agent/retry-sweep.ts`); each retry
  attempt is its own `agent_sessions` row linked via `parent_run_id` — existing
  completed-run counters and reporters keep counting rows as before, so retried runs will
  show up as multiple rows for one logical task.
- A new post-boot pass (`agentPostBoot`) warm-resumes checkpoint-bearing background runs
  that a restart just cold-failed, and resets conversations stuck in `working` with no live
  run back to `idle`. `waiting_approval` rows are left untouched across a restart.
- The F1-era budget engine (`createBudgetEngine`) is now actually instantiated and wired to
  every token-usage call site — `eyas.agent.budget.alert` fires for the first time; it
  previously existed but was never connected to anything.

### Cost producer — real tokens/cost, finally
- `agent_sessions.tokens_used/cost_usd`, `conversations.total_cost_usd`, and
  `team_sessions.total_cost_usd` are now written from the runner's own turn accumulation at
  run boundaries, instead of staying structurally zero (the F1 CHANGELOG's known gap).
  `ai_traces` rows gain `conversation_id`/run attribution from request metadata.
- New shared, config-overridable pricing table (`src/shared/model-pricing.ts`) pins
  `ollama`/`lmstudio` (local providers) to $0 — this closes a real bug where local-model
  calls were being priced at cloud rates and eating into the global budget for free work.
  claude-code's SDK-reported `total_cost_usd` and cache-token counts are read and preferred
  over the estimate when present.
- Mission Control's token/cost counters and daily stats are real numbers now, not stubs.

### Team-session durability — phase cursor + re-drive
- `team_sessions` persists a phase cursor (`current_phase`/`phase_status`) and per-member
  results (new `team_phase_results` table); the driver is extracted
  (`src/modules/agent/team-driver.ts`) so the approve route, the resume route, and a boot
  scan all share it. A restarted server re-drives `running` team sessions from the
  persisted cursor and leaves `paused` ones waiting durably — completed phases are not
  re-run. This closes the F1-era wedge where a `paused` team session that survived a
  restart could never actually be resumed.

### WS + REST ownership scoping
- Per-id content topics (`chat:<id>`, `team:<id>`, `orchestration:<id>`,
  `notifications:<userId>`) are now ownership-scoped at WebSocket subscribe time: a
  fail-closed ACL (`src/core/http/ws-acl.ts`) does a fresh role lookup per subscribe, denies
  unknown per-id prefixes outright, and sends a `subscribe_denied` NACK frame instead of
  silently registering — an unauthenticated or cross-owner subscribe used to just work.
  The orchestration REST replay routes (`GET /api/v1/orchestration/runs*`) are scoped with
  the same resolver. Sockets are now closed on logout and account suspension.
- `board:<projectId>` stays open to any authenticated user in F2 — there's no board
  membership model yet to scope it against; that's a deliberate, recorded gap, not an
  oversight.

### Follow-ups (deferred out of this wave)
- A team member that gets parked for approval and is then refused because of a status
  race is not currently picked up by auto-retry.
- There is no UI button yet for `POST /team-sessions/:id/resume` — a `paused` or
  boot-parked team session needs the raw API call until a later wave adds the control.
- A parked run can't be cancelled directly; the only way out today is reject (which
  resumes the run with a denial message) or letting the TTL expire.
- Interactive (non-autonomous) chat intentionally never parks — only autonomous supervised
  shapes do; interactive escalations keep the existing grant-then-retry flow.
- Cost-denominated agent budgets, a per-run budget denominator on the AgentCard, an
  interactive inline-approve UI, and periodic WebSocket TTL sweeps are recorded as future
  work, not attempted here.


### CLI-provider governance, orchestration visibility, effort levels

### Security — CLI providers fail closed
- **Grok ACP governed**: removed `--always-approve`; every ACP `session/request_permission`
  and `fs/read_text_file` / `fs/write_text_file` request now routes through the shared
  Cap 7 permission bridge (security gate + autonomy ladder, fail-closed without a gate).
  ACP tool kinds map onto the gate's canonical vocabulary (`execute`/`delete`→Bash,
  `edit`/`move`→Write, …); allows always pick `allow_once`, never `allow_always`
  (`src/modules/model/submodules/grok-cli/acp-governance.ts`).
- **claude-code**: the ungoverned `bypassPermissions` fallback is gone — no security
  gate now means headless `default` permission mode (fail-closed) + warning log.
- `createPermissionBridge` moved to `src/modules/model/permission-bridge.ts` (shared
  by both CLI providers; the old claude-code path re-exports it).

### Orchestration visibility for every claude-code run
- SDK hooks now install for ALL governed runs, not only team runs: plain conversations
  get their own run (`runId = conversationId`) with a `conv:<id>` root node,
  `sub:<agent_id>` subagent nodes nested beneath it, and run_started/run_completed frames.
- Exact tool attribution via hook `agent_id` (parallel Task fan-out included) replaces
  the single-active-subagent heuristic; PostToolUse/PostToolUseFailure emit tool_result.
- Subagent-originated stream content (`parent_tool_use_id`) no longer leaks into the
  main answer stream — it renders in the run tree instead.
- **Persistence + replay**: `orchestration_events` table + `OrchestrationEventService`
  (drop-in broadcaster: persists + broadcasts), `GET /api/v1/orchestration/runs` and
  `GET /api/v1/orchestration/runs/:runId/events`; 7-day retention prune at startup.
- Frontend: run-tree store `loadRun()` replay hydration on conversation load, team-session
  rehydration after reload, RunTree mounts for any run with nodes; the board graph's
  orchestration mode gained a real data source (run list + live WS follow + run selector).
- SSE: `tool_use_end` forwarded; `tool_result` now carries `toolUseId` (frontend matches
  by id — the old name-keyed matching never hit).

### Effort levels (provider-agnostic)
- `ModelRequest.effort` (`low|medium|high|max`) mapped per provider: claude-code →
  SDK `effort` + adaptive thinking; Anthropic API → `output_config.effort` on
  adaptive-thinking models, effort-derived `budget_tokens` on older ones; OpenAI →
  `reasoning_effort` on o-series (`max`→`high`); Grok CLI ignores it (no surface).
- Per-conversation `effort` column (PATCH-able, UI select replaces the budget presets
  that were silently discarded on adaptive models; editable mid-conversation).
- Per-agent `effort` column on `agent_definitions`, forwarded into SDK subagent
  definitions (`AgentDefinition.effort`) and the agent edit form.
- Autonomous/background runs now honor the conversation's thinking/effort (previously
  always thinking-off).

### Orchestration mode (per conversation)
- New `orchestration` column: `solo` (no provider-native fan-out — Task tool and
  subagent roster stripped), `auto` (default), `deep` (fan-out directive injected into
  the system prompt + effort defaults to `max`). Provider-aware directive: claude-code
  is steered to native Task fan-out, other providers to `propose_team`/`delegate_to_agent`.
- Precedence note: EYAS `executeTeam` owns phases/checkpoints; a team subagent running
  on claude-code may still fan out natively (nested one level, rendered under its
  `conv:<id>` node) unless the conversation is set to `solo`.


### F0 security closure

Eight-task hardening pass closing the gaps found in the 07-28 subagent orchestration
review: audit trails that recorded `'unknown'`, security modules wired in code but
never registered, a judge and permission bridges that could fail open, and an MCP
tool surface reachable without the normal authorization path. Every non-allow
decision is now audited, every unclassified tool escalates instead of running, and
the tool executor is the one place a tool call can be authorized.

### Audit trail — real subjects, secrets access logged
- Bus-emitted events now stamp their real `action`/`module` on the resulting audit
  entry instead of `'unknown'` (`src/core/bus/local-bus.ts`, `src/modules/audit/index.ts`).
- Secrets module: scope-denied and privileged reads/writes are now audited via a
  lazy sink (`src/modules/secrets/audit-sink.ts`) that falls back to `logger.warn`
  if the audit service isn't up yet, instead of being silently dropped.

### Privacy module — actually registered
- The `privacy` module (PII egress scanning, shipped `privacy.yaml` ruleset) is
  now registered in `src/core/bootstrap.ts` — it existed in code since an earlier
  wave but was never wired in, so it never ran.
- New per-call `lazy-gateway` (`src/modules/model/lazy-gateway.ts`) resolves the
  privacy + tracing wrappers at call time, so `agent-runner`, `orchestrator`, and
  the LLM judge all go through them instead of capturing an un-wrapped reference
  at module-load time (the earlier eager-capture bug this closes).

### LLM security judge — vendor-neutral, fail-closed
- Removed the hardcoded Anthropic provider pick; the judge now resolves a
  provider through the same tier resolver (`getTierResolver`) as ordinary
  requests, so any configured provider can serve as judge.
- Judge prompt rewritten to a nonce-sandwiched template demanding a strict JSON
  verdict; **zero configured providers now escalates to human approval instead
  of defaulting to allow**, and an unparseable verdict denies rather than passing
  through. No more "verdict shopping" across providers on an ambiguous result
  (regression-tested).
- `agent-runner` routes judge escalations into the approval-queue flow.

### CLI permission bridges — exhaustive fail-closed verdicts
- `src/modules/model/permission-bridge.ts` (shared by claude-code and the Grok
  ACP provider, `src/modules/model/submodules/grok-cli/acp-governance.ts`):
  **only an explicit gate `allow` proceeds** — `deny`, `escalate`, `judge_error`,
  an unrecognized decision, or the gate throwing all deny, fail-closed.
  `escalate` additionally enqueues an approval-queue entry; every non-allow
  verdict is pino-logged.
- **BREAKING:** an EYAS install with no judge-capable model configured now
  **denies `Write`/`Edit`/`Bash` in interactive claude-code/Grok CLI chats**
  until a model is configured or the owner approves the queued request — the
  previous `bypassPermissions`/`--always-approve` fallbacks that allowed these
  tools with no judge are gone.

### Deterministic gate — unknown tools escalate, paths denylisted
- Unrecognized tool names now **escalate** (human approval) instead of the
  previous silent allow; the gate also consults the tool registry's `riskTier`.
- New sensitive-path denylist for file/shell tools (`deterministic-gate.ts`):
  `master.key`, the SQLite data directory, `.env`/`.envrc`/`.ENV` (case-insensitive,
  directory-aware), `.ssh`, SSH key files, and the configured DB path.
- Every gate decision is now audit-logged, including green allows (previously
  only denials were). Denial-streak lockouts gain a 10-minute cooldown recovery
  instead of staying locked indefinitely. `WebFetch`/`WebSearch` moved from green
  to **yellow** (judge-reviewed). ACP tool kinds with no canonical mapping get a
  reserved name instead of falling through to an attacker-supplied title
  (closes a title-spoofing gap).

### Autonomous classification contract
- New `ModelRequestMetadata.origin` + `isAutonomousRequest`: only explicitly
  human-attended origins count as interactive — **absence of an origin now
  means autonomous, fail-closed** (previously the reverse). All run-construction
  call sites are labeled.
- Delegation/team/pipeline runs are now ladder-gated by this classification:
  locked-category tools (e.g. `run_command`) deny on these runs until the F2
  approval-resume flow lands — a known, accepted blast-radius increase flagged
  for follow-up.

### Tool executor — single authorization choke point + MCP closure
- `src/modules/tools/tool-executor.ts` is now the one place a tool call is
  authorized: CASL actor check + security gate + autonomy ladder, failing
  closed if authorization isn't wired.
- MCP server routes moved from `/mcp/*` to `/api/v1/mcp/*`, now behind auth and
  a CASL `execute Tool` check (previously reachable without going through the
  normal authorization path). The `mcp-server` submodule now ships
  **default-disabled** with no runtime toggle — enabling it requires editing
  the manifest source directly.
- Role `user` gains the `execute Tool` ability; `executeAgent` delegation and
  pipeline runs now carry a proper tool-execution context (previously missing,
  which would have made those paths reject every call under the new choke point).


### F1 dead-wiring closure

Nine-task follow-up closing the dead-wiring gaps found in the same 07-28
review: builtin tools that resolved their backing services to `undefined`
at bind time, agent templates whose tool lists matched no registered tool,
a conversation-update path duplicated by a hand-written 25-branch
if-chain, team-session context that never reached subagent runs, a
Mission Control/board/team WebSocket surface with no working transport,
and a board column meant to trigger unattended agent runs that no code
ever armed. Every seam below is proven live against the real
registry/executor/bus, not just unit-mocked.

### Behavior changes to know before relying on this build
- Background/autonomous runs of conversations with `thinking`, `effort`,
  or `orchestration: deep` set now actually **spend** the tokens those
  settings imply — previously the columns were silently ignored on the
  scheduled/board run path (thinking was always off). Existing scheduled
  conversations that already had these fields set will start costing more.
- Dragging a card into — or **creating** a card directly in — a
  bot-capable stage (`botListen`, or one with an `autoAssigneeId`) now
  arms it and starts an unattended agent run, using the card title as the
  goal when no prompt is set. This is wider than "drag only."
- Two agents that both hold `move_to_stage`/`assign_task` can, in
  principle, ping-pong a card back and forth; bounded by budget,
  `maxTurns`, and the single-flight/claim-recheck choke point in
  `bot-executor`, but not structurally prevented.
- Any agent created from a template before this wave — or with a
  persisted empty/NULL tools list — previously ran with **zero** usable
  tools (placeholder names matched nothing, and an empty list resolved to
  "no tools" instead of "no restriction"). Such agents now fall back to
  the full, per-call-gated tool menu the next time they run — a real
  capability increase for agents that were silently inert.
- Mission Control's per-run progress bars and cost figures still read
  zero at this wave — the F2 cost producer (later in this release) is
  what writes `tokens_used`/`cost_usd` onto `agent_sessions`.

### Tools — every builtin now hits a real service, not `undefined`
- Root cause was two independent defects: (1) `onRegister` built each tool
  factory against `(ctx as any).memory`/`knowledge`/`documents`/`research`/
  `search.engine` before those services were published in `onStart`,
  capturing `undefined` for the process lifetime; (2) even the services
  present at bind time were called through methods that don't exist
  (`board.listProjects`, `documents.listByResource`,
  `conversations.getStatus`, `search.search`, `memory.search(query, opts)`).
- Fix: the F0 lazy-getter pattern applied to every tool factory
  (`src/modules/tools/register-builtins.ts`) — services now resolve
  **per call**; a not-yet-ready service returns a structured `{ error }`
  instead of throwing.
- `search_indexed`, `search_knowledge`/`get_page`/`create_page`,
  `list_documents`/`read_document`, `search_memory`/`save_memory`,
  `list_projects`/`move_to_stage`, `get_conversation_status`, and
  `research` all now call the real, currently-shipped service API.
- **Ruling (D1) — empty tools list means "all tools."** An agent whose
  persisted `tools` is `NULL` or `[]` now resolves to the full tool menu
  (still individually gated by the security gate/autonomy ladder), not
  zero tools; fixed at all three run-path call sites (`agent/index.ts`,
  `conversation-runner.ts`, `orchestrator.ts`).
- **Ruling — `send_agent_message`/`read_agent_messages` stay green**
  (in-process, session-scoped, no egress) via an explicit autonomy-category
  override, hardened so a `null` override can never exempt a RED-tiered tool.
- **Ruling — `research` reclassified green → yellow**, matching
  `WebFetch`/`WebSearch` (web search/fetch is the same exfiltration-class
  egress; now judge-reviewed like its SDK siblings instead of
  deterministically auto-allowed).
- All 16 agent templates' `tools:` arrays renamed from placeholder strings
  to real registered tool names (the placeholders matched nothing, so
  every template-created agent ran with zero tools); every template also
  gained the coordination set (`delegate_to_agent`, `write_team_memory`,
  `read_team_memory`, `send_agent_message`, `read_agent_messages`). Both
  agent-creation INSERT paths (the `auth` setup wizard, `team-bootstrap`)
  now persist `tools` at all — previously omitted from the column list
  entirely.

### Conversations — schema-driven update, settings + team context threaded
- `conversation-service.ts`'s hand-written 25-branch `update()` if-chain
  is replaced by a single loop over a typed `UPDATE_FIELD_MAP`
  (`satisfies Record<keyof ConversationUpdate, …>` — a field added to one
  without the other is now a compile error); `teamSessionId` is a
  first-class, directly persisted column.
- Autonomous/background/board-triggered runs now read and honor the
  conversation's `thinking`/`effort`/`orchestration` settings (see the
  cost behavior note above).
- `teamSessionId` (+ derived `sessionId`/`agentRole`) now threads through
  every run shape: orchestrator subagents, `executeAgent` delegation,
  channel-triggered runs, and sub-conversations. `injectTeamMemory` — dead
  since it was written — is revived and actually injects teammates'
  memory into the system prompt, hardened against prompt injection
  (data-framing sentence, fixed-point tag-stripping so a hostile memory
  entry can't forge a closing tag and smuggle instructions past the
  boundary, `[unattributed]` instead of a forgeable `[system]` tag).
- **PATCH `/conversations/:id` now strips `teamSessionId`** from client
  request bodies — the field became directly writable the moment it
  joined `ConversationUpdate`, and a client PATCH could otherwise forge
  team-session membership.
- **Ownership enforcement added to every team-session route** (propose,
  memory read/write, get, list, approve, reject, resume) — previously any
  authenticated user could bind to, read, or act on another user's team
  session; `approve` was the sharpest gap, since it could start (and bill)
  an execution against a foreign session.

### WebSocket — the wire is real, front to back
- The bus→WS bridge is rebuilt on a shared `WS_TOPICS` module
  (`src/shared/ws-topics.ts`) instead of ad hoc string subjects on each
  side; a contract test bans string-literal `subscribe(`/`broadcast(`
  call sites and requires every topic to have both a backend producer and
  a frontend consumer.
- Frames are now thin, **projected** payloads — an allow-listed key set
  per topic, not the raw bus event — so run-failure error text, autonomy
  actor/decision detail, and rendered budget-alert sentences no longer
  ride the wire to every subscriber of a shared topic.
- Mission Control's snapshot socket (previously an unwired, tested-but-dead
  pusher) is replaced with a REST snapshot fetch plus a thin live ping
  that triggers a refetch; a real session registry now backs it (it was
  rendering an empty fallback while runs were actually in flight). Pause/
  resume are hidden in the UI — the registry has no suspend primitive and
  both endpoints now answer a hard 500 instead of silently no-op-ing;
  Interrupt remains the supported control.
- The monthly `model:budget:reset` event finally has a subscriber —
  previously zero, meaning an agent that hit its monthly budget stayed
  blocked forever.
- Frontend: team-proposal state now survives a page reload (REST-hydrated
  team-session discovery on conversation load), the team-memory dashboard
  panel auto-expands on hydration and on live approval, and the run tree
  replays from persisted `orchestration_events` instead of only showing
  runs that started after the page loaded.

### Board → agent trigger + `assign_task`
- Stage automation (`src/modules/board/stage-automation.ts`) now actually
  arms a card for autonomous pickup when it enters a `botListen` stage or
  one with an `autoAssigneeId` set — previously `bot-executor` polled for
  a `'waiting'` status nothing ever wrote, gated on a stage auto-assignee
  column that was insert-only dead (no UI, no update path). A bus kick
  (`card_armed` / `task_assigned`) now wakes the executor immediately
  instead of waiting for the 10-minute cron sweep (kept as a
  crash-recovery fallback). See the behavior note above — this also fires
  on card **creation**, not just a drag-move.
- New `assign_task` tool — async handoff to another agent via a
  sub-conversation, capped at an ancestry depth of 5 to bound delegation
  chains; yellow risk tier. See the behavior note above on the ping-pong
  possibility with `move_to_stage`.
- Stage editor gained an Auto-assign column (all four locales: en/hu/de/es).

### Testing infrastructure
- New contract-test harness (`tests/helpers/tool-contract.ts`) runs tool
  factories through the *real* registry + executor with the F0
  authorization choke point active, rather than mocking the executor
  away — the tool-seam fixes above were TDD'd red-then-green against it.
- New i18n-parity contract test for `src/web` locale bundles (en/hu/de/es
  key + placeholder parity), alongside the existing backend one.
- New `ws-topics` contract test enforcing the shared-topic-module
  convention described above.

### Follow-ups (deferred out of this wave; several closed in F2 above)
- Mission Control's per-run progress/cost bars needed a producer writing
  `tokens_used`/`cost_usd` onto `agent_sessions` — closed in F2 (cost producer).
- `PATCH /conversations/:id` still leaves other system-managed fields
  client-writable (`parentConversationId`, `agentId`, `sdkSessionId`,
  `totalCostUsd`) — same shape as the `teamSessionId` fix, not yet swept.
- `assign_task`'s default global pickup stage can land a child card off a
  project-scoped board (spec-conformant today, not reconciled).
- No component-test infrastructure for the new/changed `src/web` UI
  (verified via `tsc`/`vite build` + store/hook unit tests only — no
  jsdom render-level tests).
- Per-conversation "streak" keying and a few other minor items noted in
  the F1 ledger remain open; see
  `.superpowers/sdd/2026-07-28-eyas-f1-dead-wiring/progress.md` for the
  complete list.

---

## [0.8.3-beta] - 2026-04-19 — Memory rewrite (5-tier + vault + sqlite-vec) + Prompt Enhancer

Scope: Phase 1 security hardening Wave 1c, Phase 2 email provider wiring,
Phase 3 inspiration patterns (E/F/G/M + integrations), Phase 4 bootstrap
registration, Phase 5 observability + i18n integration, a comprehensive
memory-module rewrite (5-tier + Obsidian-parity vault + sqlite-vec), and
the new Prompt Enhancer sub-conversation feature with its own routing
tier. All changes land on a clean type check and a green test suite.

### Memory module — Obsidian-parity rewrite
- **sqlite-vec integration:** Native vector storage via the `vec0` virtual
  table, activated through Bun's `Database.setCustomSQLite` pointing at
  homebrew libsqlite3. Embedding dimensions initialised lazily on first
  write. Cosine similarity queries run against the same SQLite file as
  the rest of memory — no external service required.
- **Reciprocal Rank Fusion hybrid search:** FTS5 BM25 ranks and vector
  similarity ranks fused via RRF, with explicit AFTER INSERT / UPDATE /
  DELETE triggers on `episodic`, `semantic`, and `archive` FTS tables.
  `escapeFtsQuery` rewritten to tokenise → AND-join so multi-word queries
  return hits instead of phrase-matched zeros.
- **Semantic promoter (consolidator):** LLM summariser condenses episodic
  clusters into semantic memories on a scheduled tick. Review queue
  persistence for skill / wiki proposals so the consolidator can surface
  promotions without auto-adopting them.
- **Obsidian-compatible vault:** wikilink parser for `[[note]]`,
  `[[note|alias]]`, `[[note#heading]]`, `[[note^block]]`, `![[embed]]`.
  Dataview-style query API (`vault-query.ts`). Daily notes + templates
  service. Tag pivot service backing an aggregate tag view.
- **Graph + backlinks:** endpoints resolve wikilink targets against
  basenames, titles, and aliases so the graph and backlinks panels stop
  showing empty results for isolated nodes. Cytoscape.js graph view,
  clickable tag pivot, review queue UI.
- **Routes:** new `/api/v1/memory` endpoints for graph, backlinks, tags,
  templates, review queue, dataview query, episodic/:id, archive.
  Working-block character counts resolve via `contentLength ?? length`
  (no more empty counters).
- **Frontend Memory page:** full dashboard rewrite — Overview, Working,
  Episodic, Semantic, Archive, Graph, Tags, Review tabs. Every row in
  every tab is clickable; detail modals use explicit opaque backgrounds
  to avoid transparency bleed on top of the vibrancy backdrop.
- **Agent-scoping:** SQL injection path eliminated — the agent_id list
  filter now flows through parameterised queries.

### Prompt Enhancer (new feature)
- **Sub-conversation architecture:** a "wand" button next to the paperclip
  in the conversation input opens a dialog that spawns a child
  conversation with `goalDescription='prompt-enhancer'`. The system
  prompt installs a coach persona that emits a `<final-prompt
  carry-attachments="all|none">…</final-prompt>` block once it converges.
- **File attachments + carry-over:** the dialog supports the same upload
  / paste / drop flow as the main input. When the enhancer signals
  `carry-attachments="all"`, Apply pushes the refined text back into the
  parent input AND attaches the documents by ID (no re-upload — the file
  store is reference-counted via the link table).
- **Dedicated `prompt_enhancer` routing tier:** the enhancer runs on its
  own tier in the `routing_tiers` table. Seed logic upgraded to upsert
  missing defaults so existing databases receive the new tier. The
  enhancer-route looks up `resolveForTier('prompt_enhancer')` at
  sub-conversation creation time and sets `providerId`/`modelId` before
  the first user message.
- **SSE consumption in the dialog:** the `/messages` endpoint streams
  Server-Sent Events, so the dialog drains the stream via a dedicated
  `postMessageStreamed` helper and then refetches the full conversation
  — the previous `api.post` path was rejecting the stream as "Non-JSON
  response: OK".
- **Providers page:** new Prompt Enhancer row with a Wand2 icon in the
  Routing Tiers configurator.

### Other changes in this window

### Phase 1 — Security (Wave 1c)
- **S5 Privacy sanitization:** Replaced offset-based reconstruction that
  drifted whenever a PII replacement changed length. Each ModelRequest
  segment (system prompt, string message, text block) is now scanned and
  sanitized in isolation — indices cannot leak between neighbours.
- **S7 Worktree lifecycle:** Module-scope tracker + SIGTERM/SIGINT/exit
  handlers plus `gcOrphanedWorktrees(basePath)` at startup. Zombie
  `agent/*` branches left by SIGKILL'd prior runs are swept automatically.
- **S8 Delegation TOCTOU:** `validate` + `createChildConversation` now run
  inside one `ctx.db.transaction(...)`. Execution still runs outside the
  lock so long-running LLM calls never hold a writer.

### Phase 2 — Email providers wired into channel router
- Microsoft 365 (Graph + OAuth2), Gmail API (OAuth2), and the generic
  SMTP/IMAP adapter all plug into the existing Channel router via a new
  EmailProvider → Channel bridge. Each configured provider becomes its
  own channel keyed by mailbox address; any combination runs concurrently.
- Bridge preserves threading (`inReplyTo`, `References`), strips duplicate
  "Re:" subject prefixes, and fails init gracefully so a misconfigured
  provider cannot block the others.

### Phase 3 — Inspiration patterns
- **3E Interactive Planning:** Zod Plan/Step/Risk schema, complexity
  detector heuristic, LLM plan generator with JSON recovery and retry,
  immutable approval transitions. Runner wrapper (`maybePlanTask`) sits
  ahead of `runner.run()` without modifying it — fail-closed when no
  approval callback is wired.
- **3F Approval Tier Mode:** paranoid/balanced/autopilot policy with
  call-site > per-tool > per-user > per-risk-tier > global precedence.
  Integrated into agent-runner: approved tool calls can gate on a
  `onApprovalRequired` callback; absent callback or callback throw
  resolves to fail-closed denial. Default: autopilot — unchanged runtime.
- **3G Flow runner:** deterministic Zod-typed DAG with cycle detection at
  build time, per-node input/output schema enforcement, stable
  topological order, abort-safety. Fan-in uses a source-id-keyed record
  unless an explicit `edge.map` is supplied.
- **3M ACI output truncation:** per-tool output formatter with verbatim /
  line-head-tail / json-head / binary-summary / byte-trim strategies.
  Truncation markers embed an optional follow-up hint so the model
  knows how to retrieve the omitted portion.

### Phase 4 — Bootstrap integration
- 7 inspiration modules (event-store, artifacts, mission-control, ops,
  client-wiki, skill-generation, pipelines.ticket-to-code) registered in
  `bootstrap.ts`. Dependency order resolved by `ModuleLoader.resolveDependencies()`.
- CASL subjects seeded for event-store, client-wiki, skill-generation
  with role-appropriate defaults (agent can propose skills but not adopt;
  event-store is read-mostly; wiki is collaborative).

### Phase 5 — Integration & polish
- **Prometheus `/metrics` endpoint:** `createPrometheusExporter` wired
  into observability.onStart. Secret-driven hardening
  (`prometheus-bearer-token`, `prometheus-ip-allowlist`). Exposes 5
  collector families (agent, tool, model, http, runtime).
- **OpenTelemetry tracing:** `createOtelService` wired, OTLP/HTTP exporter
  activated only when `otel-endpoint` secret is set. Noop processor
  otherwise so instrumentations stay zero-cost. `onStop` flushes and
  shuts down the service for clean Kubernetes pod termination.
- **i18n parity guard:** tests/core/i18n-parity.test.ts auto-discovers
  every locale under `src/core/i18n/locales/` and validates same
  namespaces, same keys, same placeholder sets against the HU reference.
  New baseline namespaces for `approval` and `planning` shipped in both
  locales for the forthcoming frontend work.

### Type + test hygiene
- **tsc: 100 → 0 errors.** EyasDb gains generic `all<T>` / `get<T>`,
  routes factories relaxed to `Hono<any>`, path-param asserts where
  Hono's narrower typing rejects a runtime invariant, explicit mock
  return types, ambient declarations (`src/optional-modules.d.ts`) for
  dynamically-imported optional deps (imapflow, discord.js, @slack/bolt,
  playwright).
- **Baseline test failures: 16 → 0.** TaskSourceAdapter tests switched
  to a Drizzle wrapper (they were passing the raw sqlite handle),
  ProjectService seed-guard added to `update()` to match `delete()`,
  LlmJudge fail-closed test updated to expect the typed `judge_error`
  decision, Scheduler E2E renamed 'Skill Evolution Scan' → 'Forge Scan'.
  Vault-watcher E2E tests now `it.skipIf(!EYAS_TEST_VAULT_DIR)` to avoid
  false failures when test cwd ≠ server cwd.

### Phase 5 — Notifications completion
- **Batch / digest engine wired:** `notification_batch_queue` schema,
  `createBatchEngine` exposed via router, preferences now carry a
  `deliveryMode` column (`immediate` | `batched`). Critical severity
  always bypasses batching.
- **Retry engine wired:** `notification_retry_queue` schema, exponential
  backoff (30s → 60s → 120s → dead letter at 3 attempts), router
  auto-enqueues retries whenever a channel `send()` returns false or
  throws. `/api/v1/notifications/retry-stats` for ops visibility.
- **Webhook channel wired:** DB-backed per-user endpoint
  (`notification_webhooks` table) with HMAC-SHA256 signatures
  (`X-EYAS-Signature: sha256=…` when a shared secret is set). Routes
  GET/PUT/DELETE `/api/v1/notification-webhooks` with SSRF-aware URL
  validation (blocks loopback, `169.254.169.254`, `.internal`, non-http(s)
  schemes).
- **Template engine wired:** channel-specific renderers (email HTML
  table digest, telegram markdown, webhook JSON, web plain text) with
  HTML escape. Custom `registerTemplate(eventPattern, template)` with
  exact-then-wildcard matching.
- **Periodic processor:** module `onStart` spawns a 30s interval tick
  that drains `batchEngine.processDue()` and `retryEngine.processDue()`,
  cleaned up in `onStop`.
- **i18n:** `notifications` namespace baseline in HU + EN (settings,
  webhook, retry, severity labels).

### Test coverage
- ~130 new / fixed tests added across Phase 1-5. Notifications wiring
  adds 38 tests (templates 13, batch 9, retry 8, webhook 8) across 4 new
  files. Final suite: **269 files / 2472 passed / 3 skipped / 1
  pre-existing E2E failure (functional-memory episodic list ordering —
  unrelated, tracked separately)**.

### Autonomous Agent Prompt Architecture v2 — Phase 10: Integration tests + docs

#### Test harness (`tests/helpers/test-eyas.ts`)
- **`setupTestEyas()`** — lightweight harness for integration tests: tmpdir data
  folder, in-memory SQLite + Drizzle, real workspace loader/writer/soul pipeline,
  stub model provider (no LLM calls). Returns typed `api`, `assembler`,
  `workspaceLoader`, `workspaceWriter`, `db`, `dataDir`, `shutdown`.
- `makeMockVoiceProfile()` — helper exported for delegation chain tests.

#### Integration tests (`tests/integration/`)
- **`end-to-end-primary-agent.test.ts`** — 5 assertions: workspace files created,
  agent name substituted, prefix tags (`<core-identity>`, `<agent-identity>`,
  `## My mission`), suffix contains `Voice scope: INTERNAL`, token budget < 8800.
- **`sub-agent-delegation.test.ts`** — originating agent voice signature preserved
  through delegation chain; specialist prompt contains `<core-identity>`,
  `<subagent-role>`, `<task>`, `<delegated-voice>`.
- **`voice-scope-override.test.ts`** — 8 assertions covering the full 5-level
  priority hierarchy: per-message > ephemeral > per-conversation > per-channel > auto.
  Also covers ephemeral TTL expiry.
- **`identity-self-edit.test.ts`** — `workspace_update_identity` tool: section
  update fires notification with diff, revert restores file, rate limit blocks
  4th update in a day.
- **`soul-forge-proposal.test.ts`** — `forge_propose_soul_change` inserts row,
  `SoulProposalApplier.apply()` updates SOUL.style.json + re-renders SOUL.md,
  assembler prefix hash changes after apply.
- **`cascade-merge.test.ts`** — project-type AGENTS.md + project AGENTS.md +
  agent AGENTS.md all appear in prefix; order: type < project < agent.
- **`provider-adapter-parity.test.ts`** — AnthropicAdapter sets `cache_control:
  ephemeral` on prefix block; OpenAIAdapter concatenates prefix+suffix; Ollama
  capabilities declare `promptCache=none`; all verified without real API calls.
- **`voice-scenarios.test.ts`** — parametric test over 10 fixture scenarios.

#### Performance gate (`tests/performance/prompt-cache-anthropic.test.ts`)
- Synchronous unit test (always runs): verifies prefix block carries
  `cache_control: { type: 'ephemeral' }`.
- Gated test (`describe.skipIf(!EYAS_REAL_ANTHROPIC)`): documents the ≥ 80%
  cache hit ratio gate for 10-turn loops; skipped in CI.

#### Migration test (`tests/migration/`)
- **`helpers/seed-v1.ts`** — seeds all 16 templates as v1 rows + `simulateMigration()`.
- **`migrate-v1-to-v2.test.ts`** — roundtrip: seed → snapshot → bootstrap workspaces
  → assert IDENTITY.md/SOUL.md per tier → rollback → assert v1 columns restored.

#### Fixtures (`tests/fixtures/voice-scenarios.json`)
- 10 voice scope scenarios: owner-dm, owner+team, owner+known-contact,
  owner+unknown-external, outbound-proactive, multi-team-member, broadcast-public,
  team-only (no owner), mixed large group, proactive-to-external.

#### Docs
- `docs/eyas-architecture.md` — Section 44 (Prompt Wizard) updated with v2
  summary: file-based workspace, assembler pipeline, cache boundary, voice system.
- `docs/user/agent-voice-guide.md` — new Hungarian user guide: 6 dimenzió,
  8 preset, tiltott szófordulatok, override beállítások.
- `docs/superpowers/plans/2026-04-26-qa-results.md` — manual QA stub (deferred).

---

## [0.8.2-beta] - 2026-04-14

### Features
- **Extended Thinking:** Conversation-level thinking mode (Off / Low / Medium / High / Max) with token budget presets (5k–100k). Provider pass-through for Anthropic and Claude Code SDK. Thinking blocks displayed as collapsible violet panels during streaming. Locked after first message.
- **Markdown Rendering (Streamdown):** Vercel Streamdown integration for streaming-aware markdown in chat messages — GFM tables, syntax-highlighted code blocks (Shiki CDN), copy/download buttons, bold/italic/lists. Handles unterminated blocks during streaming gracefully.
- **MCP Tool Bridge:** EYAS tools exposed to Claude Code SDK via in-process MCP server. Agents can use EYAS tools (memory, search, knowledge, documents) alongside SDK built-in tools.
- **Static Frontend Serving:** SPA fallback added to main.ts entry point.

### Fixes
- **Claude Code SDK Isolation:** `settingSources: []` (SDK isolation mode) prevents `~/.claude/` user-level configs from leaking into EYAS conversations when `loadClaudeMd` is disabled.
- **Streamdown Controls:** Table fullscreen disabled (fixed overlay incompatible with split panel layout). Copy and download buttons retained.

### Documentation
- Architecture spec: `streamdown` dependency, `thinking`/`thinking_budget` columns in conversations schema.
- Specification HTML: Extended Thinking + Markdown Rendering in Conversation Pipeline section.
- Overview HTML: Extended Thinking in Model spec, 2 new rows in feature comparison table.
- MCP Tool Bridge design spec added.

## [0.8.1-beta] - 2026-04-12

### Security Hardening
- Path traversal protection on all file-serving endpoints.
- Parameterized queries audit across all modules.
- JWT token validation hardened, expiry edge cases resolved.
- SameSite cookie attributes, origin header verification.
- WebSocket auth hardening for Hand Hub remote connections.
- PBKDF2 iterations increased to 600K for master key derivation.

### Features
- **Skill Ecosystem:** 221 bundled skills across 16 categories, 3 types (knowledge, tool, integration), 15 API integrations.
- **Agent Wizard:** AI-assisted agent creation via conversation skill.
- **Embedding Provider:** Dedicated embedding provider in model module.
- **WebSocket Frontend:** Full real-time integration for board, chat, agent progress.
- **Smart Memory Lifecycle:** Memory tier promotion/demotion, context builder v2.
- **Team Sessions:** Parallel agent coordination, shared memory, real-time dashboard.
- **Agent System Overhaul:** No hardcoded agent names, agent memory, delegation, channel binding.

### Test Coverage
- 1353 tests passing (158 test files).
