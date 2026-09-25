---
title: Glossary
description: Product terms.
---

| Term | Definition |
|------|------------|
| Agent | Configured AI actor |
| Colleague | Primary or team agent you talk to; one home thread each (sidebar **Colleagues**) |
| Primary | Always-on colleagues from setup (Personal Assistant + System Engineer) |
| Specialist | Narrow worker any colleague can spawn (`run_specialist`) |
| Home thread | One continuous conversation per colleague |
| Skill | Markdown procedure pack |
| Skill proposal | A matched skill the conversation turn waits on — **Use it**, **Not this time**, or owner/admin **Turn it off** |
| Tool | Invokable capability |
| Coding surface | Model-agnostic file tools (`read_file`, `edit_file`, `grep`, …) owned by EYAS, not by a single vendor SDK |
| Worktree | Isolated git working tree for parallel writer specialists (`.eyas-worktrees/`) |
| Verify commands | Configured lint/test programs run after an agent run before the LLM critic |
| Tool hook | PreToolUse / PostToolUse callback on every tool execution |
| Tool outcome | The settled status of one tool call in the tool trace: *Succeeded*, *Failed*, *Denied*, *Needs approval* or *Skipped* (*Outcome unknown* when the turn ended first). A row turns green only when the tool actually reported back, the same on every provider ([Tool trace](/docs/en/daily/conversations/#tool-trace)) |
| Tool execution log | The record of every tool call: canonical name, input, output or error, duration, conversation, agent and run. It includes the tools a CLI ran in its own loop (Claude Code's `Bash` is logged as `run_command`). The completeness critic and Self-learning read it; nothing from it reaches memory ([Tools](/docs/en/automation/tools/#tool-execution-log)) |
| Board | Work tracking surface |
| Conversation | Chat thread |
| Turn outcome | How a chat turn ended, shown as one badge under the reply: none when it completed, otherwise *Turn limit reached*, *Output limit reached*, *Declined by the model*, *Tool budget used up*, *Stopped*, *Failed* or *Waiting for approval*. The answer written so far is always kept ([Turn outcome](/docs/en/daily/conversations/#turn-outcome)) |
| Memory tier | Working→episodic→vault→archive |
| Raw record (L0) | A verbatim, compressed second copy of every message EYAS persists, plus tool output and model reasoning when those switches are on. Models reach it only through recall, and recorded tool output and reasoning are never recalled. Switch: `memory.l0.enabled` ([The raw record](/docs/en/knowledge/memory/#the-raw-record)) |
| Trust tier | Who wrote a remembered text: *owner*, *derived*, *peer*, *ingested* or *quarantined*. A fact or summary is never trusted more than the text it came from. Weight in recall: 1 / 1 / 0.3 / 0.6 / never ([Trust: who wrote it](/docs/en/knowledge/memory/#trust-who-wrote-it)) |
| Project scope | The memory a conversation can see: its project's, its project type's and global memory — never another project's. EYAS enforces it on the server for recall and every memory tool, whatever the model sends ([Which memory a conversation can see](/docs/en/knowledge/memory/#which-memory-a-conversation-can-see)) |
| Memory id | The id on a recalled line, which `memory_expand` opens. Its prefix names the layer: `vt:` vault note, `gs:` summary, `ft:` fact, `en:` entity, `ep:` episode, `rw:` raw record (an earlier message). Observability counts delivered memory by these codes |
| Memory block | Retired: the former shared notes agents read/wrote via `memory_block_*` tools, copied once into EYAS memory on upgrade |
| Vault | Markdown long-term knowledge |
| Capture run | One post-turn durable-memory extraction; every outcome writes a `memory_capture_runs` row (skip, write, unparsable, error). Off switch: `memory.capture.enabled` |
| Design canvas | Multi-artboard `.dc.html` + `canvas.json` design, Claude Design file format with EYAS's own runtime |
| Provider | LLM backend |
| Provider kind | `cli` (Claude Code CLI, Grok CLI, Kimi Code CLI), `local` (Ollama, LM Studio, vLLM) or `api` (every hosted API). `GET /api/v1/model/providers` reports it next to the product name, and the Providers page and the setup wizard recognise a CLI provider by it ([Providers](/docs/en/ai/providers/#built-in-providers)) |
| Fixed model | The model a conversation runs on and keeps. A new conversation that names none gets the install default on its first message; changing defaults later does not move it. A model you picked in the model picker is never swapped silently: if it becomes unavailable, the message is refused |
| Model picker | The conversation top-bar control that chooses a fixed model, Auto-routing, or the colleague default, and says which model answers the next message and why |
| Auto-routing | A per-conversation choice: only a conversation set to Auto has its messages classified and routed across the tiers, and only while **Allow Auto-routing** is on |
| Colleague default | A conversation with a colleague (and a sub-conversation) follows that colleague's model, else the delegating conversation's model, else the default; if the colleague's model is unavailable, the turn falls back with a note, never silently |
| Background model | The model EYAS's background work (titles, heartbeat, memory capture, security judge, research, …) runs on — only a provider that can run isolated calls, tried in a fixed tier order. The **Background model calls** card on Routing Tiers shows where each group goes |
| Kernel file sandbox | The operating system's file sandbox (macOS Seatbelt, Linux bubblewrap) that Claude Code's shell commands and Grok CLI's own tools run in, blocking memory outside EYAS and EYAS's private data; Kimi Code CLI has none. `security.cliSandbox: auto \| required` |
| Quarantine (provider memory) | Owner action on Memory → Overview that hides from every model what one provider wrote, and can release it later; nothing is deleted |
| CLI home | EYAS-owned folder Grok CLI, Kimi Code CLI and OpenCode run in (`<data dir>/cli-homes/<provider>`) instead of the operator's own setup; holds their sign-in for EYAS. Claude Code keeps the host home and shares only its sign-in |
| Sign in for EYAS | Grok CLI / Kimi Code CLI login made for EYAS's own CLI home (device code, or an xAI API key for Grok) — the host login is not used |
| Isolation check | EYAS's check that a CLI (Claude Code, Grok, Kimi) loaded nothing from the host; a turn that fails it stops and is never moved to another model |
| Release check | `bun run test:live-cli`, run before a release: the real Claude Code and Grok CLI (and Kimi Code CLI where installed) run through EYAS in a throwaway home full of traps, to prove that nothing from the host is loaded and that memory outside EYAS stays refused. Its free part uses a local fake model and spends no tokens ([How isolation is proven](/docs/en/admin/security-privacy/#how-isolation-is-proven)) |
| Proven CLI version | The CLI version the release check last passed on: Claude Code 2.1.281 and Grok CLI 1.0.41; Kimi Code CLI not yet. `eyas doctor` warns when the installed version differs; every session is still checked at start ([Proven CLI versions](/docs/en/ai/providers/#proven-cli-versions)) |
| Turn block | The `<turn-context>` block EYAS puts at the top of your current message on every turn: the current date and time, then the recall block. It is built fresh for each turn and sent only to the model — never stored with your message — so the system prompt stays the same from turn to turn ([How recall reaches the model](/docs/en/knowledge/memory/#how-recall-reaches-the-model)) |
| Recall block | The fenced `<eyas-memory>` block inside the turn block: standing notes, the notes retrieved for this message and the best matches in full. The same on every provider, sized to the answering model's context window |
| Drill-down | The model opening memory itself with `memory_search` / `memory_expand`: 3 calls per answer on every provider, always within the conversation's project scope. Each host names the tools its own way (`mcp__eyas__memory_search` in Claude Code, `use_tool` with `eyas__memory_search` in Grok CLI); a model that cannot call tools gets no drill-down and more notes in full instead ([Looking further](/docs/en/knowledge/memory/#looking-further-memory_search-and-memory_expand)) |
| Delivery profile | What EYAS knows about the model answering a turn: its context window, whether it calls tools, how its host names EYAS tools and whether it can drill down. The prompt and the recall block are sized from it, and a model that cannot call tools is sent none. Each turn's **Memory delivered** box shows it ([Context composition](/docs/en/daily/conversations/#context-composition)) |
| Recall engine | What every model recalls through: a local embedder (multilingual-e5-small, else a hashed fallback), vectors filed per project partition, one query and one ranking. Shown read-only in the **Recall engine** card on **Memory → Overview** ([Recall engine](/docs/en/knowledge/memory/#recall-engine)) |
| Memory delivery by provider | The card on **Observability → Context** that compares providers: turns that carried memory, average items per layer, memory tokens and drill-downs per turn. Similar numbers mean every model received the same memory ([Observability & ops](/docs/en/admin/observability/#memory-delivery-by-provider)) |
| Memory outside EYAS | Other tools' memory, note vaults and EYAS's own data folder — refused to every model for reads and writes |
| MCP | Model Context Protocol |
| Connection | Named external system inventory entry (Odoo, GitHub, MCP, …) with health + vault secrets |
| Channel | External messaging connector (Telegram, Slack, email, …) — not a Connection, not a Hand |
| Hand | Paired local client that offers OS/CLI/desktop tools to this EYAS ([Hands](/docs/en/admin/hands/)) |
| Media | Hosted prompt→pixels gateway (Magnific, Higgsfield, fal, HeyGen). Five `media_*` tools; none is default. ([Media](/docs/en/ai/media/)) |
| HeyGen | Optional talking-head / presenter video backend under Media (MCP OAuth, web-plan credits). Not Studio. ([Media](/docs/en/ai/media/)) |
| Studio | Local production engines (HTML or footage → file). Not Media. ([Studio](/docs/en/studio/)) |
| Video Use | Studio engine that cuts raw footage from an EDL ([Video Use](/docs/en/studio/videouse/)) |
| Browser Use | Optional CLI sidecar that drives a real logged-in Chrome via CDP ([Browser Use](/docs/en/automation/browser-use/)) |
| OpenCode | Optional MIT coding-engine sidecar (HTTP on 127.0.0.1 + web TUI). Not vendored. ([OpenCode](/docs/en/automation/opencode/)) |
| OpenCode memory plugin | Gives OpenCode's model EYAS's read-only `memory_search` / `memory_expand`, and no tool that writes memory. An `opencode_run` task reads its conversation's project scope, other sessions read global memory only, and an attached external server gets none. Each OpenCode process EYAS starts has its own key, which dies with the process ([EYAS memory inside OpenCode](/docs/en/automation/opencode/#eyas-memory-inside-opencode)) |
| Remote node | Another machine this instance can reach (SSH and friends) so agents can run work off this box ([Nodes](/docs/en/admin/nodes/)) |
| Extension pack | Third-party skill pack installed from the catalogue, MIT-compatible license check ([Extensions](/docs/en/admin/extensions/)) |
| Recordly | AGPL desktop screen recorder; third-party companion via Extensions, not bundled, not a Studio engine ([Recordly](/docs/en/admin/extensions/#recordly)) |
| Grounding | Requiring search/retrieval evidence before claiming facts from indexed sources |
| Hybrid search | FTS + vector retrieval fused (RRF) |
| Search source | Named indexed tree (paths + optional label/version/edition/family) under Search Sources |
| Code source pin | Conversation or project selection of which search sources agents may query |
| Working directories | Ordered named folders (`name` + absolute path) where a conversation may read/write; first is the primary cwd. Set on the type and/or project; inherited by conversations. File tools jail here — a conversation with none gets its own EYAS workspace |
| EYAS workspace | The folder EYAS creates for a conversation that has no working directories of its own; never inside a git checkout (`EYAS_WORKSPACES_DIR` to move it) |
| Plan first | Conversation composer mode: the model writes a plan and waits (**Approve** / **Skip plan** / **Reject**) before tools run |
| Skill import roots | Instance `skills.importRoots` / `agent.importRoots` in `local.yaml` — extra markdown folders, read on every start. Default empty. Roots inside another tool's folders are skipped |
| Project wiki | Per-project pages (`/projects/:id/wiki`); optional auto-update from closed tickets and team decisions |
| needsPin | Tool response when several odoo-family versions are ready but none are pinned |
| Prompt Enhancer | Iterative coach for conversation draft prompts (model-family aware) |
| Prompt Coach | Iterative coach for durable project / agent system prompts |
| Forge | Approved soul/identity changes |
| God Mode | Conversation orchestration that races the same task across a Settings roster of models; a chair breaks even counts |
| Security gate | Pre-action policy |
| CASL | Authorization library |
| Orchestration | Solo/Auto/Deep specialist policy (plus God Mode) |
| Effort | Reasoning depth setting (Auto, None, Minimal, Low, Medium, High, Extra high, Max). The select lists only the levels the model offers; Auto inherits (Deep → Max, colleague, delegating conversation, routing tier) or uses the model's default; each call is adjusted to what the answering model supports and each reply shows the effort it ran with |
| Effort readback | Claude Code CLI, Grok CLI and Kimi Code CLI report the effort level they actually ran, and that is what the reply and its trace show. For every other provider they show the level EYAS sent after fitting it to the model ([How each provider applies the effort level](/docs/en/ai/providers/#effort-by-provider)) |
| SLA breach | Proactive signal for overdue or stale work |
| A2A | Agent-to-agent protocol (card + task execution) |
